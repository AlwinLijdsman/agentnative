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

> **Feature:** ISA KB Guide Reference and Multi-Tier Search
> **Branch:** `feature/isa-guide-reference-search`
> **Date:** 2026-02-20
> **Research team:** 2 researchers, 4 adversarial reviewers, 1 synthesizer

### Summary

Port the three-tier hierarchical retrieval system from personalmcptools-gamma into agentnative's ISA KB MCP server. The agentnative schema already defines `GuideSection` and `maps_to` tables (currently empty). This plan adds: (1) guide ingestion script, (2) guide search MCP tools, (3) guide-aware agent instructions, (4) multi-tier unified search, (5) reranker + semantic dedup + query expansion, (6) diagnostic MCP tools + fixture replay, (7) E2E validation.

**Architecture:** Guide PDF → Tier 1 chunking → ISA ref extraction (regex) → `maps_to` edges → `hop_edge` entries → multi-hop traversal at query time. Guides become "seed nodes" into the ISA paragraph graph.

### Phase 1: Guide Ingestion Script

- [x] Create `isa-kb-mcp-server/scripts/ingest_guides.py`
  - [x] Read guide PDFs from configurable path (default: `data/raw/guides/`)
  - [x] Extract text using Azure Document Intelligence or simple PDF extraction
  - [x] Split into sections using heading detection (port `chunk_guide()` from gamma `tier1_guides.py`)
    - Heading patterns: markdown `# Heading`, chapter/section `Chapter 1`, numbered `1.2.3 Title`
    - Min section: 50 chars, max section: 3000 chars (force-split at paragraph boundaries)
  - [x] Generate `gs_` prefixed IDs using `hashlib.sha256`
  - [x] Extract ISA references from each section using `_ISA_REF_PATTERN`: `r"ISA\s+(\d{3})(?:\.(\d+))?(?:\(([a-z])\))?(?:\.(A\d+))?"`
  - [x] Embed sections via Voyage AI (`voyage-law-2`, 1024-dim, `input_type="document"`)
  - [x] Store in DuckDB `GuideSection` table
  - [x] Store in LanceDB `guides` table (create if not exists, with FTS index on content)
  - [x] Create `maps_to` edges from guide sections to `ISAParagraph` based on extracted ISA references
  - [x] Create `hop_edge` entries for guide-to-ISA connections (for HopRAG traversal)
- [x] Create `isa-kb-mcp-server/tests/test_ingest_guides.py`
  - [x] Test section splitting (heading detection, min/max size, paragraph boundary splitting)
  - [x] Test `gs_` ID generation
  - [x] Test ISA reference extraction regex
  - [x] Test `maps_to` edge creation
  - [x] Test error path: guide references unknown ISA standard
  - [x] Test error path: guide PDF with unexpected format
- [x] Verify:
  - [x] `GuideSection` table has rows after ingestion
  - [x] `maps_to` table has guide-to-ISA edges
  - [x] LanceDB `guides` table exists with embeddings
  - [x] `hop_edge` table has guide-to-ISA entries

### Phase 2: Guide Search MCP Tools

- [x] Add `guide_search()` function to `isa-kb-mcp-server/src/isa_kb_mcp_server/search.py`
  - [x] Same hybrid pattern as `hybrid_search()` but queries `GuideSection` + LanceDB `guides` table
  - [x] Support `guide_filter` parameter (filter by `source_doc`)
  - [x] Return guide sections with `isa_references` included
  - [x] DuckDB FTS index on `GuideSection.content` for keyword search
- [x] Add `guide_to_isa_hop()` function to `isa-kb-mcp-server/src/isa_kb_mcp_server/graph.py`
  - [x] Given guide section ID, follow `maps_to` edges to ISAParagraph
  - [x] Then follow `hop_edge` for further ISA-to-ISA traversal
  - [x] Return combined results with hop depth and path
- [x] Register new tools in `isa-kb-mcp-server/src/isa_kb_mcp_server/__init__.py`:
  - [x] `isa_guide_search(query, max_results=10, guide_filter="", search_type="hybrid")` — Search guide documents
  - [x] `isa_guide_to_isa_hop(guide_section_id, max_hops=2)` — From guide section, find connected ISA paragraphs
  - [x] `isa_list_guides()` — List available guide documents (analogous to `isa_list_standards`)
