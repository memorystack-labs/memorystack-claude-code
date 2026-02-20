const { MemoryStackClientWrapper, MANUAL_ENTITY_CONTEXT } = require('./lib/memorystack-client');
const { loadSettings, getApiKey, getProjectName } = require('./lib/settings');

async function main() {
    const content = process.argv.slice(2).join(' ');

    if (!content || !content.trim()) {
        console.log('No content provided. Usage: node add-memory.cjs "content to save"');
        return;
    }

    const settings = loadSettings();

    let apiKey;
    try {
        apiKey = getApiKey(settings);
    } catch {
        console.log('MemoryStack API key not configured.');
        console.log('Set MEMORYSTACK_API_KEY environment variable to enable memory.');
        console.log('Get your key at: https://memorystack.app/dashboard/api-keys');
        return;
    }

    const cwd = process.cwd();
    const projectName = getProjectName(cwd);

    try {
        const client = new MemoryStackClientWrapper(apiKey, { projectName });
        const result = await client.addMemory(content, { type: 'manual', extractionContext: MANUAL_ENTITY_CONTEXT });

        console.log(`Memory saved to project: ${projectName}`);
        console.log(`ID: ${result.id || 'created'}`);
        console.log(`Memories created: ${result.count || 1}`);
    } catch (err) {
        console.log(`Error saving memory: ${err.message}`);
    }
}

main().catch((err) => {
    console.error(`Fatal error: ${err.message}`);
    process.exit(1);
});
