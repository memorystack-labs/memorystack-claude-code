import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm, stat, utimes, mkdir, symlink, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSourceTracker, createFreshnessCheck, validateProcedureSources } from '../../src/engine/source-freshness.js';
import { markContextDelivery } from '../../src/engine/context-delivery.js';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'memory-source-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'code.ts'), 'export const mode = "old";\n');
  const args = { _sourceRoot: root, _policy: { context: { repo_id: 'project-test' } } };
  const tracker = createSourceTracker();
  const read = () => tracker.read({ ...args, path: 'code.ts' });
  const check = () => createFreshnessCheck({ root, repoId: 'project-test' });
  const bind = (receipt, kind = 'current_state', role = 'supporting') => tracker.bind({ kind, sources: [{ receipt_id: receipt.receipt_id, role }] }, args);
  return { root, args, tracker, read, check, bind };
}

test('edited current claims are withheld while historical rationale and patterns survive', async t => {
  const f = await fixture(t);
  const receipt = await f.read();
  assert.equal(receipt.content, 'export const mode = "old";\n');
  const bindings = await Promise.all(['current_state', 'historical', 'pattern'].map(kind => f.bind(receipt, kind)));
  assert.equal((await f.check().assess(bindings[0])).use, 'current_source');
  await writeFile(path.join(f.root, 'code.ts'), 'export const mode = "new";\n');
  const [current, historical, pattern] = await Promise.all(bindings.map(binding => f.check().assess(binding)));
  assert.equal(current.use, 'withhold');
  assert.equal(historical.use, 'historical_only');
  assert.equal(pattern.use, 'adapt_and_verify');
  assert.ok([current, historical, pattern].every(result => result.state === 'changed'));
  const hidden = await f.check().memory({ id: 'old', content: 'STALE ASSERTION', metadata: { source_context: bindings[0], copied: 'STALE ASSERTION' } });
  assert.equal(hidden.kind, 'stale_notice');
  assert.ok(!JSON.stringify(hidden).includes('STALE ASSERTION'));
});

test('receipt protects against binding a prior summary to a later file version', async t => {
  const f = await fixture(t);
  const receipt = await f.read();
  await writeFile(path.join(f.root, 'code.ts'), 'replacement');
  await assert.rejects(f.bind(receipt), /changed since it was read/);
  await assert.rejects(f.bind(receipt, 'pattern', 'required'), /changed since it was read/);
  const history = await f.bind(receipt, 'historical');
  assert.equal(history.sources[0].sha256, receipt.source.sha256);
  assert.equal((await f.check().assess(history)).use, 'historical_only');
});

test('same-size edits with restored mtime and repeated edits do not reuse cached hashes', async t => {
  const f = await fixture(t);
  const binding = await f.bind(await f.read());
  const file = path.join(f.root, 'code.ts');
  const previous = await stat(file);
  for (const value of ['new', 'two', 'old']) {
    await writeFile(file, `export const mode = "${value}";\n`);
    await utimes(file, previous.atime, previous.mtime);
    assert.equal((await f.check().assess(binding)).state, value === 'old' ? 'matching' : 'changed');
  }
});

test('missing or renamed files invalidate current claims but preserve historical evidence', async t => {
  const f = await fixture(t);
  const receipt = await f.read();
  const current = await f.bind(receipt), history = await f.bind(receipt, 'historical');
  await rename(path.join(f.root, 'code.ts'), path.join(f.root, 'renamed.ts'));
  assert.equal((await f.check().assess(current)).use, 'withhold');
  const historical = await f.check().assess(history);
  assert.equal(historical.use, 'historical_only');
  assert.equal(historical.checks[0].state, 'missing');
});

test('required dependencies constrain patterns separately from their supporting example', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, 'lock.txt'), 'library@1');
  const implementation = await f.read();
  const dependency = await f.tracker.read({ ...f.args, path: 'lock.txt' });
  const binding = await f.tracker.bind({ kind: 'pattern', sources: [
    { receipt_id: implementation.receipt_id, role: 'supporting' }, { receipt_id: dependency.receipt_id, role: 'required' },
  ] }, f.args);
  await writeFile(path.join(f.root, 'code.ts'), 'refactored example');
  assert.equal((await f.check().assess(binding)).use, 'adapt_and_verify');
  await writeFile(path.join(f.root, 'lock.txt'), 'library@2');
  assert.equal((await f.check().assess(binding)).use, 'background_only');
});

test('receipts are workspace-bound, bounded, expiring and cannot be invented', async t => {
  const f = await fixture(t);
  const receipt = await f.read();
  const refs = { kind: 'current_state', sources: [{ receipt_id: receipt.receipt_id, role: 'required' }] };
  await assert.rejects(f.tracker.bind(refs, { ...f.args, _sourceRoot: `${f.root}-another` }), /another workspace/);
  await assert.rejects(createSourceTracker().bind(refs, f.args), /expired, unknown/);
  let now = Date.now();
  const expiring = createSourceTracker({ now: () => now });
  const short = await expiring.read({ ...f.args, path: 'code.ts' });
  now += 3_600_001;
  await assert.rejects(expiring.bind({ ...refs, sources: [{ receipt_id: short.receipt_id, role: 'required' }] }, f.args), /expired/);
  await writeFile(path.join(f.root, 'large.txt'), 'x'.repeat(32001));
  await assert.rejects(f.tracker.read({ ...f.args, path: 'large.txt', max_chars: 32000 }), /exceeds max_chars/);
  await assert.rejects(f.tracker.read({ ...f.args, path: 'code.ts', start_line: 99 }), /outside the file/);
  await assert.rejects(f.tracker.bind({ kind: 'current_state', sources: [] }, f.args), /requires 1/);
});

