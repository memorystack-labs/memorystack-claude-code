const fs = require('fs');
const { MemoryStackClientWrapper } = require('./lib/memorystack-client');
const { loadSettings, getApiKey, debugLog, getProjectName } = require('./lib/settings');
const { readStdin, writeOutput } = require('./lib/stdin');
const { formatTranscriptSmart } = require('./lib/transcript-formatter');

async function main() {
    const settings = loadSettings();

    try {
        const input = await readStdin();
        const cwd = input.cwd || process.cwd();
        const sessionId = input.session_id;
        const transcriptPath = input.transcript_path;

        debugLog(settings, 'Stop', { sessionId, transcriptPath });

        if (!transcriptPath || !sessionId) {
            debugLog(settings, 'Missing transcript path or session id');
            writeOutput({ continue: true });
            return;
        }

        let apiKey;
        try {
            apiKey = getApiKey(settings);
        } catch {
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

        // Use smart transcript formatter (signal extraction → full capture fallback)
        const result = formatTranscriptSmart(transcriptContent, projectName, {
            signalKeywords: settings.signalKeywords,
            turnsBefore: settings.turnsBefore,
            captureTools: settings.captureTools,
        });

        if (!result) {
            debugLog(settings, 'No meaningful content to save');
            writeOutput({ continue: true });
            return;
        }

        debugLog(settings, 'Transcript formatted', {
            mode: result.mode,
            length: result.content.length,
        });

        const client = new MemoryStackClientWrapper(apiKey, {
            projectName,
            debug: settings.debug,
        });

        await client.addMemory(result.content, {
            type: 'session_turn',
            sessionId,
            captureMode: result.mode,
            memoryType: result.mode === 'signal' ? 'knowledge' : 'episodic',
        });

        debugLog(settings, 'Session saved', {
            mode: result.mode,
            length: result.content.length,
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
