# Plan: Stage Gate Pause Enforcement — Complete Defense-in-Depth

> This file tracks implementation progress. Updated by slash commands and manual edits.
> Status markers: `[ ]` pending | `[x]` done | `[~]` in progress | `[-]` skipped
>
> **Predecessor**: Archived to `plans/260216-subagent-abort-propagation.md`

## Goal

Make the stage gate pause **mechanically unbypassable**: when a pipeline pauses after a stage, execution stops, the user sees a clear pause indicator, and no further tool calls can advance the pipeline until the user provides input in a new message.

Currently, the LLM can batch `complete(0)` + `resume(proceed)` + `start(1)` in one response. The SDK processes them sequentially in the same event loop tick — `handleComplete` sets `pausedAtStage` and fires `forceAbort`, but the SDK continues processing `handleResume` (which clears `pausedAtStage`) and `handleStart(1)` (which starts the next stage) before the abort signal interrupts the async iterator.

## End-to-End Flow Traced (Verified)

### Pause Flow (current — with gaps)

```
LLM response batch: [complete(0), resume(proceed), start(1)]
                           │                │              │
  ┌────────────────────────▼────────────────┼──────────────┼───────────┐
  │ handleComplete(0)                       │              │           │
  │  ├─ sets state.pausedAtStage = 0        │              │           │
  │  ├─ writes state to disk (atomic)       │              │           │
  │  ├─ calls onAgentStagePause ─────────────────────────────┐        │
  │  │   ├─ sessions.ts: stopRequested=true │              │ │        │
  │  │   ├─ sessions.ts: forceAbort() ──────│──────ASYNC───│─│──►     │
  │  │   └─ sessions.ts: sends pause event  │              │ │        │
  │  └─ returns { allowed: false }          │              │ │        │
  ├─────────────────────────────────────────▼──────────────┼─┼────────┤
  │ handleResume(proceed)  ← GAP: NO GUARD  │              │ │        │
  │  ├─ clears state.pausedAtStage = undef  │              │ │        │
  │  └─ returns { nextStage: 1 }            │              │ │        │
  ├────────────────────────────────────────────────────────▼─┼────────┤
  │ handleStart(1)         ← GAP: NO GUARD                  │        │
  │  ├─ starts stage 1 (pausedAtStage already cleared!)      │        │
  │  └─ returns { allowed: true }                            │        │
  └──────────────────────────────────────────────────────────┼────────┘
                                                             │
                                    forceAbort interrupts ◄──┘
                                    ... too late, stage 1 already started
```

### Pause Flow (fixed — with all guards)

```
LLM response batch: [complete(0), resume(proceed), start(1)]
                           │                │              │
  ┌────────────────────────▼────────────────┼──────────────┼───────────┐
  │ handleComplete(0)                       │              │           │
  │  ├─ sets state.pausedAtStage = 0        │              │           │
  │  ├─ writes state to disk (atomic)       │              │           │
  │  ├─ calls onAgentStagePause ─────────────────────────────┐        │
  │  │   ├─ sets managed.pauseLocked = true │              │ │        │
  │  │   ├─ stopRequested = true            │              │ │        │
  │  │   ├─ forceAbort() ──────ASYNC────────│──────────────│─│──►     │
  │  │   └─ sends pause event to renderer   │              │ │        │
  │  └─ returns { allowed: false }          │              │ │        │
  ├─────────────────────────────────────────▼──────────────┼─┼────────┤
  │ handleResume(proceed)                                  │ │        │
  │  ├─ checks isPauseLocked() → TRUE       ← BLOCKED     │ │        │
  │  └─ returns { allowed: false, reason: "just paused" }  │ │        │
  ├────────────────────────────────────────────────────────▼─┼────────┤
  │ handleStart(1)                                           │        │
  │  ├─ reads state → pausedAtStage = 0     ← BLOCKED       │        │
  │  └─ returns { allowed: false, reason: "paused" }        │        │
  └──────────────────────────────────────────────────────────┼────────┘
                                                             │
                                    forceAbort interrupts ◄──┘
                                    ✓ stage 1 never started
```

## 5-Layer Defense Architecture

| Layer | Mechanism | File | Status |
|-------|-----------|------|--------|
| **L1: LLM Instruction** | `handleComplete` returns `allowed: false` with "Do NOT call resume" | `agent-stage-gate.ts` L837 | ✅ Exists (advisory) |
| **L2: Process Kill** | `forceAbort()` → SIGTERM + 2s delayed close → SIGKILL | `claude-agent.ts` L2631 | ✅ Implemented |
| **L3: Handler Guards** | Every handler checks `pausedAtStage`; resume checks `isPauseLocked` | `agent-stage-gate.ts` | ✅ Implemented |
| **L4: Session State** | `onAgentStagePause` + `onProcessingStopped` + resume context injection | `sessions.ts` | ✅ Implemented |
| **L5: Renderer UI** | `agent_stage_gate_pause` event sets visible pause state | `processor.ts` L247 | ✅ Implemented |

