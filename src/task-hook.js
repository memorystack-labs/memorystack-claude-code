/**
 * Task Hook — TaskCompleted
 * 
 * Fires when an agent team task is completed.
 * Auto-saves the completed task as project knowledge.
 * 
 * Input includes:
 * - task_id: unique task identifier
 * - task_subject: what was completed
 * - task_description: task details
 * - teammate_name: who completed it
 * - team_name: team context
 */
const { MemoryStackClientWrapper, TASK_ENTITY_CONTEXT } = require('./lib/memorystack-client');
const { loadSettings, getApiKey, getProjectName, debugLog } = require('./lib/settings');
const { readStdin, writeOutput } = require('./lib/stdin');

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

        // Build structured task completion memory
        const parts = [`[Task Completed] ${taskSubject}`];
        if (taskDescription) parts.push(`Description: ${taskDescription}`);
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

main().catch(() => process.exit(0));
