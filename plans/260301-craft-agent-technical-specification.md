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
|   |   |   |   +-- sessions.ts        #   SessionManager -- agent/session lifecycle (~5570 lines)
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
|   |       |   +-- __tests__/         #       Agent tests (14 files)
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
| `ClaudeAgent` | `claude-agent.ts` | ~4450 | Claude Agent SDK + orchestrator pipeline + breakout/resume |
| `CodexAgent` | `codex-agent.ts` | ~2290 | Codex API integration |
| `CopilotAgent` | `copilot-agent.ts` | ~1300 | VS Code Copilot SDK |
| `BaseAgent` | `base-agent.ts` | ~800 | Shared: permissions, mode management, source toggling |

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

**Orchestrator source files** (16 files, ~6200 lines total):

| File | Lines | Purpose |
|------|-------|---------|
| `stage-runner.ts` | ~1272 | Per-stage dispatch, context assembly, LLM calls, substep progress |
| `pause-formatter.ts` | ~700 | Deterministic pause message formatting (includes "Exit" option) |
| `index.ts` | ~692 | `AgentOrchestrator` class -- run/resume/resumeFromBreakout, event loop |
| `pipeline-state.ts` | ~521 | Immutable event-sourced state with breakout/resume getters |
| `types.ts` | ~504 | All orchestrator type definitions (incl. breakout/resume types) |
| `synthesis-post-processor.ts` | ~474 | Safety net: inject `WEB_REF`/`PRIOR_REF` markers + inline labels |
| `mcp-bridge.ts` | ~326 | MCP tool call abstraction |
| `cost-tracker.ts` | ~262 | Per-stage token accounting, USD budget enforcement |
| `follow-up-context.ts` | ~250 | Follow-up session context loading |
| `context-builder.ts` | ~248 | XML context assembly with token budgeting |
| `mcp-lifecycle.ts` | ~246 | MCP server connect/disconnect lifecycle |
| `baml-adapter.ts` | ~175 | BAML structured output (feature-flagged) |
| `llm-client.ts` | ~157 | Anthropic API wrapper with streaming |
| `context-budget.ts` | ~131 | Token estimation and overflow management |
| `json-extractor.ts` | ~131 | Robust JSON extraction from LLM responses |
| `baml-types.ts` | ~84 | BAML type definitions |

**Key `PipelineState` capabilities:**
- Event-sourced state: `addEvent()` / `loadFrom()` / `saveTo()` with stage outputs, verification scores
- Breakout tracking: `hasBreakout`, `isPaused`, `isBreakoutPending` (counts breakout events as resolving)
- Resume-from-breakout: `isResumableAfterBreakout`, `isBreakoutResumePending`, `lastCompletedStageIndex`
- Summary generation: `generateSummary()` for compaction-safe context injection
- Query extraction: `originalQuery`, `subQueryTexts` for semantic breakout classification

**Breakout & resume flow in `claude-agent.ts`:**
1. **Breakout detection**: Keyword-based (`isBreakoutIntent()`, 23 patterns) + LLM semantic classifier (`classifyBreakoutIntent()`, Opus effort:low) as fallback
2. **Confirmation gate**: Two-step -- detect intent → ask confirmation → act (prevents false-positive data loss)
3. **Context preservation**: `writePipelineSummary()` writes compact JSON; `buildOrchestratorSummaryBlock()` re-injects on every turn via `buildContextParts()`
4. **Resume from breakout**: On re-invocation, `detectOrchestratableAgent()` checks `isResumableAfterBreakout`; `classifyResumeIntent()` determines resume vs. fresh start; `resumeFromBreakout()` continues from `lastCompletedStageIndex + 1` with 24h staleness guard

**14 test files** in `orchestrator/__tests__/` covering: breakout intent classification, breakout-resume intent, follow-up detection, MCP bridge (KB + web), MCP lifecycle, pipeline state (summary, breakout-resume, previous-session), resume/skip routing, Stage 1 telemetry, synthesis post-processing, and orchestrator summary block.

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
| 2026-02-27 | `extract-agent-pipeline-core` | Extract `@craft-agent/agent-pipeline-core` package (9 phases) |
| 2026-02-27 | `mini-completion-cwd-isolation` | Fix `runMiniCompletion` cwd isolation for title gen |
| 2026-02-27 | `transcript-validation-before-resume` | SDK transcript validation before session resume |
| 2026-02-27 | `dynamic-stage-thinking-fix` | Remove broken custom thinking UI, fix pause lifecycle |
| 2026-02-27 | `rich-agent-substep-visibility` | Orchestrator substep events surfaced as TurnCard activities |
| 2026-02-27 | `conversation-disappears-bugfix` | Fix orchTurnId overwriting causing blank conversation |
| 2026-02-28 | `orchestrator-context-continuity` | Pipeline summary context injection, breakout system, confirmation gate, semantic detection, adversarial hardening |
| 2026-02-28 | `resume-pipeline-after-breakout` | Resume pipeline from breakout on agent re-invocation (74 tests) |
| 2026-03-01 | `conversation-history-management` | Conversation history management: delete, edit, restore, branch (88 tasks) |
| 2026-03-01 | `conversation-history-behavioral-fixes` | Behavioral fixes: single-delete, in-place edit, restore to input, icon action bars (42 tasks) |

---

## 15. Future Plans & Roadmap

> Add upcoming features, ideas, and technical debt items here.

---
