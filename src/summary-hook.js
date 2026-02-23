const fs = require('fs');
const { MemoryStackClientWrapper } = require('./lib/memorystack-client');
const { loadSettings, getApiKey, debugLog, getProjectName } = require('./lib/settings');
const { readStdin, writeOutput } = require('./lib/stdin');
const { formatTranscriptSmart, formatSessionSummary } = require('./lib/transcript-formatter');

async function main() {
    const settings = loadSettings();

    try {
        const input = await readStdin();
        const cwd = input.cwd || process.cwd();
        const sessionId = input.session_id;
        const transcriptPath = input.transcript_path;
        const hookEvent = input.hook_event_name || 'Stop';
        const lastAssistantMessage = input.last_assistant_message || '';

        debugLog(settings, hookEvent, { sessionId, transcriptPath, hookEvent });

        if (!transcriptPath || !sessionId) {
            debugLog(settings, 'Missing transcript path or session id');
            writeOutput({ continue: true });
            return;
        }

        let apiKey;
        try {
            apiKey = getApiKey(settings);
        } catch {
            debugLog(settings, 'API key not found');
            writeOutput({ continue: true });
            return;
        }

        // Read transcript file
        let transcriptContent;
        try {
            if (!fs.existsSync(transcriptPath)) {
                debugLog(settings, 'Transcript file not found');
                writeOutput({ continue: true });
                return;
            }
            transcriptContent = fs.readFileSync(transcriptPath, 'utf8');
        } catch (err) {
            debugLog(settings, 'Failed to read transcript', { error: err.message });
            writeOutput({ continue: true });
            return;
        }

        const projectName = getProjectName(cwd);

        // Try smart formatter first (signal → incremental full)
        let content = null;
        let mode = 'unknown';

        const smartResult = formatTranscriptSmart(transcriptContent, projectName, {
            signalKeywords: settings.signalKeywords,
            turnsBefore: settings.turnsBefore,
            captureTools: settings.captureTools,
        });

        if (smartResult) {
            content = smartResult.content;
            mode = smartResult.mode;
        } else {
            // Fallback: full session summary (ignores lastCapturedIndex)
            const sessionSummary = formatSessionSummary(transcriptContent, {
                captureTools: settings.captureTools,
            });
            if (sessionSummary) {
                content = sessionSummary;
                mode = 'session';
            } else if (lastAssistantMessage && lastAssistantMessage.length > 50) {
                // Final fallback: use Claude Code's last assistant message
                content = `[Session Summary]\n${lastAssistantMessage.slice(0, 4000)}`;
                mode = 'last_message';
            }
        }

        if (!content) {
            debugLog(settings, 'No meaningful content to save');
            writeOutput({ continue: true });
            return;
        }

        debugLog(settings, 'Transcript formatted', {
            mode,
            length: content.length,
        });

        const client = new MemoryStackClientWrapper(apiKey, {
            projectName,
            debug: settings.debug,
        });

        await client.addMemory(content, {
            type: 'session_turn',
            sessionId,
            captureMode: mode,
            memoryType: mode === 'signal' ? 'knowledge' : 'episodic',
        });

        debugLog(settings, 'Session saved', {
            mode,
            length: content.length,
        });

        writeOutput({ continue: true });
    } catch (err) {
        debugLog(settings, 'Error', { error: err.message });
        console.error(`MemoryStack: ${err.message}`);
        writeOutput({ continue: true });
    }
}

main().catch((err) => {
    console.error(`MemoryStack fatal: ${err.message}`);
    process.exit(1);
});

