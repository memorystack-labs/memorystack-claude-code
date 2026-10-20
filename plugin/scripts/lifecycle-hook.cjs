var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/lib/stdin.js
var require_stdin = __commonJS({
  "src/lib/stdin.js"(exports2, module2) {
    async function readStdin2() {
      return new Promise((resolve, reject) => {
        let data = "", finished = false;
        const timer = setTimeout(() => finish(null, {}), 1500);
        timer.unref();
        const finish = (error, value) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          process.stdin.removeListener("data", onData);
          process.stdin.removeListener("end", onEnd);
          process.stdin.removeListener("error", onError);
          process.stdin.pause();
          error ? reject(error) : resolve(value);
        };
        const onData = (chunk) => {
          data += chunk;
          if (Buffer.byteLength(data) > 1048576) finish(new Error("Hook input exceeds 1 MiB"));
        };
        const onEnd = () => {
          try {
            finish(null, JSON.parse(data.replace(/^\uFEFF/, "").trim() || "{}"));
          } catch {
            finish(new Error("Invalid hook JSON"));
          }
        };
        const onError = (error) => finish(error);
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", onData);
        process.stdin.on("end", onEnd);
        process.stdin.on("error", onError);
      });
    }
    function writeOutput2(output) {
      console.log(JSON.stringify(output));
    }
    module2.exports = { readStdin: readStdin2, writeOutput: writeOutput2 };
  }
});

// src/engine/scope-policy.js
var scope_policy_exports = {};
__export(scope_policy_exports, {
  MEMORY_LEVELS: () => MEMORY_LEVELS,
  git: () => git,
  resolveScopePolicy: () => resolveScopePolicy
});
function git(cwd, args) {
  try {
    return (0, import_node_child_process.execFileSync)("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      timeout: 1500,
      maxBuffer: 128 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true
    }).trim();
  } catch {
    return void 0;
  }
}
function scopeString(value, label) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 300) {
    throw new Error(`${label} must be a non-empty string of at most 300 characters`);
  }
  return value.trim();
}
function resolveScopePolicy({ cwd, env = process.env, scope, memory_level = "project" } = {}) {
  if (!MEMORY_LEVELS.includes(memory_level)) throw new Error("Unknown memory_level");
  let workspace = cwd || env.MEMORYSTACK_WORKSPACE_ROOT;
  if (workspace && !import_node_path.default.isAbsolute(workspace)) throw new Error("cwd must be an absolute workspace path");
  if (workspace) workspace = canonical(workspace);
  if (workspace && !(0, import_node_fs.statSync)(workspace).isDirectory()) throw new Error("cwd must identify a directory");
  const gitRoot = workspace && git(workspace, ["rev-parse", "--show-toplevel"]);
  const repository = gitRoot && canonical(gitRoot) !== canonical(import_node_os.default.homedir()) ? canonical(gitRoot) : void 0;
  let root = repository || workspace;
  let config = {};
  if (workspace) {
    let cursor = workspace;
    while (true) {
      const file = import_node_path.default.join(cursor, ".memorystack.json");
      if ((0, import_node_fs.existsSync)(file)) {
        if ((0, import_node_fs.readFileSync)(file).length > 32768) throw new Error("MemoryStack project config is too large");
        config = JSON.parse((0, import_node_fs.readFileSync)(file, "utf8"));
        if (!config || Array.isArray(config) || typeof config !== "object") throw new Error("Invalid MemoryStack project config");
        root = cursor;
        break;
      }
      if (cursor === repository || cursor === canonical(import_node_os.default.homedir()) || import_node_path.default.dirname(cursor) === cursor) break;
      cursor = import_node_path.default.dirname(cursor);
    }
  }
  const configured = config.scopes ?? {};
  if (!configured || Array.isArray(configured) || typeof configured !== "object") throw new Error("Invalid configured scopes");
  const commonDir = repository && git(repository, ["rev-parse", "--git-common-dir"]);
  const repositoryIdentity = commonDir ? canonical(import_node_path.default.resolve(repository, commonDir)) : root;
  const projectId = config.project_id || env.MEMORYSTACK_PROJECT_ID || repositoryIdentity && `local-${digest(repositoryIdentity)}`;
  const scopes = {};
  for (const level of MEMORY_LEVELS) {
    const value = configured[level] || env[`MEMORYSTACK_${level.toUpperCase()}_SCOPE`];
    if (value) scopes[level] = scopeString(value, `${level} scope`);
  }
  if (!scopes.project && projectId) scopes.project = `project:${scopeString(projectId, "project_id")}`;
  const legacyDefault = env.MEMORYSTACK_SCOPE?.trim();
  if (!scopes.project && legacyDefault && legacyDefault !== "codex-default") scopes.project = scopeString(legacyDefault, "MEMORYSTACK_SCOPE");
  const writeScope = scope ? scopeString(scope, "scope") : scopes[memory_level];
  if (!writeScope) throw new Error(`Cannot resolve ${memory_level} memory scope. Supply cwd, a single MCP workspace root, or an explicit scope; configure broader scopes before using them.`);
  scopeString(writeScope, "resolved scope");
  const legacy = config.legacy_scopes ?? [];
  if (!Array.isArray(legacy) || legacy.length > 4) throw new Error("legacy_scopes must contain at most four project aliases");
  const readScopes = [...new Set(scope ? [writeScope] : [writeScope, ...MEMORY_LEVELS.slice(MEMORY_LEVELS.indexOf(memory_level)).map((level) => scopes[level]).filter(Boolean), ...memory_level === "project" ? legacy.map((value) => scopeString(value, "legacy scope")) : []])];
  if (readScopes.length > 8) throw new Error("At most eight retrieval scopes are supported");
  const branch = repository && git(repository, ["branch", "--show-current"]);
  const commit = repository && git(repository, ["rev-parse", "HEAD"]);
  const policy = {
    write_scope: writeScope,
    read_scopes: readScopes,
    scopes,
    context: {
      ...projectId ? { project_id: projectId, repo_id: projectId } : {},
      ...root ? { worktree_id: `wt-${digest(root)}` } : {},
      ...branch ? { git_branch: branch } : {},
      ...commit ? { git_commit: commit } : {}
    },
    warnings: legacyDefault === "codex-default" ? ["Shared codex-default is not read automatically. Add an explicit legacy scope only after reviewing its project ownership."] : []
  };
  Object.defineProperty(policy, "sourceRoot", { value: root });
  return policy;
}
var import_node_fs, import_node_child_process, import_node_crypto, import_node_os, import_node_path, MEMORY_LEVELS, digest, canonical;
var init_scope_policy = __esm({
  "src/engine/scope-policy.js"() {
    import_node_fs = require("node:fs");
    import_node_child_process = require("node:child_process");
    import_node_crypto = require("node:crypto");
    import_node_os = __toESM(require("node:os"), 1);
    import_node_path = __toESM(require("node:path"), 1);
    MEMORY_LEVELS = ["project", "team", "org", "user"];
    digest = (value) => (0, import_node_crypto.createHash)("sha256").update(value).digest("hex").slice(0, 24);
    canonical = (value) => {
      const resolved = (0, import_node_fs.realpathSync)(value);
      return process.platform === "win32" ? resolved.toLowerCase() : resolved;
    };
  }
});

