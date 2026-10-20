const { readStdin, writeOutput } = require('./lib/stdin');
async function main() {
  const input = await readStdin();
  if (!['SessionStart', 'SubagentStart'].includes(input.hook_event_name)) return writeOutput({});
  const { resolveScopePolicy } = await import('./engine/scope-policy.js');
  const policy = resolveScopePolicy({ cwd: input.cwd });
  const lineage = {};
  for (const key of ['session_id', 'agent_id', 'agent_type', 'parent_agent_id', 'root_session_id']) {
    if (typeof input[key] === 'string') lineage[key] = input[key].slice(0, 200);
  }
  const guidance = {
    write_scope: policy.write_scope, read_scopes: policy.read_scopes,
    external_context: lineage,
    guidance: 'For substantial work use the coding-memory-bootstrap skill and bounded task recall with current cwd and target claude-code. Resolve the MemoryStack server session separately from this external session ID. Reuse context already available; revalidate source-bound facts after edits. Before compaction or subagent completion, checkpoint verified progress with supplied lineage. Store only verified durable facts; propose reusable procedures for review. Never upload raw transcripts, prompts, private reasoning, or secrets. Hooks provide guidance only; semantic capture requires MCP tools and skills.'
  };
  writeOutput({ hookSpecificOutput: { hookEventName: input.hook_event_name, additionalContext: JSON.stringify(guidance) } });
}
main().catch(() => writeOutput({}));
