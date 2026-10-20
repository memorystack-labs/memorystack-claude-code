import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRuns } from '../../src/engine/memory-evaluation.js';
const base = { task_id: 'fixture', model: 'same-model', revision: 'same-revision', environment: 'same-env',
  judge_reference: 'tests:fixture', evidence_reference: 'synthetic:test-only', accepted: true,
  input_tokens: 1000, cached_input_tokens: 300, output_tokens: 100, elapsed_ms: 1000,
  total_cost_usd: 1, temporal_isolation_verified: true, failure_stage: null };
const pair = () => [{ ...base, mode: 'baseline' }, { ...base, mode: 'memory', cost_includes_memory_overhead: true, total_cost_usd: 0.5 }];
test('cost scorer includes failures in cost per accepted task, and reports quality separately', () => {
  const first = pair(), second = pair().map(run => ({ ...run, task_id: 'second' }));
  second[1].accepted = false; second[1].failure_stage = 'application';
  const report = evaluateRuns([...first, ...second]);
  assert.equal(report.memory.acceptance_rate, 0.5);
  assert.equal(report.observed_cost_reduction_fraction, 0);
  assert.equal(report.memory_failure_stages.application, 1);
});
test('missing billing is unknown, not zero or a fabricated saving', () => {
  const runs = pair(); runs[1].total_cost_usd = null;
  assert.equal(evaluateRuns(runs).observed_cost_reduction_fraction, null);
});
test('rejects unmatched runs, leakage, fake cached counts and missing overhead accounting', () => {
  assert.throws(() => evaluateRuns(pair().slice(0, 1)));
  for (const patch of [{ revision: 'other' }, { temporal_isolation_verified: false }, { cached_input_tokens: 2000 },
    { cost_includes_memory_overhead: false }, { total_cost_usd: undefined }, { evidence_reference: '' }]) {
    const runs = pair(); Object.assign(runs[1], patch); assert.throws(() => evaluateRuns(runs));
  }
});