## All Findings

| # | Finding | Severity | Layer | Description |
|---|---------|----------|-------|-------------|
| F1 | `handleStart` no guard | CRITICAL | L3 | Both stage=0 and stage>0 paths proceed when paused |
| F2 | `handleComplete` no entry guard | CRITICAL | L3 | Can complete another stage while paused |
| F3 | `handleReset` clears state unconditionally | WARNING | L3 | Deletes state file including `pausedAtStage` |
| F4 | `handleResume` no caller check | CRITICAL | L3 | LLM self-resumes in same batch as complete |
| F5 | `makeResult` omits `pausedAtStage` | WARNING | L3 | Only `handleStatus` patches it; other results hide pause |
| F6 | Stale threshold overwrites paused run | WARNING | L3 | stage=0 replaces paused run after 300s |
| F7 | Repair handlers no guard | WARNING | L3 | repair, start_repair_unit, end_repair_unit all proceed |
| F8 | Renderer pause event is no-op | WARNING | L5 | No state change, no visual indicator |
| F9 | `isPauseLocked` callback doesn't exist | INFO | L3 | No way to distinguish same-turn vs new-turn tool calls |
| F10 | Previous fix never deployed | NIT | — | User ran old code |

## Key Files

| File | Role | Changes |
|------|------|---------|
| `packages/session-tools-core/src/handlers/agent-stage-gate.ts` | All 8 action handlers | F1-F7: Guards + makeResult fix |
| `packages/session-tools-core/src/context.ts` | `SessionToolCallbacks` interface | F9: Add `isPauseLocked` |
| `packages/shared/src/agent/claude-context.ts` | `ClaudeContextOptions` + factory | F9: Wire `isPauseLocked` through context |
| `packages/shared/src/agent/session-scoped-tools.ts` | Callback registry | F9: Add `isPauseLocked` to registry + wiring |
| `packages/shared/src/agent/claude-agent.ts` | Agent wrapper | F9: Property + callback registration |
| `apps/electron/src/main/sessions.ts` | Session manager | F4/F9: `pauseLocked` flag + wiring |
| `apps/electron/src/shared/types.ts` | `Session` interface | F8: Add `pausedAgent` field |
| `apps/electron/src/renderer/event-processor/processor.ts` | Renderer event handler | F8: Set `pausedAgent` state |

---

## Phases

### Phase 1: `makeResult` — Expose `pausedAtStage` in ALL Results (F5)

Currently only `handleStatus` manually patches `pausedAtStage` into the result. Fix `makeResult` so it's always included.

- [x] In `makeResult()` (~L336 of `agent-stage-gate.ts`): Add `...(state.pausedAtStage !== undefined ? { pausedAtStage: state.pausedAtStage } : {})` to the returned object
- [x] In `handleStatus()` (~L1048): Remove the manual `if (state.pausedAtStage !== undefined) { result.pausedAtStage = state.pausedAtStage; }` block — now redundant
- [x] Validate: `pnpm run typecheck:all`

### Phase 2: Handler Guards — `handleStart` (F1, F6)

Block ALL `start` calls when the pipeline is paused. Protect paused runs from silent replacement by the stale-run logic.

- [x] In `handleStart()` stage=0 path (~L448): **Before** the existing staleness check on `existing`, add: if `existing?.pausedAtStage !== undefined`, return `makeResult(existing, config, { allowed: false, reason: "Active run ${existing.runId} is paused at stage ${existing.pausedAtStage}. Resume (proceed/abort) or reset with force:true before starting a new run." })` — this runs regardless of the run's age
- [x] In `handleStart()` stage>0 path (~L524): After `const state = readRunState(...)` and the null check, add: if `state.pausedAtStage !== undefined`, return `makeResult(state, config, { allowed: false, reason: "Pipeline is paused at stage ${state.pausedAtStage}. Cannot start stage ${stage} until resumed." })`
- [x] Validate: `pnpm run typecheck:all`

### Phase 3: Handler Guard — `handleComplete` (F2)

Block completing any stage while paused.

- [x] In `handleComplete()` (~L589): After reading `state` from disk and the `currentStage !== stage` check, add: if `state.pausedAtStage !== undefined`, return `makeResult(state, config, { allowed: false, reason: "Pipeline is paused at stage ${state.pausedAtStage}. Cannot complete stage ${stage} until resumed." })`
- [x] Validate: `pnpm run typecheck:all`

### Phase 4: Handler Guards — Repair Handlers (F7)

