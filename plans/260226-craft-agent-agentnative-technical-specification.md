# Craft Agent (AgentNative) � Technical Specification

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
| Description | Electron desktop app � Claude Agent SDK-powered coding assistant with MCP server support |
| License | MIT (app), Apache-2.0 (packages) |
| Origin | Fork of `lukilabs/craft-agents-oss` |
| Remote `origin` | `github.com/AlwinLijdsman/agentnative` |
| Remote `upstream` | `github.com/lukilabs/craft-agents-oss` |
| Platform | Windows ARM64 � uses **pnpm + tsx**, never bun |

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
�
+-- apps/                              # -- Tier 1: Applications --
�   +-- electron/                      # Main Electron desktop app
�   �   +-- src/
�   �   �   +-- main/                  # Main process
�   �   �   �   +-- index.ts           #   App entry point, Sentry init, window creation
�   �   �   �   +-- sessions.ts        #   SessionManager � core agent/session lifecycle (~5700 lines)
�   �   �   �   +-- ipc.ts             #   IPC handler registration (main ? renderer)
�   �   �   �   +-- window-manager.ts  #   BrowserWindow creation & management
�   �   �   �   +-- auto-update.ts     #   electron-updater integration
�   �   �   �   +-- deep-link.ts       #   craft-agent:// protocol handler
�   �   �   �   +-- menu.ts            #   Native menu bar
�   �   �   �   +-- notifications.ts   #   System notifications
�   �   �   �   +-- power-manager.ts   #   Prevent sleep while agent runs
�   �   �   �   +-- search.ts          #   In-page search (Cmd/Ctrl+F)
�   �   �   �   +-- logger.ts          #   electron-log configuration
�   �   �   �   +-- shell-env.ts       #   Load user's shell env (PATH, nvm, etc.)
�   �   �   �   +-- onboarding.ts      #   First-run setup flow
�   �   �   �   +-- lib/               #   Config watcher helper
�   �   �   +-- preload/
�   �   �   �   +-- index.ts           #   Context-isolated bridge (exposes IPC to renderer)
�   �   �   +-- renderer/
�   �   �   �   +-- main.tsx           #   React entry point
�   �   �   �   +-- App.tsx            #   Root component with routing
�   �   �   �   +-- atoms/             #   Jotai atoms: sessions, agents, sources, skills, overlay
�   �   �   �   +-- pages/             #   ChatPage, PreferencesPage, AgentInfoPage, SourceInfoPage, etc.
�   �   �   �   +-- components/        #   UI: chat/, settings/, onboarding/, markdown/, workspace/, etc.
�   �   �   �   +-- hooks/             #   useSession, useLabels, useStatuses, useViews, useTheme, etc.
�   �   �   �   +-- contexts/          #   ThemeContext, AppShellContext, ModalContext, FocusContext, etc.
�   �   �   �   +-- actions/           #   IPC action wrappers
�   �   �   �   +-- utils/             #   Renderer-side utilities
�   �   �   +-- shared/                #   Types shared between main & renderer
�   �   �   �   +-- routes.ts          #     URL routes
�   �   �   �   +-- feature-flags.ts   #     Feature flag definitions
�   �   �   �   +-- settings-registry.ts #   Settings schema
�   �   �   �   +-- types.ts           #     Shared IPC types
�   �   �   +-- __tests__/             #   E2E and integration tests
�   �   +-- resources/                 #   Bundled assets (synced to ~/.craft-agent/ on launch)
�   �   �   +-- config-defaults.json   #     Default app/workspace preferences
�   �   �   +-- docs/                  #     Built-in documentation markdown files
�   �   �   +-- themes/                #     15 built-in color themes (JSON)
�   �   �   +-- permissions/           #     Default permission rules
�   �   �   +-- tool-icons/            #     SVG icons for tools
�   �   �   +-- bridge-mcp-server/     #     Bundled Bridge MCP Server binary
�   �   �   +-- session-mcp-server/    #     Bundled Session MCP Server binary
�   �   �   +-- release-notes/         #     Per-version release notes
�   �   �   +-- craft-logos/           #     Branding assets
�   �   +-- electron-builder.yml       #   electron-builder configuration
�   �   +-- vite.config.ts             #   Vite config for renderer
�   �   +-- eslint.config.mjs          #   ESLint config
�   �
�   +-- viewer/                        # Standalone web viewer for session transcripts
�       +-- src/                       #   Vite + React app
�       +-- vite.config.ts
�
+-- packages/                          # -- Tier 2: Shared Libraries --
�   +-- core/                          # @craft-agent/core � Type definitions
�   �   +-- src/
�   �       +-- types/                 #   Workspace, Session, Message, AgentEvent, TokenUsage
�   �       +-- utils/                 #   Debug logging stub, ID generation
�   �
�   +-- shared/                        # @craft-agent/shared � ALL business logic
�   �   +-- src/
�   �       +-- agent/                 #   CraftAgent, permission modes, stage gate, tool matching
�   �       �   +-- claude-agent.ts    #     Direct Anthropic API backend
�   �       �   +-- copilot-agent.ts   #     VS Code Copilot SDK backend
�   �       �   +-- codex-agent.ts     #     Codex binary backend
�   �       �   +-- base-agent.ts      #     Abstract base agent class
�   �       �   +-- backend/           #     Backend factory + adapters (codex/, copilot/)
�   �       �   +-- core/              #     Permission manager, prompt builder, source manager,
�   �       �   �                      #     usage tracker, session lifecycle, config watcher/validator
�   �       �   +-- mode-manager.ts    #     Permission mode state (safe/ask/allow-all)
�   �       �   +-- session-scoped-tools.ts  # Tools available within agent sessions
�   �       �   +-- diagnostics.ts     #     Agent diagnostic logging
�   �       +-- agents/                #   Agent definition loading (AGENT.md parsing)
�   �       +-- auth/                  #   OAuth flows: Claude, Google, Microsoft, Slack, GitHub
�   �       +-- config/                #   App/workspace config storage, preferences, models, theme, watcher
�   �       +-- credentials/           #   AES-256-GCM encrypted credential storage
�   �       +-- mcp/                   #   MCP client, connection validation
�   �       +-- mentions/              #   @mention parsing for agents/sources in chat
�   �       +-- prompts/               #   System prompt generation
�   �       +-- sessions/              #   Session CRUD, JSONL persistence, debounced queue
�   �       +-- sources/               #   Source types/storage/service, credential manager, token refresh
�   �       +-- labels/                #   Hierarchical label system (CRUD, tree, auto-labeling)
�   �       +-- views/                 #   Filter-based session views (filtrex DSL)
�   �       +-- statuses/              #   Workflow status system (CRUD, icons, validation)
�   �       +-- skills/                #   Skill loading and storage
�   �       +-- search/                #   Fuzzy search (uFuzzy)
�   �       +-- tools/                 #   Tool registry and metadata
�   �       +-- scheduler/             #   Cron-based hook system, command execution, security
�   �       +-- codex/                 #   Codex binary resolver, config generator
�   �       +-- hooks-simple/          #   Simple hook system (command executor)
�   �       +-- validation/            #   URL and input validation
�   �       +-- version/               #   Version management
�   �       +-- workspaces/            #   Workspace storage
�   �       +-- docs/                  #   Documentation links, source guides
�   �       +-- icons/                 #   Icon utilities
�   �       +-- colors/                #   Color utilities
�   �       +-- branding.ts            #   Branding constants
�   �       +-- network-interceptor.ts #   Fetch interceptor (API errors, MCP schema injection)
�   �
�   +-- ui/                            # @craft-agent/ui � Shared React components
�   �   +-- src/
�   �       +-- components/            #   SessionViewer, TurnCard, markdown rendering
�   �       +-- context/               #   Theme context provider
�   �       +-- styles/                #   Shared CSS
�   �
�   +-- session-tools-core/            # @craft-agent/session-tools-core � Tool handlers
�   �   +-- src/
�   �       +-- handlers/              #   agent-stage-gate, agent-state, submit-plan,
�   �       �                          #   source-test, source-oauth, credential-prompt,
�   �       �                          #   config-validate, mermaid-validate, skill-validate
�   �       +-- context.ts             #   Handler execution context
�   �       +-- source-helpers.ts      #   Source utility functions
�   �
�   +-- bridge-mcp-server/             # @craft-agent/bridge-mcp-server
�   �   +-- src/index.ts               #   Bridges API sources ? MCP protocol (stdio, credential cache)
�   �
�   +-- session-mcp-server/            # @craft-agent/session-mcp-server
�   �   +-- src/index.ts               #   Exposes session tools to Codex via MCP (stdio)
�   �
�   +-- mermaid/                       # @craft-agent/mermaid � Flowchart ? SVG renderer
�   �   +-- src/                       #   Custom ELK layout engine, shape rendering
�   �
�   +-- codex-types/                   # @craft-agent/codex-types � Auto-generated API types
�       +-- src/                       #   ~200 TypeScript type files from Codex API schema
�
+-- agents/                            # -- Tier 3: Workspace Configuration --
�   +-- _templates/                    #   Agent templates (deep-research)
�   +-- isa-deep-research/             #   ISA Deep Research agent
�       +-- AGENT.md                   #     Agent definition (frontmatter: name, sources, tools)
�       +-- config.json                #     Agent metadata (display name, icon, settings)
�       +-- icon.svg                   #     Agent icon
�
+-- sources/                           #   Source (data connection) definitions
�   +-- agentnative/config.json        #     Local filesystem source (this repo)
�   +-- anthropic/config.json          #     Anthropic API source
�   +-- azure-ai-search/config.json    #     Azure AI Search API
�   +-- azure-deepseek/config.json     #     Azure-hosted DeepSeek
�   +-- azure-doc-intelligence/        #     Azure Document Intelligence
�   +-- azure-embeddings/              #     Azure Embeddings API
�   +-- azure-openai-sweden/           #     Azure OpenAI (Sweden region)
�   +-- azure-openai-swiss/            #     Azure OpenAI (Switzerland region)
�   +-- brave-search/config.json       #     Brave Search API
�   +-- isa-knowledge-base/config.json #     ISA KB MCP server (stdio transport)
�   +-- voyage-ai/config.json          #     Voyage AI embeddings API
�
+-- skills/                            #   Skill definitions (Claude Code slash commands)
�   +-- an-research-and-plan/          #     /an-research-and-plan � Research & create plan.md
�   +-- an-implement-full/             #     /an-implement-full � Execute all plan phases
�   +-- an-implement-phased/           #     /an-implement-phased � Execute plan phase-by-phase
�   +-- an-adversarial-reviewer/       #     /an-adversarial-reviewer � Adversarial code review
�   +-- an-code-researcher/            #     /an-code-researcher � Read-only code analysis
�   +-- car-rental-zurich/             #     Domain-specific skill example
�
+-- labels/                            #   Label hierarchy (config.json)
�   +-- config.json                    #     Development, Design, Research, etc.
�
+-- statuses/                          #   Workflow status definitions
�   +-- config.json                    #     Todo, In Progress, Needs Review, Done, Cancelled
�   +-- icons/                         #     Status icon SVGs
�
+-- scripts/                           #   Build & utility scripts (all via `npx tsx`)
�   +-- electron-dev.ts                #     Dev mode with hot reload
�   +-- electron-build-main.ts         #     Build main process
�   +-- electron-build-preload.ts      #     Build preload
�   +-- electron-build-renderer.ts     #     Build renderer
�   +-- electron-build-resources.ts    #     Copy bundled resources
�   +-- electron-build-assets.ts       #     Copy additional assets
�   +-- electron-clean.ts              #     Clean dist/
�   +-- extract-oauth-token.ts         #     Extract OAuth token from credentials.enc
�   +-- run-e2e-live.ts                #     Run live E2E tests with auto token
�   +-- test-stage0-e2e.ts             #     Stage 0 pause verification test
�   +-- sync-version.ts               #     Sync version across packages
�
+-- .github/agents/                    #   VS Code Copilot Chat agent definitions
�   +-- research-and-plan.agent.md     #     "Plan Changes" � branch check + research + plan
�   +-- carefully-implement-full-phased-plan.agent.md  # "Build Continuously" + commit/push
�   +-- carefully-implement-phased-plan.agent.md       # "Build Step-by-Step" + commit/push
�   +-- adversarial-reviewer.agent.md  #     "Review Code" � read-only adversarial review
�   +-- code-researcher.agent.md       #     "Research Code" � read-only analysis
�   +-- e2e-test-runner.agent.md       #     "Run E2E Tests" � test execution
�
+-- isa-kb-mcp-server/                 # -- Tier 4: External MCP Servers --
�   +-- src/isa_kb_mcp_server/         #   Python MCP server for ISA knowledge base
�   �   +-- __main__.py                #     Entry point
�   �   +-- search.py                  #     Hybrid search (BM25 + semantic)
�   �   +-- vectors.py                 #     LanceDB vector store + Voyage AI embeddings
�   �   +-- db.py                      #     DuckDB structured data
�   �   +-- graph.py                   #     Entity graph traversal
�   �   +-- verify.py                  #     4-axis verification (citation, entity, relation, contradiction)
�   �   +-- paragraphs.py              #     Paragraph-level retrieval
�   �   +-- context.py                 #     Context formatting
�   �   +-- web_search.py              #     Web search fallback
�   �   +-- schema.sql                 #     Database schema
�   +-- data/                          #     DuckDB + LanceDB data files
�   +-- tests/                         #     pytest test suite
�   +-- pyproject.toml                 #     Python project config
�
+-- sessions/                          #   Session logs (JSONL, gitignored)
+-- plans/                             #   Archived implementation plans
�
+-- config.json                        #   Workspace configuration (ID, defaults, LLM connection)
+-- views.json                         #   Session filter views (filtrex expressions)
+-- events.jsonl                       #   Event log
+-- package.json                       #   Root package.json (scripts, dependencies)
+-- pnpm-workspace.yaml                #   pnpm workspace definition
+-- tsconfig.json                      #   Root TypeScript config
+-- tsconfig.base.json                 #   Base TypeScript config (extended by packages)
+-- .env / .env.example                #   Environment variables (secrets)
+-- .npmrc                             #   pnpm config (shamefully-hoist=true)
+-- CLAUDE.md                          #   Project conventions (read first by agents)
+-- plan.md                            #   THIS FILE � technical spec + active plans
+-- start-agentnative.cmd              #   Windows launcher script
+-- start-agentnative.vbs              #   Windows silent launcher
```

---

## 4. Package Dependency Graph

```
                    +--------------+
                    �  codex-types �  (auto-generated Codex API types)
                    +--------------+
                           �
                    +------?-------+
                    �     core     �  (Workspace, Session, Message types)
                    +--------------+
                       �       �
              +--------?--+  +-?--------+
              �   shared   �  �    ui    �  (React components)
              � (all biz   �  �          �
              �  logic)    �  +----------+
              +------------+       �
                �  �   �           �
   +------------+  �   +-----------+--------------+
   �               �               �              �
   �    +----------?----------+    �              �
   �    � session-tools-core  �?---+              �
   �    � (tool handlers)     �                   �
   �    +---------------------+                   �
   �        �          �                          �
   �  +-----?------+ +-?--------------+          �
   �  � bridge-mcp � � session-mcp    �          �
   �  � server     � � server         �          �
   �  +------------+ +----------------+          �
   �                                              �
   ?                                              ?
+--------------------------------------------------+
�              apps/electron                        �
�  (imports: core, shared, ui, session-tools-core)  �
+--------------------------------------------------+

   mermaid  ?--  session-tools-core  (mermaid validation handler)
```

---

## 5. Architecture Deep Dive

### 5a. Electron Process Model

```
+-------------------------------------------------------------+
�  Main Process (src/main/)                                    �
�  � Window management, native menus, auto-update              �
�  � SessionManager � creates/manages agent sessions           �
�  � IPC handlers � bridges renderer requests to business logic�
�  � Shell env loading � ensures PATH includes nvm, brew, etc. �
�  � Power manager � prevents sleep during agent execution     �
+-------------------------------------------------------------+
                     � contextBridge (preload/index.ts)
                     � IPC channels only � no nodeIntegration
+--------------------?----------------------------------------+
�  Renderer Process (src/renderer/)                            �
�  � React 18 SPA with Jotai atoms                             �
�  � Pages: Chat, Preferences, AgentInfo, SourceInfo, etc.     �
�  � All state in atoms/ � sessions, agents, sources, skills   �
�  � Tailwind CSS 4 for styling                                �
+--------------------------------------------------------------+
```

**Security rule**: Never use `nodeIntegration: true`. All main?renderer communication goes through the preload bridge via typed IPC channels.

### 5b. Agent System

**CraftAgent** (`packages/shared/src/agent/`) wraps the Claude Agent SDK and provides:

| Component | File | Purpose |
|-----------|------|---------|
| Base agent | `base-agent.ts` | Abstract agent interface |
| Claude backend | `claude-agent.ts` | Direct Anthropic API calls |
| Copilot backend | `copilot-agent.ts` | VS Code Copilot SDK integration |
| Codex backend | `codex-agent.ts` | Codex binary subprocess |
| Backend factory | `backend/factory.ts` | Creates backend by type |
| Permission manager | `core/permission-manager.ts` | PreToolUse hook � blocks/allows tools |
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
Multi-stage pipeline gating � the agent must pass through defined stages and can be paused/approved at each gate before proceeding.

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

**Credential Flow** (API sources ? Bridge MCP Server):
```
Main Process ? decrypt credentials.enc ? write .credential-cache.json (0600)
                                              �
Bridge MCP Server (subprocess) ?--------------+ reads on each request
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
| Bridge MCP | `packages/bridge-mcp-server/` | stdio | Bridges API sources ? MCP protocol with credential injection |
| Session MCP | `packages/session-mcp-server/` | stdio | Exposes session tools (SubmitPlan, config_validate) to Codex |
| ISA KB MCP | `isa-kb-mcp-server/` | stdio | Python � ISA knowledge base with hybrid search + graph traversal |

### 5f. UI Architecture

**Jotai Atoms** (`renderer/atoms/`):
- `sessions.ts` � session list, active session, messages
- `agents.ts` � loaded agents
- `sources.ts` � enabled/available sources
- `skills.ts` � loaded skills
- `overlay.ts` � modal/overlay state

**Key Pages** (`renderer/pages/`):
- `ChatPage.tsx` � main chat interface
- `PreferencesPage.tsx` � app & workspace settings
- `AgentInfoPage.tsx` / `AgentRunDetailPage.tsx` � agent details
- `SourceInfoPage.tsx` � source configuration
- `SkillInfoPage.tsx` � skill details

**Contexts** (`renderer/contexts/`):
- `ThemeContext` � color theme provider
- `AppShellContext` � layout state (sidebar, panels)
- `ModalContext` � modal management
- `FocusContext` � keyboard focus tracking
- `StoplightContext` � macOS traffic light positioning
- `EscapeInterruptContext` � ESC key handling

**Key Hooks** (`renderer/hooks/`):
- `useSession` � active session state and actions
- `useLabels` � label CRUD
- `useStatuses` � status workflow
- `useViews` � filtered session views
- `useTheme` � theme resolution and CSS vars
- `useNotifications` � system notifications
- `useBackgroundTasks` � long-running task tracking

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
Workflow states with categories (`open`/`closed`), icons, colors, keyboard shortcuts. Default: Todo ? In Progress ? Needs Review ? Done / Cancelled. Customizable per workspace.

### 5h. Theme System

Cascading resolution: app-level ? workspace-level (last wins).

| Level | Storage Path |
|-------|-------------|
| Built-in | `resources/themes/*.json` (15 themes) |
| App | `~/.craft-agent/theme.json` |
| Workspace | `~/.craft-agent/workspaces/{id}/theme.json` |

6-color system: `background`, `foreground`, `accent`, `info`, `success`, `destructive` � each with optional `dark:` override.

### 5i. Scheduler & Hook System

`packages/shared/src/scheduler/` provides:
- **Cron-based scheduling** via `croner` � trigger agent actions on schedule
- **Hook system** � pre/post hooks for agent lifecycle events
- **Command execution** � sandboxed command runner with security validation
- **Event bus** � pub/sub for internal events

### 5j. Build Pipeline

```
pnpm run electron:build
  �
  +-- electron:build:main      ? esbuild ? dist/main.cjs
  +-- electron:build:preload   ? esbuild ? dist/preload.cjs
  +-- electron:build:renderer  ? Vite    ? dist/renderer/
  +-- electron:build:resources ? Copy resources/ ? dist/resources/
  +-- electron:build:assets    ? Copy additional assets
```

**Dev mode**: `pnpm run electron:dev` � watches all source files, rebuilds on change, hot reloads renderer.

**Distribution**: `pnpm run electron:dist` ? electron-builder packages for current platform.

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
2. Claude Code CLI: `~/.claude/.credentials.json` ? `.claudeAiOauth.accessToken`
3. Craft Agent: `~/.craft-agent/credentials.enc` (via `CredentialManager`)

**To refresh an expired token**: Open Claude Code CLI (`claude` command) � it auto-refreshes on launch. The Craft Agent app refreshes its own store independently.

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
- `AGENT.md` � YAML frontmatter (name, description, required sources, tools) + Markdown body (system prompt instructions)
- `config.json` � Display metadata (name, icon, settings)
- `icon.svg` � Agent icon

Agents are loaded by `packages/shared/src/agents/` and injected into the system prompt when @mentioned.

### Copilot Chat Agents (`.github/agents/`)

| File | Name | Purpose |
|------|------|---------|
| `research-and-plan.agent.md` | Plan Changes | Branch check ? research ? write `plan.md` |
| `carefully-implement-full-phased-plan.agent.md` | Build Continuously | Execute all plan phases ? commit/push |
| `carefully-implement-phased-plan.agent.md` | Build Step-by-Step | One phase at a time with approval ? commit/push |
| `adversarial-reviewer.agent.md` | Review Code | Read-only adversarial review |
| `code-researcher.agent.md` | Research Code | Read-only codebase analysis |
| `e2e-test-runner.agent.md` | Run E2E Tests | Test execution |

**Workflow**: Plan Changes creates a feature branch and writes `plan.md` ? Build agent executes phases ? archives plan ? commits ? pushes.

### Skills (`skills/{slug}/SKILL.md`)

Skills are Claude Code slash commands with YAML frontmatter (`name`, `description`, `globs`). Available as `/an-*` prefix commands in CLI.

---

## 9. Conventions & Constraints

### Do ALWAYS
- Read `CLAUDE.md` first � it's the project rulebook
- Run `pnpm run typecheck:all` before considering changes complete
- Run `pnpm run lint` before considering changes complete
- Follow existing patterns before introducing new ones
- Use workspace protocol (`workspace:*`) for internal package dependencies
- Use `npx tsx` to run TypeScript scripts directly
- Archive completed `plan.md` to `plans/YYMMDD-{slug}.md` before starting new work

### Do NEVER
- Use `bun` � not available on Windows ARM64
- Introduce `any` types without explicit justification
- Use `nodeIntegration: true` in Electron
- Hard-code credentials or API keys
- Skip TypeScript strict mode checks
- Commit `.claude/settings.local.json`
- Delete completed plan items � mark them `[x]` for audit trail

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
> **Supersedes:** Bug report (archived to Section 11a below) � all analysis consumed into this plan
> **Architecture:** Raw `@anthropic-ai/sdk` `client.messages.stream()` with `authToken` (OAuth Bearer) + adaptive thinking (`thinking: {type: "adaptive"}`, `effort: "max"`). NO tools given to LLM. TypeScript controls WHEN, LLM controls HOW. Each stage = 1 max-power API call via Claude Max OAuth subscription. Mirrors gamma's `ISAResearchWorkflow` pattern.

---

### Goal

Replace the Claude Agent SDK `query()` agentic loop **for agent pipelines only** with a TypeScript deterministic for-loop. Each stage = 1 stateless, max-power API call to `api.anthropic.com/v1/messages` via `new Anthropic({ authToken })` using:
- **Claude Max OAuth** subscription (Bearer token, not API key)
- **Opus 4.6 adaptive thinking** (`thinking: {type: "adaptive"}`) � always enabled
- **Effort: `max`** � Claude always applies maximum reasoning power
- **Streaming** via `client.messages.stream()` � REQUIRED by SDK for `max_tokens > 21,333`
- **Dynamic `max_tokens`** � calculated per-call to fit within 200K context window (`input + max_tokens = 200K`)
- **No tools** given to LLM � TypeScript calls MCP tools programmatically
- **No temperature** � incompatible with adaptive thinking
- **Zod-validated JSON extraction** from LLM text output (structured output without `tool_choice`)

Normal chat (no agent @mention) continues using SDK `query()` unchanged.

---

### Adversarial Verification � Gaps & Mitigations

These were identified by challenging every previous finding. All are incorporated into the implementation phases below.

