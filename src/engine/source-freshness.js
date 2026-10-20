import { createHash, randomUUID } from 'node:crypto';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';

export const KNOWLEDGE_KINDS = ['current_state', 'historical', 'pattern', 'independent'];
const MAX_BYTES = 2 * 1024 * 1024;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (root, file) => { const relative = path.relative(root, file); return relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative); };
const sameStat = (a, b) => ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(key => a[key] === b[key]);

export function relativeSourcePath(value) {
  if (typeof value !== 'string' || !value || value.length > 500 || /[\\:\x00-\x1f]/.test(value) || path.posix.isAbsolute(value)
    || value.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Source path must be a normalized workspace-relative path using /');
  return value;
}

// Read the same opened file that is hashed. Reject observable replacement or
// concurrent modification; this is not a transactional filesystem snapshot.
async function snapshot(root, sourcePath) {
  if (!root) throw new Error('A workspace is required for source validation');
  relativeSourcePath(sourcePath);
  const base = await realpath(root);
  const target = await realpath(path.join(base, sourcePath));
  if (!inside(base, target)) throw new Error('Source resolves outside the workspace');
  const handle = await open(target, 'r');
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(MAX_BYTES)) throw new Error('Source must be a regular file no larger than 2 MiB');
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let count = 0;
    while (count < buffer.length) {
      const read = await handle.read(buffer, count, buffer.length - count, count);
      if (!read.bytesRead) break;
      count += read.bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const resolvedAfter = await realpath(path.join(base, sourcePath));
    // Compare two handle stats: on Windows path stat can report dev=0 even
    // when fstat reports the real volume ID for the same file.
    const namedHandle = await open(resolvedAfter, 'r');
    let named;
    try { named = await namedHandle.stat({ bigint: true }); } finally { await namedHandle.close(); }
    if (target !== resolvedAfter || !sameStat(before, after) || !sameStat(after, named) || count !== Number(before.size)) throw new Error('Source changed during read; retry');
    const bytes = buffer.subarray(0, count);
    return { bytes, sha256: sha256(bytes) };
  } finally { await handle.close(); }
}

export const sourceContextSchema = { type: 'object', additionalProperties: false, required: ['kind'], properties: {
  kind: { type: 'string', enum: KNOWLEDGE_KINDS },
  sources: { type: 'array', maxItems: 12, items: { type: 'object', additionalProperties: false, required: ['receipt_id', 'role'], properties: {
    receipt_id: { type: 'string', format: 'uuid' }, role: { type: 'string', enum: ['supporting', 'required'] },
  } } },
} };

