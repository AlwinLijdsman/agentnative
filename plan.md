# Craft Agent (AgentNative) -- Technical Specification

> Single source of truth for repository structure, architecture, and conventions.
> Completed implementation plans are archived to `plans/YYMMDD-{slug}.md`.

---

## 1. Project Identity

| Field | Value |
|-------|-------|
| Name | **Craft Agent** (repo: `agentnative`) |
| Version | 0.4.5 |
| Description | Electron desktop app -- Claude Agent SDK-powered coding assistant with MCP server support |
| License | MIT (app), Apache-2.0 (packages) |
| Origin | Fork of `lukilabs/craft-agents-oss` |
| Remote `origin` | `github.com/AlwinLijdsman/agentnative` |
| Remote `upstream` | `github.com/lukilabs/craft-agents-oss` |
| Platform | Windows ARM64 -- uses **pnpm + tsx**, never bun |

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
| Python | Python 3.11+ | ISA KB MCP server (pip, venv) |

---

## 3. Monorepo Folder Map

```
agentnative/
|
+-- apps/
|   +-- electron/                      # Main Electron desktop app
|   |   +-- src/
|   |   |   +-- main/                  # Main process (Node.js)
|   |   |   |   +-- index.ts           #   App entry, Sentry init, window creation (~470 lines)
|   |   |   |   +-- sessions.ts        #   SessionManager -- agent/session lifecycle (~6080 lines)
|   |   |   |   +-- ipc.ts             #   IPC handler registration (~3798 lines)
|   |   |   |   +-- window-manager.ts  #   BrowserWindow creation & management
|   |   |   |   +-- auto-update.ts     #   electron-updater integration
|   |   |   |   +-- deep-link.ts       #   craft-agent:// protocol handler
|   |   |   |   +-- menu.ts            #   Native menu bar
|   |   |   |   +-- notifications.ts   #   System notifications
|   |   |   |   +-- power-manager.ts   #   Prevent sleep while agent runs
|   |   |   |   +-- search.ts          #   In-page search (Cmd/Ctrl+F)
|   |   |   |   +-- logger.ts          #   electron-log configuration
|   |   |   |   +-- shell-env.ts       #   Load user shell env (PATH, nvm, etc.)
|   |   |   |   +-- onboarding.ts      #   First-run setup flow
|   |   |   |   +-- lib/               #   Config watcher helper
|   |   |   +-- preload/
|   |   |   |   +-- index.ts           #   Context-isolated bridge (IPC to renderer)
|   |   |   +-- renderer/
|   |   |   |   +-- main.tsx           #   React entry point
|   |   |   |   +-- App.tsx            #   Root component with routing
|   |   |   |   +-- atoms/             #   Jotai atoms (5 files)
|   |   |   |   +-- pages/             #   Page components (7 pages)
|   |   |   |   +-- components/        #   UI components (172 files, 18 directories)
|   |   |   |   +-- hooks/             #   React hooks (23 files)
|   |   |   |   +-- contexts/          #   React contexts (Theme, AppShell, Modal, Focus)
|   |   |   |   +-- actions/           #   IPC action wrappers
|   |   |   |   +-- utils/             #   Renderer-side utilities
|   |   |   +-- shared/                #   Types shared between main & renderer
|   |   |   +-- __tests__/             #   E2E and integration tests
|   |   +-- resources/                 #   Bundled assets (synced to ~/.craft-agent/)
|   |   +-- electron-builder.yml       #   electron-builder config
|   +-- viewer/                        #   Standalone session viewer (Vite + React)
|
+-- packages/
|   +-- core/                          #   @craft-agent/core -- type definitions
|   +-- shared/                        #   @craft-agent/shared -- ALL business logic
|   |   +-- src/
|   |       +-- agent/                 #     Agent backends (see Section 5)
|   |       |   +-- orchestrator/      #       Deterministic pipeline (16 source files)
|   |       |   +-- __tests__/         #       Agent tests (13 files)
|   |       +-- auth/                  #     Authentication (16 files, ~3950 lines)
|   |       +-- config/                #     Configuration (11 files, ~6450 lines)
|   |       +-- credentials/           #     Credential management (3 files, ~940 lines)
|   |       +-- mcp/                   #     MCP client utilities (3 files, ~725 lines)
|   |       +-- sessions/              #     Session persistence (9 files, ~2500 lines)
|   |       +-- sources/               #     Source management (8 files, ~3560 lines)
|   |       +-- prompts/               #     System prompts
|   |       +-- tools/                 #     Tool definitions
|   |       +-- types/                 #     Shared type definitions
|   |       +-- ...                    #     labels, statuses, views, search, etc.
|   +-- ui/                            #   @craft-agent/ui -- shared React components
|   +-- agent-pipeline-core/           #   @craft-agent/agent-pipeline-core -- pipeline handlers
|   |   +-- src/handlers/
|   |       +-- agent-stage-gate.ts    #     Pipeline stage lifecycle (~1550 lines)
|   |       +-- agent-render-output/   #     Research output renderer (6 files, ~1300 lines)
|   |       +-- agent-state.ts         #     Persistent key-value state (~116 lines)
|   |       +-- agent-validate.ts      #     Agent validation (~308 lines)
|   +-- session-tools-core/            #   @craft-agent/session-tools-core -- platform tool handlers
|   |   +-- src/handlers/
|   |       +-- source-test.ts         #     Source connectivity testing (~841 lines)
|   |       +-- source-oauth.ts        #     OAuth flow handler (~353 lines)
|   |       +-- ...                    #     config, credential, mermaid, skill, submit-plan
|   +-- bridge-mcp-server/             #   @craft-agent/bridge-mcp-server -- stdio MCP bridge
|   +-- session-mcp-server/            #   @craft-agent/session-mcp-server -- session MCP
|   +-- mermaid/                       #   @craft-agent/mermaid -- flowchart -> SVG renderer
|   +-- codex-types/                   #   @craft-agent/codex-types -- auto-generated API types
|
+-- agents/
|   +-- isa-deep-research/             #   ISA Deep Research agent (config.json, prompts/)
|   +-- _templates/                    #   Agent template scaffolding
|
+-- sources/                           #   14 MCP source configurations (see Section 7)
+-- skills/                            #   7 Claude Code slash commands (SKILL.md)
+-- scripts/                           #   Build, dev, test scripts (16 files)
+-- plans/                             #   Archived implementation plans (14 files)
+-- sessions/                          #   Session logs (JSONL format)
+-- labels/                            #   Label configuration
+-- statuses/                          #   Status workflow configuration
+-- isa-kb-mcp-server/                 #   Python MCP server for ISA knowledge base
|   +-- src/isa_kb_mcp_server/         #     SQLite + vector search + graph traversal (13 modules)
+-- claude-teams/                      #   Multi-agent team definitions
+-- .github/agents/                    #   VS Code Copilot Chat agents (6 agents)
```

---

## 4. Package Dependency Graph

```
                    +--------------+
                    |  codex-types |  (auto-generated Codex API types)
                    +--------------+
                           |
                    +------v-------+
                    |     core     |  (Workspace, Session, Message types)
                    +--------------+
                       |       |
              +--------v--+  +-v--------+
              |   shared   |  |    ui    |  (React components)
              | (all biz   |  |          |
              |  logic)    |  +----------+
              +------+-----+       |
                |  |  |            |
   +------------+  |  +--+---------+--------------+
   |               |     |         |              |
   |  +------------v--+  |         |              |
   |  | agent-pipeline |  |         |              |
   |  | core (pipeline |  |         |              |
   |  | handlers)      |  |         |              |
   |  +-------^--------+  |         |              |
   |          |            |         |              |
   |    +-----+-------v---+    |              |
   |    | session-tools-core  |>---+              |
   |    | (platform handlers) |                   |
   |    +---------------------+                   |
   |        |          |                          |
   |  +-----v------+ +-v--------------+          |
   |  | bridge-mcp | | session-mcp    |          |
   |  | server     | | server         |          |
   |  +------------+ +----------------+          |
   |                                              |
   v                                              v
+--------------------------------------------------+
|              apps/electron                        |
|  (imports: core, shared, ui, session-tools-core,  |
|   agent-pipeline-core)                            |
+--------------------------------------------------+

   mermaid  >--  session-tools-core  (mermaid validation handler)
```

