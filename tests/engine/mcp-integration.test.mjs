import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { once } from "node:events";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { contentHash } from '../../src/engine/active-context.js';

const serverPath = process.env.MEMORYSTACK_TEST_SERVER || fileURLToPath(new URL("../../src/engine/index.js", import.meta.url));
async function setup(t, { roots = [], failScope, oldBackend = false, zeroAck = false, failFactOnce } = {}) {
  let failedFact = false;
  const records = [];
  const received = [];
  const root = mkdtempSync(path.join(tmpdir(), "memorystack-mcp-"));
  const a = path.join(root, "a"); const b = path.join(root, "b");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(a); mkdirSync(b);
  writeFileSync(path.join(a, ".memorystack.json"), JSON.stringify({ project_id: "a", scopes: { user: "user:owner", org: "org:acme" } }));
  writeFileSync(path.join(b, ".memorystack.json"), JSON.stringify({ project_id: "b" }));
  const server = http.createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    const url = new URL(req.url, "http://localhost");
    received.push({ adapter: req.headers["x-memorystack-adapter"], method: req.method, path: url.pathname, body, scope: url.searchParams.get("agent_id") });
    let result = { success: true };
    let status = 200;
    if (url.pathname.endsWith("/auth/session")) { status = 503; }
    else if (url.pathname.endsWith("/procedural-skills/task-context")) {
      if (oldBackend || body.scope === failScope) { status = oldBackend ? 404 : 403; result = { error: 'unavailable' }; }
      else {
        const item = { kind: 'example', skill_id: '11111111-1111-4111-8111-111111111111', version_id: '22222222-2222-4222-8222-222222222222', version: 1,
          name: 'Beta auth example', summary: 'Resolve access', applicability: { state: 'unknown' },
          ...(body.selected ? { definition: { steps: ['Check access'], verification: ['Returning users reach dashboard'] } } : {}),
        };
        result = { mode: body.selected ? 'details' : 'discovery', results: body.scope === 'project:a' && !body.seen_version_ids.includes(item.version_id) ? [item] : [], unavailable: [], budget: { omitted_eligible_records: 0 } };
      }
    }
    else if (url.pathname.endsWith('/procedural-skills') && req.method === 'POST') {
      result = { success: true, status: 'candidate', ...(oldBackend ? {} : { definition_schema_version: 2 }) };
    }
    else if (url.pathname.endsWith('/outcomes')) {
      result = { success: true, ...(oldBackend ? {} : { attribution: 'recorded' }) };
    }
    else if (url.pathname.endsWith("/procedural-skills")) {
      const scope = url.searchParams.get("scope");
      result = { skills: [
        { id: `${scope}-active`, status: "active", active_version: { status: "active", version: 1 } },
        { id: `${scope}-candidate`, status: "proposed", active_version: { status: "proposed", version: 2 } },
      ] };
    }
    else if (url.pathname.endsWith('/memories/coding-context')) {
      if (oldBackend) { status = 404; result = { error: 'not deployed' }; }
      else result = { version: 1, results: records.filter(record => body.ids.includes(record.id) && record.agent_id === body.scope && record.metadata.memory_control_plane.status === 'active')
        .map(record => ({ id: record.id, scope: record.agent_id, content_sha256: contentHash(record.content), metadata: record.metadata })) };
    }
    else if (url.pathname.endsWith('/memories/corrections')) {
      result = { success: true, correction: body };
      if (oldBackend) { status = 404; result = { error: 'not deployed' }; }
    }
    else if (url.pathname.endsWith("/memories/search")) {
      if (url.searchParams.get("agent_id") === failScope) status = 403;
      result = { results: records.filter(record => record.agent_id === url.searchParams.get("agent_id") && (!url.searchParams.get("session_id") || record.session_id === url.searchParams.get("session_id"))) };
    } else if (url.pathname.endsWith("/memories") && req.method === "POST") {
      const previous = body.idempotency_key && records.find(record => record.idempotency_key === body.idempotency_key && record.agent_id === body.agent_id);
      if (!failedFact && body.messages[0].content === failFactOnce) {
        failedFact = true; status = 503; result = { error: "simulated partial failure" };
      } else {
        if (!previous) records.push({ ...body, id: `memory-${records.length}`, content: body.messages[0].content });
        result = { success: true, memories_created: previous ? 0 : 1, memory_ids: [previous?.id ?? records.at(-1).id],
          ...(oldBackend ? {} : { provenance_schema_version: 1, ingestion_mode: 'canonical', idempotency: body.idempotency_key ? 'enforced' : 'not_requested', replayed: !!previous }) };
      }
      if (zeroAck) result = { success: true, memories_created: 0, memory_ids: [] };
    } else if (url.pathname.endsWith("/checkpoints")) {
      const sessionId = url.pathname.split('/').at(-2);
      result = { results: records.filter(record => record.session_id === sessionId && record.agent_id === url.searchParams.get('scope')) };
      if (oldBackend) { status = 404; result = { error: 'not found' }; }
    } else if (url.pathname.endsWith("/sessions") && req.method === "POST") result = { success: true, session_id: "mapped-session" };
    else if (url.pathname.includes("/sessions/") && req.method === "GET") result = { session: { metadata: { handoff_summary: "saved" } } };
    res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(result));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const client = new Client({ name: "test", version: "1" }, { capabilities: { roots: {} } });
  let rootPaths = roots.map(value => value === "a" ? a : value === "b" ? b : value);
  client.setRequestHandler(ListRootsRequestSchema, async () => ({ roots: rootPaths.map(value => ({ uri: pathToFileURL(value).href })) }));
  const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath], env: {
    ...process.env, MEMORYSTACK_API_KEY: "mock-test-only", MEMORYSTACK_BASE_URL: `http://127.0.0.1:${server.address().port}/api/v1`,
    MEMORYSTACK_SCOPE: "codex-default", MEMORYSTACK_WORKSPACE_ROOT: "", MEMORYSTACK_PROJECT_SCOPE: "", MEMORYSTACK_PROJECT_ID: "",
    MEMORYSTACK_USER_SCOPE: "", MEMORYSTACK_TEAM_SCOPE: "", MEMORYSTACK_ORG_SCOPE: "",
  }, stderr: "pipe" });
  t.after(async () => { await client.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); rmSync(root, { recursive: true, force: true }); });
  await client.connect(transport);
  const call = async (name, args) => {
    const response = await client.callTool({ name, arguments: args });
    const text = response.content.find(item => item.type === "text")?.text;
    if (response.isError) return { error: text };
    return JSON.parse(text);
  };
  return { call, records, received, a, b, setRoots: value => { rootPaths = value; } };
}

