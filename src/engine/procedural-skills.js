import { applicabilitySchema, taskContextSchema, validateTaskValue, USAGE_MODES } from './task-context.js';
import { normalizeStringArray } from "./control-plane.js";

export const PROCEDURE_TARGETS = new Set(["codex", "claude-code", "cursor", "mcp", "generic"]);

function required(value, field, maxLength) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new Error(`${field} must be a non-empty string of at most ${maxLength} characters`);
  }
  return value.trim();
}

function targets(value) {
  const normalized = normalizeStringArray(value, "targets", { maxItems: 5, itemMaxLength: 100 });
  const resolved = normalized.length ? normalized : ["generic"];
  for (const target of resolved) {
    if (!PROCEDURE_TARGETS.has(target)) {
      throw new Error(`targets contains unsupported adapter: ${target}`);
    }
  }
  return resolved;
}

/** Convert MCP arguments to the canonical cross-platform procedure payload. */
export function buildProcedurePayload(args) {
  if (args.applicability !== undefined) validateTaskValue(args.applicability, applicabilitySchema, 'applicability');
  if (args.task_kinds !== undefined) validateTaskValue(args.task_kinds, taskContextSchema.properties.task_kinds, 'task_kinds');
  if (args.components !== undefined) validateTaskValue(args.components, taskContextSchema.properties.components, 'components');
  if (args.knowledge_kind !== undefined && !['procedure', 'example'].includes(args.knowledge_kind)) throw new Error('Unsupported knowledge_kind');
  return {
    scope: args.scope,
    procedure: {
      name: required(args.name, "name", 200),
      summary: required(args.summary, "summary", 4_000),
      triggers: normalizeStringArray(args.triggers, "triggers", { maxItems: 30, itemMaxLength: 2_000 }),
      prerequisites: normalizeStringArray(args.prerequisites, "prerequisites", { maxItems: 30, itemMaxLength: 2_000 }),
      steps: normalizeStringArray(args.steps, "steps", { maxItems: 30, itemMaxLength: 2_000 }),
      verification: normalizeStringArray(args.verification, "verification", { maxItems: 30, itemMaxLength: 2_000 }),
      constraints: normalizeStringArray(args.constraints, "constraints", { maxItems: 30, itemMaxLength: 2_000 }),
      rollback: normalizeStringArray(args.rollback, "rollback", { maxItems: 30, itemMaxLength: 2_000 }),
      targets: targets(args.targets),
      ...(args.knowledge_kind !== undefined ? { knowledge_kind: args.knowledge_kind } : {}),
      ...(args.task_kinds !== undefined ? { task_kinds: args.task_kinds } : {}),
      ...(args.components !== undefined ? { components: args.components } : {}),
      ...(args.applicability !== undefined ? { applicability: args.applicability } : {}),
    },
    evidence: args.evidence,
    context: args.context,
    ...(args.based_on_version_id ? { based_on_version_id: required(args.based_on_version_id, "based_on_version_id", 36) } : {}),
  };
}

export function buildProcedureOutcomePayload(args) {
  const outcome = required(args.outcome, "outcome", 20);
  if (!new Set(["success", "failure", "neutral"]).has(outcome)) {
    throw new Error("outcome must be one of: success, failure, neutral");
  }
  const payload = {
    scope: args.scope,
    version_id: required(args.version_id, "version_id", 36),
    outcome,
    evidence: args.evidence,
  };
  if (args.observation !== undefined && args.observation !== null && args.observation !== "") {
    payload.observation = required(args.observation, "observation", 1_000);
  }
  if (args.idempotency_key !== undefined && args.idempotency_key !== null && args.idempotency_key !== "") {
    payload.idempotency_key = required(args.idempotency_key, "idempotency_key", 300);
  }
  if (args.usage_mode !== undefined) {
    if (!USAGE_MODES.includes(args.usage_mode)) throw new Error('Unsupported usage_mode');
    if (!['used_unchanged', 'used_with_adaptation'].includes(args.usage_mode) && outcome !== 'neutral') throw new Error('Unused or unverified procedures require a neutral outcome');
    if (outcome !== 'neutral' && !args.evidence?.length) throw new Error('Applied outcomes require verification evidence');
    payload.usage_mode = args.usage_mode;
  }
  if (args.task_context !== undefined) { validateTaskValue(args.task_context, taskContextSchema, 'task_context'); payload.task_context = args.task_context; }
  return payload;
}
