import fetch from "node-fetch";
import { createHash } from "node:crypto";
import { retrieveTaskContext, taskProfileSchema, applicabilitySchema, taskContextSchema, TASK_KINDS, USAGE_MODES } from './task-context.js';
import { getContextBudget, selectContext } from "./retrieval-budget.js";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import {
  buildControlPlaneMetadata,
  buildMemoryScoping,
  createRecipeContent,
  createSkillContent,
  dedupeMemories,
  getControlPlaneMetadata,
  isRetrievable,
  normalizeContext,
  normalizeEvidence,
  normalizeStringArray,
} from "./control-plane.js";
import { buildProcedureOutcomePayload, buildProcedurePayload, PROCEDURE_TARGETS } from "./procedural-skills.js";
import { createSessionAuthenticator, getRequestAuthHeaders } from "./session-auth.js";
import { resolveScopePolicy, MEMORY_LEVELS } from "./scope-policy.js";
import { createSourceTracker, createFreshnessCheck, sourceContextSchema, validateProcedureSources } from './source-freshness.js';
import { markContextDelivery, seenContextSchema, validateSeenContext } from './context-delivery.js';
import { createActiveContext, contentHash } from './active-context.js';
import { provenanceSchema, validateProvenance } from './provenance.js';

const sourceTracker = createSourceTracker();
const activeContext = createActiveContext();
const freshnessFor = args => createFreshnessCheck({ root: args._sourceRoot, repoId: args._policy?.context.repo_id });

function loadLocalEnvironment() {
  const envFile = new URL("./.env", import.meta.url);
  if (!existsSync(envFile)) return;

  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (!match || match[1].startsWith("#")) continue;

    let [, key, value] = match;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key.startsWith("MEMORYSTACK_") && process.env[key] === undefined) process.env[key] = value;
  }
}

loadLocalEnvironment();

const apiKey = process.env.MEMORYSTACK_API_KEY?.trim();
const defaultScope = process.env.MEMORYSTACK_SCOPE?.trim() || "claude-code-default";

if (!apiKey) {
  process.stderr.write("MemoryStack MCP server requires MEMORYSTACK_API_KEY.\n");
  process.exit(1);
}

function normalizeBaseUrl(value) {
  const baseUrl = (value || "https://memorystack.app/api/v1").trim().replace(/\/$/, "");
  if (baseUrl.endsWith("/api/v1")) return baseUrl;
  if (baseUrl.endsWith("/api")) return `${baseUrl}/v1`;
  return `${baseUrl}/api/v1`;
}

const baseUrl = normalizeBaseUrl(process.env.MEMORYSTACK_BASE_URL);
const sessionAuthenticator = createSessionAuthenticator({ fetchImpl: fetch, baseUrl, apiKey });

function textResult(value, isError = false) {
  return {
    ...(isError ? { isError: true } : {}),
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
  };
}

async function request(path, options = {}) {
  const send = async (credential, isSessionTicket) => fetch(`${baseUrl}${path}`, {
      ...options,
      signal: options.signal ?? AbortSignal.timeout(8_000),
      headers: {
        ...getRequestAuthHeaders(credential, isSessionTicket),
        "Content-Type": "application/json",
        "X-MemoryStack-Adapter": "claude-code",
        ...options.headers,
      },
    });

  let response;
  try {
    const auth = await sessionAuthenticator.getCredential();
    response = await send(auth.credential, auth.isSessionTicket);

    // A rotated signing secret or an expired ticket must not make a task fail.
    // Clear it and retry exactly once with the opaque API key.
    if (response.status === 401 && auth.isSessionTicket) {
      sessionAuthenticator.clearTicket();
      response = await send(apiKey, false);
    }
  } catch (error) {
    throw new Error(`MemoryStack request failed: ${error.message}`);
  }

  const body = await response.text();
  let data;
  try {
    data = body ? JSON.parse(body) : {};
  } catch {
    data = { raw: body };
  }
  if (!response.ok) {
    throw Object.assign(new Error(data.details || data.error || `MemoryStack returned HTTP ${response.status}`), { status: response.status, code: data.code });
  }
  return data;
}

function estimateTokens(value) {
  return Math.ceil(JSON.stringify(value).length / 4);
}

function reportTelemetry(payload) {
  // Observability is intentionally best effort. It must never delay retrieval,
  // writes, or session handoffs when the control plane is unavailable.
  void request("/observability/coding-memory/events", {
    method: "POST",
    body: JSON.stringify(payload),
  }).catch(() => {});
}

function getScope(value) {
  if (value === undefined || value === null || value === "") return defaultScope;
  if (typeof value !== "string" || !value.trim() || value.trim().length > 300) {
    throw new Error("scope must be a non-empty string of at most 300 characters");
  }
  return value.trim();
}

function getScopes(value, fallbackScope) {
  if (value === undefined || value === null) return [getScope(fallbackScope)];
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) {
    throw new Error("scopes must contain between 1 and 8 scope strings");
  }
  return [...new Set(value.map((scope) => getScope(scope)))];
}

function getLimit(value) {
  if (value === undefined || value === null) return 10;
  if (!Number.isInteger(value) || value < 1 || value > 50) {
    throw new Error("limit must be an integer between 1 and 50");
  }
  return value;
}

function getMetadata(value) {
  if (value === undefined || value === null) return {};
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error("metadata must be an object");
  }
  return value;
}

function normalizeMemory(memory, scope) {
  return {
    id: memory.id,
    content: memory.content,
    content_sha256: contentHash(memory.content),
    score: memory.rrf_score ?? memory.similarity ?? memory.score ?? null,
    source: memory.source ?? memory.source_type ?? null,
    metadata: memory.metadata ?? null,
    scope,
  };
}