| # | Gap | Severity | Evidence | Mitigation |
|---|-----|----------|----------|------------|
| **G1** | **`anthropic-beta: oauth-2025-04-20` header required** � The raw `@anthropic-ai/sdk` sends `Authorization: Bearer` header but does NOT auto-add the OAuth beta header. The Claude Agent SDK adds this explicitly via its internal `jH()` auth helper (cli.js L220: `"anthropic-beta":pf` where `pf="oauth-2025-04-20"`). Without it, `api.anthropic.com` may reject Bearer tokens with 401. | **CRITICAL** | cli.js L20: `pf="oauth-2025-04-20"`, L220: `headers:{Authorization:\`Bearer ${q.accessToken}\`,"anthropic-beta":pf}` | Pass `defaultHeaders: { 'anthropic-beta': 'oauth-2025-04-20' }` to `new Anthropic()`. Phase 1 includes this. |
| **G2** | **`CLAUDE_CODE_OAUTH_TOKEN` ? `ANTHROPIC_AUTH_TOKEN`** � The app sets `process.env.CLAUDE_CODE_OAUTH_TOKEN` (sessions.ts L1340). The raw SDK reads `process.env.ANTHROPIC_AUTH_TOKEN` (client.ts L299). These are DIFFERENT env vars. Using `new Anthropic()` without explicit `authToken` parameter would fail silently (null token). | **CRITICAL** | sessions.ts L1340: `process.env.CLAUDE_CODE_OAUTH_TOKEN = tokenResult.accessToken`, client.ts L299: `authToken = readEnv('ANTHROPIC_AUTH_TOKEN') ?? null` | NEVER rely on env vars. Always pass `authToken` explicitly to constructor: `new Anthropic({ authToken: oauthToken })`. Get token via `credentialManager.getLlmOAuth(slug)` � returns `{accessToken}` directly. Phase 1 does this. |
| **G3** | **OAuth token expiry & refresh** � OAuth tokens expire (short-lived, ~1h). The current system refreshes them in `reinitializeAuth()` (sessions.ts L1289�1380) and `getValidClaudeOAuthToken()` which calls the SDK's OAuth PKCE refresh flow. If the orchestrator runs a 20-minute pipeline, the token could expire mid-run. | **HIGH** | sessions.ts L1337: `const tokenResult = await getValidClaudeOAuthToken(slug!)` � handles refresh with retry. credentials/manager.ts L197: `getClaudeOAuthCredentials()` returns `{expiresAt}`. | Before EACH `client.messages.stream()` call, check token expiry and re-fetch via `getValidClaudeOAuthToken()`. Create a new `Anthropic` client per-call (lightweight � just sets headers). Phase 1 includes `getOrRefreshToken()` helper. |
| **G4** | **Anthropic API docs show only `x-api-key` auth** � The official API docs (platform.claude.com) only document `x-api-key` header. Bearer auth is undocumented. It works today because Claude Code (the SDK) uses it, but Anthropic could change or deprecate it. | **MEDIUM** | API Overview docs: "x-api-key: Your API key from Console � Yes (required)". No mention of `Authorization: Bearer`. | Accept the risk. Claude Code itself depends on this path � if Anthropic breaks it, their own product breaks. We use the exact same mechanism. Add runtime check: if 401 on first call, log clear error about OAuth support. |
| **G5** | **128K max_tokens is undocumented for OAuth path** � Anthropic docs confirm 128K max output for Opus 4.6, but it's unclear if OAuth/Claude Max has different limits than direct API. Claude Max pricing page says "Higher output limits for all tasks" which may mean MORE than 128K, or may be a marketing phrase. | **LOW** | Anthropic docs: "Max output: 128K tokens" for Opus 4.6. Claude Max pricing: "Higher output limits for all tasks". | Use 128K as default. Make configurable via `config.json` `orchestrator.maxOutputTokens`. If a specific stage needs less (e.g., stage 0 query analysis), set per-stage. |
| **G6** | **No `process.env.ANTHROPIC_BASE_URL` propagation** � Some users configure custom base URLs (OpenRouter, proxies). The raw Anthropic client defaults to `https://api.anthropic.com`. If the user has `ANTHROPIC_BASE_URL` set, we should respect it. | **LOW** | diagnostics.ts L126: `const baseUrl = process.env.ANTHROPIC_BASE_URL?.trim() \|\| 'https://api.anthropic.com'`. LLM connection config has `baseUrl` field. | Read base URL from connection config, fall back to `ANTHROPIC_BASE_URL` env, fall back to default. Pass as `baseURL` to `new Anthropic()`. |
| **G7** | **1M context window requires tier 4 + beta header** � User confirmed: skip 1M context. Use standard 200K. | **N/A** | User instruction: "Skip the 1m because I am not on that level." | Use 200K standard context window. Do NOT add `context-1m-2025-08-07` beta header. |
| **G8** | **`call_llm` tool error message is now WRONG** � llm-tool.ts L518�530 says "OAuth tokens cannot be used for direct API calls." This is incorrect � we PROVED `authToken` works. If we ship the orchestrator, this error message will confuse users. | **LOW** | llm-tool.ts L518: `if (!apiKey && oauthToken) { return errorResponse('call_llm requires an Anthropic API key...')` | Fix the error message in Phase 7 (cleanup). Change `call_llm` to also accept `authToken` + beta header. |
| **G9** | **Streaming REQUIRED for `max_tokens > 21,333`** � Anthropic SDK enforces client-side validation: `messages.create()` throws for `max_tokens > 21,333`. For 128K output, streaming is mandatory. | **CRITICAL** | Anthropic docs: "The SDKs require streaming when max_tokens is greater than 21,333 to avoid HTTP timeouts on long-running requests." | Use `client.messages.stream()` + `.finalMessage()` for ALL LLM calls. Phase 1 uses streaming exclusively. |
| **G10** | **`input + max_tokens` must not exceed 200K** � Anthropic API returns validation error if `prompt_tokens + max_tokens > context_window`. Hardcoding `max_tokens: 128000` fails when input exceeds 72K tokens. | **HIGH** | Anthropic docs: "The system will return a validation error if prompt tokens + max_tokens exceeds the context window size." | `ContextBudgetManager` calculates dynamic `max_tokens = min(desired, 200K - estimated_input)` before each call. Phase 1c. |
| **G11** | **Temperature incompatible with adaptive thinking** � Setting `temperature` when thinking is enabled causes an API error. | **HIGH** | Anthropic docs: "Thinking isn't compatible with temperature or top_k modifications." | NEVER pass `temperature` in API calls. Adaptive thinking provides sufficient determinism. Phase 1. |
| **G12** | **`tool_choice: "any"` incompatible with thinking** � Gamma forces structured output via `tool_choice: {type: "any"}`. This errors with thinking enabled: only `auto` or `none` allowed. | **HIGH** | Anthropic docs: "Tool use with thinking only supports tool_choice auto or none." | "No tools" design is correct for thinking-enabled workflows. Use JSON-in-text + Zod validation instead. Phase 1b. |
| **G13** | **Adaptive thinking is NOT enabled by default** � Omitting the `thinking` parameter disables thinking entirely. Must explicitly pass `thinking: {type: "adaptive"}`. | **MEDIUM** | Anthropic docs: "Set thinking.type to adaptive in your API request." Omitting = disabled. | Explicitly include `thinking: {type: "adaptive"}` in every API call. Phase 1. |
| **G14** | **Thinking tokens count against `max_tokens`** � With adaptive thinking, thinking + text output share the `max_tokens` budget. For effort `max`, Claude will use maximum thinking budget. | **MEDIUM** | Anthropic docs: "max_tokens includes your thinking budget when thinking is enabled." | Dynamic `max_tokens` accounts for this. Set generous targets. If `stop_reason: "max_tokens"`, log warning. |
| **G15** | **Repair loop missing from orchestrator** � Gamma's `ISAResearchWorkflow._run_repair_stages()` implements Stage 2?3 iterative repair: if verification finds issues, re-run synthesis with feedback, up to N iterations. Config defines `repairUnits: [{stages: [3, 4], maxIterations: 2}]` but the plan's `AgentOrchestrator.run()` is a linear for-loop with NO repair logic. `repairUnits` would be dead config. | **CRITICAL** | gamma `workflow.py` L1174: `_run_repair_stages()`, config.json L57: `repairUnits`. Orchestrator `run()` has no back-edge. | Add repair loop to Phase 3: after verify stage, check `repairUnits` config ? if verification fails and iterations < max, loop back to synthesis with feedback. See Phase 3 implementation. |
| **G16** | **MCP `callTool()` return type unhandled** � `CraftMcpClient.callTool()` returns a raw MCP `CallToolResult` object: `{ content: [{ type: "text", text: "{...json...}" }] }`. The plan's `McpBridge` directly returns `callTool()` as typed results. The MCP response unwrapping step (`result.content[0].text` ? `JSON.parse()`) is absent. | **CRITICAL** | `client.ts` L133: `return this.client.callTool({ name, arguments: args })` returns raw `CallToolResult`. gamma `tool_executor.py` explicitly parses MCP response. | Add `parseMcpResult()` helper to `McpBridge` (Phase 4). Every `callTool()` return is unwrapped: `result.content[0].text` ? `JSON.parse()` ? Zod validation. |
| **G17** | **`thinking: {type: 'adaptive'}` not in SDK types** � Installed `@anthropic-ai/sdk@>=0.70.0` defines `ThinkingConfigParam = ThinkingConfigEnabled \| ThinkingConfigDisabled`. `ThinkingConfigEnabled` requires `type: 'enabled'` + `budget_tokens: number`. There is NO `type: 'adaptive'` variant. TypeScript will not compile. | **CRITICAL** | `node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts` L507-537: only `'enabled'` and `'disabled'` types defined. | Use `@ts-expect-error` annotation on `thinking` param AND `output_config` param. Document SDK version requirement. When SDK adds adaptive types, remove annotations. Phase 1 updated. |
| **G18** | **MCP client lifecycle undesigned** � `McpBridge` accepts `CraftMcpClient` but no phase covers WHERE the client comes from. The orchestrator bypasses the SDK (which normally manages source MCP connections). Needs its OWN `CraftMcpClient` with stdio transport, connected to ISA KB, with proper connect/close lifecycle. | **HIGH** | `sources/isa-knowledge-base/config.json`: transport config. `claude-agent.ts`: SDK manages MCP via `sourceMcpServers`. Orchestrator has no equivalent. | Phase 4 adds `McpLifecycleManager`: reads source config ? creates `CraftMcpClient({ transport: 'stdio', ... })` ? `connect()` ? passes to `McpBridge` ? `close()` on completion/error. |
| **G19** | **No ContextBuilder � ad-hoc context assembly** � Gamma's `ContextBuilder` (1178 lines) systematically shapes context with token budgets, XML formatting, session state, and stage summaries. Plan shows inline assembly in `runSynthesize()`. Functions `buildSynthesisPrompt()` and `buildSynthesisContext()` are called but never defined. | **HIGH** | gamma `context_builder.py`: XML formatting, tool guidance, session state. Plan `runSynthesize()`: calls undefined `buildSynthesisContext()`. | Add `context-builder.ts` to Phase 3 new files. Defines `buildStageContext()` for XML formatting of retrieval results, token-budgeted truncation, and stage-summary handoff. |
| **G20** | **`getValidClaudeOAuthToken()` ignores `connectionSlug`** � Function signature takes `connectionSlug: string` but internally calls `manager.getClaudeOAuthCredentials()` � a global Claude-specific method. Works with single connection but silently ignores slug with multiple connections. | **LOW** | `auth/state.ts` L185-194: parameter unused. `manager.ts` L186: `getClaudeOAuth()` is global. | Phase 9: add comment documenting this limitation. Low risk � single Claude Max connection is the target use case. |
| **G21** | **Stage 1 (`websearch_calibration`) handler undefined** � Stage dispatch has `case 'websearch_calibration'` but no implementation shown or planned. Config.json defines it as a separate pauseable stage with detailed `pauseInstructions`. The plan never specifies what this stage does: LLM call? MCP web search? How does it modify the query plan? | **MEDIUM** | config.json stage id 1. stage-runner.ts dispatch: no implementation. gamma embeds web search within Stage 0. | Phase 3 adds explicit `runWebsearchCalibration()` handler: calls ISA KB `isa_web_search` via McpBridge ? LLM analyzes results ? refines query plan ? pause for user review. |
| **G22** | **`llm-tool.ts` uses legacy `type: 'enabled'` thinking** � `call_llm` tool uses `thinking: { type: 'enabled', budget_tokens }`. Plan's Phase 9 fixes OAuth error but doesn't upgrade thinking mode to adaptive. | **LOW** | `llm-tool.ts` L614-615: `request.thinking = { type: 'enabled', budget_tokens: thinkingBudget }`. | Phase 9 also updates `call_llm` to support adaptive thinking for Opus 4.6. Add `@ts-expect-error` for SDK type gap. |
| **G23** | **Safe Mode may block MCP tools if orchestrator reuses SDK connections** � Latest session shows `isa_citation_verify` blocked by Safe Mode. If orchestrator creates its OWN `CraftMcpClient` (per G18), Safe Mode won't apply (it's in SDK's `PreToolUse` hook). But if shared connections were used, orchestrator would fail in Safe Mode. | **LOW** | Session `260223-nimble-coast` L44: Safe Mode error. `CraftMcpClient` has no Safe Mode logic. | Resolved by G18: orchestrator uses its own `CraftMcpClient` instance. Safe Mode only applies to SDK-managed tool calls. Document this explicitly in Phase 4. |

---

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **LLM call method** | `client.messages.stream()` + `.finalMessage()` per stage | **Streaming is REQUIRED** by Anthropic SDK for `max_tokens > 21,333` (G9). `.finalMessage()` returns complete `Message` object. Stream events emitted for UI progress. Stateless � each call = fresh context. |
| **Auth method** | `new Anthropic({ authToken, baseURL, defaultHeaders })` | **Claude Max OAuth** subscription. Uses existing OAuth token from `credentialManager.getLlmOAuth()`. Explicit `authToken` � never env vars (G2). Bearer token + `anthropic-beta: oauth-2025-04-20` header (G1). |
| **Adaptive thinking** | `thinking: { type: "adaptive" }` � ALWAYS enabled | Opus 4.6 recommended mode. Claude dynamically determines when/how much to think. More cost-efficient on Claude Max (flat-rate subscription). `budget_tokens` is deprecated on Opus 4.6 � adaptive is the only supported path forward. |
| **Effort level** | `effort: "max"` � ALWAYS (depth-mode-aware: deep=`max`, standard/quick=`high`) | Maximum reasoning power on every call. At `max`, Claude applies absolute maximum thinking. Claude Max subscription means no per-token cost penalty. Configurable per depth mode � mirrors gamma's `DepthPreset.synthesis_effort`. |
| **Output tokens** | Dynamic `max_tokens` = `min(desired, 200K - input_tokens)` | Context window is strict: `input + max_tokens = 200K` (G10). Max desired = 128K (Opus 4.6 limit). `ContextBudgetManager` calculates safe value before each call. |
| **Context window** | 200K standard with overflow protection | `ContextBudgetManager` estimates input tokens, truncates retrieval context if needed, enforces minimum output budget (4K tokens). No 1M beta header. |
| **Temperature** | **OMITTED** � incompatible with thinking | Anthropic docs: "Thinking isn't compatible with temperature modifications" (G11). Adaptive thinking provides sufficient quality for structured outputs. |
| **Tools given to LLM** | **NONE** � no `tools` parameter in API call | LLM generates text/JSON only. **Required** � adaptive thinking is incompatible with `tool_choice: "any"` (G12). TypeScript calls MCP tools. Zero bypass surface. |
| **Structured output** | BAML-generated TypeScript clients (primary) + JSON-in-text + Zod validation (fallback) | Each LLM stage defined in `.baml` files ? generated typed clients handle parsing/validation. Fallback: `extractJson()` parses response text + Zod validation + retry. Phase 10 adds BAML; Phases 1-9 use Zod. |
| **MCP tool calls** | `CraftMcpClient.callTool(name, args)` from TypeScript + `parseMcpResult()` unwrapper | Existing client in `packages/shared/src/mcp/client.ts`. Returns raw `CallToolResult` � MUST unwrap: `result.content[0].text` ? `JSON.parse()` ? Zod validate (G16). |
| **MCP lifecycle** | Orchestrator creates its OWN `CraftMcpClient` per-pipeline | Reads source config ? stdio transport ? `connect()` before pipeline ? `close()` after. NOT shared with SDK. Avoids Safe Mode blocking (G18, G23). |
| **Repair loop** | Stages 3?4 iterate until verification passes (max N) | Mirrors gamma's `_run_repair_stages()`. Driven by `config.json` `repairUnits`. Verification feedback ? re-synthesis prompt (G15). |
| **Context shaping** | `buildStageContext()` with XML formatting + token budget | Mirrors gamma's `ContextBuilder`. Retrieval paragraphs wrapped in `<ISA_CONTEXT>`. Token-budgeted truncation by relevance score. Stage-summary handoff (G19). |
| **State management** | TypeScript `PipelineState` object � code writes, code reads | No `agent_state` tool. Immutable append-only event log per gamma's `Thread`. |
| **Output rendering** | `renderDocument()` called by TypeScript after Stage 5 | Existing code in `agent-render-output/renderer.ts`. Called by orchestrator, not LLM. |
| **Pause/resume** | Yield control back to UI after pause stages (0, 1) | User responds, orchestrator resumes from checkpoint. Same UX as current stage gate pause. |
| **Normal chat** | **UNCHANGED** � SDK `query()` as today | Only agent pipelines use the orchestrator. No changes to `chat()` for regular messages. |

---

### Key Files (Existing)

| File | Role | How Used |
|------|------|----------|
| `packages/shared/src/agent/claude-agent.ts` | Main agent � `chat()` method | Modified: detect agent pipeline, delegate to orchestrator |
| `packages/shared/src/credentials/manager.ts` | `getLlmOAuth()` returns `{accessToken, refreshToken, expiresAt}` | Called before each LLM call to get fresh token |
| `apps/electron/src/main/sessions.ts` | `reinitializeAuth()`, `getValidClaudeOAuthToken()` | Token refresh logic � reused |
| `packages/shared/src/mcp/client.ts` | `CraftMcpClient.callTool(name, args)` | TypeScript calls MCP tools (ISA KB search, verify, etc.) |
| `packages/session-tools-core/src/handlers/agent-render-output/renderer.ts` | `renderDocument()` assembles markdown | Called by orchestrator in output stage |
| `agents/isa-deep-research/config.json` | Stage definitions, output config, depth modes | Drives the orchestrator loop |
| `agents/isa-deep-research/AGENT.md` | 920 lines of prompt | Decomposed into per-stage system prompts |
| `packages/shared/src/config/llm-connections.ts` | `getLlmConnection()` � connection config with `baseUrl`, `authType` | Used to resolve base URL and auth type |

### Key Files (New � to create)

| File | Role |
|------|------|
| `packages/shared/src/agent/orchestrator/index.ts` | `AgentOrchestrator` class � deterministic for-loop |
| `packages/shared/src/agent/orchestrator/llm-client.ts` | `OrchestratorLlmClient` � streaming wrapper around `new Anthropic({authToken}).messages.stream()` with adaptive thinking |
| `packages/shared/src/agent/orchestrator/pipeline-state.ts` | `PipelineState` � immutable event-sourced state (port of gamma's `Thread`) |
| `packages/shared/src/agent/orchestrator/stage-runner.ts` | Per-stage dispatch + prompt building |
| `packages/shared/src/agent/orchestrator/cost-tracker.ts` | Per-stage cost tracking from API response `usage` field |
| `packages/shared/src/agent/orchestrator/types.ts` | Type definitions for orchestrator |
| `packages/shared/src/agent/orchestrator/mcp-bridge.ts` | Typed wrapper for MCP tool calls (ISA KB tools) |
| `packages/shared/src/agent/orchestrator/context-budget.ts` | `ContextBudgetManager` � dynamic `max_tokens` calculation + retrieval truncation |
| `packages/shared/src/agent/orchestrator/json-extractor.ts` | `extractJson()` � Zod-validated JSON extraction from LLM text output |
| `packages/shared/src/agent/orchestrator/context-builder.ts` | `buildStageContext()` � XML-formatted, token-budgeted context shaping per stage |
| `packages/shared/src/agent/orchestrator/mcp-lifecycle.ts` | `McpLifecycleManager` � creates, connects, and closes `CraftMcpClient` for ISA KB |

---

### Implementation Phases

#### Phase 1: OrchestratorLlmClient � Raw Anthropic API with Claude Max OAuth [x]

**Goal:** Create a thin LLM client that makes a single max-power `client.messages.stream()` call using `authToken` from Claude Max OAuth. Adaptive thinking always enabled at effort `max`. No tools. Dynamic max_tokens. Context window overflow protection.

**Files to create:**
- `packages/shared/src/agent/orchestrator/llm-client.ts`
- `packages/shared/src/agent/orchestrator/types.ts`
- `packages/shared/src/agent/orchestrator/context-budget.ts`
- `packages/shared/src/agent/orchestrator/json-extractor.ts`

**Implementation:**

```typescript
// llm-client.ts � Claude Max OAuth + Adaptive Thinking + Streaming
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
  desiredMaxTokens?: number;        // Soft target � dynamically adjusted to fit 200K window
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
    private getAuthToken: () => Promise<string>,  // Injected � calls credential manager
    baseURL?: string,
  ) {
    this.baseURL = baseURL || process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
  }

  async call(options: LlmCallOptions): Promise<LlmCallResult> {
    // Get fresh token EVERY call (handles refresh/expiry - G3)
    const authToken = await this.getAuthToken();

    const client = new Anthropic({
      authToken,             // Bearer auth � Claude Max OAuth (NOT apiKey) (G2)
      apiKey: null,          // Explicitly null � prevent env var pickup
      baseURL: this.baseURL, // Respect custom base URL (G6)
      defaultHeaders: {
        'anthropic-beta': OAUTH_BETA_HEADER,  // CRITICAL � G1
      },
    });

    // Dynamic max_tokens � MUST fit within 200K context window (G10)
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

      // Adaptive thinking � let Claude decide when and how much to think (G13).
      // Double cast: SDK v0.71.2 lacks 'adaptive' type, no overlap with union (G17).
      thinking: { type: 'adaptive' } as unknown as Anthropic.ThinkingConfigParam,

      // Effort level � 'max' = absolute maximum reasoning (Opus 4.6 only).
      // Not in stable SDK types (beta-only). Extra property on variable � passes TS.
      output_config: { effort: options.effort || 'max' },

      // NO tools � incompatible with tool_choice:"any" when thinking enabled (G12)
      // NO temperature � incompatible with adaptive thinking (G11)
    });

    // Emit progress events for UI if callback provided
    if (options.onStreamEvent) {
      stream.on('text', (text) => options.onStreamEvent?.({ type: 'text_delta', text }));
    }

    // Get complete message � blocks until stream finishes
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
// context-budget.ts � Dynamic context window budget management
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
// json-extractor.ts � Robust JSON extraction from LLM text output
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
- [ ] Unit test: dynamic `max_tokens` � respects 200K context window
- [ ] Unit test: `ContextBudgetManager.calculateMaxTokens()` � correct arithmetic
- [ ] Unit test: `ContextBudgetManager.truncateRetrievalContext()` � respects budget
- [ ] Unit test: `extractJson()` � parses plain JSON, fenced JSON, embedded JSON
- [ ] Unit test: `extractJson()` � validates against Zod schema, throws on mismatch

---

#### Phase 2: PipelineState � Immutable Event-Sourced State [x]

**Goal:** Port gamma's `Thread` dataclass to TypeScript. Immutable, append-only event log. TypeScript writes state � LLM never touches it.

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
  readonly stageOutputs: ReadonlyMap<number, unknown>;  // stage ? output data

  // Derived properties (like gamma's Thread)
  get isComplete(): boolean;
  get isPaused(): boolean;
  get totalCostUsd(): number;

  // Immutable append � returns new state
  addEvent(event: Omit<StageEvent, 'timestamp'>): PipelineState;
  setStageOutput(stage: number, output: unknown): PipelineState;
}
```

**Persistence:** Save as JSON to `sessions/<id>/data/pipeline-state.json` after each stage. Enables resume on crash/restart.

**Validation:**
- [ ] `pnpm run typecheck:all` passes
- [ ] Unit test: immutability � `addEvent()` returns new instance, original unchanged
- [ ] Unit test: serialization round-trip (JSON save/load)

---

#### Phase 3: AgentOrchestrator � Deterministic For-Loop with Repair [x]

**Goal:** Create the main orchestrator class. TypeScript `for` loop over stages from `config.json` with **repair loop support** (G15). Mirrors gamma's `ISAResearchWorkflow.run()` and `_run_repair_stages()`.

**Files to create:**
- `packages/shared/src/agent/orchestrator/index.ts`
- `packages/shared/src/agent/orchestrator/stage-runner.ts`
- `packages/shared/src/agent/orchestrator/context-builder.ts`

**Core loop** (mirrors gamma's `workflow.py` L790�860 + L1174 `_run_repair_stages()`):

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

        // Yield pause event � UI shows message, waits for user
        yield { type: 'orchestrator_pause', stage: stage.id, message: pauseResult.text };
        state = state.addEvent({ type: 'pause_requested', stage: stage.id, data: {} });

        // Wait for resume (user responds ? orchestrator.resume(userResponse) called)
        return; // Exit generator � resumed via new run() call with state loaded
      }

      // 3. Run the stage
      const stageResult = await this.runStage(stage, state, userMessage, agentConfig);

      // 4. Record output in state (TypeScript writes state � not LLM)
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
      // If verification failed ? loop back to re-run the repair unit's stages.
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

    // All stages done � pipeline complete
    yield { type: 'orchestrator_complete', state };
  }
}
```

**Stage dispatch** (mirrors gamma's `_run_stage()` � `workflow.py` L974�996):

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
      return this.runWebsearchCalibration(stage, state, agentConfig);  // (G21) � see below
    case 'retrieve':
      return this.runRetrieve(stage, state, agentConfig);  // MCP tool calls � no LLM
    case 'synthesize':
      return this.runSynthesize(stage, state, agentConfig); // LLM call
    case 'verify':
      return this.runVerify(stage, state, agentConfig);     // MCP tool calls
    case 'output':
      return this.runOutput(stage, state, agentConfig);     // Renderer � no LLM
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
    return { text: 'No queries to calibrate', summary: 'Skipped � no query plan', usage: ZERO_USAGE, data: {} };
  }

  // 2. Run web searches via McpBridge for each query
  const webResults: WebSearchResult[] = [];
  for (const query of queryPlan.data.queries) {
    const result = await this.mcpBridge.webSearch(query.text);
    webResults.push(result);
  }

  // 3. LLM analyzes web results ? refines query plan
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
  // 1. Build context from previous stages (TypeScript assembles � like gamma)
  const queryPlan = state.getStageOutput(0);   // From stage 0
  const retrievalResults = state.getStageOutput(2);  // From stage 2

  // 2. Build focused system prompt (decomposed from AGENT.md Stage 3 section)
  const systemPrompt = buildSynthesisPrompt(agentConfig);

  // 3. Build user message with XML-formatted context (G19 � context-builder.ts)
  const userContent = buildStageContext({
    stageName: 'synthesize',
    previousOutputs: { queryPlan: queryPlan.data, calibration: state.getStageOutput(1)?.data },
    retrievalContext: retrievalResults.data?.paragraphs ?? [],
    agentConfig,
    tokenBudget: 70_000,  // Max tokens for context � truncates by relevance score
  });
```