All internal dependencies use workspace protocol: `"@craft-agent/shared": "workspace:*"`.

---

## 5. Architecture Deep Dive

### 5a. Electron Process Model

```
+-------------------------------------------------------------+
|  Main Process (src/main/)                                    |
|  - Window management, native menus, auto-update              |
|  - SessionManager: creates/manages agent sessions            |
|  - IPC handlers: bridges renderer requests to business logic |
|  - Shell env loading: ensures PATH includes nvm, brew, etc.  |
|  - Power manager: prevents sleep during agent execution      |
+-------------------------------------------------------------+
             | contextBridge (preload/index.ts)
             | IPC channels only, no nodeIntegration
+-------------------------------------------------------------+
|  Renderer Process (src/renderer/)                            |
|  - React 18 SPA with Jotai atoms                            |
|  - Pages: Chat, Preferences, AgentInfo, SourceInfo, etc.    |
|  - All state in atoms/ (sessions, agents, sources, skills)   |
|  - Tailwind CSS 4 for styling                                |
+-------------------------------------------------------------+
```

**Security**: `nodeIntegration: false`, `contextIsolation: true`. All IPC goes through the preload bridge. The renderer never accesses Node.js APIs directly.

### 5b. Agent Backends

Three agent backends share a common base class:

| Backend | File | Lines | Purpose |
|---------|------|-------|---------|
| `ClaudeAgent` | `claude-agent.ts` | ~3680 | Claude Agent SDK + orchestrator pipeline |
| `CodexAgent` | `codex-agent.ts` | ~2600 | Codex API integration |
| `CopilotAgent` | `copilot-agent.ts` | ~1480 | VS Code Copilot SDK |
| `BaseAgent` | `base-agent.ts` | ~910 | Shared: permissions, mode management, source toggling |

All agents implement the `chat()` async generator pattern, yielding `AgentEvent` objects (text, tool calls, errors, completion).

### 5c. Orchestrator Pipeline

The **deterministic orchestrator** (`packages/shared/src/agent/orchestrator/`) replaces SDK-driven tool calling with a TypeScript for-loop controlling stage execution. Each stage = 1 focused LLM call with shaped context.

**Design principles:**
- TypeScript writes state -- LLM never touches it
- Deterministic: for-loop over stages from `config.json`
- Immutable state with event sourcing (`PipelineState`)
- Per-stage cost tracking and budget enforcement

**Pipeline stages** (ISA Deep Research agent):

| # | Stage | Pauses | Description |
|---|-------|--------|-------------|
| 0 | `analyze_query` | Yes | Decompose query, assess clarity, build sub-query plan |
| 1 | `websearch_calibration` | Yes | Optional web search to refine query plan |
| 2 | `retrieve` | No | Hybrid search + graph traversal via MCP tools |
| 3 | `synthesize` | No | Generate structured answer from XML context |
| 4 | `verify` | No | 4-axis verification (entity grounding, citation accuracy, relation preservation, contradictions) |
| 5 | `output` | No | Format final output with progressive disclosure |

**Repair loop**: Stages 3-4 form a repair unit. If verification fails, synthesis is re-run with feedback (max 2 iterations).

**Orchestrator source files** (16 files, ~6000 lines total):

| File | Lines | Purpose |
|------|-------|---------|
| `index.ts` | ~660 | `AgentOrchestrator` class -- run/resume, event loop |
| `stage-runner.ts` | ~1255 | Per-stage dispatch, context assembly, LLM calls |
| `pause-formatter.ts` | ~787 | Deterministic pause message formatting |
| `synthesis-post-processor.ts` | ~555 | Safety net: inject `WEB_REF`/`PRIOR_REF` markers + inline labels |
| `types.ts` | ~459 | All orchestrator type definitions |
| `pipeline-state.ts` | ~331 | Immutable event-sourced state with `previousSessionId` |
| `mcp-bridge.ts` | ~318 | MCP tool call abstraction |
| `follow-up-context.ts` | ~295 | Follow-up session context loading |
| `cost-tracker.ts` | ~291 | Per-stage token accounting, USD budget enforcement |
| `context-builder.ts` | ~275 | XML context assembly with token budgeting |
| `mcp-lifecycle.ts` | ~272 | MCP server connect/disconnect lifecycle |
| `baml-adapter.ts` | ~189 | BAML structured output (feature-flagged) |
| `llm-client.ts` | ~184 | Anthropic API wrapper with streaming |
| `context-budget.ts` | ~154 | Token estimation and overflow management |
| `json-extractor.ts` | ~149 | Robust JSON extraction from LLM responses |
| `baml-types.ts` | ~97 | BAML type definitions |

**8 test files** in `__tests__/` covering: follow-up detection, MCP bridge, lifecycle, pipeline state, resume/skip routing, Stage 1 telemetry, and synthesis post-processing.

### 5d. Session Lifecycle

| Concept | Detail |
|---------|--------|
| Session | Conversation scope with SDK session binding |
| ID format | `msg-{timestamp}-{random}` via `generateMessageId()` |
| Persistence | Debounced 500ms writes via `persistence-queue.ts` |
| Storage | `sessions/{slug}/session.jsonl` (first line = metadata) |
| Metadata | messageCount, tokenUsage, permissionMode, status, labels |

**Session files** (9 files, ~2500 lines in `packages/shared/src/sessions/`):

Core session operations: create, load, save, archive, rename, delete. Session metadata stored as first JSONL line; subsequent lines are message events.

**SDK session continuity**: The `ClaudeAgent` captures `session_id` exclusively from the SDK's canonical `system:init` message (not from other message types which may carry stale IDs). On session expiry, dual-channel recovery (result-error + catch-path) clears the session and retries with full context restoration.

### 5e. Source MCP Server Architecture

Sources are external data providers connected via MCP (Model Context Protocol). Each source has a `config.json` in `sources/{slug}/`.

**Transport types:**
- **stdio** -- subprocess MCP server (e.g., ISA KB, PDF, Brave Search)
- **http/sse** -- HTTP-based MCP server (e.g., Azure services)

**Credential flow:**
```
Main Process -> decrypt credentials.enc -> write .credential-cache.json (0600)
                                              |
Bridge MCP Server (subprocess) <--------------+ reads on each request
```

**Auto-enable**: Agents declare required sources in `AGENT.md` frontmatter. When an agent is @mentioned, its required sources are automatically enabled.

### 5f. Renderer Architecture

**Jotai atoms** (5 files):

| Atom File | State |
|-----------|-------|
| `sessions.ts` | Active session, message list, streaming state |
| `agents.ts` | Loaded agents, active agent |
| `sources.ts` | Source configs, connection status |
| `skills.ts` | Available skills |
| `overlay.ts` | Modal/overlay state |

**Pages** (7):

| Page | Purpose |
|------|---------|
| `ChatPage` | Main conversation UI with message rendering |
| `PreferencesPage` | Settings editor |
| `AgentInfoPage` | Agent details and configuration |
| `AgentRunDetailPage` | Agent run history and results |
| `SourceInfoPage` | Source details and testing |
| `SkillInfoPage` | Skill details |
| `ShortcutsPage` | Keyboard shortcuts reference |

**Component directories** (172 files across 18 directories): `chat/`, `settings/`, `onboarding/`, `markdown/`, `workspace/`, `app-shell/`, `ui/`, `icons/`, `info/`, `files/`, `preview/`, `right-sidebar/`, `shiki/`, `apisetup/`.

### 5g. Build Pipeline

```
pnpm run electron:build
  +-- electron:build:main      -> esbuild -> dist/main.cjs
  +-- electron:build:preload   -> esbuild -> dist/preload.cjs
  +-- electron:build:renderer  -> Vite    -> dist/renderer/
  +-- electron:build:resources -> Copy resources/ -> dist/resources/
  +-- electron:build:assets    -> Copy additional assets
```

**Dev mode**: `pnpm run electron:dev` -- watches all source files, rebuilds on change, hot reloads renderer.

**Distribution**: `pnpm run electron:dist` -> electron-builder packages for current platform.

### 5h. Session-Scoped Tools