async function searchScope({ query, scope, rawLimit, filters = {} }) {
  const params = new URLSearchParams({
    query,
    limit: String(rawLimit),
    mode: "hybrid",
    agent_id: scope,
  });
  if (filters.session_id) params.set("session_id", filters.session_id);
  if (filters.conversation_id) params.set("conversation_id", filters.conversation_id);
  if (filters.team_id) params.set("team_id", filters.team_id);
  if (filters.record_type) params.set("metadata", JSON.stringify({ memory_control_plane: { record_type: filters.record_type } }));
  if (filters.include_ephemeral) params.set("include_ephemeral", "true");
  const data = await request(`/memories/search?${params.toString()}`);
  const results = Array.isArray(data.results) ? data.results : [];
  return results.map((memory) => normalizeMemory(memory, scope));
}

async function searchMemory(args, { candidatesOnly = false, sourceCheck } = {}) {
  validateSeenContext(args.seen_context_tokens);
  if (typeof args.query !== "string" || !args.query.trim()) {
    throw new Error("query must be a non-empty string");
  }
  const limit = getLimit(args.limit);
  const scopes = getScopes(args.scopes, args.scope);
  const maxChars = getContextBudget(args.max_context_chars);
  const filters = {
    session_id: getOptionalString(args.session_id, "session_id", 200),
    conversation_id: getOptionalString(args.conversation_id, "conversation_id", 200),
    team_id: getOptionalString(args.team_id, "team_id", 200),
    ...(args._episodesOnly ? { record_type: "episode" } : {}),
    ...(args.include_ephemeral === true ? { include_ephemeral: true } : {}),
  };
  const includeEphemeral = args.include_ephemeral === true;
  const rawLimit = includeEphemeral ? limit : Math.min(50, Math.max(limit, limit * 5));
  const startedAt = Date.now();
  const matches = await Promise.allSettled(scopes.map((scope) => searchScope({ query: args.query.trim(), scope, rawLimit, filters })));
  if (matches[0].status === "rejected") throw matches[0].reason;
  const warnings = [...(args._policy?.warnings ?? [])];
  const layers = matches.map((match, index) => {
    if (match.status === "rejected") { warnings.push(`Scope ${scopes[index]} is unavailable`); return []; }
    return match.value.map(memory => ({ ...memory, scope_priority: index }));
  });
  const eligible = dedupeMemories(layers.flat())
    .filter((memory) => isRetrievable(memory, { includeEphemeral }))
    .filter(memory => !args._episodesOnly || getControlPlaneMetadata(memory).record_type === "episode")
    .filter(memory => !args.agent_id || getControlPlaneMetadata(memory).context?.agent_id === args.agent_id);
  // Reserve room for configured broader layers rather than letting the first project exhaust the budget.
  const ordered = [];
  const queues = scopes.map(scope => eligible.filter(memory => memory.scope === scope));
  while (queues.some(queue => queue.length)) {
    for (const queue of queues) { if (queue.length) ordered.push(queue.shift()); }
  }
  const check = sourceCheck ?? freshnessFor(args);
  const validated = [];
  for (const record of ordered) validated.push(await check.memory(record));
  if (candidatesOnly) return { results: validated, warnings, incomplete: matches.some(match => match.status === "rejected") };
  const { results, budget } = selectContext(markContextDelivery(validated, args), { limit, maxChars });
  if (ordered.length && !results.length) warnings.push("No eligible record fits max_context_chars; narrow the query or increase the budget.");

  reportTelemetry({
    event_type: "context_retrieved",
    scopes,
    result_count: results.length,
    retrieved_context_tokens_estimate: estimateTokens(results),
    client_latency_ms: Date.now() - startedAt,
  });

  return { scopes, filters, count: results.length, results, budget, warnings, precedence: "Scope priority is retrieval ordering, not authority to override user or repository instructions." };
}

async function writeRecord({
  content,
  idempotencyKey,
  scope,
  recordType,
  status,
  context,
  tags,
  evidence,
  retention,
  expiresAt,
  metadata,
  sourceBinding,
  provenance,
}) {
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("content must be a non-empty string");
  }
  if (idempotencyKey !== undefined && (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(idempotencyKey))) {
    throw new Error("idempotency_key must contain 1–200 letters, digits, dots, underscores, colons, or hyphens");
  }
  const resolvedScope = getScope(scope);
  if (Object.hasOwn(getMetadata(metadata), 'source_context')) throw new Error('metadata.source_context is reserved; use source_context with read receipts');
  for (const key of ['provenance', 'knowledge_provenance', 'correction']) if (Object.hasOwn(getMetadata(metadata), key)) throw new Error(`metadata.${key} is reserved; use the dedicated provenance or correction interface`);
  const memoryScoping = buildMemoryScoping(resolvedScope, context);
  const data = await request("/memories", {
    method: "POST",
    body: JSON.stringify({
      messages: [{ role: "user", content: content.trim() }],
      record_mode: "canonical",
      ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
      agent_id: memoryScoping.agent_id,
      ...(memoryScoping.team_id ? { team_id: memoryScoping.team_id } : {}),
      ...(memoryScoping.session_id ? { session_id: memoryScoping.session_id } : {}),
      ...(memoryScoping.conversation_id ? { conversation_id: memoryScoping.conversation_id } : {}),
      metadata: buildControlPlaneMetadata({
        recordType,
        status,
        scope: resolvedScope,
        context: memoryScoping.context,
        tags,
        evidence,
        retention,
        expiresAt,
        extra: { ...getMetadata(metadata), ...(sourceBinding ? { source_context: sourceBinding } : {}), ...(provenance ? { provenance } : {}) },
      }),
    }),
  });

  if (data.success === false || !Array.isArray(data.memory_ids) || data.memory_ids.length === 0) {
    throw new Error("Backend did not acknowledge a persisted memory record");
  }
  const result = {
    scope: resolvedScope,
    success: data.success ?? true,
    memory_ids: data.memory_ids ?? [],
    ...(data.ingestion_mode === 'canonical' ? { content_sha256: contentHash(content.trim()) } : {}),
    memories_created: data.memories_created ?? 0,
    created_at: data.created_at ?? null,
    ingestion_mode: data.ingestion_mode ?? "extracted",
    idempotency: data.idempotency ?? "unconfirmed",
    replayed: data.replayed === true,
    indexing: data.indexing ?? "unknown",
    ...(data.ingestion_mode === "canonical" ? {} : { warnings: ["Backend canonical-record support is not deployed; this server may re-extract or rewrite the supplied record."] }),
  };
  if (idempotencyKey && data.idempotency !== "enforced") {
    result.warnings = [...(result.warnings ?? []), "Backend did not acknowledge idempotency support; do not blindly retry this write."];
  }
  if (data.provenance_schema_version !== 1) result.warnings = [...(result.warnings ?? []), 'Backend provenance normalization is not acknowledged; do not treat stored confidence or source role as verified authority.'];
  if (!result.replayed) reportTelemetry({
    event_type: "memory_recorded",
    scopes: [resolvedScope],
    memories_created: result.memories_created,
    stored_content_tokens_estimate: estimateTokens(content.trim()),
  });
  return result;
}

