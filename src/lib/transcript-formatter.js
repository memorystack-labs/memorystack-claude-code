/**
 * Transcript Formatter
 * Intelligent transcript capture with signal-based extraction,
 * UUID tracking for dedup, turn grouping, and tool compression.
 *
 * Built for MemoryStack's cognitive engine — supports importance
 * scoring, memory types, and multi-level scoping.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { compressObservation } = require('./compress');

const STATE_DIR = path.join(os.homedir(), '.memorystack-claude');
const STATE_FILE = path.join(STATE_DIR, 'capture-state.json');

// ─── UUID / State Tracking ─────────────────────────────────────────

function getCaptureState(projectKey) {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
            return data[projectKey] || {};
        }
    } catch { /* ignore */ }
    return {};
}

function saveCaptureState(projectKey, state) {
    try {
        if (!fs.existsSync(STATE_DIR)) {
            fs.mkdirSync(STATE_DIR, { recursive: true });
        }
        let data = {};
        try {
            if (fs.existsSync(STATE_FILE)) {
                data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
            }
        } catch { /* ignore */ }

        data[projectKey] = { ...state, updatedAt: new Date().toISOString() };
        fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2));
    } catch { /* ignore */ }
}

function getLastCapturedIndex(projectKey) {
    const state = getCaptureState(projectKey);
    return state.lastCapturedIndex || 0;
}

function setLastCapturedIndex(projectKey, index) {
    const state = getCaptureState(projectKey);
    state.lastCapturedIndex = index;
    saveCaptureState(projectKey, state);
}

// ─── Transcript Parsing ─────────────────────────────────────────────

/**
 * Parse raw transcript content into structured entries
 * Claude Code transcripts are JSONL with role-based messages
 */
function parseTranscript(content) {
    if (!content || typeof content !== 'string') return [];

    const entries = [];
    const lines = content.split('\n').filter(l => l.trim());

    for (let i = 0; i < lines.length; i++) {
        try {
            const entry = JSON.parse(lines[i]);
            entries.push({
                index: i,
                ...entry,
            });
        } catch {
            // Not JSON — treat as plain text line
            entries.push({
                index: i,
                type: 'text',
                content: lines[i],
            });
        }
    }

    return entries;
}

/**
 * Get entries since last capture (dedup)
 */
function getNewEntries(entries, lastCapturedIndex) {
    return entries.filter(e => e.index >= lastCapturedIndex);
}

// ─── Turn Grouping ──────────────────────────────────────────────────

/**
 * Group entries into conversational turns (user → assistant sequences)
 */
function groupIntoTurns(entries) {
    const turns = [];
    let currentTurn = null;

    for (const entry of entries) {
        const role = entry.role || entry.type || 'unknown';

        if (role === 'user' || role === 'human') {
            // Start a new turn
            if (currentTurn) {
                turns.push(currentTurn);
            }
            currentTurn = {
                userMessage: extractContent(entry),
                assistantMessage: '',
                tools: [],
                startIndex: entry.index,
                endIndex: entry.index,
            };
        } else if (role === 'assistant' && currentTurn) {
            currentTurn.assistantMessage += extractContent(entry) + '\n';
            currentTurn.endIndex = entry.index;
        } else if (role === 'tool_use' || role === 'tool_result') {
            if (currentTurn) {
                currentTurn.tools.push({
                    name: entry.name || entry.tool_name || 'unknown',
                    input: entry.input || entry.tool_input || {},
                    output: truncateOutput(entry.output || entry.content || ''),
                });
                currentTurn.endIndex = entry.index;
            }
        } else if (currentTurn) {
            // Unknown role — append to current turn
            currentTurn.assistantMessage += extractContent(entry) + '\n';
            currentTurn.endIndex = entry.index;
        }
    }

    // Push final turn
    if (currentTurn) {
        turns.push(currentTurn);
    }

    return turns;
}

function extractContent(entry) {
    if (typeof entry.content === 'string') return entry.content;
    if (Array.isArray(entry.content)) {
        return entry.content
            .filter(b => b.type === 'text')
            .map(b => b.text)
            .join('\n');
    }
    if (entry.message) return entry.message;
    return '';
}

function truncateOutput(output) {
    if (!output) return '';
    if (typeof output !== 'string') output = JSON.stringify(output);
    return output.slice(0, 500);
}

// ─── Signal-Based Extraction ────────────────────────────────────────

const DEFAULT_SIGNAL_KEYWORDS = [
    'remember', 'important', 'note',
    'architecture', 'decision', 'convention',
    'bug', 'fix', 'pattern', 'refactor',
    'todo', 'learned', 'figured out',
    'design', 'tradeoff', 'prefer',
];

/**
 * Find turn indices that contain signal keywords
 */
function findSignalTurns(turns, keywords) {
    const signalIndices = [];

    for (let i = 0; i < turns.length; i++) {
        const turn = turns[i];
        const text = (turn.userMessage + ' ' + turn.assistantMessage).toLowerCase();

        for (const keyword of keywords) {
            if (text.includes(keyword.toLowerCase())) {
                signalIndices.push(i);
                break;
            }
        }
    }

    return signalIndices;
}

