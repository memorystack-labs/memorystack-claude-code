---
name: coding-memory-capture
description: Capture verified, durable coding knowledge after implementation, debugging, review, testing, migration, or deployment work. Use when a confirmed decision, convention, incident lesson, dependency constraint, or repeatable workflow would prevent future agents from rediscovering it.
---

Prefer no write when no durable learning emerged. Resolve scope with the current absolute `cwd`; project facts use the default project destination. User preferences use `memory_level: user` only when intended across projects. Team/org destinations must be explicitly configured and appropriate to the authorized audience.

Write one verified, reusable fact or decision with `memory_write`, evidence (test, commit, issue, path, or symbol), and its rationale. Include known session and agent provenance in context. Use `status: proposed` for unverified claims; proposals are excluded from normal recall.

For file-dependent knowledge, read the relevant excerpt with `memory_read_source` before deriving the claim. Pass its opaque receipt in `source_context.sources` on `memory_write`; never invent a hash or attach a new file version to an old summary. Receipts expire after one hour or an adapter restart. A changed required source rejects capture: reread and reconsider the claim. A receipt proves which bytes were observed, not that an inference is correct.

Separate claims by purpose using `source_context.kind`:
- `current_state`: what the code does now. Every referenced file is required to match.
- `historical`: what happened or why a decision was made. State the historical framing explicitly; source changes do not erase the event or rationale.
- `pattern`: a reusable idea illustrated by an implementation. Mark example files `supporting`; mark actual prerequisites (such as the relevant lockfile or schema) `required`. A changed example permits adaptation; a changed prerequisite makes it background context until revalidated.
- `independent`: a verified preference or decision independent of file contents; takes no file receipts.

Use `sources: [{ receipt_id, role: "supporting" | "required" }]`. Split a current implementation assertion, historical rationale, and generalized pattern into separate atomic memories when each is worth retaining. Do not claim a library or method is still used solely because a historical example used it. Do not label an implementation claim independent to bypass validation. If the source-read tool is unavailable, a normal evidence-backed write remains unverified; do not claim freshness protection.

Temporary findings and subagent work go through `memory_checkpoint`. The parent verifies them before storing project facts. Never automatically promote an assistant's final message or a successful hook execution into durable truth.

Use `memory_propose_procedure` for a verified reusable workflow, with triggers, steps, verification, constraints, evidence, and supported targets. Recipe/skill proposal tools remain compatibility paths and do not publish instructions. For a useful verified feature implementation, propose `knowledge_kind: example` with its components, task kinds, evidence, and applicability limits. A single example is not a universal procedure. Record attributed outcomes for approved procedures without overwriting their definitions.

Do not store whole files, raw diffs, logs, prompts, credentials, or temporary chatter. Do not claim to invalidate a record unless the correction operation acknowledges success.

Before writing, compare with relevant facts already retrieved. If equivalence is uncertain, make one narrow search in the intended write scope. Reuse an equivalent applicable fact instead of writing it again. A failed search does not establish absence; semantic similarity alone is not permission to merge. For materially changed information, verify the change and report conflicts. A new record marked `superseded` does not supersede an existing ID.

Prefer concise content, omitting fields that add no value:
```text
Decision or fact: one verified reusable statement
Reason: why this matters
Applies to: component, situation, or limitation
```
Keep test/commit/path references in structured `evidence`, not a copied transcript. For an explicit user preference, the user's statement is the source; do not invent a message ID or test. Include available provenance, but durable facts do not require a session ID. Routine completion with no reusable learning requires no durable write.

Use one stable `idempotency_key` for one intended fact write and reuse it with the same payload on retry. Search-before-write reduces semantic repetition; backend idempotency prevents duplicate retries. After an ambiguous timeout, do not retry with a fresh key. If the backend does not acknowledge idempotency support, report uncertainty and reconcile rather than claiming retry safety.

Supply `provenance` when the source or verification matters: `origin` (agent_inference, user_statement, external_material, derived), a bounded source `reference`, optional `parent_memory_ids`, `verification` (not_verified, code_inspection, test_result, human_review), and limitations. Test evidence includes `checks: [{command, result, coverage, reference?}]`; record what ran and what it covered, including failures. Never claim an unrun check or invent a user quotation. These fields are caller reports, not server verification; parent IDs are unverified references and must not increase confidence through repeated copying. API ingestion sets unknown numeric confidence and does not mislabel an agent write as a direct user message.

For an actual error in an existing fact, save a verified replacement with evidence first. Retrieve both records in the exact scope to obtain their `content_sha256` values. Call `memory_correct` with their IDs, both hashes, a specific reason and a stable `idempotency_key`. It atomically supersedes the old fact while retaining both texts, and rejects changed records or cross-boundary replacements. Use it for a demonstrated correction, not a difference of opinion, timestamp precedence, or historical context that remains useful. A conflict requires rereading and reconsidering; an unavailable regional migration is not success. After correction, revalidate any earlier context token for the old record.

Use the MemoryStack MCP tools supplied by this plugin, with target: "claude-code" for procedure discovery and expansion.