**context-builder.ts** (G19 � mirrors gamma's `ContextBuilder` 1178 lines):

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
 * Mirrors gamma's ContextBuilder � shapes context per micro-agent.
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

  // 3. Retrieval context � sorted by relevance, token-budgeted (G19)
  if (options.retrievalContext?.length) {
    const sorted = [...options.retrievalContext].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const budget = options.tokenBudget ?? 60_000;
    const truncated = truncateByTokenBudget(sorted, budget);
    const formatted = truncated.map((p) =>
      `<PARAGRAPH id="${p.id}" score="${p.score}" source="${p.source}">\n${p.text}\n</PARAGRAPH>`
    ).join('\n');
    sections.push(wrapXml('ISA_CONTEXT', formatted));
  }

  // 4. Repair feedback (if in repair iteration � G15)
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
  // 4. ONE max-power LLM call � streaming + adaptive thinking + effort max
  const result = await this.llmClient.call({
    systemPrompt,
    userMessage: userContent,
    desiredMaxTokens: 128_000,  // Dynamic � auto-adjusted to fit 200K window
    onStreamEvent: (event) => this.emitProgress(stage.id, event),
  });

  // 6. Parse structured output with Zod validation (JSON-in-text)
  const synthesis = extractJson(result.text, SynthesisOutputSchema);

  return { text: result.text, summary: 'Synthesis complete', usage: result.usage, data: synthesis };
}
```

**Events yielded to UI** � The orchestrator yields internal `OrchestratorEvent` types.
Phase 6's `runOrchestrator()` maps these to the **existing** renderer event types
(`AgentStageStartedEvent`, `AgentStageCompletedEvent`, `AgentRepairIterationEvent`,
`AgentRunCompletedEvent`, `AgentStageGatePauseEvent`) already defined in
`apps/electron/src/renderer/event-processor/types.ts` and already handled by
`processor.ts` (emits `agent_run_state_update` effects ? drives `agentRunStateAtom`).

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
- [ ] Integration test: mock LLM client + mock MCP client ? verify stages run in order
- [ ] Integration test: pause/resume flow
- [ ] Integration test: budget exceeded ? pipeline stops
- [ ] Integration test: repair loop � verify stages re-run when `needsRepair === true`, stops at `maxIterations` (G15)
- [ ] Unit test: `buildStageContext()` � XML tags present, token budget respected, sorted by score (G19)
- [ ] Unit test: `runWebsearchCalibration()` � calls McpBridge.webSearch, LLM refines query plan (G21)

---

#### Phase 4: MCP Bridge � Programmatic Tool Calls [x]

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
 * Reads source config ? creates CraftMcpClient ? connect() ? passes to McpBridge ? close().
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

/** Unwrap raw MCP CallToolResult ? parsed JSON ? Zod validated (G16) */
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

  // Stage 2: Retrieval � TypeScript calls these based on query plan
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

  // Stage 4: Verification � TypeScript calls these, not LLM
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

**Key insight:** Stages 2 (retrieve) and 4 (verify) in gamma have NO LLM calls � they are pure MCP/KB tool calls orchestrated by Python. Our TypeScript does the same. The orchestrator's own `CraftMcpClient` (via `McpLifecycleManager`) means Safe Mode does NOT apply � it only exists in the SDK's `PreToolUse` hook on SDK-managed connections (G23).

**Validation:**
- [ ] `pnpm run typecheck:all` passes
- [ ] Unit test: mock `CraftMcpClient` ? verify `parseMcpResult()` unwraps `CallToolResult` correctly (G16)
- [ ] Unit test: `parseMcpResult()` edge cases � empty content, missing text, invalid JSON, Zod mismatch
- [ ] Unit test: `McpLifecycleManager` � connect/close/withClient lifecycle (G18)
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
  // The billed count may not match visible text tokens � thinking is billed as output.

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

#### Phase 6: Integration � Wire Orchestrator into ClaudeAgent [x]

**Goal:** Modify `claude-agent.ts` `chat()` to detect agent pipeline and delegate to `AgentOrchestrator` instead of SDK `query()`.

**Files to modify:**
- `packages/shared/src/agent/claude-agent.ts`

**Detection logic:**

```typescript
// In chat() method, before the SDK query() call:
const agentConfig = this.getAgentConfig();  // From config.json
const hasOrchestratableStages = agentConfig?.controlFlow?.stages?.length > 0;

if (hasOrchestratableStages && this.shouldUseOrchestrator()) {
  // Deterministic mode � TypeScript drives
  yield* this.runOrchestrator(userMessage, agentConfig, attachments);
  return;
}

// Normal mode � SDK drives (existing behavior, unchanged)
this.currentQuery = query({ prompt, options });
// ... existing code ...
```

**`shouldUseOrchestrator()`** � initially always true when agent has stages. Later: could be a setting toggle.

**Event mapping (F6 fix)** � Emit **existing** renderer event types, NOT generic `system_message`.

The renderer already has full infrastructure for these events:
- `AgentStageStartedEvent` / `AgentStageCompletedEvent` � `event-processor/types.ts` L437/L449
- `AgentRepairIterationEvent` � `event-processor/types.ts` L462
- `AgentRunCompletedEvent` � `event-processor/types.ts` L472
- `AgentStageGatePauseEvent` � `event-processor/types.ts` L485
- Event processor handles all five in `processor.ts` L212�260 ? emits `agent_run_state_update` effects ? drives `agentRunStateAtom` in renderer

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
        // Emit EXISTING AgentStageStartedEvent � processor.ts L212 handles this
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
        // Then emit stage gate pause � triggers pausedAgent state in renderer
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
- [x] `pnpm run lint` passes (66 problems � all pre-existing, 0 new)
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
- `agents/isa-deep-research/prompts/stage-2-retrieve.md` (minimal � mostly MCP calls)
- `agents/isa-deep-research/prompts/stage-3-synthesize.md`
- `agents/isa-deep-research/prompts/stage-4-verify.md` (minimal � mostly MCP calls)
- `agents/isa-deep-research/prompts/stage-5-output.md` (minimal � renderer does it)

**Key principle:** Each prompt is SHORT and focused. No "don't skip this" � the LLM CAN'T skip it because TypeScript controls the loop.

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

#### Phase 8: Output Stage � Deterministic Rendering [x]

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

  // 3. Call existing renderer � CODE calls it, not LLM
  const { renderDocument, injectSourceBlocks } = await import(
    '@craft-agent/session-tools-core/handlers/agent-render-output/renderer'
  );

  let markdown = renderDocument(finalAnswer, agentConfig.output);
  if (verification.data.source_texts) {
    markdown = injectSourceBlocks(markdown, verification.data.source_texts, agentConfig.output);
  }

  // 4. Write file � CODE writes it, not LLM
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
- `packages/shared/src/agent/llm-tool.ts` � Fix L518�530 error message (G8) + upgrade thinking to adaptive (G22)
- `packages/shared/src/auth/state.ts` � Document slug limitation (G20)
- `agents/isa-deep-research/config.json` � Add `orchestrator` config section

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

**Fix `call_llm` tool** � Now that we know `authToken` works, update the error:

```typescript
// llm-tool.ts L518 � BEFORE (wrong):
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
// llm-tool.ts L614 � BEFORE:
// request.thinking = { type: 'enabled', budget_tokens: thinkingBudget };

// AFTER:
if (model.startsWith('claude-opus-4') || model.startsWith('claude-sonnet-4')) {
  // Opus 4.6+ supports adaptive thinking � let Claude decide when to think
  // @ts-expect-error � SDK types don't define 'adaptive' yet (G17)
  request.thinking = { type: 'adaptive' };
} else {
  // Older models use explicit thinking budget
  request.thinking = { type: 'enabled', budget_tokens: thinkingBudget };
}
```

**Document `getValidClaudeOAuthToken` slug limitation** (G20):

```typescript
// auth/state.ts L185 � Add JSDoc:
/**
 * Get a valid Claude OAuth token for API calls.
 *
 * NOTE (G20): The `connectionSlug` parameter is currently ignored.
 * Internally calls `manager.getClaudeOAuthCredentials()` which is global
 * (not slug-aware). This works for single Claude Max connection but would
 * silently use wrong credentials with multiple connections.
 * Low risk � single Claude Max connection is the target use case.
 */
