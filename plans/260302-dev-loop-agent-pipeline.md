# Plan: Dev Loop Agent — Orchestrator-Driven Autonomous Development Pipeline

> Deterministic multi-stage agent for autonomous feature development.
> Uses the **same orchestrator infrastructure as ISA Deep Research** — direct LLM API calls via `OrchestratorLlmClient`, per-stage prompts, context building, cost tracking.
> Planning stages run through orchestrator LLM calls. Execution stages use SDK breakout.
> Branch: `feature/dev-loop-agent`
> Prior plan archived to: `plans/260302-context-window-logging.md`
>
> Status markers: `[ ]` pending | `[x]` done | `[~]` in progress | `[-]` skipped

---

## Goal

Create a **Dev Loop Agent** (`dev-loop`) that autonomously plans, reviews, implements, tests, and fixes features. Uses the existing orchestrator pipeline (`AgentOrchestrator.create()` → `executePipeline()` → `StageRunner`) with two extensions:

1. **Generic prompt-driven stage handler** — so new agents work without hardcoded stage handlers
2. **SDK breakout mechanism** — so execution stages (implement, test) have full tool access

---

## Architecture: Orchestrator + SDK Breakout

### How it mirrors ISA Deep Research

| ISA Pattern | Dev Loop Equivalent |
|---|---|
| `OrchestratorLlmClient.call()` for each stage | Same — planning stages (0, 2, 3, 6) use direct LLM API calls |
| Per-stage prompts from `agents/{slug}/prompts/` | Same — `getStageSystemPrompt()` loads from `prompts/stage-{id}-{name}.md` |
| `buildStageContext()` shapes XML context | Same — prior stage outputs assembled as XML for each LLM call |
| `extractRawJson()` parses structured output | Same — all orchestrator stages return structured JSON |
| `CostTracker` per-stage token accounting | Same — budget enforcement applies to all stages |
| `PipelineState` immutable event sourcing | Same — checkpoints to disk after each stage |
| `executeRepairLoop()` for verify→synthesize | Same pattern — repair unit `[4, 5]` for implement→test |
| `formatPauseMessage()` for user approval | Extended — generic formatter using `pauseInstructions` from config |
| `mcpBridge.kbSearch()` programmatic tools | Not needed — dev-loop uses SDK breakout instead of MCP bridge |
| Hardcoded `switch(stage.name)` dispatch | Extended — `default:` case calls `runPromptDrivenStage()` |

### Stage Execution Modes

```
Orchestrator LLM calls (like ISA):     SDK breakout (full tool access):
┌──────────────────────────────┐       ┌──────────────────────────────┐
│ Stage 0: analyze_request     │       │ Stage 1: plan                │
│ Stage 2: review              │       │ Stage 4: implement           │
│ Stage 3: refine_plan         │       │ Stage 5: test_and_diagnose   │
│ Stage 6: decide              │       │                              │
│                              │       │ LLM has: Read, Write, Edit,  │
│ 1 focused LLM call per stage │       │ Bash, Grep, Glob, WebSearch  │
│ Context shaped by TypeScript │       │                              │
│ JSON output extracted        │       │ Completes via stage_gate     │
└──────────────────────────────┘       └──────────────────────────────┘
```

### Pipeline Flow

```
User: [agent:dev-loop] "implement dark mode for settings"
  │
  ▼
Stage 0: analyze_request ── ORCHESTRATOR LLM call ──► PAUSE
  │  (workspace metadata injected as XML context)
  ▼
Stage 1: plan ── SDK BREAKOUT ──► PAUSE
  │  (LLM reads codebase freely with Grep/Read/Glob)
  ▼
Stage 2: review ── ORCHESTRATOR LLM call
  │  (receives plan as XML context, outputs findings)
  ▼
Stage 3: refine_plan ── ORCHESTRATOR LLM call ──► PAUSE
  │  (receives plan + findings, outputs refined plan)
  ▼
┌─────────────────────────────────────────────────────┐
│         REPAIR UNIT [4, 5] — Max 5 iterations       │
│                                                      │
│  Stage 4: implement ── SDK BREAKOUT                  │
│    │  (Write/Edit/Bash with typecheck + lint)        │
│    ▼                                                 │
│  Stage 5: test_and_diagnose ── SDK BREAKOUT          │
│    │  (Bash for tests, Read for logs/screenshots)    │
│    ├─ needsRepair=true ──► resume from stage 4       │
│    └─ needsRepair=false ──► continue to stage 6      │
│                                                      │
└─────────────────────────────────────────────────────┘
  │
  ▼
Stage 6: decide ── ORCHESTRATOR LLM call
  ├─ decision=done ──► orchestrator_complete
  ├─ decision=restart ──► agent_state update → reset → re-invoke
  └─ decision=escalate ──► report infrastructure changes
```

