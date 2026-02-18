# Craft Agent (AgentNative) — Technical Specification

> **This document is the single source of truth for repository structure, architecture, and conventions.**
> All implementation plans start here. Completed plans are archived to `plans/YYMMDD-{slug}.md`.
>
> Status markers: `[ ]` pending | `[x]` done | `[~]` in progress | `[-]` skipped (reason noted)

---

## 1. Project Identity

| Field | Value |
|-------|-------|
| Name | **Craft Agent** (repo: `agentnative`) |
| Version | 0.4.5 |
| Description | Electron desktop app — Claude Agent SDK-powered coding assistant with MCP server support |
| License | MIT (app), Apache-2.0 (packages) |
| Origin | Fork of `lukilabs/craft-agents-oss` |
| Remote `origin` | `github.com/AlwinLijdsman/agentnative` |
| Remote `upstream` | `github.com/lukilabs/craft-agents-oss` |
| Platform | Windows ARM64 — uses **pnpm + tsx**, never bun |

---

## 2. Stack & Toolchain

| Layer | Choice | Notes |
|-------|--------|-------|
| Language | TypeScript 5.x | Strict mode everywhere |
| Runtime | Electron 39 + Node.js | Main + renderer processes |
| UI Framework | React 18 | Functional components only |
| Styling | Tailwind CSS 4 | Utility-first, no CSS modules |
| State Management | Jotai | Atoms in `renderer/atoms/` |
| Build (main/preload) | esbuild | CJS output (`dist/main.cjs`, `dist/preload.cjs`) |
| Build (renderer) | Vite 6 | React plugin, Tailwind plugin |
| AI SDK | `@anthropic-ai/claude-agent-sdk` | Claude Agent SDK for agent orchestration |
| Copilot SDK | `@github/copilot-sdk` | VS Code Copilot integration backend |
| Agent Types | `@craft-agent/codex-types` | Auto-generated from Codex API |
| MCP SDK | `@modelcontextprotocol/sdk` | Model Context Protocol client + servers |
| Package Manager | pnpm | Workspaces, `shamefully-hoist=true` |
| Linting | ESLint 9 | Custom rules in `eslint-rules/` |
| Testing | Node.js test runner | Via `npx tsx --test` |
| Distribution | electron-builder | macOS (DMG), Windows (NSIS), Linux |
| Error Tracking | Sentry | Production builds only |
| Python (MCP servers) | Python 3.11+ | pip, venv |

---

## 3. Monorepo Folder Map