test('paths cannot escape the root through traversal, absolute paths or junctions', async t => {
  const f = await fixture(t);
  for (const sourcePath of ['../../src/engine/code.ts', '/etc/passwd', 'C:/secret', 'dir\\secret', './code.ts', 'a//b']) {
    await assert.rejects(f.tracker.read({ ...f.args, path: sourcePath }), /workspace-relative/);
  }
  const outside = await mkdtemp(path.join(tmpdir(), 'memory-outside-test-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(path.join(outside, 'private.txt'), 'private');
  await symlink(outside, path.join(f.root, 'external'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.tracker.read({ ...f.args, path: 'external/private.txt' }), /outside the workspace/);
});

test('legacy, independent, malformed and cross-repository records are never certified by accident', async t => {
  const f = await fixture(t);
  assert.equal((await f.check().memory({ content: 'legacy' })).freshness.state, 'unverified');
  const independent = await f.tracker.bind({ kind: 'independent' }, f.args);
  assert.equal((await f.check().assess(independent)).state, 'not_file_bound');
  const binding = await f.bind(await f.read());
  assert.equal((await createFreshnessCheck({ root: f.root, repoId: 'foreign' }).assess(binding)).use, 'withhold');
  assert.equal((await f.check().assess({ ...binding, sources: [] })).use, 'withhold');
  assert.equal((await f.check().assess({ ...binding, sources: [{ ...binding.sources[0], algorithm: 'unknown' }] })).use, 'withhold');
  await mkdir(path.join(f.root, 'directory'));
  await assert.rejects(f.tracker.read({ ...f.args, path: 'directory' }), /regular file/);
});

test('procedure checks use actual local file hashes instead of stale caller observations', async t => {
  const f = await fixture(t);
  const receipt = await f.read();
  const condition = { kind: 'file_hash', key: 'code.ts', value: receipt.source.sha256 };
  const item = { kind: 'procedure', definition: { steps: ['OLD STEPS'], applicability: { required: [condition] } } };
  const task = { observations: [{ condition, source: 'old read' }] };
  assert.equal((await validateProcedureSources(item, task, f.check())).applicability.state, 'confirmed');
  await writeFile(path.join(f.root, 'code.ts'), 'new implementation');
  const stale = await validateProcedureSources(item, task, f.check());
  assert.equal(stale.applicability.state, 'contradicted');
  assert.equal(stale.definition, undefined);
  const legacy = await validateProcedureSources({ applicability: { state: 'confirmed' } }, task, f.check());
  assert.equal(legacy.applicability.state, 'unknown');
  assert.equal((await validateProcedureSources(item, task, createFreshnessCheck())).applicability.state, 'unknown');
});

test('delivery suppression rechecks freshness and is bounded to the same workspace and context', async t => {
  const f = await fixture(t);
  const binding = await f.bind(await f.read());
  const record = { id: 'm1', scope: 'project:test', content: 'Current implementation', metadata: { source_context: binding } };
  const first = markContextDelivery([await f.check().memory(record)], f.args)[0];
  const args = { ...f.args, seen_context_tokens: [first.context_token] };
  assert.equal(markContextDelivery([await f.check().memory(record)], args)[0].kind, 'already_in_context');
  await writeFile(path.join(f.root, 'code.ts'), 'different code');
  const changed = markContextDelivery([await f.check().memory(record)], args)[0];
  assert.equal(changed.kind, 'stale_notice');
  assert.notEqual(changed.context_token, first.context_token);
  assert.equal(markContextDelivery([first], { ...args, _sourceRoot: 'other-worktree' })[0].kind, undefined);
  assert.throws(() => markContextDelivery([], { seen_context_tokens: ['invalid'] }), /seen_context_tokens/);
});

test('another worktree in the same project validates its own bytes and check limits stay unknown', async t => {
  const f = await fixture(t);
  const receipt = await f.read();
  const binding = await f.bind(receipt);
  const otherRoot = path.join(f.root, 'other-worktree');
  await mkdir(otherRoot);
  await writeFile(path.join(otherRoot, 'code.ts'), 'another branch');
  assert.equal((await createFreshnessCheck({ root: otherRoot, repoId: 'project-test' }).assess(binding)).use, 'withhold');
  const check = f.check();
  for (let index = 0; index < 32; index++) assert.equal((await check.inspect(`missing-${index}.ts`)).state, 'missing');
  assert.equal((await check.assess(binding)).use, 'withhold');
  assert.equal((await check.assess(binding)).state, 'unverified');
});
