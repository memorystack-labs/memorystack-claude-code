---
name: coding-memory-session
description: Maintain a compact, evidence-backed coding-session handoff at task checkpoints, context compaction, subagent completion, or task completion. Use when future agents need to resume work without replaying the full conversation or terminal history.
---

Keep Claude Code IDs and MemoryStack IDs distinct. Call `memory_session_start` with the external Claude Code session/thread ID, the current absolute `cwd`, and known agent context. Retain the returned MemoryStack `session_id` for checkpoints, reads, and finalization.

Before compaction, at a meaningful checkpoint, or when finishing a subtask, use `memory_checkpoint` with a compact verified summary, evidence, and `context.session_id` plus `context.agent_id`. Preserve `parent_agent_id`, `root_session_id`, `agent_type`, and task identifiers when supplied by the parent or runtime; never invent them. Checkpoints expire after seven days and do not enter normal durable recall.

A parent reads a child's checkpoints with `memory_retrieve_handoffs` for the server session and optional child agent ID, verifies the conclusion, and promotes only independently supported durable facts. Pass required scope and lineage in delegation instructions when the task already authorizes subagents. This skill does not itself request delegation.

Finalize only when the session's work is complete, with `memory_session_finalize`, a summary, and at most five durable facts. Do not finalize another agent's shared session at each child completion or on every turn. Read saved summaries with `memory_read_session`.

Capture file-dependent durable claims separately with `memory_write` and source receipts before finalization; the finalizer's string-only `durable_facts` cannot carry source bindings and remain unverified. Do not repeat those claims there. Checkpoints and session summaries are handoffs, not freshness-certified current code. A resumed agent revalidates relevant sources and starts with no `seen_context_tokens`; a parent's delivery receipt does not mean the child has read its content.

Inspect `ingestion_mode` and `retrieval_mode` warnings. An older backend may rewrite submitted records or omit checkpoints from its semantic fallback; success alone does not establish exact storage or complete recall.

Use `memory_create_handoff` only for registered MemoryStack service agents. Native Claude Code agent identifiers are not service-agent UUIDs; use checkpoints for native Claude Code handoffs. Do not copy prompts, private reasoning, transcripts, raw tool output, or secrets.

Use a compact handoff with Goal, Verified progress, Remaining work, Blockers, and Next action; omit empty fields. Keep evidence and available lineage in structured fields. Never manufacture missing identifiers or infer the current session from a process-global value. Durable facts remain reusable across sessions.

Checkpoint retries use the same `idempotency_key`; a replay preserves the original expiry. Finalization gives each durable fact a stable session-derived retry key and closes only after all facts are acknowledged. If finalization partially fails, retry the same facts and evidence rather than creating replacement records. Hooks emit lifecycle events, not semantic summaries; a successful hook is not proof that a checkpoint was captured.

Use the MemoryStack MCP tools supplied by this plugin, with target: "claude-code" for procedure discovery and expansion.