Tools registered in `session-scoped-tools.ts` (~844 lines), implemented in `session-tools-core/src/handlers/`:

| Tool | Handler | Lines | Purpose |
|------|---------|-------|---------|
| `agent_stage_gate` | `agent-stage-gate.ts` | ~1550 | Pipeline stage lifecycle (start, complete, resume, repair) |
| `agent_render_research_output` | `agent-render-output/` | ~1300 | Assemble structured research documents |
| `agent_state` | `agent-state.ts` | ~116 | Persistent key-value state across turns |
| `agent_validate` | `agent-validate.ts` | ~308 | Agent configuration validation |
| `source_test` | `source-test.ts` | ~841 | Source connectivity testing |
| `source_oauth` | `source-oauth.ts` | ~353 | OAuth flow handler |
| `config_validate` | `config-validate.ts` | ~191 | Configuration validation |
| `credential_prompt` | `credential-prompt.ts` | ~83 | Credential input prompting |
| `mermaid_validate` | `mermaid-validate.ts` | ~58 | Mermaid diagram validation |
| `skill_validate` | `skill-validate.ts` | ~68 | Skill validation |
| `submit_plan` | `submit-plan.ts` | ~51 | Plan submission |

### 5i. Synthesis Post-Processor

Deterministic safety net (`synthesis-post-processor.ts`, ~555 lines) that runs after Stage 3 LLM synthesis to guarantee `WEB_REF`/`PRIOR_REF` markers and inline `[W#]`/`[P#]` labels exist. Measured LLM adherence for inline labels was 0% -- this module compensates.

**Algorithm:**
1. For each web source missing a `WEB_REF` marker, find the best-matching section by keyword overlap and inject a Sources blockquote
2. For each source missing an inline `[W#]` label, find the best-matching sentence and append the label
3. Same for `PRIOR_REF` / `[P#]` labels (follow-up sessions)

Properties: pure deterministic string processing, no LLM calls, sub-millisecond, never injects duplicates.

### 5j. Follow-Up Context System

When a user asks a follow-up question, the orchestrator (`follow-up-context.ts`, ~295 lines) auto-detects the previous session's `answer.json` and loads prior research sections. These appear as `PRIOR_REF` markers with `[P#]` inline labels in the new synthesis.

Detection: `resolveFollowUpSessionId()` in `claude-agent.ts` checks for `answer.json` presence in the previous session directory.

---

## 6. Configuration & Data Paths

### Runtime Paths (`~/.craft-agent/`)

| Path | Content |
|------|---------|
| `config.json` | Active configuration (themes, preferences, workspace paths) |
| `credentials.enc` | Encrypted API credentials (Fernet, machine-specific key) |
| `.credential-cache.json` | Decrypted cache for MCP subprocess access (0600) |
| `sessions/` | Persisted session JSONL files |
| `themes/` | Color theme JSON files (15 built-in) |
| `docs/` | Built-in documentation |
| `permissions/` | Permission rule files |
| `tool-icons/` | SVG icons for tools |

### Configuration Resolution

Cascading resolution: app-level -> workspace-level (last wins).

### LLM Connections

Configured in `packages/shared/src/config/llm-connections.ts`. Supports multiple provider types:
- **Anthropic** (OAuth or API key)
- **Azure OpenAI** (multiple regions)
- **Custom endpoints**

Default model: `claude-opus-4-6` with adaptive thinking.

---

## 7. Source Configurations

14 MCP source integrations in `sources/`:

| Source | Transport | Purpose |
|--------|-----------|---------|
| `isa-knowledge-base` | stdio | ISA standards knowledge base (hybrid search, graph, verification) |
| `brave-search` | stdio | Web search via Brave API |
| `pdf-server` | stdio | PDF text extraction and manipulation |
| `anthropic` | http | Direct Anthropic API access |
| `azure-ai-search` | http | Azure Cognitive Search |
| `azure-openai-sweden` | http | Azure OpenAI (Sweden region) |
| `azure-openai-swiss` | http | Azure OpenAI (Swiss region) |
| `azure-deepseek` | http | Azure DeepSeek R1 |
| `azure-doc-intelligence` | http | Azure Document Intelligence |
| `azure-embeddings` | http | Azure embedding models |
| `voyage-ai` | http | Voyage AI embeddings |
| `onedrive-server` | stdio | OneDrive file access |
| `outlook-server` | stdio | Outlook email access |
| `agentnative` | http | Self-referential API source |

---

## 8. ISA Knowledge Base MCP Server

Python MCP server (`isa-kb-mcp-server/`) providing domain-specific knowledge retrieval for ISA (International Standards on Auditing).

**Modules** (13 Python files):

| Module | Purpose |
|--------|---------|
| `search.py` | Hybrid search (FTS5 + vector similarity) |
| `vectors.py` | Vector embedding and similarity |
| `graph.py` | Entity-relationship graph traversal |
| `paragraphs.py` | Paragraph retrieval and formatting |
| `verify.py` | Citation, entity, relation, contradiction verification |
| `context.py` | Context assembly and formatting |
| `web_search.py` | Brave web search integration |
| `rerank.py` | Result reranking |
| `query_expand.py` | Query expansion |
| `db.py` | SQLite database access |
| `diagnostics.py` | Health checks and status |
| `schema.sql` | Database schema |

**MCP Tools exposed**: `isa_hybrid_search`, `isa_hop_retrieve`, `isa_list_standards`, `isa_get_paragraph`, `isa_entity_verify`, `isa_citation_verify`, `isa_relation_verify`, `isa_contradiction_check`, `isa_format_context`, `isa_web_search`, `isa_guide_search`, `isa_guide_to_isa_hop`, `isa_list_guides`, `isa_multi_tier_search`, `isa_kb_status`, `isa_debug_hop_trace`.

---

## 9. Agent Configuration

### ISA Deep Research Agent (`agents/isa-deep-research/`)

The primary agent. Configured via `config.json` (~290 lines) with:

**Pipeline**: 6 stages (0-5) with pause-after-stages [0, 1], repair unit on stages [3, 4] (max 2 iterations).

**Depth modes**:

| Mode | Sub-queries | Paragraphs/query | Repair iterations | Context budget | Web search |
|------|-------------|-------------------|--------------------|----------------|------------|
| quick | 3 | 10 | 0 | 4K tokens | No |
| standard | 8 | 20 | 2 | 12K tokens | Yes |
| deep | 15 | 30 | 3 | 24K tokens | Yes |

**Verification thresholds**: Entity grounding >= 0.80, citation accuracy >= 0.75, relation preservation >= 0.70, contradictions = 0 max.

**Orchestrator settings**: Model `claude-opus-4-6`, adaptive thinking, $10 USD budget, 200K context window, BAML structured output with Zod fallback.

**Output configuration**: ISA-specific citation format (`ISA {number}.{paragraph}`), progressive disclosure, PDF linking via `isa-pdf` source linker, follow-up support with delta retrieval.

---

## 10. Copilot Chat Agents & Skills

### VS Code Copilot Agents (`.github/agents/`)

| Agent | Name | Purpose |
|-------|------|---------|
| `research-and-plan.agent.md` | Plan Changes | Branch check -> research -> write `plan.md` |
| `carefully-implement-full-phased-plan.agent.md` | Build Continuously | Execute all plan phases -> commit/push |
| `carefully-implement-phased-plan.agent.md` | Build Step-by-Step | One phase at a time with approval |
| `adversarial-reviewer.agent.md` | Review Code | Read-only adversarial review |
| `code-researcher.agent.md` | Research Code | Read-only codebase analysis |
| `e2e-test-runner.agent.md` | Run E2E Tests | Test execution |

### Skills (`skills/{slug}/SKILL.md`)

Claude Code slash commands with YAML frontmatter:

| Skill | Purpose |
|-------|---------|
| `/an-research-and-plan` | Research codebase + write plan to `plan.md` |
| `/an-implement-full` | Execute all plan phases continuously |
| `/an-implement-phased` | Execute plan one phase at a time |
| `/an-adversarial-reviewer` | Adversarial code review |
| `/an-code-researcher` | Read-only code analysis |
| `/an-clean-plan-commit-push` | Archive plan, commit, push |