async function writeMemory(args) {
  const metadata = { ...getMetadata(args.metadata) };
  if (Object.hasOwn(metadata, 'source_context')) throw new Error('metadata.source_context is reserved; use source_context with read receipts');
  const binding = await sourceTracker.bind(args.source_context, args);
  return writeRecord({
    sourceBinding: binding,
    provenance: validateProvenance(args.provenance),
    content: args.content,
    idempotencyKey: args.idempotency_key,
    scope: args.scope,
    recordType: "fact",
    status: args.status ?? "active",
    context: args.context,
    tags: args.tags,
    evidence: args.evidence,
    retention: "durable",
    metadata,
  });
}

async function recordEvent(args) {
  const eventType = typeof args.event_type === "string" ? args.event_type.trim() : "";
  if (!eventType || eventType.length > 200) {
    throw new Error("event_type must be a non-empty string of at most 200 characters");
  }
  const context = normalizeContext(args.context);
  const metadata = {
    ...getMetadata(args.metadata),
    event: {
      event_type: eventType,
      platform: typeof args.platform === "string" && args.platform.trim() ? args.platform.trim() : "unknown",
      session_id: context.session_id ?? null,
      agent_id: context.agent_id ?? null,
    },
  };

  return writeRecord({
    content: `Lifecycle event recorded: ${eventType}`,
    scope: args.scope,
    recordType: "event",
    context,
    tags: args.tags,
    evidence: args.evidence,
    retention: "ephemeral",
    expiresAt: args.expires_at ?? new Date(Date.now() + 7 * 86_400_000).toISOString(),
    metadata,
  });
}

function getOptionalString(value, field, maxLength = 4_000) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new Error(`${field} must be a non-empty string of at most ${maxLength} characters`);
  }
  return value.trim();
}

function getRequiredUuid(value, field) {
  const normalized = getOptionalString(value, field, 36);
  if (!normalized || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new Error(`${field} must be a UUID`);
  }
  return normalized;
}

async function startSession(args) {
  const sessionId = typeof args.session_id === "string" ? args.session_id.trim() : "";
  if (!sessionId || sessionId.length > 200) {
    throw new Error("session_id must be a non-empty string of at most 200 characters");
  }
  const context = { ...normalizeContext(args.context), external_session_id: sessionId };
  const task = getOptionalString(args.task, "task");
  const data = await request("/sessions", {
    method: "POST",
    body: JSON.stringify({
      title: task || `Codex session ${sessionId}`,
      external_session_id: sessionId,
      agent_id: getScope(args.scope),
      team_id: context.team_id,
      metadata: {
        ...getMetadata(args.metadata),
        adapter: "claude-code",
        external_session_id: sessionId,
        task_id: context.task_id,
        repo_id: context.repo_id,
        claude_code_context: { ...context, external_session_id: sessionId },
      },
    }),
  });
  return {
    success: data.success ?? true,
    session_id: data.session_id,
    external_session_id: sessionId,
    scope: getScope(args.scope),
  };
}