```
agentnative/
│
├── apps/                              # ── Tier 1: Applications ──
│   ├── electron/                      # Main Electron desktop app
│   │   ├── src/
│   │   │   ├── main/                  # Main process
│   │   │   │   ├── index.ts           #   App entry point, Sentry init, window creation
│   │   │   │   ├── sessions.ts        #   SessionManager — core agent/session lifecycle (~5700 lines)
│   │   │   │   ├── ipc.ts             #   IPC handler registration (main ↔ renderer)
│   │   │   │   ├── window-manager.ts  #   BrowserWindow creation & management
│   │   │   │   ├── auto-update.ts     #   electron-updater integration
│   │   │   │   ├── deep-link.ts       #   craft-agent:// protocol handler
│   │   │   │   ├── menu.ts            #   Native menu bar
│   │   │   │   ├── notifications.ts   #   System notifications
│   │   │   │   ├── power-manager.ts   #   Prevent sleep while agent runs
│   │   │   │   ├── search.ts          #   In-page search (Cmd/Ctrl+F)
│   │   │   │   ├── logger.ts          #   electron-log configuration
│   │   │   │   ├── shell-env.ts       #   Load user's shell env (PATH, nvm, etc.)
│   │   │   │   ├── onboarding.ts      #   First-run setup flow
│   │   │   │   └── lib/               #   Config watcher helper
│   │   │   ├── preload/
│   │   │   │   └── index.ts           #   Context-isolated bridge (exposes IPC to renderer)
│   │   │   ├── renderer/
│   │   │   │   ├── main.tsx           #   React entry point
│   │   │   │   ├── App.tsx            #   Root component with routing
│   │   │   │   ├── atoms/             #   Jotai atoms: sessions, agents, sources, skills, overlay
│   │   │   │   ├── pages/             #   ChatPage, PreferencesPage, AgentInfoPage, SourceInfoPage, etc.
│   │   │   │   ├── components/        #   UI: chat/, settings/, onboarding/, markdown/, workspace/, etc.
│   │   │   │   ├── hooks/             #   useSession, useLabels, useStatuses, useViews, useTheme, etc.
│   │   │   │   ├── contexts/          #   ThemeContext, AppShellContext, ModalContext, FocusContext, etc.
│   │   │   │   ├── actions/           #   IPC action wrappers
│   │   │   │   └── utils/             #   Renderer-side utilities
│   │   │   ├── shared/                #   Types shared between main & renderer
│   │   │   │   ├── routes.ts          #     URL routes
│   │   │   │   ├── feature-flags.ts   #     Feature flag definitions
│   │   │   │   ├── settings-registry.ts #   Settings schema
│   │   │   │   └── types.ts           #     Shared IPC types
│   │   │   └── __tests__/             #   E2E and integration tests
│   │   ├── resources/                 #   Bundled assets (synced to ~/.craft-agent/ on launch)
│   │   │   ├── config-defaults.json   #     Default app/workspace preferences
│   │   │   ├── docs/                  #     Built-in documentation markdown files
│   │   │   ├── themes/                #     15 built-in color themes (JSON)
│   │   │   ├── permissions/           #     Default permission rules
│   │   │   ├── tool-icons/            #     SVG icons for tools
│   │   │   ├── bridge-mcp-server/     #     Bundled Bridge MCP Server binary
│   │   │   ├── session-mcp-server/    #     Bundled Session MCP Server binary
│   │   │   ├── release-notes/         #     Per-version release notes
│   │   │   └── craft-logos/           #     Branding assets
│   │   ├── electron-builder.yml       #   electron-builder configuration
│   │   ├── vite.config.ts             #   Vite config for renderer
│   │   └── eslint.config.mjs          #   ESLint config
│   │
│   └── viewer/                        # Standalone web viewer for session transcripts
│       ├── src/                       #   Vite + React app
│       └── vite.config.ts
│
├── packages/                          # ── Tier 2: Shared Libraries ──
│   ├── core/                          # @craft-agent/core — Type definitions
│   │   └── src/
│   │       ├── types/                 #   Workspace, Session, Message, AgentEvent, TokenUsage
│   │       └── utils/                 #   Debug logging stub, ID generation
│   │
│   ├── shared/                        # @craft-agent/shared — ALL business logic
│   │   └── src/
│   │       ├── agent/                 #   CraftAgent, permission modes, stage gate, tool matching
│   │       │   ├── claude-agent.ts    #     Direct Anthropic API backend
│   │       │   ├── copilot-agent.ts   #     VS Code Copilot SDK backend
│   │       │   ├── codex-agent.ts     #     Codex binary backend
│   │       │   ├── base-agent.ts      #     Abstract base agent class
│   │       │   ├── backend/           #     Backend factory + adapters (codex/, copilot/)
│   │       │   ├── core/              #     Permission manager, prompt builder, source manager,
│   │       │   │                      #     usage tracker, session lifecycle, config watcher/validator
│   │       │   ├── mode-manager.ts    #     Permission mode state (safe/ask/allow-all)
│   │       │   ├── session-scoped-tools.ts  # Tools available within agent sessions
│   │       │   └── diagnostics.ts     #     Agent diagnostic logging
│   │       ├── agents/                #   Agent definition loading (AGENT.md parsing)
│   │       ├── auth/                  #   OAuth flows: Claude, Google, Microsoft, Slack, GitHub
│   │       ├── config/                #   App/workspace config storage, preferences, models, theme, watcher
│   │       ├── credentials/           #   AES-256-GCM encrypted credential storage
│   │       ├── mcp/                   #   MCP client, connection validation
│   │       ├── mentions/              #   @mention parsing for agents/sources in chat
│   │       ├── prompts/               #   System prompt generation
│   │       ├── sessions/              #   Session CRUD, JSONL persistence, debounced queue
│   │       ├── sources/               #   Source types/storage/service, credential manager, token refresh
│   │       ├── labels/                #   Hierarchical label system (CRUD, tree, auto-labeling)
│   │       ├── views/                 #   Filter-based session views (filtrex DSL)
│   │       ├── statuses/              #   Workflow status system (CRUD, icons, validation)
│   │       ├── skills/                #   Skill loading and storage
│   │       ├── search/                #   Fuzzy search (uFuzzy)
│   │       ├── tools/                 #   Tool registry and metadata
│   │       ├── scheduler/             #   Cron-based hook system, command execution, security
│   │       ├── codex/                 #   Codex binary resolver, config generator
│   │       ├── hooks-simple/          #   Simple hook system (command executor)
│   │       ├── validation/            #   URL and input validation
│   │       ├── version/               #   Version management
│   │       ├── workspaces/            #   Workspace storage
│   │       ├── docs/                  #   Documentation links, source guides
│   │       ├── icons/                 #   Icon utilities
│   │       ├── colors/                #   Color utilities
│   │       ├── branding.ts            #   Branding constants
│   │       └── network-interceptor.ts #   Fetch interceptor (API errors, MCP schema injection)
│   │
│   ├── ui/                            # @craft-agent/ui — Shared React components
│   │   └── src/
│   │       ├── components/            #   SessionViewer, TurnCard, markdown rendering
│   │       ├── context/               #   Theme context provider
│   │       └── styles/                #   Shared CSS
│   │
│   ├── session-tools-core/            # @craft-agent/session-tools-core — Tool handlers
│   │   └── src/
│   │       ├── handlers/              #   agent-stage-gate, agent-state, submit-plan,
│   │       │                          #   source-test, source-oauth, credential-prompt,
│   │       │                          #   config-validate, mermaid-validate, skill-validate
│   │       ├── context.ts             #   Handler execution context
│   │       └── source-helpers.ts      #   Source utility functions
│   │
│   ├── bridge-mcp-server/             # @craft-agent/bridge-mcp-server
│   │   └── src/index.ts               #   Bridges API sources → MCP protocol (stdio, credential cache)
│   │
│   ├── session-mcp-server/            # @craft-agent/session-mcp-server
│   │   └── src/index.ts               #   Exposes session tools to Codex via MCP (stdio)
│   │
│   ├── mermaid/                       # @craft-agent/mermaid — Flowchart → SVG renderer
│   │   └── src/                       #   Custom ELK layout engine, shape rendering
│   │
│   └── codex-types/                   # @craft-agent/codex-types — Auto-generated API types
│       └── src/                       #   ~200 TypeScript type files from Codex API schema
│
├── agents/                            # ── Tier 3: Workspace Configuration ──
│   ├── _templates/                    #   Agent templates (deep-research)
│   └── isa-deep-research/             #   ISA Deep Research agent
│       ├── AGENT.md                   #     Agent definition (frontmatter: name, sources, tools)
│       ├── config.json                #     Agent metadata (display name, icon, settings)
│       └── icon.svg                   #     Agent icon
│
├── sources/                           #   Source (data connection) definitions
│   ├── agentnative/config.json        #     Local filesystem source (this repo)
│   ├── anthropic/config.json          #     Anthropic API source
│   ├── azure-ai-search/config.json    #     Azure AI Search API
│   ├── azure-deepseek/config.json     #     Azure-hosted DeepSeek
│   ├── azure-doc-intelligence/        #     Azure Document Intelligence
│   ├── azure-embeddings/              #     Azure Embeddings API
│   ├── azure-openai-sweden/           #     Azure OpenAI (Sweden region)
│   ├── azure-openai-swiss/            #     Azure OpenAI (Switzerland region)
│   ├── brave-search/config.json       #     Brave Search API
│   ├── isa-knowledge-base/config.json #     ISA KB MCP server (stdio transport)
│   └── voyage-ai/config.json          #     Voyage AI embeddings API
│
├── skills/                            #   Skill definitions (Claude Code slash commands)
│   ├── an-research-and-plan/          #     /an-research-and-plan — Research & create plan.md
│   ├── an-implement-full/             #     /an-implement-full — Execute all plan phases
│   ├── an-implement-phased/           #     /an-implement-phased — Execute plan phase-by-phase
│   ├── an-adversarial-reviewer/       #     /an-adversarial-reviewer — Adversarial code review
│   ├── an-code-researcher/            #     /an-code-researcher — Read-only code analysis
│   └── car-rental-zurich/             #     Domain-specific skill example
│
├── labels/                            #   Label hierarchy (config.json)
│   └── config.json                    #     Development, Design, Research, etc.
│
├── statuses/                          #   Workflow status definitions
│   ├── config.json                    #     Todo, In Progress, Needs Review, Done, Cancelled
│   └── icons/                         #     Status icon SVGs
│
├── scripts/                           #   Build & utility scripts (all via `npx tsx`)
│   ├── electron-dev.ts                #     Dev mode with hot reload
│   ├── electron-build-main.ts         #     Build main process
│   ├── electron-build-preload.ts      #     Build preload
│   ├── electron-build-renderer.ts     #     Build renderer
│   ├── electron-build-resources.ts    #     Copy bundled resources
│   ├── electron-build-assets.ts       #     Copy additional assets
│   ├── electron-clean.ts              #     Clean dist/
│   ├── extract-oauth-token.ts         #     Extract OAuth token from credentials.enc
│   ├── run-e2e-live.ts                #     Run live E2E tests with auto token
│   ├── test-stage0-e2e.ts             #     Stage 0 pause verification test
│   └── sync-version.ts               #     Sync version across packages
│
├── .github/agents/                    #   VS Code Copilot Chat agent definitions
│   ├── research-and-plan.agent.md     #     "Plan Changes" — branch check + research + plan
│   ├── carefully-implement-full-phased-plan.agent.md  # "Build Continuously" + commit/push
│   ├── carefully-implement-phased-plan.agent.md       # "Build Step-by-Step" + commit/push
│   ├── adversarial-reviewer.agent.md  #     "Review Code" — read-only adversarial review
│   ├── code-researcher.agent.md       #     "Research Code" — read-only analysis
│   └── e2e-test-runner.agent.md       #     "Run E2E Tests" — test execution
│
├── isa-kb-mcp-server/                 # ── Tier 4: External MCP Servers ──
│   ├── src/isa_kb_mcp_server/         #   Python MCP server for ISA knowledge base
│   │   ├── __main__.py                #     Entry point
│   │   ├── search.py                  #     Hybrid search (BM25 + semantic)
│   │   ├── vectors.py                 #     LanceDB vector store + Voyage AI embeddings
│   │   ├── db.py                      #     DuckDB structured data
│   │   ├── graph.py                   #     Entity graph traversal
│   │   ├── verify.py                  #     4-axis verification (citation, entity, relation, contradiction)
│   │   ├── paragraphs.py              #     Paragraph-level retrieval
│   │   ├── context.py                 #     Context formatting
│   │   ├── web_search.py              #     Web search fallback
│   │   └── schema.sql                 #     Database schema
│   ├── data/                          #     DuckDB + LanceDB data files
│   ├── tests/                         #     pytest test suite
│   └── pyproject.toml                 #     Python project config
│
├── sessions/                          #   Session logs (JSONL, gitignored)
├── plans/                             #   Archived implementation plans
│
├── config.json                        #   Workspace configuration (ID, defaults, LLM connection)
├── views.json                         #   Session filter views (filtrex expressions)
├── events.jsonl                       #   Event log
├── package.json                       #   Root package.json (scripts, dependencies)
├── pnpm-workspace.yaml                #   pnpm workspace definition
├── tsconfig.json                      #   Root TypeScript config
├── tsconfig.base.json                 #   Base TypeScript config (extended by packages)
├── .env / .env.example                #   Environment variables (secrets)
├── .npmrc                             #   pnpm config (shamefully-hoist=true)
├── CLAUDE.md                          #   Project conventions (read first by agents)
├── plan.md                            #   THIS FILE — technical spec + active plans
├── start-agentnative.cmd              #   Windows launcher script
└── start-agentnative.vbs              #   Windows silent launcher
```