Block repair operations while paused.

- [x] In `handleRepair()` (~L873): After reading state and null check, add: if `state.pausedAtStage !== undefined`, return `makeResult(state, config, { allowed: false, reason: "Pipeline paused at stage ${state.pausedAtStage}. Cannot repair until resumed." })`
- [x] In `handleStartRepairUnit()` (~L958): Same guard pattern
- [x] In `handleEndRepairUnit()` (~L1003): Same guard pattern
- [x] Validate: `pnpm run typecheck:all`

### Phase 5: Handler Guard — `handleReset` (F3)

Prevent reset from destroying paused pipeline state unless explicitly forced.

- [x] In `handleReset()` (~L1068): After reading state, if `state?.pausedAtStage !== undefined && args.data?.force !== true`, return `{ allowed: false, ..., reason: "Cannot reset a paused pipeline (paused at stage ${state.pausedAtStage}). Use data: { force: true } to override, or resume with abort first." }`
- [x] Validate: `pnpm run typecheck:all`

### Phase 6: `isPauseLocked` Callback Chain (F4, F9)

Thread a `isPauseLocked` callback from `sessions.ts` through to `handleResume` to prevent LLM self-resume in the same turn.

**Chain**: `sessions.ts managed.pauseLocked` → `ClaudeAgent.isPauseLocked` → `registerSessionScopedToolCallbacks` → `getSessionScopedToolCallbacks` → `createClaudeContext` → `ctx.callbacks.isPauseLocked`

- [x] **6a.** `packages/session-tools-core/src/context.ts` — `SessionToolCallbacks` interface (~L62): Add `isPauseLocked?: () => boolean`
- [x] **6b.** `packages/shared/src/agent/session-scoped-tools.ts` — `SessionScopedToolCallbacks` interface (~L80): Add `isPauseLocked?: () => boolean`
- [x] **6c.** `packages/shared/src/agent/claude-context.ts` — `ClaudeContextOptions` interface (~L75): Add `isPauseLocked?: () => boolean`
- [x] **6d.** `packages/shared/src/agent/claude-context.ts` — `createClaudeContext()` callbacks object (~L125): Add `isPauseLocked: options.isPauseLocked`
- [x] **6e.** `packages/shared/src/agent/session-scoped-tools.ts` — `getSessionScopedTools()` createClaudeContext call (~L630): Add:
  ```typescript
  isPauseLocked: () => {
    const callbacks = getSessionScopedToolCallbacks(sessionId);
    return callbacks?.isPauseLocked?.() ?? false;
  },
  ```
- [x] **6f.** `packages/shared/src/agent/claude-agent.ts` — Add public property `isPauseLocked?: () => boolean` alongside existing `onAgentStagePause` (added to `BaseAgent` instead for union compatibility)
- [x] **6g.** `packages/shared/src/agent/claude-agent.ts` — `registerSessionScopedToolCallbacks` call (~L488): Add:
  ```typescript
  isPauseLocked: () => this.isPauseLocked?.() ?? false,
  ```
- [x] **6h.** `apps/electron/src/main/sessions.ts` — Wire `managed.pauseLocked`:
  - Add `managed.pauseLocked = false` where managed session is initialized
  - Add `managed.agent.isPauseLocked = () => managed.pauseLocked === true` alongside other callback wiring (~L2909)
  - In `onAgentStagePause` callback (~L2961): Add `managed.pauseLocked = true` before `forceAbort()`
  - In `onProcessingStopped()` (~L4462): Add `managed.pauseLocked = false` alongside `managed.stopRequested = false`
- [x] Validate: `pnpm run typecheck:all`

### Phase 7: Guard `handleResume` with `isPauseLocked` (F4)

Use the callback from Phase 6 to block LLM self-resume.

- [x] In `handleResume()` (~L1097 of `agent-stage-gate.ts`): After reading state and before the existing `pausedAtStage === undefined` check, add:
  ```typescript
  if (ctx.callbacks.isPauseLocked?.()) {
    return makeResult(state, config, {
      allowed: false,
      reason: 'Pipeline was just paused in this turn. Resume is only available after the user provides input in a new message.',
    });
  }
  ```
- [x] Validate: `pnpm run typecheck:all`

### Phase 8: Renderer — Visible Pause State (F8)

Make the renderer aware that an agent pipeline is paused.

- [x] **8a.** `apps/electron/src/shared/types.ts` — `Session` interface (~L313): Add optional field:
  ```typescript
  pausedAgent?: { agentSlug: string; stage: number; runId: string }
  ```
- [x] **8b.** `apps/electron/src/renderer/event-processor/processor.ts` (~L247): Update `agent_stage_gate_pause` handler from no-op to:
  ```typescript
  case 'agent_stage_gate_pause':
    return {
      state: {
        ...state,
        session: {
          ...state.session,
          pausedAgent: { agentSlug: event.agentSlug, stage: event.stage, runId: event.runId },
        },
      },
      effects: [],
    }
  ```
