/**
 * Task Hook — TaskCompleted
 * 
 * Fires when an agent team task is completed.
 * Auto-saves the completed task as project knowledge with rich context:
 * - What was done (subject + description)
 * - How it was done (approach, files changed)
 * - What went wrong (blockers from session activity)
 * - Who did it (teammate, team)
 * 
 * This creates INSTITUTIONAL KNOWLEDGE, not just a log entry.
 */
const fs = require('fs');
const path = require('path');
const { MemoryStackClientWrapper, TASK_ENTITY_CONTEXT } = require('./lib/memorystack-client');
const { loadSettings, getApiKey, getProjectName, debugLog } = require('./lib/settings');
const { readStdin, writeOutput } = require('./lib/stdin');

const STATE_DIR = path.join(
    process.env.HOME || process.env.USERPROFILE || '',
    '.memorystack-claude'
);

async function main() {
    const settings = loadSettings();

    try {
        const input = await readStdin();
        const taskId = input.task_id || '';
        const taskSubject = input.task_subject || '';
        const taskDescription = input.task_description || '';
        const teammateName = input.teammate_name || '';
        const teamName = input.team_name || '';
        const sessionId = input.session_id || '';
        const cwd = input.cwd || process.cwd();
        const projectName = getProjectName(cwd);

        debugLog(settings, 'TaskCompleted', { taskId, taskSubject, teammateName, teamName });

        if (!taskSubject) {
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

        // Build rich task completion memory
        const parts = [`[Task Completed] ${taskSubject}`];
        if (taskDescription) parts.push(`Description: ${taskDescription}`);

        // Pull files changed from session state (tool-hook writes these)
        const filesChanged = getSessionFiles(sessionId);
        if (filesChanged.length > 0) {
            parts.push(`Files modified: ${filesChanged.join(', ')}`);
        }

        // Pull key activity from session log (compressed summaries)
        const keyActivity = getSessionHighlights(sessionId);
        if (keyActivity.length > 0) {
            parts.push(`Approach: ${keyActivity.join('; ')}`);
        }

        if (teammateName) parts.push(`Completed by: ${teammateName}`);
        if (teamName) parts.push(`Team: ${teamName}`);
        parts.push(`Date: ${new Date().toISOString().split('T')[0]}`);

        const content = parts.join('\n');

        // Save to MemoryStack as project-scoped knowledge
        const client = new MemoryStackClientWrapper(apiKey, { projectName, cwd });
        await client.addMemory(content, {
            type: 'task-completion',
            scope: 'project',
            memoryType: 'knowledge',
            sessionId: sessionId,
            extractionContext: TASK_ENTITY_CONTEXT,
            metadata: {
                task_id: taskId,
                teammate: teammateName,
                team: teamName,
            },
        });

        debugLog(settings, 'Task completion saved', { taskId, subject: taskSubject });
        writeOutput({});
    } catch (err) {
        debugLog(settings, 'Task hook error', { error: err.message });
        writeOutput({});
    }
}

/**
 * Read files changed during this session from the tool-hook state
 */
function getSessionFiles(sessionId) {
    try {
        const changesFile = path.join(STATE_DIR, `changes-${sessionId}.json`);
        if (!fs.existsSync(changesFile)) return [];
        const data = JSON.parse(fs.readFileSync(changesFile, 'utf8'));
        return Object.keys(data).slice(0, 15); // Cap at 15 files
    } catch {
        return [];
    }
}

/**
 * Extract key highlights from the session activity log
 * Returns the most meaningful compressed summaries (not routine reads)
 */
function getSessionHighlights(sessionId) {
    try {
        const activityFile = path.join(STATE_DIR, `activity-${sessionId}.jsonl`);
        if (!fs.existsSync(activityFile)) return [];
        const lines = fs.readFileSync(activityFile, 'utf8').trim().split('\n');

        const highlights = [];
        for (const line of lines) {
            try {
                const entry = JSON.parse(line);
                const summary = entry.summary || '';
                // Skip routine reads, only include meaningful actions
                if (summary && !summary.startsWith('Read ') && !summary.startsWith('Listed ')) {
                    highlights.push(summary);
                }
            } catch { /* skip */ }
        }

        // Return last 8 meaningful activities
        return highlights.slice(-8);
    } catch {
        return [];
    }
}

main().catch(() => process.exit(0));
