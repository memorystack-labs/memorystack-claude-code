import { createHash } from 'node:crypto';

export const seenContextSchema = { type: 'array', maxItems: 100, items: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  description: 'Delivery tokens whose content is still in the current context. Clear after compaction or a new context window. Sources are revalidated before suppression.' };

export function validateSeenContext(value = []) {
  if (!Array.isArray(value) || value.length > 100 || value.some(token => typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token))) throw new Error('seen_context_tokens must contain at most 100 SHA-256 delivery tokens');
  return new Set(value);
}

export function markContextDelivery(records, args) {
  const seen = validateSeenContext(args.seen_context_tokens);
  return records.map(record => {
    // Ranking scores are not content changes. Worktree/root and all knowledge,
    // source assessments and procedure versions are part of the delivery key.
    const { score, scope_priority, match, ...knowledge } = record;
    const token = createHash('sha256').update(JSON.stringify([1, args._sourceRoot ?? null, args._policy?.context.repo_id ?? null, knowledge])).digest('hex');
    if (seen.has(token)) return { kind: 'already_in_context', id: record.id, skill_id: record.skill_id,
      version_id: record.version_id, scope: record.scope, context_token: token };
    return { ...record, context_token: token };
  });
}
