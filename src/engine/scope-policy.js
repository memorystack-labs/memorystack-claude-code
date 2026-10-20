import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

export const MEMORY_LEVELS = ["project", "team", "org", "user"];
const digest = (value) => createHash("sha256").update(value).digest("hex").slice(0, 24);
const canonical = (value) => {
  const resolved = realpathSync(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
};

export function git(cwd, args) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8", timeout: 1500, maxBuffer: 128 * 1024,
      stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
    }).trim();
  } catch { return undefined; }
}

function scopeString(value, label) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 300) {
    throw new Error(`${label} must be a non-empty string of at most 300 characters`);
  }
  return value.trim();
}

// A config contains logical partitions, never credentials or access grants.
export function resolveScopePolicy({ cwd, env = process.env, scope, memory_level = "project" } = {}) {
  if (!MEMORY_LEVELS.includes(memory_level)) throw new Error("Unknown memory_level");
  let workspace = cwd || env.MEMORYSTACK_WORKSPACE_ROOT;
  if (workspace && !path.isAbsolute(workspace)) throw new Error("cwd must be an absolute workspace path");
  if (workspace) workspace = canonical(workspace);
  if (workspace && !statSync(workspace).isDirectory()) throw new Error("cwd must identify a directory");
  const gitRoot = workspace && git(workspace, ["rev-parse", "--show-toplevel"]);
  // A repository accidentally initialized in the home directory must not merge every project.
  const repository = gitRoot && canonical(gitRoot) !== canonical(os.homedir()) ? canonical(gitRoot) : undefined;
  let root = repository || workspace;
  let config = {};
  if (workspace) {
    let cursor = workspace;
    while (true) {
      const file = path.join(cursor, ".memorystack.json");
      if (existsSync(file)) {
        if (readFileSync(file).length > 32_768) throw new Error("MemoryStack project config is too large");
        config = JSON.parse(readFileSync(file, "utf8"));
        if (!config || Array.isArray(config) || typeof config !== "object") throw new Error("Invalid MemoryStack project config");
        root = cursor;
        break;
      }
      if (cursor === repository || cursor === canonical(os.homedir()) || path.dirname(cursor) === cursor) break;
      cursor = path.dirname(cursor);
    }
  }
  const configured = config.scopes ?? {};
  if (!configured || Array.isArray(configured) || typeof configured !== "object") throw new Error("Invalid configured scopes");
  const commonDir = repository && git(repository, ["rev-parse", "--git-common-dir"]);
  const repositoryIdentity = commonDir ? canonical(path.resolve(repository, commonDir)) : root;
  const projectId = config.project_id || env.MEMORYSTACK_PROJECT_ID || (repositoryIdentity && `local-${digest(repositoryIdentity)}`);
  const scopes = {};
  for (const level of MEMORY_LEVELS) {
    const value = configured[level] || env[`MEMORYSTACK_${level.toUpperCase()}_SCOPE`];
    if (value) scopes[level] = scopeString(value, `${level} scope`);
  }
  if (!scopes.project && projectId) scopes.project = `project:${scopeString(projectId, "project_id")}`;
  const legacyDefault = env.MEMORYSTACK_SCOPE?.trim();
  // Preserve intentional legacy partitions, but never silently reuse the old shared default.
  if (!scopes.project && legacyDefault && legacyDefault !== "codex-default") scopes.project = scopeString(legacyDefault, "MEMORYSTACK_SCOPE");
  const writeScope = scope ? scopeString(scope, "scope") : scopes[memory_level];
  if (!writeScope) throw new Error(`Cannot resolve ${memory_level} memory scope. Supply cwd, a single MCP workspace root, or an explicit scope; configure broader scopes before using them.`);
  scopeString(writeScope, "resolved scope");
  const legacy = config.legacy_scopes ?? [];
  if (!Array.isArray(legacy) || legacy.length > 4) throw new Error("legacy_scopes must contain at most four project aliases");
  const readScopes = [...new Set(scope ? [writeScope] : [writeScope, ...MEMORY_LEVELS.slice(MEMORY_LEVELS.indexOf(memory_level)).map(level => scopes[level]).filter(Boolean), ...(memory_level === "project" ? legacy.map(value => scopeString(value, "legacy scope")) : [])])];
  if (readScopes.length > 8) throw new Error("At most eight retrieval scopes are supported");
  const branch = repository && git(repository, ["branch", "--show-current"]);
  const commit = repository && git(repository, ["rev-parse", "HEAD"]);
  const policy = {
    write_scope: writeScope, read_scopes: readScopes, scopes,
    context: {
      ...(projectId ? { project_id: projectId, repo_id: projectId } : {}),
      ...(root ? { worktree_id: `wt-${digest(root)}` } : {}),
      ...(branch ? { git_branch: branch } : {}),
      ...(commit ? { git_commit: commit } : {}),
    },
    warnings: legacyDefault === "codex-default" ? ["Shared codex-default is not read automatically. Add an explicit legacy scope only after reviewing its project ownership."] : [],
  };
  // Local filesystem capability; never send the absolute root to the backend.
  Object.defineProperty(policy, 'sourceRoot', { value: root });
  return policy;
}