test("MCP calls isolate concurrent projects and reject ambiguous workspace roots", async t => {
  const f = await setup(t, { roots: ["a", "b"] });
  assert.match((await f.call("memory_write", { content: "unscoped" })).error, /Multiple workspace roots/);
  await Promise.all([f.call("memory_write", { cwd: f.a, content: "A fact" }), f.call("memory_write", { cwd: f.b, content: "B fact" })]);
  assert.deepEqual(f.records.map(record => record.agent_id).sort(), ["project:a", "project:b"]);
  const [a, b] = await Promise.all([f.call("memory_retrieve_context", { cwd: f.a, query: "fact" }), f.call("memory_retrieve_context", { cwd: f.b, query: "fact" })]);
  assert.deepEqual(a.results.map(record => record.content), ["A fact"]);
  assert.deepEqual(b.results.map(record => record.content), ["B fact"]);
});

test("hierarchy reads filter proposals and transient records while user writes remain explicit", async t => {
  const f = await setup(t, { roots: ["a"] });
  await f.call("memory_write", { content: "Project fact" });
  await f.call("memory_write", { content: "Personal preference", memory_level: "user" });
  await f.call("memory_write", { content: "Unverified", status: "proposed" });
  const result = await f.call("memory_retrieve_context", { query: "context" });
  assert.deepEqual(result.scopes, ["project:a", "org:acme", "user:owner"]);
  assert.deepEqual(result.results.map(record => record.content), ["Project fact", "Personal preference"]);
  assert.equal(f.records.find(record => record.content === "Personal preference").agent_id, "user:owner");
  assert.match((await f.call("memory_write", { cwd: f.b, memory_level: "org", content: "wrong" })).error, /Cannot resolve/);
});

