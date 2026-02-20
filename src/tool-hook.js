/**
 * Tool Hook — PostToolUse
 * 
 * Fires after every successful tool execution.
 * Compresses tool observations and appends to session activity log.
 * 
 * Captures: Edit, Write, Bash, Task (subagent spawns)
 * Skips: Read, Glob, Grep (read-only, not worth tracking)
 */
const { compressObservation } = require('./lib/compress');
const { loadSettings, getApiKey, getProjectName, debugLog } = require('./lib/settings');
const { readStdin, writeOutput } = require('./lib/stdin');
const fs = require('fs');
const path = require('path');

// Tools worth tracking (mutations / significant actions)
const TRACKED_TOOLS = new Set([
    'bash', 'edit', 'editfile', 'edit_file',
    'write', 'writefile', 'write_file',
    'task',
    'webfetch', 'web_fetch',
    'websearch', 'web_search',
]);

async function main() {
    const settings = loadSettings();

    try {
        const input = await readStdin();
        const toolName = input.tool_name || '';
        const toolInput = input.tool_input || {};
        const toolResponse = input.tool_response || {};
        const sessionId = input.session_id || '';
        const cwd = input.cwd || process.cwd();

        const toolLower = toolName.toLowerCase();

        // Skip read-only tools — they don't change state
        if (!TRACKED_TOOLS.has(toolLower)) {
            writeOutput({});
            return;
        }

        debugLog(settings, 'PostToolUse', { tool: toolName, sessionId });

        // Compress the tool observation to a one-liner
        const compressed = compressObservation(toolName, toolInput, toolResponse);

        // Append to session activity log
        appendToActivityLog(sessionId, cwd, {
            tool: toolName,
            summary: compressed,
            timestamp: new Date().toISOString(),
            file: extractFilePath(toolInput),
        });

        // For file mutations, track which files were modified
        if (['edit', 'editfile', 'edit_file', 'write', 'writefile', 'write_file'].includes(toolLower)) {
            trackFileChange(sessionId, cwd, extractFilePath(toolInput), toolName);
        }

        writeOutput({});
    } catch (err) {
        debugLog(settings, 'Tool hook error', { error: err.message });
        writeOutput({});
    }
}

/**
 * Append compressed tool observation to session activity log.
 * The Stop hook reads this to enrich the session summary.
 */
function appendToActivityLog(sessionId, cwd, entry) {
    try {
        const stateDir = path.join(
            process.env.HOME || process.env.USERPROFILE || '',
            '.memorystack-claude'
        );
        if (!fs.existsSync(stateDir)) {
            fs.mkdirSync(stateDir, { recursive: true });
        }

        const logFile = path.join(stateDir, `activity-${sessionId}.jsonl`);
        fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
    } catch {
        // Non-critical
    }
}

/**
 * Track file changes per session for the summary
 */
function trackFileChange(sessionId, cwd, filePath, toolName) {
    if (!filePath) return;

    try {
        const stateDir = path.join(
            process.env.HOME || process.env.USERPROFILE || '',
            '.memorystack-claude'
        );
        const changesFile = path.join(stateDir, `changes-${sessionId}.json`);

        let changes = {};
        if (fs.existsSync(changesFile)) {
            try {
                changes = JSON.parse(fs.readFileSync(changesFile, 'utf8'));
            } catch { changes = {}; }
        }

        if (!changes[filePath]) {
            changes[filePath] = { edits: 0, writes: 0, firstSeen: new Date().toISOString() };
        }
        if (toolName.toLowerCase().includes('edit')) {
            changes[filePath].edits++;
        } else {
            changes[filePath].writes++;
        }
        changes[filePath].lastSeen = new Date().toISOString();

        fs.writeFileSync(changesFile, JSON.stringify(changes, null, 2));
    } catch {
        // Non-critical
    }
}

function extractFilePath(input) {
    return input?.file_path || input?.filePath || input?.path || input?.file || null;
}

main().catch(() => process.exit(0));
