const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.memorystack-claude');
const SETTINGS_FILE = path.join(CONFIG_DIR, 'settings.json');
const CREDENTIALS_FILE = path.join(CONFIG_DIR, 'credentials.json');

/**
 * Load settings from config file
 */
function loadSettings() {
    const defaults = {
        skipTools: ['Read', 'Glob', 'Grep'],
        captureTools: ['Edit', 'Write', 'Bash', 'Task'],
        maxContextResults: 5,
        debug: process.env.MEMORYSTACK_DEBUG === 'true',
        // Signal extraction config
        signalKeywords: [
            'remember', 'important', 'note',
            'architecture', 'decision', 'convention',
            'bug', 'fix', 'pattern', 'refactor',
            'todo', 'learned', 'figured out',
            'design', 'tradeoff', 'prefer',
        ],
        turnsBefore: 3,
        sourceVersion: '0.2.0',
        captureMode: 'smart', // 'smart' (signal → full fallback), 'signal', 'full'
    };

    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            const content = fs.readFileSync(SETTINGS_FILE, 'utf8');
            return { ...defaults, ...JSON.parse(content) };
        }
    } catch (err) {
        // Ignore errors, use defaults
    }

    return defaults;
}

/**
 * Get API key from environment or credentials file
 */
function getApiKey(settings) {
    // 1. Check environment variable
    const envKey = process.env.MEMORYSTACK_API_KEY;
    if (envKey) {
        return envKey;
    }

    // 2. Check credentials file
    try {
        if (fs.existsSync(CREDENTIALS_FILE)) {
            const content = fs.readFileSync(CREDENTIALS_FILE, 'utf8');
            const creds = JSON.parse(content);
            if (creds.apiKey) {
                return creds.apiKey;
            }
        }
    } catch (err) {
        // Ignore errors
    }

    throw new Error('MEMORYSTACK_API_KEY not found');
}

/**
 * Save API key to credentials file
 */
function saveApiKey(apiKey) {
    try {
        if (!fs.existsSync(CONFIG_DIR)) {
            fs.mkdirSync(CONFIG_DIR, { recursive: true });
        }
        fs.writeFileSync(
            CREDENTIALS_FILE,
            JSON.stringify({ apiKey, savedAt: new Date().toISOString() }, null, 2)
        );
        return true;
    } catch (err) {
        console.error('Failed to save credentials:', err.message);
        return false;
    }
}

/**
 * Debug logging helper
 */
function debugLog(settings, message, data) {
    if (settings.debug) {
        console.error(`[MemoryStack Debug] ${message}`, data || '');
    }
}

/**
 * Get project name from cwd
 */
function getProjectName(cwd) {
    // Try package.json first
    try {
        const pkgPath = path.join(cwd, 'package.json');
        if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            if (pkg.name) return pkg.name;
        }
    } catch (err) {
        // Ignore
    }

    // Fall back to folder name
    return path.basename(cwd);
}

module.exports = {
    loadSettings,
    getApiKey,
    saveApiKey,
    debugLog,
    getProjectName,
    CONFIG_DIR,
    SETTINGS_FILE,
    CREDENTIALS_FILE,
};