---

## 4. Package Dependency Graph

```
                    ┌──────────────┐
                    │  codex-types │  (auto-generated Codex API types)
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │     core     │  (Workspace, Session, Message types)
                    └──┬───────┬───┘
                       │       │
              ┌────────▼──┐  ┌─▼────────┐
              │   shared   │  │    ui    │  (React components)
              │ (all biz   │  │          │
              │  logic)    │  └──────────┘
              └─┬──┬───┬───┘       │
                │  │   │           │
   ┌────────────┘  │   └───────────┼──────────────┐
   │               │               │              │
   │    ┌──────────▼──────────┐    │              │
   │    │ session-tools-core  │◄───┘              │
   │    │ (tool handlers)     │                   │
   │    └───┬──────────┬──────┘                   │
   │        │          │                          │
   │  ┌─────▼──────┐ ┌─▼──────────────┐          │
   │  │ bridge-mcp │ │ session-mcp    │          │
   │  │ server     │ │ server         │          │
   │  └────────────┘ └────────────────┘          │
   │                                              │
   ▼                                              ▼
┌──────────────────────────────────────────────────┐
│              apps/electron                        │
│  (imports: core, shared, ui, session-tools-core)  │
└──────────────────────────────────────────────────┘

   mermaid  ◄──  session-tools-core  (mermaid validation handler)
```

