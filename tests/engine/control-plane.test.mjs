import assert from "node:assert/strict";
import test from "node:test";

import {
  buildControlPlaneMetadata,
  buildMemoryScoping,
  dedupeMemories,
  isRetrievable,
  normalizeContext,
} from "../../src/engine/control-plane.js";

test("normalizes the supported hierarchical context identifiers", () => {
  assert.deepEqual(
    normalizeContext({ org_id: " acme ", project_id: "payments", ignored: "not-kept" }),
    { org_id: "acme", project_id: "payments" },
  );
});

test("creates versioned control-plane metadata", () => {
  const metadata = buildControlPlaneMetadata({
    recordType: "fact",
    scope: "project:payments",
    context: { project_id: "payments" },
    tags: ["architecture", "architecture"],
    evidence: [{ type: "commit", id: "abc123" }],
  });

  assert.equal(metadata.memory_control_plane.schema_version, "1.0");
  assert.deepEqual(metadata.memory_control_plane.tags, ["architecture"]);
  assert.equal(metadata.memory_control_plane.context.project_id, "payments");
});

test("mirrors session/team/conversation to indexed memory columns without changing the logical scope", () => {
  assert.deepEqual(
    buildMemoryScoping("project:payments", {
      agent_id: "codex-reviewer",
      team_id: "payments-team",
      session_id: "server-session-1",
      external_session_id: "codex-session-1",
      conversation_id: "conversation-1",
    }),
    {
      agent_id: "project:payments",
      team_id: "payments-team",
      session_id: "server-session-1",
      conversation_id: "conversation-1",
      context: {
        agent_id: "codex-reviewer",
        team_id: "payments-team",
        session_id: "server-session-1",
        external_session_id: "codex-session-1",
        conversation_id: "conversation-1",
      },
    },
  );
});

test("hides event, expired, and superseded records from normal retrieval", () => {
  const event = { metadata: buildControlPlaneMetadata({ recordType: "event", scope: "project:payments", retention: "ephemeral" }) };
  const superseded = { metadata: buildControlPlaneMetadata({ recordType: "fact", scope: "project:payments", status: "superseded" }) };
  const expired = { metadata: buildControlPlaneMetadata({ recordType: "fact", scope: "project:payments", expiresAt: "2000-01-01T00:00:00.000Z" }) };

  assert.equal(isRetrievable(event), false);
  assert.equal(isRetrievable(event, { includeEphemeral: true }), true);
  assert.equal(isRetrievable(superseded), false);
  assert.equal(isRetrievable(expired), false);
});

test("deduplicates cross-scope search results by memory id", () => {
  const results = dedupeMemories([
    { id: "one", content: "first" },
    { id: "one", content: "duplicate" },
    { id: "two", content: "second" },
  ]);
  assert.deepEqual(results.map((memory) => memory.id), ["one", "two"]);
});

test("proposals, closed records, skill candidates, and invalid expiry never enter normal context", () => {
  for (const status of ["proposed", "closed", "superseded", "invalid"]) {
    assert.equal(isRetrievable({ metadata: buildControlPlaneMetadata({ recordType: "fact", scope: "test", status }) }), false);
  }
  assert.equal(isRetrievable({ metadata: buildControlPlaneMetadata({ recordType: "skill_candidate", scope: "test" }) }), false);
  assert.equal(isRetrievable({ metadata: buildControlPlaneMetadata({ recordType: "fact", scope: "test", expiresAt: "bad-date" }) }), false);
});

test("agent lineage and branch provenance survive normalization", () => {
  const context = { agent_id: "child", parent_agent_id: "parent", root_session_id: "root", agent_type: "reviewer", worktree_id: "wt", git_branch: "branch", git_commit: "abc" };
  assert.deepEqual(normalizeContext(context), context);
});
