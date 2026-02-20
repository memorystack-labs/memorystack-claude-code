const { MemoryStackClient } = require('@memorystack/sdk');
const crypto = require('crypto');
const { execSync } = require('child_process');

const DEFAULT_BASE_URL = 'https://memorystack.app';

// ─── Entity Context Extraction Prompts ──────────────────────────────────
// These guide the backend's cognitive engine on HOW to extract and classify
// knowledge from raw transcript content based on the source type.

const PERSONAL_ENTITY_CONTEXT = `EXTRACT from this developer session:
- Preferences: coding style, tool choices, workflow preferences
- Learnings: new concepts learned, problems solved, debugging insights
- Actions: what was built, refactored, or fixed
- Decisions: personal choices about approach, tools, or patterns

SKIP:
- Generic AI explanations the developer didn't act on
- Boilerplate code or standard operations
- File contents or raw diffs (git tracks these)
- Routine tool outputs`;

const PROJECT_ENTITY_CONTEXT = `EXTRACT from this project session:
- Architecture: system design, module structure, data flow
- Conventions: naming patterns, file organization, import style
- Decisions: why specific tech/patterns were chosen over alternatives
- Patterns: reusable approaches, error handling, auth flow
- Setup: environment requirements, build steps, deploy process
- Key files: where important logic lives and why

SKIP:
- Individual code changes (git tracks these)
- Temporary debugging steps
- Standard library usage
- Generic best practices not specific to this project`;

const TASK_ENTITY_CONTEXT = `This is a structured task completion record.
STORE as project knowledge with high confidence.
EXTRACT: task goal, approach used, files modified, team context.
Do NOT decompose — this is already in final form.`;

const SUBAGENT_ENTITY_CONTEXT = `This is a compressed subagent execution summary.
STORE as project observation.
EXTRACT: what the subagent accomplished, files touched, key findings.
Do NOT decompose — this is already summarized.`;

const MANUAL_ENTITY_CONTEXT = `This is user-curated content explicitly saved.
STORE with high importance — the user chose to save this deliberately.
Preserve the content as-is with minimal processing.`;

/**
 * MemoryStack Client Wrapper for Claude Code Plugin
 * Supports dual-scope (personal + project), scoping params, and search modes.
 */
class MemoryStackClientWrapper {
    constructor(apiKey, options = {}) {
        if (!apiKey) {
            throw new Error('API key is required');
        }

        const baseUrl = options.baseUrl || DEFAULT_BASE_URL;

        this.client = new MemoryStackClient({
            apiKey,
            baseUrl,
            enableLogging: options.debug || false,
        });

        // Store for direct API calls (SDK search() doesn't support metadata filters)
        this.apiKey = apiKey;
        this.baseUrl = baseUrl.endsWith('/api/v1') ? baseUrl : `${baseUrl}/api/v1`;

        this.projectName = options.projectName || 'claude-code';
        this.cwd = options.cwd || process.cwd();
        this.debug = options.debug || false;
    }

    /**
     * Generate a personal scope key (hash of project path)
     */
    getPersonalScopeId() {
        const hash = crypto.createHash('sha256').update(this.cwd).digest('hex').slice(0, 16);
        return `personal_${hash}`;
    }