---

## 5. Architecture Deep Dive

### 5a. Electron Process Model

```
┌─────────────────────────────────────────────────────────────┐
│  Main Process (src/main/)                                    │
│  • Window management, native menus, auto-update              │
│  • SessionManager — creates/manages agent sessions           │
│  • IPC handlers — bridges renderer requests to business logic│
│  • Shell env loading — ensures PATH includes nvm, brew, etc. │
│  • Power manager — prevents sleep during agent execution     │
└────────────────────┬────────────────────────────────────────┘
                     │ contextBridge (preload/index.ts)
                     │ IPC channels only — no nodeIntegration
┌────────────────────▼────────────────────────────────────────┐
│  Renderer Process (src/renderer/)                            │
│  • React 18 SPA with Jotai atoms                             │
│  • Pages: Chat, Preferences, AgentInfo, SourceInfo, etc.     │
│  • All state in atoms/ — sessions, agents, sources, skills   │
│  • Tailwind CSS 4 for styling                                │
└──────────────────────────────────────────────────────────────┘
```

**Security rule**: Never use `nodeIntegration: true`. All main↔renderer communication goes through the preload bridge via typed IPC channels.

### 5b. Agent System

**CraftAgent** (`packages/shared/src/agent/`) wraps the Claude Agent SDK and provides:

