---
name: procedural-memory-governance
description: Propose, retrieve, evaluate, and review portable reusable coding procedures stored in MemoryStack. Use when a verified workflow may help future coding tasks, when an existing procedure has new evidence or repeated failures, or when a user asks to create, update, retire, or reuse a skill across Claude Code, Claude Code, Cursor, MCP, or another IDE.
---

# Procedural Memory Governance

MemoryStack is the canonical source. Claude Code, Claude Code, Cursor, and MCP/IDE
instructions are adapter-specific projections tagged with the canonical skill
ID and version. Never treat a copied `SKILL.md` as the source of truth.

## Retrieve before reuse

1. Resolve the current workspace with `memory_resolve_scope` and call `memory_retrieve_task_context` with the same `cwd` and a concise goal, task kinds, and affected components. Expand only selected descriptors with `memory_expand_task_context`. Explicit broader destinations require a configured layer; scope labels never grant backend access.
2. Use only returned active versions. Verify material repository facts before
   acting; a procedure guides work but cannot override current code or user
   instructions.
3. Task expansion returns a structured definition. If the user requests native skill installation, use the existing export/projection workflow and preserve its canonical ID and version; do not claim the discovery descriptor is an installed skill.

## Propose a procedure

Propose only after a workflow has been verified. Include a concise name and
summary, at least one concrete step and verification, relevant triggers,
constraints, rollback instructions when the change is risky, supported
adapter targets, and source evidence such as a test, commit, incident, or
benchmark. Use `memory_propose_procedure`.

For one verified implementation that provides useful context, set `knowledge_kind: example`. Record what was built, relevant components, checks, and evidence without claiming the approach is universally reusable. Use `knowledge_kind: procedure` for a verified repeatable workflow. Both remain candidates until reviewed. Do not store an unverified hypothesis, secret, raw prompt, or private user content.

Include `task_kinds` and `components` for discovery. Add `applicability.required` or `excluded` conditions only when supported by evidence: exact dependency versions, file/symbol hashes, or file existence. These are exact matches, not semantic-version ranges. For `file_hash`, use the raw-byte SHA-256 returned by `memory_read_source`, with its workspace-relative path as the key. The Claude Code adapter checks file hashes/existence locally at retrieval; dependency-version and symbol observations remain caller evidence. Keep limitations that cannot be expressed this way in prerequisites/constraints. Missing checks require review; conflicts prevent current reuse.

Do not make a generalized procedure depend on the exact bytes of an incidental example. Bind actual prerequisites; preserve historical rationale or a reusable implementation idea separately as a `historical` or `pattern` memory with supporting receipts. A changed example is a reason to adapt and verify, not proof that the underlying pattern is wrong. A matching source hash is not proof that the pattern generalizes. Never revise or approve an active procedure merely to clear a freshness conflict.

## Improve safely

After meaningful application or inspection of an active procedure, call `memory_record_procedure_outcome`
with a compact result, evidence, a stable retry key, and `usage_mode`: `used_unchanged`, `used_with_adaptation`, `inspected_not_used`, `inapplicable`, or `insufficient_evidence`. Non-use requires a neutral outcome; applied success/failure requires verification evidence. Include concise `task_context` (task kinds, components, known repository revision) for attribution. Retrieval alone is never success, and a successful task does not prove that a retrieved procedure helped. Record outcomes only when they add useful evidence, not after every command. A repeated-failure
recommendation may justify a new candidate revision or a retirement review.

Never rewrite, publish, replace, or delete an active procedure yourself. New
information creates a candidate version. An authenticated owner or organization
administrator promotes it; retirement withdraws the active projection while
preserving every version, outcome, and provenance record.

## Keep it portable

Use the common procedure shape for every target: triggers, prerequisites,
steps, verification, constraints, rollback, and targets. Keep platform-only
setup in the adapter projection, not the canonical procedure. If a target has
no native skill format, retain the generic Markdown projection and its
canonical identifier. A `generic` target is the portable baseline and may be
rendered by every adapter.

A verified repeatable workflow may justify a proposal; a routine successful command does not. Check existing active procedures and relevant proposals before proposing an equivalent workflow. A proposal remains excluded from active instructions until the authorized review/promotion flow completes. Never infer approval from a hook event, subagent conclusion, or successful proposal write.

Re-expand a selected procedure after relevant edits or before executing an old plan; fact-token validation does not certify procedure applicability. Parent references, copied examples and repeated retrieval are not independent evidence. `memory_correct` applies to facts only and does not replace the procedure candidate/review lifecycle.

Use the MemoryStack MCP tools supplied by this plugin, with target: "claude-code" for procedure discovery and expansion.