test("subagent checkpoints preserve lineage and require an explicit handoff read", async t => {
  const f = await setup(t, { roots: ["a"] });
  for (const agent_id of ["reviewer", "tester"]) await f.call("memory_checkpoint", {
    summary: `${agent_id} verified result`, context: { session_id: "session-1", agent_id, parent_agent_id: "parent", root_session_id: "root" },
    evidence: [{ type: "test", id: `${agent_id}-test` }],
  });
  assert.equal((await f.call("memory_retrieve_context", { query: "result" })).count, 0);
  const result = await f.call("memory_retrieve_handoffs", { session_id: "session-1", agent_id: "reviewer" });
  assert.equal(result.count, 1);
  assert.equal(result.retrieval_mode, "exact_session");
  assert.equal(result.results[0].metadata.memory_control_plane.context.parent_agent_id, "parent");
  assert.equal((await f.call("memory_retrieve_handoffs", { session_id: "other-session" })).count, 0);
  assert.equal(f.records[0].metadata.memory_control_plane.retention, "ephemeral");
});

test("old backend fallback explicitly reports non-exact writes and potentially incomplete checkpoint recall", async t => {
  const f = await setup(t, { roots: ["a"], oldBackend: true });
  const saved = await f.call("memory_checkpoint", { summary: "Verified output", context: { session_id: "s", agent_id: "child" } });
  assert.equal(saved.ingestion_mode, "extracted");
  assert.ok(saved.warnings.length);
  const result = await f.call("memory_retrieve_handoffs", { session_id: "s" });
  assert.equal(result.retrieval_mode, "semantic_fallback");
  assert.ok(result.warnings.some(warning => warning.includes("may omit checkpoints")));
});

test("zero-record acknowledgements are surfaced as failed persistence", async t => {
  const f = await setup(t, { roots: ["a"], zeroAck: true });
  assert.match((await f.call("memory_write", { content: "fact" })).error, /did not acknowledge a persisted/);
});

test("summary metadata is persisted before close on old servers and scoped session identity is stable", async t => {
  const f = await setup(t, { roots: ["a"] });
  const started = await f.call("memory_session_start", { session_id: "codex-external", context: { agent_id: "codex-child" } });
  assert.equal(started.session_id, "mapped-session");
  assert.equal(f.received.find(request => request.path.endsWith("/sessions")).body.agent_id, "project:a");
  await f.call("memory_session_finalize", { session_id: started.session_id, summary: "Preserve this handoff", durable_facts: ["Verified fact"] });
  const patches = f.received.filter(request => request.method === "PATCH");
  assert.equal(patches[0].body.metadata.handoff_summary, "Preserve this handoff");
  assert.equal(patches[0].body.action, undefined);
  assert.equal(patches[1].body.action, "close");
  assert.equal((await f.call("memory_read_session", { session_id: started.session_id })).session.metadata.handoff_summary, "saved");
});

test("optional scope denial is visible without losing project context", async t => {
  const f = await setup(t, { roots: ["a"], failScope: "org:acme" });
  await f.call("memory_write", { content: "Project fact" });
  const result = await f.call("memory_retrieve_context", { query: "fact" });
  assert.equal(result.count, 1);
  assert.ok(result.warnings.includes("Scope org:acme is unavailable"));
});

test("approved procedures are retrieved across configured layers without admitting candidates", async t => {
  const f = await setup(t, { roots: ["a"] });
  const result = await f.call("memory_list_active_procedures", { limit: 8 });
  assert.deepEqual(result.scopes, ["project:a", "org:acme", "user:owner"]);
  assert.equal(result.count, 3);
  assert.ok(result.skills.every(skill => skill.status === "active" && skill.active_version.status === "active"));
});