| Component | File | Purpose |
|-----------|------|---------|
| Base agent | `base-agent.ts` | Abstract agent interface |
| Claude backend | `claude-agent.ts` | Direct Anthropic API calls |
| Copilot backend | `copilot-agent.ts` | VS Code Copilot SDK integration |
| Codex backend | `codex-agent.ts` | Codex binary subprocess |
| Backend factory | `backend/factory.ts` | Creates backend by type |
| Permission manager | `core/permission-manager.ts` | PreToolUse hook — blocks/allows tools |
| Prompt builder | `core/prompt-builder.ts` | System prompt assembly |
| Source manager | `core/source-manager.ts` | MCP server lifecycle per session |
| Usage tracker | `core/usage-tracker.ts` | Token/cost accounting |
| Session lifecycle | `core/session-lifecycle.ts` | Session create/resume/archive |
| Mode manager | `mode-manager.ts` | Permission mode state machine |
| Session tools | `session-scoped-tools.ts` | Tools injected into agent sessions |
| Diagnostics | `diagnostics.ts` | Diagnostic logging |

**Permission Modes** (per-session, no global contamination):

| Mode | Display | Behavior | Shortcut |
|------|---------|----------|----------|
| `safe` | Explore | Read-only, blocks all write operations | SHIFT+TAB cycles |
| `ask` | Ask to Edit | Prompts user for bash/write commands | SHIFT+TAB cycles |
| `allow-all` | Auto | Auto-approves everything | SHIFT+TAB cycles |

**Stage Gate** (`session-tools-core/src/handlers/agent-stage-gate.ts`):
Multi-stage pipeline gating — the agent must pass through defined stages and can be paused/approved at each gate before proceeding.

### 5c. Source System

Sources are external data connections. Each source has a `config.json` defining its type and connectivity.

**Source Types:**

| Type | Transport | Example | Credential Flow |
|------|-----------|---------|-----------------|
| `mcp` | stdio | ISA Knowledge Base | MCP transport auth |
| `api` | REST/HTTP | Anthropic, Brave Search, Azure | Header injection via credential cache |
| `local` | Filesystem | AgentNative (this repo) | None |

**Source Config Schema** (`sources/{slug}/config.json`):
```json
{
  "id": "unique_id",
  "name": "Display Name",
  "slug": "url-safe-slug",
  "enabled": true,
  "provider": "provider-key",
  "type": "mcp | api | local",
  "icon": "emoji or URL",
  "tagline": "One-line description",
  "mcp": { "transport": "stdio", "command": "...", "args": [], "env": {} },
  "api": { "baseUrl": "...", "authType": "header", "headerName": "..." },
  "local": { "path": "/absolute/path" }
}
```

**Auto-Enable**: Agents declare required sources in `AGENT.md` frontmatter. When an agent is @mentioned in chat, its required sources are automatically enabled for the session.

