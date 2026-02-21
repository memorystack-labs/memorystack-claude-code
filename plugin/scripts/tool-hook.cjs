var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// src/lib/compress.js
var require_compress = __commonJS({
  "src/lib/compress.js"(exports2, module2) {
    function compressObservation2(toolName, input, output) {
      const name = (toolName || "").toLowerCase();
      const outputStr = normalizeOutput(output);
      try {
        switch (name) {
          case "edit":
          case "editfile":
          case "edit_file":
            return compressEdit(input, outputStr);
          case "write":
          case "writefile":
          case "write_to_file":
          case "createfile":
            return compressWrite(input, outputStr);
          case "read":
          case "readfile":
          case "read_file":
          case "view":
            return compressRead(input, outputStr);
          case "bash":
          case "terminal":
          case "execute_command":
            return compressBash(input, outputStr);
          case "glob":
          case "search":
          case "find":
          case "list":
          case "listdir":
            return compressSearch(input, outputStr);
          case "grep":
          case "ripgrep":
            return compressGrep(input, outputStr);
          default:
            return compressGeneric(toolName, input, outputStr);
        }
      } catch (err) {
        return `Used ${toolName || "unknown tool"}`;
      }
    }
    function compressEdit(input, _output) {
      const file = extractFilePath2(input);
      const oldText = truncate(input?.old_text || input?.old_string || input?.target || "", 40);
      const newText = truncate(input?.new_text || input?.new_string || input?.replacement || "", 40);
      if (oldText && newText) {
        return `Edited ${file}: '${oldText}' \u2192 '${newText}'`;
      }
      return `Edited ${file}`;
    }
    function compressWrite(input, _output) {
      const file = extractFilePath2(input);
      const content = input?.content || input?.file_text || "";
      return `Created ${file} (${content.length} chars)`;
    }
    function compressRead(input, _output) {
      const file = extractFilePath2(input);
      return `Read ${file}`;
    }
    function compressBash(input, output) {
      const cmd = truncate(input?.command || input?.cmd || input?.description || "", 60);
      const result = truncate(output || "", 60);
      if (cmd && result) {
        return `Ran: ${cmd} \u2192 ${result}`;
      }
      if (cmd) {
        return `Ran: ${cmd}`;
      }
      return `Ran bash command`;
    }
    function compressSearch(input, output) {
      const pattern = input?.pattern || input?.glob || input?.query || "";
      const count = (output || "").split("\n").filter((l) => l.trim()).length;
      return `Searched '${truncate(pattern, 30)}' \u2192 ${count} results`;
    }
    function compressGrep(input, _output) {
      const query = input?.query || input?.pattern || "";
      const path2 = input?.path || input?.search_path || "";
      return `Grep '${truncate(query, 30)}' in ${extractBasename(path2)}`;
    }
    function compressGeneric(toolName, input, output) {
      const summary = truncate(output || "", 60);
      return `${toolName}: ${summary || "(completed)"}`;
    }
    function getObservationMetadata(toolName, input) {
      const meta = {};
      const file = extractFilePath2(input);
      if (file) meta.file = file;
      const cmd = input?.command || input?.cmd;
      if (cmd) meta.command = truncate(cmd, 100);
      return meta;
    }
    function extractFilePath2(input) {
      if (!input) return "unknown";
      const raw = input.file_path || input.path || input.file || input.filename || input.target_file || "";
      return extractBasename(raw);
    }
    function extractBasename(filePath) {
      if (!filePath) return "unknown";
      const parts = filePath.replace(/\\/g, "/").split("/");
      return parts.slice(-2).join("/");
    }
    function truncate(text, maxLen) {
      if (!text) return "";
      const clean = text.replace(/\s+/g, " ").trim();
      if (clean.length <= maxLen) return clean;
      return clean.slice(0, maxLen - 3) + "...";
    }
    function normalizeOutput(output) {
      if (!output) return "";
      if (typeof output === "string") return output;
      if (typeof output === "object") {
        if (output.output) return String(output.output);
        if (output.stdout) return String(output.stdout);
        if (output.result) return String(output.result);
        if (output.content) return String(output.content);
        if (output.success !== void 0) return output.success ? "success" : "failed";
        try {
          return JSON.stringify(output).slice(0, 200);
        } catch {
          return "";
        }
      }
      return String(output);
    }
    module2.exports = { compressObservation: compressObservation2, getObservationMetadata };
  }
});

