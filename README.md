# MemoryStack for Claude Code

Version 0.3.0 uses the same scoped coding-memory engine as the Codex integration, adapted for Claude Code. This is a memory integration; it does not change Claude Code's inference provider or route prompts to OpenAI.

## Install

Add this repository as a Claude Code plugin marketplace, then install memorystack-claude-code. The marketplace entry points at plugin/. Node.js 18 or later must be available.

Set MEMORYSTACK_API_KEY in the environment inherited by Claude Code. Existing credentials saved in ~/.memorystack-claude/credentials.json are also supported. Restart Claude Code after changing installed plugin files or its inherited environment. Never commit credentials.

The plugin includes a bundled stdio MCP server, so an installed marketplace copy does not need npm install. Contributors run npm ci, npm run build, then npm test.

## Memory workflow

- At substantial task start or resumption, the bootstrap skill resolves the actual workspace and retrieves a small relevant context set.
- Facts and procedure descriptors share a bounded recall budget. Expand only relevant approved procedures with target claude-code.
- Source-bound facts are rehashed locally. Current-code claims, historical explanations, and adaptable patterns have different freshness policies. Validate previously used facts after edits; matching bytes alone do not prove an inference correct.
- Write verified durable facts with evidence. Use proposals for unverified knowledge, temporary checkpoints for progress, and reviewed procedural memory for reusable workflows.
- Map the external Claude session ID to a MemoryStack server session. Preserve supplied subagent lineage; checkpoints are temporary and do not enter ordinary durable recall.

These operations are agent-driven through the MCP tools and skills. Hooks provide compact startup/subagent guidance; they do not guarantee semantic recall or capture. Stop, subagent-stop, compaction and session-end hooks do not upload transcripts. Avoid starting a new semantic memory call after every tool or trivial prompt.

## Project identity and hierarchy

Use the actual absolute working directory in memory tool calls, not the plugin installation directory. Project is the default write destination. User, team and organization layers require explicit configuration and intended audience. They are logical partitions within the API key's authorized backend project, not additional permissions.

A repository can contain .memorystack.json with project_id and scopes, for example:

    { "project_id": "billing-service", "scopes": { "project": "project:billing-service", "org": "org:acme" } }

Only configure organization/user layers that should participate in that repository's recall. Without configuration the shared engine derives a local project identity. Worktrees share repository identity. Cross-machine sharing requires an explicit stable project identity.

## Upgrade from 0.2

The previous personal-path and remote-basename scope scheme is not automatically merged into the new scopes. Review ownership before deliberately querying or migrating legacy records; repositories with the same basename could collide in the old scheme. Existing saved credentials are reused. Existing legacy CLI scripts remain for compatibility but are not the supported freshness-aware path; current skills use MCP tools.

Old hooks are replaced: broad startup profile injection, keyword-triggered per-prompt retrieval, per-tool capture, and transcript-based Stop/SessionEnd extraction are no longer registered. No existing backend memories are deleted. User-level hook entries installed outside this plugin must be removed separately if they still invoke old scripts.

## Implementation provenance

src/engine/ is a vendored snapshot of the local memorystack-plugin/server version 0.5.0 snapshot (2026-10-20). UPSTREAM.json records original file hashes. Claude adaptations in index.js change adapter attribution, context metadata, legacy default label and procedure target defaults. Keep shared policy logic aligned with upstream and run the copied engine regression suite when updating it.

The distributable is plugin/scripts/memory-server.mjs plus lifecycle-hook.cjs, plugin/.mcp.json, hooks and skills. npm run build regenerates bundled scripts. No new database migration is required by this adapter update; advanced functions require the already deployed coding-memory backend endpoints.

## Limits and validation

The 65 regression tests exercise the packaged MCP server with a local mock backend and temporary workspaces, including writes, source changes, held-context invalidation, procedure applicability and checkpoint retries.

A live smoke test on 2026-10-20 used Claude Code 2.1.79 with Ollama Cloud gemma4:31b-cloud in a disposable workspace. Its event trace confirmed a successful SessionStart hook, a connected plugin MCP server, and successful memory_resolve_scope, memory_read_source (SHA-256 receipt), and bounded memory_retrieve_task_context calls against production. The test was read-only and returned no matching memories; live writes, cross-session recall and automatic skill selection remain separate acceptance checks. No Claude subscription was used.

Token savings and accuracy improvements require measured task benchmarks; the plugin does not promise a fixed percentage. Claude Code's displayed cost estimate is not authoritative Ollama billing.

Official lifecycle and manifest references: https://code.claude.com/docs/en/hooks and https://code.claude.com/docs/en/plugins-reference.