### SDK Breakout Mechanism (how it works)

1. `executePipeline()` hits a `mode: 'sdk_breakout'` stage
2. Yields `orchestrator_sdk_breakout` event with stage prompt + prior outputs
3. Generator **returns** (exits) — same pattern as `orchestrator_pause`
4. `runOrchestrator()` in `claude-agent.ts` catches the event
5. Enters SDK `query()` conversation with stage prompt as system context
6. LLM has full tool access, completes work, calls `stage_gate(complete)`
7. `stage_gate(complete)` writes result to `PipelineState` on disk
8. `runOrchestrator()` calls `orchestrator.resumeFromBreakout(fromStage+1)`
9. Orchestrator reloads state from disk and continues pipeline

For repair loops with SDK breakout stages:
- Stage 5 completes with `needsRepair=true` → orchestrator resumes → detects repair needed
- Yields breakout for stage 4 again → SDK runs → yields breakout for stage 5 → SDK runs
- Repeats until `needsRepair=false` or `maxIterations` (5) reached

### Outer Loop (Ralph Wiggum Pattern)

Stage 6 evaluates convergence:
- **All tests pass** → `decision: "done"` → `orchestrator_complete`
- **Repair exhausted, bugs decreasing** → `decision: "restart"` → save state, re-invoke agent
- **3+ restarts with no progress** → `decision: "escalate"` → suggest infrastructure changes

Outer loop state tracked in `agent_state` (persists across pipeline resets).

---

## Key Files

### Files to Create

| File | Role |
|------|------|
| `agents/dev-loop/AGENT.md` | Agent frontmatter (name, description, type) |
| `agents/dev-loop/config.json` | Stages, repair units, pauses, orchestrator config, schemas |
| `agents/dev-loop/prompts/stage-0-analyze-request.md` | System prompt: workspace analysis, scope determination |
| `agents/dev-loop/prompts/stage-1-plan.md` | SDK breakout prompt: codebase research, plan generation |
| `agents/dev-loop/prompts/stage-2-review.md` | System prompt: adversarial review of plan |
| `agents/dev-loop/prompts/stage-3-refine-plan.md` | System prompt: refine plan with review findings |
| `agents/dev-loop/prompts/stage-4-implement.md` | SDK breakout prompt: phase-by-phase implementation |
| `agents/dev-loop/prompts/stage-5-test-and-diagnose.md` | SDK breakout prompt: test, capture evidence, classify bugs |
| `agents/dev-loop/prompts/stage-6-decide.md` | System prompt: convergence assessment, escalation |

### Files to Modify

| File | Change |
|------|--------|
| `packages/shared/src/agents/types.ts` | Make `depthModes`, `verification`, `followUp` optional |
| `packages/shared/src/agent/orchestrator/types.ts` | Add `mode?: StageMode` to `StageConfig`, add `orchestrator_sdk_breakout` event |
| `packages/shared/src/agent/orchestrator/stage-runner.ts` | Add `runPromptDrivenStage()` as `default:` case in `runStage()` |
| `packages/shared/src/agent/orchestrator/index.ts` | Detect `sdk_breakout` stages in `executePipeline()`, yield breakout event |
| `packages/shared/src/agent/orchestrator/pause-formatter.ts` | Add generic `pauseInstructions`-based formatting for non-ISA stages |
| `packages/shared/src/agent/claude-agent.ts` | Handle `orchestrator_sdk_breakout` in `processOrchestratorEvents()` |

---

## Phases

### Phase 1: Type System & Generic Stage Handler

Make the orchestrator infrastructure support non-ISA agents. This is the foundation everything else builds on.