export async function getValidClaudeOAuthToken(connectionSlug: string): Promise<string> {
```

**Document Safe Mode bypass** (G23):

Add a comment in `mcp-lifecycle.ts` (created in Phase 4):
```typescript
/**
 * DESIGN NOTE (G23): The orchestrator's CraftMcpClient is SEPARATE from
 * SDK-managed MCP connections. This means the SDK's Safe Mode (PreToolUse hook)
 * does NOT apply to orchestrator tool calls. This is intentional � the
 * orchestrator is trusted code making deterministic calls, not an LLM
 * autonomously selecting tools. If Safe Mode needs to apply to orchestrator
 * calls in the future, add a SafeMode check in McpBridge.
 */
```

**Validation:**
- [x] `pnpm run typecheck:all` passes
- [x] `pnpm run lint` passes (66 problems � unchanged baseline)
- [ ] `pnpm run test` passes

---

#### Phase 10: BAML Integration � Type-Safe Prompt Definitions [x]

**Goal:** Replace `json-extractor.ts` + Zod schemas with BAML-generated TypeScript clients for LLM-calling stages.
Each stage�s prompt, input context type, and output schema are defined together in `.baml` files.
BAML generates type-safe TypeScript clients that handle parsing, validation, and retry.

**Rationale:**
- Gamma uses BAML for stages 0, 2, and 4 (proven pattern � `baml_src/isa_research/`)
- BAML co-locates prompt + types ? single source of truth (no drift between prompt instructions and Zod schemas)
- Generated clients handle JSON extraction automatically (replaces `extractJson()` + 4 regex strategies)
- TypeScript output mode (`output_type "typescript"`) generates Zod-equivalent types with runtime validation
- BAML�s built-in retry/fallback replaces manual "Return valid JSON" retry logic

**Prerequisites:** Phases 1�9 complete. BAML is an enhancement layer, not a blocker.

**Note on gamma mapping:** Gamma�s stages are numbered 0�4. Our config.json has stages 0�5.
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
- `packages/shared/package.json` � add `@boundaryml/baml` dev dependency + `baml:generate` script
- `packages/shared/src/agent/orchestrator/stage-runner.ts` � import BAML-generated clients, feature-flag switch
- `packages/shared/src/agent/orchestrator/json-extractor.ts` � keep as fallback; primary path uses BAML
- `packages/shared/.gitignore` � add `src/agent/orchestrator/baml_client/` (generated code)

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
    // BAML supports runtime auth override � see stage-runner integration below
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

**Stage 0 BAML definition** (mirrors gamma�s `stage0.baml`):

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

**Stage 3 BAML definition** (synthesis � mirrors gamma�s `stage2.baml`):

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

**Shared preamble** (mirrors gamma�s `preamble.baml`):

```baml
// isa_research/preamble.baml

template_string ISAPreamble() #"
  You are an expert research assistant specializing in International Standards
  on Auditing (ISA). You work with precision, always citing specific ISA
  paragraph references. You never fabricate information � if source material
  is insufficient, you explicitly state gaps.

  Citation format: (ISA {number}.{paragraph})
  Example: (ISA 315.12), (ISA 540.A20)
"#
```

**Common decisions** (mirrors gamma�s `decisions.baml`):

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
// stage-runner.ts � BAML integration with Zod fallback
import { ISAResearchStage0 } from './baml_client';  // BAML-generated
import { ISAResearchStage3 } from './baml_client';  // BAML-generated
import { extractJson } from './json-extractor';      // Zod fallback

async runAnalyzeQuery(stage, state, userMessage, agentConfig): Promise<StageResult> {
  const useBAML = agentConfig.orchestrator?.useBAML ?? false;

  if (useBAML) {
    try {
      // BAML-generated client � handles parsing + validation automatically
      const queryPlan = await ISAResearchStage0(userMessage, {
        clientOptions: {
          anthropic: {
            authToken: await this.getAuthToken(),
            defaultHeaders: { 'anthropic-beta': 'oauth-2025-04-20' },
          }
        }
      });
      // queryPlan is already typed as ISAQueryPlanOutput � no parsing needed
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
| 0 � analyze_query | **YES** | Complex structured output (ISAQueryPlanOutput with nested ISASubQuery[]) |
| 1 � websearch_calibration | **YES** | Refines query plan ? structured output (WebsearchCalibrationOutput) |
| 2 � retrieve | **NO** | Pure MCP tool calls (isa_hybrid_search, isa_hop_retrieve) � no LLM |
| 3 � synthesize | **YES** | Complex output (ISASynthesisOutput with ISACitation[], repair feedback) |
| 4 � verify | **NO** | Pure MCP tool calls (isa_citation_verify, isa_entity_verify) � no LLM |
| 5 � output | **NO** | Pure TypeScript rendering (renderDocument()) � no LLM |

**Fallback strategy:** `json-extractor.ts` + Zod schemas remain as fallback.
Feature-flagged via `config.json` `orchestrator.useBAML` / `orchestrator.bamlFallbackToZod`.

**Generated code management:**
- `baml_client/` directory is generated code ? added to `.gitignore`
- `pnpm run baml:generate` added to `packages/shared/package.json` scripts
- CI/CD runs `baml:generate` before `typecheck:all`
- `npx baml generate` also works for local development

**Validation:**
- [ ] `npx baml generate` succeeds � TypeScript clients generated in `baml_client/`
- [ ] Generated types match Zod schemas (ISAQueryPlanOutput, ISASynthesisOutput, etc.)
- [x] `pnpm run typecheck:all` passes with BAML adapter (dynamic import + @ts-expect-error)
- [ ] Integration test: BAML client produces typed output for Stage 0 query plan
- [ ] Integration test: BAML client produces typed output for Stage 3 synthesis
- [ ] Integration test: BAML fallback to Zod when `useBAML: false`
- [ ] Unit test: BAML runtime auth injection works with OAuth token
- [ ] Unit test: feature flag toggle � `useBAML: true` uses BAML, `false` uses Zod
- [x] `pnpm run lint` passes (66 problems � unchanged baseline)

---

#### Post-Implementation Wiring Fix (Adversarial Review Findings F1�F7) [x]

**Date:** 2026-02-24
**Trigger:** Adversarial review found 7 wiring defects across orchestrator integration.

| Finding | Description | Fix | Status |
|---------|-------------|-----|--------|
| F1 | `toOrchestratorAgentConfig()` reads `cfg.debug?.enabled` instead of `cfg.orchestrator` | Rewrote to pass through all `cfg.orchestrator` fields | [x] |
| F2 | `AgentConfig` in `agents/types.ts` missing `orchestrator` field | Added `orchestrator?` with 12 optional fields | [x] |
| F3 | Prompt filename mismatch (`stage-0-analyze.md` vs `stage-0-analyze-query.md`) | Renamed `stage-0-analyze.md` ? `stage-0-analyze-query.md`, `stage-1-websearch.md` ? `stage-1-websearch-calibration.md` | [x] |
| F4 | MCP Bridge hardcoded to `null` in `runOrchestrator()` | Wired `McpLifecycleManager` + `OrchestratorMcpBridge` with try/finally lifecycle | [x] |
| F5 | Output title template always `undefined` (both ternary branches) | Fixed cast: `(cfg.output as unknown as Record<string, unknown>)?.['titleTemplate']` | [x] |
| F6 | BAML stages report ZERO token usage | Added `TODO(baml-usage)` comments to 2 BAML branches in `stage-runner.ts` | [x] |
| F7 | Unused `OrchestratorEvent` import in `claude-agent.ts` | Removed during Phase 4 import restructure (replaced with `McpBridge` import) | [x] |

**Files modified:**
- `packages/shared/src/agents/types.ts` � Added `orchestrator?` field to `AgentConfig`
- `packages/shared/src/agent/claude-agent.ts` � Config passthrough, MCP bridge lifecycle, import cleanup
- `packages/shared/src/agent/orchestrator/stage-runner.ts` � BAML TODO comments
- `agents/isa-deep-research/prompts/stage-0-analyze-query.md` � Renamed from `stage-0-analyze.md`
- `agents/isa-deep-research/prompts/stage-1-websearch-calibration.md` � Renamed from `stage-1-websearch.md`

**Validation:**
- [x] `pnpm run typecheck:all` passes
- [x] `pnpm run lint` passes (66 problems � unchanged baseline)

---

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Anthropic deprecates Bearer auth path | Low | High | Claude Code depends on it � they�d break their own product. Monitor SDK updates. |
| OAuth token refresh fails mid-pipeline | Medium | Medium | Check + refresh before EACH `messages.stream()` call. Retry once on 401. |
| Context window overflow (input > 128K) | Medium | High | `ContextBudgetManager` dynamically adjusts `max_tokens`. Truncates retrieval context by relevance score. |
| `stop_reason: "max_tokens"` � thinking exhausts budget | Medium | Medium | Adaptive thinking at effort `max` will use maximum thinking tokens. Log warning on `max_tokens` stop. Increase `desiredMaxTokens` or reduce input. |
| MCP server connection drops during retrieve | Medium | Medium | Retry with backoff. Checkpoint state before MCP-heavy stages. |
| LLM output doesn�t parse as JSON | Medium | Medium | `extractJson()` tries 4 parsing strategies. Retry once with "Return valid JSON" appended. Zod validation catches schema mismatches. BAML handles this automatically when enabled. |
| `temperature` accidentally passed | Low | High | API error � incompatible with thinking. LLM client type system prevents it (no `temperature` in `LlmCallOptions`). |
| `tool_choice: "any"` accidentally used | Low | High | API error � incompatible with thinking. LLM client sends NO tools by design. |
| Streaming connection drops mid-response | Low | Medium | SDK handles reconnection. Checkpoint state after each stage. |
| Repair loop diverges (verification always fails) | Medium | Medium | `maxIterations` cap (default 2). After max iterations, proceed with best-effort output + warning. Log each repair iteration for debugging. (G15) |
| MCP `callTool()` returns unexpected format | Medium | Medium | `parseMcpResult()` validates with Zod. On parse failure: throw with tool name + raw content for debugging. Never pass raw `CallToolResult` to typed code. (G16) |
| SDK types lack `thinking: {type: 'adaptive'}` | High | Low | `@ts-expect-error` annotations on both `thinking` and `output_config`. When SDK updates, remove annotations. TypeCheck will flag stale annotations. (G17) |
| MCP client connection fails on startup | Medium | Medium | `McpLifecycleManager.connect()` throws ? pipeline fails fast. Log source config for debugging. Retry once with backoff. (G18) |
| Context builder token estimation inaccuracy | Medium | Low | Over-estimate by 10% safety margin. Worst case: API returns 400 ? reduce and retry. (G19) |
| `getValidClaudeOAuthToken` returns wrong credentials (multi-connection) | Low | High | Currently global � ignores slug. Document limitation. Low risk for single Claude Max use case. (G20) |
| BAML version incompatibility | Medium | Low | Pin BAML version in `package.json`. Generated code is checked at CI via `baml:generate`. Zod fallback always available. (F11) |
| BAML runtime auth injection fails | Low | Medium | Feature-flagged: `useBAML: false` disables BAML entirely, falls back to `OrchestratorLlmClient` + Zod. (F11) |
| SDK types lack `thinking: {type: 'adaptive'}` | High | Low | `@ts-expect-error` annotations on both `thinking` and `output_config`. When SDK updates, remove annotations. TypeCheck will flag stale annotations. (G17) |
| MCP client connection fails on startup | Medium | Medium | `McpLifecycleManager.connect()` throws ? pipeline fails fast. Log source config for debugging. Retry once with backoff. (G18) |
| Context builder token estimation inaccuracy | Medium | Low | Over-estimate by 10% safety margin. Worst case: API returns 400 ? reduce and retry. (G19) |
| `getValidClaudeOAuthToken` returns wrong credentials (multi-connection) | Low | High | Currently global � ignores slug. Document limitation. Low risk for single Claude Max use case. (G20) |

---

#### Second Adversarial Review Fix (Findings F1�F8) [x]

**Date:** 2026-02-23
**Trigger:** Second adversarial review found 2 critical, 5 warning, 1 nit across orchestrator and session integration.

| Finding | Description | Fix | Status |
|---------|-------------|-----|--------|
| F1 | `feedbackField: "repair_instructions"` mismatches verify stage's `data.feedback` key | Changed config.json `feedbackField` to `"feedback"` | [x] |
| F2 | Orchestrator pause/resume disconnected from session layer (4-way disconnect) | Added `detectPausedOrchestrator()`, `resumeOrchestrator()`, bridge state write/clear helpers in `claude-agent.ts`; updated `sessions.ts` `getPausedAgentResumeContext()` + `sendMessage()` for orchestrator mode | [x] |
| F3 | `onAgentStagePause` searches for non-existent `agent_stage_gate` tool in orchestrator flow | Added `orchestratorMode` guard � skip tool lookup when `data.orchestratorMode === true` | [x] |
| F4 | Misleading indentation in `runOrchestrator()` try/finally � code appeared outside try but was inside | Restructured: single try/catch with `yield 'complete'` after catch, MCP cleanup in separate try block | [x] |
| F5 | No real-time streaming to UI during LLM calls (minutes of silence) | Added intermediate `text_complete` yield per stage in `processOrchestratorEvents()` | [x] |
| F6 | `CostTracker.recordStage()` replaces cost on repair iterations � under-counting totals | Changed to accumulate: existing cost + new cost on repeat recordings | [x] |
| F7 | `AgentOrchestrator.create()` failure skips `complete` yield � UI stuck in loading | Moved `create()` inside the try block so errors are caught and `complete` is always yielded | [x] |
| F8 | `output_config: { effort }` on `streamParams` � extra property risk on SDK upgrade | Replaced `@ts-expect-error` (was unused) with descriptive comment explaining why it's type-safe (object literal, not interface-constrained) | [x] |

**Files modified:**
- `agents/isa-deep-research/config.json` � Fixed `feedbackField` from `"repair_instructions"` to `"feedback"`
- `packages/shared/src/agent/claude-agent.ts` � Major refactor: added `detectPausedOrchestrator()`, `resumeOrchestrator()`, `processOrchestratorEvents()`, `writeOrchestratorBridgeState()`, `clearOrchestratorBridgeState()`; restructured `runOrchestrator()` (F4/F7 indentation + error handling); added `PipelineState` import; added fs imports
- `packages/shared/src/agent/orchestrator/cost-tracker.ts` � `recordStage()` now accumulates instead of replacing
- `packages/shared/src/agent/orchestrator/llm-client.ts` � Updated `output_config` comment (replaced unused `@ts-expect-error`)
- `apps/electron/src/main/sessions.ts` � `onAgentStagePause`: orchestrator mode guard; `getPausedAgentResumeContext()`: returns minimal marker for orchestrator; `sendMessage()`: skips SDK resume injection for orchestrator

**Validation:**
- [x] `pnpm run typecheck:all` passes
- [x] `pnpm run lint` passes (66 problems � unchanged baseline)

---

### Testing Strategy

| Level | What | How |
|-------|------|-----|
| **Unit** | `OrchestratorLlmClient` auth + streaming + thinking | Mock `Anthropic` constructor, assert `authToken` + `defaultHeaders` + `thinking: {type: "adaptive"}` + `output_config: {effort: "max"}`. Verify `messages.stream()` used (not `.create()`). Verify no `temperature`. |
| **Unit** | `ContextBudgetManager` arithmetic | `calculateMaxTokens(150000, 128000)` ? 50000. `calculateMaxTokens(198000, 128000)` ? throws. |
| **Unit** | `extractJson()` parsing | Plain JSON, fenced ```json, embedded {}, Zod validation, failure case. |
| **Unit** | `PipelineState` immutability | Create state, add events, verify originals unchanged |
| **Unit** | `CostTracker` math | Input/output tokens ? USD calculation (including thinking tokens) |
| **Unit** | `McpBridge` tool calls | Mock `CraftMcpClient`, verify tool names + args. Assert `parseMcpResult()` unwraps `CallToolResult` ? parsed JSON ? Zod validated (G16). |
| **Unit** | `parseMcpResult()` edge cases | Empty result, missing text block, invalid JSON, Zod validation failure (G16). |
| **Unit** | `McpLifecycleManager` lifecycle | `connect()` ? client created, `close()` ? client nulled, `withClient()` ? always closes even on throw (G18). |
| **Unit** | `buildStageContext()` formatting | XML tags present, token budget respected, retrieval sorted by score, repair feedback included when set (G19). |
| **Unit** | Repair loop logic | Verify loop runs up to `maxIterations`, stops when `needsRepair === false`, re-runs correct stages (G15). |
| **Unit** | BAML-generated Stage 0 client | Verify `ISAResearchStage0()` returns typed `ISAQueryPlanOutput`. Mock Anthropic responses. |
| **Unit** | BAML-generated Stage 3 client | Verify `ISAResearchStage3()` returns typed `ISASynthesisOutput`. Mock repair feedback path. |
| **Unit** | BAML runtime auth injection | Verify `clientOptions.anthropic.authToken` is passed and OAuth beta header set. |
| **Unit** | BAML/Zod feature flag toggle | `useBAML: true` ? BAML client called. `useBAML: false` ? `llmClient.call()` + `extractJson()`. |
| **Unit** | BAML fallback on error | BAML throws ? `bamlFallbackToZod: true` ? falls back to Zod path. `false` ? re-throws. |
| **Unit** | `runOrchestrator()` event mapping | Verify `AgentStageStartedEvent`, `AgentStageCompletedEvent`, `AgentRepairIterationEvent`, `AgentRunCompletedEvent`, `AgentStageGatePauseEvent` emitted with correct fields. |
| **Integration** | Full pipeline with mock LLM + mock MCP | `AgentOrchestrator.run()` ? verify all 6 stages execute in order |
| **Integration** | Repair loop with mock data | Verify Stage 3?4 repair: fail verify ? re-synthesize ? pass verify ? continue (G15). |
| **Integration** | Pause/resume flow | Orchestrator pauses at stage 0, resume with user message |
| **Integration** | Budget exceeded | Set low budget, verify pipeline stops |
| **Integration** | Context overflow handling | Large retrieval results ? truncation ? API call succeeds |
| **E2E** | Real ISA KB + real Opus 4.6 | `pnpm run test:e2e:live:auto` � requires Claude Max OAuth |
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
| Safe Mode blocks LLM tool calls ? silent failure | TypeScript calls tools directly ? no blocking |
| 920-line AGENT.md competing for attention | Focused per-stage prompts |
| Single SDK `query()` � all or nothing | Stateless calls � checkpoint after each stage |
| No resume on crash | Load `pipeline-state.json` and continue |
| No thinking � SDK doesn't enable it | Opus 4.6 adaptive thinking at effort `max` � absolute maximum reasoning |
| Hardcoded token limits | Dynamic `max_tokens` with context overflow protection |
| No structured output validation | BAML-generated typed clients (primary) + Zod schema validation (fallback) on every LLM response |
| No streaming � UI frozen during long calls | `messages.stream()` with real-time progress events |
| Generic UI events (system_message) | Proper `AgentStageStartedEvent` / `AgentStageCompletedEvent` / `AgentRunCompletedEvent` � drives `agentRunStateAtom` |
| Linear stages � no repair iteration | Repair loop: verify ? re-synthesize ? re-verify (G15) |
| MCP `callTool` returns raw `CallToolResult` used as-is | `parseMcpResult()` unwraps + Zod validates every MCP response (G16) |
| No MCP client lifecycle management | `McpLifecycleManager` handles connect/close with source config (G18) |
| Ad-hoc context assembly (undefined functions) | `buildStageContext()` with XML formatting + token budgets (G19) |
| Safe Mode blocks LLM MCP tool calls | Orchestrator's own MCP client � Safe Mode doesn't apply (G23) |

**Net result:** All structural gaps closed. Gamma-equivalent deterministic control. Claude Max OAuth billing. Opus 4.6 adaptive thinking at maximum power (`effort: "max"`). Dynamic context window management. 128K max output tokens. BAML type-safe prompts with generated TypeScript clients. Proper renderer event integration via existing `AgentStageStartedEvent` / `AgentRunCompletedEvent` infrastructure.

---

## 12. Future Plans & Roadmap

> Add upcoming features, ideas, and technical debt items here.
> Move an item to Section 11 when starting work on it.

### Planned

- [x] **Core package migration** � Move storage, auth, credentials, agent logic from `shared/` to `core/` (phased migration per `core/CLAUDE.md`)
- [x] **Upstream sync workflow** � Automated merge from `upstream/main` with conflict resolution strategy
- [x] **Multi-workspace support** � UI and config for switching between workspaces
- [x] **Plugin system** � Dynamic loading of third-party agents and sources
- [x] **Session sharing** � Export/import sessions for collaboration (viewer app integration)

### Ideas (Not Yet Scoped)

- [x] Agent performance benchmarking framework
- [x] Source health monitoring dashboard
- [x] Automated credential rotation for API sources
- [x] Custom theme editor in Preferences UI
- [x] Collaborative multi-agent sessions
- [x] MCP server marketplace / registry

### Technical Debt

- [x] `apps/electron/package.json` still references `bun` in some script commands (unused on Windows ARM64)
- [x] `packages/shared/CLAUDE.md` references `bun test` � should be `npx tsx --test`
- [x] `nul` file in repo root (Windows reserved name) � `.gitignore`'d but should be removed from history
- [x] Large `sessions.ts` (~5700 lines) � candidate for decomposition into sub-modules

---

## 13. Active Implementation Plan: Electron Main Process Auto-Restart on Rebuild

> **Problem**: The `electron:dev` script rebuilds `main.cjs` via esbuild watch but never restarts
> the Electron process. Code changes to `packages/shared/`, `apps/electron/src/main/`, or any
> transitive dependency are invisible to the running process � developers unknowingly test stale
> code. The orchestrator pipeline bypass (Section 11, Phase 10) was a direct consequence.

### Goal

Ensure the running Electron process automatically restarts when esbuild rebuilds `main.cjs` in
watch mode, preventing the "stale runtime" bug.

### Key Files

| File | Purpose |
|------|---------|
| `scripts/electron-dev.ts` | Dev script � esbuild watch + Electron spawn |
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
  - Skip the very first build (initial startup � Electron spawned separately)
  - Wait for `main.cjs` to stabilize (reuse existing `waitForFileStable()`)
  - Kill current Electron process (`electronProc.kill()`)
  - Wait briefly for graceful shutdown (~500ms)
  - Spawn new Electron process via `spawnElectron()`
  - Log: `?? Main process changed � restarting Electron...`
- [x] Add the plugin to the main esbuild context `plugins` array (line ~366)
- [x] Add debounce guard (150ms) to prevent rapid-fire restarts from cascading file changes
- [x] Re-register `electronProc.on('exit', ...)` on the new process for user-initiated app close

### Phase 2: Add console banner on restart `[x]`

- [x] Track rebuild count; display `?? Restart #N � main.cjs rebuilt`
- [x] Include ISO timestamp for correlation with session logs
- [-] Log which file changed if esbuild `metafile` is enabled (skipped � metafile not enabled; rebuild count + timestamp sufficient)

### Phase 3: Graceful session handling `[x]`

- [x] Verify `SessionManager` persists state on process exit (uses `persistSession()` + `sessionPersistenceQueue.flush()`)
- [x] Verify SDK session resumption works after restart (re-created agent resumes via stored `sdkSessionId`)
- [x] Add console note: `?? Active sessions will resume automatically after restart`

### Phase 4: Validation `[x]`

- [x] `pnpm run typecheck:all` � PASS
- [x] `pnpm run lint` � no new errors (66 pre-existing, 0 new)
- [ ] Manual test: start `electron:dev` ? edit `packages/shared/src/agent/` ? observe esbuild rebuild ? Electron window closes and re-opens ? verify existing session resumes

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
- Manual: edit source ? observe restart ? verify session resume

---

## 14. Active Implementation Plan: Orchestrator Pause Message Formatting

> **Problem**: When the orchestrator pauses after Stage 0 (analyze_query), the raw LLM JSON output
> is yielded directly as the assistant's chat message. Users see an interactive JSON tree instead of
> a human-readable query analysis with clarifying questions. The structured `query_plan` data IS
> correctly stored and flows to later stages, but the user-facing pause message needs formatting.
>
> **Branch:** `fix/source-blocks-injection`
> **Date:** 2026-02-24
> **Status:** Plan approved (v3 � amended after second adversarial gap review for gamma alignment), ready for implementation

### Goal

Transform raw JSON pause output into a human-readable formatted message with:
1. **Clarity assessment** � explicit "clarity is at X% (above/below 70% threshold)" statement
2. **Readable query plan** � assumptions, sub-queries with roles, primary standards
3. **Clarifying questions** � when clarity < 70%, shown as numbered options
4. **Collapsible raw JSON** � the full `query_plan` JSON in a `<details>` block the user can expand

The structured data continues flowing unchanged to downstream stages via `PipelineState`.

### Analysis: Current State

| Aspect | Status | Evidence |
|--------|--------|----------|
| Stage 0 data stored in PipelineState | ? Working | `state.setStageOutput(stage.id, pauseResult)` before pause |
| Data flows to Stage 1+ via context builder | ? Working | `state.getStageOutput(0)` ? `buildStageContext()` wraps in `<QUERY_PLAN>` XML |
| Pause yields raw JSON as message | ? Bug | `pauseResult.text` (raw LLM output) ? `orchestrator_pause.message` ? `text_complete` ? rendered |
| `pauseInstructions` from config.json | ? Dead config | Type exists in `agents/types.ts` but dropped in `toOrchestratorAgentConfig()` � orchestrator never sees it |
| UI has `<details>` support | ? Available | `rehype-raw` enabled in `Markdown.tsx` � HTML elements render |
| UI has collapsible sections | ? Available | `remarkCollapsibleSections` + `CollapsibleSection` + `MarkdownJsonBlock` |
| BAML and Zod produce incompatible data shapes | ?? Gap | See Data Shape Analysis below |

### Data Shape Analysis (Adversarial Review Finding)

Stage 0 and Stage 1 each have two code paths (BAML and Zod) that produce **structurally incompatible** data in `StageResult.data`. The formatter must handle both shapes.

**Stage 0 � `StageResult.data` shapes:**

| Field | BAML path (`data.query_plan: ISAQueryPlanOutput`) | Zod path (`data.query_plan: Record<string, unknown>`) |
|-------|--------------------------------------------------|------------------------------------------------------|
| Sub-query text | `.sub_queries[].text` | `.sub_queries[].query` |
| Sub-query standards | `.sub_queries[].isa_standards` | `.sub_queries[].target_standards` |
| Sub-query role | **absent** | `.sub_queries[].role` |
| Search strategy | `.sub_queries[].search_strategy` | **absent** |
| Depth | `.depth_recommendation` | `.depth_mode` |
| Scope | `.scope_classification` | `.scope` |
| Refined query | `.refined_query` | **absent** |
| Recommended action | **absent** | `.recommended_action` |
| Clarification questions | **absent** | `.clarification_questions` |
| Alternative interpretations | **absent** | `.alternative_interpretations` |
| Authority sources | **absent** | `.authority_sources` |

**Stage 1 � `StageResult.data` shapes:**

| Field | BAML path | Zod path |
|-------|-----------|----------|
| Calibration object key | `data.calibration` (`WebsearchCalibrationOutput`) | `data.websearch_calibration` (from prompt schema) |
| Query list | `calibration.queries[]` (`.original_text`, `.refined_text`, `.action`) | `websearch_calibration.intent_changes` (`.sub_queries_added`, `.sub_queries_modified`, etc.) |
| Summary | `calibration.calibration_summary` | `websearch_calibration.web_research_context` |
| Web results | `data.webResults` | `data.webResults` |

**Solution**: Create `normalizeStage0Data()` and `normalizeStage1Data()` functions in `pause-formatter.ts` that map each shape to common `NormalizedQueryPlan` / `NormalizedCalibration` interfaces before formatting.

### Clarity Threshold Alignment

The prompt (`stage-0-analyze-query.md`) and config (`pauseInstructions`) both use **0.7** as the clarity threshold. The formatter must use **0.7** to match the LLM's actual behavior.

Prior plan (v1) incorrectly used 0.8. Corrected throughout in v2.

### Key Files

| File | Purpose | Change |
|------|---------|--------|
| `packages/shared/src/agent/orchestrator/pause-formatter.ts` | **NEW** � Data normalization + deterministic pause message builder | `normalizeStage0Data()`, `normalizeStage1Data()`, `formatPauseMessage()` |
| `packages/shared/src/agent/orchestrator/index.ts` | Pipeline execution loop | Use `formatPauseMessage()` instead of raw `pauseResult.text`; add `pause_formatted` event |
| `packages/shared/src/agent/orchestrator/types.ts` | Orchestrator type definitions | Add `NormalizedQueryPlan`, `NormalizedCalibration` interfaces; add `pause_formatted` to `StageEventType`; add `onDebug` to `OrchestratorOptions` |

### Design Decision: Deterministic Formatting (Not LLM)

The pause message is generated by TypeScript from the parsed structured data � NOT by asking the LLM to produce both JSON + human text. Rationale:

| Approach | Pros | Cons |
|----------|------|------|
| **LLM produces both** | Single call | Dilutes prompt focus; non-deterministic formatting; may skip JSON or skip prose |
| **Second LLM call** | Clean separation | Extra latency + cost; overkill for formatting |
| **Deterministic template** ? | Instant; 100% consistent; no extra cost | Must handle missing fields gracefully |

### Phase 1: Create normalized data types + extend orchestrator types `[x]`

- [x] Add to `packages/shared/src/agent/orchestrator/types.ts`:
  - `NormalizedSubQuery` interface: `{ text: string; role?: string; standards: string[]; searchStrategy?: string }`
  - `NormalizedQueryPlan` interface: `{ originalQuery: string; clarityScore: number; recommendedAction?: string; assumptions: string[]; alternativeInterpretations: string[]; clarificationQuestions: string[]; primaryStandards: string[]; subQueries: NormalizedSubQuery[]; depth: string; scope: string; authoritySourcesPresent: boolean; refinedQuery?: string }`
  - `NormalizedCalibration` interface: `{ skipped: boolean; summary: string; queriesAdded: Array<{query: string; role: string; reason: string}>; queriesModified: Array<{original: string; modified: string; reason: string}>; queriesDemoted: Array<{query: string; reason: string}>; scopeChanged: boolean; webSourceCount: number; queryPlanRefined: boolean }`
- [x] Add `'pause_formatted'` to `StageEventType` union (alongside `stage_started`, `stage_completed`, etc.) � records which normalization path was used and whether formatting succeeded or fell back. Follows gamma's "all derived state from events" principle (`core/thread.py` canonical event type constants).
- [x] Add `onDebug?: (message: string) => void` to `OrchestratorOptions` interface � threads `ClaudeAgent.onDebug` into the orchestrator for structured diagnostic logging. This is the agentnative equivalent of gamma's `get_logger()` pattern (gamma uses `logging` module to stderr; agentnative uses `onDebug` callbacks that flow to session debug output).
- [x] Validate: `pnpm run typecheck:all`

### Phase 2: Create `pause-formatter.ts` � normalization + formatting `[x]`

**Part A: Data normalizers**

- [x] Create `packages/shared/src/agent/orchestrator/pause-formatter.ts`
- [x] **Logging convention**: All diagnostic output in `pause-formatter.ts` must use the `onDebug` callback (NOT `console.warn`). The function signatures accept an optional `onDebug?: (msg: string) => void` parameter. Log at minimum:
  - Which normalization path was selected: `[pause-formatter] Stage {id}: using {BAML|Zod|fallback} normalization path`
  - Normalization result: `[pause-formatter] Stage {id}: normalized {N} sub-queries, clarity={score}` or `[pause-formatter] Stage {id}: normalization returned null � using fallback`
  - This mirrors gamma's `get_logger('tools')` / `log_tool_call()` pattern adapted to agentnative's `onDebug` callback architecture.
- [x] Implement `normalizeStage0Data(data: Record<string, unknown>, onDebug?: (msg: string) => void): NormalizedQueryPlan | null`:
  - Try `data.query_plan` as container (both BAML and Zod wrap under `query_plan`)
  - If not found, try `data` itself as the query plan object
  - For each field, try BOTH field names:
    - Sub-query text: try `sq.query` (Zod) then `sq.text` (BAML)
    - Standards: try `sq.target_standards` (Zod) then `sq.isa_standards` (BAML)
    - Role: try `sq.role` (Zod) � default to `'unknown'` for BAML
    - Depth: try `depth_mode` (Zod) then `depth_recommendation` (BAML)
    - Scope: try `scope` (Zod) then `scope_classification` (BAML)
    - `clarification_questions`: use if present, default to `[]` (absent on BAML path)
    - `alternative_interpretations`: use if present, default to `[]`
    - `recommended_action`: use if present, default to inferred from `clarity_score < 0.7 ? 'clarify' : 'proceed'`
    - `authority_sources`: set `authoritySourcesPresent` boolean based on presence
  - Return `null` if `clarity_score` is missing (unparseable data)
- [x] Implement `normalizeStage1Data(data: Record<string, unknown>): NormalizedCalibration | null`:
  - Try `data.websearch_calibration` (Zod path first � it has richer structure)
  - If not found, try `data.calibration` (BAML path � `WebsearchCalibrationOutput`)
  - For BAML shape: map `queries[].action` to added/modified/removed buckets
  - For Zod shape: read `intent_changes.sub_queries_added`, `sub_queries_modified`, `sub_queries_demoted`
  - Summary: try `web_research_context` (Zod) then `calibration_summary` (BAML)
  - Return `null` if neither key found

**Part B: Formatters**

- [x] Implement `formatStage0PauseMessage(plan: NormalizedQueryPlan, rawJson: string): string`:
  - Build markdown with these sections (use **0.7** threshold):
    1. **Header** � `**Query Analysis Complete** � Clarity: {score � 100}% ({above/below} 70% threshold)`
    2. **Assumptions** � bullet list (only if non-empty)
    3. **Planned Research Queries** � `{count} queries planned ({depth} mode, {scope} scope)` then bulleted list: `� [{role}] {text} � {standards.join(', ')}`
    4. **Primary Standards** � comma-separated list
    5. **Clarifying Questions** � numbered list (only when `clarityScore < 0.7` OR `clarificationQuestions.length > 0`); prefixed with "Clarity is at {X}%, so I have some clarifying questions before proceeding:"
    6. **Alternative Interpretations** � bullet list (only if non-empty and clarity < 0.7)
    7. **Web Search Prompt** � unless depth is `quick`: "Would you like me to run a web search to refine my understanding before starting research?\nA. Yes � search authoritative ISA sources\nB. No � proceed directly"
    8. **Collapsible Raw JSON** � CRITICAL: use blank lines around markdown content inside HTML:
      ```
      \n<details>\n<summary>[DATA] Full Query Plan (JSON)</summary>\n\n` ` `json\n{rawJson}\n` ` `\n\n</details>\n
      ```
    9. **Cost Footer** (optional, only when `costInfo` provided) � `---\n*Stage 0 used {inputTokens} input + {outputTokens} output tokens (~${costUsd} equivalent)*`
  - Always show assumptions + sub-queries even when clarity >= 0.7 (user likes seeing this data)
- [x] Implement `formatStage1PauseMessage(cal: NormalizedCalibration, rawJson: string): string`:
  - Build markdown:
    1. **Header** � `**Web Search Calibration** � {CALIBRATED/CONFIRMED}` (based on `queryPlanRefined`)
    2. **Summary** � the calibration summary text
    3. **Changes Made** � sections for Added, Modified, Demoted (only non-empty sections)
    4. **Proceed Prompt** � "Shall I proceed?\n1. Yes � start retrieval with the refined plan\n2. Modify � I'd like to adjust something"
    5. **Collapsible Raw JSON** � same `<details>` pattern with blank lines
- [x] Implement `formatPauseMessage(stageId: number, stageName: string, data: Record<string, unknown>, rawText: string, options?: { onDebug?: (msg: string) => void; costInfo?: { inputTokens: number; outputTokens: number; costUsd: number } }): { message: string; normalizationPath: 'baml' | 'zod' | 'fallback' }`:
  - Stage 0: call `normalizeStage0Data(data)` ? `formatStage0PauseMessage(normalized, rawJson)`
  - Stage 1: call `normalizeStage1Data(data)` ? `formatStage1PauseMessage(normalized, rawJson)`
  - Unknown stages: fall back to **wrapped** raw text (see Fallback Design below)
  - `rawJson` derived from: try `JSON.stringify(data, null, 2)`, fall back to `rawText`
  - Return `normalizationPath` alongside `message` � consumed by the `pause_formatted` event for audit trail
  - If `costInfo` is provided, append a cost footer: `---\n*Stage {id} used {inputTokens} input + {outputTokens} output tokens (~${costUsd} equivalent)*` � mirrors gamma's `print_cost_estimate()` pattern for transparency (informational only for Claude Max flat-rate)
- [x] **Fallback Design** � when normalization returns `null`:
  - Do NOT show raw LLM text verbatim (that's the original bug)
  - Instead, show: `**Stage {id} ({name}) Complete**\n\nThe analysis produced structured data but it could not be formatted into a readable summary.\n\n<details>\n<summary>[DATA] Raw Output</summary>\n\n` + fenced JSON/text + `\n\n</details>\n\nPlease review the data above and respond to continue.`
- [x] Export `formatPauseMessage` from `packages/shared/src/agent/orchestrator/pause-formatter.ts`

### Phase 3: Integrate formatter into orchestrator pipeline `[x]`

- [x] Wire `onDebug` callback from `ClaudeAgent` into `AgentOrchestrator`:
  - In `AgentOrchestrator` constructor, store `options.onDebug` as `private readonly onDebug`
  - In `ClaudeAgent.runOrchestrator()`, pass `this.onDebug` via `OrchestratorOptions.onDebug`
  - This threads the existing structured debug channel through to the formatter (no new logging infrastructure needed)
- [x] In `executePipeline()` (`index.ts`), change the pause yield block from:
  ```typescript
  yield { type: 'orchestrator_pause', stage: stage.id, message: pauseResult.text };
  ```
  to:
  ```typescript
  import { formatPauseMessage } from './pause-formatter.ts';
  // Build cost info from the tracker (already recorded above)
  const stageCost = this.costTracker.totalCostUsd; // simplified � or read per-stage record
  const { message: formattedMessage, normalizationPath } = formatPauseMessage(
    stage.id, stage.name, pauseResult.data, pauseResult.text,
    { onDebug: this.onDebug, costInfo: { inputTokens: pauseResult.usage.inputTokens, outputTokens: pauseResult.usage.outputTokens, costUsd: stageCost } },
  );
  // Record which formatting path was used (gamma: all derived state from events)
  state = state.addEvent({
    type: 'pause_formatted',
    stage: stage.id,
    data: { normalizationPath, formattedLength: formattedMessage.length },
  });
  state.saveTo(this.sessionPath);
  yield { type: 'orchestrator_pause', stage: stage.id, message: formattedMessage };
  ```
- [x] `pauseResult.text` (raw LLM output) remains stored in `PipelineState` via `setStageOutput()` � **no change** to data flow
- [x] `pauseResult.data` (parsed JSON) remains the structured data for downstream stages � **no change**
- [x] Only the `message` field of the yielded `orchestrator_pause` event changes � user-facing display only
- [x] **Session.jsonl storage note**: After this change, `session.jsonl` stores the formatted markdown (via `text_complete ? sessions.ts` persistence). The raw structured data remains available in `pipeline-state.json` via `PipelineState.getStageOutput()`. Session search (`search.ts` greps session.jsonl) will match field names in the formatted text (e.g., "Clarity: 73%", query text) rather than raw JSON keys. This is the intended behavior.
- [x] **Crash recovery note**: If a crash occurs between `formatPauseMessage()` and `yield`, the bridge state file (`current-run-state.json`) exists but the formatted message was never sent to the UI. On resume, `resume()` loads state from `pipeline-state.json`, detects `isPaused`, and continues from the next stage � the formatting is idempotent and the pause message is not re-sent (resume skips the paused stage). The `pause_formatted` event in the pipeline state confirms formatting completed successfully.

### Phase 4: Validation `[x]`

- [x] `pnpm run typecheck:all` � zero errors
- [x] `pnpm run lint` � no new errors
- [x] `pnpm run test` � existing mock E2E tests pass
- [ ] Manual test: run `@isa-deep-research` agent ? verify:
  - Stage 0 pause shows formatted readable message (not raw JSON)
  - Clarity score displayed with 70% threshold comparison
  - Sub-queries listed with roles and target standards
  - Clarifying questions shown when clarity < 70% (or when LLM provided them regardless)
  - Collapsible `<details>` block at bottom with full JSON, rendered correctly (syntax-highlighted code block inside)
  - Responding to pause resumes pipeline correctly (data flow intact)
- [ ] Verify BAML path (if `useBAML: true`): formatter handles `ISAQueryPlanOutput` shape correctly
- [ ] Verify Zod path (if `useBAML: false` or BAML unavailable): formatter handles prompt-schema shape correctly
- [ ] Verify `extractRawJson` failure path: when Stage 0 LLM returns unparseable text, `StageResult.data` = `{ rawText: "..." }` ? `normalizeStage0Data()` returns `null` ? fallback formatter triggers ? user sees wrapped output with "could not be formatted" explanation (not raw LLM text)
- [ ] Verify `onDebug` logging: check Electron dev console for `[pause-formatter]` messages showing normalization path selection and result
- [ ] Verify `pause_formatted` event: check `pipeline-state.json` contains `{ type: 'pause_formatted', stage: 0, data: { normalizationPath: 'zod', formattedLength: ... } }` after Stage 0 pause
- [ ] Verify ASCII-only: no emoji characters in rendered pause message (check `<summary>` text uses `[DATA]` not `??`)

### Removed: Phase 1 from v1 plan (`pauseInstructions` wiring)

> **Removed per adversarial review finding F4.** The original Phase 1 wired `pauseInstructions` from `StageDefinition` through `StageConfig` into the orchestrator. However, the deterministic formatter reads `StageResult.data` � it never consults stage configuration strings. Wiring `pauseInstructions` would produce the same dead-config situation the plan aimed to fix. If `pauseInstructions` is needed in the future (e.g., for LLM-based formatting), it can be added then.

### Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| BAML vs Zod shape divergence ? formatter breaks | High | **Addressed**: `normalizeStage0Data()` and `normalizeStage1Data()` try both field names with fallback defaults; return `null` for unparseable data |
| BAML lacks `clarification_questions` ? feature missing | Medium | **Addressed**: Default to `[]`; infer `recommended_action` from `clarity_score < 0.7` when absent |
| Clarity threshold mismatch (plan vs prompt) | Medium | **Fixed**: Changed to 0.7 throughout to match prompt and config.json |
| `<details>` HTML not rendering markdown inside | Medium | **Addressed**: Template uses mandatory blank lines before/after fenced code blocks inside `<details>` � required by `rehype-raw` |
| Normalization returns `null` ? fallback to raw text | Low | **Addressed**: Fallback wraps content in `<details>` with explanation, not bare raw text |
| Stage 1 has different data key on BAML (`calibration`) vs Zod (`websearch_calibration`) | Medium | **Addressed**: `normalizeStage1Data()` tries both keys |
| Formatted message too long for chat bubble | Low | Collapsible sections keep visible size manageable |
| Emoji/Unicode in `<details>` summary corrupts on cp1252 | Medium | **Fixed (v3)**: Replaced `??` with ASCII `[DATA]` per gamma convention |
| No diagnostic logging in formatter ? silent failures | Medium | **Fixed (v3)**: `onDebug` callback threaded through; formatter logs normalization path and result |
| No audit trail for normalization path in PipelineState | Low | **Fixed (v3)**: `pause_formatted` event recorded with `normalizationPath` and `formattedLength` |

### Adversarial Review Findings � Resolution Matrix

| ID | Finding | Resolution |
|----|---------|------------|
| F1 | BAML vs Zod produce incompatible `query_plan` shapes | `normalizeStage0Data()` maps both shapes to `NormalizedQueryPlan` |
| F2 | BAML type lacks `clarification_questions` | Default to `[]`; infer `recommended_action` from clarity score |
| F3 | Clarity threshold: plan=0.8, prompt=0.7, config=0.7 | Changed to 0.7 everywhere in plan |
| F4 | Phase 1 wires `pauseInstructions` but nothing consumes it | Removed Phase 1 entirely � dead work |
| F5 | Stage 1 dual BAML/Zod shapes | `normalizeStage1Data()` tries both `calibration` and `websearch_calibration` keys |
| F6 | `<details>` needs blank lines around code fence | Template explicitly includes blank lines; documented in Phase 2 |
| F7 | Fallback path shows raw text � the original bug | Fallback wraps in `<details>` with "could not format" explanation |

### Adversarial Review Findings v3 � Gamma Alignment (Resolution Matrix)

| ID | Finding | Severity | Resolution |
|----|---------|----------|------------|
| G1 | Emoji `??` in `<details>` summary violates gamma ASCII-only rule (Windows cp1252 breaks) | warning | Replaced all `??` with `[DATA]` in `<summary>` tags � matches gamma's `[PASS]`/`[FAIL]`/`[WARN]` convention |
| G2 | No structured logging for `pause-formatter.ts` � entire orchestrator uses raw `console.warn`, gamma uses `get_logger()` | warning | Added `onDebug` callback to `OrchestratorOptions` and threaded through to `formatPauseMessage()`. Formatter logs normalization path selection and result via `onDebug`. This is the agentnative equivalent of gamma's `get_logger()` + `log_tool_call()` pattern. |
| G3 | No `pause_formatted` event in PipelineState � breaks gamma "all state from events" principle | nit | Added `'pause_formatted'` to `StageEventType` union. Recorded in `executePipeline()` after formatting with `normalizationPath` and `formattedLength` data. Enables crash recovery diagnosis and session replay auditing. |
| G4 | `session.jsonl` stores formatted markdown replacing raw JSON � no structured data link | nit | Documented as acceptable tradeoff: raw data remains in `pipeline-state.json` via `PipelineState.getStageOutput()`. Session search benefits from matching human-readable field names. |
| G5 | No cost/token info in pause message � gamma shows `print_cost_estimate()` per stage | nit | Added optional `costInfo` parameter to `formatPauseMessage()`. When provided, appends cost footer: `Stage N used X input + Y output tokens (~$Z equivalent)`. Informational for Claude Max flat-rate users. |
| G6 | Phase 4 missing `extractRawJson failure ? fallback` test scenario | nit | Added explicit test scenario in Phase 4: verify `data = { rawText: "..." }` ? normalization returns `null` ? fallback triggers |
| G7 | Bridge state has no formatting outcome indicator � crash recovery undocumented | nit | Documented crash recovery behavior in Phase 3: formatting is idempotent, `resume()` skips paused stage, `pause_formatted` event confirms formatting completed |

### Testing Strategy

| Test | Scope |
|------|-------|
| `pnpm run typecheck:all` | Type safety of new types and formatter |
| `pnpm run lint` | Code quality |
| `pnpm run test` | Regression � existing mock E2E tests |
| Manual live test (BAML off) | Zod path: formatted pause message renders correctly |
| Manual live test (BAML on) | BAML path: formatter handles `ISAQueryPlanOutput` shape |
| `extractRawJson` failure | Fallback path: unparseable LLM output triggers wrapped fallback (not raw text) |
| `onDebug` logging | Debug console shows `[pause-formatter]` messages for normalization path |
| `pause_formatted` event | `pipeline-state.json` contains formatting audit event after pause |
| ASCII-only check | `<summary>` tags use `[DATA]` not emoji � no cp1252 encoding issues |

---

_Last updated: 2026-02-24 (v3 � amended after second adversarial gap review for gamma alignment)_

---

## Section 15: Pipeline Completion � Output Injection & Cleanup

### Goal

Fix the "Thinking forever" bug where all 6 orchestrator stages complete successfully but (a) the research output is never shown in chat and (b) MCP connections leak on pipeline completion.

### Analysis

**Root cause trace** � three distinct issues found:

| ID | Severity | Issue | Location |
|---|---|---|---|
| P0 | Critical | `runOutput()` doesn't include `output_file_content` in return data ? auto-inject handler never fires | `stage-runner.ts` L722-729 |
| P1 | High | `tryInjectAgentOutputFile` fallback reads `agent-events.jsonl` which doesn't exist in orchestrator flow | `sessions.ts` L4719-4840 |
| P2 | Medium | Cleanup code after `yield { type: 'complete' }` unreachable � MCP connection leaks | `claude-agent.ts` L3261-3271, L3365-3375 |

**P0 Detail:** `stage-runner.ts` `runOutput()` returns `data: { rendered, outputPath, totalCitations, sectionsCount, sourceTextsUsed }`. This data flows through:
1. `executePipeline()` ? `orchestrator_stage_complete` event (with `stageOutput: stageResult.data`)
2. `processOrchestratorEvents()` ? `onAgentEvent({ type: 'agent_stage_completed', data: { stage: 5, ...stageOutput } })`
3. `sessions.ts` L3021: `if (completedStage === 5 && typeof event.data.output_file_content === 'string')` ? **always false** because the field is missing

The 45KB research report is written to disk but never injected into chat.

**P1 Detail:** The fallback `tryInjectAgentOutputFile()` (called from `onProcessingStopped`) reads `agent-events.jsonl` � an artifact of the old SDK-based agent pipeline. The orchestrator uses `pipeline-state.json` instead. The fallback silently returns without injecting.

**P2 Detail:** In both `runOrchestrator()` and `resumeOrchestrator()`, `clearOrchestratorBridgeState()` and `mcpLifecycle.close()` are placed after `yield { type: 'complete' }`. When `sessions.ts` receives `complete`, it returns from the for-await loop, which triggers `generator.return()` on the async generator � the cleanup code at L3264-3271 and L3367-3375 never executes. Bridge state is not leaked (already cleared at resume start or never written for non-pause runs), but MCP connections ARE leaked.

### Key Files

| File | Lines | Role |
|---|---|---|
| `packages/shared/src/agent/orchestrator/stage-runner.ts` | L695-733 | `runOutput()` � add `output_file_content` field |
| `apps/electron/src/main/sessions.ts` | L3006-3044 | `onAgentEvent` handler � auto-inject (already correct, gated on missing field) |
| `apps/electron/src/main/sessions.ts` | L4719-4840 | `tryInjectAgentOutputFile` � fallback needs orchestrator support |
| `packages/shared/src/agent/claude-agent.ts` | L3245-3275 | `runOrchestrator()` � cleanup after yield |
| `packages/shared/src/agent/claude-agent.ts` | L3280-3380 | `resumeOrchestrator()` � cleanup after yield |

### Phase 1: P0 � Add `output_file_content` to Stage 5 result data `[1 file]`

**File:** `packages/shared/src/agent/orchestrator/stage-runner.ts`

- [x] Add `output_file_content: document` to `runOutput()` return `data` object (L726)
- [x] Also add `output_file_path: outputPath` for fallback paths
- [x] `pnpm run typecheck:all` � zero errors

This is potentially a **1-line fix** � the auto-inject handler at `sessions.ts` L3021 already checks `event.data.output_file_content === 'string'` and injects the content. The handler creates a non-intermediate assistant message and sends `text_complete` IPC to the renderer.

### Phase 2: P1 � Harden fallback output injection for orchestrator flow `[1 file]`

**File:** `apps/electron/src/main/sessions.ts`

- [x] Update `tryInjectAgentOutputFile()` to also handle orchestrator-based sessions
- [x] When `agent-events.jsonl` doesn't exist, check `pipeline-state.json` in the same directory for stage 5 completion
- [x] If pipeline-state has stage 5 completed, scan the session's `plans/` directory for the output file (the filename comes from the agent's `config.json` `output.files.answerFile`, defaulting to `isa-research-output.md`)
- [x] Add fallback: scan `plans/*.md` files if specific filename not found
- [x] `pnpm run typecheck:all` � zero errors

### Phase 3: P2 � Fix unreachable cleanup (MCP connection leak) `[1 file]`

**File:** `packages/shared/src/agent/claude-agent.ts`

- [x] In `runOrchestrator()`: wrap `yield { type: 'complete' }` in try/finally, move `mcpLifecycle.close()` to finally block
- [x] In `resumeOrchestrator()`: same pattern � move `mcpLifecycle.close()` to finally block
- [x] Kept `clearOrchestratorBridgeState` in finally for defense-in-depth (costs nothing, guarantees cleanup)
- [x] `pnpm run typecheck:all` � zero errors

Pattern:
```typescript
// Before (broken � post-yield code unreachable):
yield { type: 'complete' };
clearOrchestratorBridgeState(sessionPath, agentSlug);
try { await mcpLifecycle.close(); } catch {}

// After:
try {
  yield { type: 'complete' };
} finally {
  try { await mcpLifecycle.close(); } catch {}
}
```

### Phase 4: Validation

- [x] `pnpm run typecheck:all` � zero errors
- [x] `pnpm run lint` � zero new errors (5 pre-existing errors in unrelated files)
- [x] `pnpm run test` � all mock tests pass (29/29)
- [ ] Manual live test: run ISA Deep Research agent through all 6 stages, verify:
  - Research output appears in chat as non-intermediate message
  - "Thinking..." indicator clears after pipeline completion
  - No console errors about MCP connection leaks

### Risks & Considerations

| Risk | Mitigation |
|---|---|
| 45KB document in event data may be large for IPC | Acceptable � `text_complete` events already carry full message text; renderer handles large messages |
| try/finally on async generators � `finally` block might not run if generator is GC'd without `.return()` | Node.js for-await-of calls `.return()` on early exit; verified in spec |
| `tryInjectAgentOutputFile` fallback may double-inject if P0 already injected | Existing dedup check (L4801): compares first 200 chars of content against existing messages |

### Testing Strategy

| Test | Command | Expected |
|---|---|---|
| TypeScript | `pnpm run typecheck:all` | 0 errors |
| Lint | `pnpm run lint` | 0 errors |
| Unit/Mock | `pnpm run test` | 29/29 pass |
| Live E2E | Manual ISA Deep Research flow | Output shown in chat, processing stops |

---

## Section 16: Orchestrator Pause/Resume � Bridge State Lifecycle Fix

### Goal

Fix the **P0 regression** introduced by Section 15 Phase 3 (P2 fix) where `clearOrchestratorBridgeState()` in a `finally` block deletes bridge state on pause, breaking orchestrator resume detection. Implement a structural fix following gamma best practices: explicit exit-reason signaling, pipeline-state.json identity fields, and resilient dual-source detection.

### Root Cause

Section 15 Phase 3 moved `clearOrchestratorBridgeState()` and `mcpLifecycle.close()` into a `try/finally` block wrapping `yield { type: 'complete' }`. The event flow on pause:

1. `executePipeline()` yields `orchestrator_pause` then returns (generator ends)
2. `processOrchestratorEvents()` handles pause ? writes bridge state ? the for-await loop ends
3. `runOrchestrator()` falls through to `try { yield { type: 'complete' } } finally { clear bridge; close MCP }`
4. `sessions.ts` receives `complete` ? calls `onProcessingStopped('complete')` ? `return` from `sendMessage`
5. JavaScript's `for-await-of` cleanup calls `generator.return()` ? triggers the `finally` block
6. **Bridge state DELETED** � `detectPausedOrchestrator()` can't find the agent slug ? user's next message falls through to regular SDK query path

**Evidence**: Session `260225-grand-holly` (post-fix) has empty bridge state dir but `pipeline-state.json` shows `pause_requested` at stage 0. Sessions `260225-wild-leaf` and `260225-lucid-vine` (pre-fix) have surviving bridge state.

### Gap Analysis � 8 Structural Issues

| ID | Severity | Gap | Root File(s) | Gamma Violation |
|---|---|---|---|---|
| G1 | **CRITICAL** | `PipelineStateSnapshot` has no `agentSlug` � can't find agent from pipeline-state.json alone | `pipeline-state.ts` L37-47 | Single-source-of-truth: durable state must be self-describing |
| G2 | **CRITICAL** | `getPausedAgentResumeContext()` only reads bridge state, never pipeline-state.json � affects resume injection AND queue hold | `sessions.ts` L3991-4057 | Redundancy: detection depends on single transient file |
| G3 | **STRUCTURAL** | `processOrchestratorEvents()` returns `AsyncGenerator<AgentEvent>` with no return signal � caller can't distinguish pause from complete exit | `claude-agent.ts` L3392-3515 | Explicit flow control: exit reason must be typed |
| G4 | **MEDIUM** | MCP cleanup on pause path is now guaranteed (by finally), but bridge state shouldn't be cleared | `claude-agent.ts` L3264-3271 | Resource management: correct cleanup on ALL paths |
| G5 | **LOW** | `tryInjectAgentOutputFile` runs on pause completion (wasted I/O) | `sessions.ts` L4675 | Efficiency: don't scan for stage 5 output after stage 0 pause |
| G6 | **MEDIUM** | Silent detection failures � `detectPausedOrchestrator` and `getPausedAgentResumeContext` have no diagnostic logging | `claude-agent.ts`, `sessions.ts` | Observability: state transitions must be logged |
| G7 | **MEDIUM** | `resumeOrchestrator` clears bridge state at L3301 BEFORE pipeline starts � prevents retry if MCP connect fails | `claude-agent.ts` L3301 | Defensive: don't delete state until replacement is established |
| G8 | **LOW** | Bridge state written AFTER yield in pause handler � vulnerable to `generator.return()` cancellation | `claude-agent.ts` L3461-3469 | Ordering: persist state before yielding control |

### Key Files

| File | Lines | Role |
|---|---|---|
| `packages/shared/src/agent/orchestrator/types.ts` | L293+ | Add `OrchestratorExitReason` type |
| `packages/shared/src/agent/orchestrator/pipeline-state.ts` | L37-47, L78-89, L170-199, L242-260, L271-285 | Add `agentSlug` to snapshot, class, constructors, mutations, serialization |
| `packages/shared/src/agent/orchestrator/index.ts` | L168 | Pass `agentConfig.slug` to `PipelineState.create()` |
| `packages/shared/src/agent/claude-agent.ts` | L3016-3088, L3170-3280, L3288-3390, L3392-3515 | Exit-reason signaling, conditional cleanup, detection fallback, diagnostic logging |
| `apps/electron/src/main/sessions.ts` | L3991-4057, L4675 | Pipeline-state.json detection fallback, output injection guard |

### Phase 1: Foundation � Add `agentSlug` to `PipelineStateSnapshot` `[3 files]` (G1)

**Goal:** Make `pipeline-state.json` self-describing so detection doesn't depend solely on bridge state.

**File: `packages/shared/src/agent/orchestrator/pipeline-state.ts`**

- [x] Add `agentSlug?: string` to `PipelineStateSnapshot` interface (optional for backward compat with existing JSON on disk)
- [x] Add `readonly agentSlug: string` field to `PipelineState` class
- [x] Update private constructor signature: add `agentSlug: string = ''` parameter
- [x] Update `static create(sessionId, agentSlug?)`: accept and store `agentSlug`
- [x] Pass `this.agentSlug` through all immutable mutation returns (`addEvent()`, `setStageOutput()`)
- [x] Update `toSnapshot()`: include `agentSlug` field (only when non-empty, for clean JSON)
- [x] Update `static fromSnapshot()`: read `snapshot.agentSlug ?? ''` (backward compat with old files)
- [x] `pnpm run typecheck:all` � zero errors

**File: `packages/shared/src/agent/orchestrator/index.ts`**

- [x] Update `run()` L168: `PipelineState.create(this.sessionId)` ? `PipelineState.create(this.sessionId, agentConfig.slug)` � seeds the identity field from the agent config
- [x] `pnpm run typecheck:all` � zero errors

**File: `packages/shared/src/agent/orchestrator/types.ts`**

- [x] Add `OrchestratorExitReason` type: `export type OrchestratorExitReason = 'paused' | 'completed' | 'error'`
- [x] `pnpm run typecheck:all` � zero errors

### Phase 2: Core Fix � Exit-Reason Signaling + Conditional Cleanup `[1 file]` (G3, G4, G7, G8)

**Goal:** The structural heart of the fix � `processOrchestratorEvents` signals its exit reason as the generator return value. Callers branch on it for conditional cleanup. Bridge state only cleared on `'completed'` exit.

**File: `packages/shared/src/agent/claude-agent.ts`**

**2a � `processOrchestratorEvents()` exit tracking (L3392-3515):**

- [x] Import `OrchestratorExitReason` from `'./orchestrator/types.ts'`
- [x] Change return type: `AsyncGenerator<AgentEvent>` ? `AsyncGenerator<AgentEvent, OrchestratorExitReason>`
- [x] Add `let exitReason: OrchestratorExitReason = 'completed'` at function top
- [x] **G8 fix** � In `orchestrator_pause` handler, reorder to write-before-yield:

```typescript
// BEFORE (vulnerable � yield gives control to consumer before state is persisted):
yield { type: 'text_complete', text: event.message };
this.writeOrchestratorBridgeState(...);
this.onAgentStagePause?.({...});

// AFTER (safe � state persisted before yielding):
this.writeOrchestratorBridgeState(...);
yield { type: 'text_complete', text: event.message };
this.onAgentStagePause?.({...});
exitReason = 'paused';
```

- [x] In `orchestrator_complete` handler: add `exitReason = 'completed'` (explicit)
- [x] In `orchestrator_error` handler: add `exitReason = 'error'`
- [x] In `orchestrator_budget_exceeded` handler: add `exitReason = 'error'`
- [x] Add `return exitReason;` after the for-await loop

**2b � `runOrchestrator()` conditional cleanup (L3170-3280):**

- [x] Add `let exitReason: OrchestratorExitReason = 'completed'` before outer try block
- [x] Capture return: `exitReason = yield* this.processOrchestratorEvents(...)` � `yield*` propagates the sub-generator's return value
- [x] In catch block: set `exitReason = 'error'`
- [x] Replace unconditional `try { yield complete } finally { clear + close }` with:

```typescript
try {
  yield { type: 'complete' };
} finally {
  this.onDebug?.(`[orchestrator] Cleanup: exitReason=${exitReason}`);
  if (exitReason !== 'paused') {
    this.clearOrchestratorBridgeState(sessionPath, agentSlug);
  }
  try { await mcpLifecycle.close(); } catch { /* best-effort */ }
}
```

**2c � `resumeOrchestrator()` conditional cleanup + G7 fix (L3288-3390):**

- [x] **G7 fix**: REMOVE the early `this.clearOrchestratorBridgeState(sessionPath, agentSlug)` at L3301 � this deletes bridge state before pipeline starts, preventing retry if MCP connect fails. The conditional clear in finally now handles all exits.
- [x] Add `let exitReason: OrchestratorExitReason = 'completed'` before outer try block
- [x] Capture return: `exitReason = yield* this.processOrchestratorEvents(...)`
- [x] In catch block: set `exitReason = 'error'`
- [x] Replace unconditional `try { yield complete } finally { clear + close }` with:

```typescript
try {
  yield { type: 'complete' };
} finally {
  this.onDebug?.(`[orchestrator] Resume cleanup: exitReason=${exitReason}`);
  if (exitReason !== 'paused') {
    this.clearOrchestratorBridgeState(sessionPath, agentSlug);
  }
  try { await mcpLifecycle.close(); } catch { /* best-effort */ }
}
```

**Exit reason contract:**

| Exit Reason | Bridge State | MCP Cleanup | Yield Complete | Rationale |
|---|---|---|---|---|
| `'completed'` | CLEAR | ? | ? | Pipeline done � no resume needed |
| `'paused'` | PRESERVE | ? | ? (sessions.ts needs it for `onProcessingStopped`) | Pipeline paused � must be detectable for resume |
| `'error'` | PRESERVE | ? | ? (error event already yielded, complete follows) | Preserve for potential retry; pipeline state unchanged on early errors |

- [x] `pnpm run typecheck:all` � zero errors

### Phase 3: Resilient Detection Fallback `[2 files]` (G2)

**Goal:** Both detection methods use `pipeline-state.json` as primary/fallback source, making the system resilient even if bridge state is lost.

**File: `packages/shared/src/agent/claude-agent.ts` � `detectPausedOrchestrator()` (L3016-3052)**

- [x] Restructure detection order: pipeline-state.json ? bridge state (fallback)
- [x] After `PipelineState.loadFrom()` confirms `state.isPaused`:
  - **Primary path** (new): if `state.agentSlug` is non-empty, call `loadAgent(this.workspaceRootPath, state.agentSlug)` directly � skip bridge file scan
  - **Fallback path** (existing): scan bridge state files for `orchestratorMode` flag � backward compat for old pipeline-state.json without `agentSlug`
- [x] Log which detection path succeeded

**File: `apps/electron/src/main/sessions.ts` � `getPausedAgentResumeContext()` (L3991-4057)**

- [x] After the existing bridge state scan loop (which may return null if bridge state deleted), add pipeline-state.json fallback:

```typescript
// Fallback: Check pipeline-state.json directly (G2 � bridge state may be cleared)
const pipelineStatePath = join(sessionPath, 'data', 'pipeline-state.json')
if (existsSync(pipelineStatePath)) {
  try {
    const raw = JSON.parse(readFileSync(pipelineStatePath, 'utf8'))
    const pauseCount = raw.events?.filter((e: { type: string }) => e.type === 'pause_requested').length ?? 0
    const resumeCount = raw.events?.filter((e: { type: string }) => e.type === 'resumed').length ?? 0
    if (pauseCount > resumeCount && raw.agentSlug) {
      const pausedStage = [...raw.events].reverse().find((e: { type: string }) => e.type === 'pause_requested')?.stage ?? -1
      return `<orchestrator_pipeline_paused agentSlug="${raw.agentSlug}" pausedAtStage="${pausedStage}" />`
    }
  } catch { /* malformed � skip */ }
}
```

- [x] This ensures `hasPausedPipeline` in `onProcessingStopped()` is true for queue hold even if bridge state was deleted
- [x] `pnpm run typecheck:all` � zero errors

### Phase 4: Diagnostic Logging `[2 files]` (G6)

**Goal:** Add structured logging at every detection and state-transition boundary for debugging.

**File: `packages/shared/src/agent/claude-agent.ts`**

- [x] `writeOrchestratorBridgeState()`: add `this.onDebug?.()` with `sessionPath`, `agentSlug`, `stage`, `runId`
- [x] `clearOrchestratorBridgeState()`: add `this.onDebug?.()` with path and whether file existed before deletion
- [x] `detectPausedOrchestrator()`: add debug log at entry (with sessionId), at primary detection (pipeline-state.json), at fallback detection (bridge state), and at null return
- [x] `processOrchestratorEvents()`: add debug log at function exit with `exitReason`

**File: `apps/electron/src/main/sessions.ts`**

- [x] `getPausedAgentResumeContext()`: add `sessionLog.debug()` at entry (sessionPath), at bridge-state-found (slug, stage), at pipeline-state-fallback (slug, stage), and at null-return
- [x] `onProcessingStopped()`: add `sessionLog.debug()` before `tryInjectAgentOutputFile` call indicating whether a paused pipeline was detected

- [x] `pnpm run typecheck:all` � zero errors
- [x] `pnpm run lint` � zero new errors

### Phase 5: Validation

- [x] `pnpm run typecheck:all` � zero errors
- [x] `pnpm run lint` � zero new errors
- [x] `pnpm run test` � all mock tests pass (23/23 orchestrator-flow-routing, 6/6 stage-gate, 4/4 session-validation, 6/6 stage0-pause)
- [x] Update E2E test `e2e-orchestrator-flow-routing.test.ts`:
  - Test: `processOrchestratorEvents` returns `'paused'` when inner generator yields `orchestrator_pause`
  - Test: `processOrchestratorEvents` returns `'completed'` when inner generator yields `orchestrator_complete`
  - Test: bridge state file survives after pause exit (exitReason = `'paused'`)
  - Test: bridge state file cleared after complete exit (exitReason = `'completed'`)
  - Test: `getPausedAgentResumeContext` returns marker from pipeline-state.json fallback when bridge state is missing
  - Test: `detectPausedOrchestrator` finds agent via `agentSlug` field in pipeline-state.json when bridge state is missing
- [ ] Manual live test: run ISA Deep Research agent, verify:
  - Stage 0 completes and pauses � bridge state file present in `data/agents/{slug}/`
  - User's follow-up message routes to orchestrator resume (not regular SDK query)
  - Remaining stages complete � bridge state file cleared
  - No console errors about MCP connection leaks

### Risks & Considerations

| Risk | Mitigation |
|---|---|
| `yield*` return value propagation requires TypeScript 5.x `AsyncGenerator<T, TReturn>` generics | Already on TS 5.x per stack rules; well-supported |
| Backward compat: old `pipeline-state.json` files lack `agentSlug` | `fromSnapshot()` defaults to `''`; bridge state fallback detection handles missing field |
| `exitReason` variable must survive across `generator.return()` + finally | JavaScript spec: `finally` runs in the same scope; `exitReason` is a closure variable set before yield |
| G8 reorder (write before yield) changes observable behavior | Bridge state is an internal file; write order is an implementation detail not visible to UI |
| Removing early bridge clear from `resumeOrchestrator` (G7) | Conditional clear in finally handles all exits; pipeline re-pause writes fresh bridge state |
| `getPausedAgentResumeContext` fallback duplicates `isPaused` logic | Minimal � 3 lines of filter/count logic. Importing `PipelineState` class into sessions.ts would create tighter coupling |

---

## Section 17: Web & Prior Reference Labels � Full Pipeline Wiring

### Goal

Bring `[W1]`, `[W2]` web-reference labels and `[P1]`, `[P2]` prior-research labels into the agentnative output, matching the gamma best-practice implementation. Currently the data exists in Stage 1 output but is never surfaced to the LLM synthesis prompt, never populated in `FinalAnswer`, and the renderer's existing `buildExternalReferences` / `buildPriorResearchReferences` functions are never called. This section addresses all 9 adversarial-review findings (F1�F9) plus the original 6 gaps (G1�G6).

### Analysis

#### Findings Summary

| ID | Description | Severity | Phase |
|----|-------------|----------|-------|
| F1 | `web_research_context` buried in opaque JSON inside `<STAGE_OUTPUT_CALIBRATION>` � LLM cannot reliably parse | P0 | 2 |
| F2 | `web_sources` list not enumerated with `[W1]` labels in synthesis context | P0 | 2 |
| F3 | BAML Stage 1 returns `{queries, calibration, webResults}` � different shape than Zod path, no `web_sources` key | P0 | 1 |
| F4 | `injectSourceBlocks()` only handles ISA citation regex � no WEB_REF/PRIOR_REF marker processing | P1 | 5 |
| F5 | BAML Stage 3 also uses `buildStageContext()` � resolved by Phase 2 context-builder fix | P1 | 2 |
| F6 | `runOutput()` never reads Stage 1 data, `FinalAnswer` always has undefined `webReferences`/`priorSections`/`followupNumber` | P0 | 1 |
| F7 | `config.json` and `config-loader.ts` missing `webReference` config section | P2 | 4 |
| F8 | No `escapeMd()` utility � pipe chars in URLs/titles break markdown tables | P2 | 5 |
| F9 | No blank `>` lines between source block entries � renders as single blockquote wall | P2 | 5 |

#### Key Files

| File | Role |
|------|------|
| `packages/shared/src/agent/orchestrator/stage-runner.ts` | Per-stage execution; `runOutput()` builds FinalAnswer; needs `extractWebReferences()` |
| `packages/shared/src/agent/orchestrator/context-builder.ts` | Assembles XML context for LLM; needs `<WEB_RESEARCH_CONTEXT>` section |
| `packages/session-tools-core/src/handlers/agent-render-output/renderer.ts` | Deterministic document assembly; needs marker post-processor |
| `packages/session-tools-core/src/handlers/agent-render-output/types.ts` | `WebReference`, `PriorSection`, `FinalAnswer`, `RenderConfig` types |
| `packages/session-tools-core/src/handlers/agent-render-output/config-loader.ts` | `DEFAULT_RENDER_CONFIG`; needs `webReference` defaults |
| `packages/session-tools-core/src/handlers/agent-render-output/markdown-formatters.ts` | Markdown utilities; needs `escapeMd` export |
| `agents/isa-deep-research/prompts/stage-3-synthesize.md` | Synthesis prompt; instructions 7, 12, 13, 14 need WEB_REF/PRIOR_REF format |
| `agents/isa-deep-research/config.json` | Agent config; needs `webReference` output section |
| `packages/shared/src/agent/orchestrator/baml-adapter.ts` | BAML Stage 3 path; receives context from `buildStageContext()` |
| `packages/shared/src/agent/types/baml-types.ts` | `WebsearchCalibrationOutput`; has no `web_sources` field (BAML shape) |

#### Gamma Reference Implementation

- **`output_renderer.py`**: Constructor builds `_web_ref_by_url` dict ? `render_answer_md()` assigns `[W1]`, `[W2]` labels via `web_label_map` ? `_inject_inline_excerpts()` post-processes WEB_REF/PRIOR_REF markers ? `_fuzzy_url_lookup()` handles domain-based fallback ? `_escape_md()` escapes pipes ? `_format_source_blocks()` adds blank `>` lines between entries
- **`stages.py`**: `_build_synthesis_prompt()` L2095�2320 has explicit `<WEB_RESEARCH_CONTEXT>` section with numbered `[W1] Title � url` list + narrative context + format instructions ("Use WEB_REF|<url>|<insight> markers") ? `FinalAnswer` assembly L2595�2730 populates `web_references=plan.web_references`, `followup_number=followup_number`

---

### Phase 1: Data Bridge � Extract Web References from Stage 1 (F3, F6)

**Goal**: Create helpers to extract web references and web research context from Stage 1 output, handling both Zod and BAML data shapes. Populate `FinalAnswer.webReferences` in `runOutput()`.

- [x] **1.1** Add `extractWebReferences(stageData: Record<string, unknown>): WebReference[]` helper in `stage-runner.ts`
  - Zod path: `stageData.websearch_calibration.web_sources` ? array of `{url, title, relevance_note, source_type, domain}`
  - BAML path: `stageData.webResults` ? array of `WebSearchResult` (`{title, url, snippet}`) � map `snippet` ? `insight`, default `sourceType` to `'web'`
  - Return empty array if neither path has data (graceful degradation)
  - Pattern reference: `pause-formatter.ts` `normalizeStage1Data()` handles same Zod/BAML branching

- [x] **1.2** Add `extractWebResearchContext(stageData: Record<string, unknown>): string` helper in `stage-runner.ts`
  - Zod path: `stageData.websearch_calibration.web_research_context` (string, ~2400 chars)
  - BAML path: `stageData.calibration.calibration_summary` (fallback � less detailed but available)
  - Return empty string if missing

- [x] **1.3** In `runOutput()` (~L674): Read calibration stage data from `this.pipelineState`, call `extractWebReferences()` and `extractWebResearchContext()`, populate `FinalAnswer`:
  ```
  webReferences: extractWebReferences(calibrationData),
  // followupNumber and priorSections deferred to Phase 7
  ```

- [x] **1.4** Add diagnostic logging: `logger.info('[StageRunner] extractWebReferences: found ${refs.length} web refs (path: ${path})')` where `path` is `'zod'` or `'baml'`

- [x] **1.5** Validate: `pnpm run typecheck:all && pnpm run lint`

---

### Phase 2: Context Builder � Surface Web Context to LLM (F1, F2, F5)

**Goal**: Add a structured `<WEB_RESEARCH_CONTEXT>` XML section to synthesis context so the LLM can see web sources with `[W1]`, `[W2]` labels and the narrative web research context. This fix applies to both Zod and BAML Stage 3 paths since both use `buildStageContext()`.

- [x] **2.1** Extend `BuildStageContextOptions` interface in `context-builder.ts`:
  ```ts
  webResearchContext?: string;    // narrative web research context
  webSources?: Array<{ url: string; title: string; insight: string; sourceType?: string }>;
  ```

- [x] **2.2** In `buildStageContext()`, after the `ISA_CONTEXT` section and before `REPAIR_FEEDBACK`, add:
  ```ts
  if (options.webSources?.length || options.webResearchContext) {
    const sourceList = (options.webSources ?? [])
      .map((s, i) => `[W${i + 1}] ${s.title} � ${s.url}\n    Insight: ${s.insight}`)
      .join('\n');
    const narrative = options.webResearchContext ?? '';
    sections.push(wrapXml('WEB_RESEARCH_CONTEXT', [
      sourceList ? `Sources:\n${sourceList}` : '',
      narrative ? `\nContext:\n${narrative}` : '',
    ].filter(Boolean).join('\n\n')));
  }
  ```

- [x] **2.3** In `stage-runner.ts` `runSynthesize()` (~L440 and ~L475): Pass extracted web data to `buildStageContext()`:
  ```ts
  const webSources = extractWebReferences(calibrationData);
  const webResearchContext = extractWebResearchContext(calibrationData);
  const context = buildStageContext({
    ...existingOptions,
    webSources,
    webResearchContext,
  });
  ```

- [x] **2.4** Add diagnostic logging: `logger.info('[ContextBuilder] WEB_RESEARCH_CONTEXT section: ${webSources.length} sources, ${webResearchContext.length} chars context')`

- [x] **2.5** Validate: `pnpm run typecheck:all && pnpm run lint`

---

### Phase 3: Synthesis Prompt � Explicit WEB_REF / PRIOR_REF Format (G3)

**Goal**: Rewrite synthesis prompt instructions to tell the LLM exactly how to emit web and prior reference markers that the renderer can post-process.

- [x] **3.1** In `agents/isa-deep-research/prompts/stage-3-synthesize.md`, rewrite **instruction 7** (sources blockquote) to include:
  ```
  When citing web sources, emit a marker: WEB_REF|<url>|<one-line insight>
  The renderer will replace these with formatted [W1], [W2] labels.
  Example: WEB_REF|https://example.com/report|Key finding on compliance rates
  ```

- [x] **3.2** Rewrite **instruction 12** to specify the exact PRIOR_REF marker format:
  ```
  When referencing prior research sections, emit: PRIOR_REF|<section_id>|<heading>|<brief excerpt>
  Example: PRIOR_REF|P1|Risk Assessment Framework|The framework identifies three tiers...
  ```

- [x] **3.3** Rewrite **instruction 13** to replace the vague "note authoritative sources in parentheses" with:
  ```
  For authoritative web sources, use the WEB_REF marker format described in instruction 7.
  Do NOT use parenthetical mentions � the renderer handles citation formatting.
  ```

- [x] **3.4** Rewrite **instruction 14** to align with the structured PRIOR_REF format from instruction 12

- [x] **3.5** Add a reference block at the bottom of the prompt listing the `[W#]` source labels from `<WEB_RESEARCH_CONTEXT>`:
  ```
  Use the [W#] labels from the <WEB_RESEARCH_CONTEXT> section above when citing web sources.
  ```

- [x] **3.6** Validate: `pnpm run typecheck:all && pnpm run lint`

---

### Phase 4: Config � Add `webReference` Configuration (F7)

**Goal**: Add `webReference` config section to types, defaults, and agent config.

- [x] **4.1** In `types.ts` (`RenderConfig` interface), add:
  ```ts
  webReference: {
    refFormat: string;       // e.g., '[W{num}]'
    linkToOriginal: boolean; // whether to hyperlink to source URL
  };
  ```

- [x] **4.2** In `config-loader.ts` `DEFAULT_RENDER_CONFIG`, add:
  ```ts
  webReference: {
    refFormat: '[W{num}]',
    linkToOriginal: true,
  },
  ```

- [x] **4.3** In `agents/isa-deep-research/config.json` under `output`, add:
  ```json
  "webReference": {
    "refFormat": "[W{num}]",
    "linkToOriginal": true
  }
  ```

- [x] **4.4** Validate: `pnpm run typecheck:all && pnpm run lint`

---

### Phase 5: Renderer � Marker Post-Processing & Formatting (F4, F8, F9, G2)

**Goal**: Add post-processing to replace WEB_REF/PRIOR_REF markers with formatted labels, add `escapeMd()`, improve source block spacing, enhance `buildExternalReferences` with `[W#]` labels.

- [x] **5.1** Add `escapeMd(text: string): string` to `markdown-formatters.ts`:
  ```ts
  export function escapeMd(text: string): string {
    return text.replace(/\|/g, '\\|');
  }
  ```

- [x] **5.2** Add `formatSourceBlockSpacing(block: string): string` to `markdown-formatters.ts`:
  - Insert blank `> ` lines between consecutive `> ` entries (gamma `_format_source_blocks` pattern)
  - Prevents multiple source blocks from rendering as one giant blockquote wall

- [x] **5.3** Add `injectWebAndPriorMarkers(body: string, webReferences: WebReference[], priorSections: PriorSection[], config: RenderConfig): string` in `renderer.ts`:
  - Regex: `/WEB_REF\|([^|]+)\|([^|\n]+)/g` ? look up URL in `webReferences`, assign `[W{i+1}]` label, replace with formatted citation
  - Regex: `/PRIOR_REF\|([^|]+)\|([^|]+)\|([^|\n]+)/g` ? match against `priorSections`, assign `[P{num}]` label
  - Build `webLabelMap: Map<string, string>` (url ? `[W1]`, `[W2]`, ...) for use by `buildExternalReferences`
  - Add `fuzzyUrlLookup(url: string, refs: WebReference[]): WebReference | undefined` helper � try exact match first, then domain-based fallback (gamma `_fuzzy_url_lookup` pattern)

- [x] **5.4** In `buildSynthesisBody()`, call `injectWebAndPriorMarkers()` on the full synthesis text BEFORE calling `splitIntoSections()`:
  ```ts
  let processed = injectWebAndPriorMarkers(synthesis, finalAnswer.webReferences ?? [], finalAnswer.priorSections ?? [], config);
  processed = formatSourceBlockSpacing(processed);
  const sections = splitIntoSections(processed);
  ```

- [x] **5.5** Enhance `buildExternalReferences()` to include `[W{i+1}]` labels and use `escapeMd()` for titles:
  ```ts
  const label = config.webReference.refFormat.replace('{num}', String(i + 1));
  const title = escapeMd(ref.title);
  lines.push(`- ${label} [${title}](${ref.url}) � ${ref.insight}`);
  ```

- [x] **5.6** Apply `escapeMd()` to `buildPriorResearchReferences()` headings

- [x] **5.7** Apply `formatSourceBlockSpacing()` to output of `injectSourceBlocks()` calls

- [x] **5.8** Validate: `pnpm run typecheck:all && pnpm run lint`

---

### Phase 6: Tests � Web Reference Pipeline Verification

**Goal**: Add tests covering the full web reference pipeline from extraction through rendering.

- [x] **6.1** Create `packages/session-tools-core/src/handlers/__tests__/e2e-web-ref-rendering.test.ts`

- [x] **6.2** Unit tests for `extractWebReferences()`:
  - Zod-shape input ? returns `WebReference[]` with correct fields
  - BAML-shape input ? maps `snippet` ? `insight`, sets `sourceType: 'web'`
  - Empty/missing data ? returns `[]`

- [x] **6.3** Unit tests for `extractWebResearchContext()`:
  - Zod-shape ? returns `web_research_context` string
  - BAML-shape ? returns `calibration_summary` fallback
  - Missing ? returns `''`

- [x] **6.4** Unit tests for `injectWebAndPriorMarkers()`:
  - Input with `WEB_REF|url|insight` ? replaced with `[W1]` formatted citation
  - Input with `PRIOR_REF|P1|heading|excerpt` ? replaced with `[P1]` formatted citation
  - Multiple markers ? correct sequential numbering
  - No markers ? text unchanged

- [x] **6.5** Unit tests for `fuzzyUrlLookup()`:
  - Exact URL match ? returns reference
  - Domain-only match ? returns reference
  - No match ? returns `undefined`

- [x] **6.6** Unit tests for `escapeMd()`:
  - Pipe chars escaped: `a|b` ? `a\|b`
  - No pipes ? unchanged

- [x] **6.7** Unit tests for `formatSourceBlockSpacing()`:
  - Consecutive `> ` lines ? blank `> ` line inserted between entries
  - Single entry ? unchanged

- [x] **6.8** Integration test: Full `renderDocument()` with populated `webReferences` ? output contains `[W1]`, `[W2]` labels in External References section

- [x] **6.9** Integration test: Full `renderDocument()` with populated `priorSections` ? output contains `[P1]`, `[P2]` labels in Prior Research section

- [x] **6.10** Run all tests: `pnpm run typecheck:all && pnpm run lint && npx tsx --test packages/session-tools-core/src/handlers/__tests__/e2e-web-ref-rendering.test.ts`

---

### Phase 7: Follow-Up Context System (G4, G5) [x] — Implemented in Section 18

**Goal**: Wire prior-research context from follow-up queries into `FinalAnswer.priorSections` and `followupNumber`. This is a larger scope feature matching gamma's `_load_prior_context` / `_parse_answer_sections` / `FollowUpContext` system.

**Implemented**: Section 18 provides the full follow-up context pipeline: `follow-up-context.ts` (loader + parser + hint builder), `answer.json` persistence, `previousSessionId` entry point, delta retrieval filtering, and pipeline wiring through all stages.

- [x] **7.1** Implement prior-context loading from previous session outputs
- [x] **7.2** Parse prior answer sections (split on `##`, assign P1/P2/... IDs, truncate)
- [x] **7.3** Populate `FinalAnswer.priorSections` and `FinalAnswer.followupNumber` in `runOutput()`
- [x] **7.4** Pass prior sections to synthesis context via `buildStageContext()`
- [x] **7.5** Add E2E test for follow-up chain with prior-research references

---

### Risks & Considerations

| Risk | Mitigation |
|------|------------|
| BAML Stage 1 has no `web_sources` field � only raw `webResults` | `extractWebReferences()` maps `WebSearchResult` to `WebReference` format with sensible defaults |
| LLM may not consistently emit `WEB_REF\|url\|insight` markers | Graceful degradation: if no markers found, no labels inserted; `buildExternalReferences` still lists all web sources |
| `fuzzyUrlLookup` domain matching may produce false positives | Only used as fallback after exact match fails; gamma has same behavior in production |
| Prompt changes affect all future runs | Prompt is versioned in git; old sessions retain their output |
| `escapeMd` only escapes pipes (matching gamma) | Sufficient for table contexts; other markdown escaping not needed per gamma evidence |
| Phase 7 deferred � no `[P#]` labels in output until follow-up system built | Renderer infrastructure is ready; Phase 3 prompt format is ready; only data population is missing |

### Testing Strategy

1. **TypeScript**: `pnpm run typecheck:all` after each phase
2. **Lint**: `pnpm run lint` after each phase
3. **Unit tests**: Phase 6 covers all new functions
4. **Integration**: Full `renderDocument()` test with populated data
5. **Manual**: Run live pipeline, verify `[W1]`/`[W2]` labels appear in output markdown
6. **Regression**: Existing 23 tests from Section 16 must continue to pass

---


---

## Section 18: Inline Labels + Full Follow-Up Context Pipeline

### Goal

Fix two problems identified after Section 17:

1. **Inline label embedding**: `[W1]`-`[W5]` and `[P1]`-`[P3]` labels appear as standalone afterthought lines instead of inline within prose sentences. Root cause: prompt instructions 7/13/14 explicitly forbid inline labels (`"NOT inline text"`, `"Do NOT use parenthetical mentions"`, `"Do NOT use bare [P#] text"`). Gamma's approach is the *opposite*: tell the LLM to write `[W1]`, `[P1]` directly in prose AND emit `WEB_REF|url|insight` markers in Sources blockquotes.

2. **Follow-up context pipeline**: No mechanism for loading prior research context into follow-up queries. Gamma has a 5-layer system (FollowUpContext loading -> section parsing -> decomposition awareness -> synthesis context -> renderer). Agentnative has none of these layers wired despite infrastructure being designed (`FollowUpConfig`, `followupNumber`, `followup_context_loaded` event type all exist but are never used).

### Analysis

#### Adversarial Review Findings (13 gaps)

| ID | Finding | Severity | Phase |
|----|---------|----------|-------|
| F1 | Anti-inline prompt directives must be **reversed** to pro-inline | Critical | 1 |
| F2 | Instructions 12/13/14 are static - gamma's are conditional on context presence | Critical | 1, 4 |
| F3 | Regex `.replace()` doesn't handle `> ` blockquote prefix in WEB_REF markers | Warning | 2 |
| F4 | WEB_REF output format diverges from gamma (bold vs italic, insight as link text) | Warning | 2 |
| F5 | PRIOR_REF has no excerpt rendering or blockquote formatting | Warning | 2 |
| F6 | `buildPriorResearchReferences()` shows ALL sections, not just referenced ones | Warning | 2 |
| F7 | No `<PRIOR_ANSWER>` section or prior context fields in context-builder | Critical | 4 |
| F8 | `PriorSection.sectionNum` (number) vs gamma `section_id` (string "P1") | Warning | 5 |
| F9 | No `answer.json` persistence - follow-up loading has nothing to read | Critical | 3 |
| F10 | No `prior_paragraph_ids` for retrieval delta filtering | Warning | 6 |
| F11 | No `prior_context_hint` wiring into Stage 0 decomposition | Warning | 5 |
| F12 | No `previousSessionId` in `OrchestratorOptions` - no entry point for follow-ups | Critical | 3 |
| F13 | Prior Answer Section Index not placed in context as XML section | Warning | 4 |

#### Architecture Decision: Conditional Instructions via Context Builder

**Problem**: `stage-3-synthesize.md` is a static file loaded once at startup. Gamma builds instructions 12/13/14 dynamically in Python. Static `.md` can't conditionally inject instructions.

**Solution**: Move instructions 12/13/14 OUT of the static prompt and INTO the `context-builder.ts` as XML-wrapped instruction sections. The context builder already dynamically assembles `<WEB_RESEARCH_CONTEXT>` - we add `<PRIOR_ANSWER_CONTEXT>` and `<SYNTHESIS_INSTRUCTIONS>` sections that appear only when the relevant data exists. The static prompt keeps a generic pointer: "Follow the conditional instructions in `<SYNTHESIS_INSTRUCTIONS>` below."

This mirrors gamma's pattern more faithfully: in gamma, the system prompt is built by `_build_synthesis_prompt()` which concatenates `_prior_ref_instruction + _web_label_instruction + _prior_label_instruction` - all computed at runtime.

#### Architecture Decision: Follow-Up Entry Point

**Problem**: No way to trigger a follow-up pipeline.

**Solution**: Add `previousSessionId?: string` to `OrchestratorOptions`. When set:
1. `AgentOrchestrator.run()` loads prior context from `sessions/<previousSessionId>/data/answer.json`
2. Parses prior answer into `PriorSection[]` via `parseAnswerSections()`
3. Builds `FollowUpContext` and threads it through Stage 0 (decomposition), Stage 1 (retrieval delta), Stage 3 (synthesis context), and Stage 5 (output)
4. The existing `FollowUpConfig` in agent config controls whether follow-ups are enabled and delta retrieval behavior

**Existing infrastructure to activate**: `FollowUpConfig` type, `followupNumber` in `AgentRunState`, `followup_context_loaded` event type, `followupTitleTemplate` in output config.

#### Key Files

| File | Role | Changes |
|------|------|---------|
| `agents/isa-deep-research/prompts/stage-3-synthesize.md` | Static synthesis prompt | Remove anti-inline directives; add generic `<SYNTHESIS_INSTRUCTIONS>` pointer |
| `packages/shared/src/agent/orchestrator/context-builder.ts` | XML context assembly | Add `<PRIOR_ANSWER_CONTEXT>`, `<SYNTHESIS_INSTRUCTIONS>` sections; extend interface |
| `packages/shared/src/agent/orchestrator/stage-runner.ts` | Per-stage dispatch | Save `answer.json`; load follow-up context; thread through stages |
| `packages/shared/src/agent/orchestrator/types.ts` | Orchestrator types | Add `FollowUpContext`, `previousSessionId` |
| `packages/shared/src/agent/orchestrator/index.ts` | Orchestrator factory | Thread `previousSessionId` -> follow-up context loading |
| `packages/session-tools-core/src/handlers/agent-render-output/renderer.ts` | Deterministic document assembly | Fix marker processing (line-by-line, blockquote, formatting) |
| `packages/session-tools-core/src/handlers/agent-render-output/types.ts` | Renderer types | Add `sectionId` string field to `PriorSection` |
| `packages/shared/src/agent/orchestrator/follow-up-context.ts` | **NEW** - Follow-up context loader | `loadFollowUpContext()`, `parseAnswerSections()`, `buildPriorContextHint()` |

#### Gamma Reference

| Gamma Function | Location | Agentnative Equivalent |
|----------------|----------|----------------------|
| `_parse_answer_sections()` | workflow.py:123-178 | `parseAnswerSections()` in new `follow-up-context.ts` |
| `_load_prior_context()` | workflow.py:312-492 | `loadFollowUpContext()` in new `follow-up-context.ts` |
| `_build_synthesis_prompt()` prior sections | stages.py:2131-2160 | `buildStageContext()` -> `<PRIOR_ANSWER_CONTEXT>` section |
| `_build_synthesis_prompt()` conditional instr. | stages.py:2259-2290 | `buildStageContext()` -> `<SYNTHESIS_INSTRUCTIONS>` section |
| `_decompose_with_llm()` prior_context_hint | stages.py:1374-1381 | `buildStageContext()` -> `<PRIOR_RESEARCH_CONTEXT>` section |
| `_inject_inline_excerpts()` | output_renderer.py:1633-1742 | `injectWebAndPriorMarkers()` rewrite (line-by-line) |
| Retrieval delta filtering | stages.py:1612-1624 | `runRetrieve()` -> filter `seenIds` from prior |

---

### Phase 1: Prompt Rewrite - Reverse Anti-Inline Directives (F1, F2 partial)

**Goal**: Fix the root cause. The LLM must write `[W1]`, `[P1]` **directly in prose** AND emit `WEB_REF`/`PRIOR_REF` markers in Sources blockquotes. Remove all "NOT inline" directives.

- [x] **1.1** In `stage-3-synthesize.md`, rewrite **instruction 7** (Sources blockquote):
  ```
  7. **Sources blockquote after each section.** After each `##` section:
     > **Sources**
     > *ISA 540.13: "verbatim text..."*
     > WEB_REF|<url>|<key insight>
     > PRIOR_REF|<section_id>|<heading>|<relevant excerpt>
     
     Place ISA sources first, then PRIOR_REF markers, then WEB_REF markers.
     When referencing web sources in your BODY TEXT, include the label [W1], [W2] etc.
     inline near the claim it supports. Labels are assigned in the order sources
     appear in <WEB_RESEARCH_CONTEXT>.
  ```

- [x] **1.2** **Remove** instructions 12, 13, 14 entirely from the static prompt. These will be injected conditionally by the context builder (Phase 4). Replace with a single instruction:
  ```
  12. **Conditional instructions.** Follow any additional formatting instructions provided
      in the `<SYNTHESIS_INSTRUCTIONS>` section of the context below. These are injected
      dynamically based on the available context (web research, prior answer, etc.).
  ```

- [x] **1.3** Renumber remaining instructions (15 -> 13, 16 -> 14) to maintain clean numbering.

- [x] **1.4** Validate: `pnpm run typecheck:all && pnpm run lint`

---

### Phase 2: Renderer Fixes - Marker Processing + Formatting (F3, F4, F5, F6)

**Goal**: Rewrite `injectWebAndPriorMarkers()` to use line-by-line processing with `> ` prefix stripping (gamma pattern), fix WEB_REF/PRIOR_REF output formats, and filter `buildPriorResearchReferences()` to only show referenced sections.

- [x] **2.1** Rewrite `injectWebAndPriorMarkers()` in `renderer.ts` to use **line-by-line** processing:
  ```ts
  export function injectWebAndPriorMarkers(
    body: string, webReferences: WebReference[],
    priorSections: PriorSection[], config: RenderConfig,
  ): string {
    const lines = body.split('\n');
    const output: string[] = [];
    const webLabelMap = new Map<string, number>();
    let nextWebIdx = 1;
    
    for (const rawLine of lines) {
      // Strip blockquote prefix for matching, then re-emit in output
      const inBlockquote = rawLine.startsWith('> ');
      const line = inBlockquote ? rawLine.slice(2) : rawLine;
      
      if (line.startsWith('WEB_REF|')) {
        // Process WEB_REF marker -> formatted blockquote line
        const processed = processWebRefLine(line, webReferences, webLabelMap, nextWebIdx, config);
        nextWebIdx = processed.nextIdx;
        output.push(`> ${processed.text}`);
      } else if (line.startsWith('PRIOR_REF|')) {
        // Process PRIOR_REF marker -> blockquote with heading + excerpt
        const processed = processPriorRefLine(line, priorSections, config);
        output.push(...processed.lines.map(l => `> ${l}`));
      } else {
        output.push(rawLine); // Leave non-marker lines unchanged (incl. inline [W1] labels)
      }
    }
    return output.join('\n');
  }
  ```

- [x] **2.2** Add `processWebRefLine()` helper - matches gamma's italic blockquote style:
  ```ts
  // Input: WEB_REF|https://example.com|Key insight
  // Output: *[W1] [Page Title](url): "Key insight"*
  ```
  - Look up URL in webReferences for title; fallback to domain name
  - Assign sequential `[W{n}]` label via `webLabelMap`

- [x] **2.3** Add `processPriorRefLine()` helper - matches gamma's blockquote excerpt style:
  ```ts
  // Input: PRIOR_REF|P1|Risk Assessment|The framework identifies...
  // Output lines:
  //   *From prior research - Risk Assessment [P1]*
  //   *The framework identifies...*
  ```
  - Returns 2-line array for blockquote rendering with heading + excerpt

- [x] **2.4** In `buildPriorResearchReferences()`, filter to only show **referenced** sections:
  ```ts
  function buildPriorResearchReferences(
    sections: PriorSection[], config: RenderConfig, answerBody: string,
  ): string {
    // Scan answer body for [P1], [P2] etc.
    const referencedNums = new Set(
      [...answerBody.matchAll(/\[P(\d+)\]/g)].map(m => parseInt(m[1], 10))
    );
    const filtered = sections.filter(s => referencedNums.has(s.sectionNum));
    if (!filtered.length) return '';
    // ... render filtered sections
  }
  ```

- [x] **2.5** Update `renderDocument()` to pass `answerBody` to `buildPriorResearchReferences()` for filtering.

- [x] **2.6** Validate: `pnpm run typecheck:all && pnpm run lint`

---

### Phase 3: Answer Persistence + Entry Point (F9, F12)

**Goal**: Save `answer.json` alongside `answer.md` in `runOutput()`, and add `previousSessionId` to `OrchestratorOptions` so the follow-up pipeline can be triggered.

- [x] **3.1** In `stage-runner.ts` `runOutput()`, after writing `answer.md`, also write `answer.json`:
  ```ts
  // Save machine-readable answer for follow-up context loading
  const answerJson = {
    answer: finalAnswer.synthesis,
    original_query: finalAnswer.originalQuery,
    followup_number: finalAnswer.followupNumber ?? 0,
    citations: finalAnswer.citations.map(c => ({
      source_ref: c.sourceRef,
      claim: c.claim,
      paragraph_id: c.sourceRef, // Use sourceRef as paragraph_id
    })),
    sub_queries: finalAnswer.subQueries.map(sq => ({
      text: sq.query,
      role: sq.role,
      standards: sq.standards,
    })),
    depth_mode: finalAnswer.depthMode,
    web_references: finalAnswer.webReferences ?? [],
  };
  const dataDir = join(this.sessionPath, 'data');
  mkdirSync(dataDir, { recursive: true });
  const jsonPath = join(dataDir, 'answer.json');
  writeFileSync(jsonPath, JSON.stringify(answerJson, null, 2), 'utf-8');
  ```

- [x] **3.2** Add `previousSessionId?: string` to `OrchestratorOptions` in `types.ts`:
  ```ts
  export interface OrchestratorOptions {
    sessionId: string;
    sessionPath: string;
    getAuthToken: () => Promise<string>;
    onStreamEvent?: (event: StreamEvent) => void;
    onDebug?: (message: string) => void;
    /** Session ID of a prior completed research run for follow-up context. */
    previousSessionId?: string;
  }
  ```

- [x] **3.3** Add `FollowUpContext` interface to `types.ts`:
  ```ts
  export interface FollowUpContext {
    followupNumber: number;
    priorAnswerText: string;
    priorQuery: string;
    priorSubQueries: Array<{ text: string; role: string; standards: string[] }>;
    priorParagraphIds: string[];
    priorSections: PriorSection[];  // Reuse from session-tools-core types
  }
  ```

- [x] **3.4** Validate: `pnpm run typecheck:all && pnpm run lint`

---

### Phase 4: Context Builder - Conditional Instructions + Prior Answer (F2 complete, F7, F13)

**Goal**: Extend the context builder to dynamically inject `<PRIOR_ANSWER_CONTEXT>`, `<PRIOR_RESEARCH_CONTEXT>`, and `<SYNTHESIS_INSTRUCTIONS>` XML sections. Instructions about `[W#]` inline labels only appear when web context exists; instructions about `[P#]` labels only appear when prior context exists.

- [x] **4.1** Extend `BuildStageContextOptions` in `context-builder.ts`:
  ```ts
  /** Prior answer text for follow-up synthesis. */
  priorAnswerText?: string;
  /** Parsed prior answer sections with P1/P2 IDs. */
  priorSections?: Array<{ sectionId: string; heading: string; excerpt: string }>;
  /** Follow-up number (1 = first follow-up, 2 = second, etc.). */
  followupNumber?: number;
  /** Prior research context hint for decomposition awareness. */
  priorContextHint?: string;
  ```

- [x] **4.2** Add `<PRIOR_ANSWER_CONTEXT>` section builder (after `<WEB_RESEARCH_CONTEXT>`):
  ```ts
  if (options.priorAnswerText) {
    const sectionIndex = (options.priorSections ?? [])
      .map(ps => `- **[${ps.sectionId}] ${ps.heading}**: ${ps.excerpt}`)
      .join('\n');
    const parts = [
      'The user asked a follow-up question. Build on this prior answer,',
      'avoid repeating the same content, and focus on new aspects.',
      sectionIndex ? `\n### Prior Answer Section Index\n${sectionIndex}` : '',
      `\n### Prior Answer\n${options.priorAnswerText}`,
    ].filter(Boolean);
    sections.push(wrapXml('PRIOR_ANSWER_CONTEXT', parts.join('\n')));
  }
  ```

- [x] **4.3** Add `<PRIOR_RESEARCH_CONTEXT>` section for Stage 0 decomposition awareness (F11):
  ```ts
  if (options.priorContextHint) {
    sections.push(wrapXml('PRIOR_RESEARCH_CONTEXT', 
      'The user is asking a follow-up question. Use this context to avoid ' +
      'repeating previously explored topics and focus on new or deeper aspects:\n\n' +
      options.priorContextHint
    ));
  }
  ```

- [x] **4.4** Add `<SYNTHESIS_INSTRUCTIONS>` section builder - assembles conditional instructions:
  ```ts
  if (options.stageName === 'synthesize') {
    const conditionalInstructions: string[] = [];
    
    if (options.webSources?.length || options.webResearchContext) {
      conditionalInstructions.push(
        'WEB LABEL INSTRUCTION: When referencing web sources in body text, ' +
        'include the label [W1], [W2], etc. inline near the relevant claim. ' +
        'Labels are assigned sequentially in the order web sources appear in ' +
        'the <WEB_RESEARCH_CONTEXT> section above.'
      );
    }
    
    if (options.priorSections?.length) {
      conditionalInstructions.push(
        'PRIOR REF INSTRUCTION: When referencing information from the prior ' +
        'research answer, use the PRIOR_REF marker format on its own line in ' +
        'the Sources block:\n' +
        '> PRIOR_REF|<section_id>|<heading>|<relevant excerpt>\n' +
        'Place PRIOR_REF markers AFTER ISA sources but BEFORE web sources. ' +
        'Also include the label [P1], [P2], etc. inline near the relevant claim ' +
        'in body text - labels correspond to section IDs in the Prior Answer ' +
        'Section Index above.'
      );
    }
    
    if (conditionalInstructions.length) {
      sections.push(wrapXml('SYNTHESIS_INSTRUCTIONS', 
        conditionalInstructions.join('\n\n')
      ));
    }
  }
  ```

- [x] **4.5** In `context-builder.ts`, add `<WEB_RESEARCH_CONTEXT>` inline label instruction to the existing section:
  ```ts
  // Add to the existing WEB_RESEARCH_CONTEXT section narrative:
  // "When you reference a web source in your body text, include its label
  //  [W1], [W2] etc. inline near the claim it supports."
  ```

- [x] **4.6** Validate: `pnpm run typecheck:all && pnpm run lint`

---

### Phase 5: Follow-Up Context Loader (F8, F11, new module)

**Goal**: Create `follow-up-context.ts` - loads prior answer data, parses sections, builds context hint. Mirrors gamma's `_load_prior_context()` and `_parse_answer_sections()`.

- [x] **5.1** Create `packages/shared/src/agent/orchestrator/follow-up-context.ts` with:
  ```ts
  export function parseAnswerSections(answerText: string): PriorSection[]
  ```
  - Split on `## ` headings (not `###` or `#`)
  - Filter out metadata headings: "Original Question", "Verification Summary", "Citations Used", "External Good Practice References", "Appendix: Research Decomposition", "Out-of-Scope Notes"
  - Assign sequential `sectionNum` (1, 2, 3...) and `sectionId` ("P1", "P2", "P3"...)
  - Truncate excerpt to 500 chars at word boundary

