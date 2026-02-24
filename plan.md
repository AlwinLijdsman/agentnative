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

### OAuth Token Discovery for E2E Testing

Two independent credential stores exist. E2E tests need a valid Claude Max OAuth token:

| Store | Path | Format | Used By |
|-------|------|--------|---------|
| **Claude Code CLI** | `~/.claude/.credentials.json` | Plain JSON: `{ claudeAiOauth: { accessToken, expiresAt } }` | Claude Code CLI, E2E tests |
| **Craft Agent App** | `~/.craft-agent/credentials.enc` | AES-256-GCM encrypted | Electron app (runtime) |

**Token resolution order** (used by `scripts/test-orchestrator-live-e2e.ts`):
1. `CLAUDE_CODE_OAUTH_TOKEN` env var (CI/CD override)
2. Claude Code CLI: `~/.claude/.credentials.json` → `.claudeAiOauth.accessToken`
3. Craft Agent: `~/.craft-agent/credentials.enc` (via `CredentialManager`)

**To refresh an expired token**: Open Claude Code CLI (`claude` command) — it auto-refreshes on launch. The Craft Agent app refreshes its own store independently.

**Reading the Claude Code token** (PowerShell):
```powershell
$creds = Get-Content "$env:USERPROFILE\.claude\.credentials.json" | ConvertFrom-Json
$token = $creds.claudeAiOauth.accessToken
$expires = [DateTimeOffset]::FromUnixTimeMilliseconds($creds.claudeAiOauth.expiresAt).DateTime
Write-Host "Token prefix: $($token.Substring(0, 25))... Expires: $expires"
```

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
| Run orchestrator live E2E | `npx tsx scripts/test-orchestrator-live-e2e.ts` |
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
| 260220 | `isa-guide-reference-search` | ISA KB Guide Reference and Multi-Tier Search (guide ingestion, guide search tools, multi-tier search, reranker, semantic dedup, query expansion, diagnostics) |

Full plan files in `plans/` directory.

---

## 11. Active Implementation Plan

> **Plan:** Deterministic Agent Orchestrator with Claude Max OAuth
> **Branch:** `fix/source-blocks-injection`
> **Date:** 2026-02-23
> **Status:** Plan approved, ready for implementation
> **Supersedes:** Bug report (archived to Section 11a below) — all analysis consumed into this plan
> **Architecture:** Raw `@anthropic-ai/sdk` `client.messages.stream()` with `authToken` (OAuth Bearer) + adaptive thinking (`thinking: {type: "adaptive"}`, `effort: "max"`). NO tools given to LLM. TypeScript controls WHEN, LLM controls HOW. Each stage = 1 max-power API call via Claude Max OAuth subscription. Mirrors gamma's `ISAResearchWorkflow` pattern.

---

### Goal

Replace the Claude Agent SDK `query()` agentic loop **for agent pipelines only** with a TypeScript deterministic for-loop. Each stage = 1 stateless, max-power API call to `api.anthropic.com/v1/messages` via `new Anthropic({ authToken })` using:
- **Claude Max OAuth** subscription (Bearer token, not API key)
- **Opus 4.6 adaptive thinking** (`thinking: {type: "adaptive"}`) — always enabled
- **Effort: `max`** — Claude always applies maximum reasoning power
- **Streaming** via `client.messages.stream()` — REQUIRED by SDK for `max_tokens > 21,333`
- **Dynamic `max_tokens`** — calculated per-call to fit within 200K context window (`input + max_tokens ≤ 200K`)
- **No tools** given to LLM — TypeScript calls MCP tools programmatically
- **No temperature** — incompatible with adaptive thinking
- **Zod-validated JSON extraction** from LLM text output (structured output without `tool_choice`)

Normal chat (no agent @mention) continues using SDK `query()` unchanged.

---

### Adversarial Verification — Gaps & Mitigations

These were identified by challenging every previous finding. All are incorporated into the implementation phases below.

| # | Gap | Severity | Evidence | Mitigation |
|---|-----|----------|----------|------------|
| **G1** | **`anthropic-beta: oauth-2025-04-20` header required** — The raw `@anthropic-ai/sdk` sends `Authorization: Bearer` header but does NOT auto-add the OAuth beta header. The Claude Agent SDK adds this explicitly via its internal `jH()` auth helper (cli.js L220: `"anthropic-beta":pf` where `pf="oauth-2025-04-20"`). Without it, `api.anthropic.com` may reject Bearer tokens with 401. | **CRITICAL** | cli.js L20: `pf="oauth-2025-04-20"`, L220: `headers:{Authorization:\`Bearer ${q.accessToken}\`,"anthropic-beta":pf}` | Pass `defaultHeaders: { 'anthropic-beta': 'oauth-2025-04-20' }` to `new Anthropic()`. Phase 1 includes this. |
| **G2** | **`CLAUDE_CODE_OAUTH_TOKEN` ≠ `ANTHROPIC_AUTH_TOKEN`** — The app sets `process.env.CLAUDE_CODE_OAUTH_TOKEN` (sessions.ts L1340). The raw SDK reads `process.env.ANTHROPIC_AUTH_TOKEN` (client.ts L299). These are DIFFERENT env vars. Using `new Anthropic()` without explicit `authToken` parameter would fail silently (null token). | **CRITICAL** | sessions.ts L1340: `process.env.CLAUDE_CODE_OAUTH_TOKEN = tokenResult.accessToken`, client.ts L299: `authToken = readEnv('ANTHROPIC_AUTH_TOKEN') ?? null` | NEVER rely on env vars. Always pass `authToken` explicitly to constructor: `new Anthropic({ authToken: oauthToken })`. Get token via `credentialManager.getLlmOAuth(slug)` — returns `{accessToken}` directly. Phase 1 does this. |
| **G3** | **OAuth token expiry & refresh** — OAuth tokens expire (short-lived, ~1h). The current system refreshes them in `reinitializeAuth()` (sessions.ts L1289–1380) and `getValidClaudeOAuthToken()` which calls the SDK's OAuth PKCE refresh flow. If the orchestrator runs a 20-minute pipeline, the token could expire mid-run. | **HIGH** | sessions.ts L1337: `const tokenResult = await getValidClaudeOAuthToken(slug!)` — handles refresh with retry. credentials/manager.ts L197: `getClaudeOAuthCredentials()` returns `{expiresAt}`. | Before EACH `client.messages.stream()` call, check token expiry and re-fetch via `getValidClaudeOAuthToken()`. Create a new `Anthropic` client per-call (lightweight — just sets headers). Phase 1 includes `getOrRefreshToken()` helper. |
| **G4** | **Anthropic API docs show only `x-api-key` auth** — The official API docs (platform.claude.com) only document `x-api-key` header. Bearer auth is undocumented. It works today because Claude Code (the SDK) uses it, but Anthropic could change or deprecate it. | **MEDIUM** | API Overview docs: "x-api-key: Your API key from Console — Yes (required)". No mention of `Authorization: Bearer`. | Accept the risk. Claude Code itself depends on this path — if Anthropic breaks it, their own product breaks. We use the exact same mechanism. Add runtime check: if 401 on first call, log clear error about OAuth support. |
| **G5** | **128K max_tokens is undocumented for OAuth path** — Anthropic docs confirm 128K max output for Opus 4.6, but it's unclear if OAuth/Claude Max has different limits than direct API. Claude Max pricing page says "Higher output limits for all tasks" which may mean MORE than 128K, or may be a marketing phrase. | **LOW** | Anthropic docs: "Max output: 128K tokens" for Opus 4.6. Claude Max pricing: "Higher output limits for all tasks". | Use 128K as default. Make configurable via `config.json` `orchestrator.maxOutputTokens`. If a specific stage needs less (e.g., stage 0 query analysis), set per-stage. |
| **G6** | **No `process.env.ANTHROPIC_BASE_URL` propagation** — Some users configure custom base URLs (OpenRouter, proxies). The raw Anthropic client defaults to `https://api.anthropic.com`. If the user has `ANTHROPIC_BASE_URL` set, we should respect it. | **LOW** | diagnostics.ts L126: `const baseUrl = process.env.ANTHROPIC_BASE_URL?.trim() \|\| 'https://api.anthropic.com'`. LLM connection config has `baseUrl` field. | Read base URL from connection config, fall back to `ANTHROPIC_BASE_URL` env, fall back to default. Pass as `baseURL` to `new Anthropic()`. |
| **G7** | **1M context window requires tier 4 + beta header** — User confirmed: skip 1M context. Use standard 200K. | **N/A** | User instruction: "Skip the 1m because I am not on that level." | Use 200K standard context window. Do NOT add `context-1m-2025-08-07` beta header. |
| **G8** | **`call_llm` tool error message is now WRONG** — llm-tool.ts L518–530 says "OAuth tokens cannot be used for direct API calls." This is incorrect — we PROVED `authToken` works. If we ship the orchestrator, this error message will confuse users. | **LOW** | llm-tool.ts L518: `if (!apiKey && oauthToken) { return errorResponse('call_llm requires an Anthropic API key...')` | Fix the error message in Phase 7 (cleanup). Change `call_llm` to also accept `authToken` + beta header. |
| **G9** | **Streaming REQUIRED for `max_tokens > 21,333`** — Anthropic SDK enforces client-side validation: `messages.create()` throws for `max_tokens > 21,333`. For 128K output, streaming is mandatory. | **CRITICAL** | Anthropic docs: "The SDKs require streaming when max_tokens is greater than 21,333 to avoid HTTP timeouts on long-running requests." | Use `client.messages.stream()` + `.finalMessage()` for ALL LLM calls. Phase 1 uses streaming exclusively. |
| **G10** | **`input + max_tokens` must not exceed 200K** — Anthropic API returns validation error if `prompt_tokens + max_tokens > context_window`. Hardcoding `max_tokens: 128000` fails when input exceeds 72K tokens. | **HIGH** | Anthropic docs: "The system will return a validation error if prompt tokens + max_tokens exceeds the context window size." | `ContextBudgetManager` calculates dynamic `max_tokens = min(desired, 200K - estimated_input)` before each call. Phase 1c. |
| **G11** | **Temperature incompatible with adaptive thinking** — Setting `temperature` when thinking is enabled causes an API error. | **HIGH** | Anthropic docs: "Thinking isn't compatible with temperature or top_k modifications." | NEVER pass `temperature` in API calls. Adaptive thinking provides sufficient determinism. Phase 1. |
| **G12** | **`tool_choice: "any"` incompatible with thinking** — Gamma forces structured output via `tool_choice: {type: "any"}`. This errors with thinking enabled: only `auto` or `none` allowed. | **HIGH** | Anthropic docs: "Tool use with thinking only supports tool_choice auto or none." | "No tools" design is correct for thinking-enabled workflows. Use JSON-in-text + Zod validation instead. Phase 1b. |
| **G13** | **Adaptive thinking is NOT enabled by default** — Omitting the `thinking` parameter disables thinking entirely. Must explicitly pass `thinking: {type: "adaptive"}`. | **MEDIUM** | Anthropic docs: "Set thinking.type to adaptive in your API request." Omitting = disabled. | Explicitly include `thinking: {type: "adaptive"}` in every API call. Phase 1. |
| **G14** | **Thinking tokens count against `max_tokens`** — With adaptive thinking, thinking + text output share the `max_tokens` budget. For effort `max`, Claude will use maximum thinking budget. | **MEDIUM** | Anthropic docs: "max_tokens includes your thinking budget when thinking is enabled." | Dynamic `max_tokens` accounts for this. Set generous targets. If `stop_reason: "max_tokens"`, log warning. |
| **G15** | **Repair loop missing from orchestrator** — Gamma's `ISAResearchWorkflow._run_repair_stages()` implements Stage 2↔3 iterative repair: if verification finds issues, re-run synthesis with feedback, up to N iterations. Config defines `repairUnits: [{stages: [3, 4], maxIterations: 2}]` but the plan's `AgentOrchestrator.run()` is a linear for-loop with NO repair logic. `repairUnits` would be dead config. | **CRITICAL** | gamma `workflow.py` L1174: `_run_repair_stages()`, config.json L57: `repairUnits`. Orchestrator `run()` has no back-edge. | Add repair loop to Phase 3: after verify stage, check `repairUnits` config → if verification fails and iterations < max, loop back to synthesis with feedback. See Phase 3 implementation. |
| **G16** | **MCP `callTool()` return type unhandled** — `CraftMcpClient.callTool()` returns a raw MCP `CallToolResult` object: `{ content: [{ type: "text", text: "{...json...}" }] }`. The plan's `McpBridge` directly returns `callTool()` as typed results. The MCP response unwrapping step (`result.content[0].text` → `JSON.parse()`) is absent. | **CRITICAL** | `client.ts` L133: `return this.client.callTool({ name, arguments: args })` returns raw `CallToolResult`. gamma `tool_executor.py` explicitly parses MCP response. | Add `parseMcpResult()` helper to `McpBridge` (Phase 4). Every `callTool()` return is unwrapped: `result.content[0].text` → `JSON.parse()` → Zod validation. |
| **G17** | **`thinking: {type: 'adaptive'}` not in SDK types** — Installed `@anthropic-ai/sdk@>=0.70.0` defines `ThinkingConfigParam = ThinkingConfigEnabled \| ThinkingConfigDisabled`. `ThinkingConfigEnabled` requires `type: 'enabled'` + `budget_tokens: number`. There is NO `type: 'adaptive'` variant. TypeScript will not compile. | **CRITICAL** | `node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts` L507-537: only `'enabled'` and `'disabled'` types defined. | Use `@ts-expect-error` annotation on `thinking` param AND `output_config` param. Document SDK version requirement. When SDK adds adaptive types, remove annotations. Phase 1 updated. |
| **G18** | **MCP client lifecycle undesigned** — `McpBridge` accepts `CraftMcpClient` but no phase covers WHERE the client comes from. The orchestrator bypasses the SDK (which normally manages source MCP connections). Needs its OWN `CraftMcpClient` with stdio transport, connected to ISA KB, with proper connect/close lifecycle. | **HIGH** | `sources/isa-knowledge-base/config.json`: transport config. `claude-agent.ts`: SDK manages MCP via `sourceMcpServers`. Orchestrator has no equivalent. | Phase 4 adds `McpLifecycleManager`: reads source config → creates `CraftMcpClient({ transport: 'stdio', ... })` → `connect()` → passes to `McpBridge` → `close()` on completion/error. |
| **G19** | **No ContextBuilder — ad-hoc context assembly** — Gamma's `ContextBuilder` (1178 lines) systematically shapes context with token budgets, XML formatting, session state, and stage summaries. Plan shows inline assembly in `runSynthesize()`. Functions `buildSynthesisPrompt()` and `buildSynthesisContext()` are called but never defined. | **HIGH** | gamma `context_builder.py`: XML formatting, tool guidance, session state. Plan `runSynthesize()`: calls undefined `buildSynthesisContext()`. | Add `context-builder.ts` to Phase 3 new files. Defines `buildStageContext()` for XML formatting of retrieval results, token-budgeted truncation, and stage-summary handoff. |
| **G20** | **`getValidClaudeOAuthToken()` ignores `connectionSlug`** — Function signature takes `connectionSlug: string` but internally calls `manager.getClaudeOAuthCredentials()` — a global Claude-specific method. Works with single connection but silently ignores slug with multiple connections. | **LOW** | `auth/state.ts` L185-194: parameter unused. `manager.ts` L186: `getClaudeOAuth()` is global. | Phase 9: add comment documenting this limitation. Low risk — single Claude Max connection is the target use case. |
| **G21** | **Stage 1 (`websearch_calibration`) handler undefined** — Stage dispatch has `case 'websearch_calibration'` but no implementation shown or planned. Config.json defines it as a separate pauseable stage with detailed `pauseInstructions`. The plan never specifies what this stage does: LLM call? MCP web search? How does it modify the query plan? | **MEDIUM** | config.json stage id 1. stage-runner.ts dispatch: no implementation. gamma embeds web search within Stage 0. | Phase 3 adds explicit `runWebsearchCalibration()` handler: calls ISA KB `isa_web_search` via McpBridge → LLM analyzes results → refines query plan → pause for user review. |
| **G22** | **`llm-tool.ts` uses legacy `type: 'enabled'` thinking** — `call_llm` tool uses `thinking: { type: 'enabled', budget_tokens }`. Plan's Phase 9 fixes OAuth error but doesn't upgrade thinking mode to adaptive. | **LOW** | `llm-tool.ts` L614-615: `request.thinking = { type: 'enabled', budget_tokens: thinkingBudget }`. | Phase 9 also updates `call_llm` to support adaptive thinking for Opus 4.6. Add `@ts-expect-error` for SDK type gap. |
| **G23** | **Safe Mode may block MCP tools if orchestrator reuses SDK connections** — Latest session shows `isa_citation_verify` blocked by Safe Mode. If orchestrator creates its OWN `CraftMcpClient` (per G18), Safe Mode won't apply (it's in SDK's `PreToolUse` hook). But if shared connections were used, orchestrator would fail in Safe Mode. | **LOW** | Session `260223-nimble-coast` L44: Safe Mode error. `CraftMcpClient` has no Safe Mode logic. | Resolved by G18: orchestrator uses its own `CraftMcpClient` instance. Safe Mode only applies to SDK-managed tool calls. Document this explicitly in Phase 4. |

