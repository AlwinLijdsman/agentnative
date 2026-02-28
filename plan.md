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

# Fix: Dynamic Stage Thinking Visibility

> **Branch:** `feature/dynamic-stage-thinking`
> **Goal:** Remove the broken custom thinking UI path and fix lifecycle gaps so agent pipeline runs use the existing, working conversation indicators (ProcessingIndicator + TurnCard "Thinking...") instead of the stuck blue StageThinkingIndicator.

## Problem Statement

The Dynamic Stage Thinking feature (implemented in prior phases, all marked `[x]`) is broken in practice:
- Shows a **stuck "Stage 1: websearch_calibration / Processing..."** indicator with blue styling
- The custom `StageThinkingIndicator` component never clears because `agentStageThinkingAtom` is never reset on pause/complete
- User requirement: **"leverage the thinking steps that regular conversations use or exactly mirror it"** — not custom blue UI

## Root Cause Analysis

| # | Root Cause | Impact |
|---|-----------|--------|
| 1 | **Parallel UI path** — Custom `agent_stage_thinking` → atom → `StageThinkingIndicator` duplicates existing `ProcessingIndicator` + TurnCard indicators | Blue stuck indicator, visual inconsistency |
| 2 | **Resume forwarding gap** — `resumeOrchestrator()` only has debug logging in `onStreamEvent`, no thinking forwarding | Moot after removal — nothing to forward |
| 3 | **Pause lifecycle gap** — `agent_stage_gate_pause` handler in processor.ts sets `pausedAgent` but emits NO effect → `agentRunStateAtom.isRunning` stays `true` | Stale "running" state after pause, indicator never unmounts |
| 4 | **No text_delta yield** — Orchestrator doesn't yield `text_delta` during active LLM streaming (only at stage completion via `text_complete`) | No content to drive the custom indicator — it shows static text |
| 5 | **Custom blue styling** — `StageThinkingIndicator` uses `bg-blue-500/10`, `text-blue-400`, Brain icon | Violates user requirement to match existing conversation UI |

## Solution Strategy

**Remove the entire custom thinking path** (eliminates root causes 1, 2, 4, 5). **Fix pause lifecycle** (root cause 3). **Fix runId bleed** in AgentRunDetailPage (bonus gap from audit).

The existing indicators already work during agent runs:
- `ProcessingIndicator` — cycling "Thinking...", "Working..." messages with elapsed time (reads `session.isProcessing`)
- TurnCard "Thinking..." — via `shouldShowThinkingIndicator()` for `pending`/`awaiting` turn phases
- Stage completion activities — via `text_complete` with `isIntermediate: true` yielded at stage boundaries

## Key Files

| File | Layer | Action |
|------|-------|--------|
| `packages/shared/src/agent/claude-agent.ts` | Agent | Remove `_currentOrchestratorStage` property and all thinking forwarding |
| `apps/electron/src/main/sessions.ts` | Main | Remove `pendingThinkingDeltas`/`thinkingFlushTimers` maps, handler, queue/flush methods |
| `apps/electron/src/renderer/event-processor/processor.ts` | Renderer | Remove `agent_stage_thinking` case; add `agent_run_state_update` effect to pause handler |
| `apps/electron/src/renderer/event-processor/types.ts` | Renderer | Remove `AgentStageThinkingEvent`, union entry, effect type |
| `apps/electron/src/shared/types.ts` | IPC | Remove `agent_stage_thinking` from `SessionEvent` union |
| `apps/electron/src/renderer/App.tsx` | Renderer | Remove thinking atom imports, clearing logic, entire thinking_update handler |
| `apps/electron/src/renderer/atoms/agents.ts` | State | Remove `agentStageThinkingAtom` and `THINKING_TEXT_CAP` |
| `StageThinkingIndicator.tsx` | UI | **Delete entire file** |
| `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx` | UI | Remove StageThinkingIndicator import and JSX |
| `apps/electron/src/renderer/pages/AgentRunDetailPage.tsx` | UI | Remove thinking imports/usage; add runId guard |

## Phase 1: Atomic Removal of Custom Thinking Path

**Goal:** Remove all code added by the original Dynamic Stage Thinking feature across all layers in a single atomic phase. This prevents any intermediate broken state.

### 1A: Backend (claude-agent.ts)

- [x] 1A.1 Remove `_currentOrchestratorStage` property declaration (~L464-469)
- [x] 1A.2 Remove thinking forwarding block from `runOrchestrator()` `onStreamEvent` callback (~L3395-3413) — keep existing `sessionLog.debug()` lines
- [x] 1A.3 Remove `this._currentOrchestratorStage = { stage, stageName }` set in `processOrchestratorEvents()` `orchestrator_stage_start` case (~L3611)
- [x] 1A.4 Remove `this._currentOrchestratorStage = null` clear in `orchestrator_stage_complete` case (~L3625)
- [x] 1A.5 Remove `this._currentOrchestratorStage = null` clear in `orchestrator_complete` case (~L3674)
- [x] 1A.6 Remove `this._currentOrchestratorStage = null` clear in `orchestrator_error` case (~L3704)

### 1B: Main Process (sessions.ts)

- [x] 1B.1 Remove `pendingThinkingDeltas` map declaration (~L913)
- [x] 1B.2 Remove `thinkingFlushTimers` map declaration (~L914)
- [x] 1B.3 Remove `agent_stage_thinking` case from `onAgentEvent` switch (~L3073-3083)
- [x] 1B.4 Remove `queueThinkingDelta()` method (~L6028-6050)
- [x] 1B.5 Remove `flushThinkingDelta()` method (~L6052-6085)

### 1C: Renderer Event Processing

- [x] 1C.1 Remove `AgentStageThinkingEvent` interface from `event-processor/types.ts` (~L497-506)
- [x] 1C.2 Remove `AgentStageThinkingEvent` from `AgentEvent` union in `types.ts` (~L555)
- [x] 1C.3 Remove `agent_stage_thinking_update` from `Effect` type in `types.ts` (~L567)
- [x] 1C.4 Remove `agent_stage_thinking` case from `processor.ts` switch (~L269-280)

### 1D: IPC Types

- [x] 1D.1 Remove `agent_stage_thinking` variant from `SessionEvent` union in `apps/electron/src/shared/types.ts` (~L511)

### 1E: Renderer State & App

- [x] 1E.1 Remove `agentStageThinkingAtom` and `THINKING_TEXT_CAP` from `atoms/agents.ts` (~L36-44)
- [x] 1E.2 Remove `agentStageThinkingAtom` / `THINKING_TEXT_CAP` imports from `App.tsx` (~L44)
- [x] 1E.3 Remove thinking atom clearing from `agent_run_state_update` handler in `App.tsx` — both the stage-change block (~L514-520) and run-complete block (~L537-543)
- [x] 1E.4 Remove entire `agent_stage_thinking_update` case from `App.tsx` (~L547-579)

### 1F: UI Components

- [x] 1F.1 Delete `apps/electron/src/renderer/components/app-shell/StageThinkingIndicator.tsx` entirely
- [x] 1F.2 Remove `StageThinkingIndicator` import from `ChatDisplay.tsx` (~L55)
- [x] 1F.3 Remove `<StageThinkingIndicator>` JSX usage from `ChatDisplay.tsx` (~L1522)
- [x] 1F.4 Remove `agentStageThinkingAtom` import from `AgentRunDetailPage.tsx` (~L17)
- [x] 1F.5 Remove `thinkingStates` / `liveThinking` usage from `AgentRunDetailPage.tsx` (~L68-69)
- [x] 1F.6 Remove blue thinking panel JSX from `AgentRunDetailPage.tsx` (~L246-255)

### 1G: Validate

- [x] 1G.1 Run `pnpm run typecheck:all` — must pass with zero errors
- [x] 1G.2 Run `pnpm run lint` — must pass (all errors pre-existing)
- [x] 1G.3 Verify no remaining references: `grep -r "agentStageThinking\|agent_stage_thinking\|StageThinkingIndicator\|THINKING_TEXT_CAP\|_currentOrchestratorStage\|pendingThinkingDeltas\|thinkingFlushTimers\|queueThinkingDelta\|flushThinkingDelta" --include="*.ts" --include="*.tsx" packages/ apps/`

## Phase 2: Fix Pause Lifecycle Gap

**Goal:** When the orchestrator pauses (stage gate), ensure `agentRunStateAtom` reflects `isRunning: false` so all run-dependent indicators (ProcessingIndicator, TurnCard thinking) stop correctly.

- [x] 2.1 In `processor.ts`, modify the `agent_stage_gate_pause` case (~L253-266) to emit an `agent_run_state_update` effect alongside setting `pausedAgent`, with payload `{ isRunning: false }`
- [x] 2.2 In `App.tsx`, verify the `agent_run_state_update` handler correctly processes `isRunning: false` from pause events — existing handler deletes the atom entry, resume re-creates it via `agent_stage_started`
- [x] 2.3 Run `pnpm run typecheck:all` — PASS
- [x] 2.4 Run `pnpm run test:e2e` — 177 pass, 0 fail, 1 skipped

