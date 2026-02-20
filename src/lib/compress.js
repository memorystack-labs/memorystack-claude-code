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

    try {
        switch (name) {
            case 'edit':
            case 'editfile':
            case 'edit_file':
                return compressEdit(input, output);

            case 'write':
            case 'writefile':
            case 'write_to_file':
            case 'createfile':
                return compressWrite(input, output);

            case 'read':
            case 'readfile':
            case 'read_file':
            case 'view':
                return compressRead(input, output);

            case 'bash':
            case 'terminal':
            case 'execute_command':
                return compressBash(input, output);

            case 'glob':
            case 'search':
            case 'find':
            case 'list':
            case 'listdir':
                return compressSearch(input, output);

            case 'grep':
            case 'ripgrep':
                return compressGrep(input, output);

            default:
                return compressGeneric(toolName, input, output);
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
    const cmd = truncate(input?.command || input?.cmd || '', 60);
    const result = truncate(output || '', 60);

    if (cmd && result) {
        return `Ran: ${cmd} → ${result}`;
    }
    return `Ran: ${cmd || 'command'}`;
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

module.exports = { compressObservation, getObservationMetadata };