// src/lifecycle-hook.js
var { readStdin, writeOutput } = require_stdin();
async function main() {
  const input = await readStdin();
  if (!["SessionStart", "SubagentStart"].includes(input.hook_event_name)) return writeOutput({});
  const { resolveScopePolicy: resolveScopePolicy2 } = await Promise.resolve().then(() => (init_scope_policy(), scope_policy_exports));
  const policy = resolveScopePolicy2({ cwd: input.cwd });
  const lineage = {};
  for (const key of ["session_id", "agent_id", "agent_type", "parent_agent_id", "root_session_id"]) {
    if (typeof input[key] === "string") lineage[key] = input[key].slice(0, 200);
  }
  const guidance = {
    write_scope: policy.write_scope,
    read_scopes: policy.read_scopes,
    external_context: lineage,
    guidance: "For substantial work use the coding-memory-bootstrap skill and bounded task recall with current cwd and target claude-code. Resolve the MemoryStack server session separately from this external session ID. Reuse context already available; revalidate source-bound facts after edits. Before compaction or subagent completion, checkpoint verified progress with supplied lineage. Store only verified durable facts; propose reusable procedures for review. Never upload raw transcripts, prompts, private reasoning, or secrets. Hooks provide guidance only; semantic capture requires MCP tools and skills."
  };
  writeOutput({ hookSpecificOutput: { hookEventName: input.hook_event_name, additionalContext: JSON.stringify(guidance) } });
}
main().catch(() => writeOutput({}));