test("bounded recall skips large metadata and measures only delivered records", async t => {
  const f = await setup(t, { roots: ["a"] });
  await f.call("memory_write", { content: "large metadata", metadata: { padding: "x".repeat(3000) } });
  await f.call("memory_write", { content: "exact Na2S Δ" });
  const result = await f.call("memory_retrieve_context", { query: "fact", max_context_chars: 2000 });
  assert.deepEqual(result.results.map(record => record.content), ["exact Na2S Δ"]);
  assert.equal(result.budget.delivered_chars, JSON.stringify(result.results, null, 2).length);
  assert.equal(result.budget.omitted_eligible_records, 1);
  assert.equal(result.results[0].metadata.memory_control_plane.context.session_id, undefined);
  assert.match((await f.call("memory_retrieve_context", { query: "fact", max_context_chars: 1999 })).error, /max_context_chars/);
});

test("partial finalization retries reuse fact keys and close only after acknowledgement", async t => {
  const f = await setup(t, { roots: ["a"], failFactOnce: "Second verified fact" });
  const args = { session_id: "session-1", summary: "Finished", durable_facts: ["First verified fact", "Second verified fact"], context: { agent_id: "parent" } };
  assert.match((await f.call("memory_session_finalize", args)).error, /partial failure/);
  assert.equal(f.received.filter(r => r.body?.action === "close").length, 0);
  const result = await f.call("memory_session_finalize", args);
  assert.equal(result.durable_facts_created[0].replayed, true);
  assert.equal(f.records.length, 2);
  assert.equal(f.received.filter(r => r.body?.action === "close").length, 1);
});

test("old backends cannot silently claim retry-safe finalization", async t => {
  const f = await setup(t, { roots: ["a"], oldBackend: true });
  const result = await f.call("memory_session_finalize", { session_id: "s", summary: "done", durable_facts: ["fact"] });
  assert.match(result.error, /retry safety is unconfirmed/);
  assert.equal(f.received.filter(r => r.body?.action === "close").length, 0);
});

test("checkpoint retries preserve original expiry and do not count as new writes", async t => {
  const f = await setup(t, { roots: ["a"] });
  const args = { summary: "verified progress", idempotency_key: "checkpoint-1", context: { session_id: "s", agent_id: "child" } };
  const first = await f.call("memory_checkpoint", args);
  const expiry = f.records[0].metadata.memory_control_plane.expires_at;
  const replay = await f.call("memory_checkpoint", args);
  assert.equal(first.idempotency, "enforced");
  assert.equal(replay.replayed, true);
  assert.equal(replay.memories_created, 0);
  assert.equal(f.records.length, 1);
  assert.equal(f.records[0].metadata.memory_control_plane.expires_at, expiry);
});


test("task tools combine facts and descriptors under one budget and load only selected versions", async t => {
  const f = await setup(t, { roots: ["a"] });
  await f.call('memory_write', { content: 'Returning users have an account' });
  const task = { goal: 'Fix beta routing', kinds: ['debug'] };
  const result = await f.call('memory_retrieve_task_context', { task, max_context_chars: 2000 });
  assert.deepEqual(result.results.map(item => item.kind), ['example', 'fact']);
  assert.equal(result.incomplete, false);
  assert.equal(result.budget.delivered_chars, JSON.stringify(result.results, null, 2).length);
  assert.ok(result.budget.delivered_chars <= 2000);
  assert.equal(result.results[0].definition, undefined);
  const { skill_id, version_id, scope } = result.results[0];
  const details = await f.call('memory_expand_task_context', { task, selected: [{ skill_id, version_id, scope }] });
  assert.deepEqual(details.results[0].definition.steps, ['Check access']);
  assert.equal(details.results[0].projection, undefined);
  const seen = await f.call('memory_retrieve_task_context', { task, seen_version_ids: [version_id] });
  assert.deepEqual(seen.results.map(item => item.kind), ['example', 'fact']);
  assert.ok(seen.warnings.some(warning => warning.includes('seen_context_tokens')));
  const deduped = await f.call('memory_retrieve_task_context', { task, seen_context_tokens: [result.results[0].context_token] });
  assert.deepEqual(deduped.results.map(item => item.kind), ['already_in_context', 'fact']);
  const invalid = await f.call('memory_expand_task_context', { task, selected: [{ skill_id, version_id, scope: 'project:foreign' }] });
  assert.match(invalid.error, /resolved read scopes/);
});

