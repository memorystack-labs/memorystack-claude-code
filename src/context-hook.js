const { MemoryStackClientWrapper } = require('./lib/memorystack-client');
const { loadSettings, getApiKey, debugLog, getProjectName } = require('./lib/settings');
const { readStdin, writeOutput } = require('./lib/stdin');
const { startAuthFlow } = require('./lib/auth');
const { formatProfileContext, formatEmptyContext, formatErrorContext, formatAuthRequired } = require('./lib/format-context');

async function main() {
    const settings = loadSettings();

    try {
        const input = await readStdin();
        const cwd = input.cwd || process.cwd();
        const projectName = getProjectName(cwd);

        debugLog(settings, 'SessionStart', { cwd, projectName });

        let apiKey;
        try {
            apiKey = getApiKey(settings);
        } catch {
            // Try browser auth flow
            try {
                debugLog(settings, 'No API key found, starting browser auth flow');
                apiKey = await startAuthFlow();
                debugLog(settings, 'Auth flow completed successfully');
            } catch (authErr) {
                const isTimeout = authErr.message === 'AUTH_TIMEOUT';
                writeOutput({
                    hookSpecificOutput: {
                        hookEventName: 'SessionStart',
                        additionalContext: formatAuthRequired(isTimeout),
                    },
                });
                return;
            }
        }

        const client = new MemoryStackClientWrapper(apiKey, {
            projectName,
            cwd,
            debug: settings.debug,
        });

        // Fetch structured profile (personal + project + recent in parallel)
        let additionalContext;
        try {
            const profile = await client.getProfile();

            const totalMemories =
                (profile.personal?.length || 0) +
                (profile.project?.length || 0) +
                (profile.recent?.length || 0);

            debugLog(settings, 'Profile fetched', {
                personal: profile.personal?.length || 0,
                project: profile.project?.length || 0,
                recent: profile.recent?.length || 0,
            });

            additionalContext = totalMemories > 0
                ? formatProfileContext(profile)
                : formatEmptyContext();
        } catch (err) {
            debugLog(settings, 'Profile fetch failed, falling back to search', { error: err.message });

            // Fallback: simple search (like before)
            try {
                const results = await client.search(
                    `${projectName} coding session context`,
                    { limit: settings.maxContextResults || 5 }
                );

                const { formatContext } = require('./lib/format-context');
                additionalContext = results.results?.length > 0
                    ? formatContext(results.results, false)
                    : formatEmptyContext();
            } catch {
                additionalContext = formatEmptyContext();
            }
        }

        writeOutput({
            hookSpecificOutput: {
                hookEventName: 'SessionStart',
                additionalContext,
            },
        });
    } catch (err) {
        debugLog(settings, 'Error', { error: err.message });
        console.error(`MemoryStack: ${err.message}`);
        writeOutput({
            hookSpecificOutput: {
                hookEventName: 'SessionStart',
                additionalContext: formatErrorContext(err.message),
            },
        });
    }
}

main().catch((err) => {
    console.error(`MemoryStack fatal: ${err.message}`);
    process.exit(1);
});