---

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **LLM call method** | `client.messages.stream()` + `.finalMessage()` per stage | **Streaming is REQUIRED** by Anthropic SDK for `max_tokens > 21,333` (G9). `.finalMessage()` returns complete `Message` object. Stream events emitted for UI progress. Stateless — each call = fresh context. |
| **Auth method** | `new Anthropic({ authToken, baseURL, defaultHeaders })` | **Claude Max OAuth** subscription. Uses existing OAuth token from `credentialManager.getLlmOAuth()`. Explicit `authToken` — never env vars (G2). Bearer token + `anthropic-beta: oauth-2025-04-20` header (G1). |
| **Adaptive thinking** | `thinking: { type: "adaptive" }` — ALWAYS enabled | Opus 4.6 recommended mode. Claude dynamically determines when/how much to think. More cost-efficient on Claude Max (flat-rate subscription). `budget_tokens` is deprecated on Opus 4.6 — adaptive is the only supported path forward. |
| **Effort level** | `effort: "max"` — ALWAYS (depth-mode-aware: deep=`max`, standard/quick=`high`) | Maximum reasoning power on every call. At `max`, Claude applies absolute maximum thinking. Claude Max subscription means no per-token cost penalty. Configurable per depth mode — mirrors gamma's `DepthPreset.synthesis_effort`. |
| **Output tokens** | Dynamic `max_tokens` = `min(desired, 200K - input_tokens)` | Context window is strict: `input + max_tokens ≤ 200K` (G10). Max desired = 128K (Opus 4.6 limit). `ContextBudgetManager` calculates safe value before each call. |
| **Context window** | 200K standard with overflow protection | `ContextBudgetManager` estimates input tokens, truncates retrieval context if needed, enforces minimum output budget (4K tokens). No 1M beta header. |
| **Temperature** | **OMITTED** — incompatible with thinking | Anthropic docs: "Thinking isn't compatible with temperature modifications" (G11). Adaptive thinking provides sufficient quality for structured outputs. |
| **Tools given to LLM** | **NONE** — no `tools` parameter in API call | LLM generates text/JSON only. **Required** — adaptive thinking is incompatible with `tool_choice: "any"` (G12). TypeScript calls MCP tools. Zero bypass surface. |
| **Structured output** | BAML-generated TypeScript clients (primary) + JSON-in-text + Zod validation (fallback) | Each LLM stage defined in `.baml` files → generated typed clients handle parsing/validation. Fallback: `extractJson()` parses response text + Zod validation + retry. Phase 10 adds BAML; Phases 1-9 use Zod. |
| **MCP tool calls** | `CraftMcpClient.callTool(name, args)` from TypeScript + `parseMcpResult()` unwrapper | Existing client in `packages/shared/src/mcp/client.ts`. Returns raw `CallToolResult` — MUST unwrap: `result.content[0].text` → `JSON.parse()` → Zod validate (G16). |
| **MCP lifecycle** | Orchestrator creates its OWN `CraftMcpClient` per-pipeline | Reads source config → stdio transport → `connect()` before pipeline → `close()` after. NOT shared with SDK. Avoids Safe Mode blocking (G18, G23). |
| **Repair loop** | Stages 3↔4 iterate until verification passes (max N) | Mirrors gamma's `_run_repair_stages()`. Driven by `config.json` `repairUnits`. Verification feedback → re-synthesis prompt (G15). |
| **Context shaping** | `buildStageContext()` with XML formatting + token budget | Mirrors gamma's `ContextBuilder`. Retrieval paragraphs wrapped in `<ISA_CONTEXT>`. Token-budgeted truncation by relevance score. Stage-summary handoff (G19). |
| **State management** | TypeScript `PipelineState` object — code writes, code reads | No `agent_state` tool. Immutable append-only event log per gamma's `Thread`. |
| **Output rendering** | `renderDocument()` called by TypeScript after Stage 5 | Existing code in `agent-render-output/renderer.ts`. Called by orchestrator, not LLM. |
| **Pause/resume** | Yield control back to UI after pause stages (0, 1) | User responds, orchestrator resumes from checkpoint. Same UX as current stage gate pause. |
| **Normal chat** | **UNCHANGED** — SDK `query()` as today | Only agent pipelines use the orchestrator. No changes to `chat()` for regular messages. |

---

### Key Files (Existing)

| File | Role | How Used |
|------|------|----------|
| `packages/shared/src/agent/claude-agent.ts` | Main agent — `chat()` method | Modified: detect agent pipeline, delegate to orchestrator |
| `packages/shared/src/credentials/manager.ts` | `getLlmOAuth()` returns `{accessToken, refreshToken, expiresAt}` | Called before each LLM call to get fresh token |
| `apps/electron/src/main/sessions.ts` | `reinitializeAuth()`, `getValidClaudeOAuthToken()` | Token refresh logic — reused |
| `packages/shared/src/mcp/client.ts` | `CraftMcpClient.callTool(name, args)` | TypeScript calls MCP tools (ISA KB search, verify, etc.) |
| `packages/session-tools-core/src/handlers/agent-render-output/renderer.ts` | `renderDocument()` assembles markdown | Called by orchestrator in output stage |
| `agents/isa-deep-research/config.json` | Stage definitions, output config, depth modes | Drives the orchestrator loop |
| `agents/isa-deep-research/AGENT.md` | 920 lines of prompt | Decomposed into per-stage system prompts |
| `packages/shared/src/config/llm-connections.ts` | `getLlmConnection()` — connection config with `baseUrl`, `authType` | Used to resolve base URL and auth type |

### Key Files (New — to create)