// src/lib/settings.js
var require_settings = __commonJS({
  "src/lib/settings.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    var os = require("os");
    var CONFIG_DIR = path2.join(os.homedir(), ".memorystack-claude");
    var SETTINGS_FILE = path2.join(CONFIG_DIR, "settings.json");
    var CREDENTIALS_FILE = path2.join(CONFIG_DIR, "credentials.json");
    function loadSettings2() {
      const defaults = {
        skipTools: ["Read", "Glob", "Grep"],
        captureTools: ["Edit", "Write", "Bash", "Task"],
        maxContextResults: 5,
        debug: process.env.MEMORYSTACK_DEBUG === "true",
        // Signal extraction config
        signalKeywords: [
          "remember",
          "important",
          "note",
          "architecture",
          "decision",
          "convention",
          "bug",
          "fix",
          "pattern",
          "refactor",
          "todo",
          "learned",
          "figured out",
          "design",
          "tradeoff",
          "prefer"
        ],
        turnsBefore: 3,
        sourceVersion: "0.2.0",
        captureMode: "smart"
        // 'smart' (signal → full fallback), 'signal', 'full'
      };
      try {
        if (fs2.existsSync(SETTINGS_FILE)) {
          const content = fs2.readFileSync(SETTINGS_FILE, "utf8");
          return { ...defaults, ...JSON.parse(content) };
        }
      } catch (err) {
      }
      return defaults;
    }
    function getApiKey2(settings) {
      const envKey = process.env.MEMORYSTACK_API_KEY;
      if (envKey) {
        return envKey;
      }
      try {
        if (fs2.existsSync(CREDENTIALS_FILE)) {
          const content = fs2.readFileSync(CREDENTIALS_FILE, "utf8");
          const creds = JSON.parse(content);
          if (creds.apiKey) {
            return creds.apiKey;
          }
        }
      } catch (err) {
      }
      throw new Error("MEMORYSTACK_API_KEY not found");
    }
    function saveApiKey(apiKey) {
      try {
        if (!fs2.existsSync(CONFIG_DIR)) {
          fs2.mkdirSync(CONFIG_DIR, { recursive: true });
        }
        fs2.writeFileSync(
          CREDENTIALS_FILE,
          JSON.stringify({ apiKey, savedAt: (/* @__PURE__ */ new Date()).toISOString() }, null, 2)
        );
        return true;
      } catch (err) {
        console.error("Failed to save credentials:", err.message);
        return false;
      }
    }
    function debugLog2(settings, message, data) {
      if (settings.debug) {
        console.error(`[MemoryStack Debug] ${message}`, data || "");
      }
    }
    function getProjectName2(cwd) {
      try {
        const pkgPath = path2.join(cwd, "package.json");
        if (fs2.existsSync(pkgPath)) {
          const pkg = JSON.parse(fs2.readFileSync(pkgPath, "utf8"));
          if (pkg.name) return pkg.name;
        }
      } catch (err) {
      }
      return path2.basename(cwd);
    }
    module2.exports = {
      loadSettings: loadSettings2,
      getApiKey: getApiKey2,
      saveApiKey,
      debugLog: debugLog2,
      getProjectName: getProjectName2,
      CONFIG_DIR,
      SETTINGS_FILE,
      CREDENTIALS_FILE
    };
  }
});