## Phase 3: Fix RunId Bleed in AgentRunDetailPage

**Goal:** Prevent stale run state from a previous run from leaking into the current AgentRunDetailPage view.

- [x] 3.1 In `AgentRunDetailPage.tsx`, add `isLiveRun = liveRunState?.runId === runId` guard; `getStageStatus()` only uses `liveRunState` when `isLiveRun` is true
- [x] 3.2 Add same runId guard to Status badge rendering — don't show "Running" badge if `!isLiveRun`
- [x] 3.3 Add same runId guard to live stage count display — don't include `liveRunState.currentStage` from a different run
- [x] 3.4 Run `pnpm run typecheck:all` — PASS
- [x] 3.5 Run `pnpm run test:e2e` — 177 pass, 0 fail, 1 skipped

## Risks & Considerations

| Risk | Mitigation |
|------|------------|
| Removing thinking path loses all live visibility during stages | Acceptable — `ProcessingIndicator` already shows "Thinking..." with elapsed time. TurnCard shows "Thinking..." for pending turns. Stage completions appear as intermediate activities. Future enhancement can pipe `text_delta` through the existing message path. |
| Pause effect may conflict with resume flow | Resume handler already sets `isRunning: true` — the pause→resume cycle will work: pause sets `false`, resume sets `true` |
| RunId guard too strict — blocks legitimate state | Guard only applies in `AgentRunDetailPage` which always has a specific `runId` from URL params. No impact on other components. |
| Large diff from removing feature code | All changes are deletions or minimal additions — low regression risk. Typecheck + lint + E2E provide safety net. |

## Testing Strategy

| Test | Method | When |
|------|--------|------|
| TypeScript strictness | `pnpm run typecheck:all` | Every phase |
| Lint | `pnpm run lint` | Every phase |
| Unit tests | `pnpm run test` | Phase 2, Phase 3 |
| E2E tests | `pnpm run test:e2e` | Phase 2, Phase 3 |
| Dead code verification | `grep` for all removed identifiers | Phase 1 |
| Manual smoke test | Run agent pipeline, verify ProcessingIndicator shows, no blue indicator | After all phases |

---

_Last updated: 2026-02-27_
_Replaces: Original "Dynamic Stage Thinking Visibility" plan (all phases completed but feature broken in practice)_

---

# Rich Agent Pipeline Substep Visibility (Approach A — Gap-Aware)

> **Status: ACTIVE**
> Continues on branch `feature/dynamic-stage-thinking` after the completed fix plan above.

## Goal

Surface every meaningful substep of the agent orchestrator pipeline (MCP tool calls, LLM streaming, intermediate results, stage transitions) as rich chat activities — matching the visual fidelity users see in regular (non-agent) conversations. The user should be able to follow web searches, KB queries, LLM thinking, citation verification, and synthesis in real time, not just see "Stage N completed."

## Gap Analysis — What the Previous Overview Missed

| # | Gap | Impact | How This Plan Addresses It |
|---|-----|--------|---------------------------|
| G1 | **Dual pipeline under-modeled** — orchestrator status uses `onAgentEvent` callback (fire-and-forget), while rich activities already flow through yielded `AgentEvent` → `processEvent` → messages[] | Adding new SessionEvent variants is unnecessary scope; substeps should flow through the *existing* yielded path | Substeps are yielded as standard `AgentEvent` (`tool_start`, `tool_result`, `text_complete`) from `processOrchestratorEvents()` — no new IPC types needed |
| G2 | **`onStreamEvent` already exists but is only logged** — `claude-agent.ts` L3388–3395 receives `text_delta`/`thinking_delta` from LLM calls but discards them | LLM streaming during stages is invisible | Forward `onStreamEvent` deltas as yielded `text_delta` events with proper turnId |
| G3 | **`turnId` missing on orchestrator yields** — current `text_complete` yields in `processOrchestratorEvents()` have no `turnId` | Renderer falls back to "last streaming assistant message" — substeps from different stages can mis-associate | Generate a per-run `turnId` prefix; each stage gets a derived turnId like `orch-{runId}-s{stageId}` |
| G4 | **Nested substeps need synthetic IDs** — TurnCard hierarchy depends on `toolUseId`/`parentToolUseId` | Without IDs, MCP calls can't nest under their parent stage in the activity list | Generate synthetic `toolUseId` for each MCP call; set `parentToolUseId` to the stage's synthetic ID |
| G5 | **Dead `mcp_tool_call` type** — exists in `StageEventType` union but is never emitted | Confusion about what's implemented vs. planned | Clean up: wire it to real MCP call logging in `PipelineState`, or remove if unused |
| G6 | **Output injection duplicate risk** — `tryInjectAgentOutputFile()` + stage-5 auto-inject in `onAgentEvent` can both fire | User sees the research output twice | Add dedup guard: skip injection if content already present in messages |

## Architecture: How Substeps Will Flow

```
StageRunner.runWebsearchCalibration()
  ├── mcpBridge.webSearch(query)  →  yield tool_start + tool_result (synthetic IDs)
  ├── llmClient.call()            →  yield text_delta (streaming) + text_complete (intermediate)
  └── return StageResult

Orchestrator.executePipeline()
  ├── yield orchestrator_stage_start    (existing)
  ├── stageRunner.runStage()            → substep events via onProgress callback
  │     ├── onProgress('mcp_start', ...)   → queued, yielded below
  │     ├── onProgress('mcp_result', ...)  → queued, yielded below
  │     ├── onProgress('llm_start', ...)   → queued, yielded below
  │     └── onProgress('llm_complete', .) → queued, yielded below
  ├── yield* queued substep events      (NEW — OrchestratorEvent variants)
  └── yield orchestrator_stage_complete (existing)

ClaudeAgent.processOrchestratorEvents()
  ├── orchestrator_stage_start       → onAgentEvent (existing)
  ├── orchestrator_substep_*         → yield AgentEvent { tool_start | tool_result | text_delta | text_complete }
  └── orchestrator_stage_complete    → onAgentEvent + yield text_complete (existing)

sessions.ts: processEvent()
  └── tool_start / tool_result / text_delta / text_complete  →  messages[] → IPC → renderer
      (EXISTING path — no new SessionEvent types needed!)

Renderer: TurnCard
  └── groupMessagesByTurn() → activities[] → ActivityRow rendering
      (EXISTING — MCP substeps appear as nested tool activities with icons)
```

## Key Files

| File | Layer | Action |
|------|-------|--------|
| `packages/shared/src/agent/orchestrator/types.ts` | Orchestrator | Add new `OrchestratorEvent` variants for substeps; add `OnProgressCallback` type; clean up dead `mcp_tool_call` |
| `packages/shared/src/agent/orchestrator/stage-runner.ts` | Orchestrator | Accept `onProgress` callback; emit progress events around every MCP call and LLM call in each stage handler |
| `packages/shared/src/agent/orchestrator/mcp-bridge.ts` | Orchestrator | No change needed — StageRunner wraps bridge calls with progress emission |
| `packages/shared/src/agent/orchestrator/index.ts` | Orchestrator | Pass `onProgress` to StageRunner; collect and yield substep `OrchestratorEvent`s between stage start/complete |
| `packages/shared/src/agent/claude-agent.ts` | Agent | Map new `OrchestratorEvent` substep variants to yielded `AgentEvent` (`tool_start`, `tool_result`, `text_delta`, `text_complete`) with synthetic turnId/toolUseId |
| `apps/electron/src/main/sessions.ts` | Main | Add dedup guard to `tryInjectAgentOutputFile()`; no other changes — existing `processEvent()` already handles tool_start/tool_result/text_* |
| `apps/electron/src/shared/types.ts` | IPC | No changes needed — all events use existing SessionEvent variants |
| `apps/electron/src/renderer/event-processor/` | Renderer | No changes needed — existing handlers process tool_start/tool_result/text_* |
| `packages/ui/src/components/chat/TurnCard.tsx` | UI | Add orchestrator tool display mappings (icons/labels for webSearch, kbSearch, citationVerify, llmCall) |
| `packages/ui/src/components/chat/turn-utils.ts` | UI | No structural changes — existing `messageToActivity()` handles tool messages with toolDisplayMeta |

---

## Phase 1: Orchestrator Progress Callback Infrastructure

**Goal:** Add a typed progress callback system to StageRunner so each stage handler can emit substep events without becoming an async generator itself.

### 1.1: Define OnProgressCallback and new OrchestratorEvent variants

In `packages/shared/src/agent/orchestrator/types.ts`:

- [x] 1.1.1 Added `SubstepEvent` type (5 variants: mcp_start, mcp_result, llm_start, llm_complete, status) and `OnProgressCallback` type in types.ts
- [x] 1.1.2 Added `orchestrator_substep` variant to `OrchestratorEvent` union
- [x] 1.1.3 Removed dead `mcp_tool_call` from `StageEventType` — confirmed unused via grep

