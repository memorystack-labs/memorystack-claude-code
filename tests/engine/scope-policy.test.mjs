import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { resolveScopePolicy } from "../../src/engine/scope-policy.js";

function fixture(t, config) {
  const root = mkdtempSync(path.join(tmpdir(), "memorystack-scope-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  if (config) writeFileSync(path.join(root, ".memorystack.json"), JSON.stringify(config));
  return root;
}

test("project writes and configured hierarchy reads stay distinct", t => {
  const cwd = fixture(t, { project_id: "payments", scopes: { org: "org:acme", team: "team:billing", user: "user:owner" } });
  const policy = resolveScopePolicy({ cwd, env: { MEMORYSTACK_SCOPE: "codex-default" } });
  assert.equal(policy.write_scope, "project:payments");
  assert.deepEqual(policy.read_scopes, ["project:payments", "team:billing", "org:acme", "user:owner"]);
  assert.equal(resolveScopePolicy({ cwd, env: {}, memory_level: "user" }).write_scope, "user:owner");
  assert.deepEqual(resolveScopePolicy({ cwd, env: {}, memory_level: "user" }).read_scopes, ["user:owner"]);
});

test("missing context fails instead of mixing projects through codex-default", () => {
  assert.throws(() => resolveScopePolicy({ env: { MEMORYSTACK_SCOPE: "codex-default" } }), /Cannot resolve/);
  assert.throws(() => resolveScopePolicy({ env: {}, memory_level: "org" }), /Cannot resolve/);
  assert.equal(resolveScopePolicy({ env: {}, scope: "old-project" }).write_scope, "old-project");
});

test("nested directories inherit configured identity and explicit scopes opt out of expansion", t => {
  const cwd = fixture(t, { project_id: "project-a", scopes: { org: "org:acme" }, legacy_scopes: ["old-a"] });
  const nested = path.join(cwd, "src"); mkdirSync(nested);
  assert.equal(resolveScopePolicy({ cwd: nested, env: {} }).write_scope, "project:project-a");
  assert.deepEqual(resolveScopePolicy({ cwd: nested, env: {}, scope: "old-a" }).read_scopes, ["old-a"]);
});

test("separate workspaces have different identities", t => {
  const a = fixture(t); const b = fixture(t);
  assert.notEqual(resolveScopePolicy({ cwd: a, env: {} }).write_scope, resolveScopePolicy({ cwd: b, env: {} }).write_scope);
});

test("git worktrees share project identity but retain different worktree identities", t => {
  const cwd = fixture(t);
  execFileSync("git", ["init", cwd], { stdio: "ignore" });
  execFileSync("git", ["-C", cwd, "-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "--allow-empty", "-m", "fixture"], { stdio: "ignore" });
  const other = path.join(cwd, "other");
  execFileSync("git", ["-C", cwd, "worktree", "add", "--detach", other], { stdio: "ignore" });
  const a = resolveScopePolicy({ cwd, env: {} }); const b = resolveScopePolicy({ cwd: other, env: {} });
  assert.equal(a.write_scope, b.write_scope);
  assert.notEqual(a.context.worktree_id, b.context.worktree_id);
});
