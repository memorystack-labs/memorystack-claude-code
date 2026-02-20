---
name: memory-save
description: Save important project knowledge to memory. Use when user wants to preserve architectural decisions, significant bug fixes, design patterns, important conventions, or implementation details for future reference.
allowed-tools: Bash(node:*)
---

# Memory Save

Save important project knowledge to MemoryStack for future sessions.

## Step 1: Understand What to Save

Identify what the user wants to preserve from the conversation:
- Architectural decisions
- Bug fixes and their root causes
- Design patterns and conventions
- Important implementation details
- Preferences and workflows

## Step 2: Format Content

Structure the memory using this template:

```
[MEMORY:<date>]

<Goal or problem that was addressed>

Approach: <solution or approach taken>

Decision: <key decision made>

Details: <important files, patterns, or specifics>

[/MEMORY]
```

Example:
```
[MEMORY:2026-02-18]

Refactored authentication to use JWT with refresh tokens.

Approach: Replaced session-based auth with stateless JWT. Access tokens expire in 15min, refresh tokens in 7 days.

Decision: Stored refresh tokens in httpOnly cookies instead of localStorage for security.

Details: Files changed: src/lib/auth.ts, src/middleware.ts, src/app/api/auth/[...route].ts

[/MEMORY]
```

Keep it natural and focused on the essential knowledge.

## Step 3: Save

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/save-project-memory.cjs" "FORMATTED_CONTENT"
```

This saves to the project scope so team members can benefit from the knowledge.

## When to Use

- User says "save this", "remember this", "note this down"
- After resolving a complex bug or making an architectural decision
- When user shares important conventions or preferences
- After completing a significant feature or refactor