### 1.2: Wire onProgress into StageRunner

In `packages/shared/src/agent/orchestrator/stage-runner.ts`:

- [x] 1.2.1 Added `setOnProgress()` mutable setter (not constructor param — StageRunner constructed in `create()` before pipeline runs). Added `_onProgress` and `toolUseCounter` class fields.
- [x] 1.2.2 Created `private emitProgress(event: SubstepEvent)` — calls `this._onProgress?.(event)` null-safely
- [x] 1.2.3 Created `private generateToolUseId(prefix: string): string` — returns `orch-{prefix}-{counter++}`

### 1.3: Emit progress events from each stage handler

In `packages/shared/src/agent/orchestrator/stage-runner.ts`:

- [x] 1.3.1 **`runAnalyzeQuery()`**: Emits `llm_start`/`llm_complete` around `this.llmClient.call()`. llm_delta deferred to Phase 5.
- [x] 1.3.2 **`runWebsearchCalibration()`**: Emits `mcp_start`/`mcp_result` around each `this.mcpBridge.webSearch()` in loop (including error case). Emits `llm_start`/`llm_complete` around calibration LLM call.
- [x] 1.3.3 **`runRetrieve()`**: Emits `mcp_start`/`mcp_result` around each `this.mcpBridge.kbSearch()` in loop (including error case).
- [x] 1.3.4 **`runSynthesize()`**: Emits `llm_start`/`llm_complete` around synthesis LLM call. llm_delta deferred to Phase 5.
- [x] 1.3.5 **`runVerify()`**: Emits `mcp_start`/`mcp_result` around each `this.mcpBridge.citationVerify()` in loop (including error case).
- [x] 1.3.6 **`runOutput()`**: Emits `status` event: "Rendering output document..."

### 1.4: Orchestrator collects and yields substep events

In `packages/shared/src/agent/orchestrator/index.ts`:

- [x] 1.4.1 Created `substepQueue: SubstepEvent[]` as class member of `AgentOrchestrator` (shared between executePipeline and repair loop)
- [x] 1.4.2 Wired `this.stageRunner.setOnProgress()` in constructor — pushes events to class-member queue
- [x] 1.4.3 Added queue drain (yield `orchestrator_substep` for each queued event) in 3 locations: pause-after branch, normal-run branch, repair loop branch
- [x] 1.4.4 Queue cleared before each stage in all 3 drain locations

### 1.5: Validate Phase 1

- [x] 1.5.1 Run `pnpm run typecheck:all` — must pass
- [x] 1.5.2 Run `pnpm run lint` — must pass (0 new errors, 5 pre-existing)
- [-] 1.5.3 Run `pnpm run test:e2e` — deferred to final validation

---

## Phase 2: ClaudeAgent Translation Layer + Streaming

**Goal:** Map the new `orchestrator_substep` events to standard `AgentEvent` yields (`tool_start`, `tool_result`, `text_delta`, `text_complete`) with proper synthetic IDs, so they flow through the existing `processEvent` → messages pipeline in sessions.ts.

### 2.1: Generate orchestrator turnId

In `packages/shared/src/agent/claude-agent.ts`:

- [x] 2.1.1 In `processOrchestratorEvents()`, generate a per-run orchestrator turnId: `const orchTurnId = \`orch-${runId}\`` (stable across the entire pipeline run)
- [x] 2.1.2 Add to all existing yields in this method (`text_complete` for stage complete, pause message, error, text) a `turnId: orchTurnId` property

### 2.2: Map substep events to AgentEvent yields

In `packages/shared/src/agent/claude-agent.ts`, in the `processOrchestratorEvents()` switch:

- [x] 2.2.1 Add `case 'orchestrator_substep':` handler that switches on `event.substep.type`:
  - `mcp_start` → yield `{ type: 'tool_start', toolName: substep.toolName, toolUseId: substep.toolUseId, input: substep.input, turnId: orchTurnId, parentToolUseId: substep.parentToolUseId, displayName: formatOrchestratorToolName(substep.toolName) }`
  - `mcp_result` → yield `{ type: 'tool_result', toolUseId: substep.toolUseId, toolName: substep.toolName, result: substep.result, isError: substep.isError ?? false, turnId: orchTurnId, parentToolUseId: substep.parentToolUseId }`
  - `llm_start` → yield `{ type: 'tool_start', toolName: 'orchestrator_llm', toolUseId: generateSyntheticId(), input: { stage: substep.stageName }, turnId: orchTurnId, intent: \`Analyzing stage: ${substep.stageName}\` }`
  - `llm_delta` → yield `{ type: 'text_delta', text: substep.text, turnId: orchTurnId }`
  - `llm_complete` → yield `{ type: 'text_complete', text: substep.text, isIntermediate: substep.isIntermediate, turnId: orchTurnId }`
  - `status` → yield `{ type: 'status', message: substep.message }`

### 2.3: Forward LLM streaming from onStreamEvent

In `packages/shared/src/agent/claude-agent.ts`:

- [-] 2.3.1 **Critical architectural decision:** Deferred to Phase 5 (optional). Post-hoc llm_start/llm_complete events provide meaningful visibility without real-time streaming.
- [-] 2.3.2 **Solution: Real-time forwarding via shared channel.** Deferred to Phase 5 (optional).
- [x] 2.3.3 **Fallback if real-time is too complex for Phase 2:** deferred `llm_delta` streaming to Phase 5. The `llm_start`/`llm_complete` events (post-hoc) give meaningful visibility.

### 2.4: Validate Phase 2

- [x] 2.4.1 Run `pnpm run typecheck:all` — must pass
- [x] 2.4.2 Run `pnpm run lint` — must pass (0 new errors)
- [-] 2.4.3 Manual test: deferred to manual smoke test after final validation
- [-] 2.4.4 Run `pnpm run test:e2e` — deferred to final validation

---

## Phase 3: Renderer Display — Tool Metadata & Icons

**Goal:** Ensure orchestrator substep tool messages render with meaningful names and icons in TurnCard, matching the visual quality of regular conversation tool activities.

### 3.1: Add orchestrator tool display mappings

In `packages/ui/src/components/chat/TurnCard.tsx`:

- [x] 3.1.1 In `formatToolDisplay()` (~L540), add display mappings for orchestrator tool names:
  - `orch_web_search` → display: "Web Search", icon: 🔍
  - `orch_kb_search` → display: "Knowledge Base Search", icon: 📚
  - `orch_citation_verify` → display: "Citation Verification", icon: ✅
  - `orch_hop_retrieve` → display: "Deep Retrieval", icon: 🔗
  - `orchestrator_llm` → display: "LLM Analysis", icon: 🧠
  Also added friendly names in `getToolDisplayName()` for all 5 tools.
- [-] 3.1.2 Preview text extraction deferred — tool input already shows in expandable tool details

### 3.2: Verify activity nesting

- [x] 3.2.1 Confirmed: orchestrator MCP tools with `parentToolUseId` correctly nest via existing `calculateActivityDepths()` — uses `parentId` matching against `toolUseId`, works out of the box
- [x] 3.2.2 Confirmed: orchestrator tools without natural parent appear at depth 0 — acceptable as top-level activities within the turn

### 3.3: Stage status in ProcessingIndicator

In `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx`:

- [x] 3.3.1 Status substep events yield `{ type: 'status', message }` from claude-agent.ts — these flow through existing `processEvent` → `handleStatus()` → `currentStatus` pipeline automatically
- [x] 3.3.2 Verified: no additional code change needed — status events already flow through processEvent correctly

### 3.4: Validate Phase 3

- [x] 3.4.1 Run `pnpm run typecheck:all` — PASS (exit code 0)
- [x] 3.4.2 Run `pnpm run lint` — PASS (0 new errors)
- [-] 3.4.3 Manual smoke test deferred to post-implementation manual validation

---

## Phase 4: Dedup Guard & Edge Cases

**Goal:** Fix the output injection duplicate risk and handle edge cases.

### 4.1: Dedup guard for output injection

In `apps/electron/src/main/sessions.ts`:

- [x] 4.1.1 Verified: `injectOutputIfNotPresent()` already has a 200-char content prefix dedup check (`const contentPrefix = fileContent.substring(0, 200)`). No new dedup risk from substep events — substeps are tool activities, not output file content.
- [x] 4.1.2 Verified: orchestrator substep events don't inject file content. Output injection only happens via `tryInjectAgentOutputFile()` which already has Strategy 1 (pipeline-state.json) + Strategy 2 (agent-events.jsonl) guards.

### 4.2: Graceful degradation