test('source-bound capture and task recall preserve history without delivering outdated current claims', async t => {
  const f = await setup(t, { roots: ['a'] });
  const file = path.join(f.a, 'account.ts');
  writeFileSync(file, 'export const library = "old-library";\n');
  const receipt = await f.call('memory_read_source', { path: 'account.ts' });
  assert.equal(receipt.content, 'export const library = "old-library";\n');
  assert.equal(f.received.some(request => JSON.stringify(request.body).includes('export const library')), false);
  for (const [kind, content] of [['current_state', 'CURRENT ONLY'], ['historical', 'We chose the old library for its API'], ['pattern', 'The old implementation demonstrates adapter injection']]) {
    const saved = await f.call('memory_write', { content, source_context: { kind, sources: [{ receipt_id: receipt.receipt_id, role: 'supporting' }] } });
    assert.equal(saved.success, true);
  }
  assert.ok(f.records.every(record => record.metadata.source_context.sources[0].sha256 === receipt.source.sha256));
  const before = await f.call('memory_retrieve_context', { query: 'library' });
  assert.equal(before.results[0].freshness.use, 'current_source');
  const tokens = before.results.map(record => record.context_token);
  const held = await f.call('memory_validate_context', { context_tokens: tokens });
  assert.ok(held.results.every(record => record.state === 'unchanged'));
  const repeated = await f.call('memory_retrieve_context', { query: 'library', seen_context_tokens: before.results.map(record => record.context_token) });
  assert.ok(repeated.results.every(record => record.kind === 'already_in_context'));
  writeFileSync(file, 'export const library = "new-library";\n');
  const rechecked = await f.call('memory_validate_context', { context_tokens: tokens });
  assert.equal(rechecked.results[0].state, 'invalidated');
  assert.equal(rechecked.results[1].state, 'usage_changed');
  assert.equal(rechecked.results[1].freshness.use, 'historical_only');
  assert.equal(rechecked.results[2].freshness.use, 'adapt_and_verify');
  assert.ok(!JSON.stringify(rechecked).includes('CURRENT ONLY'));
  const result = await f.call('memory_retrieve_task_context', { task: { goal: 'Implement another integration' } });
  assert.ok(!JSON.stringify(result.results).includes('CURRENT ONLY'));
  assert.ok(result.results.some(record => record.kind === 'stale_notice'));
  assert.equal(result.results.find(record => record.content?.startsWith('We chose')).freshness.use, 'historical_only');
  assert.equal(result.results.find(record => record.content?.startsWith('The old')).freshness.use, 'adapt_and_verify');
  const staleWrite = await f.call('memory_write', { content: 'Misbound claim', source_context: { kind: 'current_state', sources: [{ receipt_id: receipt.receipt_id, role: 'required' }] } });
  assert.match(staleWrite.error, /changed since it was read/);
  assert.equal(f.records.length, 3);
  assert.match((await f.call('memory_write', { content: 'fake', metadata: { source_context: {} } })).error, /reserved/);
  assert.equal(result.budget.delivered_chars, JSON.stringify(result.results, null, 2).length);
});

test('new memory controls survive MCP dispatch and fail conservatively on an older backend', async t => {
  const f = await setup(t, { roots: ['a'], oldBackend: true });
  const saved = await f.call('memory_write', { content: 'Attributed observation', provenance: {
    verification: 'test_result', checks: [{ command: 'npm test', result: 'passed', coverage: 'unit tests' }],
  } });
  assert.ok(saved.warnings.some(warning => warning.includes('provenance')));
  assert.equal(f.records[0].metadata.provenance.verification, 'test_result');
  const result = await f.call('memory_retrieve_context', { query: 'observation' });
  const validation = await f.call('memory_validate_context', { context_tokens: result.results.map(record => record.context_token) });
  assert.equal(validation.results[0].state, 'unavailable');
  assert.match((await f.call('memory_write', { content: 'forged', metadata: { knowledge_provenance: {} } })).error, /reserved/);
  const correction = await f.call('memory_correct', { old_id: '11111111-1111-4111-8111-111111111111',
    replacement_id: '22222222-2222-4222-8222-222222222222', old_content_sha256: 'a'.repeat(64), replacement_content_sha256: 'b'.repeat(64),
    reason: 'verified correction', idempotency_key: 'correction-1' });
  assert.ok(correction.error);
  assert.equal(f.received.find(item => item.path.endsWith('/memories/corrections')).body.scope, 'project:a');
});