- [x] **5.2** Add `PriorSection` type update - add optional `sectionId: string` to the existing `PriorSection` interface in `types.ts` (session-tools-core). Keep `sectionNum: number` for backward compat.

- [x] **5.3** Add `loadFollowUpContext()` function:
  ```ts
  export function loadFollowUpContext(
    workspaceRoot: string,
    previousSessionId: string,
  ): FollowUpContext | null
  ```
  - Read `sessions/<previousSessionId>/data/answer.json`
  - Parse JSON -> extract `answer`, `original_query`, `followup_number`, `citations`, `sub_queries`
  - Call `parseAnswerSections()` on the answer text
  - Extract `prior_paragraph_ids` from citations
  - Return `FollowUpContext` with `followupNumber: prevFollowupNumber + 1`

- [x] **5.4** Add `buildPriorContextHint()` function:
  ```ts
  export function buildPriorContextHint(ctx: FollowUpContext): string
  ```
  - Build hint string: follow-up number, prior query, prior sub-queries (max 5)
  - Used by Stage 0 decomposition to avoid repeating prior work

- [x] **5.5** Validate: `pnpm run typecheck:all && pnpm run lint`

---

### Phase 6: Pipeline Wiring - Thread Follow-Up Context Through Stages (F10, F11, F12)