---

## 11. Scripts

| Script | Purpose |
|--------|---------|
| `electron-dev.ts` | Dev mode with hot reload |
| `electron-build-main.ts` | Build main process (esbuild) |
| `electron-build-preload.ts` | Build preload script (esbuild) |
| `electron-build-renderer.ts` | Build renderer (Vite) |
| `electron-build-resources.ts` | Copy resources to dist |
| `electron-build-assets.ts` | Copy additional assets |
| `electron-clean.ts` | Clean build artifacts |
| `sync-version.ts` | Sync version across packages |
| `extract-oauth-token.ts` | Extract OAuth token from credential store |
| `run-e2e-live.ts` | Run live E2E tests |
| `test-full-pipeline-e2e.ts` | Full pipeline E2E test |
| `test-orchestrator-all-stages-e2e.ts` | All-stages orchestrator E2E |
| `test-orchestrator-live-e2e.ts` | Live orchestrator E2E (~$0.05/run) |
| `test-stage0-e2e.ts` | Stage 0 pause E2E test |
| `install-app.ps1` / `install-app.sh` | Platform install scripts |

---

## 12. Quick Reference Commands

| Action | Command |
|--------|---------|
| Install deps | `pnpm install` |
| Dev with hot reload | `pnpm run electron:dev` |
| Full build | `pnpm run electron:build` |
| TypeScript check | `pnpm run typecheck:all` |
| Lint | `pnpm run lint` |
| Test | `pnpm run test` |
| E2E tests | `pnpm run test:e2e` |
| Live E2E (requires token) | `pnpm run test:e2e:live:auto` |
| Live orchestrator E2E | `npx tsx scripts/test-orchestrator-live-e2e.ts` |

---

## 13. Conventions & Constraints

### TypeScript
- Strict mode everywhere -- no `any` types unless explicitly justified
- Proper type narrowing, no unsafe casts (`as`)
- No unhandled promises

### Naming
- `camelCase` for functions and variables
- `PascalCase` for types, interfaces, classes, React components
- `UPPER_SNAKE_CASE` for constants

### Imports
- Workspace protocol (`workspace:*`) for internal packages
- Relative imports within a package
- Absolute workspace imports across packages

### Electron Security
- `nodeIntegration: false`, `contextIsolation: true`
- All IPC through preload bridge
- No direct Node.js access from renderer

### Plan Tracking
- Implementation plans in `plan.md` at project root
- Status markers: `[ ]` pending, `[x]` done, `[~]` in progress, `[-]` skipped
- Completed plans archived to `plans/YYMMDD-{slug}.md`
- Never delete completed items -- mark done for audit trail

### Do NOT
- Use `bun` (not available on Windows ARM64)
- Introduce `any` without justification
- Use `nodeIntegration: true`
- Skip TypeScript strict mode checks
- Hard-code credentials or API keys
- Commit `.claude/settings.local.json`

### Do ALWAYS
- Run `pnpm run typecheck:all` before considering changes complete
- Run `pnpm run lint` before considering changes complete
- Follow existing patterns before introducing new ones
- Update `plan.md` when completing implementation phases
- Use workspace protocol for internal packages
- Use `npx tsx` to run TypeScript scripts directly

---

## 14. Completed Plans Archive

| Date | Slug | Summary |
|------|------|---------|
| 2026-02-16 | `agent-quality-hardening` | Agent quality improvements |
| 2026-02-16 | `subagent-abort-propagation` | Subagent abort signal propagation |
| 2026-02-17 | `stage-gate-pause-enforcement` | Stage gate pause enforcement |
| 2026-02-18 | `agent-branch-hygiene` | Agent branch management |
| 2026-02-18 | `agent-default-sources` | Default source configuration |
| 2026-02-18 | `agent-overhaul-e2e-framework` | E2E test framework overhaul |
| 2026-02-18 | `agent-overhaul-e2e-framework-complete` | E2E framework completion |
| 2026-02-18 | `auto-enable-agent-sources` | Auto-enable required sources |
| 2026-02-18 | `generic-e2e-test-framework` | Generic E2E test framework |
| 2026-02-18 | `isa-websearch-intent-clarification` | ISA websearch intent |
| 2026-02-18 | `natural-completion-stage-gate` | Natural completion for stage gates |
| 2026-02-18 | `stage-gate-diagnostics-logging` | Stage gate diagnostics |
| 2026-02-18 | `stage0-lightweight-clarification-pause` | Stage 0 lightweight pause |
| 2026-02-26 | `craft-agent-agentnative-technical-specification` | This technical spec |

---

## 15. Future Plans & Roadmap

> Add upcoming features, ideas, and technical debt items here.

### Planned

- [ ] **Core package migration** -- Move storage, auth, credentials, agent logic from `shared/` to `core/`
- [ ] **Upstream sync workflow** -- Automated merge from `upstream/main` with conflict resolution
- [ ] **Multi-workspace support** -- UI and config for switching between workspaces
- [ ] **Plugin system** -- Dynamic loading of third-party agents and sources
- [ ] **Session sharing** -- Export/import sessions for collaboration

### Ideas (Not Yet Scoped)

- [ ] Agent performance benchmarking framework
- [ ] Source health monitoring dashboard
- [ ] Automated credential rotation for API sources
- [ ] Custom theme editor in Preferences UI
- [ ] Collaborative multi-agent sessions
- [ ] MCP server marketplace / registry

### Technical Debt

- [ ] Large `sessions.ts` (~6080 lines) -- candidate for decomposition into sub-modules
- [ ] Large `claude-agent.ts` (~3680 lines) -- candidate for splitting orchestrator integration
- [ ] Large `ipc.ts` (~3798 lines) -- candidate for splitting by domain
- [ ] Large `stage-runner.ts` (~1255 lines) -- consider splitting per-stage handlers
- [ ] `apps/electron/package.json` still references `bun` in some script commands
- [ ] `nul` file in repo root (Windows reserved name) -- should be removed from history

---

---

# Implementation Plan: Extract `@craft-agent/agent-pipeline-core`

## Goal

Cleanly separate the **deterministic agent pipeline engine** (stage gate, agent state, agent validate, render output) from `@craft-agent/session-tools-core` into a new `@craft-agent/agent-pipeline-core` package. Session-tools-core keeps platform tools (source test, oauth, config validate, etc.). All functionality preserved, zero breakage.

## Analysis

### What MOVES to agent-pipeline-core

| File | Lines | Role |
|------|-------|------|
| `handlers/agent-stage-gate.ts` | 1552 | Pipeline stage lifecycle |
| `handlers/agent-state.ts` | 116 | Persistent key-value state |
| `handlers/agent-validate.ts` | 308 | Agent config validation |
| `handlers/agent-render-output/` (6 files) | ~1300 | Research output renderer |

### What STAYS in session-tools-core

| File | Role |
|------|------|
| `handlers/submit-plan.ts` | Plan submission |
| `handlers/config-validate.ts` | Config validation |
| `handlers/skill-validate.ts` | Skill validation |
| `handlers/mermaid-validate.ts` | Mermaid diagram validation |
| `handlers/source-test.ts` | Source connectivity testing |
| `handlers/source-oauth.ts` | OAuth flow handler |
| `handlers/credential-prompt.ts` | Credential input prompt |
| `src/context.ts` | SessionToolContext interface |
| `src/types.ts` | Shared types (ToolResult, etc.) |
| `src/response.ts` | Response helpers |
| `src/validation.ts` | Full validation (zod, gray-matter deps) |
| `src/source-helpers.ts` | Source/skill path helpers |
| `__tests__/auth-debug-integration.test.ts` | Auth test (stays) |

### Shared infra: COPY-FIRST strategy

Three files are imported by BOTH the moving handlers and the staying handlers. To avoid circular dependencies, we **copy** lightweight versions into `agent-pipeline-core`:

| File | Size | Copy strategy |
|------|------|---------------|
| `context.ts` (406L) | Interface-only | Copy entire file |
| `types.ts` | Type defs | Copy entire file |
| `response.ts` | 4 functions | Copy entire file |

### Special handling for validation.ts and source-helpers.ts

