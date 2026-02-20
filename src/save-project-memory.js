const { MemoryStackClientWrapper } = require('./lib/memorystack-client');
const { loadSettings, getApiKey, getProjectName } = require('./lib/settings');

async function main() {
    const content = process.argv.slice(2).join(' ');

    if (!content || !content.trim()) {
        console.log('No content provided. Usage: node save-project-memory.cjs "content to save"');
        return;
    }

    const settings = loadSettings();

    let apiKey;
    try {
        apiKey = getApiKey(settings);
    } catch {
        console.log('MemoryStack API key not configured.');
        console.log('Set MEMORYSTACK_API_KEY or visit: https://memorystack.app/dashboard/api-keys');
        return;
    }

    const cwd = process.cwd();
    const projectName = getProjectName(cwd);

    try {
        const client = new MemoryStackClientWrapper(apiKey, { projectName, cwd });
        const result = await client.addMemory(content, {
            type: 'project-knowledge',
            scope: 'project',  // Goes to team/project scope
            memoryType: 'knowledge',
        });

        console.log(`✅ Project knowledge saved: ${projectName}`);
        console.log(`   ID: ${result.id || 'created'}`);
        console.log(`   Scope: project (shared with team)`);
    } catch (err) {
        console.log(`Error saving: ${err.message}`);
    }
}

main().catch((err) => {
    console.error(`Fatal: ${err.message}`);
    process.exit(1);
});
