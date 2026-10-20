import assert from "node:assert/strict";
import test from "node:test";
import { buildProcedureOutcomePayload, buildProcedurePayload } from "../../src/engine/procedural-skills.js";

test("creates a portable procedure candidate payload", () => {
  const payload = buildProcedurePayload({
    scope: "project:memory",
    name: "Investigate retrieval regressions",
    summary: "Measure each stage before changing the pipeline.",
    triggers: ["retrieval becomes slow"],
    steps: ["Capture a baseline", "Isolate the slow stage"],
    verification: ["Run focused tests"],
    targets: ["codex", "mcp", "codex"],
  });

  assert.deepEqual(payload.procedure.targets, ["codex", "mcp"]);
  assert.deepEqual(payload.procedure.steps, ["Capture a baseline", "Isolate the slow stage"]);
});

test("does not allow an outcome to pretend to be a mutation", () => {
  const payload = buildProcedureOutcomePayload({
    scope: "project:memory",
    version_id: "00000000-0000-4000-8000-000000000001",
    outcome: "failure",
    observation: "The verification command was stale.",
    idempotency_key: "run:42",
  });

  assert.deepEqual(payload, {
    scope: "project:memory",
    version_id: "00000000-0000-4000-8000-000000000001",
    outcome: "failure",
    evidence: undefined,
    observation: "The verification command was stale.",
    idempotency_key: "run:42",
  });
  assert.throws(() => buildProcedureOutcomePayload({ version_id: "x", outcome: "promote" }), /outcome must be one of/);
});


test('attributes non-use separately from verified application', () => {
  const base = { version_id: '00000000-0000-4000-8000-000000000001', outcome: 'success' };
  assert.throws(() => buildProcedureOutcomePayload({ ...base, usage_mode: 'inspected_not_used' }), /neutral/);
  assert.throws(() => buildProcedureOutcomePayload({ ...base, usage_mode: 'used_unchanged' }), /evidence/);
  const result = buildProcedureOutcomePayload({ ...base, outcome: 'neutral', usage_mode: 'inapplicable', task_context: { task_kinds: ['feature'] } });
  assert.equal(result.usage_mode, 'inapplicable');
  assert.deepEqual(result.task_context.task_kinds, ['feature']);
});
