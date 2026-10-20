import test from "node:test";
import assert from "node:assert/strict";
import { getContextBudget, selectContext } from "../../src/engine/retrieval-budget.js";

test("budgets include metadata, preserve complete records, and skip oversized matches", () => {
  const records = [{ id: "large", content: "small", metadata: { data: "x".repeat(3000) } },
    { id: "project", content: "exact Δ text" }, { id: "org", content: "policy" }];
  const selected = selectContext(records, { limit: 8, maxChars: 2000 });
  assert.deepEqual(selected.results, records.slice(1));
  assert.equal(selected.budget.delivered_chars, JSON.stringify(selected.results, null, 2).length);
  assert.ok(selected.budget.delivered_chars <= 2000);
  assert.equal(selected.budget.omitted_eligible_records, 1);
});

test("count limit and byte-independent character budget are enforced", () => {
  assert.equal(getContextBudget(), 16000);
  for (const value of [0, 1999, 64001, 2.5, null]) assert.throws(() => getContextBudget(value));
  const result = selectContext([{ content: "a" }, { content: "b" }], { limit: 1, maxChars: 2000 });
  assert.equal(result.results.length, 1);
  assert.equal(result.budget.omitted_eligible_records, 1);
});