export function createSourceTracker({ now = Date.now } = {}) {
  const receipts = new Map();
  const prune = () => {
    for (const [id, receipt] of receipts) if (now() - receipt.created > 3_600_000) receipts.delete(id);
  };
  async function read(args) {
    const root = args._sourceRoot;
    const repoId = args._policy?.context.repo_id;
    if (!root || !repoId) throw new Error('Resolve a workspace before reading a source');
    const sourcePath = relativeSourcePath(args.path);
    const start = args.start_line ?? 1;
    const end = args.end_line;
    const maxChars = args.max_chars ?? 12000;
    if (!Number.isInteger(start) || start < 1 || (end !== undefined && (!Number.isInteger(end) || end < start))
      || !Number.isInteger(maxChars) || maxChars < 100 || maxChars > 32000) throw new Error('Invalid line range or max_chars (100–32000)');
    const file = await snapshot(root, sourcePath);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(file.bytes);
    if (text.includes('\0')) throw new Error('Only UTF-8 text sources are supported');
    const lines = text.split('\n');
    if (start > lines.length || (end !== undefined && end > lines.length)) throw new Error('Line range is outside the file');
    const content = lines.slice(start - 1, end ?? lines.length).join('\n');
    if (content.length > maxChars) throw new Error('Source excerpt exceeds max_chars; select a smaller line range');
    prune();
    while (receipts.size >= 256) receipts.delete(receipts.keys().next().value);
    const id = randomUUID();
    const binding = { path: sourcePath, algorithm: 'sha256', format: 'raw-bytes-v1', sha256: file.sha256,
      observed_at: new Date(now()).toISOString(), lines: { start, end: end ?? lines.length } };
    receipts.set(id, { created: now(), root, repoId, binding });
    return { receipt_id: id, source: binding, content, policy: 'Receipt covers only this observed excerpt. It expires after one hour or adapter restart. File bytes are not uploaded by this read.' };
  }
  async function bind(input, args) {
    if (input === undefined) return undefined;
    if (!input || Array.isArray(input) || !KNOWLEDGE_KINDS.includes(input.kind) || Object.keys(input).some(key => !['kind', 'sources'].includes(key))) throw new Error('Invalid source_context');
    const refs = input.sources ?? [];
    if (!Array.isArray(refs) || refs.length > 12 || (input.kind === 'independent' ? refs.length !== 0 : refs.length === 0)) throw new Error('File-based knowledge requires 1–12 source receipts; independent knowledge takes none');
    const sources = [];
    const seen = new Set();
    prune();
    for (const ref of refs) {
      if (!ref || Object.keys(ref).some(key => !['receipt_id', 'role'].includes(key)) || !['supporting', 'required'].includes(ref.role)) throw new Error('Invalid source reference');
      const receipt = receipts.get(ref.receipt_id);
      if (!receipt || receipt.root !== args._sourceRoot || receipt.repoId !== args._policy?.context.repo_id) throw new Error('Source receipt expired, unknown, or belongs to another workspace');
      if (seen.has(receipt.binding.path)) throw new Error('Use one source receipt per path');
      seen.add(receipt.binding.path);
      const role = input.kind === 'current_state' ? 'required' : ref.role;
      if (input.kind !== 'historical' && role === 'required') {
        if ((await snapshot(args._sourceRoot, receipt.binding.path)).sha256 !== receipt.binding.sha256) throw new Error('Required source changed since it was read; reread and verify the claim before capture');
      }
      sources.push({ ...receipt.binding, role });
    }
    return { version: 1, kind: input.kind, ...(refs.length ? { repo_id: args._policy.context.repo_id } : {}), sources };
  }
  return { read, bind };
}

// Cache only within one request. Edits from other processes, missed hooks and
// same-size/same-mtime changes must be observed again on the next retrieval.
export function createFreshnessCheck({ root, repoId } = {}) {
  const files = new Map();
  let bytes = 0;
  async function inspect(sourcePath) {
    try { relativeSourcePath(sourcePath); } catch { return { state: 'unavailable' }; }
    if (!files.has(sourcePath)) {
      if (!root || files.size >= 32 || bytes >= 16 * 1024 * 1024) return { state: 'unavailable' };
      files.set(sourcePath, (async () => {
        try { const file = await snapshot(root, sourcePath); bytes += file.bytes.length; return { state: 'present', sha256: file.sha256 }; }
        catch (error) { return { state: error.code === 'ENOENT' ? 'missing' : 'unavailable' }; }
      })());
    }
    return files.get(sourcePath);
  }
  async function assess(binding) {
    if (!binding) return { state: 'unverified', use: 'verify_before_use', reason: 'No source binding; legacy claims are not certified as current.' };
    if (binding.version !== 1 || !KNOWLEDGE_KINDS.includes(binding.kind) || !Array.isArray(binding.sources) || binding.sources.length > 12
      || (binding.kind === 'independent' ? binding.sources.length !== 0 : binding.sources.length === 0)) return { state: 'unverified', use: 'withhold', reason: 'Unsupported source binding.' };
    if (binding.kind === 'independent') return { state: 'not_file_bound', use: 'supporting_context', reason: 'Declared independent of files; this does not verify truth.' };
    const checks = [];
    for (const source of binding.sources) {
      if (!source || source.algorithm !== 'sha256' || source.format !== 'raw-bytes-v1' || !/^[a-f0-9]{64}$/.test(source.sha256 ?? '') || !['required', 'supporting'].includes(source.role)) return { state: 'unverified', use: 'withhold', reason: 'Malformed source binding.' };
      const observed = binding.repo_id && binding.repo_id === repoId ? await inspect(source.path) : { state: 'different_repository' };
      checks.push({ path: source.path, role: source.role, state: observed.state === 'present' ? observed.sha256 === source.sha256 ? 'matching' : 'changed' : observed.state });
    }
    const changed = checks.some(check => ['changed', 'missing'].includes(check.state));
    const unknown = checks.some(check => !['matching', 'changed', 'missing'].includes(check.state));
    const requiredInvalid = checks.some(check => check.role === 'required' && check.state !== 'matching');
    return { state: unknown ? 'unverified' : changed ? 'changed' : 'matching',
      use: binding.kind === 'historical' ? 'historical_only'
        : binding.kind === 'current_state' ? checks.every(check => check.state === 'matching') ? 'current_source' : 'withhold'
        : requiredInvalid ? 'background_only' : changed || unknown ? 'adapt_and_verify' : 'pattern_to_verify',
      checks, reason: 'Hashes check source identity, not claim correctness or unrecorded dependencies.' };
  }
  async function memory(record) {
    const freshness = await assess(record.metadata?.source_context);
    if (freshness.use === 'withhold') return { id: record.id, content_sha256: record.content_sha256, scope: record.scope, scope_priority: record.scope_priority,
      kind: 'stale_notice', freshness, content: 'File-dependent claim withheld. Re-read the affected source before relying on its current behavior.' };
    return { ...record, freshness };
  }
  return { inspect, assess, memory };
}