- [x] Update `isa_format_context` in `context.py` to handle guide sections:
  - [x] Support `"guide"` role with guide-specific source labels (e.g., "LCE Guide Section 3")
  - [x] Guide results get `supporting` priority by default (ISA paragraphs remain `primary`)
- [x] Create `isa-kb-mcp-server/tests/test_guide_search.py`
  - [x] Test guide hybrid search (keyword + vector + RRF fusion)
  - [x] Test guide-to-ISA hop traversal
  - [x] Test `isa_list_guides` returns guide document metadata
  - [x] Test error path: multi-hop finds no matching ISA paragraphs
  - [x] Test error path: vector similarity below threshold
- [x] Verify:
  - [x] `isa_guide_search` returns guide sections for relevant queries
  - [x] `isa_guide_to_isa_hop` returns ISA paragraphs connected to guide sections
  - [x] `isa_list_guides` lists ingested guide documents

### Phase 3: Agent Instructions Update

- [x] Update `agents/isa-deep-research/AGENT.md` frontmatter — add new tools:
  ```yaml
  tools:
    # ... existing 10 tools ...
    - isa_guide_search        # NEW
    - isa_guide_to_isa_hop    # NEW
    - isa_list_guides         # NEW
  ```
- [x] Update Stage 2 (Retrieve) instructions:
  - [x] For each sub-query, first check if the topic maps to a guide section using `isa_guide_search`
  - [x] Use `isa_guide_to_isa_hop` to discover ISA paragraphs referenced by guide sections
  - [x] Combine guide-sourced ISA paragraphs with `isa_hybrid_search` results
  - [x] This gives the agent a "guide-first" retrieval path: Guide → ISA references → ISA paragraphs
- [x] Update Stage 3 (Synthesize) instructions:
  - [x] When citing ISA paragraphs found via guide sections, note the guide context
  - [x] Example: "Per ISA 315.12(a), as referenced in the ISA for LCE Section 5..."
- [x] Update Stage 4 (Verify) instructions:
  - [x] Entity verification should check entities against both `GuideSection` and `ISAParagraph` content
  - [x] Citation verification should handle `gs_` IDs (guide section references)
- [x] Run `pnpm run typecheck:all` and `pnpm run test:e2e` to verify no regressions
- [x] Verify:
  - [x] Agent uses `isa_guide_search` during retrieval when guide content is relevant
  - [x] Guide-sourced ISA paragraphs are attributed with guide context in synthesis

### Phase 4: Multi-Tier Unified Search

- [x] Add `multi_tier_search()` function to `isa-kb-mcp-server/src/isa_kb_mcp_server/search.py`
  - [x] Accepts `tiers: list[int] = [1, 2]` parameter (1=guides, 2=standards)
  - [x] When tier 1 included: run `guide_search()` (from Phase 2)
  - [x] When tier 2 included: run existing `hybrid_search()`
  - [x] Merge results from both tiers using score-based ranking with tier weighting
  - [x] Tier weighting: ISA paragraphs weighted 1.0 (authoritative), guide sections weighted 0.85 (supplementary)
  - [x] Result format: unified list with `tier` field on each result (1 or 2) so agent knows the source type
  - [x] Dedup: when a guide section references an ISA paragraph that also appears in direct search results, keep the ISA paragraph (higher authority) and annotate it with the guide context
- [x] Register `isa_multi_tier_search` tool in `__init__.py`:
  ```python
  @mcp.tool()
  def isa_multi_tier_search(
      query: str,
      max_results: int = 20,
      tiers: list[int] = [1, 2],
      search_type: str = "hybrid",
  ) -> dict:
      """Search across both guide documents (tier 1) and ISA standards (tier 2).
      Results are ranked across tiers with authority-based weighting."""
  ```
- [x] Update `isa_format_context` in `context.py` to handle mixed-tier results:
  - [x] When result has `tier == 1`, use source label `"Guide: {heading}"` instead of `"ISA {number}"`
  - [x] XML `<source_text>` element: for guides use `guide="{source_doc}" section="{heading}"` instead of `standard="ISA {number}"`
  - [x] Token budget allocation: guides share the `supporting` pool (max 15 results), ISA paragraphs get `primary` pool (uncapped)