- **`validation.ts`** (373L) — uses `zod`, `gray-matter`, `node:fs`. But `agent-validate.ts` only needs 5 pure functions: `validateSlug`, `formatValidationResult`, `validResult`, `invalidResult`, `mergeResults`. Create `validation-lite.ts` with just those 5 functions (zero external deps).
- **`source-helpers.ts`** — `agent-validate.ts` calls `sourceExists(rootPath, slug)` which is a 1-liner: `existsSync(join(rootPath, 'sources', slug))`. Inline it in the moved `agent-validate.ts`.

### Dependency graph (after refactor)

```
@craft-agent/agent-pipeline-core (NEW) — gray-matter only, no workspace deps
      ↑
@craft-agent/session-tools-core → depends on agent-pipeline-core (for re-exports)
@craft-agent/session-mcp-server → depends on session-tools-core (UNCHANGED)
@craft-agent/shared → depends on BOTH session-tools-core AND agent-pipeline-core (NEW dep)
```

### Consumer map (8 affected locations, all verified)

| # | File | Current import | Change needed |
|---|------|----------------|---------------|
| 1 | `shared/.../session-scoped-tools.ts` L37-55 | 4 agent handlers from `session-tools-core` | Split: agent handlers from `agent-pipeline-core` |
| 2 | `shared/.../stage-runner.ts` L41-44 | 4 renderer subpath imports (`/renderer`, `/renderer-types`, `/renderer-config`, `/renderer-linker`) | Change to `@craft-agent/agent-pipeline-core/*` |
| 3 | `shared/.../synthesis-post-processor.ts` L26 | `WebReference, PriorSection` from `/renderer-types` | Change to `agent-pipeline-core/renderer-types` |
| 4 | `shared/.../orchestrator/__tests__/synthesis-post-processor.test.ts` L23 | `WebReference` from `/renderer-types` | Change to `agent-pipeline-core/renderer-types` |
| 5 | `shared/.../claude-context.ts` | `SessionToolContext`, callbacks | **No change** (shared infra stays in session-tools-core) |
| 6 | `shared/.../codex-agent.ts` | `AuthRequest` | **No change** |
| 7 | `session-mcp-server/.../index.ts` L52-58 | 3 agent handlers from `session-tools-core` | **No change** (uses re-exports from session-tools-core) |
| 8 | `scripts/test-full-pipeline-e2e.ts` L28-46 | 4 relative paths to render-output | Update paths to new package |

### Test file classification (13 files)

**MOVE** (12 files): `agent-stage-gate.test.ts`, `agent-state.test.ts`, `agent-integration.test.ts`, `e2e-stage-gate.test.ts`, `e2e-session-validation.test.ts`, `e2e-session-validators.ts`, `e2e-web-ref-rendering.test.ts`, `e2e-follow-up-context.test.ts`, `blockquote-normalization.test.ts`, `test-utils.ts`, `e2e-utils.ts`, `renderer.test.ts` (from `agent-render-output/__tests__/`)

**STAY** (1 file): `auth-debug-integration.test.ts`

### Key files table

| File | Path | Why involved |
|------|------|--------------|
| `session-tools-core/package.json` | `packages/session-tools-core/package.json` | Remove moved exports, add dep on new package |
| `session-tools-core/src/index.ts` | `packages/session-tools-core/src/index.ts` | Re-export agent handlers from new package |
| `session-tools-core/src/handlers/index.ts` | `packages/session-tools-core/src/handlers/index.ts` | Re-export agent handlers from new package |
| `shared/package.json` | `packages/shared/package.json` | Add dep on `@craft-agent/agent-pipeline-core` |
| `electron-build-main.ts` | `scripts/electron-build-main.ts` | Add new `--alias` for session server build |
| `session-scoped-tools.ts` | `packages/shared/src/agent/session-scoped-tools.ts` | Split imports |
| `stage-runner.ts` | `packages/shared/src/agent/orchestrator/stage-runner.ts` | Update 4 subpath imports |
| `synthesis-post-processor.ts` | `packages/shared/src/agent/orchestrator/synthesis-post-processor.ts` | Update 1 import |
| `test-full-pipeline-e2e.ts` | `scripts/test-full-pipeline-e2e.ts` | Update 4 relative paths |

---

## Phase 1: Scaffold new package `packages/agent-pipeline-core/`

- [x] 1.1 Create `packages/agent-pipeline-core/package.json`:
  ```json
  {
    "name": "@craft-agent/agent-pipeline-core",
    "version": "0.4.5",
    "type": "module",
    "main": "src/index.ts",
    "types": "src/index.ts",
    "exports": {
      ".": "./src/index.ts",
      "./renderer": "./src/handlers/agent-render-output/renderer.ts",
      "./renderer-types": "./src/handlers/agent-render-output/types.ts",
      "./renderer-config": "./src/handlers/agent-render-output/config-loader.ts",
      "./renderer-linker": "./src/handlers/agent-render-output/source-linker.ts"
    },
    "scripts": {
      "typecheck": "tsc --noEmit",
      "test": "npx tsx --test src/handlers/__tests__/*.test.ts"
    },
    "dependencies": {
      "gray-matter": "^4.0.3"
    },
    "devDependencies": {
      "typescript": "^5.8.2"
    }
  }
  ```
- [x] 1.2 Create `packages/agent-pipeline-core/tsconfig.json` (copy from session-tools-core, adjust paths)
- [x] 1.3 Create directory structure:
  ```
  packages/agent-pipeline-core/
    src/
      handlers/
        agent-render-output/
          __tests__/
        __tests__/
  ```
- [x] 1.4 Add `"@craft-agent/agent-pipeline-core": "workspace:*"` to root `pnpm-workspace.yaml` (auto-discovered via `packages/*` glob, no file change needed)
- [x] 1.5 Run `pnpm install` to link the new package
- [x] 1.6 Validate: package resolves in workspace (`pnpm m ls --depth -1` includes `@craft-agent/agent-pipeline-core`)

## Phase 2: Copy shared infra into new package

- [x] 2.1 Copy `session-tools-core/src/context.ts` → `agent-pipeline-core/src/context.ts`
- [x] 2.2 Copy `session-tools-core/src/types.ts` → `agent-pipeline-core/src/types.ts`
- [x] 2.3 Copy `session-tools-core/src/response.ts` → `agent-pipeline-core/src/response.ts`
- [x] 2.4 Create `agent-pipeline-core/src/validation-lite.ts` with 5 functions extracted from `validation.ts`:
  - `validResult()`, `invalidResult()`, `mergeResults()`, `formatValidationResult()`, `validateSlug()` + `SLUG_REGEX`
  - Zero deps: no zod, no gray-matter, no node:fs
  - Import `ValidationResult`, `ValidationIssue` from local `./types.ts`
- [x] 2.5 Verify each copied file has correct relative imports (all reference local `./types.ts`, `./context.ts`, `./response.ts`; `validation-lite.ts` imports only `ValidationResult` and `ValidationIssue`)

## Phase 3: Move handler files

- [x] 3.1 Move `session-tools-core/src/handlers/agent-stage-gate.ts` → `agent-pipeline-core/src/handlers/agent-stage-gate.ts` (copied into new package; original retained temporarily until cleanup phase)
  - Update import: `../context.ts`, `../types.ts`, `../response.ts` → same paths (structure preserved)
  - Import of `./agent-render-output/renderer.ts` (`injectSourceBlocks`) — moves with it, no change
- [x] 3.2 Move `session-tools-core/src/handlers/agent-state.ts` → `agent-pipeline-core/src/handlers/agent-state.ts` (copied into new package; original retained temporarily until cleanup phase)
- [x] 3.3 Move `session-tools-core/src/handlers/agent-validate.ts` → `agent-pipeline-core/src/handlers/agent-validate.ts` (copied into new package; original retained temporarily until cleanup phase)
  - Change import: `../validation.ts` → `../validation-lite.ts`
  - Replace import of `sourceExists` from `../source-helpers.ts` with inline:
    ```typescript
    import { existsSync } from 'node:fs';
    import { join } from 'node:path';
    function sourceExists(workspaceRootPath: string, slug: string): boolean {
      return existsSync(join(workspaceRootPath, 'sources', slug));
    }
    ```