**Credential Flow** (API sources → Bridge MCP Server):
```
Main Process → decrypt credentials.enc → write .credential-cache.json (0600)
                                              │
Bridge MCP Server (subprocess) ◄──────────────┘ reads on each request
```

### 5d. Session Lifecycle

| Concept | Detail |
|---------|--------|
| Session | Conversation scope with SDK session binding |
| ID format | `msg-{timestamp}-{random}` via `generateMessageId()` |
| Persistence | Debounced 500ms writes via `persistence-queue.ts` |
| Storage | `sessions/{slug}/session.jsonl` (first line = metadata) |
| Metadata | messageCount, tokenUsage, permissionMode, status, labels |
| Archive | Sessions can be named and archived |

**Message Roles**: `user`, `assistant`, `tool`, `error`, `status`, `system`, `info`, `warning`

**Tool Statuses**: `pending`, `executing`, `completed`, `error`

### 5e. MCP Integration

| Server | Package | Transport | Purpose |
|--------|---------|-----------|---------|
| Bridge MCP | `packages/bridge-mcp-server/` | stdio | Bridges API sources → MCP protocol with credential injection |
| Session MCP | `packages/session-mcp-server/` | stdio | Exposes session tools (SubmitPlan, config_validate) to Codex |
| ISA KB MCP | `isa-kb-mcp-server/` | stdio | Python — ISA knowledge base with hybrid search + graph traversal |

### 5f. UI Architecture

**Jotai Atoms** (`renderer/atoms/`):
- `sessions.ts` — session list, active session, messages
- `agents.ts` — loaded agents
- `sources.ts` — enabled/available sources
- `skills.ts` — loaded skills
- `overlay.ts` — modal/overlay state

**Key Pages** (`renderer/pages/`):
- `ChatPage.tsx` — main chat interface
- `PreferencesPage.tsx` — app & workspace settings
- `AgentInfoPage.tsx` / `AgentRunDetailPage.tsx` — agent details
- `SourceInfoPage.tsx` — source configuration
- `SkillInfoPage.tsx` — skill details

**Contexts** (`renderer/contexts/`):
- `ThemeContext` — color theme provider
- `AppShellContext` — layout state (sidebar, panels)
- `ModalContext` — modal management
- `FocusContext` — keyboard focus tracking
- `StoplightContext` — macOS traffic light positioning
- `EscapeInterruptContext` — ESC key handling

**Key Hooks** (`renderer/hooks/`):
- `useSession` — active session state and actions
- `useLabels` — label CRUD
- `useStatuses` — status workflow
- `useViews` — filtered session views
- `useTheme` — theme resolution and CSS vars
- `useNotifications` — system notifications
- `useBackgroundTasks` — long-running task tracking

### 5g. Label, View & Status Systems

**Labels** (`labels/config.json`):
Hierarchical tagging system. Each label has `id`, `name`, `color` (light/dark), and optional `children[]`. Sessions can be tagged with multiple labels. Auto-labeling rules in `packages/shared/src/labels/auto/`.

**Views** (`views.json`):
Filter-based session views using filtrex expressions over session metadata:
```json
{ "name": "New", "expression": "hasUnread == true" }
{ "name": "Plan", "expression": "hasPendingPlan == true" }
{ "name": "Processing", "expression": "isProcessing == true" }
```

**Statuses** (`statuses/config.json`):
Workflow states with categories (`open`/`closed`), icons, colors, keyboard shortcuts. Default: Todo → In Progress → Needs Review → Done / Cancelled. Customizable per workspace.

### 5h. Theme System

Cascading resolution: app-level → workspace-level (last wins).

| Level | Storage Path |
|-------|-------------|
| Built-in | `resources/themes/*.json` (15 themes) |
| App | `~/.craft-agent/theme.json` |
| Workspace | `~/.craft-agent/workspaces/{id}/theme.json` |

6-color system: `background`, `foreground`, `accent`, `info`, `success`, `destructive` — each with optional `dark:` override.

### 5i. Scheduler & Hook System

`packages/shared/src/scheduler/` provides:
- **Cron-based scheduling** via `croner` — trigger agent actions on schedule
- **Hook system** — pre/post hooks for agent lifecycle events
- **Command execution** — sandboxed command runner with security validation
- **Event bus** — pub/sub for internal events

### 5j. Build Pipeline