**1a. Make ISA-specific AgentConfig fields optional** (`packages/shared/src/agents/types.ts`)

- [x] Change `depthModes: Record<string, DepthModeConfig>` → `depthModes?: Record<string, DepthModeConfig>`
- [x] Change `verification: VerificationConfig` → `verification?: VerificationConfig`
- [x] Change `followUp: FollowUpConfig` → `followUp?: FollowUpConfig`
- [x] Grep all usages of `depthModes`, `verification`, `followUp` — all already use optional chaining or type guards
- [x] Validate: `pnpm run typecheck:all` — passes

**1b. Add `StageMode` to orchestrator types** (`packages/shared/src/agent/orchestrator/types.ts`)

- [x] Add type: `export type StageMode = 'orchestrator' | 'sdk_breakout';`
- [x] Add optional `mode` field to `StageConfig`: `mode?: StageMode;` (default: `'orchestrator'`)
- [x] Add SDK breakout event to `OrchestratorEvent` union
- [x] Add `'sdk_breakout'` to `OrchestratorExitReason` union
- [x] Validate: `pnpm run typecheck:all` — passes

**1c. Add generic prompt-driven stage handler** (`packages/shared/src/agent/orchestrator/stage-runner.ts`)

- [x] Add `runPromptDrivenStage()` method to `StageRunner` class
- [x] Change `default:` case in `runStage()` switch to call `runPromptDrivenStage()`
- [x] Validate: `pnpm run typecheck:all` — passes
- [x] Validate: Existing ISA stages still match their explicit `case` labels (no behavioral change)

### Phase 2: SDK Breakout Mechanism

Enable the orchestrator to yield control to the SDK for stages that need tool access.

**2a. Orchestrator pipeline breakout** (`packages/shared/src/agent/orchestrator/index.ts`)

- [x] In `executePipeline()` stage loop, before the pause-after check:
  - Check `stage.mode === 'sdk_breakout'`
  - If breakout: load stage prompt via `getStageSystemPrompt()`, gather prior outputs from `state`
  - Yield `{ type: 'orchestrator_sdk_breakout', stage: stage.id, name: stage.name, prompt, priorOutputs }`
  - Add `breakout` event to PipelineState, save state and `return`
- [x] Handle repair loop with breakout stages:
  - When `executeRepairLoop()` encounters a repair stage with `mode: 'sdk_breakout'`:
  - Yield breakout event instead of calling `runStage()`
  - Return current state — repair continues after `resumeFromBreakout()`
- [x] Added `mode` field to `StageDefinition` in `agents/types.ts`
- [x] Updated `toOrchestratorAgentConfig()` to pass `mode` through
- [x] Changed repair loop `stages` parameter type from inline to `StageConfig[]`
- [x] Validate: `pnpm run typecheck:all` — passes

**2b. claude-agent.ts SDK breakout handler** (`packages/shared/src/agent/claude-agent.ts`)

- [x] Added `_sdkBreakoutContext` field to store breakout context
- [x] Added `orchestrator_sdk_breakout` case in `processOrchestratorEvents()`:
  - Stores context, writes bridge state, sets exitReason='sdk_breakout'
- [x] Updated `runOrchestrator()` finally block to preserve bridge state on `sdk_breakout`
- [x] Updated `resumeFromBreakoutOrchestrator()` finally block similarly
- [x] Updated `resumeOrchestrator()` finally block similarly
- [x] Added SDK breakout notification text yield before complete in all three methods
- [x] Validate: `pnpm run typecheck:all` — passes

**2c. Pause formatter extension** (`packages/shared/src/agent/orchestrator/pause-formatter.ts`)

- [x] Added `pauseInstructions?: string` to `FormatPauseOptions` interface
- [x] Added `pauseInstructions?: string` to `StageConfig` in orchestrator types
- [x] Added `buildPauseInstructionsMessage()` helper function for non-ISA agents
- [x] Before ISA-specific stage 0/1 handlers, check for `pauseInstructions` — uses config template with collapsible JSON
- [x] Wired `stage.pauseInstructions` through `executePipeline()` → `formatPauseMessage()` options
- [x] Passed `pauseInstructions` through `toOrchestratorAgentConfig()` stage mapping
- [x] Validate: `pnpm run typecheck:all` — passes