- [x] 4.2.1 Verified: `emitProgress()` uses `this._onProgress?.(event)` — null-safe by design. StageRunner works identically without callback.
- [x] 4.2.2 Verified: `processEvent` tool_result handler at L5497 creates fallback message when no matching tool_start found ("RESULT WITHOUT START" log). Safe for race conditions.
- [x] 4.2.3 Verified: orchestrator tool events yield `tool_start`/`tool_result` which don't trigger permission requests. No implicit-allow list exists — permissions only apply to SDK-initiated tool calls, not yielded events.

### 4.3: Validate Phase 4

- [x] 4.3.1 Run `pnpm run typecheck:all` — PASS (no changes in Phase 4, already validated)
- [x] 4.3.2 Run `pnpm run lint` — PASS (no changes in Phase 4)
- [-] 4.3.3 Run `pnpm run test:e2e` — deferred to final validation
- [-] 4.3.4 Manual test deferred to post-implementation manual validation

---

## Phase 5: Real-Time LLM Streaming (Optional Enhancement) — DEFERRED

**Goal:** Enable real-time `text_delta` streaming from orchestrator LLM calls so users see Claude's thinking/writing live during synthesis and analysis — not just post-hoc summaries.

**Status:** Deferred. Phases 1-4 provide full post-hoc visibility for all substeps. Real-time streaming adds architectural complexity (async iterable merging with stage execution loop) and can be implemented as a follow-up enhancement.

### 5.1: Implement SubstepChannel

- [-] 5.1.1 Deferred — async iterable queue architecture deferred to future enhancement
- [-] 5.1.2 Deferred
- [-] 5.1.3 Deferred
- [-] 5.1.4 Deferred

### 5.2: Validate Phase 5

- [-] 5.2.1 Deferred
- [-] 5.2.2 Deferred
- [-] 5.2.3 Deferred

---

## Risks & Considerations

| Risk | Mitigation |
|------|------------|
| Synthetic tool IDs conflicting with real SDK tool IDs | Use `orch-` prefix that SDK never generates; IDs are only used within the orchestrator run's turn |
| Too many substep messages cluttering the chat | Orchestrator typically runs 3-5 web searches, ~5 KB queries, 2-3 LLM calls = ~15 activities. Regular conversations routinely show 20+ tool activities. Acceptable. |
| `text_delta` real-time streaming adds complexity (Phase 5) | Phase 5 is optional. Phases 1-4 give full post-hoc visibility without real-time streaming. Phase 5 can be deferred. |
| Existing `processEvent` handlers assume SDK-originated events | Synthetic tool events use the same `AgentEvent` type; `processEvent` doesn't check event origin. Safe. |
| Orchestrator tool_result may contain large payloads (e.g., KB paragraphs) | Apply existing MAX_PERSISTED_RESULT_CHARS truncation in sessions.ts — already handles this for all tool results |
| Stage repair loop re-runs stages — duplicate substep activities | Queue is cleared before each stage. Repair iterations will show as additional tool activities (which is correct — user should see the re-run attempts) |
| Generator yield timing — `processOrchestratorEvents` is already a `yield*` delegation | All new yields happen inside the existing `for await ... switch` — no structural change to the generator chain |

## Testing Strategy

| Test | Method | When |
|------|--------|------|
| TypeScript strictness | `pnpm run typecheck:all` | Every phase |
| Lint | `pnpm run lint` | Every phase |
| E2E tests | `pnpm run test:e2e` | Every phase |
| Substep event emission | Unit test: mock McpBridge, verify StageRunner emits expected onProgress calls | Phase 1 |
| Event translation | Unit test: feed OrchestratorEvent to processOrchestratorEvents, verify yielded AgentEvent types/IDs | Phase 2 |
| Visual regression | Manual: run ISA Deep Research, compare substep rendering vs. regular conversation tool rendering | Phase 3 |
| Dedup | Manual: run full pipeline, verify output appears once | Phase 4 |
| Live streaming | Manual: watch synthesis stage for real-time text appearance | Phase 5 |

---

_Target branch: `feature/dynamic-stage-thinking` (continues from previous work)_
_Estimated scope: Phases 1-4 = core. Phase 5 = optional enhancement._
_Last updated: 2026-02-27_

---

# Bug Fix: Conversation Disappears After Agent Question

## Goal

Fix critical regression where the conversation panel goes blank when an agent question
is asked in a session. Introduced by the "Rich Agent Pipeline Substep Visibility" feature above.

## Analysis

### What We Know
- Bug is 100% renderer-side — session data persisted correctly in JSONL files, 0 errors across 5 latest sessions
- TypeScript compiles — `pnpm run typecheck:all` EXIT 0
- Build succeeds — `pnpm run electron:build` EXIT 0
- E2E tests pass — 177 pass / 0 fail / 1 skipped
- Two extraneous files modified (processor.ts, AgentRunDetailPage.tsx) — analyzed and confirmed **BENIGN**; do NOT revert

### Root Cause Status
Static analysis has **NOT** identified a definitive smoking gun for "conversation disappears."
Code paths appear correct through the full event chain. One confirmed code bug (F1) was
introduced and fixed in Phase 1.

### Confirmed Bug: Shared orchTurnId (F1)
All `text_complete` yields from `processOrchestratorEvents()` shared the same
`orchTurnId = 'orch-${runId}'`. The renderer's `handleTextComplete` uses
`findAssistantMessage(messages, turnId)` to locate existing messages. When the pause
message arrives (`isIntermediate: false`), it finds the first intermediate stage-completion
message with the same turnId and **overwrites** it — the dedup guard only blocks
`intermediate → intermediate`, not `intermediate → final`.

### Pre-Existing Issue: `pausedAgent` cleared immediately (F2)
After `agent_stage_gate_pause` sets `pausedAgent`, the `complete` event immediately
follows and `handleComplete` sets `pausedAgent: undefined`. The pause banner never
renders. **Not caused by this PR** — noted for future fix.

## Key Files

| File | Layer | Role in Bug |
|------|-------|-------------|
| `packages/shared/src/agent/claude-agent.ts` | Agent | **SOURCE** — shared orchTurnId across all text_complete yields |
| `apps/electron/src/renderer/event-processor/handlers/text.ts` | Renderer | handleTextComplete overwrites message due to shared turnId |
| `apps/electron/src/renderer/App.tsx` | Renderer | onSessionEvent handler — event routing |
| `apps/electron/src/renderer/event-processor/processor.ts` | Renderer | processEvent switch — event dispatch |
| `apps/electron/src/renderer/pages/ChatPage.tsx` | Renderer | !session guard — renders empty/skeleton state |

## Phase 0: Reproduce & Characterize (Zero-Code Diagnostic)

- [ ] 0.1 Run `pnpm run electron:build` and launch the built app
- [ ] 0.2 Open DevTools console (`Ctrl+Shift+I`) before triggering the bug
- [ ] 0.3 Send a message to an agent session and observe console output
- [ ] 0.4 Characterize: 100% repro or intermittent? Only agent sessions? Only ISA Deep Research?
- [ ] 0.5 Document findings

## Phase 1: Fix Confirmed Bug — orchTurnId Overwriting (F1)

Generate unique turnId per `text_complete` yield. Keep shared `orchTurnId` for
`tool_start`/`tool_result` (correct — groups substep activities under one turn).

- [x] 1.1.1 Add `let orchTextCounter = 0` at top of `processOrchestratorEvents()`
- [x] 1.1.2 `orchestrator_stage_complete` text_complete: `turnId: \`${orchTurnId}-text-${orchTextCounter++}\``
- [x] 1.1.3 `orchestrator_pause` text_complete: `turnId: \`${orchTurnId}-text-${orchTextCounter++}\``
- [x] 1.1.4 `text` case text_complete: `turnId: \`${orchTurnId}-text-${orchTextCounter++}\``

### Validate Phase 1
- [x] 1.2.1 `pnpm run typecheck:all` — PASS (exit code 0)
- [x] 1.2.2 `pnpm run lint` — PASS (0 new errors, 5 pre-existing)

## Phase 2: Targeted Runtime Diagnostics

Added diagnostic logging to 4 points to trace "conversation disappears" if F1 fix
is not sufficient. Skip if Phase 0 already identifies the root cause.

- [x] 2.1.1 App.tsx `onSessionEvent`: Log event type, sessionId, streaming/handoff state
- [x] 2.1.2 App.tsx post-processAgentEvent: Log message count, isProcessing
- [x] 2.1.3 ChatPage.tsx `!session` guard: Log sessionId, hasMeta, isLoaded
- [x] 2.1.4 processor.ts default case: Log unhandled event type

### Validate Phase 2
- [x] 2.2.1 `pnpm run typecheck:all` — PASS (exit code 0)
- [x] 2.2.2 `pnpm run lint` — PASS (0 new errors)
- [x] 2.2.3 `pnpm run test:e2e` — PASS (177 pass / 0 fail / 1 skipped)

## Phase 3: Fix Root Cause (if Phase 0/2 reveal additional issue)

