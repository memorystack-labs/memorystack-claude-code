# MemoryStack for Claude Code

<img width="100%" alt="MemoryStack Claude Code Plugin" src="https://memorystack.app/og-image.png" />

**Give Claude Code a brain that persists.** MemoryStack is a cognitive memory engine for AI agents — and this plugin brings it to Claude Code. Your agent remembers *why* you chose PostgreSQL, *where* the gotchas are hiding, and *what broke last time* — across every session, every project.

[![npm version](https://img.shields.io/npm/v/@memorystack/claude-code.svg)](https://www.npmjs.com/package/@memorystack/claude-code)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Why MemoryStack?

AI coding agents start every session with amnesia. They forget your architecture decisions, the bugs you've already fixed, the gotchas that cost you hours. MemoryStack fixes this with **cognitive memory** — not storage, but deep understanding:

- 🧠 **Deep Knowledge Extraction** — Captures the *WHY* behind decisions, not just the what
- ⚠️ **Gotcha & Warning Detection** — Remembers traps, workarounds, and "watch out" moments
- 🔍 **Hybrid Search** — Semantic similarity + keyword matching for precise recall
- 🔄 **Auto-Consolidation** — Deduplicates and merges related memories
- 📉 **Temporal Decay** — Recent memories surface first, old ones gracefully fade
- 💡 **Reflection** — Synthesizes higher-order insights from accumulated knowledge
- 🤝 **Multi-Agent** — Agents share knowledge within teams, or keep it private

## What Makes This Different

Most "memory" plugins save flat notes. MemoryStack extracts and categorizes **institutional knowledge** — the stuff that lives in a senior engineer's head:

```
<memorystack-context>
Here is what MemoryStack remembers about you and this project.

## 🏗️ Architecture & Decisions
- Chose PostgreSQL over MongoDB because the recommendation engine needs complex JOINs across 5 tables
- Auth flow: client → api-gateway → user-service (JWT RS256), refresh tokens in httpOnly cookies
- src/middleware/auth.ts is the single source of truth for JWT validation

## ⚠️ Warnings & Gotchas
- ⚠️ React 19 breaks class components in server component trees — must use function components only
- ⚠️ Redis cache must be manually cleared after staging deploy — CDN caches stale tokens for 15min
- ⚠️ tool_response is an object {output: '...'}, not a string — calling .replace() on it crashes

## 🔧 Conventions & Patterns
- All API routes: src/routes/{resource}.ts with co-located tests at {resource}.test.ts
- Uses conventional commits with scope prefixes (feat:, fix:, chore:)

## 📋 Recent Work
- [Task Completed] Fix auth token refresh → Files: src/auth.ts, src/middleware.ts
- [Task Completed] Add rate limiting → Approach: Edited routes, ran tests → PASS

## 🕐 Recent Activity
- Refactored auth middleware to support multi-tenant (2h ago)
- Fixed CORS issue with WebSocket connections (1d ago)

Pay special attention to ⚠️ warnings.
</memorystack-context>
```

**The difference?** When you say "I'm getting a weird CORS error", MemoryStack automatically searches past debugging lessons and injects the fix — *before* you waste 30 minutes rediscovering it.

## How It Works

This plugin hooks into **6 points** in Claude Code's lifecycle:

| When | What Happens |
|------|-------------|
| **Session Start** | Injects categorized knowledge: Decisions, Warnings, Conventions, Recent Work |
| **Every Prompt** | Detects save signals, debugging sessions, setup prompts — enriches with memories |
| **Every Tool Use** | Tracks file edits, commands, and code changes in real-time |
| **Subagent Finishes** | Extracts key findings, architecture insights, and warnings from subagent work |
| **Task Completes** | Saves rich task records with files modified and approach taken |
| **Session End** | Extracts decisions, gotchas, debugging lessons, and patterns from the conversation |

### Smart Signal Detection

The plugin looks for high-value moments in your prompts:

| Signal Type | Examples | What Happens |
|-------------|----------|-------------|
| **Save** | "remember this", "the fix was", "gotcha", "root cause" | Flags for priority extraction |
| **Search** | "last time", "have we seen", "any experience with" | Searches past memories |
| **Debug** | "error", "broken", "not working" | Auto-searches past debugging lessons |
| **Setup** | "setup", "configure", "deploy" | Retrieves past setup knowledge |

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

- **Save explicitly**: Tell Claude "remember this: we chose Zustand because..."
- **Trigger recall**: Ask "what did I work on yesterday?" or "any gotchas with auth?"
- **Index a project**: Run `/memorystack-claude-code:index` to snapshot your codebase

## Features

### 🏗️ Categorized Context Injection

On session start, memories are classified and organized into actionable categories:

| Category | What It Contains | Why It Matters |
|----------|-----------------|---------------|
| 🏗️ **Decisions** | Architecture choices with rationale | Know *why* things are the way they are |
| ⚠️ **Warnings** | Gotchas, workarounds, hidden requirements | Prevent repeating mistakes |
| 🔧 **Conventions** | Naming patterns, file org, testing approaches | Stay consistent |
| 🔍 **Discoveries** | Subagent findings, architecture insights | Surface buried knowledge |
| 📋 **Recent Work** | Task completions with files and approach | Know what happened last session |
| 👤 **Preferences** | Your coding style and workflow preferences | Personalized experience |

### 🧠 Deep Knowledge Extraction

The extraction engine follows one rule: **Never lose the WHY.**

| Shallow (❌) | Deep (✅) |
|-------------|----------|
| "Uses PostgreSQL" | "Chose PostgreSQL over MongoDB because the recommendation engine needs complex JOINs" |
| "Fixed a bug" | "⚠️ tool_response is an object, not a string — calling .replace() crashes. Fix: normalize first" |
| "Task completed" | "Fixed auth token refresh → Files: src/auth.ts → Approach: rotated refresh tokens on use" |

### 📡 Proactive Memory Enrichment

The plugin doesn't just wait for "remember this" — it detects when you're debugging, configuring, or making decisions and proactively searches for relevant past knowledge:

- **Debugging session detected** → searches past bugfixes and gotchas
- **Setup/config prompt** → retrieves past setup knowledge
- **Architecture question** → surfaces past decisions with rationale

### 🤖 Rich Subagent Capture

When Claude spawns subagents, the plugin captures more than "subagent explored files":

- **Key findings** — Architecture insights and patterns discovered
- **Files explored** — Which files the subagent examined
- **Warnings** — Issues, tech debt, and problems identified
- **Conclusion** — What the subagent determined

### 📋 Enriched Task Records

Completed tasks include the full story, not just the subject:

- **Files modified** — Pulled from the session's tool activity
- **Approach taken** — Key actions from the compressed activity log
- **Who and when** — Teammate, team, and date

### 🏗 Dual-Scope Memories

Memories are scoped to either **you** (personal) or your **project** (shared):

| Scope | What Gets Stored | Who Sees It |
|-------|------------------|-------------|
| **Personal** | Your preferences, habits, coding style | Only you |
| **Project** | Architecture, decisions, conventions, gotchas | Anyone on the project |

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
  "signalKeywords": ["remember", "decision", "convention", "important", "bug", "gotcha", "workaround"],
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

The plugin uses [MemoryStack's SDK](https://www.npmjs.com/package/@memorystack/sdk) under the hood, paired with a deep knowledge extraction pipeline powered by Gemini. Built with esbuild and shipped as bundled CommonJS scripts.

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

- 🧠 **Importance Scoring** — Not all memories are equal. MemoryStack knows which ones matter.
- ⚡ **Contradiction Detection** — When new information conflicts with old, it resolves intelligently.
- 🔄 **Memory Consolidation** — Related memories merge over time, just like human memory.
- 📉 **Temporal Awareness** — Recent memories are more accessible; old ones decay naturally.
- 💡 **Reflection** — Periodic synthesis generates higher-order insights from raw memories.

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
