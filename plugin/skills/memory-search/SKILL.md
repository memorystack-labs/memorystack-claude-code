---
name: memory-search
description: Search your coding memory. Use when user asks about past work, previous sessions, how something was implemented, what they worked on before, or wants to recall information from earlier sessions.
allowed-tools: Bash(node:*)
---

# Memory Search

Search MemoryStack for past coding sessions, decisions, and saved information.

## How to Search

Run the search script with the user's query and optional scope flag:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/search-memory.cjs" [--personal|--project|--both] "USER_QUERY_HERE"
```

### Scope Flags

- `--both` (default): Search both personal and project memories
- `--personal`: Search only your personal session memories (your coding history)
- `--project`: Search shared project knowledge (team decisions, architecture, conventions)

## Examples

- User asks "what did I work on yesterday":
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/search-memory.cjs" --personal "work yesterday recent activity"
  ```

- User asks "how did we implement auth" (project-specific):
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/search-memory.cjs" --project "authentication implementation"
  ```

- User asks "what are my coding preferences":
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/search-memory.cjs" --personal "preferences coding style conventions"
  ```

- User asks about a past decision:
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/search-memory.cjs" --project "decision architecture database"
  ```

## Present Results

The script outputs formatted memory results with types, confidence scores, and importance indicators (⭐ for high importance). Present them clearly and offer to search again with different scope or terms if needed.