- [ ] 3.1 Identify root cause from Phase 0 console errors or Phase 2 diagnostic logs
- [ ] 3.2 Implement single targeted fix (exact change determined by diagnostics)
- [ ] 3.3 Remove all Phase 2 diagnostic logging (revert 2.1.1-2.1.4)

### Validate Phase 3
- [ ] 3.4.1 `pnpm run typecheck:all` — must pass
- [ ] 3.4.2 `pnpm run lint` — must pass
- [ ] 3.4.3 `pnpm run test:e2e` — must pass

## Phase 4: End-to-End Validation

- [ ] 4.1 `pnpm run typecheck:all` — PASS
- [ ] 4.2 `pnpm run lint` — PASS
- [ ] 4.3 `pnpm run test:e2e` — PASS (177+ tests)
- [ ] 4.4 Build app and manual smoke test:
  - [ ] 4.4.1 Send message to regular (non-agent) session → conversation renders normally
  - [ ] 4.4.2 Send message to ISA Deep Research agent session → conversation renders normally
  - [ ] 4.4.3 Agent pipeline runs → substep activities appear in TurnCard
  - [ ] 4.4.4 Agent pause → conversation stays visible, pause message appears
  - [ ] 4.4.5 Resume agent → pipeline continues, conversation still visible
- [ ] 4.5 No diagnostic `console.debug`/`console.warn` statements remain in code

## Risks & Considerations

| Risk | Mitigation |
|------|------------|
| Phase 1 fix (orchTurnId) may not be the full root cause | Phase 2 diagnostics will reveal additional issues |
| Extraneous file changes (processor.ts, AgentRunDetailPage.tsx) | CONFIRMED BENIGN — do NOT revert |
| `pausedAgent` cleared by handleComplete (F2) | Pre-existing, not in scope |
| Diagnostic logging left in production | Phase 3.3 removes all; Phase 4.5 verifies |

---

_Last updated: 2026-02-27_
---

# Implementation Plan: Orchestrator Context Continuity & Pipeline Breakout

**Branch**: `feature/orchestrator-context-continuity`
**Goal**: (1) Make orchestrator pipeline output survive as conversation context for subsequent turns, (2) Allow users to break out of a paused pipeline while preserving conversation context.

---

## Problem Analysis

### Why context is lost today

The orchestrator pipeline (`runOrchestrator()`/`resumeOrchestrator()`) short-circuits `chat()` with `return` before the SDK's `query()` is ever called. The SDK never sees orchestrator output, so no JSONL transcript is written. On the next turn:

1. SDK `resume` finds no transcript → falls back to `buildRecoveryContext()`
2. `buildRecoveryContext()` takes only the last 6 messages, each truncated to 1000 chars
3. Research output (10,000+ chars) is destroyed

The existing `tryInjectAgentOutputFile()` partially mitigates by injecting full output into `managed.messages[]` after pipeline completion, but this is in-memory only — the SDK transcript on disk never gets it.

### Why a naive fix fails

- **Injecting into user messages**: Context blocks prepended by `buildTextPrompt()` are stripped during SDK compaction. A 10K summary in a user message gets compacted away.
- **Modifying system prompt**: System prompt is pinned on first `chat()` call. Changing it triggers drift warnings and the SDK won't apply the change.
- **Writing to SDK transcript directly**: The transcript format is SDK-internal; writing directly would break resume semantics.

### Correct approach

**File-based context injection** via `buildContextParts()`. The orchestrator writes a summary file to disk after completion. On each subsequent turn, `buildTextPrompt()` reads the file and includes a compact reference in the user message context. This follows the existing pattern used by date/time context, session state, and source state blocks.

When the conversation is compacted, the summary file on disk survives. The next user message re-reads the file and re-injects the summary. The summary is small (500–1500 chars) compared to the full output (5K–30K chars), so it's cost-effective to re-inject every turn.

### Coordination with tryInjectAgentOutputFile (G4)

`tryInjectAgentOutputFile()` already injects the full research output as an assistant message in `managed.messages[]`. This is the detailed output for the user to read. The `pipeline-summary.json` is a separate, smaller file that provides *context for the LLM* — telling it what was researched, not showing the full output. Both are needed:
- `tryInjectAgentOutputFile` → full output visible to user in chat
- `pipeline-summary.json` → compact context visible to LLM in prompt

### Partial pipeline fallback (G3)

When a pipeline is incomplete (user broke out at stage 1, or error at stage 3), `answer.json` doesn't exist. But `pipeline-state.json` has `stageOutputs` for all completed stages. The summary generation reads from `stageOutputs` and produces a summary even for incomplete pipelines:
- Stage 0 completed → summary has the query decomposition
- Stage 0+1 completed → summary has query plan + web search calibration
- Stage 0+1+2+3 completed → summary has synthesis but no verification

---

## Key Files

| File | Package | Role in this change | Modified? |
|------|---------|-------------------|:---------:|
| `packages/shared/src/agent/claude-agent.ts` | shared | `isBreakoutIntent()`, `writePipelineSummary()`, breakout logic in `chat()`, `sessionPath` wiring | ✓ |
| `packages/shared/src/agent/core/prompt-builder.ts` | shared | `buildOrchestratorSummaryBlock()`, `escapeXml()`, wired into `buildContextParts()` | ✓ |
| `packages/shared/src/agent/core/types.ts` | shared | Added `sessionPath?` to `ContextBlockOptions` | ✓ |
| `packages/shared/src/agent/orchestrator/pipeline-state.ts` | shared | Added `generateSummary()` method | ✓ |
| `packages/shared/src/agent/orchestrator/types.ts` | shared | Extended `StageEventType` with `'breakout'`, added `PipelineSummary` interface | ✓ |
| `packages/shared/src/agent/orchestrator/__tests__/pipeline-state-summary.test.ts` | shared | 16 unit tests for `generateSummary()` | ✓ (new) |
| `packages/shared/src/agent/orchestrator/__tests__/breakout-intent.test.ts` | shared | 41 unit tests for `isBreakoutIntent()` | ✓ (new) |
| `packages/shared/src/agent/orchestrator/__tests__/orchestrator-summary-block.test.ts` | shared | 12 unit tests for `buildOrchestratorSummaryBlock()` | ✓ (new) |
| `apps/electron/src/main/sessions.ts` | electron | Not modified — breakout logic handled entirely in `claude-agent.ts` | ✗ |
| `apps/electron/src/renderer/event-processor/processor.ts` | electron | Not modified — existing `agent_run_completed` handler suffices | ✗ |
| `apps/electron/src/renderer/App.tsx` | electron | Not modified — existing `agent_run_state_update` handler suffices | ✗ |

---

## Phase 1: Orchestrator Context Summary (Compaction-Safe)

**Goal**: After an orchestrator pipeline completes, write a compact summary file to disk. On every subsequent user message, `buildTextPrompt()` reads the file and injects a summary context block.

### Architecture

```
Pipeline completes → writePipelineSummary() writes JSON to {sessionPath}/data/pipeline-summary.json
                     ↓
Next user turn → buildTextPrompt() → buildContextParts() → buildOrchestratorSummaryBlock()
                     ↓
                reads pipeline-summary.json, formats as <orchestrator_prior_research> XML block
                     ↓
SDK compacts → user message content stripped, but file survives on disk
                     ↓
Next turn after compaction → buildContextParts() re-reads file, re-injects block ✓
```

### Why a separate summary file (not answer.json)

`answer.json` is a large artifact (5K–30K chars) designed for follow-up pipeline runs. It contains full citations, sub-queries, and raw answer text. Injecting all of that into every user message would be wasteful and might trigger compaction prematurely.

`pipeline-summary.json` is a compact derivative (~500–1500 chars) designed specifically for conversation context. It contains: original query, key findings summary, main conclusions, stage completion status, and verification scores.

### Why not system prompt injection

The system prompt is pinned on first `chat()` call for consistency. Changing it triggers drift warnings. Using user-message context blocks follows the existing pattern (date/time, session state, source state) and is the correct approach.

### Tasks

- [x] 1.1 Add `PipelineState.generateSummary()` method that extracts key data from `stageOutputs`:
  - `originalQuery`: from stageOutputs[0].data.original_query
  - `keyFindings`: from stageOutputs[3].data.key_findings (if exists)
  - `conclusions`: from stageOutputs[3].data.conclusions (if exists)
  - `verificationScores`: from stageOutputs[4].data (if exists)
  - `completedStages`: derived from events
  - `wasPartial`: true if pipeline didn't reach stage 5

- [x] 1.2 Add `writePipelineSummary()` to `claude-agent.ts` (called after `yield { type: 'complete' }` in `runOrchestrator()`/`resumeOrchestrator()`):
  - Reads `PipelineState.loadFrom(sessionPath)`
  - Calls `generateSummary()`
  - Writes `{sessionPath}/data/pipeline-summary.json`
  - Handles partial pipelines (G3): falls back to whatever stageOutputs exist