- [x] Create `isa-kb-mcp-server/tests/test_multi_tier_search.py`
  - [x] Test tier=[1] returns only guide sections
  - [x] Test tier=[2] returns only ISA paragraphs (existing behavior)
  - [x] Test tier=[1,2] returns mixed results with correct tier labels
  - [x] Test authority-based dedup: same content from guide + ISA → ISA wins
  - [x] Test tier weighting: ISA results rank higher than equivalent-score guide results
- [x] Verify:
  - [x] `isa_multi_tier_search` returns correctly merged cross-tier results
  - [x] Context XML correctly labels guide vs ISA sources

### Phase 5: Reranker, Semantic Deduplication, Query Expansion

#### 5a. Reranker

- [x] Create `isa-kb-mcp-server/src/isa_kb_mcp_server/rerank.py`
  - [x] Implement `rerank_results(query: str, results: list[dict], top_k: int = 20) -> list[dict]`
  - [x] Use FlashRank (ONNX-based, runs locally, no API cost) as default backend — same as gamma
  - [x] Install: add `flashrank` to `pyproject.toml` dependencies
  - [x] Reranker takes query + result content, returns reordered results with `rerank_score` field
  - [x] Graceful fallback: if FlashRank import fails, log warning and return results unchanged (preserves RRF ordering)
- [x] Integrate reranker into `search.py`:
  - [x] In `hybrid_search()`, after RRF fusion and before returning results, apply `rerank_results()` if `rerank=True` parameter is passed
  - [x] Same for `guide_search()` and `multi_tier_search()`
  - [x] Default `rerank=True` for all search functions (can be disabled for debugging)
- [x] Update MCP tool signatures in `__init__.py`:
  - [x] Add `rerank: bool = True` parameter to `isa_hybrid_search`, `isa_guide_search`, `isa_multi_tier_search`
- [x] Tests in `isa-kb-mcp-server/tests/test_rerank.py`:
  - [x] Test reranker reorders results (most relevant first)
  - [x] Test graceful fallback when FlashRank not available
  - [x] Test `rerank=False` returns RRF-ordered results unchanged

#### 5b. Semantic Deduplication

- [x] Add `deduplicate_semantic()` function to `isa-kb-mcp-server/src/isa_kb_mcp_server/context.py`
  - [x] Takes list of results (mixed guide + ISA), each with `embedding` field
  - [x] For each pair of results, compute cosine similarity
  - [x] If similarity > 0.85, keep only the higher-authority source:
    - ISA paragraphs (tier 2) beat guide sections (tier 1)
    - Within same tier, keep higher-scoring result
  - [x] Add `deduplicated_by` field to removed results for debugging
  - [x] Return filtered list + dedup report (how many removed, which pairs)
- [x] Integrate into `format_context()`:
  - [x] After role assignment but before token budget enforcement, run `deduplicate_semantic()`
  - [x] Add `deduplicate: bool = True` parameter to `format_context()` (default True)
  - [x] Log dedup summary: "Deduplicated N near-duplicate results (saved ~X tokens)"
- [x] Update `isa_format_context` MCP tool to expose `deduplicate` parameter
- [x] Tests in `isa-kb-mcp-server/tests/test_dedup.py`:
  - [x] Test identical content from guide + ISA → ISA survives
  - [x] Test content below 0.85 threshold → both survive
  - [x] Test dedup report contains correct pair info
  - [x] Test `deduplicate=False` skips dedup

#### 5c. Query Expansion

- [x] Create `isa-kb-mcp-server/src/isa_kb_mcp_server/query_expand.py`
  - [x] Define `ISA_ACRONYMS` dictionary:
    ```python
    ISA_ACRONYMS = {
        "RA": "risk assessment",
        "ToC": "tests of controls",
        "RMM": "risk of material misstatement",
        "ROMM": "risk of material misstatement",
        "AM": "application material",
        "AP": "audit procedures",
        "TCWG": "those charged with governance",
        "KAM": "key audit matters",
        "LCE": "less complex entities",
        "GCM": "going concern matters",
        "SA": "substantive analytical procedures",
        "IT": "information technology",
        "ITGC": "IT general controls",
        # ... extend as needed
    }
    ```
  - [x] Implement `expand_query(query: str) -> str`:
    - Tokenize query, check each token against `ISA_ACRONYMS`
    - Append expansions: `"RA procedures"` → `"RA risk assessment procedures"`
    - Preserve original terms (expansion is additive, not replacement)
  - [x] Implement `expand_with_synonyms(query: str) -> list[str]`:
    - Return list of query variants (original + expanded) for multi-query search
    - E.g., `"TCWG communication"` → `["TCWG communication", "those charged with governance communication"]`