- [x] 3.4 Move entire `session-tools-core/src/handlers/agent-render-output/` directory → `agent-pipeline-core/src/handlers/agent-render-output/` (copied into new package; original retained temporarily until cleanup phase)
  - All 6 files: `index.ts`, `renderer.ts`, `config-loader.ts`, `source-linker.ts`, `markdown-formatters.ts`, `types.ts`
  - Plus `__tests__/renderer.test.ts`
  - Internal imports are all siblings — no changes needed
  - `index.ts` imports `../../context.ts`, `../../types.ts`, `../../response.ts` — points to copied files, no change

## Phase 4: Move test files

- [x] 4.1 Move 11 test files from `session-tools-core/src/handlers/__tests__/` → `agent-pipeline-core/src/handlers/__tests__/` (copied into new package; originals retained temporarily until cleanup phase):
  - `agent-stage-gate.test.ts`
  - `agent-state.test.ts`
  - `agent-integration.test.ts`
  - `e2e-stage-gate.test.ts`
  - `e2e-session-validation.test.ts`
  - `e2e-session-validators.ts`
  - `e2e-web-ref-rendering.test.ts`
  - `e2e-follow-up-context.test.ts`
  - `blockquote-normalization.test.ts`
  - `test-utils.ts`
  - `e2e-utils.ts`
- [x] 4.2 Move `agent-render-output/__tests__/renderer.test.ts` (already handled in 3.4 via directory move)
- [x] 4.3 Verify `auth-debug-integration.test.ts` stays in session-tools-core
- [x] 4.4 Update any test imports that reference moved files (no rewrites needed; copied tests resolve against new package-relative handler paths)

## Phase 5: Create agent-pipeline-core index and session-tools-core re-exports

- [x] 5.1 Create `agent-pipeline-core/src/handlers/index.ts`:
  ```typescript
  // Agent Stage Gate
  export { handleAgentStageGate } from './agent-stage-gate.ts';
  export type { AgentStageGateArgs } from './agent-stage-gate.ts';
  // Agent State
  export { handleAgentState } from './agent-state.ts';
  export type { AgentStateArgs } from './agent-state.ts';
  // Agent Validate
  export { handleAgentValidate } from './agent-validate.ts';
  export type { AgentValidateArgs } from './agent-validate.ts';
  // Agent Render Output
  export { handleAgentRenderOutput } from './agent-render-output/index.ts';
  export type { AgentRenderOutputArgs } from './agent-render-output/index.ts';
  ```
- [x] 5.2 Create `agent-pipeline-core/src/index.ts`:
  - Export all types from `./types.ts` (only the types also used by agent handlers)
  - Export response helpers from `./response.ts`
  - Export context types from `./context.ts`
  - Export validation-lite functions from `./validation-lite.ts`
  - Export all 4 handlers + their arg types from `./handlers/index.ts`
- [x] 5.3 Update `session-tools-core/src/handlers/index.ts`:
  - Remove direct exports of `handleAgentStageGate`, `handleAgentState`, `handleAgentValidate`, `handleAgentRenderOutput` and their arg types
  - Add re-exports from `@craft-agent/agent-pipeline-core`:
    ```typescript
    // Re-export agent pipeline handlers for backward compatibility
    export {
      handleAgentStageGate,
      type AgentStageGateArgs,
      handleAgentState,
      type AgentStateArgs,
      handleAgentValidate,
      type AgentValidateArgs,
      handleAgentRenderOutput,
      type AgentRenderOutputArgs,
    } from '@craft-agent/agent-pipeline-core';
    ```
- [x] 5.4 Update `session-tools-core/package.json`:
  - Add dependency: `"@craft-agent/agent-pipeline-core": "workspace:*"`
  - Keep subpath exports (`./renderer`, `./renderer-types`, `./renderer-config`, `./renderer-linker`) temporarily for compatibility; migrate consumers in Phase 6, then remove legacy exports in cleanup
- [x] 5.5 Update `session-tools-core/src/index.ts`:
  - Replace direct handler exports with re-exports from `@craft-agent/agent-pipeline-core`
  - Keep all other exports (types, response helpers, source-helpers, validation, context) as-is
- [x] 5.6 Run `pnpm run typecheck:all` — pass

## Phase 6: Update consumers

- [x] 6.1 Update `shared/package.json`:
  - Add: `"@craft-agent/agent-pipeline-core": "workspace:*"`
- [x] 6.2 Update `session-scoped-tools.ts`:
  - Split agent handler imports from `@craft-agent/session-tools-core` to `@craft-agent/agent-pipeline-core`:
    ```typescript
    // Agent pipeline handlers (from agent-pipeline-core)
    import {
      handleAgentStageGate,
      handleAgentState,
      handleAgentValidate,
      handleAgentRenderOutput,
    } from '@craft-agent/agent-pipeline-core';
    ```
  - Keep other imports (ToolResult, AuthRequest) from `@craft-agent/session-tools-core`
- [x] 6.3 Update `stage-runner.ts` (4 imports):
  ```typescript
  import { renderDocument } from '@craft-agent/agent-pipeline-core/renderer';
  import type { FinalAnswer, RenderConfig, Citation, VerificationScores, SubQuery, WebReference } from '@craft-agent/agent-pipeline-core/renderer-types';
  import { mergeRenderConfig, extractOutputConfig } from '@craft-agent/agent-pipeline-core/renderer-config';
  import { createSourceLinker } from '@craft-agent/agent-pipeline-core/renderer-linker';
  ```
- [x] 6.4 Update `synthesis-post-processor.ts` (1 import):
  ```typescript
  import type { WebReference, PriorSection } from '@craft-agent/agent-pipeline-core/renderer-types';
  ```
- [x] 6.5 Update `orchestrator/__tests__/synthesis-post-processor.test.ts` (1 import):
  ```typescript
  import type { WebReference } from '@craft-agent/agent-pipeline-core/renderer-types';
  ```
- [x] 6.6 Update `scripts/test-full-pipeline-e2e.ts` (4 relative imports):
  - Change `../packages/session-tools-core/src/handlers/agent-render-output/renderer.ts` → `../packages/agent-pipeline-core/src/handlers/agent-render-output/renderer.ts`
  - Change `../packages/session-tools-core/src/handlers/agent-render-output/source-linker.ts` → `../packages/agent-pipeline-core/src/handlers/agent-render-output/source-linker.ts`
  - Change `../packages/session-tools-core/src/handlers/agent-render-output/types.ts` → `../packages/agent-pipeline-core/src/handlers/agent-render-output/types.ts`
  - Change `../packages/session-tools-core/src/handlers/agent-render-output/config-loader.ts` → `../packages/agent-pipeline-core/src/handlers/agent-render-output/config-loader.ts`
- [x] 6.7 **session-mcp-server**: No changes needed (imports from `@craft-agent/session-tools-core` which re-exports from `agent-pipeline-core`)
- [x] 6.8 Run `pnpm run typecheck:all` — pass
- [x] 6.9 Run `pnpm run lint` — baseline fail (existing unrelated Electron lint errors)

## Phase 7: Update build scripts

- [x] 7.1 Update `scripts/electron-build-main.ts`:
  - Add constant: `const AGENT_PIPELINE_CORE_DIR = join(ROOT_DIR, "packages/agent-pipeline-core");`
  - In `buildSessionServer()`, add alias for the new package:
    ```typescript
    `--alias:@craft-agent/agent-pipeline-core=${join(AGENT_PIPELINE_CORE_DIR, "src/index.ts")}`,
    ```
  - Add verification in `verifySessionToolsCore()` for the new package's `src/index.ts`
- [x] 7.2 Update root `package.json` test scripts if needed:
  - Check `test:e2e` glob pattern — if it uses `packages/session-tools-core/**/__tests__/*.test.ts`, add `packages/agent-pipeline-core/**/__tests__/*.test.ts`
- [x] 7.3 Update `agent-pipeline-core/package.json` test script glob to also cover `src/handlers/agent-render-output/__tests__/*.test.ts`
- [x] 7.4 Run full build: `pnpm run electron:build` — pass
- [x] 7.5 Run `pnpm run typecheck:all` — pass

## Phase 8: Clean up and verify