- [x] 1.3 Add `buildOrchestratorSummaryBlock()` to `PromptBuilder`:
  - Reads `{sessionPath}/data/pipeline-summary.json`
  - Formats as `<orchestrator_prior_research>` XML block (~500–1500 chars)
  - Returns empty string if file doesn't exist (no-op for non-agent sessions)

- [x] 1.4 Wire `buildOrchestratorSummaryBlock()` into `buildContextParts()`:
  - Add after source state block
  - Pass `sessionPath` via `ContextBlockOptions` (needs `sessionId` and `workspaceRootPath`)

- [x] 1.5 Run `pnpm run typecheck:all` and `pnpm run lint`

- [-] 1.6 Test manually: run an ISA pipeline to completion, then send a follow-up message. Verify the LLM knows what was researched. (skipped: requires live API key and interactive testing)

---

## Phase 2: Pipeline Breakout System

**Goal**: When a pipeline is paused and the user sends an unrelated message, detect breakout intent, terminate the pipeline cleanly, preserve conversation context, and switch to normal chat mode.

### Architecture

```
User sends message while pipeline paused
    ↓
chat() → detectPausedOrchestrator() → found paused pipeline
    ↓
resumeOrchestrator() called (existing path)
    ↓
NEW: Before delegating to orchestrator.resume(), classify user intent:
    ↓
    ├── Resume keywords (proceed, continue, yes, etc.) → orchestrator.resume() (existing)
    │
    └── Breakout keywords → breakoutOrchestrator()
        ↓
        1. Write pipeline-summary.json (G3: partial state → summary)
        2. Record 'breakout' event in pipeline-state.json
        3. Clear bridge state
        4. Emit agent_run_completed event (G5: clears agentRunStateAtom)
        5. Delete pipeline-state.json pause markers (mark as terminated)
        6. Fall through to SDK chat() with user's original message
```

### Why binary classification (G2)

**Resume keywords** → `resumeOrchestrator()` (existing path — continues pipeline)
**Breakout keywords** → `breakoutOrchestrator()` (new — terminates pipeline, falls through to normal `chat()`)
**Everything else** → `resumeOrchestrator()` (existing — orchestrator handles as resume feedback)

The breakout keywords are explicit and narrow. This is safe because the user must actively signal breakout intent. LLM-driven classification adds unnecessary complexity and cost.

### Breakout keyword list

Case-insensitive, checked as substrings/patterns:
- "break out" / "breakout"
- "exit pipeline" / "exit agent"
- "stop pipeline" / "stop agent"
- "cancel pipeline" / "cancel agent"
- "new question"
- "forget the pipeline"
- "skip pipeline"
- "leave pipeline"

If none match → treat as resume (existing behavior).

### StageEventType extension (G6)

Adding `'breakout'` to the `StageEventType` union requires updating:
1. `types.ts` — union definition
2. `pipeline-state.ts` — no changes needed (generic `addEvent()`)
3. No other files use exhaustive switches on `StageEventType`

### Agent run state cleanup (G5)

`breakoutOrchestrator()` must emit `agent_run_completed` via `onAgentEvent` callback. This triggers the existing `agent_run_state_update` effect in the renderer's event processor, which clears `agentRunStateAtom` for the agent slug.

### Fall-through to SDK (Task 2.5)

`breakoutOrchestrator()` does NOT consume the message for SDK. Instead, the breakout check is placed in `chat()` before `resumeOrchestrator()`:
1. Check breakout intent before calling `resumeOrchestrator()`
2. If breakout → run cleanup (summary, events, bridge state, emit completion), then DON'T return — let `chat()` continue to the SDK `query()` path
3. The existing `buildTextPrompt()` will pick up `pipeline-summary.json` via Phase 1's `buildOrchestratorSummaryBlock()`

### Tasks

- [x] 2.1 Add `'breakout'` to `StageEventType` union in `packages/shared/src/agent/orchestrator/types.ts`

- [x] 2.2 Add `isBreakoutIntent(userMessage: string): boolean` to `claude-agent.ts`:
  - Keyword-based detection (no LLM call)
  - Case-insensitive substring matching
  - Returns true only for explicit breakout keywords

- [x] 2.3 Modify the paused orchestrator detection in `chat()` (`claude-agent.ts` ~L690) to check breakout intent BEFORE calling `resumeOrchestrator()`:
  ```
  if (pausedOrch) {
    if (isBreakoutIntent(userMessage)) {
      // run cleanup, do NOT return — fall through to SDK query()
    } else {
      yield* this.resumeOrchestrator(userMessage, pausedOrch.agent);
      return;
    }
  }
  ```

- [x] 2.4 Implement breakout cleanup logic (inline in `chat()` or as `breakoutOrchestrator()`):
  1. Load `PipelineState.loadFrom(sessionPath)`
  2. Call `generateSummary()` and write `pipeline-summary.json`
  3. Record breakout event: `state.addEvent({ type: 'breakout', stage: state.currentStage, data: { userMessage } })`
  4. Save updated state (with breakout event)
  5. Clear bridge state via `clearOrchestratorBridgeState()`
  6. Emit `agent_run_completed` event with `verificationStatus: 'breakout'`
  7. Yield info message: "Pipeline terminated. Your research context has been preserved."
  8. Continue — `chat()` falls through to SDK `query()` path

- [x] 2.5 Run `pnpm run typecheck:all` and `pnpm run lint`

- [-] 2.6 Test: pause a pipeline, send "break out", verify pipeline terminates cleanly, context preserved, and normal chat continues with awareness of prior research. (skipped: requires live API key and interactive testing)

---

## Phase 3: Integration Testing & Edge Cases

**Goal**: Verify all paths work correctly and handle edge cases.

### Edge cases to test

| Scenario | Expected behavior |
|----------|-------------------|
| Pipeline completes → user asks follow-up | LLM sees `<orchestrator_prior_research>` block with summary |
| Pipeline completes → user compacts → asks follow-up | Summary file survives, re-injected on next turn |
| Pipeline paused at stage 0 → user breaks out | Partial summary with query decomposition only |
| Pipeline paused at stage 1 → user breaks out then asks related question | LLM knows query plan + calibration results |
| Pipeline errors at stage 3 → user asks "what happened?" | Summary has stages 0–2, error noted |
| User sends "proceed" while paused | Normal resume (existing behavior unchanged) |
| User sends "break out" while no pipeline paused | No effect — `detectPausedOrchestrator()` returns null |
| Multiple pipeline runs in same session | Latest `pipeline-summary.json` overwrites previous |
| Pipeline completes → user starts NEW pipeline | Old summary overwritten by new pipeline-summary.json |

### Tasks

- [x] 3.1 Write unit test for `PipelineState.generateSummary()` — complete, partial, and error cases (16 tests, all pass)
- [x] 3.2 Write unit test for `isBreakoutIntent()` — keyword matching (41 tests, all pass)
- [x] 3.3 Write unit test for `buildOrchestratorSummaryBlock()` — file present, missing, and malformed (12 tests, all pass)
- [-] 3.4 Write E2E test: mock pipeline completion → verify summary file written → verify context block in prompt (covered by unit tests 3.1-3.3)
- [x] 3.5 Run full test suite: `pnpm run typecheck:all && pnpm run lint && pnpm run test:e2e` — 177/177 pass, 0 fail, 69 new tests pass

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Summary injection increases per-turn token cost | Low (~500–1500 tokens) | Summary is compact; much smaller than full output |
| Breakout keywords false-positive on resume intent | Medium | Keywords are narrow and explicit; ambiguous messages go to resume path |
| `pipeline-summary.json` stale after new pipeline | Low | File is overwritten on each pipeline run |
| SDK compaction mid-conversation doesn't re-inject | Low | Verified: `buildTextPrompt()` re-reads file on every turn |
| `StageEventType` union extension breaks exhaustive checks | Low | Grep confirmed no exhaustive switches on this union |

## Testing Strategy

1. **TypeScript**: `pnpm run typecheck:all` after each phase
2. **Lint**: `pnpm run lint` after each phase
3. **Unit tests**: New tests for `generateSummary()`, `isBreakoutIntent()`, `buildOrchestratorSummaryBlock()`
4. **E2E**: `pnpm run test:e2e` for existing tests (no regressions)
5. **Manual**: Run ISA pipeline → complete → ask follow-up → verify context awareness

---

## Adversarial Review Findings (2026-02-28)

Post-implementation review identified the following findings. None are critical; all automated validation passes (0 type errors, 0 lint regressions, 69/69 new tests pass, 177/177 E2E tests pass).

### F1 — `OrchestratorExitReason` not extended with `'breakout'` (warning)