```
pnpm run electron:build
  │
  ├── electron:build:main      → esbuild → dist/main.cjs
  ├── electron:build:preload   → esbuild → dist/preload.cjs
  ├── electron:build:renderer  → Vite    → dist/renderer/
  ├── electron:build:resources → Copy resources/ → dist/resources/
  └── electron:build:assets    → Copy additional assets
```

**Dev mode**: `pnpm run electron:dev` — watches all source files, rebuilds on change, hot reloads renderer.

**Distribution**: `pnpm run electron:dist` → electron-builder packages for current platform.

---

## 6. Configuration & Data Paths

### Runtime Paths (`~/.craft-agent/`)

| Path | Content | Sync |
|------|---------|------|
| `~/.craft-agent/config.json` | Global app configuration | User-managed |
| `~/.craft-agent/credentials.enc` | Encrypted credentials (AES-256-GCM) | User-managed |
| `~/.craft-agent/theme.json` | App-level theme override | User-managed |
| `~/.craft-agent/themes/` | Built-in themes | Overwritten on launch |
| `~/.craft-agent/docs/` | Built-in documentation | Overwritten on launch |
| `~/.craft-agent/permissions/` | Default permission rules | Overwritten on launch |
| `~/.craft-agent/tool-icons/` | Tool icon SVGs | Overwritten on launch |
| `~/.craft-agent/config-defaults.json` | Default preferences | Overwritten on launch |
| `~/.craft-agent/workspaces/{id}/` | Per-workspace data | User-managed |
| `~/.craft-agent/workspaces/{id}/sources/{slug}/` | Source configs + credential cache | User-managed |
| `~/.craft-agent/workspaces/{id}/theme.json` | Workspace theme override | User-managed |
| `~/.craft-agent/workspaces/{id}/permissions.json` | Workspace permission rules | User-managed |
| `~/.craft-agent/workspaces/{id}/statuses/config.json` | Workspace status workflow | User-managed |

### Workspace-Root Paths (this repo)

| File | Purpose |
|------|---------|
| `config.json` | Workspace ID, default settings, LLM connection |
| `views.json` | Session filter view definitions |
| `labels/config.json` | Label hierarchy |
| `statuses/config.json` | Status workflow |
| `.env` | API keys, OAuth secrets (gitignored) |
| `.env.example` | Template for `.env` |

---

## 7. Quick Reference Commands

| Action | Command |
|--------|---------|
| Install dependencies | `pnpm install` |
| Dev with hot reload | `pnpm run electron:dev` |
| Full build | `pnpm run electron:build` |
| TypeScript check (all) | `pnpm run typecheck:all` |
| Lint | `pnpm run lint` |
| Run all tests | `pnpm run test:e2e` |
| Run live SDK tests | `pnpm run test:e2e:live:auto` |
| Run Stage 0 E2E | `npx tsx scripts/test-stage0-e2e.ts` |
| Viewer dev server | `pnpm run viewer:dev` |
| Print system prompt | `pnpm run print:system-prompt` |
| Sync version across packages | `npx tsx scripts/sync-version.ts` |
| Build for distribution | `pnpm run electron:dist` |
| Extract OAuth token | `npx tsx scripts/extract-oauth-token.ts` |
| Clean build artifacts | `pnpm run electron:clean` |

---

## 8. Agent & Skill Definitions

### Workspace Agents (`agents/{slug}/`)

Each agent has:
- `AGENT.md` — YAML frontmatter (name, description, required sources, tools) + Markdown body (system prompt instructions)
- `config.json` — Display metadata (name, icon, settings)
- `icon.svg` — Agent icon

Agents are loaded by `packages/shared/src/agents/` and injected into the system prompt when @mentioned.

### Copilot Chat Agents (`.github/agents/`)

| File | Name | Purpose |
|------|------|---------|
| `research-and-plan.agent.md` | Plan Changes | Branch check → research → write `plan.md` |
| `carefully-implement-full-phased-plan.agent.md` | Build Continuously | Execute all plan phases → commit/push |
| `carefully-implement-phased-plan.agent.md` | Build Step-by-Step | One phase at a time with approval → commit/push |
| `adversarial-reviewer.agent.md` | Review Code | Read-only adversarial review |
| `code-researcher.agent.md` | Research Code | Read-only codebase analysis |
| `e2e-test-runner.agent.md` | Run E2E Tests | Test execution |

**Workflow**: Plan Changes creates a feature branch and writes `plan.md` → Build agent executes phases → archives plan → commits → pushes.