test('file observations are stripped before remote discovery so stale values cannot hide candidates', async t => {
  const f = await setup(t, { roots: ['a'] });
  await f.call('memory_retrieve_task_context', { task: { goal: 'Review code', observations: [
    { condition: { kind: 'file_hash', key: 'account.ts', value: 'a'.repeat(64) }, source: 'prior turn' },
    { condition: { kind: 'dependency_version', key: 'library', value: '1' }, source: 'lockfile' },
  ] } });
  const request = f.received.find(request => request.path.endsWith('/procedural-skills/task-context'));
  assert.deepEqual(request.body.task.observations.map(item => item.condition.kind), ['dependency_version']);
});

test("task search distinguishes unavailable infrastructure from no matching knowledge", async t => {
  const f = await setup(t, { roots: ['a'], oldBackend: true });
  const result = await f.call('memory_retrieve_task_context', { task: { goal: 'Beta auth' } });
  assert.equal(result.count, 0); assert.equal(result.incomplete, true);
  assert.ok(result.warnings.some(item => item.includes('backend deployment')));
  const reads = () => f.received.filter(item => item.path.endsWith('/task-context') || item.path.endsWith('/memories/search')).length;
  const calls = reads();
  assert.match((await f.call('memory_retrieve_task_context', { task: { goal: 'x', transcript: 'unexpected' } })).error, /unsupported/);
  assert.equal(reads(), calls);
});

test("task retrieval counts one delivered response and keeps unavailable hierarchy layers visible", async t => {
  const f = await setup(t, { roots: ['a'], failScope: 'org:acme' });
  await f.call('memory_retrieve_task_context', { task: { goal: 'Beta auth' } });
  // Telemetry is asynchronous; wait for the mock to receive the event.
  for (let n = 0; n < 30 && !f.received.some(r => r.body?.event_type === 'context_retrieved'); n++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(f.received.filter(r => r.body?.event_type === 'context_retrieved').length, 1);
  const result = await f.call('memory_retrieve_task_context', { task: { goal: 'Beta auth' } });
  assert.equal(result.incomplete, true); assert.ok(result.warnings.some(item => item.includes('org:acme')));
});


test('older backends cannot silently claim example metadata or attributed outcome persistence', async t => {
  const f = await setup(t, { roots: ['a'], oldBackend: true });
  const proposed = await f.call('memory_propose_procedure', { name: 'Beta routing', summary: 'Returning account routing', steps: ['Resolve access'], verification: ['Check redirects'], knowledge_kind: 'example' });
  assert.ok(proposed.warnings.some(item => item.includes('definition storage')));
  const outcome = await f.call('memory_record_procedure_outcome', { skill_id: '11111111-1111-4111-8111-111111111111', version_id: '22222222-2222-4222-8222-222222222222', outcome: 'neutral', usage_mode: 'inspected_not_used' });
  assert.ok(outcome.warnings.some(item => item.includes('outcome attribution')));
});


test('Claude distribution attributes requests and defaults procedural recall to claude-code', async t => {
  const f = await setup(t, { roots: ['a'] });
  const result = await f.call('memory_retrieve_task_context', { task: { goal: 'Understand billing' }, limit: 3 });
  assert.equal(result.error, undefined);
  const discovery = f.received.find(row => row.path.endsWith('/procedural-skills/task-context'));
  assert.equal(discovery.body.target, 'claude-code');
  assert.equal(discovery.adapter, 'claude-code');
});
