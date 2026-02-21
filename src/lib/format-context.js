/**
 * Context Formatter
 * Structures memories into categorized, actionable sections for Claude's context.
 * Separates: Architecture & Decisions → Warnings & Gotchas → Conventions → Recent Activity
 * 
 * This is the FIRST thing Claude sees about you and your project.
 * Make it count — categorized knowledge > flat bullet lists.
 */

// ─── Memory Classification ─────────────────────────────────────────

/**
 * Classify a memory into a category based on content analysis
 */
function classifyMemory(memory) {
    const content = (memory.content || '').toLowerCase();
    const type = (memory.memoryType || memory.memory_type || '').toLowerCase();

    // Task completions
    if (type === 'task-completion' || content.includes('[task completed]')) {
        return 'work';
    }

    // Subagent results
    if (type === 'subagent-result' || content.includes('[subagent:')) {
        return 'discovery';
    }

    // Decisions & Architecture (high-value)
    if (
        content.includes('decision') || content.includes('chose') ||
        content.includes('instead of') || content.includes('over ') ||
        content.includes('because') || content.includes('rationale') ||
        content.includes('architecture') || content.includes('design') ||
        content.includes('data flow') || content.includes('system boundary')
    ) {
        return 'decision';
    }

    // Warnings & Gotchas (high-value)
    if (
        content.includes('gotcha') || content.includes('watch out') ||
        content.includes('careful') || content.includes('workaround') ||
        content.includes('bug') || content.includes('breaks') ||
        content.includes('tricky') || content.includes('caveat') ||
        content.includes('must ') || content.includes('always ') ||
        content.includes('never ') || content.includes('warning')
    ) {
        return 'warning';
    }

    // Conventions & Patterns
    if (
        content.includes('convention') || content.includes('pattern') ||
        content.includes('prefers') || content.includes('uses ') ||
        content.includes('style') || content.includes('format') ||
        content.includes('eslint') || content.includes('prettier') ||
        content.includes('typescript') || content.includes('framework')
    ) {
        return 'convention';
    }

    // Default: general knowledge
    return 'knowledge';
}

// ─── Profile Context (SessionStart) ─────────────────────────────────

/**
 * Format a full profile into structured, categorized context
 * @param {object} profile - { personal, project, recent } from getProfile()
 * @returns {string} Formatted XML context string
 */