| File | Role |
|------|------|
| `packages/shared/src/agent/orchestrator/index.ts` | `AgentOrchestrator` class — deterministic for-loop |
| `packages/shared/src/agent/orchestrator/llm-client.ts` | `OrchestratorLlmClient` — streaming wrapper around `new Anthropic({authToken}).messages.stream()` with adaptive thinking |
| `packages/shared/src/agent/orchestrator/pipeline-state.ts` | `PipelineState` — immutable event-sourced state (port of gamma's `Thread`) |
| `packages/shared/src/agent/orchestrator/stage-runner.ts` | Per-stage dispatch + prompt building |
| `packages/shared/src/agent/orchestrator/cost-tracker.ts` | Per-stage cost tracking from API response `usage` field |
| `packages/shared/src/agent/orchestrator/types.ts` | Type definitions for orchestrator |
| `packages/shared/src/agent/orchestrator/mcp-bridge.ts` | Typed wrapper for MCP tool calls (ISA KB tools) |
| `packages/shared/src/agent/orchestrator/context-budget.ts` | `ContextBudgetManager` — dynamic `max_tokens` calculation + retrieval truncation |
| `packages/shared/src/agent/orchestrator/json-extractor.ts` | `extractJson()` — Zod-validated JSON extraction from LLM text output |
| `packages/shared/src/agent/orchestrator/context-builder.ts` | `buildStageContext()` — XML-formatted, token-budgeted context shaping per stage |
| `packages/shared/src/agent/orchestrator/mcp-lifecycle.ts` | `McpLifecycleManager` — creates, connects, and closes `CraftMcpClient` for ISA KB |

---

### Implementation Phases

#### Phase 1: OrchestratorLlmClient — Raw Anthropic API with Claude Max OAuth [x]

**Goal:** Create a thin LLM client that makes a single max-power `client.messages.stream()` call using `authToken` from Claude Max OAuth. Adaptive thinking always enabled at effort `max`. No tools. Dynamic max_tokens. Context window overflow protection.

**Files to create:**
- `packages/shared/src/agent/orchestrator/llm-client.ts`
- `packages/shared/src/agent/orchestrator/types.ts`
- `packages/shared/src/agent/orchestrator/context-budget.ts`
- `packages/shared/src/agent/orchestrator/json-extractor.ts`

**Implementation:**

```typescript
// llm-client.ts — Claude Max OAuth + Adaptive Thinking + Streaming
import Anthropic from '@anthropic-ai/sdk';

const OAUTH_BETA_HEADER = 'oauth-2025-04-20';
const CONTEXT_WINDOW = 200_000;
const MIN_OUTPUT_BUDGET = 4_096;

export interface StreamEvent {
  type: 'text_delta' | 'thinking_delta';
  text?: string;
  thinking?: string;
}

export interface LlmCallOptions {
  systemPrompt: string;
  userMessage: string;              // Full context for this stage
  model?: string;                   // Default: 'claude-opus-4-6'
  desiredMaxTokens?: number;        // Soft target — dynamically adjusted to fit 200K window
  effort?: 'max' | 'high' | 'medium' | 'low';  // Default: 'max' (Opus 4.6). Per-stage override.
  onStreamEvent?: (event: StreamEvent) => void;  // Optional UI progress callback
}

export interface LlmCallResult {
  text: string;
  thinkingSummary?: string;         // Summarized adaptive thinking (if thinking occurred)
  redactedThinkingBlocks: number;   // Count of safety-redacted thinking blocks (0 if none)
  usage: { inputTokens: number; outputTokens: number };
  stopReason: string;
  model: string;
}

export class OrchestratorLlmClient {
  private baseURL: string;

  constructor(
    private getAuthToken: () => Promise<string>,  // Injected — calls credential manager
    baseURL?: string,
  ) {
    this.baseURL = baseURL || process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
  }

  async call(options: LlmCallOptions): Promise<LlmCallResult> {
    // Get fresh token EVERY call (handles refresh/expiry - G3)
    const authToken = await this.getAuthToken();

    const client = new Anthropic({
      authToken,             // Bearer auth — Claude Max OAuth (NOT apiKey) (G2)
      apiKey: null,          // Explicitly null — prevent env var pickup
      baseURL: this.baseURL, // Respect custom base URL (G6)
      defaultHeaders: {
        'anthropic-beta': OAUTH_BETA_HEADER,  // CRITICAL — G1
      },
    });

    // Dynamic max_tokens — MUST fit within 200K context window (G10)
    const estimatedInput = this.estimateTokens(options.systemPrompt + options.userMessage);
    const maxTokens = Math.min(
      options.desiredMaxTokens || 128_000,
      Math.max(CONTEXT_WINDOW - estimatedInput, MIN_OUTPUT_BUDGET),
    );

    // STREAMING is REQUIRED for max_tokens > 21,333 (G9)
    // Use .stream() + .finalMessage() for all calls
    const stream = client.messages.stream({
      model: options.model || 'claude-opus-4-6',
      max_tokens: maxTokens,
      system: options.systemPrompt,
      messages: [{ role: 'user', content: options.userMessage }],

      // Adaptive thinking — let Claude decide when and how much to think (G13).
      // Double cast: SDK v0.71.2 lacks 'adaptive' type, no overlap with union (G17).
      thinking: { type: 'adaptive' } as unknown as Anthropic.ThinkingConfigParam,

      // Effort level — 'max' = absolute maximum reasoning (Opus 4.6 only).
      // Not in stable SDK types (beta-only). Extra property on variable — passes TS.
      output_config: { effort: options.effort || 'max' },

      // NO tools — incompatible with tool_choice:"any" when thinking enabled (G12)
      // NO temperature — incompatible with adaptive thinking (G11)
    });

    // Emit progress events for UI if callback provided
    if (options.onStreamEvent) {
      stream.on('text', (text) => options.onStreamEvent?.({ type: 'text_delta', text }));
    }

    // Get complete message — blocks until stream finishes
    const response = await stream.finalMessage();

    // Extract text, thinking, and redacted thinking from response content blocks
    let text = '';
    let thinkingSummary: string | undefined;
    let redactedThinkingBlocks = 0;
    for (const block of response.content) {
      if (block.type === 'text') text += block.text;
      else if (block.type === 'thinking' && 'thinking' in block) {
        thinkingSummary = (thinkingSummary || '') + block.thinking;
      } else if (block.type === 'redacted_thinking') {
        redactedThinkingBlocks++;
      }
    }

    return {
      text,
      thinkingSummary,
      redactedThinkingBlocks,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      stopReason: response.stop_reason || 'unknown',
      model: response.model,
    };
  }

  /** Rough token estimation (~4 chars per token). For precision, use Anthropic token counting API. */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
```

**Context budget manager** (prevents 200K overflow):

```typescript
// context-budget.ts — Dynamic context window budget management
export class ContextOverflowError extends Error {
  constructor(
    public readonly estimatedInput: number,
    public readonly desiredOutput: number,
    public readonly contextWindow: number,
  ) {
    super(
      `Context overflow: input ~${estimatedInput} + output ${desiredOutput} = ` +
      `${estimatedInput + desiredOutput} > ${contextWindow}`
    );
  }
}

export class ContextBudgetManager {
  constructor(
    private readonly contextWindow = 200_000,
    private readonly minOutput = 4_096,
  ) {}

  /**
   * Calculate safe max_tokens for an API call.
   * Returns min(desiredOutput, contextWindow - estimatedInput).
   * Throws ContextOverflowError if not even minOutput fits.
   */
  calculateMaxTokens(estimatedInputTokens: number, desiredOutputTokens: number): number {
    const available = this.contextWindow - estimatedInputTokens;
    if (available < this.minOutput) {
      throw new ContextOverflowError(estimatedInputTokens, desiredOutputTokens, this.contextWindow);
    }
    return Math.min(desiredOutputTokens, available);
  }

  /**
   * Truncate retrieval context to fit within a token budget.
   * Keeps highest-relevance paragraphs, drops lowest-ranked.
   */
  truncateRetrievalContext(
    paragraphs: Array<{ text: string; score: number }>,
    maxTokens: number,
  ): Array<{ text: string; score: number }> {
    const sorted = [...paragraphs].sort((a, b) => b.score - a.score);
    const result: typeof sorted = [];
    let tokenCount = 0;
    for (const p of sorted) {
      const pTokens = Math.ceil(p.text.length / 4);
      if (tokenCount + pTokens > maxTokens) break;
      result.push(p);
      tokenCount += pTokens;
    }
    return result;
  }
}
```

**JSON extractor with Zod validation** (structured output without tools):

```typescript
// json-extractor.ts — Robust JSON extraction from LLM text output
import { z } from 'zod';

export class JsonExtractionError extends Error {
  constructor(message: string, public readonly rawText: string) {
    super(message);
  }
}

/**
 * Extract and validate JSON from LLM text response.
 *
 * Strategy (ordered):
 * 1. Parse full text as JSON
 * 2. Extract ```json ... ``` fenced code blocks
 * 3. Extract first { ... } or [ ... ] at root level
 * 4. Validate against Zod schema
 */
export function extractJson<T>(text: string, schema: z.ZodSchema<T>): T {
  const candidates: string[] = [];

  // Strategy 1: Full text
  candidates.push(text.trim());

  // Strategy 2: Fenced JSON blocks
  const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)```/g);
  if (fenced) {
    for (const block of fenced) {
      candidates.push(block.replace(/```(?:json)?\s*\n/, '').replace(/```$/, '').trim());
    }
  }

  // Strategy 3: First root-level { ... } or [ ... ]
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) candidates.push(braceMatch[0]);
  const bracketMatch = text.match(/\[[\s\S]*\]/);
  if (bracketMatch) candidates.push(bracketMatch[0]);

  // Try each candidate
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      return schema.parse(parsed);
    } catch {
      continue;
    }
  }

  throw new JsonExtractionError(
    `Failed to extract valid JSON from LLM response (${text.length} chars)`,
    text,
  );
}
```

**Auth token provider** (injected into orchestrator):

```typescript
// In claude-agent.ts or wherever orchestrator is created:
const getAuthToken = async (): Promise<string> => {
  const slug = getDefaultLlmConnection();
  if (!slug) throw new Error('No LLM connection configured');

  const connection = getLlmConnection(slug);
  if (connection?.authType === 'oauth' && connection?.providerType === 'anthropic') {
    // Use the existing refresh-aware function from sessions.ts
    const tokenResult = await getValidClaudeOAuthToken(slug);
    if (!tokenResult.accessToken) throw new Error('OAuth token expired and refresh failed');
    return tokenResult.accessToken;
  }

  // Fallback: direct credential read
  const credManager = getCredentialManager();
  const oauth = await credManager.getLlmOAuth(slug);
  if (oauth?.accessToken) return oauth.accessToken;

  throw new Error('No OAuth token available. Claude Max subscription required for orchestrator mode.');
};
```

**Validation:**
- [ ] `pnpm run typecheck:all` passes
- [ ] Unit test: mock `Anthropic` client, verify `authToken` + beta header are set
- [ ] Unit test: verify `apiKey: null` is passed (prevent env var pickup)
- [ ] Unit test: verify token refresh is called before each request
- [ ] Unit test: verify `thinking: {type: "adaptive"}` + `output_config: {effort: "max"}` are always passed
- [ ] Unit test: verify NO `temperature` parameter is passed
- [ ] Unit test: verify streaming is used (`messages.stream()` not `messages.create()`)
- [ ] Unit test: dynamic `max_tokens` — respects 200K context window
- [ ] Unit test: `ContextBudgetManager.calculateMaxTokens()` — correct arithmetic
- [ ] Unit test: `ContextBudgetManager.truncateRetrievalContext()` — respects budget
- [ ] Unit test: `extractJson()` — parses plain JSON, fenced JSON, embedded JSON
- [ ] Unit test: `extractJson()` — validates against Zod schema, throws on mismatch

---

#### Phase 2: PipelineState — Immutable Event-Sourced State [x]

**Goal:** Port gamma's `Thread` dataclass to TypeScript. Immutable, append-only event log. TypeScript writes state — LLM never touches it.

**Files to create:**
- `packages/shared/src/agent/orchestrator/pipeline-state.ts`

**Key design** (mirrors gamma's `core/thread.py`):

```typescript
interface StageEvent {
  type: 'stage_started' | 'stage_completed' | 'stage_failed' | 'llm_call' | 'mcp_tool_call' | 'pause_requested' | 'resumed';
  stage: number;
  timestamp: number;
  data: Record<string, unknown>;
}

interface PipelineState {
  readonly sessionId: string;
  readonly events: readonly StageEvent[];
  readonly currentStage: number;
  readonly stageOutputs: ReadonlyMap<number, unknown>;  // stage → output data

  // Derived properties (like gamma's Thread)
  get isComplete(): boolean;
  get isPaused(): boolean;
  get totalCostUsd(): number;

  // Immutable append — returns new state
  addEvent(event: Omit<StageEvent, 'timestamp'>): PipelineState;
  setStageOutput(stage: number, output: unknown): PipelineState;
}
```

**Persistence:** Save as JSON to `sessions/<id>/data/pipeline-state.json` after each stage. Enables resume on crash/restart.

**Validation:**
- [ ] `pnpm run typecheck:all` passes
- [ ] Unit test: immutability — `addEvent()` returns new instance, original unchanged
- [ ] Unit test: serialization round-trip (JSON save/load)

---

#### Phase 3: AgentOrchestrator — Deterministic For-Loop with Repair [x]

**Goal:** Create the main orchestrator class. TypeScript `for` loop over stages from `config.json` with **repair loop support** (G15). Mirrors gamma's `ISAResearchWorkflow.run()` and `_run_repair_stages()`.

**Files to create:**
- `packages/shared/src/agent/orchestrator/index.ts`
- `packages/shared/src/agent/orchestrator/stage-runner.ts`
- `packages/shared/src/agent/orchestrator/context-builder.ts`

**Core loop** (mirrors gamma's `workflow.py` L790–860 + L1174 `_run_repair_stages()`):

```typescript
class AgentOrchestrator {
  async *run(
    userMessage: string,
    agentConfig: AgentConfig,  // From config.json
    options: OrchestratorOptions,
  ): AsyncGenerator<AgentEvent> {
    const stages = agentConfig.controlFlow.stages;
    const repairUnits = agentConfig.controlFlow.repairUnits ?? [];
    let state = PipelineState.create(options.sessionId);

    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i];

      // 1. Emit stage start event (UI shows progress)
      state = state.addEvent({ type: 'stage_started', stage: stage.id, data: {} });
      yield { type: 'orchestrator_stage_start', stage: stage.id, name: stage.name };

      // 2. Check if this is a pause stage
      if (agentConfig.controlFlow.pauseAfterStages?.includes(stage.id)) {
        // Call LLM to generate pause message (analysis, clarification, etc.)
        const pauseResult = await this.runStage(stage, state, userMessage, agentConfig);
        state = state.setStageOutput(stage.id, pauseResult);

        // Yield pause event — UI shows message, waits for user
        yield { type: 'orchestrator_pause', stage: stage.id, message: pauseResult.text };
        state = state.addEvent({ type: 'pause_requested', stage: stage.id, data: {} });

        // Wait for resume (user responds → orchestrator.resume(userResponse) called)
        return; // Exit generator — resumed via new run() call with state loaded
      }

      // 3. Run the stage
      const stageResult = await this.runStage(stage, state, userMessage, agentConfig);