/**
 * Get turns around signal indices (with context window)
 */
function getTurnsAroundSignals(turns, signalIndices, turnsBefore = 1) {
    const includeSet = new Set();

    for (const idx of signalIndices) {
        // Include turns before for context
        for (let i = Math.max(0, idx - turnsBefore); i <= idx; i++) {
            includeSet.add(i);
        }
    }

    // Return in order
    return Array.from(includeSet)
        .sort((a, b) => a - b)
        .map(i => turns[i]);
}

// ─── Formatting ─────────────────────────────────────────────────────

/**
 * Format a turn into a concise memory-ready string
 */
function formatTurn(turn, options = {}) {
    const { includeTools = true, captureTools = [] } = options;
    const parts = [];

    // User message
    if (turn.userMessage) {
        const cleanUser = turn.userMessage.trim().slice(0, 500);
        parts.push(`User: ${cleanUser}`);
    }

    // Tool observations (compressed)
    if (includeTools && turn.tools.length > 0) {
        const relevantTools = captureTools.length > 0
            ? turn.tools.filter(t => captureTools.some(ct =>
                t.name.toLowerCase().includes(ct.toLowerCase())))
            : turn.tools;

        if (relevantTools.length > 0) {
            const compressed = relevantTools.map(t =>
                compressObservation(t.name, t.input, t.output)
            );
            parts.push(`Tools: ${compressed.join('; ')}`);
        }
    }

    // Assistant message (truncated)
    if (turn.assistantMessage) {
        const cleanAssistant = turn.assistantMessage.trim().slice(0, 500);
        parts.push(`Assistant: ${cleanAssistant}`);
    }

    return parts.join('\n');
}

// ─── Main Export Functions ───────────────────────────────────────────

/**
 * Format all new entries since last capture (full capture mode)
 */
function formatNewEntries(transcriptContent, projectKey, options = {}) {
    const entries = parseTranscript(transcriptContent);
    if (entries.length === 0) return null;

    const lastIndex = getLastCapturedIndex(projectKey);
    const newEntries = getNewEntries(entries, lastIndex);

    if (newEntries.length < 3) return null;

    const turns = groupIntoTurns(newEntries);
    if (turns.length === 0) return null;

    const formatted = turns
        .map(t => formatTurn(t, options))
        .filter(f => f.length > 20)
        .join('\n---\n');

    if (!formatted || formatted.length < 50) return null;

    // Update state
    const maxIndex = Math.max(...entries.map(e => e.index));
    setLastCapturedIndex(projectKey, maxIndex + 1);

    return formatted.slice(0, 4000); // Cap total size
}

/**
 * Format entries using signal-based extraction (smart capture mode)
 */
function formatSignalEntries(transcriptContent, projectKey, options = {}) {
    const {
        signalKeywords = DEFAULT_SIGNAL_KEYWORDS,
        turnsBefore = 1,
        captureTools = [],
    } = options;

    const entries = parseTranscript(transcriptContent);
    if (entries.length === 0) return null;

    const lastIndex = getLastCapturedIndex(projectKey);
    const newEntries = getNewEntries(entries, lastIndex);

    if (newEntries.length < 2) return null;

    const turns = groupIntoTurns(newEntries);
    if (turns.length === 0) return null;

    // Find signal turns
    const signalIndices = findSignalTurns(turns, signalKeywords);
    if (signalIndices.length === 0) return null;

    // Get turns around signals for context
    const relevantTurns = getTurnsAroundSignals(turns, signalIndices, turnsBefore);

    const formatted = relevantTurns
        .map(t => formatTurn(t, { includeTools: true, captureTools }))
        .filter(f => f.length > 20)
        .join('\n---\n');

    if (!formatted || formatted.length < 50) return null;

    // Update state
    const maxIndex = Math.max(...entries.map(e => e.index));
    setLastCapturedIndex(projectKey, maxIndex + 1);

    return formatted.slice(0, 4000);
}

/**
 * Smart formatter — tries signal extraction first, falls back to full capture
 */
function formatTranscriptSmart(transcriptContent, projectKey, options = {}) {
    // Try signal extraction first
    const signalResult = formatSignalEntries(transcriptContent, projectKey, options);
    if (signalResult) {
        return { content: signalResult, mode: 'signal' };
    }

    // Fall back to full capture
    const fullResult = formatNewEntries(transcriptContent, projectKey, options);
    if (fullResult) {
        return { content: fullResult, mode: 'full' };
    }

    return null;
}

module.exports = {
    parseTranscript,
    groupIntoTurns,
    findSignalTurns,
    getTurnsAroundSignals,
    formatTurn,
    formatNewEntries,
    formatSignalEntries,
    formatTranscriptSmart,
    getLastCapturedIndex,
    setLastCapturedIndex,
    DEFAULT_SIGNAL_KEYWORDS,
};