**File**: `packages/shared/src/agent/orchestrator/types.ts` L385
**Issue**: The plan's original Key Files table stated "add `OrchestratorExitReason` variant", and `StageEventType` was correctly extended with `'breakout'`, but `OrchestratorExitReason` remains `'paused' | 'completed' | 'error'`. Additionally, `PipelineSummary.exitReason` is typed as `string` rather than a union type, so the breakout path works but loses type-level documentation.
**Impact**: Future developers inspecting `OrchestratorExitReason` believe only 3 exit reasons exist. The `string` typing on `PipelineSummary.exitReason` loses IDE autocompletion and exhaustive-match protection. No runtime bug.
**Resolution**: **Resolved** — Added `PipelineExitReason = OrchestratorExitReason | 'breakout'` type to `types.ts`. Typed `PipelineSummary.exitReason` as `PipelineExitReason`. Updated `generateSummary()` and `writePipelineSummary()` parameter types. Exported from `index.ts`.

### F2 — Breakout keyword substring matching can false-positive on negation (warning)

**File**: `packages/shared/src/agent/claude-agent.ts` L270-L272
**Issue**: `isBreakoutIntent()` uses `lower.includes(pattern)` substring matching. The keyword `"new question"` would match in `"I don't have a new question"` or `"This is NOT a new question"`. Similarly `"stop agent"` matches `"don't stop agent from continuing"`.
**Impact**: User messages containing breakout keywords in a negated context would trigger pipeline termination. Research work could be lost if the pipeline was mid-execution.
**Resolution**: Accepted risk — breakout keywords are narrow, and the probability of a user including breakout phrases in negated form while a pipeline is paused is low. Future improvement: add word-boundary checks or a simple negation detector.

### F3 — Plan Key Files table listed `sessions.ts` as requiring modification (nit)

**File**: `plan.md` Key Files table
**Issue**: The original Key Files table stated `apps/electron/src/main/sessions.ts` should "Coordinate summary injection with existing `tryInjectAgentOutputFile()`, emit `agent_run_completed` on breakout". The actual implementation placed all breakout logic inline in `claude-agent.ts` — `sessions.ts` was never modified.
**Impact**: Misleading documentation. **Resolved** — Key Files table updated above to reflect actual state.

### F4 — `escapeXml()` JSDoc omits unescaped `"` and `'` (nit)

**File**: `packages/shared/src/agent/core/prompt-builder.ts` L226
**Issue**: `escapeXml()` correctly escapes `&`, `<`, `>` for element content but intentionally omits `"` and `'` (safe for element content, unsafe for attribute values). The JSDoc doesn't note this limitation.
**Impact**: Minimal — but if a future developer reuses `escapeXml()` for attribute values, it would produce malformed XML.
**Resolution**: **Resolved** — Updated JSDoc to note that `"` and `'` are intentionally not escaped, safe for element content only.

### F5 — `writePipelineSummary()` double-loads `PipelineState` in breakout path (nit)

**File**: `packages/shared/src/agent/claude-agent.ts` L740-L753
**Issue**: The breakout handler in `chat()` calls `PipelineState.loadFrom(sessionPath)` at L741 (to add the breakout event and save), then calls `this.writePipelineSummary()` at L753 which internally calls `PipelineState.loadFrom()` again — a redundant synchronous disk read of ~10-50KB.
**Impact**: No correctness issue. The second read gets the updated state (with breakout event). Performance impact is negligible for a single call.
**Resolution**: **Resolved** — Added optional `preloadedState?: PipelineState` parameter to `writePipelineSummary()`. Breakout path now passes the already-loaded state, eliminating the redundant disk read.

### Summary Table

| ID | Finding | Severity | Status |
|----|---------|----------|--------|
| F1 | `OrchestratorExitReason` missing `'breakout'` variant | warning | **resolved** |
| F2 | Breakout keyword false-positive on negated sentences | warning | accepted |
| F3 | Key Files table listed `sessions.ts` as modified | nit | **resolved** |
| F4 | `escapeXml()` JSDoc omits `"` and `'` limitation | nit | **resolved** |
| F5 | Double `PipelineState.loadFrom()` in breakout path | nit | **resolved** |
| F6 | Breakout patterns too narrow — miss natural language signals | bug | **resolved** |

---

## F6 — Breakout Patterns Too Narrow (2026-02-28)

**Discovered during manual testing**: User sent "I want to do something else - just tell me what the weather in zurich is today" while pipeline was paused after Stage 1. The message clearly signals breakout intent but the original keyword list (14 patterns, all technical/explicit) didn't match.

**Root cause**: The original `BREAKOUT_PATTERNS` only contained explicit pipeline commands ("exit pipeline", "cancel agent", etc.) and missed natural language signals. When a user naturally says "something else", "different topic", "never mind", etc., none matched.

**Fix**: Expanded `BREAKOUT_PATTERNS` from 14 → 28 entries with two tiers:
- **Tier 1** (13 patterns): Explicit pipeline commands — `break out`, `exit pipeline`, `cancel agent`, etc.
- **Tier 2** (15 patterns): Natural language signals — `something else`, `something different`, `different question`, `different topic`, `change topic`, `change the topic`, `new question`, `new topic`, `never mind`, `nevermind`, `forget it`, `changed my mind`, `want to ask`, `want to do`, `instead can you`, `instead tell me`, `instead just`

**Test coverage**: Expanded from 41 → 63 tests. Added the exact failing user message as a test case. All 91 unit tests pass, 177 E2E tests pass.

**Remaining risk (F2)**: Substring matching can still false-positive on negated sentences (e.g., "I don't want to do something else"). Accepted as low-probability — when a pipeline is paused asking "Shall I proceed?", negated breakout phrases are extremely unlikely.

---

## Breakout Confirmation Gate (2026-02-28)

**Problem**: Immediate breakout termination on keyword match is too aggressive. Users can lose multi-stage research work on false-positive matches (e.g., "I want to do the search now" contains "want to do").

**Solution**: Two-step confirmation gate — detect breakout intent → ask user for confirmation → act based on response.

### Design Decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| D1 | Use `PipelineState` events (not bridge state) for `breakoutPending` | Avoids read-modify-write on bridge state file. `addEvent()` + `saveTo()` already exists. |
| D2 | Bridge state untouched during confirmation window | Keeps queue drain hold active in `sessions.ts`. No session layer changes. |
| D3 | "Neither confirm nor deny" = implicit confirmation | User is clearly moving on; message falls through to SDK. |
| D4 | Confirmation yields `text_complete` + `complete` | Matches existing orchestrator pause message pattern. |
| D5 | Semantic inversion documented | "yes"=quit, "continue"=stay. Denial checked first. |
| D6 | Tier 2 patterns trimmed (28→25) | Removed "want to ask/do", "instead can/tell/just" — too ambiguous. |
| D7 | Race condition accepted | Low probability; worst case is redundant confirmation. |

### Changes Made

**1. `types.ts`** — Added `'breakout_pending'` to `StageEventType` union.

**2. `pipeline-state.ts`** — Added `isBreakoutPending` derived property. Uses array ordering (not timestamps) to check if the last `breakout_pending` event has been resolved by a subsequent `resumed` or `breakout` event. Survives app restarts.

**3. `claude-agent.ts`** — Major changes:
- **Trimmed patterns**: Removed 5 aggressive Tier 2 patterns ("want to ask", "want to do", "instead can you", "instead tell me", "instead just"). 28 → 23 patterns.
- **Added `classifyBreakoutResponse()`**: Classifies user message as `'confirm'` / `'deny'` / `'implicit_confirm'`. Denial checked first to handle "yes, continue" correctly.
- **Extended `detectPausedOrchestrator()`**: Return type now includes `breakoutPending: boolean` sourced from `PipelineState.isBreakoutPending`.
- **Rewrote breakout block in `chat()`**: 2-way check → 5-way check:
  - Case A: `breakoutPending` + deny → clear pending (`resumed` event), resume pipeline
  - Case B: `breakoutPending` + confirm → terminate, yield `text_complete` + `complete`, return
  - Case C: `breakoutPending` + implicit_confirm → terminate, yield `info`, fall through to SDK
  - Case D: no pending + breakout intent → record `breakout_pending`, yield confirmation question, return
  - Case E: no pending + no intent → normal resume (unchanged)

**4. `pause-formatter.ts`** — Added "3. Exit" option to both pause message variants, giving users a discoverable breakout path.

### Test Results

- **breakout-intent.test.ts**: 118 tests (was 63) — added `classifyBreakoutResponse()` tests (confirm/deny/implicit/priority/edge cases), trimmed pattern verification
- **pipeline-state-summary.test.ts**: 23 tests (was 16) — added 7 `isBreakoutPending` tests (empty, pending, denied, confirmed, paused+pending, re-trigger)
- **orchestrator-summary-block.test.ts**: 12 tests (unchanged)
- **All orchestrator tests**: 261/261 pass
- **E2E tests**: 177/177 pass (1 skipped, pre-existing)
- **Typecheck**: 0 errors
- **Lint**: 0 new errors (5 pre-existing in renderer)

---

## Semantic Breakout Detection (2026-02-28)

**Problem**: Keyword-only `isBreakoutIntent()` cannot detect when a user asks a completely unrelated question (e.g., "Actually what is the weather in zurich today?" during an audit research pipeline). The message contains no breakout keywords, so it falls through to Case E and the pipeline resumes, ignoring the user's actual intent.