// src/lib/stdin.js
var require_stdin = __commonJS({
  "src/lib/stdin.js"(exports2, module2) {
    async function readStdin2() {
      return new Promise((resolve, reject) => {
        let data = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (chunk) => {
          data += chunk;
        });
        process.stdin.on("end", () => {
          try {
            const cleaned = data.replace(/^\uFEFF/, "").trim();
            if (!cleaned) {
              resolve({});
              return;
            }
            resolve(JSON.parse(cleaned));
          } catch (err) {
            reject(new Error(`Failed to parse stdin: ${err.message}`));
          }
        });
        process.stdin.on("error", reject);
        setTimeout(() => {
          if (!data) {
            resolve({});
          }
        }, 5e3);
      });
    }
    function writeOutput2(output) {
      console.log(JSON.stringify(output));
    }
    module2.exports = { readStdin: readStdin2, writeOutput: writeOutput2 };
  }
});

// src/tool-hook.js
var { compressObservation } = require_compress();
var { loadSettings, getApiKey, getProjectName, debugLog } = require_settings();
var { readStdin, writeOutput } = require_stdin();
var fs = require("fs");
var path = require("path");
var TRACKED_TOOLS = /* @__PURE__ */ new Set([
  "bash",
  "edit",
  "editfile",
  "edit_file",
  "write",
  "writefile",
  "write_file",
  "task",
  "webfetch",
  "web_fetch",
  "websearch",
  "web_search"
]);
async function main() {
  const settings = loadSettings();
  try {
    const input = await readStdin();
    const toolName = input.tool_name || "";
    const toolInput = input.tool_input || {};
    const toolResponse = input.tool_response || {};
    const sessionId = input.session_id || "";
    const cwd = input.cwd || process.cwd();
    const toolLower = toolName.toLowerCase();
    if (!TRACKED_TOOLS.has(toolLower)) {
      writeOutput({});
      return;
    }
    debugLog(settings, "PostToolUse", { tool: toolName, sessionId });
    const compressed = compressObservation(toolName, toolInput, toolResponse);
    appendToActivityLog(sessionId, cwd, {
      tool: toolName,
      summary: compressed,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      file: extractFilePath(toolInput)
    });
    if (["edit", "editfile", "edit_file", "write", "writefile", "write_file"].includes(toolLower)) {
      trackFileChange(sessionId, cwd, extractFilePath(toolInput), toolName);
    }
    writeOutput({});
  } catch (err) {
    debugLog(settings, "Tool hook error", { error: err.message });
    writeOutput({});
  }
}
function appendToActivityLog(sessionId, cwd, entry) {
  try {
    const stateDir = path.join(
      process.env.HOME || process.env.USERPROFILE || "",
      ".memorystack-claude"
    );
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }
    const logFile = path.join(stateDir, `activity-${sessionId}.jsonl`);
    fs.appendFileSync(logFile, JSON.stringify(entry) + "\n");
  } catch {
  }
}
function trackFileChange(sessionId, cwd, filePath, toolName) {
  if (!filePath) return;
  try {
    const stateDir = path.join(
      process.env.HOME || process.env.USERPROFILE || "",
      ".memorystack-claude"
    );
    const changesFile = path.join(stateDir, `changes-${sessionId}.json`);
    let changes = {};
    if (fs.existsSync(changesFile)) {
      try {
        changes = JSON.parse(fs.readFileSync(changesFile, "utf8"));
      } catch {
        changes = {};
      }
    }
    if (!changes[filePath]) {
      changes[filePath] = { edits: 0, writes: 0, firstSeen: (/* @__PURE__ */ new Date()).toISOString() };
    }
    if (toolName.toLowerCase().includes("edit")) {
      changes[filePath].edits++;
    } else {
      changes[filePath].writes++;
    }
    changes[filePath].lastSeen = (/* @__PURE__ */ new Date()).toISOString();
    fs.writeFileSync(changesFile, JSON.stringify(changes, null, 2));
  } catch {
  }
}
function extractFilePath(input) {
  return input?.file_path || input?.filePath || input?.path || input?.file || null;
}
main().catch(() => process.exit(0));