async function finalizeSession(args) {
  const sessionId = typeof args.session_id === "string" ? args.session_id.trim() : "";
  if (!sessionId || sessionId.length > 200) {
    throw new Error("session_id must be a non-empty string of at most 200 characters");
  }
  if (typeof args.summary !== "string" || !args.summary.trim()) {
    throw new Error("summary must be a non-empty string");
  }
  const durableFacts = normalizeStringArray(args.durable_facts, "durable_facts", { maxItems: 5, itemMaxLength: 4_000 });
  const context = { ...normalizeContext(args.context), session_id: sessionId };
  // Persist before close for compatibility with older servers that ignore close metadata.
  await request(`/sessions/${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      metadata: {
        ...getMetadata(args.metadata),
        adapter: "claude-code",
        handoff_summary: args.summary.trim(),
        task_id: context.task_id,
        repo_id: context.repo_id,
        claude_code_context: context,
      },
    }),
  });
  const facts = [];
  for (const content of durableFacts) {
    const receipt = await writeRecord({
      idempotencyKey: `finalize:${createHash("sha256").update(JSON.stringify([sessionId, getScope(args.scope), content])).digest("hex")}`,
      content,
      scope: args.scope,
      recordType: "fact",
      status: "active",
      context,
      tags: ["session-derived"],
      evidence: args.evidence,
      retention: "durable",
      metadata: args.metadata,
    });
    if (receipt.idempotency !== "enforced") throw new Error("Finalization fact persisted but retry safety is unconfirmed; reconcile records before retrying or closing.");
    facts.push(receipt);
  }
  const session = await request(`/sessions/${encodeURIComponent(sessionId)}`, {
    method: "PATCH", body: JSON.stringify({ action: "close" }),
  });
  return { session, durable_facts_created: facts };
}

async function checkpoint(args) {
  const summary = getOptionalString(args.summary, "summary", 4_000);
  if (!summary) throw new Error("summary is required");
  const context = normalizeContext(args.context);
  if (!context.session_id || !context.agent_id) throw new Error("Checkpoint requires context.session_id (MemoryStack ID) and context.agent_id (Codex agent ID)");
  return writeRecord({ content: summary, idempotencyKey: args.idempotency_key, scope: args.scope, recordType: "episode", status: "active", context,
    tags: ["checkpoint", "agent-handoff"], evidence: args.evidence, retention: "ephemeral",
    expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), metadata: { ...getMetadata(args.metadata), coding_expiry_policy: "checkpoint_7d" } });
}

async function retrieveHandoffs(args) {
  const id = getOptionalString(args.session_id, "session_id", 200);
  if (!id) throw new Error("session_id is required");
  const params = new URLSearchParams({ scope: getScope(args.scope), limit: String(getLimit(args.limit)) });
  const agent = getOptionalString(args.agent_id, "agent_id", 200);
  if (agent) params.set("agent_id", agent);
  try {
    const data = await request(`/sessions/${encodeURIComponent(id)}/checkpoints?${params}`);
    if (!Array.isArray(data.results)) throw new Error("Invalid checkpoint response");
    const results = data.results.map(memory => normalizeMemory(memory, args.scope))
      .filter(memory => isRetrievable(memory, { includeEphemeral: true }) && getControlPlaneMetadata(memory).record_type === "episode")
      .filter(memory => !agent || getControlPlaneMetadata(memory).context?.agent_id === agent);
    return { scopes: [args.scope], count: results.length, results, retrieval_mode: "exact_session", warnings: [] };
  } catch (error) {
    if (![404, 405].includes(error.status) || error.code) throw error;
    const fallback = await searchMemory({ ...args, query: args.query || "checkpoint handoff", include_ephemeral: true, _episodesOnly: true });
    fallback.warnings.push("Backend checkpoint listing is not deployed; semantic fallback may omit checkpoints.");
    return { ...fallback, retrieval_mode: "semantic_fallback" };
  }
}

async function createHandoff(args) {
  const context = normalizeContext(args.context);
  const fromAgentId = getRequiredUuid(args.from_agent_id, "from_agent_id");
  const toAgentId = getRequiredUuid(args.to_agent_id, "to_agent_id");
  if (fromAgentId === toAgentId) throw new Error("from_agent_id and to_agent_id must differ");
  const transferSummary = getOptionalString(args.transfer_summary, "transfer_summary", 1_000);
  if (!transferSummary) throw new Error("transfer_summary must be a non-empty string");
  const memoryIds = normalizeStringArray(args.memory_ids, "memory_ids", { maxItems: 20, itemMaxLength: 36 });
  for (const memoryId of memoryIds) getRequiredUuid(memoryId, "memory_ids item");

  const data = await request("/agents/handoff", {
    method: "POST",
    body: JSON.stringify({
      from_agent_id: fromAgentId,
      to_agent_id: toAgentId,
      session_id: args.session_id ?? context.session_id,
      conversation_id: args.conversation_id,
      transfer_summary: transferSummary,
      transfer_memories: args.transfer_memories !== false,
      ...(memoryIds.length ? { memory_ids: memoryIds } : {}),
      metadata: {
        ...getMetadata(args.metadata),
        adapter: "claude-code",
        task_id: context.task_id,
        repo_id: context.repo_id,
      },
    }),
  });
  return { ...data, scope: getScope(args.scope) };
}

async function proposeRecipe(args) {
  const triggers = normalizeStringArray(args.triggers, "triggers", { maxItems: 10 });
  const steps = normalizeStringArray(args.steps, "steps", { maxItems: 20, itemMaxLength: 2_000 });
  const verification = normalizeStringArray(args.verification, "verification", { maxItems: 10 });
  const tags = normalizeStringArray(args.tags, "tags");
  return writeRecord({
    content: createRecipeContent({ name: args.name, summary: args.summary, triggers, steps, verification }),
    scope: args.scope,
    recordType: "recipe",
    status: "proposed",
    context: args.context,
    tags: [...tags, "recipe-candidate"],
    evidence: args.evidence,
    retention: "durable",
    metadata: args.metadata,
  });
}

async function proposeSkill(args) {
  const targets = normalizeStringArray(args.targets, "targets", { maxItems: 10, itemMaxLength: 100 });
  const tags = normalizeStringArray(args.tags, "tags");
  const metadata = { ...getMetadata(args.metadata) };
  if (args.recipe_id !== undefined && args.recipe_id !== null) metadata.recipe_id = String(args.recipe_id).trim();
  return writeRecord({
    content: createSkillContent({ name: args.name, summary: args.summary, targets, recipeId: args.recipe_id }),
    scope: args.scope,
    recordType: "skill_candidate",
    status: "proposed",
    context: args.context,
    tags: [...tags, "skill-candidate"],
    evidence: args.evidence,
    retention: "durable",
    metadata,
  });
}

async function proposeProcedure(args) {
  const payload = buildProcedurePayload(args);
  payload.scope = getScope(payload.scope);
  payload.context = normalizeContext(args.context);
  payload.evidence = normalizeEvidence(args.evidence);
  const receipt = await request("/procedural-skills", { method: "POST", body: JSON.stringify(payload) });
  if (["knowledge_kind", "task_kinds", "components", "applicability"].some(key => payload.procedure[key] !== undefined) && receipt.definition_schema_version !== 2) {
    receipt.warnings = [...(receipt.warnings ?? []), "Backend did not acknowledge task-aware definition storage; inspect the saved candidate before retrying or using it."];
  }
  return receipt;
}

function getProcedureTarget(value) {
  const target = value === undefined || value === null || value === "" ? "claude-code" : getOptionalString(value, "target", 100);
  if (!PROCEDURE_TARGETS.has(target)) {
    throw new Error(`target must be one of: ${[...PROCEDURE_TARGETS].join(", ")}`);
  }
  return target;
}

async function listActiveProcedures(args) {
  const scopes = args._policy?.read_scopes ?? [getScope(args.scope)];
  const target = getProcedureTarget(args.target);
  const limit = getLimit(args.limit);
  const responses = await Promise.allSettled(scopes.map(scope => {
    const params = new URLSearchParams({ scope, target, limit: String(limit) });
    return request(`/procedural-skills?${params.toString()}`);
  }));
  if (responses[0].status === "rejected") throw responses[0].reason;
  const warnings = [];
  const skills = [];
  const seen = new Set();
  responses.forEach((response, index) => {
    if (response.status === "rejected") { warnings.push(`Scope ${scopes[index]} is unavailable`); return; }
    for (const skill of response.value.skills ?? []) {
      if (skill.status !== "active" || skill.active_version?.status !== "active" || seen.has(skill.id)) continue;
      seen.add(skill.id);
      skills.push({ ...skill, scope: scopes[index], scope_priority: index });
    }
  });
  const check = freshnessFor(args);
  const validated = [];
  for (const skill of skills.slice(0, limit)) {
    const result = await validateProcedureSources({ definition: skill.active_version.definition }, { observations: [] }, check);
    validated.push(result.kind === 'stale_notice'
      ? { id: skill.id, scope: skill.scope, kind: 'stale_notice', applicability: result.applicability }
      : { ...skill, applicability: result.applicability });
  }
  return { success: true, target, scopes, count: validated.length, skills: validated, warnings,
    retrieval_policy: "Active versions only; scope ordering does not override user or repository instructions." };
}

async function recordProcedureOutcome(args) {
  const skillId = getRequiredUuid(args.skill_id, "skill_id");
  const payload = buildProcedureOutcomePayload(args);
  getRequiredUuid(payload.version_id, "version_id");
  payload.scope = getScope(payload.scope);
  payload.evidence = normalizeEvidence(args.evidence);
  const receipt = await request(`/procedural-skills/${encodeURIComponent(skillId)}/outcomes`, { method: "POST", body: JSON.stringify(payload) });
  if ((args.usage_mode !== undefined || args.task_context !== undefined) && receipt.attribution !== "recorded") {
    receipt.warnings = [...(receipt.warnings ?? []), "Backend did not acknowledge outcome attribution; this event must not be treated as evidence of attributed reuse."];
  }
  return receipt;
}

async function listScopes() {
  const data = await request("/memories?limit=100&order=desc");
  const memories = Array.isArray(data.results) ? data.results : (Array.isArray(data.data) ? data.data : []);
  const scopes = new Set([defaultScope]);
  for (const memory of memories) {
    const scope = memory.agent_id || getControlPlaneMetadata(memory).scope || memory.metadata?.scope || memory.metadata?.scope_id;
    if (typeof scope === "string" && scope) scopes.add(scope);
  }
  return { scopes: [...scopes].sort() };
}

async function getObservability(args) {
  const params = new URLSearchParams();
  if (args.scope !== undefined && args.scope !== null && args.scope !== "") {
    params.set("scope", getScope(args.scope));
  }
  if (args.days !== undefined && args.days !== null) {
    if (!Number.isInteger(args.days) || args.days < 1 || args.days > 90) {
      throw new Error("days must be an integer between 1 and 90");
    }
    params.set("days", String(args.days));
  }
  return request(`/observability/coding-memory${params.size ? `?${params}` : ""}`);
}

const commonRecordProperties = {
  cwd: { type: "string", description: "Absolute current workspace directory. Required when the MCP client has no single workspace root." },
  memory_level: { type: "string", enum: MEMORY_LEVELS, description: "Write destination; defaults to project. Broader layers must be configured explicitly." },
  scope: { type: "string", description: "Logical MemoryStack scope, mapped to agent_id. This is not an authorization boundary." },
  context: { type: "object", description: "Optional org/team/project/repository/session/agent/task identifiers." },
  tags: { type: "array", items: { type: "string" }, description: "Short retrieval labels." },
  evidence: { type: "array", items: { type: "object" }, description: "Evidence objects with type, id, and optional url." },
  metadata: { type: "object", description: "Additional non-secret metadata. memory_control_plane is reserved." },
};

const taskToolProperties = {
  seen_context_tokens: seenContextSchema,
  cwd: commonRecordProperties.cwd, scope: commonRecordProperties.scope,
  task: taskProfileSchema,
  target: { type: "string", enum: [...PROCEDURE_TARGETS], default: "claude-code" },
  limit: { type: "integer", minimum: 1, maximum: 20, default: 8 },
  max_context_chars: { type: "integer", minimum: 2000, maximum: 64000, default: 16000 },
};

const server = new Server(
  { name: "memorystack", version: "0.5.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'memory_validate_context',
      description: 'Recheck previously delivered fact tokens after relevant edits or before relying on an old plan. Reauthorizes current records and checks local source bytes without repeating memory text. Procedures and expired tokens require retrieval or expansion.',
      inputSchema: { type: 'object', additionalProperties: false, required: ['context_tokens'], properties: {
        cwd: commonRecordProperties.cwd, scope: commonRecordProperties.scope,
        context_tokens: { ...seenContextSchema, minItems: 1, maxItems: 50 },
      } },
    },
    {
      name: 'memory_correct',
      description: 'Explicitly supersede a mistaken fact with an already saved, evidence-backed replacement in the same authorized scope. Preserves both texts. Requires observed hashes and a stable retry key; never resolve disagreement by recency alone.',
      inputSchema: { type: 'object', additionalProperties: false,
        required: ['old_id', 'replacement_id', 'old_content_sha256', 'replacement_content_sha256', 'reason', 'idempotency_key'], properties: {
          cwd: commonRecordProperties.cwd, scope: commonRecordProperties.scope,
          old_id: { type: 'string', format: 'uuid' }, replacement_id: { type: 'string', format: 'uuid' },
          old_content_sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' }, replacement_content_sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
          reason: { type: 'string', minLength: 1, maxLength: 2000 }, idempotency_key: { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,200}$' },
        } },
    },
    {
      name: 'memory_read_source',
      description: 'Read a bounded UTF-8 source excerpt and issue a local receipt binding its exact file bytes. Use before deriving file-dependent memories; never use for secrets. Does not upload file content to MemoryStack.',
      inputSchema: { type: 'object', additionalProperties: false, required: ['path'], properties: {
        cwd: commonRecordProperties.cwd, path: { type: 'string', maxLength: 500, description: 'Path relative to the resolved workspace root, using /.' },
        start_line: { type: 'integer', minimum: 1 }, end_line: { type: 'integer', minimum: 1 },
        max_chars: { type: 'integer', minimum: 100, maximum: 32000, default: 12000 },
      } },
    },
    {
      name: "memory_retrieve_task_context",
      description: "Find facts and compact, active procedure or implementation-example descriptors relevant to a task. One shared result budget across configured scopes. Does not load procedure steps or certify applicability.",
      inputSchema: { type: "object", properties: { ...taskToolProperties,
        seen_version_ids: { type: "array", maxItems: 100, items: { type: "string", format: "uuid" }, description: "Deprecated: version IDs cannot track changed source applicability. Use seen_context_tokens." },
      }, required: ["task"], additionalProperties: false },
    },
    {
      name: "memory_expand_task_context",
      description: "Load selected immutable procedure/example versions after checking current authorization, active status, and supplied applicability observations. No duplicate Markdown projection. Select only what this task needs.",
      inputSchema: { type: "object", properties: { ...taskToolProperties,
        selected: { type: "array", minItems: 1, maxItems: 5, items: { type: "object", properties: {
          skill_id: { type: "string", format: "uuid" }, version_id: { type: "string", format: "uuid" }, scope: commonRecordProperties.scope,
        }, required: ["skill_id", "version_id", "scope"], additionalProperties: false } },
      }, required: ["task", "selected"], additionalProperties: false },
    },
    {
      name: "memory_resolve_scope",
      description: "Resolve project identity, configured user/team/org layers, write destination, and migration warnings before memory work. Does not grant access or write data.",
      inputSchema: { type: "object", properties: { cwd: commonRecordProperties.cwd, scope: commonRecordProperties.scope, memory_level: commonRecordProperties.memory_level }, additionalProperties: false },
    },
    {
      name: "memory_checkpoint",
      description: "Save a bounded session or subagent handoff for seven days, with Codex lineage and evidence. Does not promote findings into durable facts or require registered service-agent UUIDs.",
      inputSchema: { type: "object", properties: { idempotency_key: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,200}$" }, summary: { type: "string", maxLength: 4000 }, ...commonRecordProperties }, required: ["summary", "context"], additionalProperties: false },
    },
    {
      name: "memory_retrieve_handoffs",
      description: "Read temporary checkpoints for one MemoryStack session, optionally one Codex agent. Excludes lifecycle events and durable facts.",
      inputSchema: { type: "object", properties: { query: { type: "string", default: "checkpoint handoff" }, session_id: { type: "string" }, agent_id: { type: "string" }, cwd: commonRecordProperties.cwd, scope: commonRecordProperties.scope, limit: { type: "integer", minimum: 1, maximum: 50 } }, required: ["session_id"], additionalProperties: false },
    },
    {
      name: "memory_read_session",
      description: "Read one authorized MemoryStack session, including its persisted handoff summary. Use the server session ID, not a Codex thread ID.",
      inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"], additionalProperties: false },
    },
    {
      name: "memory_search",
      description: "Search active persistent coding memories. Excludes lifecycle telemetry and expired/superseded records by default.",
      inputSchema: {
        type: "object",
        properties: {
          seen_context_tokens: seenContextSchema,
          query: { type: "string", description: "Natural-language memory query." },
          cwd: commonRecordProperties.cwd,
          memory_level: commonRecordProperties.memory_level,
          scope: commonRecordProperties.scope,
          scopes: { type: "array", items: { type: "string" }, description: "One to eight logical scopes to search." },
          session_id: { type: "string", description: "Optional first-class MemoryStack session ID; narrows results to that session." },
          conversation_id: { type: "string", description: "Optional first-class conversation ID; narrows results to that conversation." },
          team_id: { type: "string", description: "Optional team identifier; narrows results within the authorized project." },
          limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
          max_context_chars: { type: "integer", minimum: 2000, maximum: 64000, default: 16000 },
          include_ephemeral: { type: "boolean", default: false },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
    {
      name: "memory_write",
      description: "Store one verified durable coding fact or decision with optional scope, evidence, and context metadata.",
      inputSchema: {
        type: "object",
        properties: { provenance: provenanceSchema, source_context: sourceContextSchema, idempotency_key: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,200}$", description: "Stable identity for this intended write; reuse unchanged on retry." }, content: { type: "string", description: "One durable, evidence-backed fact or decision." }, status: { type: "string", enum: ["active", "proposed", "superseded", "invalid"] }, ...commonRecordProperties },
        required: ["content"],
        additionalProperties: false,
      },
    },
    {
      name: "memory_retrieve_context",
      description: "Retrieve the smallest relevant, active coding context across one or more logical scopes.",
      inputSchema: {
        type: "object",
        properties: {
          seen_context_tokens: seenContextSchema,
          query: { type: "string" },
          cwd: commonRecordProperties.cwd,
          memory_level: commonRecordProperties.memory_level,
          scope: commonRecordProperties.scope,
          scopes: { type: "array", items: { type: "string" } },
          session_id: { type: "string", description: "Optional first-class MemoryStack session ID." },
          conversation_id: { type: "string", description: "Optional first-class conversation ID." },
          team_id: { type: "string", description: "Optional team identifier." },
          limit: { type: "integer", minimum: 1, maximum: 50, default: 8 },
          max_context_chars: { type: "integer", minimum: 2000, maximum: 64000, default: 16000 },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
    {
      name: "memory_record_event",
      description: "Record minimal, ephemeral lifecycle telemetry. Do not include prompt bodies, secrets, or raw tool output.",
      inputSchema: {
        type: "object",
        properties: { event_type: { type: "string" }, platform: { type: "string" }, expires_at: { type: "string" }, ...commonRecordProperties },
        required: ["event_type"],
        additionalProperties: false,
      },
    },
    {
      name: "memory_session_start",
      description: "Create a first-class Neural-Weave session. The supplied session_id is retained as the Codex external session ID; use the returned session_id to finalize it.",
      inputSchema: {
        type: "object",
        properties: { session_id: { type: "string" }, task: { type: "string" }, ...commonRecordProperties },
        required: ["session_id"],
        additionalProperties: false,
      },
    },
    {
      name: "memory_session_finalize",
      description: "Close a first-class Neural-Weave session and store up to five verified durable facts. Use the session_id returned by memory_session_start.",
      inputSchema: {
        type: "object",
        properties: { session_id: { type: "string" }, summary: { type: "string" }, durable_facts: { type: "array", items: { type: "string" }, maxItems: 5 }, ...commonRecordProperties },
        required: ["session_id", "summary"],
        additionalProperties: false,
      },
    },
    {
      name: "memory_create_handoff",
      description: "Create an audited, reference-only first-class Neural-Weave agent handoff. The server validates owner, project, session, agent, and memory access before recording it.",
      inputSchema: {
        type: "object",
        properties: {
          from_agent_id: { type: "string", description: "Source Neural-Weave agent UUID." },
          to_agent_id: { type: "string", description: "Target Neural-Weave agent UUID." },
          session_id: { type: "string", description: "First-class Neural-Weave session UUID." },
          conversation_id: { type: "string", description: "Optional Neural-Weave conversation UUID." },
          transfer_summary: { type: "string", description: "Compact verified handoff summary." },
          transfer_memories: { type: "boolean", default: true },
          memory_ids: { type: "array", items: { type: "string" }, maxItems: 20, description: "Optional source-agent memory UUIDs. They remain references; this tool does not grant access." },
          ...commonRecordProperties,
        },
        required: ["from_agent_id", "to_agent_id", "transfer_summary"],
        additionalProperties: false,
      },
    },
    {
      name: "memory_propose_recipe",
      description: "Propose, but do not publish, a reusable coding recipe after a workflow is verified.",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string" }, summary: { type: "string" }, triggers: { type: "array", items: { type: "string" } }, steps: { type: "array", items: { type: "string" } }, verification: { type: "array", items: { type: "string" } }, ...commonRecordProperties },
        required: ["name", "summary"],
        additionalProperties: false,
      },
    },
    {
      name: "memory_propose_skill",
      description: "Create a legacy skill-candidate memory for backwards compatibility. Use memory_propose_procedure for the canonical versioned lifecycle.",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string" }, summary: { type: "string" }, targets: { type: "array", items: { type: "string" } }, recipe_id: { type: "string" }, ...commonRecordProperties },
        required: ["name", "summary"],
        additionalProperties: false,
      },
    },
    {
      name: "memory_propose_procedure",
      description: "Propose a canonical, portable procedure candidate. It is never published automatically; a human owner or organization administrator promotes it after review.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short stable name for the procedure." },
          summary: { type: "string", description: "Concise purpose and expected outcome." },
          triggers: { type: "array", items: { type: "string" } },
          prerequisites: { type: "array", items: { type: "string" } },
          steps: { type: "array", items: { type: "string" }, description: "Verified ordered workflow steps." },
          verification: { type: "array", items: { type: "string" }, description: "Concrete checks required before reuse." },
          constraints: { type: "array", items: { type: "string" } },
          rollback: { type: "array", items: { type: "string" } },
          targets: { type: "array", items: { type: "string", enum: [...PROCEDURE_TARGETS] }, description: "codex, claude-code, cursor, mcp, or generic." },
          knowledge_kind: { type: "string", enum: ["procedure", "example"], description: "A verified implementation example is not a universal procedure." },
          task_kinds: { type: "array", maxItems: 5, items: { type: "string", enum: TASK_KINDS } },
          components: taskContextSchema.properties.components,
          applicability: applicabilitySchema,
          based_on_version_id: { type: "string", description: "Optional canonical version UUID being revised." },
          ...commonRecordProperties,
        },
        required: ["name", "summary", "steps", "verification"],
        additionalProperties: false,
      },
    },
    {
      name: "memory_list_active_procedures",
      description: "Retrieve active, adapter-compatible portable procedures and their traceable native projection. Candidates and retired versions are excluded.",
      inputSchema: {
        type: "object",
        properties: {
          scope: commonRecordProperties.scope,
          target: { type: "string", enum: [...PROCEDURE_TARGETS], default: "claude-code" },
          cwd: commonRecordProperties.cwd,
          memory_level: commonRecordProperties.memory_level,
          limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
        },
        additionalProperties: false,
      },
    },
    {
      name: "memory_record_procedure_outcome",
      description: "Record a compact evidence-backed success, failure, or neutral outcome for a procedure version. The returned recommendation cannot mutate, publish, or retire anything.",
      inputSchema: {
        type: "object",
        properties: {
          skill_id: { type: "string", description: "Canonical procedural skill UUID." },
          version_id: { type: "string", description: "Canonical procedural skill version UUID." },
          outcome: { type: "string", enum: ["success", "failure", "neutral"] },
          usage_mode: { type: "string", enum: USAGE_MODES, description: "Whether the procedure was actually used. Non-use requires neutral; success/failure requires verification evidence." },
          task_context: taskContextSchema,
          observation: { type: "string", description: "Short content-safe observation; never include prompts, secrets, or raw tool output." },
          idempotency_key: { type: "string", description: "Stable external run ID when a delivery may retry." },
          ...commonRecordProperties,
        },
        required: ["skill_id", "version_id", "outcome"],
        additionalProperties: false,
      },
    },
    {
      name: "memory_list_scopes",
      description: "List logical MemoryStack scopes observed in recently stored records.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "memory_get_observability",
      description: "Report coding-memory record categories, recent stored-record previews, retrieval delivery telemetry, and what token savings can or cannot be measured.",
      inputSchema: {
        type: "object",
        properties: {
          scope: commonRecordProperties.scope,
          days: { type: "integer", minimum: 1, maximum: 90, default: 30 },
        },
        additionalProperties: false,
      },
    },
  ],
}));

async function resolveArguments(input, name) {
  const args = { ...input };
  if (["memory_read_session", "memory_get_observability", "memory_list_scopes"].includes(name)) return args;
  let cwd = args.cwd || process.env.MEMORYSTACK_WORKSPACE_ROOT;
  if (!cwd && !args.scope && !args.scopes && server.getClientCapabilities()?.roots) {
    const { roots } = await server.listRoots({}, { timeout: 2_000 });
    const directories = roots.filter(root => root.uri.startsWith("file:")).map(root => fileURLToPath(root.uri));
    if (directories.length === 1) cwd = directories[0];
    else if (directories.length > 1) throw new Error("Multiple workspace roots: pass cwd for the intended project");
  }
  const policy = resolveScopePolicy({ cwd, scope: args.scope || args.scopes?.[0], memory_level: args.memory_level });
  args._policy = policy;
  args._sourceRoot = policy.sourceRoot;
  args.scope = policy.write_scope;
  args.context = { ...normalizeContext(args.context), ...policy.context };
  if (["memory_search", "memory_retrieve_context"].includes(name)) args.scopes = args.scopes ?? policy.read_scopes;
  return args;
}

server.setRequestHandler(CallToolRequestSchema, async (requestMessage) => {
  try {
    const args = await resolveArguments(requestMessage.params.arguments || {}, requestMessage.params.name);
    switch (requestMessage.params.name) {
      case "memory_retrieve_task_context":
      case "memory_expand_task_context": {
        const sourceCheck = freshnessFor(args);
        return textResult(activeContext.remember(await retrieveTaskContext(args, {
          scopes: args._policy.read_scopes, target: getProcedureTarget(args.target), request,
          searchFacts: input => searchMemory(input, { candidatesOnly: true, sourceCheck }), telemetry: reportTelemetry,
          sourceCheck,
        }, requestMessage.params.name === "memory_expand_task_context"), args));
      }
      case 'memory_validate_context': return textResult(await activeContext.validate(args, { request, sourceCheck: freshnessFor(args) }));
      case 'memory_correct': {
        const { old_id, replacement_id, old_content_sha256, replacement_content_sha256, reason, idempotency_key, scope } = args;
        const receipt = await request('/memories/corrections', { method: 'POST', body: JSON.stringify({ old_id, replacement_id, old_content_sha256, replacement_content_sha256, reason, idempotency_key, scope }) });
        if (receipt.success !== true || receipt.correction?.old_id !== old_id || receipt.correction?.replacement_id !== replacement_id
          || receipt.correction?.old_content_sha256 !== old_content_sha256 || receipt.correction?.replacement_content_sha256 !== replacement_content_sha256
          || receipt.correction?.idempotency_key !== idempotency_key) throw new Error('Backend did not acknowledge this correction; reconcile before retrying');
        return textResult(receipt);
      }
      case 'memory_read_source': return textResult(await sourceTracker.read(args));
      case "memory_resolve_scope": return textResult(args._policy);
      case "memory_checkpoint": return textResult(await checkpoint(args));
      case "memory_read_session": {
        const id = getOptionalString(args.session_id, "session_id", 200);
        if (!id) throw new Error("session_id is required");
        return textResult(await request(`/sessions/${encodeURIComponent(id)}`));
      }
      case "memory_retrieve_handoffs": {
        return textResult(await retrieveHandoffs(args));
      }
      case "memory_search":
      case "memory_retrieve_context":
        return textResult(activeContext.remember(await searchMemory(args), args));
      case "memory_write":
        return textResult(await writeMemory(args));
      case "memory_record_event":
        return textResult(await recordEvent(args));
      case "memory_session_start":
        return textResult(await startSession(args));
      case "memory_session_finalize":
        return textResult(await finalizeSession(args));
      case "memory_create_handoff":
        return textResult(await createHandoff(args));
      case "memory_propose_recipe":
        return textResult(await proposeRecipe(args));
      case "memory_propose_skill":
        return textResult(await proposeSkill(args));
      case "memory_propose_procedure":
        return textResult(await proposeProcedure(args));
      case "memory_list_active_procedures":
        return textResult(await listActiveProcedures(args));
      case "memory_record_procedure_outcome":
        return textResult(await recordProcedureOutcome(args));
      case "memory_list_scopes":
        return textResult(await listScopes());
      case "memory_get_observability":
        return textResult(await getObservability(args));
      default:
        return textResult(`Unknown tool: ${requestMessage.params.name}`, true);
    }
  } catch (error) {
    return textResult(error instanceof Error ? error.message : String(error), true);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