**Goal**: Wire `FollowUpContext` from the orchestrator entry point through all stages that need it: Stage 0 (decomposition awareness), Stage 2 (retrieval delta), Stage 3 (synthesis context), Stage 5 (output).

- [x] **6.1** In `AgentOrchestrator.run()` (`index.ts`), if `previousSessionId` is set:
  ```ts
  async *run(userMessage: string, agentConfig: AgentConfig): AsyncGenerator<OrchestratorEvent> {
    const followUpCtx = this.previousSessionId
      ? loadFollowUpContext(this.workspaceRoot, this.previousSessionId)
      : null;
    if (followUpCtx) {
      yield { type: 'followup_context_loaded', ...followUpCtx };
    }
    const state = PipelineState.create(this.sessionId, agentConfig.slug);
    yield* this.executePipeline(state, userMessage, agentConfig, 0, followUpCtx);
  }
  ```
  - Need to thread `followUpCtx` to `executePipeline()` -> `stageRunner.runStage()`

- [x] **6.2** Extend `StageRunner.runStage()` to accept optional `FollowUpContext`:
  ```ts
  async runStage(
    stage: StageConfig, state: PipelineState,
    userMessage: string, agentConfig: AgentConfig,
    followUpContext?: FollowUpContext | null,
  ): Promise<StageResult>
  ```