- [x] 8.1 Verify all 4 handler files are DELETED from `session-tools-core/src/handlers/`
- [x] 8.2 Verify `agent-render-output/` directory is DELETED from `session-tools-core/src/handlers/`
- [x] 8.3 Verify the 11 test files are DELETED from `session-tools-core/src/handlers/__tests__/` (only `auth-debug-integration.test.ts` remains)
- [x] 8.4 Verify `session-tools-core/src/handlers/index.ts` only has re-exports for agent handlers + direct exports for platform handlers
- [-] 8.5 Run full test suite: `pnpm run test` (fails due pre-existing test environment issues, including `bun:` URL scheme imports and long-running live orchestrator segment)
- [x] 8.6 Run E2E tests: `pnpm run test:e2e` — pass (all 232 tests)
  - Fixed BOM (U+FEFF) in `agents/isa-deep-research/AGENT.md` breaking frontmatter regex
  - Updated `e2e-isa-guide-pipeline.test.ts` and `e2e-isa-websearch-pipeline.test.ts` to read `prompts/stage-*.md` files (stage content moved from AGENT.md to individual prompt files)
- [x] 8.7 Run `pnpm run typecheck:all` — final check (pass)
- [-] 8.8 Run `pnpm run lint` — final check (fails with existing unrelated Electron lint violations)
- [x] 8.9 Verify `pnpm run electron:build` succeeds end-to-end (pass)

## Phase 9: Post-extraction hardening

- [x] 9.1 Deduplicate shared infra files — `types.ts`, `response.ts`, `context.ts` in session-tools-core replaced with thin re-export shims pointing to `@craft-agent/agent-pipeline-core`
- [x] 9.2 Add esbuild aliases for subpath exports (`types`, `response`, `context`) in `scripts/electron-build-main.ts`
- [x] 9.3 Deduplicate `validation.ts` — re-export `validResult`, `invalidResult`, `SLUG_REGEX`, etc. from `agent-pipeline-core` instead of redefining
- [x] 9.4 Expand `FileSystemInterface` with `mkdir`, `appendFile`, `rename`, `unlink` methods
  - Updated all implementations: `createNodeFileSystem()`, `createClaudeContext()`, test-utils `createRealFileSystem()`
- [x] 9.5 Remove `node:fs` imports from pipeline handlers — `agent-stage-gate.ts`, `agent-state.ts`, `agent-validate.ts` now exclusively use `ctx.fs` abstraction
- [x] 9.6 Fix stale comments — update all "Session Tools Core" references in `agent-pipeline-core/src/` to "Agent Pipeline Core"
- [x] 9.7 Run `pnpm run typecheck:all` — pass
- [x] 9.8 Run `pnpm run electron:build` — pass

## Risks & Considerations

| Risk | Mitigation |
|------|------------|
| Circular dependency session-tools-core ↔ agent-pipeline-core | One-way only: session-tools-core → agent-pipeline-core. Never reverse. |
| esbuild alias for session server misses new package | Phase 7.1 adds alias explicitly; Phase 9.2 adds subpath aliases |
| Shared infra diverges over time | Eliminated: session-tools-core files replaced with re-export shims from agent-pipeline-core |
| gray-matter dependency required by agent-validate.ts | Added to agent-pipeline-core/package.json dependencies |
| validation.ts has zod/gray-matter deps but agent-validate only needs 5 pure functions | validation-lite.ts extracts just those 5 with zero deps |
| sourceExists import breaks in moved agent-validate.ts | Uses `ctx.fs.exists()` through context abstraction |
| Direct `node:fs` imports break environment portability | Phase 9.4-9.5: expanded `FileSystemInterface`, all handlers use `ctx.fs` |
| session-mcp-server uses `bun build` in package.json scripts | Not changed — actual build uses electron-build-main.ts esbuild |
| Test glob paths may not match new location | Phase 7.2-7.3 explicitly verifies and updates all globs |
| E2E tests break when AGENT.md content is refactored | Tests updated to scan `prompts/stage-*.md` alongside AGENT.md |

## Testing Strategy

Each phase ends with relevant validation:
- **Phase 1**: `pnpm install`, `pnpm ls` verify package resolution
- **Phase 2-4**: No independent validation needed (files copied/moved but not yet wired)
- **Phase 5**: `pnpm run typecheck:all` (first full compile check)
- **Phase 6**: `pnpm run typecheck:all` + `pnpm run lint`
- **Phase 7**: `pnpm run electron:build` (full build test)
- **Phase 8**: `pnpm run test`, `pnpm run test:e2e`, `pnpm run typecheck:all`, `pnpm run lint`, `pnpm run electron:build`

---

_Last updated: 2026-02-26_

---

# Implementation Plan: Fix Session Resume Failure — `runMiniCompletion` cwd Isolation

## Goal

Fix the ~43% session resume failure rate caused by `runMiniCompletion()` launching SDK subprocesses that share the same project-directory hash as the main `chat()`, corrupting transcripts when running concurrently.

## Root Cause

`runMiniCompletion()` in `claude-agent.ts` calls `query({ prompt, options })` **without a `cwd` option**. The SDK uses `cwd` to derive a project-directory hash for transcript storage at `~/.claude/projects/<hash>/`. When `generateTitle()` fires concurrently (fire-and-forget), both subprocesses write to the same hash directory, corrupting the main chat's transcript. On the next message, resume fails with "No conversation found with session ID".

**Note**: `git diff main` confirms zero changes to `claude-agent.ts` / `base-agent.ts` / `sessions.ts` on any branch. The bug is latent everywhere — "main works" is timing luck, not a fix.

## Collision Vectors (all share `runMiniCompletion`)

| Caller | Risk |
|--------|------|
| `generateTitle()` — fire-and-forget at session creation | **HIGH** |
| `regenerateTitle()` — user-initiated, can overlap ongoing chat | **MEDIUM** |
| `handleLargeToolResult()` / `getSummarizeCallback()` — during tool results | **MEDIUM** |

## Phases

### Phase 1: Fix `runMiniCompletion()` cwd isolation

- [x] Add `import { tmpdir } from 'node:os'` to `claude-agent.ts`
- [x] Add `cwd: tmpdir()` to options in `runMiniCompletion()` to isolate SDK transcript storage
- [x] Add `persistSession: false` to prevent transcript accumulation for ephemeral completions
- [x] Add JSDoc comment documenting the race condition and why cwd isolation is required

### Phase 2: Add regression test

- [x] Create `packages/shared/src/agent/__tests__/mini-completion-isolation.test.ts`
- [x] Test: verify `import { tmpdir } from 'node:os'` exists in source
- [x] Test: verify `cwd: tmpdir()` appears in runMiniCompletion options
- [x] Test: verify `persistSession: false` appears in options
- [x] Test: verify `cwd` appears AFTER `...getDefaultOptions()` spread (not overridden)
- [x] Test: verify JSDoc documents the race condition
- [x] Test: verify `tmpdir()` resolves to valid string on this platform

### Phase 3: Validate

- [x] `pnpm run typecheck:all` — passes (0 errors)
- [x] `pnpm run lint` — passes (0 new errors; 5 pre-existing errors in unrelated files)
- [x] New test — 6/6 pass via `npx tsx --test`
- [x] `pnpm run test:e2e` — 177 pass, 0 fail, 1 skip (unchanged from baseline)
- [ ] Manual test: two-message session without resume failure
- [ ] Manual test: title regeneration during active chat

## Files Changed

| File | Change |
|------|--------|
| `packages/shared/src/agent/claude-agent.ts` | Added `import { tmpdir } from 'node:os'`; added `cwd: tmpdir()` and `persistSession: false` to `runMiniCompletion()` options; expanded JSDoc |
| `packages/shared/src/agent/__tests__/mini-completion-isolation.test.ts` | New test file — 6 assertions verifying cwd isolation fix |

---

_Last updated: 2026-02-27_

---

# Implementation Plan: Fix Session Resume Failure — Transcript Validation Before Resume (Option A)

## Goal

Eliminate "Restoring conversation context..." on the second turn of new chat sessions by validating SDK transcript files before attempting `{ resume: sessionId }`. If the transcript is empty or contains only dequeue records, skip resume and start a fresh session — avoiding the SESSION_RECOVERY path entirely.

