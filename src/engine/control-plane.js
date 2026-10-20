export const CONTROL_PLANE_SCHEMA_VERSION = "1.0";

const RECORD_TYPES = new Set(["fact", "episode", "recipe", "skill_candidate", "event"]);
const RECORD_STATUSES = new Set(["active", "proposed", "closed", "superseded", "invalid"]);
const CONTEXT_FIELDS = [
  "org_id",
  "team_id",
  "project_id",
  "session_id",
  "external_session_id",
  "conversation_id",
  "agent_id",
  "task_id",
  "repo_id",
  "user_id",
  "parent_agent_id",
  "root_session_id",
  "agent_type",
  "worktree_id",
  "git_branch",
  "git_commit",
];

function requireString(value, field, { maxLength = 8_000 } = {}) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} must be a non-empty string`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new Error(`${field} must be at most ${maxLength} characters`);
  }
  return normalized;
}

function optionalString(value, field, { maxLength = 1_000 } = {}) {
  if (value === undefined || value === null || value === "") return undefined;
  return requireString(value, field, { maxLength });
}

export function normalizeStringArray(value, field, { maxItems = 20, itemMaxLength = 500 } = {}) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new Error(`${field} must be an array with at most ${maxItems} items`);
  }

  return [...new Set(value.map((item) => requireString(item, field, { maxLength: itemMaxLength })) )];
}

export function normalizeContext(value) {
  if (value === undefined || value === null) return {};
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error("context must be an object");
  }

  const context = {};
  for (const field of CONTEXT_FIELDS) {
    const normalized = optionalString(value[field], `context.${field}`, { maxLength: 200 });
    if (normalized) context[field] = normalized;
  }
  return context;
}

/**
 * Keep the logical adapter scope stable for retrieval while mirroring the
 * session/team/conversation identifiers to first-class memory columns. The
 * caller's agent identifier stays in control-plane context: the `agent_id`
 * column is intentionally the scope partition used by this adapter.
 */
export function buildMemoryScoping(scope, context) {
  const normalized = normalizeContext(context);
  return {
    agent_id: requireString(scope, "scope", { maxLength: 300 }),
    team_id: normalized.team_id,
    session_id: normalized.session_id,
    conversation_id: normalized.conversation_id,
    context: normalized,
  };
}

export function normalizeEvidence(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 20) {
    throw new Error("evidence must be an array with at most 20 items");
  }

  return value.map((item, index) => {
    if (!item || Array.isArray(item) || typeof item !== "object") {
      throw new Error(`evidence[${index}] must be an object`);
    }
    const evidence = {
      type: requireString(item.type, `evidence[${index}].type`, { maxLength: 100 }),
      id: requireString(item.id, `evidence[${index}].id`, { maxLength: 500 }),
    };
    const url = optionalString(item.url, `evidence[${index}].url`, { maxLength: 2_000 });
    if (url) evidence.url = url;
    return evidence;
  });
}

export function buildControlPlaneMetadata({
  recordType,
  status = "active",
  scope,
  context,
  tags,
  evidence,
  retention = "durable",
  expiresAt,
  extra = {},
} = {}) {
  if (!RECORD_TYPES.has(recordType)) {
    throw new Error(`record_type must be one of: ${[...RECORD_TYPES].join(", ")}`);
  }
  if (!RECORD_STATUSES.has(status)) {
    throw new Error(`status must be one of: ${[...RECORD_STATUSES].join(", ")}`);
  }

  const controlPlane = {
    schema_version: CONTROL_PLANE_SCHEMA_VERSION,
    record_type: recordType,
    status,
    scope: requireString(scope, "scope", { maxLength: 300 }),
    context: normalizeContext(context),
    tags: normalizeStringArray(tags, "tags"),
    evidence: normalizeEvidence(evidence),
    retention: retention === "ephemeral" ? "ephemeral" : "durable",
    recorded_at: new Date().toISOString(),
  };

  const normalizedExpiry = optionalString(expiresAt, "expires_at", { maxLength: 100 });
  if (normalizedExpiry) controlPlane.expires_at = normalizedExpiry;

  return {
    ...extra,
    memory_control_plane: controlPlane,
  };
}

export function getControlPlaneMetadata(memory) {
  const metadata = memory?.metadata;
  if (!metadata || Array.isArray(metadata) || typeof metadata !== "object") return {};
  const controlPlane = metadata.memory_control_plane;
  return controlPlane && !Array.isArray(controlPlane) && typeof controlPlane === "object" ? controlPlane : {};
}

export function isRetrievable(memory, { includeEphemeral = false } = {}) {
  const controlPlane = getControlPlaneMetadata(memory);
  if (controlPlane.status && controlPlane.status !== "active") return false;
  if (controlPlane.record_type === "skill_candidate") return false;
  if (!includeEphemeral && (controlPlane.record_type === "event" || controlPlane.retention === "ephemeral")) {
    return false;
  }
  if (controlPlane.expires_at && (Number.isNaN(Date.parse(controlPlane.expires_at)) || Date.parse(controlPlane.expires_at) <= Date.now())) {
    return false;
  }
  return true;
}

export function dedupeMemories(memories) {
  const seen = new Set();
  return memories.filter((memory) => {
    const key = memory.id || `${memory.scope || ""}:${memory.content || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function createRecipeContent({ name, summary, triggers, steps, verification }) {
  const sections = [
    `Recipe candidate: ${requireString(name, "name", { maxLength: 200 })}`,
    `Summary: ${requireString(summary, "summary")}`,
  ];
  if (triggers.length) sections.push(`Triggers: ${triggers.join("; ")}`);
  if (steps.length) sections.push(`Steps: ${steps.map((step, index) => `${index + 1}. ${step}`).join(" ")}`);
  if (verification.length) sections.push(`Verification: ${verification.join("; ")}`);
  return sections.join("\n");
}

export function createSkillContent({ name, summary, targets, recipeId }) {
  const sections = [
    `Skill candidate: ${requireString(name, "name", { maxLength: 200 })}`,
    `Summary: ${requireString(summary, "summary")}`,
  ];
  if (targets.length) sections.push(`Targets: ${targets.join(", ")}`);
  if (recipeId) sections.push(`Derived from recipe: ${requireString(recipeId, "recipe_id", { maxLength: 500 })}`);
  return sections.join("\n");
}