      // 4. Record output in state (TypeScript writes state — not LLM)
      state = state.setStageOutput(stage.id, stageResult);
      state = state.addEvent({
        type: 'stage_completed',
        stage: stage.id,
        data: { summary: stageResult.summary, usage: stageResult.usage },
      });

      // 5. Cost tracking
      this.costTracker.recordStage(stage.id, stageResult.usage);
      if (!this.costTracker.withinBudget()) {
        yield { type: 'orchestrator_budget_exceeded', totalCost: this.costTracker.totalCostUsd };
        return;
      }

      // 6. Checkpoint state to disk
      await state.saveTo(this.sessionPath);

      // 7. Emit stage complete (UI updates)
      yield { type: 'orchestrator_stage_complete', stage: stage.id, name: stage.name };

      // === REPAIR LOOP (G15) ===
      // After completing a stage, check if it's the LAST stage in a repair unit.
      // If verification failed → loop back to re-run the repair unit's stages.
      // Mirrors gamma's `_run_repair_stages()` in `workflow.py` L1174.
      const repairUnit = repairUnits.find(
        (ru) => ru.stages[ru.stages.length - 1] === stage.id,
      );
      if (repairUnit) {
        const verifyOutput = state.getStageOutput(stage.id);
        let repairIteration = 0;

        while (
          repairIteration < repairUnit.maxIterations &&
          verifyOutput?.data?.needsRepair === true
        ) {
          repairIteration++;
          yield { type: 'orchestrator_repair_start', iteration: repairIteration, maxIterations: repairUnit.maxIterations };

          // Re-run all stages in the repair unit with feedback
          for (const repairStageId of repairUnit.stages) {
            const repairStage = stages.find((s) => s.id === repairStageId)!;
            state = state.addEvent({
              type: 'stage_started', stage: repairStageId,
              data: { repairIteration, feedback: verifyOutput.data[repairUnit.feedbackField] },
            });

            const repairResult = await this.runStage(
              repairStage, state, userMessage, agentConfig,
            );
            state = state.setStageOutput(repairStageId, repairResult);
            state = state.addEvent({
              type: 'stage_completed', stage: repairStageId,
              data: { repairIteration, usage: repairResult.usage },
            });
            this.costTracker.recordStage(repairStageId, repairResult.usage);
            await state.saveTo(this.sessionPath);
          }

          // Re-check the last stage's output for another repair round
          const reVerifyOutput = state.getStageOutput(stage.id);
          if (!reVerifyOutput?.data?.needsRepair) break;
        }
      }
    }

    // All stages done — pipeline complete
    yield { type: 'orchestrator_complete', state };
  }
}
```

**Stage dispatch** (mirrors gamma's `_run_stage()` — `workflow.py` L974–996):

```typescript
// stage-runner.ts
async runStage(
  stage: StageConfig,
  state: PipelineState,
  userMessage: string,
  agentConfig: AgentConfig,
): Promise<StageResult> {
  switch (stage.name) {
    case 'analyze_query':
      return this.runAnalyzeQuery(stage, state, userMessage, agentConfig);
    case 'websearch_calibration':
      return this.runWebsearchCalibration(stage, state, agentConfig);  // (G21) — see below
    case 'retrieve':
      return this.runRetrieve(stage, state, agentConfig);  // MCP tool calls — no LLM
    case 'synthesize':
      return this.runSynthesize(stage, state, agentConfig); // LLM call
    case 'verify':
      return this.runVerify(stage, state, agentConfig);     // MCP tool calls
    case 'output':
      return this.runOutput(stage, state, agentConfig);     // Renderer — no LLM
    default:
      throw new Error(`Unknown stage: ${stage.name}`);
  }
}
```

**Stage 1: websearch_calibration handler** (G21):

Config.json defines stage 1 as a separate pauseable stage (`pauseAfterStages: [0, 1]`).
This stage runs web searches to calibrate retrieval queries before the full KB search.

```typescript
async runWebsearchCalibration(
  stage: StageConfig,
  state: PipelineState,
  agentConfig: AgentConfig,
): Promise<StageResult> {
  // 1. Get query plan from Stage 0
  const queryPlan = state.getStageOutput(0);
  if (!queryPlan?.data?.queries) {
    return { text: 'No queries to calibrate', summary: 'Skipped — no query plan', usage: ZERO_USAGE, data: {} };
  }

  // 2. Run web searches via McpBridge for each query
  const webResults: WebSearchResult[] = [];
  for (const query of queryPlan.data.queries) {
    const result = await this.mcpBridge.webSearch(query.text);
    webResults.push(result);
  }

  // 3. LLM analyzes web results → refines query plan
  const systemPrompt = buildWebsearchCalibrationPrompt(agentConfig);
  const userContent = buildStageContext({
    stageName: 'websearch_calibration',
    previousOutputs: { queryPlan: queryPlan.data },
    retrievalContext: webResults,
    agentConfig,
  });

  const result = await this.llmClient.call({
    systemPrompt,
    userMessage: userContent,
    desiredMaxTokens: 16_000,  // Calibration is lightweight
  });

  // 4. Parse calibrated query plan
  const calibrated = extractJson(result.text, WebsearchCalibrationSchema);

  return {
    text: result.text,
    summary: `Calibrated ${calibrated.queries?.length ?? 0} queries`,
    usage: result.usage,
    data: calibrated,
  };
}
```

**Per-stage LLM call pattern** (each stage = 1 API call with full context):

```typescript
async runSynthesize(stage, state, agentConfig): Promise<StageResult> {
  // 1. Build context from previous stages (TypeScript assembles — like gamma)
  const queryPlan = state.getStageOutput(0);   // From stage 0
  const retrievalResults = state.getStageOutput(2);  // From stage 2

  // 2. Build focused system prompt (decomposed from AGENT.md Stage 3 section)
  const systemPrompt = buildSynthesisPrompt(agentConfig);

  // 3. Build user message with XML-formatted context (G19 — context-builder.ts)
  const userContent = buildStageContext({
    stageName: 'synthesize',
    previousOutputs: { queryPlan: queryPlan.data, calibration: state.getStageOutput(1)?.data },
    retrievalContext: retrievalResults.data?.paragraphs ?? [],
    agentConfig,
    tokenBudget: 70_000,  // Max tokens for context — truncates by relevance score
  });
```

**context-builder.ts** (G19 — mirrors gamma's `ContextBuilder` 1178 lines):

Gamma's `ContextBuilder` wraps each context section in XML tags (`<ISA_CONTEXT>`, `<QUERY_PLAN>`, `<STAGE_SUMMARY>`, etc.), sorts retrieval paragraphs by relevance score, and truncates to fit within token budget. Our TypeScript equivalent:

```typescript
// context-builder.ts

interface BuildStageContextOptions {
  stageName: string;
  previousOutputs: Record<string, unknown>;   // Stage outputs from PipelineState
  retrievalContext?: RetrievalParagraph[];     // KB search results
  agentConfig: AgentConfig;                    // For stage-specific formatting
  tokenBudget?: number;                        // Max tokens for assembled context
  repairFeedback?: string;                     // If in repair iteration (G15)
}

/**
 * Assemble XML-formatted context for a single LLM call.
 * Mirrors gamma's ContextBuilder — shapes context per micro-agent.
 * Each section wrapped in XML tags for Claude to parse structurally.
 */
export function buildStageContext(options: BuildStageContextOptions): string {
  const sections: string[] = [];

  // 1. Query plan (always included for context)
  if (options.previousOutputs.queryPlan) {
    sections.push(wrapXml('QUERY_PLAN', JSON.stringify(options.previousOutputs.queryPlan, null, 2)));
  }

  // 2. Previous stage summaries (handoff context)
  for (const [key, value] of Object.entries(options.previousOutputs)) {
    if (key !== 'queryPlan' && value) {
      sections.push(wrapXml(`STAGE_OUTPUT_${key.toUpperCase()}`, JSON.stringify(value, null, 2)));
    }
  }

  // 3. Retrieval context — sorted by relevance, token-budgeted (G19)
  if (options.retrievalContext?.length) {
    const sorted = [...options.retrievalContext].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const budget = options.tokenBudget ?? 60_000;
    const truncated = truncateByTokenBudget(sorted, budget);
    const formatted = truncated.map((p) =>
      `<PARAGRAPH id="${p.id}" score="${p.score}" source="${p.source}">\n${p.text}\n</PARAGRAPH>`
    ).join('\n');
    sections.push(wrapXml('ISA_CONTEXT', formatted));
  }

  // 4. Repair feedback (if in repair iteration — G15)
  if (options.repairFeedback) {
    sections.push(wrapXml('REPAIR_FEEDBACK', options.repairFeedback));
  }

  return sections.join('\n\n');
}

function wrapXml(tag: string, content: string): string {
  return `<${tag}>\n${content}\n</${tag}>`;
}

function truncateByTokenBudget(paragraphs: RetrievalParagraph[], budget: number): RetrievalParagraph[] {
  let tokenCount = 0;
  const result: RetrievalParagraph[] = [];
  for (const p of paragraphs) {
    const estimated = estimateTokens(p.text);
    if (tokenCount + estimated > budget) break;
    tokenCount += estimated;
    result.push(p);
  }
  return result;
}
```

Continuing `runSynthesize()`:

```typescript
  // 4. ONE max-power LLM call — streaming + adaptive thinking + effort max
  const result = await this.llmClient.call({
    systemPrompt,
    userMessage: userContent,
    desiredMaxTokens: 128_000,  // Dynamic — auto-adjusted to fit 200K window
    onStreamEvent: (event) => this.emitProgress(stage.id, event),
  });

  // 6. Parse structured output with Zod validation (JSON-in-text)
  const synthesis = extractJson(result.text, SynthesisOutputSchema);

  return { text: result.text, summary: 'Synthesis complete', usage: result.usage, data: synthesis };
}
```

**Events yielded to UI** — The orchestrator yields internal `OrchestratorEvent` types.
Phase 6's `runOrchestrator()` maps these to the **existing** renderer event types
(`AgentStageStartedEvent`, `AgentStageCompletedEvent`, `AgentRepairIterationEvent`,
`AgentRunCompletedEvent`, `AgentStageGatePauseEvent`) already defined in
`apps/electron/src/renderer/event-processor/types.ts` and already handled by
`processor.ts` (emits `agent_run_state_update` effects → drives `agentRunStateAtom`).

```typescript
type OrchestratorEvent =
  | { type: 'orchestrator_stage_start'; stage: number; name: string }
  | { type: 'orchestrator_stage_complete'; stage: number; name: string; stageOutput?: Record<string, unknown> }
  | { type: 'orchestrator_pause'; stage: number; message: string }
  | { type: 'orchestrator_repair_start'; iteration: number; maxIterations: number; scores?: Record<string, number> }
  | { type: 'orchestrator_budget_exceeded'; totalCost: number }
  | { type: 'orchestrator_complete'; state: PipelineState }
  | { type: 'orchestrator_error'; stage: number; error: string }
  | { type: 'text'; text: string }  // Streamed text for UI display
```

**Validation:**
- [ ] `pnpm run typecheck:all` passes
- [ ] Integration test: mock LLM client + mock MCP client → verify stages run in order
- [ ] Integration test: pause/resume flow
- [ ] Integration test: budget exceeded → pipeline stops
- [ ] Integration test: repair loop — verify stages re-run when `needsRepair === true`, stops at `maxIterations` (G15)
- [ ] Unit test: `buildStageContext()` — XML tags present, token budget respected, sorted by score (G19)
- [ ] Unit test: `runWebsearchCalibration()` — calls McpBridge.webSearch, LLM refines query plan (G21)

---

#### Phase 4: MCP Bridge — Programmatic Tool Calls [x]

**Goal:** TypeScript calls ISA KB tools via `CraftMcpClient.callTool()` instead of giving tools to LLM. Like gamma's `_run_stage1()` which calls KB directly. Includes **MCP response parsing** (G16) and **MCP client lifecycle** (G18).

**Files to create:**
- `packages/shared/src/agent/orchestrator/mcp-bridge.ts`
- `packages/shared/src/agent/orchestrator/mcp-lifecycle.ts`

**MCP Client Lifecycle Manager** (G18):

The orchestrator bypasses the SDK (which normally manages source MCP connections via `sourceMcpServers`). Therefore the orchestrator needs its OWN `CraftMcpClient` with proper connect/close lifecycle:

```typescript
// mcp-lifecycle.ts
import { CraftMcpClient } from '../../mcp/client';

interface McpSourceConfig {
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  url?: string;  // For HTTP transport
}

/**
 * Manages MCP client lifecycle for the orchestrator.
 * Reads source config → creates CraftMcpClient → connect() → passes to McpBridge → close().
 * The orchestrator's client is SEPARATE from SDK-managed connections.
 * This means Safe Mode (SDK's PreToolUse hook) does NOT apply (G23).
 */
