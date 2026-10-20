const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
function hook(event) {
  const result = spawnSync(process.execPath, ['plugin/scripts/lifecycle-hook.cjs'], {
    input: JSON.stringify(event), encoding: 'utf8', timeout: 4000,
    env: { ...process.env, MEMORYSTACK_API_KEY: '' },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
test('startup emits bounded guidance without prompt or transcript content', () => {
  const result = hook({ hook_event_name: 'SessionStart', cwd: process.cwd(), session_id: 'external-session', prompt: 'private prompt', transcript_path: '/private/transcript' });
  const text = result.hookSpecificOutput.additionalContext;
  assert.ok(text.length < 3000);
  assert.ok(!text.includes('private prompt'));
  assert.ok(!text.includes('/private/transcript'));
  assert.equal(JSON.parse(text).external_context.session_id, 'external-session');
});
test('subagent startup preserves supplied lineage without inventing IDs', () => {
  const result = hook({ hook_event_name: 'SubagentStart', cwd: process.cwd(), agent_id: 'child', parent_agent_id: 'parent' });
  const data = JSON.parse(result.hookSpecificOutput.additionalContext);
  assert.equal(data.external_context.agent_id, 'child');
  assert.equal(data.external_context.parent_agent_id, 'parent');
  assert.equal(data.external_context.root_session_id, undefined);
});
test('stop and compaction hooks do not ingest transcripts or block', () => {
  for (const event of ['Stop', 'SessionEnd', 'PreCompact', 'SubagentStop']) {
    assert.deepEqual(hook({ hook_event_name: event, cwd: process.cwd(), last_assistant_message: 'private output' }), {});
  }
});
test('invalid input fails open', () => {
  const result = spawnSync(process.execPath, ['plugin/scripts/lifecycle-hook.cjs'], { input: '{', encoding: 'utf8', timeout: 4000 });
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), {});
});
test('manifests use Claude paths without per-tool automatic ingestion', () => {
  const hooks = JSON.parse(fs.readFileSync('plugin/hooks/hooks.json')).hooks;
  assert.equal(hooks.PostToolUse, undefined);
  assert.equal(hooks.UserPromptSubmit, undefined);
  for (const entries of Object.values(hooks)) assert.ok(entries[0].hooks[0].command.includes('"${CLAUDE_PLUGIN_ROOT}/'));
  const mcp = JSON.parse(fs.readFileSync('plugin/.mcp.json'));
  assert.equal(mcp.mcpServers.memorystack.args[0], '${CLAUDE_PLUGIN_ROOT}/scripts/memory-server.mjs');
});