## Root Cause (Detailed)

The SDK `query()` API spawns a new subprocess per turn. On the first turn:

1. SDK emits a `system:init` message containing a `session_id`
2. `claude-agent.ts` L1483–1493 captures this ID and persists it via `onSdkSessionIdUpdate`
3. The subprocess exits, leaving a transcript file at `~/.claude/projects/{cwd-slug}/{sessionId}.jsonl`
4. **The transcript file is only ~139 bytes**, containing just a `queue-operation: dequeue` record — no conversation data

On the second turn:

5. `claude-agent.ts` L1363 builds `{ resume: this.sessionId }` using the persisted ID
6. The new subprocess tries to resume this session but finds "No conversation found"
7. SESSION_RECOVERY fires (L1565–1575 or L1588–1608), clearing the session and retrying with injected context
8. The user sees "Restoring conversation context..." — an unnecessary degradation

**Why the `runMiniCompletion` fix (above) is necessary but not sufficient**: The cwd isolation fix prevents `generateTitle()` from corrupting the main chat's transcript. But the dequeue-only transcript is produced by the main chat path's own first-turn lifecycle — not by any race condition. Both fixes are needed.

## Analysis

### SDK Transcript Layout

- **Config dir**: `~/.claude/` (or `CLAUDE_CONFIG_DIR`)
- **Project dir**: `~/.claude/projects/{cwd-slug}/` where slug = CWD path with `[:\\/]` replaced by `-`
- **Transcript file**: `{project-dir}/{sessionId}.jsonl`
- A transcript is "resumable" if it exists, is >500 bytes, and contains at least one `assistant` message type

### Validation Strategy

Read the transcript file and check:
1. File exists at expected path
2. File size >500 bytes (dequeue-only files are ~139 bytes)
3. Contains at least one line with `"type":"assistant"` (proves actual conversation happened)

If any check fails → clear the session ID, skip resume, start fresh. No "Restoring conversation context..." message needed.

### Key Code Points

| Location | Line(s) | Role |
|----------|---------|------|
| `claude-agent.ts` | L499 | Session ID initialization from persisted config |
| `claude-agent.ts` | L828–829 | `cwd` option (sdkCwd) passed to SDK — determines transcript path |
| `claude-agent.ts` | L1363 | Resume decision: `...(!_isRetry && this.sessionId ? { resume: ... } : {})` |
| `claude-agent.ts` | L1483–1493 | Session ID capture from `system:init` |
| `claude-agent.ts` | L1565–1575 | SESSION_RECOVERY: result-error channel (session expired) |
| `claude-agent.ts` | L1588–1608 | SESSION_RECOVERY: empty response detection |
| `claude-agent.ts` | L1857–1870 | SESSION_RECOVERY: wasResuming fallback retry |
| `sessions.ts` | L2524–2536 | `onSdkSessionIdUpdate` / `onSdkSessionIdCleared` callbacks |

## Key Files

| File | Path | Why involved |
|------|------|--------------|
| `claude-agent.ts` | `packages/shared/src/agent/claude-agent.ts` | Resume logic, session ID lifecycle |
| `sdk-transcript-validator.ts` | `packages/shared/src/agent/sdk-transcript-validator.ts` | **NEW** — transcript validation utility |
| `sessions.ts` | `apps/electron/src/main/sessions.ts` | Post-completion validation, title-gen cleanup |
| `sdk-transcript-validator.test.ts` | `packages/shared/src/agent/__tests__/sdk-transcript-validator.test.ts` | **NEW** — unit tests |

---

## Phase 1: Create transcript validation utility

Create `packages/shared/src/agent/sdk-transcript-validator.ts`:

- [x] 1.1 Implement `getSdkConfigDir()`: returns `process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')`
- [x] 1.2 Implement `slugifyCwd(cwd: string)`: replaces `[:\\/]` with `-` to match SDK slug computation
- [x] 1.3 Implement `getTranscriptPath(sdkCwd: string, sessionId: string)`: returns full path `{configDir}/projects/{slug}/{sessionId}.jsonl`
- [x] 1.4 Implement `isResumableTranscript(sdkCwd: string, sessionId: string)`: returns `boolean`
  - Check file exists via `existsSync`
  - Check file size >500 bytes via `statSync`
  - Read first 8KB and check for `"type":"assistant"` substring
  - Return `false` on any error (file missing, permission denied, etc.)
- [x] 1.5 Export all 4 functions (+ added to agent index.ts)
- [x] 1.6 Add JSDoc documenting why each check is needed and the 139-byte dequeue-only failure mode

## Phase 2: Pre-resume validation in `claude-agent.ts`

- [x] 2.1 Import `isResumableTranscript` from `./sdk-transcript-validator.ts`
- [x] 2.2 Replaced static resume spread with IIFE that validates transcript before building `{ resume }` option
- [x] 2.3 The resume option naturally skips resume when transcript is not resumable (session ID cleared inline)
- [x] 2.4 Added debug + console.error logging for invalid transcript cases

## Phase 3: Post-completion validation

- [x] 3.1 Added post-completion transcript validation in `complete` event handler — clears invalid `sdkSessionId` and persists
- [x] 3.2 Added `isResumableTranscript` to import from `@craft-agent/shared/agent`
- [x] 3.3 Added session log warning for cleared IDs

## Phase 4: Revert sessions.ts title-gen isolation

The `generateTitle()` in `sessions.ts` was modified to create a temporary agent with an isolated `sdkCwd` (L5254–5335). This is now **redundant** because `runMiniCompletion()` in `claude-agent.ts` already uses `cwd: tmpdir()` and `persistSession: false`.

- [x] 4.1 Reverted `generateTitle()` to original: uses `managed.agent` first, waits for it, creates temporary agent only as fallback
- [x] 4.2 Removed `import { tmpdir } from 'os'` from sessions.ts (no longer used)
- [x] 4.3 Verified: `runMiniCompletion` uses `cwd: tmpdir()` + `persistSession: false` — temporary-agent approach is unnecessary

## Phase 5: Testing & Validation

- [x] 5.1 Created `sdk-transcript-validator.test.ts` — 15 tests (6 slugifyCwd, 2 getSdkConfigDir, 2 getTranscriptPath, 5 isResumableTranscript)
- [x] 5.2 `pnpm run typecheck:all` — pass (0 errors)
- [x] 5.3 `pnpm run lint` — pass (0 new violations; 5 pre-existing errors in unrelated files)
- [x] 5.4 `pnpm run test:e2e` — 177 pass, 0 fail, 1 skip (unchanged from baseline)
- [x] 5.5 `pnpm run electron:build` — pass
- [ ] 5.6 Manual test: two-message session should NOT show "Restoring conversation context..."
- [ ] 5.7 Manual test: existing session with valid transcript should resume normally

## Risks & Considerations

| Risk | Mitigation |
|------|------------|
| SDK changes transcript path format in future | `slugifyCwd` mirrors documented SDK behavior; add a debug log if path doesn't exist |
| Transcript file is valid but not yet flushed when checked | Check happens before `query()` call — by then the previous turn's subprocess has exited and flushed |
| `isResumableTranscript` reads disk on every turn | File is local, <4KB read, negligible latency (~1ms) |
| Reverting title-gen isolation breaks concurrent title gen | `runMiniCompletion` already isolates via `cwd: tmpdir()` and `persistSession: false` |
| False negative: valid transcript rejected | 500-byte threshold is conservative; dequeue-only is ~139 bytes, real transcripts are >2KB |
| `CLAUDE_CONFIG_DIR` env override not handled | Phase 1.1 checks `process.env.CLAUDE_CONFIG_DIR` first |

## Relationship to Previous Fix

This plan works **alongside** the `runMiniCompletion` cwd isolation fix (above):

| Fix | What it prevents |
|-----|-----------------|
| `runMiniCompletion` cwd isolation | Title gen / summarization corrupting the main chat transcript |
| Transcript validation (this plan) | Attempting to resume a dequeue-only transcript that has no conversation data |

Both are required. The cwd isolation prevents future transcript corruption; the transcript validation handles the case where the first turn's transcript is inherently non-resumable.

---

_Last updated: 2026-02-27_