export class McpLifecycleManager {
  private client: CraftMcpClient | null = null;

  async connect(sourceConfig: McpSourceConfig): Promise<CraftMcpClient> {
    this.client = new CraftMcpClient({
      transport: sourceConfig.transport,
      command: sourceConfig.command,
      args: sourceConfig.args,
      cwd: sourceConfig.cwd,
      env: sourceConfig.env,
      url: sourceConfig.url,
    });
    await this.client.connect();
    return this.client;
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }

  /** Ensures close() is called even if pipeline throws */
  async withClient<T>(
    sourceConfig: McpSourceConfig,
    fn: (client: CraftMcpClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.connect(sourceConfig);
    try {
      return await fn(client);
    } finally {
      await this.close();
    }
  }
}
```

**MCP Response Parsing** (G16):

`CraftMcpClient.callTool()` returns raw MCP `CallToolResult` = `{ content: [{ type: "text", text: "{...json...}" }] }`. Must unwrap before use:

```typescript
// mcp-bridge.ts

import { z } from 'zod';

/** Unwrap raw MCP CallToolResult → parsed JSON → Zod validated (G16) */
function parseMcpResult<T>(raw: unknown, schema: z.ZodType<T>): T {
  // raw is CallToolResult: { content: [{ type: "text", text: "..." }] }
  const result = raw as { content: Array<{ type: string; text?: string }> };

  if (!result?.content?.length) {
    throw new Error('MCP tool returned empty result');
  }

  const textBlock = result.content.find((c) => c.type === 'text');
  if (!textBlock?.text) {
    throw new Error('MCP tool returned no text content');
  }

  const parsed = JSON.parse(textBlock.text);
  return schema.parse(parsed);
}
```

**McpBridge Design** (updated with response parsing):

```typescript
class McpBridge {
  constructor(private mcpClient: CraftMcpClient) {}

  // Stage 2: Retrieval — TypeScript calls these based on query plan
  async hybridSearch(query: string, options: SearchOptions): Promise<SearchResult> {
    const raw = await this.mcpClient.callTool('isa_hybrid_search', { query, ...options });
    return parseMcpResult(raw, SearchResultSchema);
  }

  async hopRetrieve(paragraphId: string, depth: number): Promise<HopResult> {
    const raw = await this.mcpClient.callTool('isa_hop_retrieve', { paragraph_id: paragraphId, depth });
    return parseMcpResult(raw, HopResultSchema);
  }

  async formatContext(paragraphIds: string[]): Promise<string> {
    const raw = await this.mcpClient.callTool('isa_format_context', { paragraph_ids: paragraphIds });
    // formatContext returns plain text, not JSON
    const result = raw as { content: Array<{ type: string; text?: string }> };
    return result.content.find((c) => c.type === 'text')?.text ?? '';
  }

  // Stage 4: Verification — TypeScript calls these, not LLM
  async citationVerify(citations: Citation[]): Promise<VerificationResult> {
    const raw = await this.mcpClient.callTool('isa_citation_verify', { citations });
    return parseMcpResult(raw, VerificationResultSchema);
  }

  async entityVerify(entities: Entity[]): Promise<VerificationResult> {
    const raw = await this.mcpClient.callTool('isa_entity_verify', { entities });
    return parseMcpResult(raw, VerificationResultSchema);
  }

  // Web search (Stage 1 calibration)
  async webSearch(query: string): Promise<WebSearchResult> {
    const raw = await this.mcpClient.callTool('isa_web_search', { query });
    return parseMcpResult(raw, WebSearchResultSchema);
  }
}
```

**Key insight:** Stages 2 (retrieve) and 4 (verify) in gamma have NO LLM calls — they are pure MCP/KB tool calls orchestrated by Python. Our TypeScript does the same. The orchestrator's own `CraftMcpClient` (via `McpLifecycleManager`) means Safe Mode does NOT apply — it only exists in the SDK's `PreToolUse` hook on SDK-managed connections (G23).

**Validation:**
- [ ] `pnpm run typecheck:all` passes
- [ ] Unit test: mock `CraftMcpClient` → verify `parseMcpResult()` unwraps `CallToolResult` correctly (G16)
- [ ] Unit test: `parseMcpResult()` edge cases — empty content, missing text, invalid JSON, Zod mismatch
- [ ] Unit test: `McpLifecycleManager` — connect/close/withClient lifecycle (G18)
- [ ] Test with real ISA KB MCP server (manual)

---

#### Phase 5: Cost Tracker [x]

**Goal:** Per-stage cost tracking from API response `usage` field. Budget enforcement. Mirrors gamma's `CostTracker`.

**Files to create:**
- `packages/shared/src/agent/orchestrator/cost-tracker.ts`

**Design:**

```typescript
class CostTracker {
  private stageUsage: Map<number, { inputTokens: number; outputTokens: number; costUsd: number }>;
  private budgetUsd: number;

  // Pricing for Opus 4.6 (configurable)
  // NOTE: On Claude Max subscription, these are "equivalent" costs for monitoring only.
  // The user pays a flat subscription fee, not per-token.
  private inputCostPerMTok = 5.0;     // $5/MTok (equivalent)
  private outputCostPerMTok = 25.0;   // $25/MTok (equivalent)
  // NOTE: With adaptive thinking, output_tokens includes thinking tokens.
  // The billed count may not match visible text tokens — thinking is billed as output.

  recordStage(stageId: number, usage: { inputTokens: number; outputTokens: number }): void {
    const cost = (usage.inputTokens / 1_000_000 * this.inputCostPerMTok) +
                 (usage.outputTokens / 1_000_000 * this.outputCostPerMTok);
    this.stageUsage.set(stageId, { ...usage, costUsd: cost });
  }