- [x] Integrate into `search.py`:
  - [x] In `_keyword_search()`, apply `expand_query()` to the BM25 query before executing
  - [x] Vector search uses original query (embeddings handle semantics natively)
  - [x] Add `expand_query_terms: bool = True` parameter to search functions
- [x] Tests in `isa-kb-mcp-server/tests/test_query_expand.py`:
  - [x] Test known acronyms expand correctly
  - [x] Test unknown terms pass through unchanged
  - [x] Test multi-word acronyms (e.g., "ITGC" → "IT general controls")
  - [x] Test expansion is additive (original term preserved)

### Phase 6: Web Enrichment for Guide Sections

- [x] Add web enrichment step to `isa-kb-mcp-server/scripts/ingest_guides.py`
  - [x] After section chunking, before embedding
  - [x] For each guide section, use Brave Search to find supporting context:
    - Query: `"{section_heading} ISA auditing standards"` (section heading + domain keywords)
    - Max 3 results per section
    - Preferred domains: ifac.org, iaasb.org, pcaobus.org, aicpa.org
  - [x] Append web snippets to section content as `enriched_content` (following gamma's pattern)
  - [x] Embed `enriched_content` (not raw `content`) — richer embeddings improve vector retrieval
  - [x] Store both `content` (original) and `enriched_content` in DuckDB GuideSection
  - [x] Schema update: add `enriched_content VARCHAR` column to `GuideSection` table in `schema.sql`
- [x] Add `--skip-enrichment` CLI flag to `ingest_guides.py` for offline/cost-free runs
- [x] Add `--use-cache` CLI flag for reusing previously fetched web results (JSON cache in `data/cache/`)
- [x] Tests:
  - [x] Test enrichment adds web snippets to section content
  - [x] Test `--skip-enrichment` produces sections without web context
  - [x] Test cache hit returns same results without API call
  - [x] Test Brave API unavailable → graceful degradation (use raw content only)
- [x] Verify:
  - [x] Enriched guide sections have richer embeddings (higher cosine similarity to relevant ISA paragraphs)
  - [x] `enriched_content` column populated in DuckDB after enrichment run

### Phase 7: Diagnostic MCP Tools and Fixture Replay

#### 7a. Diagnostic MCP Tools

- [x] Create `isa-kb-mcp-server/src/isa_kb_mcp_server/diagnostics.py`
  - [x] Implement `kb_status() -> dict` — runtime health check:
    ```python
    def kb_status() -> dict:
        """Return KB health status including table counts, vector collection sizes, and connection state."""
        return {
            "duckdb": {
                "connected": True/False,
                "tables": {
                    "GuideSection": {"row_count": N, "has_embeddings": True/False},
                    "ISAStandard": {"row_count": N},
                    "ISAParagraph": {"row_count": N, "has_embeddings": True/False},
                    "maps_to": {"edge_count": N},
                    "belongs_to": {"edge_count": N},
                    "cites": {"edge_count": N},
                    "hop_edge": {"edge_count": N},
                },
            },
            "lancedb": {
                "connected": True/False,
                "tables": {
                    "isa_chunks": {"vector_count": N},
                    "guides": {"vector_count": N},
                },
            },
            "voyage_ai": {"available": True/False},
            "brave_search": {"available": True/False},
        }
    ```
  - [x] Implement `debug_hop_trace(start_id: str, max_hops: int = 3) -> dict` — full multi-hop trace:
    ```python
    def debug_hop_trace(start_id: str, max_hops: int = 3) -> dict:
        """Trace the full multi-hop path from a node, showing every edge traversed."""
        return {
            "start_node": {"id": start_id, "type": "GuideSection|ISAParagraph", "content_preview": "..."},
            "hops": [
                {
                    "depth": 1,
                    "edge_type": "maps_to|hop_edge|cites",
                    "from_id": "gs_...",
                    "to_id": "ip_...",
                    "weight": 0.9,
                    "target_content_preview": "first 200 chars...",
                },
                # ... all hops
            ],
            "total_nodes_discovered": N,
            "max_depth_reached": M,
        }
    ```
  - [x] Implement `debug_search(query: str, max_results: int = 10) -> dict` — search with intermediate scores:
    ```python
    def debug_search(query: str, max_results: int = 10) -> dict:
        """Run hybrid search with full intermediate scoring visible for debugging."""
        return {
            "query": query,
            "expanded_query": "...",  # after query expansion
            "keyword_results": [...],  # raw BM25 scores
            "vector_results": [...],   # raw vector distances
            "rrf_fused": [...],        # after RRF fusion
            "reranked": [...],         # after reranker (if enabled)
            "final": [...],            # final output
        }
    ```
- [x] Register diagnostic tools in `__init__.py`:
  - [x] `isa_kb_status()` — KB health check (no parameters)
  - [x] `isa_debug_hop_trace(start_id, max_hops=3)` — Multi-hop trace
  - [x] `isa_debug_search(query, max_results=10)` — Search with intermediate scores
- [x] Tests in `isa-kb-mcp-server/tests/test_diagnostics.py`:
  - [x] Test `kb_status` returns correct table counts
  - [x] Test `debug_hop_trace` from guide section → ISA paragraphs shows full path
  - [x] Test `debug_search` returns all intermediate scoring stages

#### 7b. Fixture Replay System

- [x] Create `isa-kb-mcp-server/src/isa_kb_mcp_server/fixtures.py`
  - [x] Port gamma's `KBDebugLogger` pattern for API response caching:
    ```python
    class FixtureCache:
        """Cache API responses (Voyage AI, Brave Search) for $0 debug/test runs."""

        def __init__(self, cache_dir: Path = Path("data/fixtures")):
            self.cache_dir = cache_dir
            self.cache_dir.mkdir(parents=True, exist_ok=True)

        def cache_key(self, operation: str, **kwargs) -> str:
            """Generate deterministic cache key from operation + params."""

        def get(self, key: str) -> dict | None:
            """Return cached response or None."""

        def put(self, key: str, response: dict) -> None:
            """Cache a response as JSON file."""

        def wrap_voyage_embed(self, texts: list[str], **kwargs) -> list[list[float]]:
            """Embed with cache: return cached embeddings if available, else call Voyage AI and cache."""

        def wrap_brave_search(self, query: str, **kwargs) -> dict:
            """Search with cache: return cached results if available, else call Brave API and cache."""
    ```
  - [x] Integrate with `vectors.py`: when `ISA_KB_USE_FIXTURES=true` env var set, use `FixtureCache.wrap_voyage_embed()` instead of direct Voyage AI call
  - [x] Integrate with `web_search.py`: when `ISA_KB_USE_FIXTURES=true`, use `FixtureCache.wrap_brave_search()`
  - [x] Add `--record-fixtures` flag to `ingest_guides.py` to cache all API responses during ingestion
  - [x] Add `--use-fixtures` flag to `ingest_guides.py` to replay cached responses (no API calls)
- [x] Add structured debug logging:
  - [x] Create `isa-kb-mcp-server/src/isa_kb_mcp_server/debug_logger.py`
  - [x] Implement `KBDebugLogger` with `log_before(operation, input)` and `log_after(operation, output, duration_ms)` methods
  - [x] Output: JSONL file at `data/debug/kb-debug-{timestamp}.jsonl`
  - [x] Each log entry: `{"timestamp", "operation", "phase": "before|after", "input|output", "duration_ms"}`
  - [x] Integrate at pipeline boundaries: section chunking, ISA ref extraction, embedding, DB insert, search, hop traversal
- [x] Tests:
  - [x] Test fixture cache saves and loads correctly
  - [x] Test `ISA_KB_USE_FIXTURES=true` env var activates cache
  - [x] Test `--record-fixtures` populates cache dir
  - [x] Test `--use-fixtures` runs without API calls
  - [x] Test debug logger produces valid JSONL

### Phase 8: E2E Validation and Final Integration

- [x] Create `apps/electron/src/__tests__/e2e-isa-guide-pipeline.test.ts`
  - [x] Test config cross-validation: AGENT.md tool list includes `isa_guide_search`, `isa_guide_to_isa_hop`, `isa_list_guides`
  - [x] Test config cross-validation: config.json source tools match AGENT.md frontmatter
  - [x] Test Stage 2 retrieval with guide content: simulate guide search → guide-to-ISA hop → ISA paragraph retrieval
  - [x] Test Stage 3 synthesis with guide attribution: output includes guide context references
  - [x] Test Stage 4 verification with guide sections: entity verify handles `gs_` IDs
  - [x] Test full pipeline happy path: 6-stage pipeline with guide-aware retrieval produces formatted output
- [x] Create `isa-kb-mcp-server/tests/test_integration.py`
  - [x] Test full ingestion → search → retrieve → format pipeline with real guide data
  - [x] Test multi-tier search returns mixed guide + ISA results with correct labeling
  - [x] Test reranker improves result ordering (relevant results move up)
  - [x] Test semantic dedup removes near-duplicate guide/ISA content
  - [x] Test query expansion improves recall for acronym queries
  - [x] Test diagnostic tools return correct state after ingestion
  - [x] Test fixture replay produces identical results to live API calls
- [x] Error path tests:
  - [x] Guide references ISA standard not in knowledge base → warning logged, continues with available data
  - [x] Multi-hop finds no matching ISA paragraphs → returns empty with diagnostic message
  - [x] Vector similarity below threshold → results filtered, warning returned
  - [x] Guide PDF with unexpected format → parsing fallback to raw text blocks
  - [x] LanceDB `guides` table missing (not ingested yet) → graceful degradation to ISA-only search
  - [x] Voyage AI API failure → falls back to keyword-only search
  - [x] Brave API failure → enrichment skipped, raw content used
- [x] Run full test suite: `pnpm run typecheck:all && pnpm run test:e2e && pnpm run lint`
- [x] Verify no regressions to existing ISA-only functionality:
  - [x] All pre-existing E2E tests still pass
  - [x] `isa_hybrid_search` returns identical results when no guide data is present
  - [x] `isa_hop_retrieve` returns identical results when no `maps_to` edges exist

### Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Guide PDFs not available for ingestion | Low | High | Copy processed JSON from gamma, or use Azure DI |
| LanceDB `guides` table schema conflicts | Low | Medium | Schema matches gamma exactly |
| Voyage AI rate limits during embedding | Medium | Low | Batch embeddings, use fixture caching |
| FlashRank import/compatibility issues on Windows ARM64 | Medium | Medium | Graceful fallback to no reranking; test ONNX runtime on platform |
| Agent token budget exceeded with guide context | Medium | Medium | Context formatter enforces token budget; guide results get lower priority |
| Breaking existing ISA-only functionality | Low | High | All changes additive; existing tools/queries untouched; Phase 8 regression tests |
| Semantic dedup threshold too aggressive (0.85) | Low | Medium | Make threshold configurable; test with real guide/ISA content pairs |
| Query expansion introduces false positives | Low | Low | Expansion is additive; original terms preserved; can disable per-query |

### Open Questions

1. Which guide documents to ingest first? (ISA for LCE is available; are there others?)
2. Data copying vs re-extraction? (Copy processed JSON from gamma or re-extract from PDFs?)
3. Should guide ingestion run as part of server startup or remain a separate manual step?
4. FlashRank ONNX compatibility on Windows ARM64 — needs testing; fallback to Voyage AI reranker if needed

### Compliance Notes (from adversarial review)

- New tools MUST use `isa_` prefix (consistent with existing 10 tools)
- New Python modules imported in `__init__.py` within `create_server()`
- Schema changes use `CREATE TABLE IF NOT EXISTS` (idempotent)
- Source config (`sources/isa-knowledge-base/config.json`) needs no changes — new tools auto-register
- Python server stays standalone (not in pnpm workspace)
- New dependencies added to `pyproject.toml` `[project.dependencies]`
- Plan archived to `plans/260220-isa-guide-reference-search.md` after completion

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

_Last updated: 2026-02-19_
