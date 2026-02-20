/**
 * Context Formatter
 * Structures memories into categorized sections for Claude's context.
 * Separates: Personal Profile → Project Knowledge → Recent Activity
 */

/**
 * Format a full profile into structured context
 * @param {object} profile - { personal, project, recent } from getProfile()
 * @returns {string} Formatted XML context string
 */
function formatProfileContext(profile) {
    const sections = [];

    // Personal / Developer Profile
    if (profile.personal?.length > 0) {
        const items = profile.personal.map(m =>
            `- ${m.content}${m.memoryType ? ` [${m.memoryType}]` : ''}`
        );
        sections.push(`## Developer Profile\n${items.join('\n')}`);
    }

    // Project Knowledge (shared/team)
    if (profile.project?.length > 0) {
        const items = profile.project.map(m =>
            `- ${m.content}${m.memoryType ? ` [${m.memoryType}]` : ''}`
        );
        sections.push(`## Project Knowledge\n${items.join('\n')}`);
    }

    // Recent Activity
    if (profile.recent?.length > 0) {
        const items = profile.recent.map(m => {
            const ago = formatRelativeTime(m.createdAt);
            return `- ${m.content}${ago ? ` (${ago})` : ''}`;
        });
        sections.push(`## Recent Activity\n${items.join('\n')}`);
    }

    if (sections.length === 0) {
        return formatEmptyContext();
    }

    return `<memorystack-context>
The following is recalled context about the developer and this project.
Reference it naturally when relevant — don't force it.

${sections.join('\n\n')}

Use these memories to inform your responses. Don't repeat them verbatim.
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
The following is recalled context about the user and previous sessions.
Reference it only when relevant to the conversation.

## Relevant Memories
${lines.join('\n')}

Use these memories naturally when relevant but don't force them into every response.
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
Memories will be saved automatically as you work.
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
};