export async function validateProcedureSources(item, task, check) {
  const requirements = item.requirements ?? item.definition?.applicability;
  if (!requirements) return { ...item, applicability: { ...item.applicability, state: 'unknown', basis: 'requirements_unavailable', requires_local_review: true } };
  const missing = [], conflicts = [];
  let checked = 0;
  for (const relation of ['required', 'excluded']) for (const condition of requirements[relation] ?? []) {
    let value;
    if (condition.kind === 'file_hash' || condition.kind === 'file_exists') {
      const observed = await check.inspect(condition.key);
      if (condition.kind === 'file_hash' && observed.state === 'present' && /^[a-f0-9]{64}$/.test(condition.value)) value = observed.sha256;
      if (condition.kind === 'file_exists' && ['present', 'missing'].includes(observed.state)) value = observed.state === 'present';
      if (condition.kind === 'file_hash' && observed.state === 'missing') value = false;
    } else {
      const observations = (task.observations ?? []).filter(observation => observation.condition.kind === condition.kind && observation.condition.key === condition.key
        && (!task.repository_revision || task.repository_revision === observation.repository_revision));
      const values = new Set(observations.map(observation => observation.condition.value));
      if (values.size === 1) value = [...values][0];
    }
    if (value === undefined) missing.push({ ...condition, relation });
    else {
      checked++;
      const same = value === condition.value;
      if (relation === 'required' ? !same : same) conflicts.push({ ...condition, relation });
    }
  }
  const textReview = item.applicability?.requires_text_review || !!(item.definition?.prerequisites?.length || item.definition?.constraints?.length);
  const state = conflicts.length ? 'contradicted' : missing.length || !checked || textReview ? 'unknown' : 'confirmed';
  const applicability = { state, basis: 'local_file_checks_and_caller_nonfile_observations', checks_performed: checked,
    missing_checks: missing, conflicts, requires_text_review: !!textReview };
  // Retain discoverability of past implementations, but do not deliver stale
  // executable steps as if they were a currently applicable recipe.
  if (state === 'contradicted') return { kind: 'stale_notice', skill_id: item.skill_id, version_id: item.version_id, scope: item.scope,
    name: item.name ?? item.definition?.name, applicability, use: 'historical_reference_only', detail_available: false };
  return { ...item, applicability };
}