- [x] **6.3** In `runAnalyzeQuery()` (Stage 0), pass `priorContextHint` to context builder:
  ```ts
  const priorContextHint = followUpContext
    ? buildPriorContextHint(followUpContext) : undefined;
  const userContent = buildStageContext({
    ...existingOptions,
    priorContextHint,
  });
  ```

- [x] **6.4** In `runRetrieve()` (Stage 2), add delta filtering when `followUpContext.priorParagraphIds` exists and agent config `followUp.deltaRetrieval` is true:
  ```ts
  // After dedup by paragraph ID, also filter out prior paragraphs
  if (followUpContext?.priorParagraphIds?.length && agentConfig.followUp?.deltaRetrieval) {
    const priorSet = new Set(followUpContext.priorParagraphIds);
    allParagraphs = allParagraphs.filter(p => !priorSet.has(p.id));
  }
  ```

- [x] **6.5** In `runSynthesize()` (Stage 3), pass prior answer context to context builder:
  ```ts
  const context = buildStageContext({
    ...existingOptions,
    priorAnswerText: followUpContext?.priorAnswerText,
    priorSections: followUpContext?.priorSections?.map(ps => ({
      sectionId: ps.sectionId, heading: ps.heading, excerpt: ps.excerpt,
    })),
    followupNumber: followUpContext?.followupNumber,
  });
  ```

- [x] **6.6** In `runOutput()` (Stage 5), populate `FinalAnswer.priorSections` and `followupNumber`:
  ```ts
  const finalAnswer: FinalAnswer = {
    ...existingFields,
    priorSections: followUpContext?.priorSections?.map(ps => ({
      sectionNum: ps.sectionNum, sectionId: ps.sectionId,
      heading: ps.heading, excerpt: ps.excerpt,
    })),
    followupNumber: followUpContext?.followupNumber,
  };
  ```

- [x] **6.7** In `claude-agent.ts` `runOrchestrator()`, pass `previousSessionId` through to `OrchestratorOptions`. Auto-detect via same-session `answer.json` check, gated by `followUp.enabled`. *(Implemented in Section 21 — `resolveFollowUpSessionId()` method)*

- [x] **6.8** Validate: `pnpm run typecheck:all && pnpm run lint`

---

### Phase 7: Tests - Full Pipeline Verification

**Goal**: Add comprehensive tests covering inline label embedding, follow-up context loading, prior section parsing, and renderer fixes.

- [x] **7.1** Unit tests for `parseAnswerSections()`:
  - Markdown with 5 `##` sections -> parses 5 `PriorSection` structs
  - Filters out "Verification Summary", "Citations Used" metadata headings
  - Truncates excerpts to 500 chars at word boundary
  - Empty input -> empty array

- [x] **7.2** Unit tests for `loadFollowUpContext()`:
  - Valid `answer.json` -> returns `FollowUpContext` with correct fields
  - Missing `answer.json` -> returns null
  - Malformed JSON -> returns null (graceful degradation)
  - `followupNumber` increments by 1 from prior

- [x] **7.3** Unit tests for `buildPriorContextHint()`:
  - Includes follow-up number, prior query, prior sub-queries
  - Limits to 5 sub-queries

- [x] **7.4** Unit tests for rewritten `injectWebAndPriorMarkers()`:
  - `> WEB_REF|url|insight` inside blockquote -> `> *[W1] [Title](url): "insight"*`
  - `> PRIOR_REF|P1|heading|excerpt` -> `> *From prior research - heading [P1]*` + `> *excerpt*`
  - Inline `[W1]`, `[P1]` labels in body text -> **left untouched** (plain text)
  - Lines without markers -> passed through unchanged

- [x] **7.5** Unit tests for `buildPriorResearchReferences()` filtering:
  - Body with `[P1]` and `[P3]` -> only sections 1 and 3 in footer
  - Body with no `[P#]` references -> empty string (no section rendered)

- [x] **7.6** Integration test: `renderDocument()` with `priorSections` + synthesis body containing `[P1]` and `PRIOR_REF|P1|...` markers -> output has both inline labels AND formatted blockquote markers

- [x] **7.7** Integration test: `renderDocument()` with `webReferences` + synthesis body containing `[W1]` inline AND `> WEB_REF|url|insight` markers -> output has inline labels preserved AND blockquote markers formatted

- [x] **7.8** Test `answer.json` persistence: mock `runOutput()` -> verify `data/answer.json` written with correct structure

- [x] **7.9** Run full test suite: `pnpm run typecheck:all && pnpm run lint && npx tsx --test packages/session-tools-core/src/handlers/__tests__/*.test.ts`

---

### Risks & Considerations

| Risk | Mitigation |
|------|------------|
| LLM may not consistently write inline `[W1]` labels despite prompt instructions | Graceful degradation: if no inline labels appear, markers in Sources blockquotes still produce the External References section. Live testing required. |
| Static prompt / context-builder split creates two places to maintain instructions | Document the split in prompt file comments: "Instructions 12+ are injected by context-builder.ts" |
| `answer.json` format changes may break follow-up loading | Include `version` field in answer.json; loader validates known versions |
| Prior session auto-detection may pick wrong session | Only match sessions with same agent slug + completed pipeline state + answer.json present |
| `PriorSection` type gains `sectionId` field - backward compat | Field is optional, existing code that uses `sectionNum` continues to work |
| Delta retrieval may filter too aggressively for follow-ups | Gated behind `followUp.deltaRetrieval` config (already exists, default true) |
| Line-by-line marker processing is more complex than regex | Better tested, handles blockquote context correctly, matches gamma's production pattern |

### Testing Strategy

1. **TypeScript**: `pnpm run typecheck:all` after each phase
2. **Lint**: `pnpm run lint` after each phase
3. **Unit tests**: Phase 7 covers all new/changed functions
4. **Existing tests**: 151 tests from Sections 16-17 must continue to pass
5. **Integration**: Full `renderDocument()` tests with both web AND prior data
6. **Manual**: Run live pipeline, verify:
   - `[W1]` labels appear **inline in sentences**, not standalone
   - `WEB_REF` markers in Sources blocks become formatted blockquotes
   - Follow-up query: prior sections appear in Prior Research References
   - Follow-up query: `[P1]` labels appear inline in sentences


---

## Section 20: Stage 1 Websearch Calibration Pipeline Fixes

### Goal

Fix 4 interrelated bugs in the Stage 1 websearch calibration pipeline that cause follow-up queries (and "No web search" responses) to produce truncated JSON, hallucinated web sources, and unreadable fallback output. Plan incorporates adversarial review findings F1-F9.

### Analysis

**Root Cause Chain:**
1. **Bug 1 — Skip routing missing**: User's "No web search" from Stage 0 pause enters `resume()` → `executePipeline(startStageIndex=1)`. Stage 1 is in `pauseAfterStages`, so it hits the pause-after branch which calls `runStage()` unconditionally. No intent parsing, no skip path, no early exit.
2. **Bug 2 — Token truncation**: Config sets `perStageDesiredTokens.1: 8192`. Stage 1 JSON exceeds this, truncated mid-string. `extractRawJson()` returns `null`.
3. **Bug 3 — LLM hallucination**: When `webResults = []`, no `<WEB_SEARCH_RESULTS>` section appended. Prompt says "Refine using web search results" → LLM fabricates 5 URLs.
4. **Bug 4 — Display fallback**: `normalizeStage1Data()` looks for `data['websearch_calibration']` or `data['calibration']`. When `extractRawJson` returns null, data becomes `{ rawText: ..., webResults: [] }` → neither key → `buildFallbackMessage()`.

**Adversarial Review Findings (F1-F9) Integration:**

| Finding | Issue | Resolution |
|---------|-------|------------|
| F1 | `resumeOrchestrator()` never passes `previousSessionId` → follow-up context unreachable | Store `previousSessionId` in `PipelineState` (persists across all resumes) |
| F2 | `resume()` starts at `pausedStage+1` which hits pause-after branch — skip must intercept before `runStage()` | Skip intercept placed inside `executePipeline` BEFORE pause-after and normal-run branches |
| F3 | Skip signal not threaded from `resume()` → `executePipeline()` | New `skipStages` set parameter threaded from `resume()` → `executePipeline()` |
| F4 | Double-resume (Stage 1→2) — followUpContext lost on second resume | `PipelineState` stores `previousSessionId`; `resume()` reloads followUpContext from it on every resume |
| F5 | `previousSessionId` not persisted in `PipelineState` | New `previousSessionId` field on `PipelineState` + `PipelineStateSnapshot` + constructor/create/fromSnapshot |
| F6 | `parseResumeIntent()` regex is fragile | Conservative matching, default-to-run fallback, only active at Stage 0→1 boundary |
| F7 | `repairTruncatedJson()` produces valid but semantically empty JSON | **Dropped** — token limit increase is the real fix; truncation detection is diagnostic-only |
| F8 | BAML early-return synthetic result may not match type shape | Guard moved from `callBamlStage1` to `runWebsearchCalibration()` — returns proper `StageResult` shape |
| F9 | `userMessage` carries resume text on resume, not original query | Documented non-issue — later stages read from `state.getStageOutput(0)`, not `userMessage` |

