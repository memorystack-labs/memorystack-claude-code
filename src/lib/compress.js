/**
 * Tool Observation Compression
 * Reduces raw tool outputs to concise human-readable summaries.
 * Prevents memory bloat — tool outputs can be 10-50x larger than useful info.
 */

/**
 * Compress a tool observation into a concise summary
 * @param {string} toolName - Name of the tool (Edit, Write, Read, Bash, etc.)
 * @param {object} input - Tool input parameters
 * @param {string} output - Raw tool output (can be very large)
 * @returns {string} Compressed one-line summary
 */
function compressObservation(toolName, input, output) {
    const name = (toolName || '').toLowerCase();

    // Normalize output: Claude Code hook sends an object, not a string
    // e.g. { output: '...', stdout: '...', stderr: '...' }
    const outputStr = normalizeOutput(output);

    try {
        switch (name) {
            case 'edit':
            case 'editfile':
            case 'edit_file':
                return compressEdit(input, outputStr);

            case 'write':
            case 'writefile':
            case 'write_to_file':
            case 'createfile':
                return compressWrite(input, outputStr);

            case 'read':
            case 'readfile':
            case 'read_file':
            case 'view':
                return compressRead(input, outputStr);

            case 'bash':
            case 'terminal':
            case 'execute_command':
                return compressBash(input, outputStr);

            case 'glob':
            case 'search':
            case 'find':
            case 'list':
            case 'listdir':
                return compressSearch(input, outputStr);

            case 'grep':
            case 'ripgrep':
                return compressGrep(input, outputStr);

            default:
                return compressGeneric(toolName, input, outputStr);
        }
    } catch (err) {
        return `Used ${toolName || 'unknown tool'}`;
    }
}

function compressEdit(input, _output) {
    const file = extractFilePath(input);
    const oldText = truncate(input?.old_text || input?.old_string || input?.target || '', 40);
    const newText = truncate(input?.new_text || input?.new_string || input?.replacement || '', 40);

    if (oldText && newText) {
        return `Edited ${file}: '${oldText}' → '${newText}'`;
    }
    return `Edited ${file}`;
}

function compressWrite(input, _output) {
    const file = extractFilePath(input);
    const content = input?.content || input?.file_text || '';
    return `Created ${file} (${content.length} chars)`;
}

function compressRead(input, _output) {
    const file = extractFilePath(input);
    return `Read ${file}`;
}

function compressBash(input, output) {
    const cmd = truncate(input?.command || input?.cmd || input?.description || '', 60);
    const result = truncate(output || '', 60);

    if (cmd && result) {
        return `Ran: ${cmd} → ${result}`;
    }
    if (cmd) {
        return `Ran: ${cmd}`;
    }
    return `Ran bash command`;
}

function compressSearch(input, output) {
    const pattern = input?.pattern || input?.glob || input?.query || '';
    const count = (output || '').split('\n').filter(l => l.trim()).length;
    return `Searched '${truncate(pattern, 30)}' → ${count} results`;
}

function compressGrep(input, _output) {
    const query = input?.query || input?.pattern || '';
    const path = input?.path || input?.search_path || '';
    return `Grep '${truncate(query, 30)}' in ${extractBasename(path)}`;
}

function compressGeneric(toolName, input, output) {
    const summary = truncate(output || '', 60);
    return `${toolName}: ${summary || '(completed)'}`;
}

/**
 * Extract relevant metadata from tool input
 */
function getObservationMetadata(toolName, input) {
    const meta = {};
    const file = extractFilePath(input);
    if (file) meta.file = file;

    const cmd = input?.command || input?.cmd;
    if (cmd) meta.command = truncate(cmd, 100);

    return meta;
}

// --- Helpers ---

function extractFilePath(input) {
    if (!input) return 'unknown';
    const raw = input.file_path || input.path || input.file || input.filename || input.target_file || '';
    return extractBasename(raw);
}

function extractBasename(filePath) {
    if (!filePath) return 'unknown';
    const parts = filePath.replace(/\\/g, '/').split('/');
    // Return last 2 segments for context (e.g., "lib/auth.ts")
    return parts.slice(-2).join('/');
}

function truncate(text, maxLen) {
    if (!text) return '';
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean.length <= maxLen) return clean;
    return clean.slice(0, maxLen - 3) + '...';
}

/**
 * Normalize tool output from Claude Code hook format to a plain string.
 * Hook sends objects like { output: '...', stdout: '...' } instead of raw strings.
 */
function normalizeOutput(output) {
    if (!output) return '';
    if (typeof output === 'string') return output;
    if (typeof output === 'object') {
        // Try common response fields
        if (output.output) return String(output.output);
        if (output.stdout) return String(output.stdout);
        if (output.result) return String(output.result);
        if (output.content) return String(output.content);
        if (output.success !== undefined) return output.success ? 'success' : 'failed';
        // Last resort: stringify the object
        try { return JSON.stringify(output).slice(0, 200); } catch { return ''; }
    }
    return String(output);
}

module.exports = { compressObservation, getObservationMetadata };