### Phase 3: Agent Definition Files

Create the full `agents/dev-loop/` directory.

**3a. Core agent files**

- [x] Created `agents/dev-loop/AGENT.md` with name, description frontmatter
- [x] Created `agents/dev-loop/config.json` with 7 stages, modes, schemas, repair unit, orchestrator config
- [x] Validate: `agent_validate` — passed

**3b. Orchestrator stage prompts** (stages that make direct LLM API calls)

- [x] Created `agents/dev-loop/prompts/stage-0-analyze-request.md` — scope analysis, workspace detection, stack detection
- [x] Created `agents/dev-loop/prompts/stage-2-review.md` — adversarial review with finding classification
- [x] Created `agents/dev-loop/prompts/stage-3-refine-plan.md` — triage findings, produce refined phases
- [x] Created `agents/dev-loop/prompts/stage-6-decide.md` — convergence assessment with done/restart/escalate

**3c. SDK breakout stage prompts** (stages that get full tool access)

- [x] Created `agents/dev-loop/prompts/stage-1-plan.md` — codebase research + plan generation with stage_gate complete
- [x] Created `agents/dev-loop/prompts/stage-4-implement.md` — phase-by-phase execution with typecheck/lint validation
- [x] Created `agents/dev-loop/prompts/stage-5-test-and-diagnose.md` — test execution, bug classification, repair assessment

### Phase 4: Context Building for Dev Loop Stages

Wire up workspace metadata injection and stage context for orchestrator LLM calls.

- [x] Added `workspacePath?: string` to orchestrator's `AgentConfig` type
- [x] Passed `workspacePath` through `toOrchestratorAgentConfig()` from `this.workspaceRootPath`
- [x] Extended `BuildStageContextOptions` with `workspaceMetadata?: string` and `agentState?: string`
- [x] Extended `buildStageContext()` with `<WORKSPACE_METADATA>` and `<AGENT_STATE>` XML sections
- [x] Added `gatherWorkspaceMetadata()` function: reads package.json (name, version, scripts, deps), tsconfig.json, test config files, top-level directory listing
- [x] Added `readAgentStateForContext()` function: reads state.json from agent session data dir
- [x] In `runPromptDrivenStage()`: auto-injects workspace metadata when first stage (no prior outputs), agent state when stage name is `decide`
- [x] Note: Stages 2 (review) and 3 (refine_plan) get plan/findings via existing `STAGE_OUTPUT_*` XML sections — no special context building needed
- [x] Validate: `pnpm run typecheck:all` — passes

### Phase 5: Outer Loop & Agent State Wiring

Enable Stage 6 to trigger pipeline restarts for the Ralph Wiggum pattern.

- [x] Stage 6 prompt already instructs LLM to read `<AGENT_STATE>` for iteration history (Phase 3)
- [x] Stage 6 prompt already defines decision thresholds: done/restart/escalate with 3+ restart escalation (Phase 3)
- [x] Added outer loop in `runOrchestrator()`: while loop around pipeline execution, max 3 restarts
- [x] Added `checkDevLoopRestartDecision()`: reads PipelineState Stage 6 output for decision field
- [x] Added `updateDevLoopIterationState()`: writes iteration count + bug history to agent state.json
- [x] Added `buildEscalationReport()`: builds user-facing escalation report from Stage 6 output + state
- [x] On `restart`: updates agent_state, yields notification text, re-runs pipeline
- [x] On `escalate`: yields escalation report with bug summary and recommended action
- [x] On `done` or no decide stage: normal completion (no change)
- [x] Agent state schema: `iteration_history.outer_loop_count`, `bug_history[]` with per-iteration test results
- [x] Validate: `pnpm run typecheck:all` — passes; lint only shows pre-existing errors

### Phase 6: Integration Testing & Refinement

