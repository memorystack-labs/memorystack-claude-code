const { MemoryStackClient } = require('@memorystack/sdk');
const crypto = require('crypto');
const { execSync } = require('child_process');

const DEFAULT_BASE_URL = 'https://memorystack.app';

// ─── Entity Context Extraction Prompts ──────────────────────────────────
// These guide the backend's cognitive engine on HOW to extract and classify
// knowledge from raw transcript content based on the source type.

const PERSONAL_ENTITY_CONTEXT = `EXTRACT from this developer session — focus on DURABLE knowledge:

HIGH PRIORITY (always extract):
- Decision rationale: WHY the developer chose a specific approach, tool, or pattern
  Example: "Chose Zustand over Redux because this app has simple state with no middleware needs"
- Debugging lessons: What broke, root cause, and how to prevent it next time
  Example: "CORS error was caused by missing credentials:include — always set this for cookie-based auth"
- Gotchas & warnings: Things that were unexpectedly tricky or have hidden requirements
  Example: "React 19 breaks class components in server component trees — must use function components"
- Workflow preferences: How this developer likes to work (not just tool names)
  Example: "Prefers writing tests before implementation, uses TDD for API endpoints"

MEDIUM PRIORITY:
- Solutions to specific problems that could recur
- Personal conventions that differ from defaults

SKIP:
- Generic facts the developer didn't act on
- Boilerplate code or standard operations
- Raw file contents or diffs (git tracks these)
- Routine tool outputs with no learning value`;

const PROJECT_ENTITY_CONTEXT = `EXTRACT from this project session — focus on INSTITUTIONAL knowledge:

HIGH PRIORITY (always extract):
- Architecture decisions WITH rationale:
  Example: "PostgreSQL over MongoDB because the recommendation engine needs complex relational joins"
- Known gotchas & workarounds:
  Example: "The Redis cache must be cleared manually after staging deploy because CDN caches stale tokens for 15min"
- System boundaries & data flow:
  Example: "Auth tokens flow: mobile-app → api-gateway → user-service (JWT RS256, refresh via httpOnly cookies)"
- Critical file map: Which files contain important logic and WHY
  Example: "src/middleware/auth.ts is the single source of truth for JWT validation — all services import from here"

MEDIUM PRIORITY:
- Naming conventions, file organization patterns
- Build/deploy requirements and gotchas
- Integration points between services/modules
- Testing patterns specific to this project

SKIP:
- Individual line-level code changes (git tracks these)
- Temporary debugging that led nowhere
- Standard library usage unless project-specific
- Generic best practices not specific to THIS project`;

const TASK_ENTITY_CONTEXT = `This is a structured task completion record.
STORE as project knowledge with HIGH confidence.

EXTRACT ALL of these:
- Task goal: what was the objective
- Approach: HOW it was accomplished (not just "done")
- Key files: which files were created or significantly modified
- Blockers: any issues hit during execution and how they were resolved
- Lessons: anything learned that would help someone doing similar work
- Team context: who worked on it, what team

Do NOT decompose — this is already in final form.`;

const SUBAGENT_ENTITY_CONTEXT = `This is a subagent execution summary.
STORE as project observation with MEDIUM-HIGH confidence.

EXTRACT:
- Key discoveries: what the subagent found that a developer would want to know
- Architecture insights: module relationships, data flow, or patterns discovered
- File importance: which files are critical entry points or contain core logic
- Warnings: any problems, oddities, or tech debt the subagent noticed

Do NOT decompose — this is already summarized.`;

const MANUAL_ENTITY_CONTEXT = `This is user-curated content EXPLICITLY saved by the developer.
STORE with HIGHEST importance — the developer deliberately chose to preserve this.

Preserve the content as-is with minimal processing.
If it contains a decision, extract the rationale.
If it contains a warning, mark it as a gotcha.
This is the most valuable type of memory — treat it accordingly.`;

const SESSION_SUMMARY_CONTEXT = `EXTRACT from this session transcript — focus on LASTING value:

HIGH PRIORITY:
- Decisions made and WHY (architecture, tech choices, design patterns)
- Problems solved: what broke, root cause, fix applied
- Gotchas discovered: things that were harder than expected
- Knowledge gained: new understanding about the codebase or tools

MEDIUM PRIORITY:
- Files that were central to the work  
- Patterns established that future sessions should follow

SKIP:
- Play-by-play of what happened (too much noise)
- Routine file reads or directory listings
- Standard tool usage without learning value`;

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
            metadata: extraMetadata,
        } = opts;

        const metadata = {
            source: 'claude-code-plugin',
            source_version: sourceVersion || '0.2.0',
            project: this.projectName,
            timestamp: new Date().toISOString(),
            scope_id: scope === 'project' ? this.getProjectScopeId() : this.getPersonalScopeId(),
            // Merge extra metadata (agent_id, agent_type, task_id, teammate, team, etc.)
            ...(extraMetadata || {}),
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
    SESSION_SUMMARY_CONTEXT,
};
