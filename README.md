# MemoryStack for Claude Code

<img width="100%" alt="MemoryStack Claude Code Plugin" src="https://memorystack.app/og-image.png" />

**Give Claude Code a brain that persists.** MemoryStack is a cognitive memory engine for AI agents — and this plugin brings it to Claude Code. Your agent remembers what you worked on, how you code, and what decisions you made — across every session.

[![npm version](https://img.shields.io/npm/v/@memorystack/claude-code.svg)](https://www.npmjs.com/package/@memorystack/claude-code)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Why MemoryStack?

AI coding agents start every session with amnesia. They forget your preferences, your architecture decisions, the bugs you've already fixed. MemoryStack fixes this with **cognitive memory** — not just storage, but intelligent recall:

- 🧠 **Importance Scoring** — Automatically ranks memories by significance
- 🔍 **Hybrid Search** — Semantic similarity + keyword matching for precise recall
- 🔄 **Auto-Consolidation** — Deduplicates and merges related memories
- 📉 **Temporal Decay** — Recent memories surface first, old ones gracefully fade
- 💡 **Reflection** — Periodically synthesizes insights from accumulated knowledge
- 🤝 **Multi-Agent** — Agents share memories within teams, or keep them private

## What This Plugin Does

This plugin hooks into **6 points** in Claude Code's lifecycle to build a complete memory layer:

| When | What Happens |
|------|-------------|
| **Session Start** | Injects your Developer Profile, Project Knowledge, and Recent Activity |
| **Every Prompt** | Detects memory signals ("remember this...") and searches for relevant context |
| **Every Tool Use** | Tracks file edits, commands, and code changes in real-time |
| **Subagent Finishes** | Captures what subagents accomplished for future reference |
| **Task Completes** | Auto-saves completed team tasks as project knowledge |
| **Session End** | Extracts key decisions, patterns, and learnings from the conversation |

### The Result

```
<memorystack-context>
The following is recalled context about the developer and this project.

## Developer Profile
- Prefers TypeScript with strict mode, uses Bun as package manager
- Uses conventional commits with scope prefixes
- Prefers functional patterns over class-based OOP

## Project Knowledge
- Auth uses JWT with refresh tokens stored in httpOnly cookies
- API follows REST conventions with /api/v1 prefix
- Database is PostgreSQL with Drizzle ORM

## Recent Activity
- Refactored auth middleware to support multi-tenant (2h ago)
- Fixed CORS issue with WebSocket connections (1d ago)
</memorystack-context>
```

## Quick Start

### 1. Get Your API Key

Visit [memorystack.app/dashboard](https://memorystack.app/dashboard) to create a free account and generate an API key.

### 2. Install

```bash
# Set your API key
export MEMORYSTACK_API_KEY="ms_proj_..."

# Install via Claude Code marketplace
/plugin marketplace add memorystack-labs/memorystack-claude-code
/plugin install memorystack-claude-code
```

Or install from source:

```bash
git clone https://github.com/memorystack-labs/memorystack-claude-code.git
cd memorystack-claude-code
npm install && npm run build
claude plugin add ./plugin
```

### 3. Use Claude Code Normally

That's it. Memories are captured and recalled automatically. You can also:

- **Save explicitly**: Tell Claude "remember this architecture decision"
- **Search memories**: Ask "what did I work on yesterday?"
- **Index a project**: Run `/memorystack-claude-code:index` to snapshot your codebase

## Features

### 🔮 Smart Context Injection

On session start, the plugin fetches a **structured profile** — not a flat list of memories, but organized categories:

- **Developer Profile** — Your coding preferences, habits, and conventions
- **Project Knowledge** — Architecture decisions, patterns, team conventions
- **Recent Activity** — What you worked on recently, with relative timestamps

### 📡 Real-Time Signal Detection

The plugin listens to every prompt you type. When it detects signal phrases like "remember this", "architecture decision", or "important convention", it **flags the turn** for priority capture.

### 🔧 Tool Activity Tracking

Every file edit, bash command, and code change is compressed into a one-liner and logged. This builds a rich activity feed that the session summary uses to create focused, useful memories instead of noisy transcripts.

### 🤖 Subagent Memory

When Claude spawns subagents (Explore, Plan, Bash), the plugin reads each subagent's separate transcript and saves a compressed summary. Subagent work doesn't disappear — it becomes searchable project knowledge.

### 🏗 Dual-Scope Memories

Memories are scoped to either **you** (personal) or your **project** (shared):

| Scope | What Gets Stored | Who Sees It |
|-------|------------------|-------------|
| **Personal** | Your preferences, habits, coding style | Only you |
| **Project** | Architecture, decisions, conventions | Anyone on the project |

Search with scope flags: `--personal`, `--project`, or `--both` (default).

### 📋 Team Task Tracking

When using Claude Code's agent teams, completed tasks are automatically saved as project knowledge with full context: who completed the task, what it was, and when.

## Commands

### `/memorystack-claude-code:index`

Index your codebase into MemoryStack. Explores project structure, architecture, conventions, and saves comprehensive findings.

### `/memorystack-claude-code:logout`

Clear saved MemoryStack credentials.

## Configuration

### Environment Variables

```bash
MEMORYSTACK_API_KEY=ms_proj_...   # Required — your API key
MEMORYSTACK_DEBUG=true             # Optional — enable debug logging
```

### Settings File

Create `~/.memorystack-claude/settings.json` for advanced configuration:

```json
{
  "captureMode": "smart",
  "signalKeywords": ["remember", "decision", "convention", "important", "bug", "architecture"],
  "turnsBefore": 3,
  "maxContextResults": 5,
  "debug": false,
  "skipTools": ["Read", "Glob", "Grep"],
  "captureTools": ["Edit", "Write", "Bash", "Task"]
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `captureMode` | `"smart"` | `"smart"` (signal → full fallback), `"signal"`, or `"full"` |
| `signalKeywords` | See above | Keywords that trigger priority capture |
| `turnsBefore` | `3` | Context window: include N turns before each signal |
| `maxContextResults` | `5` | Max memories to inject per category |

## How It's Built

The plugin uses [MemoryStack's SDK](https://www.npmjs.com/package/@memorystack/sdk) (`@memorystack/sdk`) under the hood. It's built with esbuild and ships as bundled CommonJS scripts in the `plugin/scripts/` directory.

```
plugin/
├── .claude-plugin/plugin.json     # Plugin manifest
├── hooks/hooks.json               # 6 lifecycle hooks
├── commands/                      # /index, /logout
├── skills/                        # memory-search, memory-save
└── scripts/                       # 9 bundled .cjs scripts
```

## Development

```bash
git clone https://github.com/memorystack-labs/memorystack-claude-code.git
cd memorystack-claude-code
npm install
npm run build       # Build all 9 scripts
npm run lint        # Check code quality
```

## About MemoryStack

[MemoryStack](https://memorystack.app) is a cognitive memory engine for AI agents. It goes beyond simple vector storage:

- **Importance Scoring** — Not all memories are equal. MemoryStack knows which ones matter.
- **Contradiction Detection** — When new information conflicts with old, it resolves intelligently.
- **Memory Consolidation** — Related memories merge over time, just like human memory.
- **Temporal Awareness** — Recent memories are more accessible; old ones decay naturally.
- **Reflection** — Periodic synthesis generates higher-order insights from raw memories.

Used by developers building AI assistants, coding agents, customer support bots, and multi-agent systems.

**SDKs**: [Node.js](https://www.npmjs.com/package/@memorystack/sdk) · [Python](https://pypi.org/project/memorystack/)
**Docs**: [memorystack.app/docs](https://memorystack.app/docs)

## License

MIT

## Support

- **Website**: [memorystack.app](https://memorystack.app)
- **Docs**: [memorystack.app/docs](https://memorystack.app/docs)
- **GitHub**: [memorystack-labs/memorystack-claude-code](https://github.com/memorystack-labs/memorystack-claude-code)
- **Discord**: [discord.gg/dHu5hMXd](https://discord.gg/dHu5hMXd)