- [x] Validate agent config: `mcp__session__agent_validate({ agentSlug: 'dev-loop' })` — passed
- [x] Verify orchestrator detection: `detectOrchestratableAgent()` checks `agent.config?.controlFlow?.stages?.length > 0` — dev-loop has 7 stages, would match
- [x] Verify stage dispatch: dev-loop stage names (`analyze_request`, `plan`, `review`, `refine_plan`, `implement`, `test_and_diagnose`, `decide`) do NOT match ISA-specific case labels — all fall through to `default:` → `runPromptDrivenStage()`
- [x] Verify prompt naming: `loadStagePrompt()` uses `stage-{id}-{name.replace(/_/g, '-')}.md` — all 7 prompt files match convention
- [x] Verify SDK breakout wiring: `executePipeline()` checks `stage.mode === 'sdk_breakout'` → yields `orchestrator_sdk_breakout` event → `claude-agent.ts` stores `_sdkBreakoutContext` → exit reason `sdk_breakout` → `resumeFromBreakout()`
- [x] Verify repair loop breakout: `executeRepairLoop()` also handles `sdk_breakout` mode stages with same yield+return pattern
- [x] Verify pause flow: `pauseAfterStages: [0, 1, 3]` with `pauseInstructions` config → `formatPauseMessage()` → `buildPauseInstructionsMessage()`
- [x] Verify workspace metadata: `gatherWorkspaceMetadata()` injected when no prior outputs (first stage), `readAgentStateForContext()` injected when stage name is `decide`
- [x] Verify outer loop: `checkDevLoopRestartDecision()` reads Stage 6 output, `updateDevLoopIterationState()` writes to state.json, max 3 restarts
- [x] Verify ISA regression: ISA pipeline e2e test — 40/40 checks passed, no regression
- [x] `pnpm run typecheck:all` — passes clean
- [x] `pnpm run lint` — only pre-existing errors (none from dev-loop changes)
- [x] `pnpm run test` — ISA e2e 40/40 passed; `agent-pipeline-core` failures are pre-existing (no files in that package were modified); `bun:` protocol errors are pre-existing Node.js compat issue
- [-] `pnpm run electron:dev` — deferred to manual smoke test after commit
- [-] Manual end-to-end with feature request — deferred to post-commit smoke test

---

## Risks & Considerations

| Risk | Mitigation |
|------|------------|
| **SDK breakout complexity** — Orchestrator→SDK handoff is a new pattern | Phase 2 is self-contained. Uses same `resumeFromBreakout()` that already exists for breakout-from-pause. The only new part is triggering breakout FROM the orchestrator rather than from user input. |
| **Repair loop with breakout stages** — `executeRepairLoop()` calls `runStage()` directly, doesn't support breakout | Modify repair loop to check stage mode and yield breakout events. Repair state persists to disk via PipelineState, so each resume picks up where it left off. |
| **Generic handler breaks ISA** — Adding `default:` case could mask ISA stage name typos | ISA stages match explicit `case` labels first. Generic fallback only fires for `default:`. Add diagnostic logging so misconfigured ISA stages are caught. |
| **Type system changes break ISA code paths** — Making `depthModes` etc. optional | ISA config still provides these fields — runtime values unchanged. Only compile-time types change. Grep all usages and add null checks. |
| **Context window growth in breakout stages** — SDK conversation grows with tool calls | Each breakout stage starts a fresh SDK conversation. Prior context is injected as structured XML, not raw conversation history. Stage_gate schema enforcement validates output. |
| **Outer loop infinite recursion** — Stage 6 restarts endlessly | Hard limit: 3 restarts tracked in `agent_state`. Stage 6 prompt enforces escalation threshold. |
| **Workspace-agnostic operation** — Different projects have different stacks | Stage 0 gathers workspace metadata. Stage prompts use detected project type to adapt commands. |

---

## Testing Strategy

- [x] `pnpm run typecheck:all` — passes after every phase
- [x] `pnpm run lint` — only pre-existing errors, none from our changes
- [x] `pnpm run test` — ISA e2e 40/40 passed, no regressions from our changes
- [x] `mcp__session__agent_validate({ agentSlug: 'dev-loop' })` — agent config valid
- [ ] Manual: `[agent:dev-loop]` with feature request — verify full pipeline
- [ ] Manual: verify repair loop triggers on test failure
- [ ] Manual: verify SDK breakout → resume cycle works
- [ ] Manual: verify pause/resume at stages 0, 1, 3
- [ ] `pnpm run electron:dev` — app starts, feature works end-to-end
