/**
 * Subagent Hook — SubagentStop
 * 
 * Fires when a subagent finishes its task.
 * Reads the subagent's separate transcript and saves a compressed
 * summary to MemoryStack under agent-scoped memory.
 * 
 * Input includes:
 * - agent_id: unique subagent identifier
 * - agent_type: "Bash" | "Explore" | "Plan" | custom
 * - agent_transcript_path: separate JSONL file for this subagent
 */
const { MemoryStackClientWrapper, SUBAGENT_ENTITY_CONTEXT } = require('./lib/memorystack-client');
const { loadSettings, getApiKey, getProjectName, debugLog } = require('./lib/settings');
const { readStdin, writeOutput } = require('./lib/stdin');
const fs = require('fs');
const path = require('path');

// Max lines to read from subagent transcript
const MAX_TRANSCRIPT_LINES = 100;
// Max summary length to save
const MAX_SUMMARY_LENGTH = 2000;

async function main() {
    const settings = loadSettings();

    try {
        const input = await readStdin();
        const agentId = input.agent_id || '';
        const agentType = input.agent_type || 'unknown';
        const agentTranscriptPath = input.agent_transcript_path || '';
        const sessionId = input.session_id || '';
        const cwd = input.cwd || process.cwd();
        const projectName = getProjectName(cwd);

        debugLog(settings, 'SubagentStop', { agentId, agentType, agentTranscriptPath });

        // Skip if no transcript path
        if (!agentTranscriptPath) {
            writeOutput({});
            return;
        }

        let apiKey;
        try {
            apiKey = getApiKey(settings);
        } catch {
            writeOutput({});
            return;
        }

        // Read subagent transcript
        const transcript = readSubagentTranscript(agentTranscriptPath);
        if (!transcript) {
            debugLog(settings, 'No transcript content for subagent', { agentId });
            writeOutput({});
            return;
        }

        // Build a focused summary of what the subagent did
        const summary = buildSubagentSummary(agentType, agentId, transcript);
        if (!summary) {
            writeOutput({});
            return;
        }

        // Save to MemoryStack with agent scope
        const client = new MemoryStackClientWrapper(apiKey, { projectName, cwd });

        await client.addMemory(summary, {
            type: 'subagent-result',
            scope: 'project',
            memoryType: 'observation',
            sessionId: sessionId,
            extractionContext: SUBAGENT_ENTITY_CONTEXT,
            metadata: {
                agent_id: agentId,
                agent_type: agentType,
            },
        });

        debugLog(settings, 'Subagent memory saved', { agentId, agentType, length: summary.length });
        writeOutput({});
    } catch (err) {
        debugLog(settings, 'Subagent hook error', { error: err.message });
        writeOutput({});
    }
}

/**
 * Read and parse subagent transcript JSONL file
 */
function readSubagentTranscript(transcriptPath) {
    try {
        if (!fs.existsSync(transcriptPath)) return null;

        const content = fs.readFileSync(transcriptPath, 'utf8');
        const lines = content.trim().split('\n').slice(-MAX_TRANSCRIPT_LINES);

        const entries = [];
        for (const line of lines) {
            try {
                const entry = JSON.parse(line);
                entries.push(entry);
            } catch {
                // Skip malformed lines
            }
        }

        return entries.length > 0 ? entries : null;
    } catch {
        return null;
    }
}

/**
 * Build a focused summary of what the subagent accomplished
 */
function buildSubagentSummary(agentType, agentId, entries) {
    const parts = [`[Subagent:${agentType}] (${agentId})`];

    // Extract assistant messages (the subagent's responses)
    const assistantMessages = entries
        .filter(e => e.role === 'assistant' && e.content)
        .map(e => {
            if (typeof e.content === 'string') return e.content;
            if (Array.isArray(e.content)) {
                return e.content
                    .filter(c => c.type === 'text')
                    .map(c => c.text)
                    .join(' ');
            }
            return '';
        })
        .filter(Boolean);

    // Extract tool uses (what files/commands were touched)
    const toolUses = entries
        .filter(e => e.role === 'assistant' && Array.isArray(e.content))
        .flatMap(e => e.content.filter(c => c.type === 'tool_use'))
        .map(t => {
            const name = t.name || 'unknown';
            const file = t.input?.file_path || t.input?.path || '';
            const cmd = t.input?.command || '';
            if (file) return `${name}: ${path.basename(file)}`;
            if (cmd) return `${name}: ${cmd.slice(0, 60)}`;
            return name;
        });

    if (toolUses.length > 0) {
        parts.push(`Actions: ${toolUses.slice(0, 10).join(', ')}`);
    }

    // Get the last assistant message as the conclusion
    if (assistantMessages.length > 0) {
        const lastMsg = assistantMessages[assistantMessages.length - 1];
        parts.push(`Result: ${lastMsg.slice(0, 500)}`);
    }

    const summary = parts.join('\n');
    return summary.length > MAX_SUMMARY_LENGTH
        ? summary.slice(0, MAX_SUMMARY_LENGTH) + '...'
        : summary;
}

main().catch(() => process.exit(0));
