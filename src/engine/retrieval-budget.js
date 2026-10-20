export function getContextBudget(value = 16_000) {
  if (!Number.isInteger(value) || value < 2_000 || value > 64_000) {
    throw new Error("max_context_chars must be an integer between 2000 and 64000");
  }
  return value;
}

// Measure the actual pretty-printed tool result representation, including metadata.
// Keep records intact: clipping technical text can silently change its meaning.
export function selectContext(records, { limit, maxChars }) {
  const results = [];
  for (const record of records) {
    if (results.length >= limit) break;
    if (JSON.stringify([...results, record], null, 2).length <= maxChars) results.push(record);
  }
  return {
    results,
    budget: { max_context_chars: maxChars, delivered_chars: JSON.stringify(results, null, 2).length,
      omitted_eligible_records: records.length - results.length },
  };
}