- [x] **8c.** In the `agent_stage_started` event handler (same file): Clear `pausedAgent` when the next stage starts:
  ```typescript
  pausedAgent: undefined,
  ```
- [x] **8d.** Verify the `AgentStageGatePauseEvent` type in `types.ts` includes `agentSlug`, `stage`, `runId` (already confirmed)
- [x] Validate: `pnpm run typecheck:all`

### Phase 9: Build, Lint, Deploy, Test

- [x] `pnpm run typecheck:all`
- [x] `pnpm run lint` (no new errors/warnings — all 5 errors and 61 warnings are pre-existing)
- [x] `pnpm run electron:build`
- [x] Verify guards in built `main.cjs`: search for "Pipeline is paused" and "isPauseLocked"
- [ ] **RESTART Electron app** (critical — previous fixes were never deployed because user didn't restart)

**Manual Tests:**
- [ ] Start ISA Deep Research → Stage 0 completes → Stage 1 does NOT start → assistant message shows pause instructions
- [ ] While paused, send "proceed" → agent resumes → Stage 1 starts
- [ ] While paused, send "abort" → agent aborts → run state cleared
- [ ] While paused, send unrelated question → resume context still injected → agent handles both
- [ ] Normal cancel button (UserStop) still shows "Response interrupted"
- [ ] Reset while paused → rejected unless `force: true`
- [ ] App crash while paused → restart → next message picks up paused state

### Phase 10: Renderer Pause Message Delivery (NEW)

- [x] `apps/electron/src/main/sessions.ts` — In `onAgentStagePause`, after `managed.messages.push(resumeMessage)`, flush pending deltas via `this.flushDelta(managed.id, managed.workspace.id)`
- [x] `apps/electron/src/main/sessions.ts` — Emit synthetic renderer event:
  - `type: 'text_complete'`
  - `text: resumeMessage.content`
  - `isIntermediate: false`
  - `turnId: \`pause-${runId}-${stage}\``
- [x] Keep existing `agent_stage_gate_pause` event (metadata for `pausedAgent`) and `forceAbort` behavior

### Phase 11: Strict Resume Intent Gating (NEW)

- [x] `apps/electron/src/main/sessions.ts` — Tightened `getPausedAgentResumeContext()` instructions:
  - Require clear proceed/abort/modify intent
  - Add explicit signal examples for proceed and abort
  - Require concrete changes for modify
  - For unrelated user messages: do **not** resume/start; answer normally and remind user pipeline is still paused

### Phase 12: Queue Hold While Paused (NEW)

- [x] `apps/electron/src/main/sessions.ts` — In `onProcessingStopped`, detect paused pipelines via `getPausedAgentResumeContext(sessionPath) !== null`
- [x] If paused pipeline exists: do **not** auto-drain `messageQueue`; hold queued messages to prevent implicit continuation
- [x] Continue emitting `complete` event so UI exits processing state and user can respond

### Validation Update (Post-Phase 10-12)

- [x] `pnpm run typecheck:all` (PASS)
- [-] `pnpm run lint` (workspace still has 5 pre-existing errors and 61 pre-existing warnings; no new errors from these changes)
- [x] `pnpm run electron:build` (PASS)

---

## Risks & Considerations

| Risk | Mitigation |
|------|------------|
| **`isPauseLocked` callback chain is 5 hops** | Each hop is trivial delegation. Even if this chain fails, Phases 2-5 (state-file guards) independently block start/complete/repair/reset. Only resume self-call bypasses state-file guards. |
| **Paused run blocks legitimate new runs** | Intentional. User must `resume(abort)` or `reset(force)` first. Prevents silent data loss. |
| **`pausedAgent` on Session type not cleared on complete** | Cleared when `agent_stage_started` fires for next stage. If pipeline is aborted, it stays set until session is reloaded (session reload clears transient state). Acceptable. |
| **Codex subprocess path also needs `isPauseLocked`** | Codex uses `__CALLBACK__` over stderr (async). Tool batching works differently in subprocess mode. Lower risk — defer if needed. State-file guards (F1-F3, F7) still protect Codex path. |
| **Existing paused state files** | All guards read from state file. Existing paused pipelines are immediately protected after deploy. No migration needed. |
| **300s stale threshold still applies to non-paused runs** | Only paused runs get special protection (F6). Non-paused stale runs still get replaced — correct behavior. |
| **Double `complete` events from forceAbort path** | Already fixed in predecessor plan — `onAgentStagePause` no longer sends duplicate complete; centralized in `onProcessingStopped`. |
