# Claude Code memory acceptance testing

Executed 2026-10-20 using Claude Code 2.1.79, Ollama Cloud gemma4:31b-cloud, the bundled plugin, and MemoryStack production. Test workspaces and memory scopes were disposable. No subscription to Claude was used.

## Verified

- Plugin and marketplace manifest validation.
- 65 bundled-server regression tests, including source policy, path safety, held-context changes, correction/revocation handling, hierarchy, procedure applicability and retry contracts.
- Real Claude SessionStart command hook returned success (exit 0); plugin MCP connection was connected.
- Actual Claude MCP calls resolved the fixture scope, read a source excerpt with a SHA-256 receipt, and retrieved bounded task context.
- A Claude process wrote a test-only independent fact. A separate Claude process, without the answer in its prompt, recalled the exact verification word from persisted memory.
- Production canonical writes for current_state, historical and pattern facts; idempotent retry acknowledged as replay.
- Production recall returned all three test facts; repeated delivery used already_in_context references.
- After a source edit, fresh recall withheld obsolete current-state content and retained historical_only and adapt_and_verify context.
- New MCP process recalled persisted records. An independent scope returned no test facts.
- Server session mapping, child checkpoint retrieval and session finalization succeeded.
- All created fact and checkpoint records were deleted by exact ID; deletion responses were HTTP 200. Closed test session metadata remains as an audit record.

## Production deployment gap

POST /api/v1/memories/coding-context returned HTTP 405. memory_validate_context therefore returned unavailable for held fact tokens. This is conservative behavior, but live reauthorization/invalidation cannot be marked passed until that backend route is deployed. Fresh recall source rehashing works. The same route-dependent validation logic passes against the regression backend.

## Coverage limits

The hosted-model tests used explicit bounded test instructions; they do not prove automatic skill selection for arbitrary prompts. Subagent lineage/checkpoint contracts were tested directly and in regression tests, not by spawning a live Claude subagent. Context compaction and every supported Claude hook event were not triggered in a live conversation. Semantic recall against large mixed datasets and token/cost savings need separate benchmarks. No global plugin installation, publication or deployment was performed.