### Skills (`skills/{slug}/SKILL.md`)

Skills are Claude Code slash commands with YAML frontmatter (`name`, `description`, `globs`). Available as `/an-*` prefix commands in CLI.

---

## 9. Conventions & Constraints

### Do ALWAYS
- Read `CLAUDE.md` first — it's the project rulebook
- Run `pnpm run typecheck:all` before considering changes complete
- Run `pnpm run lint` before considering changes complete
- Follow existing patterns before introducing new ones
- Use workspace protocol (`workspace:*`) for internal package dependencies
- Use `npx tsx` to run TypeScript scripts directly
- Archive completed `plan.md` to `plans/YYMMDD-{slug}.md` before starting new work

### Do NEVER
- Use `bun` — not available on Windows ARM64
- Introduce `any` types without explicit justification
- Use `nodeIntegration: true` in Electron
- Hard-code credentials or API keys
- Skip TypeScript strict mode checks
- Commit `.claude/settings.local.json`
- Delete completed plan items — mark them `[x]` for audit trail

### Naming Conventions

| Style | Where Used |
|-------|-----------|
| `camelCase` | Functions, variables |
| `PascalCase` | Types, interfaces, classes, React components |
| `UPPER_SNAKE_CASE` | Constants |

### Import Rules
- Workspace protocol: `"@craft-agent/shared": "workspace:*"` for internal packages
- Relative imports within a package
- Absolute workspace imports across packages (`@craft-agent/shared/agent`)
- Subpath exports defined in each package's `package.json`

---

## 10. Completed Plans Archive

| Date | Slug | Summary |
|------|------|---------|
| 260216 | `agent-quality-hardening` | Agent quality hardening pass |
| 260216 | `subagent-abort-propagation` | Subagent abort signal propagation |
| 260217 | `stage-gate-pause-enforcement` | Stage gate pause enforcement |
| 260218 | `agent-overhaul-e2e-framework` | Agent overhaul E2E test framework |
| 260218 | `agent-overhaul-e2e-framework-complete` | E2E framework completion |
| 260218 | `natural-completion-stage-gate` | Natural completion stage gate |
| 260218 | `stage-gate-diagnostics-logging` | Stage gate diagnostic logging |
| 260218 | `stage0-lightweight-clarification-pause` | Stage 0 lightweight pause |
| 260218 | `auto-enable-agent-sources` | Auto-enable agent-required sources on @mention |
| 260218 | `agent-branch-hygiene` | Git branch hygiene + commit/push in Copilot agents |
| 260218 | `isa-websearch-intent-clarification` | Optional websearch intent clarification stage for ISA agent |
| 260218 | `agent-default-sources` | Hardened auto-enable agent sources pipeline with diagnostics, pure function, UI badges, system messages, tests |

Full plan files in `plans/` directory.

---

## 11. Active Implementation Plan

> No active plan. Use `/an-research-and-plan` to create one, then `/an-implement-full` or `/an-clean-plan-commit-push` after completion.

---

## 12. Future Plans & Roadmap

> Add upcoming features, ideas, and technical debt items here.
> Move an item to Section 11 when starting work on it.

### Planned

- [ ] **Core package migration** — Move storage, auth, credentials, agent logic from `shared/` to `core/` (phased migration per `core/CLAUDE.md`)
- [ ] **Upstream sync workflow** — Automated merge from `upstream/main` with conflict resolution strategy
- [ ] **Multi-workspace support** — UI and config for switching between workspaces
- [ ] **Plugin system** — Dynamic loading of third-party agents and sources
- [ ] **Session sharing** — Export/import sessions for collaboration (viewer app integration)

### Ideas (Not Yet Scoped)

- [ ] Agent performance benchmarking framework
- [ ] Source health monitoring dashboard
- [ ] Automated credential rotation for API sources
- [ ] Custom theme editor in Preferences UI
- [ ] Collaborative multi-agent sessions
- [ ] MCP server marketplace / registry

### Technical Debt

- [ ] `apps/electron/package.json` still references `bun` in some script commands (unused on Windows ARM64)
- [ ] `packages/shared/CLAUDE.md` references `bun test` — should be `npx tsx --test`
- [ ] `nul` file in repo root (Windows reserved name) — `.gitignore`'d but should be removed from history
- [ ] Large `sessions.ts` (~5700 lines) — candidate for decomposition into sub-modules

---

_Last updated: 2026-02-19_
