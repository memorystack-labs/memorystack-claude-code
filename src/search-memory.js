const { MemoryStackClientWrapper } = require('./lib/memorystack-client');
const { loadSettings, getApiKey, getProjectName } = require('./lib/settings');

async function main() {
    // Parse args: [--personal|--project|--both] "query"
    const args = process.argv.slice(2);
    let scope = 'both';
    let queryParts = [];

    for (const arg of args) {
        if (arg === '--personal' || arg === '--user') {
            scope = 'personal';
        } else if (arg === '--project' || arg === '--repo') {
            scope = 'project';
        } else if (arg === '--both') {
            scope = 'both';
        } else {
            queryParts.push(arg);
        }
    }

    const query = queryParts.join(' ');

    if (!query || !query.trim()) {
        console.log('No search query provided.');
        console.log('Usage: node search-memory.cjs [--personal|--project|--both] "query"');
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
        const result = await client.search(query, { limit: 10, scope });

        const scopeLabel = scope === 'personal' ? '(personal)' :
            scope === 'project' ? '(project)' : '(all)';

        console.log(`## Memory Search: "${query}" ${scopeLabel}`);
        console.log(`Project: ${projectName}\n`);

        if (result.results?.length > 0) {
            console.log('### Relevant Memories');
            result.results.forEach((mem, i) => {
                const confidence = mem.confidence ? ` (${Math.round(mem.confidence * 100)}%)` : '';
                const type = mem.memoryType ? ` [${mem.memoryType}]` : '';
                const importance = mem.importanceScore > 0.7 ? ' ⭐' : '';
                console.log(`\n**Memory ${i + 1}**${type}${confidence}${importance}`);
                console.log(mem.content?.slice(0, 500) || '');
            });
        } else {
            console.log('No memories found matching your query.');
            console.log('Memories are saved automatically as you work.');
        }
    } catch (err) {
        console.log(`Error searching: ${err.message}`);
    }
}

main().catch((err) => {
    console.error(`Fatal: ${err.message}`);
    process.exit(1);
});
