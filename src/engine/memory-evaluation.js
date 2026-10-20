// This scores measured paired runs. It does not manufacture a baseline from
// retrieved characters or treat delivery as successful application.
export function evaluateRuns(runs) {
  if (!Array.isArray(runs) || !runs.length) throw new Error('Supply measured paired runs');
  const pairs = new Map(), stages = { capture: 0, retrieval: 0, application: 0 };
  for (const run of runs) {
    for (const key of ['task_id', 'model', 'revision', 'environment', 'judge_reference', 'evidence_reference'])
      if (typeof run[key] !== 'string' || !run[key].trim()) throw new Error(`Missing ${key}`);
    if (!['baseline', 'memory'].includes(run.mode) || typeof run.accepted !== 'boolean') throw new Error('Invalid run mode or acceptance');
    for (const key of ['input_tokens', 'output_tokens', 'cached_input_tokens', 'elapsed_ms'])
      if (!Number.isSafeInteger(run[key]) || run[key] < 0) throw new Error(`Missing measured ${key}`);
    if (run.cached_input_tokens > run.input_tokens) throw new Error('Cached tokens are a subset of input tokens');
    if (run.total_cost_usd !== null && (typeof run.total_cost_usd !== 'number' || !Number.isFinite(run.total_cost_usd) || run.total_cost_usd < 0)) throw new Error('Cost must include all attempts and memory overhead, or be null');
    if (run.mode === 'memory' && run.cost_includes_memory_overhead !== true) throw new Error('Account for retrieval, storage and amortized capture cost');
    if (run.temporal_isolation_verified !== true) throw new Error('Future knowledge leakage must be excluded');
    if (run.failure_stage !== null && !Object.hasOwn(stages, run.failure_stage)) throw new Error('failure_stage must be capture, retrieval, application, or null');
    if (run.accepted && run.failure_stage !== null) throw new Error('Accepted runs cannot declare a failure stage');
    if (run.mode === 'memory' && run.failure_stage) stages[run.failure_stage]++;
    const key = JSON.stringify([run.task_id, run.model, run.revision, run.environment, run.judge_reference]);
    if (!pairs.has(key)) pairs.set(key, {});
    if (pairs.get(key)[run.mode]) throw new Error('Duplicate run; use distinct task IDs for replicates');
    pairs.get(key)[run.mode] = run;
  }
  if ([...pairs.values()].some(pair => !pair.baseline || !pair.memory)) throw new Error('Each task needs matched baseline and memory runs');
  const summarize = mode => {
    const values = [...pairs.values()].map(pair => pair[mode]);
    const accepted = values.filter(run => run.accepted).length;
    const totalCost = values.every(run => run.total_cost_usd !== null) ? values.reduce((sum, run) => sum + run.total_cost_usd, 0) : null;
    const sum = key => values.reduce((total, run) => total + run[key], 0);
    return { tasks: values.length, accepted, acceptance_rate: accepted / values.length,
      input_tokens: sum('input_tokens'), cached_input_tokens: sum('cached_input_tokens'), output_tokens: sum('output_tokens'), elapsed_ms: sum('elapsed_ms'),
      total_cost_usd: totalCost, cost_per_accepted_task_usd: accepted && totalCost !== null ? totalCost / accepted : null };
  };
  const baseline = summarize('baseline'), memory = summarize('memory');
  return { baseline, memory, memory_failure_stages: stages,
    observed_cost_reduction_fraction: baseline.cost_per_accepted_task_usd > 0 && memory.cost_per_accepted_task_usd !== null
      ? 1 - memory.cost_per_accepted_task_usd / baseline.cost_per_accepted_task_usd : null,
    policy: 'Observed paired sample only; no causal or population claim. Assess acceptance, latency and cost together. Evidence references and isolation are operator attestations, not independently verified by this scorer.' };
}