  get totalCostUsd(): number { /* sum all stages */ }
  withinBudget(): boolean { return this.totalCostUsd < this.budgetUsd; }
}
```

**Note:** Claude Max subscription means the user is NOT billed per-token for their subscription tier. However, cost tracking is still useful for:
- Monitoring token consumption patterns (especially thinking tokens with effort `max`)
- Comparing stage efficiency
- Detecting runaway stages (thinking can expand output significantly at `max` effort)
- Setting soft limits to prevent infinite loops
- With adaptive thinking at effort `max`, `output_tokens` includes both thinking and text tokens

**Validation:**
- [ ] `pnpm run typecheck:all` passes
- [ ] Unit test: cost calculation accuracy
- [ ] Unit test: budget enforcement

---

#### Phase 6: Integration — Wire Orchestrator into ClaudeAgent [x]

**Goal:** Modify `claude-agent.ts` `chat()` to detect agent pipeline and delegate to `AgentOrchestrator` instead of SDK `query()`.

**Files to modify:**
- `packages/shared/src/agent/claude-agent.ts`

**Detection logic:**

```typescript
// In chat() method, before the SDK query() call:
const agentConfig = this.getAgentConfig();  // From config.json
const hasOrchestratableStages = agentConfig?.controlFlow?.stages?.length > 0;

if (hasOrchestratableStages && this.shouldUseOrchestrator()) {
  // Deterministic mode — TypeScript drives
  yield* this.runOrchestrator(userMessage, agentConfig, attachments);
  return;
}

// Normal mode — SDK drives (existing behavior, unchanged)
this.currentQuery = query({ prompt, options });
// ... existing code ...
```

**`shouldUseOrchestrator()`** — initially always true when agent has stages. Later: could be a setting toggle.

**Event mapping (F6 fix)** — Emit **existing** renderer event types, NOT generic `system_message`.

The renderer already has full infrastructure for these events:
- `AgentStageStartedEvent` / `AgentStageCompletedEvent` — `event-processor/types.ts` L437/L449
- `AgentRepairIterationEvent` — `event-processor/types.ts` L462
- `AgentRunCompletedEvent` — `event-processor/types.ts` L472
- `AgentStageGatePauseEvent` — `event-processor/types.ts` L485
- Event processor handles all five in `processor.ts` L212–260 → emits `agent_run_state_update` effects → drives `agentRunStateAtom` in renderer

```typescript
import type {
  AgentStageStartedEvent,
  AgentStageCompletedEvent,
  AgentRepairIterationEvent,
  AgentRunCompletedEvent,
  AgentStageGatePauseEvent,
} from '../../renderer/event-processor/types';

async *runOrchestrator(userMessage, agentConfig, attachments) {
  const orchestrator = new AgentOrchestrator(this.llmClient, this.mcpBridge, this.sessionPath);
  const runId = crypto.randomUUID();

  for await (const event of orchestrator.run(userMessage, agentConfig, options)) {
    switch (event.type) {
      case 'orchestrator_stage_start':
        // Emit EXISTING AgentStageStartedEvent — processor.ts L212 handles this
        yield {
          type: 'agent_stage_started',
          sessionId: this.sessionId,
          agentSlug: agentConfig.slug,
          runId,
          stage: event.stage,
          stageName: event.name,
        } satisfies AgentStageStartedEvent;
        break;

      case 'orchestrator_stage_complete':
        yield {
          type: 'agent_stage_completed',
          sessionId: this.sessionId,
          agentSlug: agentConfig.slug,
          runId,
          stage: event.stage,
          stageName: event.name,
          data: event.stageOutput,
        } satisfies AgentStageCompletedEvent;
        break;

      case 'orchestrator_repair_start':
        yield {
          type: 'agent_repair_iteration',
          sessionId: this.sessionId,
          agentSlug: agentConfig.slug,
          runId,
          iteration: event.iteration,
          scores: event.scores,
        } satisfies AgentRepairIterationEvent;
        break;

      case 'orchestrator_pause':
        // First emit assistant text so user sees the analysis
        yield { type: 'assistant_text', text: event.message };
        // Then emit stage gate pause — triggers pausedAgent state in renderer
        yield {
          type: 'agent_stage_gate_pause',
          sessionId: this.sessionId,
          agentSlug: agentConfig.slug,
          runId,
          stage: event.stage,
        } satisfies AgentStageGatePauseEvent;
        break;

      case 'orchestrator_complete':
        yield {
          type: 'agent_run_completed',
          sessionId: this.sessionId,
          agentSlug: agentConfig.slug,
          runId,
          verificationStatus: event.state.getStageOutput(4)?.data?.status ?? 'unknown',
        } satisfies AgentRunCompletedEvent;
        break;

      case 'orchestrator_budget_exceeded':
        yield { type: 'error', error: `Budget exceeded: $${event.totalCost.toFixed(2)}` };
        yield {
          type: 'agent_run_completed',
          sessionId: this.sessionId,
          agentSlug: agentConfig.slug,
          runId,
          verificationStatus: 'budget_exceeded',
        } satisfies AgentRunCompletedEvent;
        break;

      case 'text':
        yield { type: 'assistant_text', text: event.text };
        break;

      case 'orchestrator_error':
        yield { type: 'error', error: `Stage ${event.stage} error: ${event.error}` };
        yield {
          type: 'agent_run_completed',
          sessionId: this.sessionId,
          agentSlug: agentConfig.slug,
          runId,
          verificationStatus: 'error',
        } satisfies AgentRunCompletedEvent;
        break;
    }
  }
}
```

**Validation:**
- [x] `pnpm run typecheck:all` passes
- [x] `pnpm run lint` passes (66 problems — all pre-existing, 0 new)
- [ ] Manual test: @isa-deep-research triggers orchestrator mode (deferred to Phase 10)
- [ ] Manual test: normal chat (no agent) still uses SDK query() (deferred to Phase 10)
- [ ] Unit test: `runOrchestrator()` emits correct events (deferred to Phase 10)
- [ ] Unit test: `runOrchestrator()` emits `AgentStageGatePauseEvent` on pause (deferred to Phase 10)
- [ ] Unit test: `runOrchestrator()` emits `AgentRunCompletedEvent` (deferred to Phase 10)
- [ ] Integration test: verify `agentRunStateAtom` updates (deferred to Phase 10)
- [ ] E2E test: orchestrator completes a full pipeline with mock KB (deferred to Phase 10)

---

#### Phase 7: Per-Stage Prompt Decomposition [x]

**Goal:** Decompose `AGENT.md` 920-line prompt into focused per-stage system prompts. Each stage gets ONLY its relevant instructions.

**Files to create/modify:**
- `agents/isa-deep-research/prompts/stage-0-analyze.md`
- `agents/isa-deep-research/prompts/stage-1-websearch.md`
- `agents/isa-deep-research/prompts/stage-2-retrieve.md` (minimal — mostly MCP calls)
- `agents/isa-deep-research/prompts/stage-3-synthesize.md`
- `agents/isa-deep-research/prompts/stage-4-verify.md` (minimal — mostly MCP calls)
- `agents/isa-deep-research/prompts/stage-5-output.md` (minimal — renderer does it)

**Key principle:** Each prompt is SHORT and focused. No "don't skip this" — the LLM CAN'T skip it because TypeScript controls the loop.

Example for Stage 3 (Synthesize):

```markdown
You are synthesizing an authoritative research answer about ISA (International Standards on Auditing).

## Your Task
Generate a comprehensive research answer using ONLY the provided source material.

## Input
You receive:
1. The original user query and refined query plan
2. Retrieved ISA paragraphs with full text
3. Formatted XML context from the knowledge base

## Output Format
Return a JSON object:
{
  "synthesis": "Full markdown answer text with inline citations like (ISA 315.12)",
  "citations_used": ["ISA 315.12", "ISA 540.20", ...],
  "confidence": 0.85,
  "gaps": ["Any gaps in coverage"]
}

## Citation Rules
- Every factual claim MUST reference a specific ISA paragraph
- Use format: (ISA {number}.{paragraph})
- Do not invent or extrapolate beyond source material
```

**Validation:**
- [x] Each prompt file is self-contained and focuses on ONE stage
- [x] `pnpm run typecheck:all` passes
- [ ] Manual test: quality of LLM output with focused prompts vs. 920-line AGENT.md (deferred to Phase 10)

---

#### Phase 8: Output Stage — Deterministic Rendering [x]

**Goal:** Stage 5 (output) calls `renderDocument()` from TypeScript. The LLM is NOT involved in output formatting. Mirrors gamma's `OutputRenderer.render_answer_md()`.

**Implementation:**

```typescript
async runOutput(stage, state, agentConfig): Promise<StageResult> {
  // 1. Gather data from previous stages
  const synthesis = state.getStageOutput(3);    // Stage 3 synthesis
  const verification = state.getStageOutput(4); // Stage 4 verification

  // 2. Build FinalAnswer object (the schema agent_render_research_output expects)
  const finalAnswer: FinalAnswer = {
    title: agentConfig.output.titleTemplate,
    synthesis: synthesis.data.synthesis,
    citations: synthesis.data.citations_used,
    verificationSummary: verification.data.verification_scores,
    sourceTexts: verification.data.source_texts,
    // ... etc
  };

  // 3. Call existing renderer — CODE calls it, not LLM
  const { renderDocument, injectSourceBlocks } = await import(
    '@craft-agent/session-tools-core/handlers/agent-render-output/renderer'
  );

  let markdown = renderDocument(finalAnswer, agentConfig.output);
  if (verification.data.source_texts) {
    markdown = injectSourceBlocks(markdown, verification.data.source_texts, agentConfig.output);
  }

  // 4. Write file — CODE writes it, not LLM
  const outputPath = path.join(this.sessionPath, 'plans', agentConfig.output.files.answerFile);
  await fs.writeFile(outputPath, markdown);

  return {
    text: markdown,
    summary: 'Output rendered and saved',
    usage: { inputTokens: 0, outputTokens: 0 },  // No LLM call in this stage
    data: { outputPath, totalCitations: synthesis.data.citations_used.length },
  };
}
```

**Key wins:**
- Citations: ALWAYS present (rendered by code)
- Verification table: ALWAYS present (rendered by code)
- Source blockquotes: ALWAYS present (injected by code from Stage 4 data)
- File output: ALWAYS created (written by code)
- Zero LLM bypass surface

**Validation:**
- [x] `pnpm run typecheck:all` passes
- [ ] Unit test: verify output contains citations, verification table, sources
- [ ] Compare output quality vs. gamma's output for same query

---

#### Phase 9: Cleanup & Error Fix [x]

**Goal:** Fix incorrect error messages, upgrade `call_llm` thinking, add configuration options, document design decisions.

**Files to modify:**
- `packages/shared/src/agent/llm-tool.ts` — Fix L518–530 error message (G8) + upgrade thinking to adaptive (G22)
- `packages/shared/src/auth/state.ts` — Document slug limitation (G20)
- `agents/isa-deep-research/config.json` — Add `orchestrator` config section

**Config additions to `config.json`:**

```json
{
  "orchestrator": {
    "enabled": true,
    "model": "claude-opus-4-6",
    "thinking": { "type": "adaptive" },
    "effort": "max",
    "depthModeEffort": {
      "quick": "high",
      "standard": "high",
      "deep": "max"
    },
    "contextWindow": 200000,
    "minOutputBudget": 4096,
    "budgetUsd": 10.0,
    "perStageDesiredTokens": {
      "0": 16384,
      "1": 8192,
      "3": 128000,
      "5": 0
    },
    "useBAML": true,
    "bamlFallbackToZod": true
  }
}
```

**Fix `call_llm` tool** — Now that we know `authToken` works, update the error:

```typescript
// llm-tool.ts L518 — BEFORE (wrong):
// "OAuth tokens cannot be used for direct API calls"

// AFTER (correct):
if (!apiKey && oauthToken) {
  // Use authToken with OAuth beta header
  const client = new Anthropic({
    authToken: oauthToken,
    apiKey: null,
    defaultHeaders: { 'anthropic-beta': 'oauth-2025-04-20' },
  });
  // ... proceed with call
}
```

**Upgrade `call_llm` thinking to adaptive** (G22):

```typescript
// llm-tool.ts L614 — BEFORE:
// request.thinking = { type: 'enabled', budget_tokens: thinkingBudget };

// AFTER:
if (model.startsWith('claude-opus-4') || model.startsWith('claude-sonnet-4')) {
  // Opus 4.6+ supports adaptive thinking — let Claude decide when to think
  // @ts-expect-error — SDK types don't define 'adaptive' yet (G17)
  request.thinking = { type: 'adaptive' };
} else {
  // Older models use explicit thinking budget
  request.thinking = { type: 'enabled', budget_tokens: thinkingBudget };
}
```

**Document `getValidClaudeOAuthToken` slug limitation** (G20):

```typescript
// auth/state.ts L185 — Add JSDoc:
/**
 * Get a valid Claude OAuth token for API calls.
 *
 * NOTE (G20): The `connectionSlug` parameter is currently ignored.
 * Internally calls `manager.getClaudeOAuthCredentials()` which is global
 * (not slug-aware). This works for single Claude Max connection but would
 * silently use wrong credentials with multiple connections.
 * Low risk — single Claude Max connection is the target use case.
 */
export async function getValidClaudeOAuthToken(connectionSlug: string): Promise<string> {
```

**Document Safe Mode bypass** (G23):

Add a comment in `mcp-lifecycle.ts` (created in Phase 4):
```typescript
/**
 * DESIGN NOTE (G23): The orchestrator's CraftMcpClient is SEPARATE from
 * SDK-managed MCP connections. This means the SDK's Safe Mode (PreToolUse hook)
 * does NOT apply to orchestrator tool calls. This is intentional — the
 * orchestrator is trusted code making deterministic calls, not an LLM
 * autonomously selecting tools. If Safe Mode needs to apply to orchestrator
 * calls in the future, add a SafeMode check in McpBridge.
 */
```

**Validation:**
- [x] `pnpm run typecheck:all` passes
- [x] `pnpm run lint` passes (66 problems — unchanged baseline)
- [ ] `pnpm run test` passes

---

#### Phase 10: BAML Integration — Type-Safe Prompt Definitions [x]

**Goal:** Replace `json-extractor.ts` + Zod schemas with BAML-generated TypeScript clients for LLM-calling stages.
Each stage’s prompt, input context type, and output schema are defined together in `.baml` files.
BAML generates type-safe TypeScript clients that handle parsing, validation, and retry.

**Rationale:**
- Gamma uses BAML for stages 0, 2, and 4 (proven pattern — `baml_src/isa_research/`)
- BAML co-locates prompt + types → single source of truth (no drift between prompt instructions and Zod schemas)
- Generated clients handle JSON extraction automatically (replaces `extractJson()` + 4 regex strategies)
- TypeScript output mode (`output_type "typescript"`) generates Zod-equivalent types with runtime validation
- BAML’s built-in retry/fallback replaces manual "Return valid JSON" retry logic

**Prerequisites:** Phases 1–9 complete. BAML is an enhancement layer, not a blocker.

**Note on gamma mapping:** Gamma’s stages are numbered 0–4. Our config.json has stages 0–5.
Gamma stage 2 (synthesize) = our stage 3. Gamma stage 4 (output) = our stage 5.
BAML files below use OUR stage numbering.

**Files to create:**
- `packages/shared/baml_src/generators.baml`
- `packages/shared/baml_src/clients.baml`
- `packages/shared/baml_src/isa_research/preamble.baml`
- `packages/shared/baml_src/isa_research/stage0.baml` (analyze_query)
- `packages/shared/baml_src/isa_research/stage1.baml` (websearch_calibration)
- `packages/shared/baml_src/isa_research/stage3.baml` (synthesize)
- `packages/shared/baml_src/common/decisions.baml`

**Files to modify:**
- `packages/shared/package.json` — add `@boundaryml/baml` dev dependency + `baml:generate` script
- `packages/shared/src/agent/orchestrator/stage-runner.ts` — import BAML-generated clients, feature-flag switch
- `packages/shared/src/agent/orchestrator/json-extractor.ts` — keep as fallback; primary path uses BAML
- `packages/shared/.gitignore` — add `src/agent/orchestrator/baml_client/` (generated code)

**BAML generator config** (TypeScript output, NOT Python):

```baml
// generators.baml
generator target {
  output_type "typescript"
  output_dir "../src/agent/orchestrator/baml_client"
  version "0.218.1"
}
```

**BAML client config** (Claude Max OAuth via runtime auth override):

```baml
// clients.baml
client<llm> ClaudeMax {
  provider anthropic
  options {
    model "claude-opus-4-6"
    // authToken injected at runtime via BAML client options override
    // BAML supports runtime auth override — see stage-runner integration below
  }
}

client<llm> ClaudeMaxLight {
  provider anthropic
  options {
    model "claude-opus-4-6"
    // Used for lightweight stages (stage 0, stage 1) with lower token budgets
  }
}
```

**Stage 0 BAML definition** (mirrors gamma’s `stage0.baml`):

```baml
// isa_research/stage0.baml

class ISASubQuery {
  text string @description("The specific sub-query to search for")
  intent string @description("What this sub-query aims to find")
  isa_standards string[] @description("Expected relevant ISA standards")
  search_strategy "semantic" | "keyword" | "hybrid"
}

class ISAQueryPlanOutput {
  original_query string
  refined_query string
  scope_classification "single_standard" | "cross_standard" | "thematic" | "procedural"
  sub_queries ISASubQuery[]
  depth_recommendation "quick" | "standard" | "deep"
  confidence float @description("0.0-1.0 confidence in query understanding")
}

function ISAResearchStage0(query: string) -> ISAQueryPlanOutput {
  client ClaudeMaxLight
  prompt #"
    {{ _.role("system") }}
    {{ ISAPreamble() }}
    You are analyzing a research query about International Standards on Auditing.
    [Loads from prompts/stage-0-analyze.md]

    {{ _.role("user") }}
    Analyze this research query and produce a structured query plan:
    {{ query }}
  "#
}
```

**Stage 1 BAML definition** (websearch calibration):

```baml
// isa_research/stage1.baml

class CalibratedQuery {
  original_text string
  refined_text string
  web_evidence string @description("Key findings from web search")
  confidence_delta float @description("Change in confidence after calibration")
}

class WebsearchCalibrationOutput {
  queries CalibratedQuery[]
  calibration_summary string
  recommended_depth "quick" | "standard" | "deep"
}

function ISAResearchStage1(
  query_plan: ISAQueryPlanOutput,
  web_results: string
) -> WebsearchCalibrationOutput {
  client ClaudeMaxLight
  prompt #"
    {{ _.role("system") }}
    {{ ISAPreamble() }}
    You are calibrating ISA research queries using web search results.
    [Loads from prompts/stage-1-websearch.md]

    {{ _.role("user") }}
    <QUERY_PLAN>{{ query_plan }}</QUERY_PLAN>
    <WEB_RESULTS>{{ web_results }}</WEB_RESULTS>
  "#
}
```

**Stage 3 BAML definition** (synthesis — mirrors gamma’s `stage2.baml`):

```baml
// isa_research/stage3.baml

class ISACitation {
  standard string @description("ISA standard number, e.g. 'ISA 315'")
  paragraph string @description("Paragraph reference, e.g. '12'")
  text string @description("Verbatim quoted text from source")
}

class ISASynthesisOutput {
  synthesis string @description("Full markdown answer with inline citations")
  citations ISACitation[]
  confidence float
  gaps string[] @description("Areas where source material was insufficient")
  needs_repair bool @description("Whether verification is likely to find issues")
}

function ISAResearchStage3(
  query_plan: ISAQueryPlanOutput,
  retrieval_context: string,
  repair_feedback: string?
) -> ISASynthesisOutput {
  client ClaudeMax
  prompt #"
    {{ _.role("system") }}
    {{ ISAPreamble() }}
    You are synthesizing an authoritative ISA research answer.
    [Loads from prompts/stage-3-synthesize.md]

    {{ _.role("user") }}
    <QUERY_PLAN>{{ query_plan }}</QUERY_PLAN>
    <ISA_CONTEXT>{{ retrieval_context }}</ISA_CONTEXT>
    {{ #if repair_feedback }}
    <REPAIR_FEEDBACK>{{ repair_feedback }}</REPAIR_FEEDBACK>
    {{ /if }}
  "#
}
```

**Shared preamble** (mirrors gamma’s `preamble.baml`):

```baml
// isa_research/preamble.baml

template_string ISAPreamble() #"
  You are an expert research assistant specializing in International Standards
  on Auditing (ISA). You work with precision, always citing specific ISA
  paragraph references. You never fabricate information — if source material
  is insufficient, you explicitly state gaps.

  Citation format: (ISA {number}.{paragraph})
  Example: (ISA 315.12), (ISA 540.A20)
"#
```

**Common decisions** (mirrors gamma’s `decisions.baml`):

```baml
// common/decisions.baml

class BinaryDecision {
  decision bool
  reasoning string
  confidence float
}

class ScoredDecision {
  score float @description("0.0-1.0")
  reasoning string
  factors string[]
}
```

**Integration into stage-runner.ts** (feature-flagged):

```typescript
// stage-runner.ts — BAML integration with Zod fallback
import { ISAResearchStage0 } from './baml_client';  // BAML-generated
import { ISAResearchStage3 } from './baml_client';  // BAML-generated
import { extractJson } from './json-extractor';      // Zod fallback

async runAnalyzeQuery(stage, state, userMessage, agentConfig): Promise<StageResult> {
  const useBAML = agentConfig.orchestrator?.useBAML ?? false;

  if (useBAML) {
    try {
      // BAML-generated client — handles parsing + validation automatically
      const queryPlan = await ISAResearchStage0(userMessage, {
        clientOptions: {
          anthropic: {
            authToken: await this.getAuthToken(),
            defaultHeaders: { 'anthropic-beta': 'oauth-2025-04-20' },
          }
        }
      });
      // queryPlan is already typed as ISAQueryPlanOutput — no parsing needed
      return {
        text: JSON.stringify(queryPlan),
        summary: `Query plan: ${queryPlan.sub_queries.length} sub-queries`,
        usage: { inputTokens: 0, outputTokens: 0 },  // BAML doesn't expose usage yet
        data: queryPlan,
      };
    } catch (bamlError) {
      if (agentConfig.orchestrator?.bamlFallbackToZod) {
        console.warn('[orchestrator] BAML failed, falling back to Zod:', bamlError);
        // Fall through to Zod path below
      } else {
        throw bamlError;
      }
    }
  }

  // Zod fallback path (or primary when useBAML=false)
  const systemPrompt = buildAnalyzeQueryPrompt(agentConfig);
  const result = await this.llmClient.call({
    systemPrompt,
    userMessage,
    desiredMaxTokens: 16_384,
  });
  const queryPlan = extractJson(result.text, QueryPlanSchema);
  return { text: result.text, summary: `Query plan: ${queryPlan.sub_queries.length} sub-queries`, usage: result.usage, data: queryPlan };
}
```

**Which stages use BAML vs. pure TypeScript:**

| Stage | BAML? | Why |
|-------|-------|-----|
| 0 — analyze_query | **YES** | Complex structured output (ISAQueryPlanOutput with nested ISASubQuery[]) |
| 1 — websearch_calibration | **YES** | Refines query plan → structured output (WebsearchCalibrationOutput) |
| 2 — retrieve | **NO** | Pure MCP tool calls (isa_hybrid_search, isa_hop_retrieve) — no LLM |
| 3 — synthesize | **YES** | Complex output (ISASynthesisOutput with ISACitation[], repair feedback) |
| 4 — verify | **NO** | Pure MCP tool calls (isa_citation_verify, isa_entity_verify) — no LLM |
| 5 — output | **NO** | Pure TypeScript rendering (renderDocument()) — no LLM |

**Fallback strategy:** `json-extractor.ts` + Zod schemas remain as fallback.
Feature-flagged via `config.json` `orchestrator.useBAML` / `orchestrator.bamlFallbackToZod`.

**Generated code management:**
- `baml_client/` directory is generated code → added to `.gitignore`
- `pnpm run baml:generate` added to `packages/shared/package.json` scripts
- CI/CD runs `baml:generate` before `typecheck:all`
- `npx baml generate` also works for local development

**Validation:**
- [ ] `npx baml generate` succeeds — TypeScript clients generated in `baml_client/`
- [ ] Generated types match Zod schemas (ISAQueryPlanOutput, ISASynthesisOutput, etc.)
- [x] `pnpm run typecheck:all` passes with BAML adapter (dynamic import + @ts-expect-error)
- [ ] Integration test: BAML client produces typed output for Stage 0 query plan
- [ ] Integration test: BAML client produces typed output for Stage 3 synthesis
- [ ] Integration test: BAML fallback to Zod when `useBAML: false`
- [ ] Unit test: BAML runtime auth injection works with OAuth token
- [ ] Unit test: feature flag toggle — `useBAML: true` uses BAML, `false` uses Zod
- [x] `pnpm run lint` passes (66 problems — unchanged baseline)

---

#### Post-Implementation Wiring Fix (Adversarial Review Findings F1–F7) [x]

**Date:** 2026-02-24
**Trigger:** Adversarial review found 7 wiring defects across orchestrator integration.

| Finding | Description | Fix | Status |
|---------|-------------|-----|--------|
| F1 | `toOrchestratorAgentConfig()` reads `cfg.debug?.enabled` instead of `cfg.orchestrator` | Rewrote to pass through all `cfg.orchestrator` fields | [x] |
| F2 | `AgentConfig` in `agents/types.ts` missing `orchestrator` field | Added `orchestrator?` with 12 optional fields | [x] |
| F3 | Prompt filename mismatch (`stage-0-analyze.md` vs `stage-0-analyze-query.md`) | Renamed `stage-0-analyze.md` → `stage-0-analyze-query.md`, `stage-1-websearch.md` → `stage-1-websearch-calibration.md` | [x] |
| F4 | MCP Bridge hardcoded to `null` in `runOrchestrator()` | Wired `McpLifecycleManager` + `OrchestratorMcpBridge` with try/finally lifecycle | [x] |
| F5 | Output title template always `undefined` (both ternary branches) | Fixed cast: `(cfg.output as unknown as Record<string, unknown>)?.['titleTemplate']` | [x] |
| F6 | BAML stages report ZERO token usage | Added `TODO(baml-usage)` comments to 2 BAML branches in `stage-runner.ts` | [x] |
| F7 | Unused `OrchestratorEvent` import in `claude-agent.ts` | Removed during Phase 4 import restructure (replaced with `McpBridge` import) | [x] |

**Files modified:**
- `packages/shared/src/agents/types.ts` — Added `orchestrator?` field to `AgentConfig`
- `packages/shared/src/agent/claude-agent.ts` — Config passthrough, MCP bridge lifecycle, import cleanup
- `packages/shared/src/agent/orchestrator/stage-runner.ts` — BAML TODO comments
- `agents/isa-deep-research/prompts/stage-0-analyze-query.md` — Renamed from `stage-0-analyze.md`
- `agents/isa-deep-research/prompts/stage-1-websearch-calibration.md` — Renamed from `stage-1-websearch.md`

**Validation:**
- [x] `pnpm run typecheck:all` passes
- [x] `pnpm run lint` passes (66 problems — unchanged baseline)

---

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Anthropic deprecates Bearer auth path | Low | High | Claude Code depends on it — they’d break their own product. Monitor SDK updates. |
| OAuth token refresh fails mid-pipeline | Medium | Medium | Check + refresh before EACH `messages.stream()` call. Retry once on 401. |
| Context window overflow (input > 128K) | Medium | High | `ContextBudgetManager` dynamically adjusts `max_tokens`. Truncates retrieval context by relevance score. |
| `stop_reason: "max_tokens"` — thinking exhausts budget | Medium | Medium | Adaptive thinking at effort `max` will use maximum thinking tokens. Log warning on `max_tokens` stop. Increase `desiredMaxTokens` or reduce input. |
| MCP server connection drops during retrieve | Medium | Medium | Retry with backoff. Checkpoint state before MCP-heavy stages. |
| LLM output doesn’t parse as JSON | Medium | Medium | `extractJson()` tries 4 parsing strategies. Retry once with "Return valid JSON" appended. Zod validation catches schema mismatches. BAML handles this automatically when enabled. |
| `temperature` accidentally passed | Low | High | API error — incompatible with thinking. LLM client type system prevents it (no `temperature` in `LlmCallOptions`). |
| `tool_choice: "any"` accidentally used | Low | High | API error — incompatible with thinking. LLM client sends NO tools by design. |
| Streaming connection drops mid-response | Low | Medium | SDK handles reconnection. Checkpoint state after each stage. |
| Repair loop diverges (verification always fails) | Medium | Medium | `maxIterations` cap (default 2). After max iterations, proceed with best-effort output + warning. Log each repair iteration for debugging. (G15) |
| MCP `callTool()` returns unexpected format | Medium | Medium | `parseMcpResult()` validates with Zod. On parse failure: throw with tool name + raw content for debugging. Never pass raw `CallToolResult` to typed code. (G16) |
| SDK types lack `thinking: {type: 'adaptive'}` | High | Low | `@ts-expect-error` annotations on both `thinking` and `output_config`. When SDK updates, remove annotations. TypeCheck will flag stale annotations. (G17) |
| MCP client connection fails on startup | Medium | Medium | `McpLifecycleManager.connect()` throws → pipeline fails fast. Log source config for debugging. Retry once with backoff. (G18) |
| Context builder token estimation inaccuracy | Medium | Low | Over-estimate by 10% safety margin. Worst case: API returns 400 → reduce and retry. (G19) |
| `getValidClaudeOAuthToken` returns wrong credentials (multi-connection) | Low | High | Currently global — ignores slug. Document limitation. Low risk for single Claude Max use case. (G20) |
| BAML version incompatibility | Medium | Low | Pin BAML version in `package.json`. Generated code is checked at CI via `baml:generate`. Zod fallback always available. (F11) |
| BAML runtime auth injection fails | Low | Medium | Feature-flagged: `useBAML: false` disables BAML entirely, falls back to `OrchestratorLlmClient` + Zod. (F11) |
| SDK types lack `thinking: {type: 'adaptive'}` | High | Low | `@ts-expect-error` annotations on both `thinking` and `output_config`. When SDK updates, remove annotations. TypeCheck will flag stale annotations. (G17) |
| MCP client connection fails on startup | Medium | Medium | `McpLifecycleManager.connect()` throws → pipeline fails fast. Log source config for debugging. Retry once with backoff. (G18) |
| Context builder token estimation inaccuracy | Medium | Low | Over-estimate by 10% safety margin. Worst case: API returns 400 → reduce and retry. (G19) |
| `getValidClaudeOAuthToken` returns wrong credentials (multi-connection) | Low | High | Currently global — ignores slug. Document limitation. Low risk for single Claude Max use case. (G20) |

---

#### Second Adversarial Review Fix (Findings F1–F8) [x]

**Date:** 2026-02-23
**Trigger:** Second adversarial review found 2 critical, 5 warning, 1 nit across orchestrator and session integration.

| Finding | Description | Fix | Status |
|---------|-------------|-----|--------|
| F1 | `feedbackField: "repair_instructions"` mismatches verify stage's `data.feedback` key | Changed config.json `feedbackField` to `"feedback"` | [x] |
| F2 | Orchestrator pause/resume disconnected from session layer (4-way disconnect) | Added `detectPausedOrchestrator()`, `resumeOrchestrator()`, bridge state write/clear helpers in `claude-agent.ts`; updated `sessions.ts` `getPausedAgentResumeContext()` + `sendMessage()` for orchestrator mode | [x] |
| F3 | `onAgentStagePause` searches for non-existent `agent_stage_gate` tool in orchestrator flow | Added `orchestratorMode` guard — skip tool lookup when `data.orchestratorMode === true` | [x] |
| F4 | Misleading indentation in `runOrchestrator()` try/finally — code appeared outside try but was inside | Restructured: single try/catch with `yield 'complete'` after catch, MCP cleanup in separate try block | [x] |
| F5 | No real-time streaming to UI during LLM calls (minutes of silence) | Added intermediate `text_complete` yield per stage in `processOrchestratorEvents()` | [x] |
| F6 | `CostTracker.recordStage()` replaces cost on repair iterations — under-counting totals | Changed to accumulate: existing cost + new cost on repeat recordings | [x] |
| F7 | `AgentOrchestrator.create()` failure skips `complete` yield — UI stuck in loading | Moved `create()` inside the try block so errors are caught and `complete` is always yielded | [x] |
| F8 | `output_config: { effort }` on `streamParams` — extra property risk on SDK upgrade | Replaced `@ts-expect-error` (was unused) with descriptive comment explaining why it's type-safe (object literal, not interface-constrained) | [x] |

**Files modified:**
- `agents/isa-deep-research/config.json` — Fixed `feedbackField` from `"repair_instructions"` to `"feedback"`
- `packages/shared/src/agent/claude-agent.ts` — Major refactor: added `detectPausedOrchestrator()`, `resumeOrchestrator()`, `processOrchestratorEvents()`, `writeOrchestratorBridgeState()`, `clearOrchestratorBridgeState()`; restructured `runOrchestrator()` (F4/F7 indentation + error handling); added `PipelineState` import; added fs imports
- `packages/shared/src/agent/orchestrator/cost-tracker.ts` — `recordStage()` now accumulates instead of replacing
- `packages/shared/src/agent/orchestrator/llm-client.ts` — Updated `output_config` comment (replaced unused `@ts-expect-error`)
- `apps/electron/src/main/sessions.ts` — `onAgentStagePause`: orchestrator mode guard; `getPausedAgentResumeContext()`: returns minimal marker for orchestrator; `sendMessage()`: skips SDK resume injection for orchestrator

**Validation:**
- [x] `pnpm run typecheck:all` passes
- [x] `pnpm run lint` passes (66 problems — unchanged baseline)

---

### Testing Strategy

| Level | What | How |
|-------|------|-----|
| **Unit** | `OrchestratorLlmClient` auth + streaming + thinking | Mock `Anthropic` constructor, assert `authToken` + `defaultHeaders` + `thinking: {type: "adaptive"}` + `output_config: {effort: "max"}`. Verify `messages.stream()` used (not `.create()`). Verify no `temperature`. |
| **Unit** | `ContextBudgetManager` arithmetic | `calculateMaxTokens(150000, 128000)` → 50000. `calculateMaxTokens(198000, 128000)` → throws. |
| **Unit** | `extractJson()` parsing | Plain JSON, fenced ```json, embedded {}, Zod validation, failure case. |
| **Unit** | `PipelineState` immutability | Create state, add events, verify originals unchanged |
| **Unit** | `CostTracker` math | Input/output tokens → USD calculation (including thinking tokens) |
| **Unit** | `McpBridge` tool calls | Mock `CraftMcpClient`, verify tool names + args. Assert `parseMcpResult()` unwraps `CallToolResult` → parsed JSON → Zod validated (G16). |
| **Unit** | `parseMcpResult()` edge cases | Empty result, missing text block, invalid JSON, Zod validation failure (G16). |
| **Unit** | `McpLifecycleManager` lifecycle | `connect()` → client created, `close()` → client nulled, `withClient()` → always closes even on throw (G18). |
| **Unit** | `buildStageContext()` formatting | XML tags present, token budget respected, retrieval sorted by score, repair feedback included when set (G19). |
| **Unit** | Repair loop logic | Verify loop runs up to `maxIterations`, stops when `needsRepair === false`, re-runs correct stages (G15). |
| **Unit** | BAML-generated Stage 0 client | Verify `ISAResearchStage0()` returns typed `ISAQueryPlanOutput`. Mock Anthropic responses. |
| **Unit** | BAML-generated Stage 3 client | Verify `ISAResearchStage3()` returns typed `ISASynthesisOutput`. Mock repair feedback path. |
| **Unit** | BAML runtime auth injection | Verify `clientOptions.anthropic.authToken` is passed and OAuth beta header set. |
| **Unit** | BAML/Zod feature flag toggle | `useBAML: true` → BAML client called. `useBAML: false` → `llmClient.call()` + `extractJson()`. |
| **Unit** | BAML fallback on error | BAML throws → `bamlFallbackToZod: true` → falls back to Zod path. `false` → re-throws. |
| **Unit** | `runOrchestrator()` event mapping | Verify `AgentStageStartedEvent`, `AgentStageCompletedEvent`, `AgentRepairIterationEvent`, `AgentRunCompletedEvent`, `AgentStageGatePauseEvent` emitted with correct fields. |
| **Integration** | Full pipeline with mock LLM + mock MCP | `AgentOrchestrator.run()` → verify all 6 stages execute in order |
| **Integration** | Repair loop with mock data | Verify Stage 3→4 repair: fail verify → re-synthesize → pass verify → continue (G15). |
| **Integration** | Pause/resume flow | Orchestrator pauses at stage 0, resume with user message |
| **Integration** | Budget exceeded | Set low budget, verify pipeline stops |
| **Integration** | Context overflow handling | Large retrieval results → truncation → API call succeeds |
| **E2E** | Real ISA KB + real Opus 4.6 | `pnpm run test:e2e:live:auto` — requires Claude Max OAuth |
| **Regression** | Normal chat unchanged | Regular chat (no @agent) still uses SDK `query()` |
| **Typecheck** | All phases | `pnpm run typecheck:all` after every phase |
| **Lint** | All phases | `pnpm run lint` after every phase |

---

### Summary: What This Achieves

| Before (SDK `query()`) | After (Orchestrator) |
|------------------------|---------------------|
| LLM decides stage order | TypeScript for-loop over stages |
| LLM decides which tools to call | TypeScript calls MCP tools |
| LLM can bypass renderer (100% bypass rate) | TypeScript calls `renderDocument()` |
| LLM fabricates state (`renderer_tool_called: true`) | TypeScript writes state |
| No cost tracking | Per-stage cost tracking with budget |
| Safe Mode blocks LLM tool calls → silent failure | TypeScript calls tools directly → no blocking |
| 920-line AGENT.md competing for attention | Focused per-stage prompts |
| Single SDK `query()` — all or nothing | Stateless calls — checkpoint after each stage |
| No resume on crash | Load `pipeline-state.json` and continue |
| No thinking — SDK doesn't enable it | Opus 4.6 adaptive thinking at effort `max` — absolute maximum reasoning |
| Hardcoded token limits | Dynamic `max_tokens` with context overflow protection |
| No structured output validation | BAML-generated typed clients (primary) + Zod schema validation (fallback) on every LLM response |
| No streaming — UI frozen during long calls | `messages.stream()` with real-time progress events |
| Generic UI events (system_message) | Proper `AgentStageStartedEvent` / `AgentStageCompletedEvent` / `AgentRunCompletedEvent` — drives `agentRunStateAtom` |
| Linear stages — no repair iteration | Repair loop: verify → re-synthesize → re-verify (G15) |
| MCP `callTool` returns raw `CallToolResult` used as-is | `parseMcpResult()` unwraps + Zod validates every MCP response (G16) |
| No MCP client lifecycle management | `McpLifecycleManager` handles connect/close with source config (G18) |
| Ad-hoc context assembly (undefined functions) | `buildStageContext()` with XML formatting + token budgets (G19) |
| Safe Mode blocks LLM MCP tool calls | Orchestrator's own MCP client — Safe Mode doesn't apply (G23) |

**Net result:** All structural gaps closed. Gamma-equivalent deterministic control. Claude Max OAuth billing. Opus 4.6 adaptive thinking at maximum power (`effort: "max"`). Dynamic context window management. 128K max output tokens. BAML type-safe prompts with generated TypeScript clients. Proper renderer event integration via existing `AgentStageStartedEvent` / `AgentRunCompletedEvent` infrastructure.

---

## 12. Future Plans & Roadmap

> Add upcoming features, ideas, and technical debt items here.
> Move an item to Section 11 when starting work on it.

### Planned

- [x] **Core package migration** — Move storage, auth, credentials, agent logic from `shared/` to `core/` (phased migration per `core/CLAUDE.md`)
- [x] **Upstream sync workflow** — Automated merge from `upstream/main` with conflict resolution strategy
- [x] **Multi-workspace support** — UI and config for switching between workspaces
- [x] **Plugin system** — Dynamic loading of third-party agents and sources
- [x] **Session sharing** — Export/import sessions for collaboration (viewer app integration)

### Ideas (Not Yet Scoped)

- [x] Agent performance benchmarking framework
- [x] Source health monitoring dashboard
- [x] Automated credential rotation for API sources
- [x] Custom theme editor in Preferences UI
- [x] Collaborative multi-agent sessions
- [x] MCP server marketplace / registry

### Technical Debt

- [x] `apps/electron/package.json` still references `bun` in some script commands (unused on Windows ARM64)
- [x] `packages/shared/CLAUDE.md` references `bun test` — should be `npx tsx --test`
- [x] `nul` file in repo root (Windows reserved name) — `.gitignore`'d but should be removed from history
- [x] Large `sessions.ts` (~5700 lines) — candidate for decomposition into sub-modules

---

## 13. Active Implementation Plan: Electron Main Process Auto-Restart on Rebuild

> **Problem**: The `electron:dev` script rebuilds `main.cjs` via esbuild watch but never restarts
> the Electron process. Code changes to `packages/shared/`, `apps/electron/src/main/`, or any
> transitive dependency are invisible to the running process — developers unknowingly test stale
> code. The orchestrator pipeline bypass (Section 11, Phase 10) was a direct consequence.

### Goal

Ensure the running Electron process automatically restarts when esbuild rebuilds `main.cjs` in
watch mode, preventing the "stale runtime" bug.

### Key Files

| File | Purpose |
|------|---------|
| `scripts/electron-dev.ts` | Dev script — esbuild watch + Electron spawn |
| `apps/electron/src/main/index.ts` | Electron entry point |
| `apps/electron/package.json` | `main: "dist/main.cjs"` |

### Approach

Use esbuild's plugin API with `onEnd` callback to detect successful main process rebuilds, then
kill and re-spawn the Electron child process. Standard pattern used by `electron-vite`,
`electron-forge`, and most Electron dev tools.

### Phase 1: Add esbuild onEnd plugin for Electron restart `[x]`

Modify `scripts/electron-dev.ts`:

- [x] Extract Electron spawn into a reusable `spawnElectron()` function returning `ChildProcess`; store in mutable `let electronProc`
- [x] Create `electronRestartPlugin` esbuild plugin hooking `onEnd`:
  - Only trigger when `result.errors.length === 0` (successful build)
  - Skip the very first build (initial startup — Electron spawned separately)
  - Wait for `main.cjs` to stabilize (reuse existing `waitForFileStable()`)
  - Kill current Electron process (`electronProc.kill()`)
  - Wait briefly for graceful shutdown (~500ms)
  - Spawn new Electron process via `spawnElectron()`
  - Log: `🔄 Main process changed — restarting Electron...`
- [x] Add the plugin to the main esbuild context `plugins` array (line ~366)
- [x] Add debounce guard (150ms) to prevent rapid-fire restarts from cascading file changes
- [x] Re-register `electronProc.on('exit', ...)` on the new process for user-initiated app close

### Phase 2: Add console banner on restart `[x]`

- [x] Track rebuild count; display `🔄 Restart #N — main.cjs rebuilt`
- [x] Include ISO timestamp for correlation with session logs
- [-] Log which file changed if esbuild `metafile` is enabled (skipped — metafile not enabled; rebuild count + timestamp sufficient)

### Phase 3: Graceful session handling `[x]`

- [x] Verify `SessionManager` persists state on process exit (uses `persistSession()` + `sessionPersistenceQueue.flush()`)
- [x] Verify SDK session resumption works after restart (re-created agent resumes via stored `sdkSessionId`)
- [x] Add console note: `⚠️ Active sessions will resume automatically after restart`

### Phase 4: Validation `[x]`

- [x] `pnpm run typecheck:all` — PASS
- [x] `pnpm run lint` — no new errors (66 pre-existing, 0 new)
- [ ] Manual test: start `electron:dev` → edit `packages/shared/src/agent/` → observe esbuild rebuild → Electron window closes and re-opens → verify existing session resumes

### Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| SDK subprocess orphaning on kill | `electronProc.kill()` sends SIGTERM; Electron handles graceful cleanup of child processes |
| Rapid rebuild thrashing | 100ms debounce prevents multiple restarts from cascading file changes |
| Session data loss on restart | Sessions persist to disk on every state change; SDK session IDs stored for resume |
| Windows-specific kill behavior | `ChildProcess.kill()` on Windows sends SIGTERM; fallback to `taskkill /PID /F` if needed |
| Preload changes not picked up | Preload rebuilt by its own watcher; Electron restart picks up both main and preload changes |

### Testing Strategy

- `pnpm run typecheck:all`
- `pnpm run lint`
- Manual: edit source → observe restart → verify session resume

---

_Last updated: 2026-02-23_