function formatProfileContext(profile) {
    const allMemories = [];

    // Collect all memories with their source
    if (profile.personal?.length > 0) {
        profile.personal.forEach(m => allMemories.push({ ...m, source: 'personal' }));
    }
    if (profile.project?.length > 0) {
        profile.project.forEach(m => allMemories.push({ ...m, source: 'project' }));
    }

    // Categorize
    const categories = {
        decision: [],
        warning: [],
        convention: [],
        discovery: [],
        work: [],
        knowledge: [],
    };

    for (const m of allMemories) {
        const cat = classifyMemory(m);
        categories[cat].push(m);
    }

    const sections = [];

    // 🏗️ Decisions & Architecture (most valuable)
    if (categories.decision.length > 0) {
        const items = categories.decision.map(m => `- ${m.content}`);
        sections.push(`## 🏗️ Architecture & Decisions\n${items.join('\n')}`);
    }

    // ⚠️ Warnings & Gotchas (prevent mistakes)
    if (categories.warning.length > 0) {
        const items = categories.warning.map(m => `- ${m.content}`);
        sections.push(`## ⚠️ Warnings & Gotchas\n${items.join('\n')}`);
    }

    // 🔧 Conventions & Patterns (how things are done)
    if (categories.convention.length > 0) {
        const items = categories.convention.map(m => `- ${m.content}`);
        sections.push(`## 🔧 Conventions & Patterns\n${items.join('\n')}`);
    }

    // 🔍 Discoveries (subagent findings)
    if (categories.discovery.length > 0) {
        const items = categories.discovery.map(m => `- ${m.content}`);
        sections.push(`## 🔍 Discoveries\n${items.join('\n')}`);
    }

    // 📋 Recent Work (task completions)
    if (categories.work.length > 0) {
        const items = categories.work.map(m => `- ${m.content}`);
        sections.push(`## 📋 Recent Work\n${items.join('\n')}`);
    }

    // 📝 Other Knowledge
    if (categories.knowledge.length > 0) {
        const items = categories.knowledge.map(m => `- ${m.content}`);
        sections.push(`## 📝 Project Knowledge\n${items.join('\n')}`);
    }

    // Developer-specific preferences (always show separately if present)
    if (profile.personal?.length > 0) {
        const personalOnly = profile.personal.filter(m =>
            classifyMemory(m) === 'convention' || classifyMemory(m) === 'knowledge'
        );
        if (personalOnly.length > 0) {
            const items = personalOnly.map(m => `- ${m.content}`);
            sections.push(`## 👤 Developer Preferences\n${items.join('\n')}`);
        }
    }

    // Recent activity with timestamps
    if (profile.recent?.length > 0) {
        const items = profile.recent.map(m => {
            const ago = formatRelativeTime(m.createdAt);
            return `- ${m.content}${ago ? ` (${ago})` : ''}`;
        });
        sections.push(`## 🕐 Recent Activity\n${items.join('\n')}`);
    }

    if (sections.length === 0) {
        return formatEmptyContext();
    }

    return `<memorystack-context>
Here is what MemoryStack remembers about you and this project.
Use this to make informed decisions — especially the Decisions and Warnings sections.

${sections.join('\n\n')}

Reference these memories naturally when relevant. Pay special attention to ⚠️ warnings.
</memorystack-context>`;
}

/**
 * Format flat search results (fallback for simple searches)
 */
function formatContext(memories, showConfidence = false) {
    if (!memories || memories.length === 0) return null;

    const lines = memories.map((m, i) => {
        const content = m.content || m.memory || '';
        const type = m.memoryType || m.memory_type;
        const confidence = m.confidence;

        let line = `${i + 1}. ${content}`;
        if (type) line += ` [${type}]`;
        if (showConfidence && confidence) line += ` (${Math.round(confidence * 100)}%)`;

        return line;
    });

    return `<memorystack-context>
Relevant memories from MemoryStack:

${lines.join('\n')}

Use these memories naturally when relevant.
</memorystack-context>`;
}

/**
 * Format relative time (e.g., "2 hours ago", "3 days ago")
 */
function formatRelativeTime(dateStr) {
    if (!dateStr) return null;
    try {
        const date = new Date(dateStr);
        const now = new Date();
        const diffMs = now - date;
        const diffMin = Math.floor(diffMs / 60000);
        const diffHrs = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMin < 60) return `${diffMin}m ago`;
        if (diffHrs < 24) return `${diffHrs}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
        return `${Math.floor(diffDays / 30)}mo ago`;
    } catch {
        return null;
    }
}

function formatEmptyContext() {
    return `<memorystack-context>
No previous memories found for this project.
Memories will be saved automatically as you work — decisions, discoveries, and lessons learned.
</memorystack-context>`;
}

function formatErrorContext(errorMessage) {
    return `<memorystack-status>
Failed to load memories: ${errorMessage}
Session will continue without memory context.
</memorystack-status>`;
}

function formatAuthRequired(isTimeout = false) {
    return `<memorystack-status>
${isTimeout ? 'Authentication timed out.' : 'Authentication required.'}
Set MEMORYSTACK_API_KEY environment variable or visit:
https://memorystack.app/dashboard/api-keys
</memorystack-status>`;
}

module.exports = {
    formatProfileContext,
    formatContext,
    formatRelativeTime,
    formatEmptyContext,
    formatErrorContext,
    formatAuthRequired,
    classifyMemory,
};
