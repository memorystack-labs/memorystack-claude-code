import test from 'node:test';
import assert from 'node:assert/strict';
import { createActiveContext, contentHash } from '../../src/engine/active-context.js';
import { createFreshnessCheck } from '../../src/engine/source-freshness.js';
import { markContextDelivery } from '../../src/engine/context-delivery.js';
import { validateProvenance } from '../../src/engine/provenance.js';

const args = { _sourceRoot: '/workspace', _policy: { context: { repo_id: 'repo' }, read_scopes: ['project:a'] } };
async function fixture(options) {
  const registry = createActiveContext(options), check = createFreshnessCheck();
  const record = await check.memory({ id: 'm1', scope: 'project:a', content: 'An unverified assertion', metadata: {} });
  const result = registry.remember({ results: markContextDelivery([record], args) }, args);
  const token = result.results[0].context_token;
  let rows = [{ id: record.id, scope: record.scope, content_sha256: contentHash(record.content), metadata: record.metadata }];
  const validate = (extra = {}, request = async () => ({ version: 1, results: rows })) => registry.validate({ ...args, context_tokens: [token], ...extra }, { sourceCheck: check, request });
  return { registry, result, token, validate, setRows: value => { rows = value; } };
}
test('unchanged is not promoted to verified; validation does not repeat content', async () => {
  const f = await fixture(); const response = await f.validate();
  assert.equal(response.results[0].state, 'unchanged');
  assert.equal(response.results[0].freshness.use, 'verify_before_use');
  assert.ok(!JSON.stringify(response).includes('An unverified assertion'));
});
test('correction, deletion or access revocation invalidates held context', async () => {
  const f = await fixture(); f.setRows([]);
  assert.equal((await f.validate()).results[0].state, 'invalidated');
});
test('changed text invalidates even without a changed source receipt', async () => {
  const f = await fixture(); f.setRows([{ id: 'm1', scope: 'project:a', content_sha256: contentHash('changed'), metadata: {} }]);
  assert.equal((await f.validate()).results[0].state, 'invalidated');
});
test('outage, expiry and another workspace never validate old context', async () => {
  let time = 0; const f = await fixture({ now: () => time, ttl: 10 });
  assert.equal((await f.validate({}, async () => { throw new Error('offline'); })).results[0].state, 'unavailable');
  assert.equal((await f.validate({ _sourceRoot: '/other' })).results[0].state, 'recall_required');
  time = 11;
  assert.equal((await f.validate()).results[0].state, 'recall_required');
});
test('unknown and procedure tokens require recall, and request size is bounded', async () => {
  const f = await fixture();
  assert.equal((await f.validate({ context_tokens: ['0'.repeat(64)] })).results[0].state, 'recall_required');
  await assert.rejects(f.validate({ context_tokens: [] }));
  await assert.rejects(f.validate({ context_tokens: Array.from({ length: 51 }, (_, i) => i.toString(16).padStart(64, '0')) }));
});
test('provenance cannot assert service trust or omit test coverage', () => {
  assert.throws(() => validateProvenance({ attestation: 'server_verified' }));
  assert.throws(() => validateProvenance({ verification: 'test_result' }));
  assert.throws(() => validateProvenance({ origin: 'external_material' }));
  assert.throws(() => validateProvenance({ parent_memory_ids: ['fake'] }));
  assert.deepEqual(validateProvenance({ origin: 'external_material', reference: 'issue 12' }), { origin: 'external_material', reference: 'issue 12' });
});