**Key Files:**

| File | Role | Findings |
|------|------|----------|
| `packages/shared/src/agent/orchestrator/pipeline-state.ts` | State persistence — add `previousSessionId` field | F1, F4, F5 |
| `packages/shared/src/agent/orchestrator/index.ts` | `resume()` + `executePipeline()` — intent parsing, skip threading, followUpContext reload | F2, F3, F4 |
| `packages/shared/src/agent/orchestrator/stage-runner.ts` | `runWebsearchCalibration()` — empty webResults guard | Bug 3, F8 |
| `agents/isa-deep-research/config.json` | Token limit `perStageDesiredTokens.1` | Bug 2 |
| `agents/isa-deep-research/prompts/stage-1-websearch-calibration.md` | Prompt anti-hallucination clause | Bug 3 |
| `packages/shared/src/agent/orchestrator/json-extractor.ts` | Truncation detection (diagnostic only) | Bug 2, F7 |
| `packages/shared/src/agent/orchestrator/pause-formatter.ts` | `normalizeStage1Data()` rawText fallback + skipped path | Bug 4 |
| `packages/shared/src/agent/orchestrator/types.ts` | `PipelineStateSnapshot` type extension | F5 |

### Phase 1: PipelineState — Persist `previousSessionId` (F1, F4, F5)

**Rationale**: Core architectural fix. `previousSessionId` must survive across all resume boundaries. By persisting it in `PipelineState`, every `resume()` call can reload `followUpContext` from disk without the caller needing to know about it.

- [x] **1a.** In `pipeline-state.ts`:
  - Add `readonly previousSessionId?: string` field to `PipelineState` class
  - Add `previousSessionId?: string` to `PipelineStateSnapshot` interface
  - Update private constructor to accept `previousSessionId` parameter (after `agentSlug`)
  - Update `PipelineState.create()` to accept optional `previousSessionId`
  - Update `addEvent()` and `setStageOutput()` to carry `previousSessionId` in new instances
  - Update `toSnapshot()` to include `previousSessionId` (if present)
  - Update `fromSnapshot()` to read `previousSessionId` from snapshot
- [x] **1b.** In `index.ts` `run()` method:
  - Pass `this.previousSessionId` to `PipelineState.create(sessionId, agentSlug, previousSessionId)`
  - Ensures `previousSessionId` is persisted in pipeline-state.json from first checkpoint
- [x] **1c.** Validate: `pnpm run typecheck:all && pnpm run lint`

### Phase 2: Resume Intent Parsing & Skip Threading (F2, F3, F6)

**Rationale**: When user responds "No web search" after Stage 0 pause, `resume()` must detect skip intent and thread it to `executePipeline` so the Stage 1 skip happens BEFORE `runStage()` in the pause-after branch.

- [x] **2a.** Create `parseResumeIntent()` helper in `index.ts`:
  - Only parses skip intent at Stage 0→1 boundary (`pausedAtStage !== 0` → `skipNextStage: false`)
  - Conservative regex patterns: `^b\.?\s`, `\bno\b.*\bweb\s*search`, `\bproceed\s+directly`, `\bskip\b.*\bweb`, `^no[,.]?\s*proceed`
  - **Default-to-run** (F6): If no pattern matches, `skipNextStage` is `false` → Stage 1 runs normally
- [x] **2b.** In `resume()`, call `parseResumeIntent(userResponse, pausedStage)` and build `skipStages` set:
  - `const skipStages = skipNextStage ? new Set([pausedStage + 1]) : new Set<number>()`
  - Thread into `executePipeline()` call
- [x] **2c.** Add `skipStages?: ReadonlySet<number>` parameter to `executePipeline()` signature (default `new Set()`)
- [x] **2d.** In `executePipeline()` for-loop, add skip intercept BEFORE BOTH the pause-after branch AND the normal-run branch:
  - If `skipStages.has(stage.id)`:
    - Produce synthetic "skipped" `StageResult` with `websearch_calibration: { skipped: true }` and pass-through Stage 0 queries
    - Record stage_completed event, save to disk, yield stage_complete
    - `continue` to next stage in for-loop (skips entire pause-after / normal-run branches — addresses F2)
- [x] **2e.** Validate: `pnpm run typecheck:all && pnpm run lint`

### Phase 3: FollowUpContext Reload on Resume (F1, F4)

**Rationale**: `resume()` is called for every user interaction (Stage 0→1, Stage 1→2). Each time, a new `AgentOrchestrator` is created, and `followUpContext` must be available for all downstream stages.

- [x] **3a.** In `resume()` in `index.ts`, after loading `PipelineState`:
  - Check `state.previousSessionId`
  - If present, call `loadFollowUpContext(sessionsDir, state.previousSessionId)` to reload context
  - Log via `onDebug`
- [x] **3b.** Thread `followUpContext` into `yield* this.executePipeline(...)` call in `resume()` (currently the 5th param is not passed)
- [x] **3c.** Validate: `pnpm run typecheck:all && pnpm run lint`

### Phase 4: Token Limit & Truncation Detection (Bug 2, F7)

**Rationale**: Token limit is the root cause of truncation. Repair (F7) is dropped — produces semantically incomplete results worse than fallback. Diagnostic-only truncation detection added.

- [x] **4a.** In `agents/isa-deep-research/config.json`, increase `perStageDesiredTokens.1` from `8192` to `24576`
- [x] **4b.** In `runWebsearchCalibration()` Zod path (`stage-runner.ts`), after `extractRawJson()` returns null, add truncation warning:
  - Check `result.usage.outputTokens >= desiredTokens * 0.95`
  - Log diagnostic: `Stage 1 likely truncated: outputTokens=X >= 95% of desiredTokens=Y`
  - No repair attempt (F7 — diagnostic only)
- [x] **4c.** Validate: `pnpm run typecheck:all && pnpm run lint`

### Phase 5: Empty Web Results Guard & Prompt Fix (Bug 3, F8)

**Rationale**: When no web search results exist, the LLM must not fabricate sources. Code-level guard + prompt-level instruction.

- [x] **5a.** In `runWebsearchCalibration()` (`stage-runner.ts`), add early-return guard BEFORE both BAML and Zod paths:
  - If `webResults.length === 0`: return `StageResult` with `websearch_calibration: { skipped: true, ... }` + pass-through Stage 0 queries
  - Proper `StageResult` shape — not a fake BAML type (addresses F8)
- [x] **5b.** In the Zod path, change empty `webContext` to include explicit anti-hallucination notice:
  - `'No web search results were available. Do NOT fabricate or hallucinate web sources. Set skipped: true.'`
  - Defense-in-depth (Phase 5a guard means this path is only reached when `webResults.length > 0`)
- [x] **5c.** Update `agents/isa-deep-research/prompts/stage-1-websearch-calibration.md`:
  - Add "When No Web Search Results Are Available" section after Requirements
  - Explicit instructions: set `skipped: true`, `web_sources: []`, pass through Stage 0 queries unchanged
  - Anti-hallucination: "NEVER fabricate, hallucinate, or invent web source URLs"
- [x] **5d.** Validate: `pnpm run typecheck:all && pnpm run lint`

### Phase 6: Display Fallback Robustness (Bug 4)

**Rationale**: `normalizeStage1Data()` must handle 3 data shapes: (a) normal Zod/BAML result, (b) skipped result, (c) rawText fallback from failed JSON extraction.

- [x] **6a.** In `normalizeStage1Data()` (`pause-formatter.ts`), add skipped-calibration path at the top:
  - Check `data['websearch_calibration']?.['skipped'] === true` or `data['skipped'] === true`
  - Return `NormalizedCalibration` with `skipped: true`, empty arrays, `queryPlanRefined: false`
- [x] **6b.** Add rawText recovery path at the end (before final `return null`):
  - Extract `data['rawText']` as string
  - If present, attempt `extractRawJson(rawText)` to recover wrapped JSON
  - On success, recursively call `normalizeStage1Data()` on recovered data
- [x] **6c.** In `formatStage1PauseMessage()`, handle `cal.skipped` case:
  - Display "Web Search Calibration — SKIPPED" header
  - Message: "Web search was skipped — proceeding with the Stage 0 query plan."
  - Go straight to proceed prompt
- [x] **6d.** Validate: `pnpm run typecheck:all && pnpm run lint`

### Phase 7: Tests

- [x] **7a.** Create `packages/shared/src/agent/orchestrator/__tests__/pipeline-state-previous-session.test.ts`:
  - `PipelineState.create()` with `previousSessionId` persists it
  - `toSnapshot()` / `fromSnapshot()` round-trip preserves `previousSessionId`
  - `addEvent()` and `setStageOutput()` carry `previousSessionId` to new instances
  - Missing `previousSessionId` defaults to `undefined` (backward compat)
- [x] **7b.** Create `packages/shared/src/agent/orchestrator/__tests__/resume-skip-routing.test.ts`:
  - `parseResumeIntent("B. No — proceed directly", 0)` → `skipNextStage: true`
  - `parseResumeIntent("b", 0)` → `skipNextStage: true`
  - `parseResumeIntent("no web search please", 0)` → `skipNextStage: true`
  - `parseResumeIntent("skip web", 0)` → `skipNextStage: true`
  - `parseResumeIntent("Yes search", 0)` → `skipNextStage: false`
  - `parseResumeIntent("proceed", 0)` → `skipNextStage: false` (ambiguous → safe default)
  - `parseResumeIntent("No web search", 1)` → `skipNextStage: false` (wrong stage boundary)
  - Resume integration: mock orchestrator paused at Stage 0, resume with "B" → Stage 1 skipped
  - Resume integration: mock orchestrator paused at Stage 1, resume → followUpContext loaded from PipelineState.previousSessionId
- [x] **7c.** Create `packages/shared/src/agent/orchestrator/__tests__/stage1-empty-webresults.test.ts`:
  - Empty `webResults` → early return with `skipped: true` (no LLM call)
  - `normalizeStage1Data()` with `{ websearch_calibration: { skipped: true } }` → `NormalizedCalibration` with `skipped: true`
  - `normalizeStage1Data()` with `{ rawText: '{"websearch_calibration": {...}}' }` → recovers via rawText fallback
  - `formatStage1PauseMessage()` with `skipped: true` → renders skip message
- [x] **7d.** Run full test suite: `pnpm run test`
- [x] **7e.** Validate: `pnpm run typecheck:all && pnpm run lint`

### Risks & Considerations

| Risk | Mitigation |
|------|------------|
| F6: Intent parsing false positives | Conservative patterns, default-to-run fallback, only active at Stage 0→1 boundary. "proceed" alone does NOT match (ambiguous). |
| F7: Truncated JSON repair dropped | Token increase (8192→24576) prevents truncation. Diagnostic-only log warning remains for detection. |
| F8: BAML type mismatch avoided | Guard moved from `callBamlStage1` to `runWebsearchCalibration()` — returns proper `StageResult` shape, never constructs fake BAML type. |
| F9: `userMessage` semantics drift | Documented non-issue — later stages read query plan from `state.getStageOutput(0)`, not from `userMessage` param. |
| `previousSessionId` backward compat | Field is optional in both `PipelineState` and `PipelineStateSnapshot`. Old pipeline-state.json files without it load correctly (`undefined`). |
| Double-resume (Stage 1→2) | `resume()` reloads `followUpContext` from `state.previousSessionId` on EVERY resume call, not just the first. |
| Token limit increase (8192→24576) raises cost | Marginal — Stage 1 already runs this LLM call. Output is typically 10K-16K tokens. Prevents truncation. |

### Testing Strategy

1. `pnpm run typecheck:all` — type safety after each phase
2. `pnpm run lint` — code quality after each phase
3. `pnpm run test` — all unit + integration tests (including new Phase 7 tests)
4. Manual pipeline test: run query with "No web search" → verify Stage 1 skipped, Stage 2 proceeds
5. Manual pipeline test: follow-up query → verify `followUpContext` survives across both resume calls

---

## Section 21: Stale Build Fix — Rebuild Validation & Build-Verification Guard

### Goal

All Section 20 code changes are correctly implemented in source but the compiled Electron build (`apps/electron/dist/main.cjs`) is stale — contains pre-Section 20 code. Rebuild, validate the compiled output contains all changes, and add a guard to prevent future stale-build issues.

### Analysis

**Root Cause:**
The dev server (`pnpm run electron:dev`) uses esbuild watch mode which should auto-rebuild when source files change. But the watch process was either not running when files were modified, or failed to detect changes. As a result, `apps/electron/dist/main.cjs` (~710K lines) contains none of the Section 20 changes.

**Evidence from session data:**

| Session | User text | Expected | Actual |
|---------|-----------|----------|--------|
| `260225-grand-cobble` | "No web search - proceed directly" | Stage 1 skipped | Stage 1 ran, `outputTokens: 8192` (old limit), `normalizationPath: "fallback"` |
| `260225-witty-falcon` | "Pick your guesses - skip the web search" | Stage 1 skipped | Stage 1 ran, `normalizationPath: "zod"`, full calibration output with hallucinated web sources |

**Evidence from compiled build:**

| Check | Expected | Actual in `main.cjs` |
|-------|----------|---------------------|
| `parseResumeIntent` function | Present | **0 matches** — function doesn't exist |
| `skipStages` parameter | Present | **0 matches** — parameter doesn't exist |
| `resume()` → `executePipeline()` args | 6 args (incl. `followUpContext`, `skipStages`) | 4 args only |
| `executePipeline()` skip intercept | `if (skips.has(stage.id))` block | **Missing** — no skip check in loop |

**Source code verification (all PASS):**

| Check | Result |
|-------|--------|
| `parseResumeIntent()` at index.ts L121 | Present, 6 regex patterns |
| `skipStages` threaded to `executePipeline()` at L315 | 6th arg present |
| Skip intercept at L357 | `if (skips.has(stage.id))` with synthetic result + `continue` |
| Token limit in config.json | `perStageDesiredTokens.1: 24576` (changed from 8192) |
| Empty webResults guard at stage-runner.ts L265 | Early return when `webResults.length === 0` |
| Pause-formatter skip path | `websearch_calibration.skipped === true` handling present |
| Stage 2 fallback chain | Falls back to Stage 0 queries when Stage 1 skipped — compatible |
| Pattern match `/\bskip\b.*\bweb/i` vs "skip the web search" | Matches correctly |
| No `userMessage` transformation in call chain | Clean pass-through from `chat()` to `parseResumeIntent()` |

**Key Files:**

| File | Role |
|------|------|
| `apps/electron/dist/main.cjs` | Compiled Electron main process — stale, needs rebuild |
| `scripts/electron-dev.ts` | Dev server with esbuild watch + auto-restart |
| `scripts/electron-build-main.ts` | Production build script |

### Phase 1: Rebuild & Validate Compiled Output

**Rationale**: Rebuild the Electron main process from current source and verify all Section 20 changes are present in the compiled output.

- [x] **1a.** Run `pnpm run electron:dev` (or direct esbuild build) to rebuild `apps/electron/dist/main.cjs` from current source
- [x] **1b.** Verify compiled output contains Section 20 changes:
  - `grep "parseResumeIntent" apps/electron/dist/main.cjs` → must have matches
  - `grep "skipStages" apps/electron/dist/main.cjs` → must have matches
  - `grep "skips.has" apps/electron/dist/main.cjs` → must have matches (skip intercept)
  - `resume()` → `executePipeline()` call must pass 6 args (incl. `skipStages`)
  - `executePipeline()` signature must include `skipStages` parameter
- [x] **1c.** Verify token limit change: confirmed in `agents/isa-deep-research/config.json` (runtime config, not compiled — `perStageDesiredTokens.1: 24576`)
- [x] **1d.** Verify empty webResults guard: `grep "no web search results" apps/electron/dist/main.cjs` — confirmed at line 215091

### Phase 2: Live End-to-End Validation

**Rationale**: Confirm the fixes actually work in the running Electron app by testing the exact user flows that failed.

- [-] **2a.** Start the app with rebuilt `main.cjs` (manual — requires interactive Electron app)
- [-] **2b.** Test skip flow (manual — requires interactive Electron app)
- [-] **2c.** Test no-web-search flow (manual — requires interactive Electron app)
- [-] **2d.** Test normal flow (manual — requires interactive Electron app)
- [-] **2e.** Check pipeline-state.json (manual — requires interactive Electron app)

### Phase 3: Build-Verification Guard (Prevent Recurrence)

**Rationale**: Add a lightweight check so stale-build issues are caught before manual testing. This prevents wasting time debugging correct source code that wasn't compiled.

- [x] **3a.** In `scripts/electron-dev.ts`, add a post-build verification step in the `electronRestartPlugin.onEnd()` handler:
  - After successful build AND file stabilization, verify `main.cjs` contains a build timestamp marker
  - Log the build timestamp to console for visibility
- [x] **3b.** Add a `BUILD_TIMESTAMP` define to the esbuild config in both `electron-dev.ts` and `electron-build-main.ts`:
  - `define: { 'process.env.BUILD_TIMESTAMP': JSON.stringify(new Date().toISOString()) }`
  - This embeds the build time in `main.cjs` — easily searchable to confirm freshness
- [x] **3c.** In Electron main process startup (e.g., `apps/electron/src/main/index.ts`), log the build timestamp:
  - `console.log('[main] Build timestamp:', process.env.BUILD_TIMESTAMP ?? 'unknown');`
  - Visible in dev console on every Electron launch
- [x] **3d.** Validate: `pnpm run typecheck:all && pnpm run lint`

### Risks & Considerations

| Risk | Mitigation |
|------|------------|
| esbuild watch may miss future changes | Phase 3 build timestamp makes stale builds immediately visible |
| Rebuild may surface TypeScript errors | Section 20 already passed `typecheck:all` — low risk |
| `BUILD_TIMESTAMP` define adds build coupling | Standard esbuild pattern, zero runtime cost (dead-code eliminated in prod if unused) |
| Manual testing (Phase 2) is time-consuming | Essential — automated E2E for orchestrator skip flow is a future enhancement |

### Testing Strategy

1. Phase 1: Binary verification via grep on compiled output
2. Phase 2: Manual pipeline tests with skip / no-skip user responses
3. Phase 3: `pnpm run typecheck:all && pnpm run lint` after code changes
4. Confirm dev server restart emits build timestamp in console

---

## Section 22: Orchestrator MCP Bridge — Hardened Remediation Plan (Gap-Addressed)

### Goal

Eliminate false Stage 1 "skipped/calibrated" outcomes by making MCP connectivity deterministic, web-search execution truthful, and diagnostics auditable across both run and resume paths.

### Verified Findings (Current Code)

- `extractTransportConfig()` currently forwards `command`/`cwd` unchanged from source config:
  - `packages/shared/src/agent/orchestrator/mcp-lifecycle.ts` (extractor)
- Orchestrator MCP web search sends wrong payload shape:
  - `packages/shared/src/agent/orchestrator/mcp-bridge.ts` currently sends `{ query }`
- Stage 1 query source currently derives from broad stage-0 query list, not explicit authority web queries:
  - `packages/shared/src/agent/orchestrator/stage-runner.ts`
- Stage 1 pause rendering lacks deterministic execution provenance fields; it can only infer from normalized content:
  - `packages/shared/src/agent/orchestrator/pause-formatter.ts`
- Pipeline state persists event summaries and stage output data, but current Stage 1 payload does not include explicit MCP execution counters:
  - `packages/shared/src/agent/orchestrator/index.ts`
  - `packages/shared/src/agent/orchestrator/pipeline-state.ts`

### Corrected Assumptions / Gaps Closed

- Avoid over-claiming "never connected in any session" without explicit connect telemetry in state.
- Avoid aggressive command rewriting that breaks PATH-based executables.
- Do **not** place `BRAVE_API_KEY` into source config files (secret handling risk).
- Add fallback chain for Stage 1 query source when `authority_sources.search_queries` is absent.
- Add truthfulness invariant so Stage 1 cannot claim calibrated web execution unless real MCP calls succeeded.
- Cover both orchestrator entrypoints (`runOrchestrator` and `resumeOrchestrator`) in tests.

---

### Phase 0: Diagnostic Baseline (Before Functional Changes)

- [x] **0.1** Add structured MCP connect diagnostics in both run and resume paths:
  - source slug, resolved transport fields, connect success/failure reason
- [x] **0.2** Add deterministic Stage 1 execution telemetry object in `StageResult.data`, e.g.:
  - `webSearchExecution: { mcpConnected, queriesPlanned, queriesAttempted, queriesSucceeded, resultsCount, warnings[] }`
- [x] **0.3** Persist telemetry through existing pipeline-state save flow for postmortem validation

### Phase 1: Transport Resolution Hardening (Safe + Portable)

- [x] **1.1** Update `extractTransportConfig()` signature to accept `workspaceRootPath`
- [x] **1.2** Resolve relative `cwd` as:
  - `isAbsolute(cwd) ? cwd : resolve(workspaceRootPath, cwd)`
- [x] **1.3** Resolve `command` **only if path-like** (contains path separator). Leave plain executable names unchanged for PATH lookup.
- [x] **1.4** Update both call sites to pass `this.workspaceRootPath`:
  - `runOrchestrator()` and `resumeOrchestrator()` in `claude-agent.ts`
- [x] **1.5** Emit connect diagnostics before/after lifecycle connect attempt

### Phase 2: MCP Web Search Contract + Normalization

- [x] **2.1** Change web search call payload to `{ queries: [query] }`
- [x] **2.2** Expand parser normalization to accept canonical `isa_web_search` response fields:
  - `results`, `analysis_hints`, `queries_executed`, `warnings`
- [x] **2.3** Keep returned orchestrator shape stable (`WebSearchResult`) while preserving warnings in telemetry
- [x] **2.4** Improve error wrapping for schema/argument mismatch to be actionably diagnosable

### Phase 3: Stage 1 Query Source + Truthfulness Invariant

- [x] **3.1** Query source fallback chain (in order):
  1) `query_plan.authority_sources.search_queries`
  2) normalized `queries`
  3) `query_plan.sub_queries`
- [x] **3.2** Normalize/filter empty queries and cap search count to configured bound
- [x] **3.3** Enforce invariant:
  - Stage 1 must not report "calibrated web execution" unless `queriesSucceeded > 0` and/or `resultsCount > 0`
- [x] **3.4** Deterministically override any contradictory LLM-calibration counters with runtime telemetry
- [x] **3.5** Preserve existing empty-results guard to prevent hallucinated web-source output

### Phase 4: Pause UX/State Truthfulness

- [x] **4.1** Extend `NormalizedCalibration` / formatter inputs to consume execution telemetry
- [x] **4.2** Distinguish three states in Stage 1 pause messaging:
  - User-intent skip
  - Execution failed / unavailable (bridge/key/tool)
  - Successful calibration
- [x] **4.3** Ensure `pause_formatted` event remains backward compatible while recording new provenance fields in data

### Phase 5: Environment & Secret Handling

- [x] **5.1** Keep `BRAVE_API_KEY` out of source config JSON
- [x] **5.2** Document required runtime env setup for Electron + MCP subprocess inheritance
- [x] **5.3** Add runtime warning when Stage 1 web search is enabled but `BRAVE_API_KEY` is missing

### Phase 6: Tests (Run + Resume + Regression)

- [x] **6.1** Unit: transport resolution (`cwd`, path-like `command`, PATH-safe command)
- [x] **6.2** Unit: web search payload contract and response normalization
- [x] **6.3** Unit: Stage 1 query-source fallback order
- [x] **6.4** Unit: truthfulness invariant (no synthetic calibrated state)
- [x] **6.5** Unit: pause formatter rendering for skip vs failed-execution vs calibrated
- [x] **6.6** Integration: both run/resume entrypoints wire MCP transport consistently
- [x] **6.7** Regression: no-bridge and no-key scenarios must produce deterministic non-fabricated Stage 1 outcomes

### Phase 7: Validation Gates

- [x] **7.1** `pnpm run typecheck:all`
- [-] **7.2** `pnpm run lint` *(blocked by pre-existing unrelated lint errors in `apps/electron`)*
- [x] **7.3** Targeted orchestrator tests (Stage 1 + transport + formatter)
- [-] **7.4** Broader `pnpm run test` once targeted suite passes *(blocked by pre-existing unrelated failures outside Section 22 scope)*
- [-] **7.5** Manual checks *(pending operator run with runtime credentials)*:
  - Stage 0 "Yes" + valid key + connected bridge ⇒ real calibration
  - Stage 0 "Yes" + missing key ⇒ warning path, no fabricated calibration
  - Resume path behavior matches fresh run semantics

---

### Risks & Mitigations

- **Risk**: PATH regressions from over-resolving `command`
  - **Mitigation**: only resolve path-like commands; preserve executable-name behavior
- **Risk**: LLM output contradicts runtime MCP facts
  - **Mitigation**: deterministic telemetry fields override display/status decisions
- **Risk**: difficult future postmortems
  - **Mitigation**: persist execution provenance in stage data + event diagnostics
- **Risk**: secret sprawl
  - **Mitigation**: env-only key policy, no key in source config files

---

_Last updated: 2026-02-26 (Section 21 -- Follow-up context auto-wiring implemented)_
