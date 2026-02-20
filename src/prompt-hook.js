/**
 * Prompt Hook — UserPromptSubmit
 * 
 * Fires when the user submits a prompt, BEFORE Claude processes it.
 * 
 * What we do:
 * 1. Check for signal keywords (e.g. "remember", "save", "architecture decision")
 * 2. Search MemoryStack for relevant context based on the prompt
 * 3. Return additionalContext with matching memories
 * 4. Flag the turn for capture in session state
 */
const { MemoryStackClientWrapper } = require('./lib/memorystack-client');
const { loadSettings, getApiKey, getProjectName, debugLog } = require('./lib/settings');
const { readStdin, writeOutput } = require('./lib/stdin');
const fs = require('fs');
const path = require('path');

// Signal keywords that indicate the user wants something remembered
const SAVE_SIGNALS = [
    'remember this', 'save this', 'note this', 'store this',
    'remember that', 'save that', 'keep this in mind',
    'important:', 'decision:', 'convention:',
];

const SEARCH_SIGNALS = [
    'what did i', 'what have i', 'last time', 'previously',
    'how did we', 'remind me', 'do you remember', 'recall',
    'search memory', 'search memories', 'look up',
];

async function main() {
    const settings = loadSettings();

    try {
        const input = await readStdin();
        const prompt = input.prompt || '';
        const cwd = input.cwd || process.cwd();
        const sessionId = input.session_id || '';
        const projectName = getProjectName(cwd);

        if (!prompt.trim()) {
            writeOutput({});
            return;
        }

        debugLog(settings, 'UserPromptSubmit', { promptLength: prompt.length, sessionId });

        const promptLower = prompt.toLowerCase();

        // Check for save signals — flag the turn for capture
        const hasSaveSignal = SAVE_SIGNALS.some(s => promptLower.includes(s));
        if (hasSaveSignal) {
            flagTurnForCapture(cwd, sessionId, prompt);
            debugLog(settings, 'Save signal detected in prompt');
        }

        // Check for search signals — proactively search memory
        const hasSearchSignal = SEARCH_SIGNALS.some(s => promptLower.includes(s));

        let apiKey;
        try {
            apiKey = getApiKey(settings);
        } catch {
            // No API key — skip memory features
            writeOutput({});
            return;
        }

        // If search-related prompt, inject relevant memories
        if (hasSearchSignal || shouldEnrichPrompt(promptLower)) {
            const client = new MemoryStackClientWrapper(apiKey, { projectName, cwd });

            try {
                const results = await client.search(prompt, {
                    limit: 3,
                    scope: 'both',
                });

                if (results.results?.length > 0) {
                    const memories = results.results
                        .map((m, i) => `${i + 1}. ${m.content}`)
                        .join('\n');

                    writeOutput({
                        hookSpecificOutput: {
                            hookEventName: 'UserPromptSubmit',
                            additionalContext: `<memorystack-recall>\nRelevant memories for this prompt:\n${memories}\n</memorystack-recall>`,
                        },
                    });
                    return;
                }
            } catch (err) {
                debugLog(settings, 'Search failed in prompt hook', { error: err.message });
            }
        }

        writeOutput({});
    } catch (err) {
        debugLog(settings, 'Prompt hook error', { error: err.message });
        writeOutput({});
    }
}

/**
 * Flag the current turn for capture — writes to session state file
 * so the Stop hook knows to prioritize this turn
 */
function flagTurnForCapture(cwd, sessionId, prompt) {
    try {
        const stateDir = path.join(
            process.env.HOME || process.env.USERPROFILE || '',
            '.memorystack-claude'
        );
        if (!fs.existsSync(stateDir)) {
            fs.mkdirSync(stateDir, { recursive: true });
        }

        const flagFile = path.join(stateDir, `flagged-${sessionId}.json`);
        let flags = [];
        if (fs.existsSync(flagFile)) {
            try {
                flags = JSON.parse(fs.readFileSync(flagFile, 'utf8'));
            } catch { flags = []; }
        }

        flags.push({
            timestamp: new Date().toISOString(),
            prompt: prompt.slice(0, 200),
            type: 'user-signal',
        });

        // Keep only last 20 flags per session
        if (flags.length > 20) flags = flags.slice(-20);

        fs.writeFileSync(flagFile, JSON.stringify(flags, null, 2));
    } catch {
        // Non-critical, silently fail
    }
}

/**
 * Decide if we should enrich this prompt with memory context
 * Heuristic: prompts that mention past work, specific terms, or ask about history
 */
function shouldEnrichPrompt(promptLower) {
    const enrichPatterns = [
        /\b(yesterday|last week|last session|earlier|before)\b/,
        /\b(architecture|pattern|decision|convention|approach)\b/,
        /\bhow (do|did|should) (we|i|you)\b/,
        /\bwhy (do|did|is|was|were)\b/,
    ];
    return enrichPatterns.some(p => p.test(promptLower));
}

main().catch(() => process.exit(0));