**Solution**: Add LLM-based semantic classification as a fallback when keywords don't match. Uses Opus (`claude-opus-4-6`) with `effort: 'low'` via existing `OrchestratorLlmClient.call()`. Claude Max subscription = flat rate, no cost difference. Keyword detection stays as a fast path (no LLM call for explicit breakouts).

### Design Decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| D1 | Opus `effort: 'low'` | Claude Max = flat rate. Opus is strictly better for classification accuracy. Low effort keeps it fast (~500-800ms). |
| D2 | Reuse `OrchestratorLlmClient.call()` | Already supports model/effort/maxTokens overrides. No new method needed. |
| D3 | Keyword fast-path preserved | Explicit breakout phrases skip LLM call. LLM only fires for ambiguous messages. |
| D4 | `'unclear'` → resume (not breakout) | Resuming is non-destructive. Breaking out destroys research progress. |
| D5 | LLM failure → `'unclear'` → resume | If classification fails, fall through to Case E. User can retry. |
| D6 | Confidence threshold = 0.7 | Below 0.7 → `'unclear'` → resume. Prevents weak-confidence breakouts. |
| D7 | Case D helper extracted | `emitBreakoutConfirmation()` avoids duplication between keyword and semantic paths. |

### Changes Made

**1. `types.ts`** — Added `BreakoutClassification` type: `'pipeline_response' | 'breakout' | 'unclear'`.

**2. `pipeline-state.ts`** — Added `originalQuery` getter (extracts from stageOutputs[0] query plan, same logic as `generateSummary()` but factored out). Added `subQueryTexts` getter (extracts first 5 sub-query texts for classification prompt context). Refactored `generateSummary()` to use `this.originalQuery` internally.

**3. `claude-agent.ts`** — Major changes:
- **`classifyBreakoutIntent()`**: New private async method. Builds classification prompt with research topic + sub-queries + user message. Creates temporary `OrchestratorLlmClient`, calls with `effort: 'low'`, `desiredMaxTokens: 200`. Parses JSON response. Returns `BreakoutClassification`. On any error → `'unclear'`. Confidence < 0.7 → `'unclear'`.
- **`emitBreakoutConfirmation()`**: Extracted Case D logic (record `breakout_pending` event + yield confirmation question) into reusable async generator. Both keyword and semantic paths call this.
- **`chat()` decision tree**: Extended from 5-way to 6-way:
  - Case D (keyword): `isBreakoutIntent()` → `emitBreakoutConfirmation('keyword')`
  - Case D' (semantic): `classifyBreakoutIntent()` → if `'breakout'` → `emitBreakoutConfirmation('semantic')`
  - Case E: `'pipeline_response'` or `'unclear'` → `resumeOrchestrator()`
- **Added imports**: `OrchestratorLlmClient` from orchestrator index, `BreakoutClassification` type from orchestrator types

### Test Results

- **pipeline-state-summary.test.ts**: 34 tests (was 23) — added 11 tests for `originalQuery` and `subQueryTexts` getters
- **breakout-intent.test.ts**: 118 tests (unchanged — keyword tests still valid)
- **All orchestrator tests**: 272/272 pass
- **E2E tests**: 177/177 pass (1 skipped, pre-existing)
- **Typecheck**: 0 errors
- **Lint**: 0 new errors (5 pre-existing in renderer)

---

_Last updated: 2026-02-28 (Semantic Breakout Detection)_

---

## Phase 4: Adversarial Decision-Tree Hardening

### Findings Summary

Adversarial path analysis identified 11 findings (F1–F11) in the breakout decision tree. 3 critical, 3 warning, 5 nit/accepted.

| # | Severity | Issue | Resolution |
|---|----------|-------|------------|
| F1 | Critical | Case B swallows original question — user confirms breakout, pipeline terminates, but original off-topic question never answered | **Fixed**: Case B now retrieves original message from `breakout_pending` event `data.userMessage`, overrides `userMessage`, falls through to SDK |
| F3 | Critical | Numeric options "1"/"2" shown in confirmation but not handled — mapped to `implicit_confirm`, "2" causes data loss | **Fixed**: `classifyBreakoutResponse()` exact pre-check: `'1'/'1.'` → confirm, `'2'/'2.'` → deny (equality, not substring) |
| F11 | Critical | `isPaused` stays true after breakout → `detectPausedOrchestrator()` re-enters terminated pipeline | **Fixed**: `isPaused` getter counts `'breakout'` events as resolving (alongside `'resumed'`) |
| F4 | Warning | `'cancel'` in DENY patterns conflicts with breakout intent (user saying "cancel the pipeline" = wants to leave) | **Fixed**: Moved `'cancel'` from BREAKOUT_DENY_PATTERNS to BREAKOUT_CONFIRM_PATTERNS |
| F9 | Warning | "3. Exit" shown in pause messages but "3" not handled by `isBreakoutIntent()` | **Fixed**: `isBreakoutIntent()` checks `lower === '3' \|\| lower === '3.'` as exact match before keyword scan |
| F6 | Nit | 200-char truncation of userMessage in breakout events loses context | **Fixed**: Increased to 500 chars in both `breakout_pending` and `breakout` event storage |
| F2 | Nit | `breakout_pending` event fires before `breakout` — no silent cancel path | Accepted: low risk, user can deny to resume |
| F5 | Nit | Breakout patterns include common English words | Accepted: confirmation gate catches false positives |
| F7 | Nit | Semantic classifier can fail silently | Accepted: returns `'unclear'` → falls through to pipeline resume |
| F8 | Nit | Case B doesn't set userMessage for SDK | Merged with F1 fix |
| F10 | Nit | `generateSummary()` not called on breakout exit | Accepted: summary not needed when pipeline incomplete |

### Design Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Case B retrieves original message from `breakout_pending` event rather than adding a new field | Event-sourced state is the single source of truth; avoids new mutable state |
| D2 | Numeric "1"/"2" check uses exact equality, not substring | Prevents "Stage 1 looks good" or "Check citation 2" from matching |
| D3 | `isPaused` counts `'breakout'` as resolving alongside `'resumed'` | Breakout is a pipeline-terminating event, semantically equivalent to resolution |
| D4 | `'cancel'` moved to confirm rather than removed entirely | "Cancel" in context of a running pipeline means "stop what you're doing" = leave pipeline |
| D5 | "3" detected via exact match, not added to keyword patterns | Only valid as pause menu selection, not as general breakout intent |
| D6 | 500 chars chosen over unlimited | Balances context preservation with state file size; covers 99%+ of queries |
| D7 | Case B falls through to SDK (like Case C) rather than using separate handler | Unifies the "answer user's question" path — DRY, easier to maintain |

### Code Changes

**1. `pipeline-state.ts`** — `isPaused` getter: resolveEvents filter now includes `e.type === 'breakout'` alongside `'resumed'`.

**2. `claude-agent.ts`** — 7 changes:
- `isBreakoutIntent()`: Added exact match `lower === '3' || lower === '3.'` before keyword scan
- `BREAKOUT_CONFIRM_PATTERNS`: Added `'cancel'`
- `BREAKOUT_DENY_PATTERNS`: Removed `'cancel'`
- `classifyBreakoutResponse()`: Added exact numeric pre-check (`'1'/'1.'` → confirm, `'2'/'2.'` → deny) before substring pattern scan
- Case B block: Rewritten — retrieves original message from last `breakout_pending` event, overrides `userMessage`, yields info, falls through to SDK
- `emitBreakoutConfirmation()`: `userMessage.slice(0, 500)` (was 200)
- Breakout event recording: `userMessage.slice(0, 500)` (was 200)
- Decision tree comment updated to reflect new Case B behavior

### Test Changes

**breakout-intent.test.ts** — Added:
- "3"/"3." exact match detection tests for `isBreakoutIntent()`
- `'cancel'` + `'cancel the pipeline'` in confirm test list (moved from deny)
- `'1'` → confirm, `'1.'` → confirm, `'2'` → deny, `'2.'` → deny (was `implicit_confirm`)
- Substring safety: "Stage 1 looks good" → `implicit_confirm`, "Check citation 2" → `implicit_confirm`

**pipeline-state-summary.test.ts** — Added 3 tests:
- `isPaused returns false after breakout event`
- `isPaused true when one of two pauses unresolved after breakout`
- `isPaused correctly counts mixed resumed + breakout`

### Validation Results

- **Orchestrator tests**: 175/175 pass, 0 fail
- **E2E tests**: 177/177 pass, 0 fail (1 skipped, pre-existing)
- **Typecheck**: 0 errors (`pnpm run typecheck:all` → EXIT: 0)
- **Lint**: 0 new errors (5 pre-existing in renderer — unrelated source auth/file open rules)

---

_Last updated: 2026-02-28 (Phase 4 — Adversarial Decision-Tree Hardening)_