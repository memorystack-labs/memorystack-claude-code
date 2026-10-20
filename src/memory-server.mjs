import settingsModule from './lib/settings.js';
const { loadSettings, getApiKey } = settingsModule;
// Reuse existing locally saved credentials; never open a browser from a hook.
if (!process.env.MEMORYSTACK_API_KEY) {
  try { process.env.MEMORYSTACK_API_KEY = getApiKey(loadSettings()); }
  catch { process.stderr.write('MemoryStack: set MEMORYSTACK_API_KEY before enabling the MCP server.\n'); process.exit(1); }
}
await import('./engine/index.js');
