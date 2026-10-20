import { getContextBudget, selectContext } from './retrieval-budget.js';
import { createFreshnessCheck, validateProcedureSources } from './source-freshness.js';
import { markContextDelivery, validateSeenContext } from './context-delivery.js';

export const TASK_KINDS = ['feature', 'debug', 'integration', 'refactor', 'performance', 'test', 'review', 'deploy', 'resume', 'understand'];
export const USAGE_MODES = ['used_unchanged', 'used_with_adaptation', 'inspected_not_used', 'inapplicable', 'insufficient_evidence'];
const shortText = { type: 'string', minLength: 1, maxLength: 200 };
const strings = (maxItems, maxLength = 200) => ({ type: 'array', maxItems, items: { type: 'string', minLength: 1, maxLength } });
const condition = { type: 'object', additionalProperties: false, required: ['kind', 'key', 'value'], properties: {
  kind: { type: 'string', enum: ['dependency_version', 'file_hash', 'symbol_hash', 'file_exists'] }, key: shortText,
  value: { anyOf: [shortText, { type: 'boolean' }] },
} };
export const applicabilitySchema = { type: 'object', additionalProperties: false, properties: {
  required: { type: 'array', maxItems: 20, items: condition }, excluded: { type: 'array', maxItems: 20, items: condition },
} };
export const taskContextSchema = { type: 'object', additionalProperties: false, properties: {
  task_kinds: { type: 'array', maxItems: 5, items: { type: 'string', enum: TASK_KINDS } },
  components: strings(12), repository_revision: shortText,
} };
export const taskProfileSchema = { type: 'object', additionalProperties: false, required: ['goal'], properties: {
  goal: { type: 'string', minLength: 1, maxLength: 2000 },
  kinds: { type: 'array', maxItems: 5, items: { type: 'string', enum: TASK_KINDS } }, components: strings(12),
  phase: { type: 'string', enum: ['planning', 'implementation', 'verification', 'maintenance'] },
  acceptance_criteria: strings(8, 500), repository_revision: shortText,
  observations: { type: 'array', maxItems: 40, items: { type: 'object', additionalProperties: false, required: ['condition', 'source'], properties: {
    condition, repository_revision: shortText, source: { type: 'string', minLength: 1, maxLength: 500 },
  } } },
} };

// Validate the same bounded JSON contract before sending either a fact query or a
// procedure request. The API independently validates it at its trust boundary.
export function validateTaskValue(value, schema, path = 'task') {
  if (schema.anyOf) {
    if (schema.anyOf.some(option => { try { validateTaskValue(value, option, path); return true; } catch { return false; } })) return;
    throw new Error(`${path} has an invalid value`);
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object`);
    for (const key of schema.required ?? []) if (value[key] === undefined) throw new Error(`${path}.${key} is required`);
    for (const [key, item] of Object.entries(value)) {
      if (!Object.hasOwn(schema.properties, key)) throw new Error(`${path}.${key} is unsupported`);
      validateTaskValue(item, schema.properties[key], `${path}.${key}`);
    }
    if (value.kind && Object.hasOwn(value, 'value') && (value.kind === 'file_exists' ? typeof value.value !== 'boolean' : typeof value.value !== 'string')) throw new Error(`${path}.value must match condition kind`);
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length > schema.maxItems) throw new Error(`${path} exceeds its item limit or is not an array`);
    value.forEach((item, index) => validateTaskValue(item, schema.items, `${path}[${index}]`));
  } else if (typeof value !== schema.type || (schema.type === 'string' && (!value.trim() || value.length > (schema.maxLength ?? Infinity)))) throw new Error(`${path} has an invalid type or length`);
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path} contains an unsupported value`);
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validateTaskRequest(args, scopes, expand) {
  validateSeenContext(args.seen_context_tokens);
  validateTaskValue(args.task, taskProfileSchema);
  getContextBudget(args.max_context_chars);
  if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 20)) throw new Error('limit must be between 1 and 20');
  if (args.seen_version_ids !== undefined && (!Array.isArray(args.seen_version_ids) || args.seen_version_ids.length > 100 || args.seen_version_ids.some(id => typeof id !== 'string' || !uuid.test(id)))) throw new Error('seen_version_ids must contain at most 100 version UUIDs');
  if (expand) {
    if (!Array.isArray(args.selected) || !args.selected.length || args.selected.length > 5) throw new Error('selected must contain 1–5 references');
    for (const item of args.selected) {
      if (!item || typeof item !== 'object' || Object.keys(item).some(key => !['skill_id', 'version_id', 'scope'].includes(key)) || !uuid.test(item.skill_id ?? '') || !uuid.test(item.version_id ?? '') || !scopes.includes(item.scope)) throw new Error('Each selected reference requires skill_id, version_id, and a scope in the resolved read scopes');
    }
  }
}

