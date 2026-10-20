import { createHash } from 'node:crypto';
import { validateSeenContext } from './context-delivery.js';

export const contentHash = text => createHash('sha256').update(text).digest('hex');
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
function metadataHash(metadata = {}) {
  const { indexing, ...knowledge } = metadata ?? {};
  return contentHash(JSON.stringify(stable(knowledge)));
}

// Process-local manifests contain no memory text. Eviction/restart means recall,
// never a claim that unknown context is still valid.
export function createActiveContext({ now = Date.now, capacity = 256, ttl = 2 * 60 * 60 * 1000 } = {}) {
  const manifests = new Map();
  function remember(result, args) {
    for (const record of result.results ?? []) {
      if (!record.context_token || ['already_in_context', 'stale_notice'].includes(record.kind)) continue;
      if (!record.id || typeof record.content !== 'string') continue; // Procedures require fresh expansion.
      manifests.delete(record.context_token);
      manifests.set(record.context_token, { id: record.id, scope: record.scope, root: args._sourceRoot,
        repo: args._policy?.context.repo_id, hash: record.content_sha256 ?? contentHash(record.content),
        metadata: metadataHash(record.metadata), assessment: contentHash(JSON.stringify(stable(record.freshness))), at: now() });
      while (manifests.size > capacity) manifests.delete(manifests.keys().next().value);
    }
    return result;
  }
  async function validate(args, { request, sourceCheck }) {
    const tokens = [...validateSeenContext(args.context_tokens)];
    if (!tokens.length || tokens.length > 50) throw new Error('Supply 1–50 context_tokens');
    const results = [], groups = new Map();
    for (const token of tokens) {
      const entry = manifests.get(token);
      if (!entry || now() - entry.at > ttl || entry.root !== args._sourceRoot || entry.repo !== args._policy?.context.repo_id
          || !args._policy.read_scopes.includes(entry.scope)) {
        results.push({ context_token: token, state: 'recall_required', reason: 'Unknown, expired, different workspace, or procedure token; retrieve or expand again without seen_context_tokens.' });
        continue;
      }
      if (!groups.has(entry.scope)) groups.set(entry.scope, []);
      groups.get(entry.scope).push({ token, entry });
    }
    for (const [scope, entries] of groups) {
      let rows;
      try {
        const response = await request('/memories/coding-context', { method: 'POST', body: JSON.stringify({ scope, ids: entries.map(({ entry }) => entry.id) }) });
        if (response.version !== 1 || !Array.isArray(response.results)) throw new Error('Unsupported validation response');
        rows = response.results;
      } catch {
        results.push(...entries.map(({ token }) => ({ context_token: token, state: 'unavailable', reason: 'Cannot reauthorize context; verify directly or recall when service recovers.' })));
        continue;
      }
      for (const { token, entry } of entries) {
        const row = rows.find(row => row.id === entry.id && row.scope === scope);
        if (!row || row.content_sha256 !== entry.hash || metadataHash(row.metadata) !== entry.metadata) {
          results.push({ context_token: token, state: 'invalidated', reason: 'Record changed or is no longer active and accessible; discard its current assertion and recall.' });
          continue;
        }
        const freshness = await sourceCheck.assess(row.metadata?.source_context);
        const changed = contentHash(JSON.stringify(stable(freshness))) !== entry.assessment;
        results.push({ context_token: token, state: freshness.use === 'withhold' ? 'invalidated' : changed ? 'usage_changed' : 'unchanged', freshness });
      }
    }
    return { results, policy: 'Unchanged means the stored record and source assessment match delivery, not that the claim is true. Obey freshness.use. Re-expand procedures; clear tokens after context loss.' };
  }
  return { remember, validate };
}