    /**
     * Get git remote name for project scope (team/repo)
     */
    getProjectScopeId() {
        try {
            const remote = execSync('git remote get-url origin', {
                cwd: this.cwd,
                encoding: 'utf8',
                timeout: 3000,
            }).trim();

            // Sanitize: "github.com/user/repo.git" → "user_repo"
            const cleaned = remote
                .replace(/^.*[:/]/, '')     // Remove protocol + host
                .replace(/\.git$/, '')       // Remove .git suffix
                .replace(/[^a-zA-Z0-9_-]/g, '_')
                .toLowerCase();

            return `project_${cleaned}`;
        } catch {
            // Not a git repo — fall back to folder name
            return `project_${this.projectName.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
        }
    }

    /**
     * Add a memory with proper scoping
     * @param {string} content - Memory content
     * @param {object} opts - Options: type, sessionId, scope ('personal'|'project'|'both'), captureMode
     */
    async addMemory(content, opts = {}) {
        const {
            type = 'session_turn',
            sessionId,
            scope = 'personal',
            captureMode,
            memoryType,
            sourceVersion,
            extractionContext,
        } = opts;

        const metadata = {
            source: 'claude-code-plugin',
            source_version: sourceVersion || '0.2.0',
            project: this.projectName,
            timestamp: new Date().toISOString(),
            scope_id: scope === 'project' ? this.getProjectScopeId() : this.getPersonalScopeId(),
        };

        if (sessionId) metadata.sessionId = sessionId;
        if (captureMode) metadata.captureMode = captureMode;
        if (type) metadata.type = type;

        // Attach extraction context — tells backend how to process this content
        if (extractionContext) {
            metadata.extraction_context = extractionContext;
        } else {
            // Default extraction context based on scope
            metadata.extraction_context = scope === 'project'
                ? PROJECT_ENTITY_CONTEXT
                : PERSONAL_ENTITY_CONTEXT;
        }

        const addOpts = { metadata };
        if (memoryType) addOpts.memoryType = memoryType;

        const result = await this.client.add(content, addOpts);

        return {
            id: result.memory_ids?.[0],
            count: result.memories_created,
            success: result.success,
        };
    }

    /**
     * Search memories with scope filtering
     * Uses direct HTTP call to pass metadata filters (SDK search() drops them)
     * @param {string} query - Search query
     * @param {object} opts - Options: limit, scope, mode
     */
    async search(query, opts = {}) {
        const {
            limit = 5,
            scope = 'both',
            mode,
        } = typeof opts === 'number' ? { limit: opts } : opts;

        // Build URL with query params — direct API call bypasses SDK limitation
        const url = new URL(`${this.baseUrl}/memories/search`);
        url.searchParams.set('query', query);
        url.searchParams.set('limit', String(limit));
        url.searchParams.set('mode', mode || 'hybrid');

        // Add scope filtering via metadata query param
        if (scope === 'personal') {
            url.searchParams.set('metadata', JSON.stringify({ scope_id: this.getPersonalScopeId() }));
        } else if (scope === 'project') {
            url.searchParams.set('metadata', JSON.stringify({ scope_id: this.getProjectScopeId() }));
        }
        // 'both' — no metadata filter, search everything

        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'X-API-Key': this.apiKey,
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Search failed (${response.status}): ${errorBody}`);
        }

        const data = await response.json();

        return {
            count: data.count,
            results: (data.results || []).map((m) => ({
                id: m.id,
                content: m.content,
                memoryType: m.memory_type,
                confidence: m.confidence,
                importanceScore: m.importance_score,
                createdAt: m.created_at,
                metadata: m.metadata,
            })),
        };
    }

    /**
     * Get structured profile context (personal + project in parallel)
     */
    async getProfile() {
        const [personalResult, projectResult] = await Promise.allSettled([
            this.search(`coding preferences habits conventions`, {
                limit: 5,
                scope: 'personal',
            }),
            this.search(`${this.projectName} architecture patterns decisions`, {
                limit: 5,
                scope: 'project',
            }),
        ]);

        const personal = personalResult.status === 'fulfilled'
            ? personalResult.value.results
            : [];

        const project = projectResult.status === 'fulfilled'
            ? projectResult.value.results
            : [];

        // Get recent activity
        let recent = [];
        try {
            const recentResult = await this.search(
                `${this.projectName} recent work activity session`,
                { limit: 3, scope: 'personal' }
            );
            recent = recentResult.results || [];
        } catch { /* ignore */ }

        return { personal, project, recent };
    }
}

module.exports = {
    MemoryStackClientWrapper,
    PERSONAL_ENTITY_CONTEXT,
    PROJECT_ENTITY_CONTEXT,
    TASK_ENTITY_CONTEXT,
    SUBAGENT_ENTITY_CONTEXT,
    MANUAL_ENTITY_CONTEXT,
};