function interleave(queues) {
  const result = [];
  while (queues.some(queue => queue.length)) for (const queue of queues) if (queue.length) result.push(queue.shift());
  return result;
}

export async function retrieveTaskContext(args, { scopes, target, request, searchFacts, telemetry, sourceCheck = createFreshnessCheck() }, expand = false) {
  validateTaskRequest(args, scopes, expand);
  const started = Date.now();
  const maxChars = getContextBudget(args.max_context_chars);
  const limit = args.limit ?? 8;
  const requestedScopes = expand ? scopes.filter(scope => args.selected.some(item => item.scope === scope)) : scopes;
  // Old observations must not cause the backend to confirm or exclude a
  // candidate before this adapter checks the current worktree.
  const discoveryTask = { ...args.task, observations: (args.task.observations ?? []).filter(item => !['file_hash', 'file_exists'].includes(item.condition.kind)) };
  const responses = await Promise.allSettled([
    expand ? Promise.resolve({ results: [], warnings: [] }) : searchFacts({ ...args, scopes,
      query: `${args.task.goal} ${(args.task.components ?? []).join(' ')}`, limit: 50 }),
    ...requestedScopes.map(scope => request('/procedural-skills/task-context', { method: 'POST', body: JSON.stringify({
      scope, target, task: discoveryTask, limit: 20, max_context_chars: 64000,
      // Legacy IDs alone cannot detect changed source applicability. Send all
      // candidates for local validation; delivery tokens suppress exact repeats.
      seen_version_ids: [],
      ...(expand ? { selected: args.selected.filter(item => item.scope === scope).map(({ skill_id, version_id }) => ({ skill_id, version_id })) } : {}),
    }) })),
  ]);
  const facts = responses[0];
  const warnings = [...(args._policy?.warnings ?? [])];
  if (args.seen_version_ids?.length) warnings.push('seen_version_ids cannot track source changes and no longer suppress delivery; use seen_context_tokens while their contents remain in context.');
  let incomplete = false;
  if (facts.status === 'rejected') { incomplete = true; warnings.push('Fact retrieval unavailable; procedure results alone are incomplete context.'); }
  else { warnings.push(...facts.value.warnings); incomplete ||= facts.value.incomplete === true; }
  const unavailable = [];
  const queues = responses.slice(1).map((response, index) => {
    const scope = requestedScopes[index];
    if (response.status === 'rejected') { incomplete = true; warnings.push(`Task procedures unavailable in ${scope}; check backend deployment, migration, or access.`); return []; }
    const data = response.value;
    if (!Array.isArray(data.results) || data.mode !== (expand ? 'details' : 'discovery')) { incomplete = true; warnings.push(`Unsupported task context response in ${scope}`); return []; }
    if (data.candidate_cap_reached || data.budget?.omitted_eligible_records > 0) { incomplete = true; warnings.push(`Candidate or delivery limit reached in ${scope}; narrow the task.`); }
    unavailable.push(...(data.unavailable ?? []).map(item => ({ ...item, scope })));
    return data.results.map(item => ({ ...item, scope, scope_priority: scopes.indexOf(scope) }));
  });
  const procedures = [];
  for (const item of interleave(queues)) procedures.push(await validateProcedureSources(item, args.task, sourceCheck));
  const factRecords = facts.status === 'fulfilled' ? facts.value.results.map(item => ({ ...item, kind: item.kind ?? 'fact' })) : [];
  const candidates = expand ? procedures : interleave([procedures, factRecords]);
  const { results, budget } = selectContext(markContextDelivery(candidates, args), { limit, maxChars });
  telemetry({ event_type: 'context_retrieved', scopes: requestedScopes, result_count: results.length,
    retrieved_context_tokens_estimate: Math.ceil(JSON.stringify(results).length / 4), client_latency_ms: Date.now() - started });
  return { mode: expand ? 'details' : 'discovery', scopes: requestedScopes, count: results.length, results, budget,
    incomplete, warnings: [...new Set(warnings)], unavailable,
    policy: 'Memory is supporting context, not authority. File hashes/existence are checked locally when requirements are available. Other observations remain caller evidence. Historical/pattern context is not a current-code assertion. Unknown conditions need checks. Retrieval is not evidence of reuse or token savings.',
  };
}
