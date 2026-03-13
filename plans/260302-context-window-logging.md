# Plan: Breakout Scope Enforcement + Debug Context Files (v2)

> Fixes dev-loop agent pipeline escaping orchestrator control (session 260305-fine-torrent).
> Adds human-readable `.txt` debug context files for post-hoc debugging.
> **v2**: Incorporates adversarial review findings F1-F10.
> Prior plan archived to: `plans/260305-dev-loop-attachment-resume-intent.md`
>
> Status markers: `[ ]` pending | `[x]` done | `[~]` in progress | `[-]` skipped

---

## Goal

Two fixes:
1. **Breakout containment**: Prevent the LLM from self-driving through all pipeline stages during an SDK breakout. Only the orchestrator should advance stages.
2. **Debug context files**: Write human-readable `.txt` debug files capturing the full LLM context for each stage/step/turn — max 100 files per agent per session — enabling post-hoc debugging of agent context windows.

## Analysis

### Root Cause: Breakout Containment Failure (session 260305-fine-torrent)

Three compounding failures allow the LLM to take over the pipeline:

```
executePipeline()
  → yield orchestrator_sdk_breakout (stage 1)
  → return (exits pipeline loop)

chat() [SDK breakout turn 1]
  → executeSdkBreakoutStage()
  → _sdkBreakoutContext consumed (one-shot)
  → _breakoutSystemPromptAppend consumed (one-shot)
  → chat() delegates to SDK
  → LLM works on stage 1...
  → chat() returns
  → checkBreakoutStageCompletion() — stage NOT complete yet
  → _activeBreakoutMeta = null  ← CLEARED (lost forever)

chat() [SDK breakout turn 2+]
  → _sdkBreakoutContext = null (consumed)
  → _activeBreakoutMeta = null (cleared)
  → detectPausedOrchestrator() — no match (pipeline exit was sdk_breakout, not paused)
  → detectOrchestratableAgent() — no match (user said "carry on", no [agent:] mention)
  → FALLS THROUGH to normal SDK chat
  → LLM calls stage_gate(complete, stage=1) → paused
  → LLM calls stage_gate(resume) → allowed, nextStage: 2
  → LLM calls stage_gate(start, stage=2) → ALLOWED ← THE BUG
  → LLM drives stages 2-6 — orchestrator never regains control
```

**Level 1 — Stage Gate Handler (no scope enforcement):** `handleStart()` at `agent-stage-gate.ts:441` validates prerequisites (stage N-1 completed) and pause state, but has NO concept of breakout scope. Any caller can start any stage.

**Level 2 — Post-Turn Check (first turn only, then lost):** `executeSdkBreakoutStage()` clears `_activeBreakoutMeta` after the first `chat()` return. On turn 2+, `chat()` has no breakout awareness — it's a normal SDK conversation.

**Level 3 — System Prompt (consumed, no stop instruction):** `_breakoutSystemPromptAppend` is consumed once (set to null after first use). Subsequent turns have no breakout instructions. The prompt also never says "STOP after this stage."

### Adversarial Review Findings Incorporated

| Finding | Issue | Resolution |
|---------|-------|------------|
| **F1** (Critical) | Keeping `_activeBreakoutMeta` indefinitely causes infinite auto-resume on normal post-breakout turns | Lifecycle-managed: conditionally inject check, clear on successful resume/fresh start/new orchestrator run |
| **F2** (Critical) | Keeping `_breakoutSystemPromptAppend` indefinitely corrupts all subsequent non-breakout chat turns | Conditionally inject only when `_activeBreakoutMeta` is set, not consumed-and-nulled |
| **F3** (Warning) | Post-turn completion check placement imprecise — multiple exit points in `chat()` | Precise spec: insert at line ~2121 after `for await` completes, before defensive `yield complete` |
| **F4** (Warning) | `StageRunner` has no `runId` — cannot compute `runs/{runId}/contexts/` path | Debug files use `{agentSlug}/contexts/` path — no `runId` needed |
| **F5** (Warning) | `sessions.ts` `onContextWindowEntry` has no agent metadata | Not needed — callback fires inside `ClaudeAgent.convertSDKMessage()` where `_activeBreakoutMeta` is directly accessible |
| **F7** (Warning) | `handleResume` typed result lacks `breakoutScopeActive` field | Uses existing `reason?: string` field for stop instruction — no type extension needed |
| **F8** (Nit) | Sequential breakouts may collide | Order is always: clear breakout meta → resume orchestrator → orchestrator sets new breakout context. Clear-then-set sequencing is correct. |
| **F6** (Nit) | Theoretical TOCTOU between `setBreakoutScope` and handler | No risk: sequential execution |
| **F10** (Nit) | Debug context rotation TOCTOU on concurrent writes | Accepted: worst case 101 files briefly |

### Context Window Logging (current state)

Both orchestrator and conversation entries write to a single `context-windows.jsonl` via `appendContextWindowEntry()`. No per-agent-run debug files exist. No agent-run scoping for debug purposes.

## Key Files

### Breakout Containment

| File | Role |
|------|------|
| `packages/agent-pipeline-core/src/handlers/agent-stage-gate.ts` | Add `breakoutStage` to RunState, enforce in handleStart/handleComplete/handleResume |
| `packages/agent-pipeline-core/src/handlers/index.ts` | Re-export breakout scope utilities |
| `packages/agent-pipeline-core/src/index.ts` | Re-export breakout scope utilities |
| `packages/shared/src/agent/orchestrator/index.ts` | Set breakout scope at sdk_breakout yield, clear on resume |
| `packages/shared/src/agent/claude-agent.ts` | Lifecycle-managed breakout meta + system prompt + per-turn completion check |

### Debug Context Files

| File | Role |
|------|------|
| `packages/shared/src/sessions/debug-context-writer.ts` | **NEW** — `.txt` debug file writer with 100-file rotation |
| `packages/shared/src/agent/orchestrator/stage-runner.ts` | Write debug `.txt` after each orchestrator LLM call |
| `packages/shared/src/agent/claude-agent.ts` | Write debug `.txt` for conversation/SDK turns via `onContextWindowEntry` path |

---

## Phases

### Phase 1: Stage Gate Handler — Breakout Scope Field + Enforcement

**Adds `breakoutStage` to RunState and blocks stage transitions outside breakout scope.**

- [x] 1.1 Add `breakoutStage?: number` to `RunState` interface (`agent-stage-gate.ts:207-226`)
- [x] 1.2 In `handleStart()` (~line 450): add guard — if `state.breakoutStage !== undefined && stage !== state.breakoutStage`, return error via `makeResult(state, config, { allowed: false, reason: "Breakout scope active for stage {breakoutStage}. Only the orchestrator can advance past this stage. Call stage_gate(complete) to finish stage {breakoutStage}." })`
- [x] 1.3 In `handleComplete()` (~line 610): add guard — if `state.breakoutStage !== undefined && stage !== state.breakoutStage`, return error via `makeResult(state, config, { allowed: false, reason: "Cannot complete stage {stage} — breakout scope is limited to stage {breakoutStage}." })`
- [x] 1.4 In `handleResume()` (~line 1375-1390): when `state.breakoutStage !== undefined`, append to the `reason` field in the `makeResult` overrides: `"Stage resumed. Your work for this stage is now complete. STOP working — the orchestrator will advance to the next stage. Do NOT call stage_gate(start) for any subsequent stage."`. This uses the existing `reason?: string` field on `AgentStageGateResult` (F7 fix — no type extension needed).
- [x] 1.5 Export two standalone utility functions from `agent-stage-gate.ts` (for orchestrator-side use):
  - `setBreakoutScope(sessionPath: string, agentSlug: string, breakoutStage: number): void` — reads `{sessionPath}/data/agents/{agentSlug}/current-run-state.json`, sets `breakoutStage`, writes back. Uses Node `fs` directly (not `SessionToolContext.fs`).
  - `clearBreakoutScope(sessionPath: string, agentSlug: string): void` — reads, deletes `breakoutStage`, writes back.
  - Path computation: `join(sessionPath, 'data', 'agents', agentSlug, 'current-run-state.json')` — consistent with `getAgentDataDir()` but using `sessionPath` instead of `ctx.workspacePath + sessions + ctx.sessionId`.
- [x] 1.6 Re-export `setBreakoutScope` and `clearBreakoutScope` from `handlers/index.ts` and `src/index.ts`
- [x] 1.7 Validate: `pnpm run typecheck:all`

### Phase 2: Orchestrator — Set/Clear Breakout Scope

**Orchestrator sets breakout scope before yielding and clears it when resuming.**

- [x] 2.1 Import `setBreakoutScope`, `clearBreakoutScope` from `@craft-agent/agent-pipeline-core`
- [x] 2.2 In `executePipeline()` at the `orchestrator_sdk_breakout` yield point (~line 655-662): call `setBreakoutScope(this.sessionPath, agentConfig.slug, stage.id)` BEFORE `state.saveTo()` and `yield`
- [x] 2.3 In `resumeFromBreakout()` (~line 478-510): call `clearBreakoutScope(this.sessionPath, agentConfig.slug)` as the FIRST operation, BEFORE recording the `resume_from_breakout` event. Sequencing rationale (F9 confirmed): `clearBreakoutScope()` runs synchronously → then `executePipeline()` starts → LLM in new stage calls `start(stage=N)` → handler checks → `breakoutStage` is `undefined` → allowed.
- [x] 2.4 Validate: `pnpm run typecheck:all`

### Phase 3: Lifecycle-Managed Breakout State in ClaudeAgent

**F1/F2 fix: `_activeBreakoutMeta` and `_breakoutSystemPromptAppend` persist across breakout turns ONLY, cleared on specific lifecycle events.**

- [x] 3.1 In `executeSdkBreakoutStage()` (~line 5497-5498): **REMOVE** `this._activeBreakoutMeta = null` — keep meta alive across subsequent `chat()` calls during the breakout
- [x] 3.2 **Change `_breakoutSystemPromptAppend` from consume-once to conditional injection** (~line 1267-1278):
  - Remove `this._breakoutSystemPromptAppend = null` (line 1275)
  - Change the IIFE to: `if (this._activeBreakoutMeta && this._breakoutSystemPromptAppend) { return base + '\n\n' + this._breakoutSystemPromptAppend; }`
  - This ensures the breakout prompt is ONLY appended while `_activeBreakoutMeta` is set (F2 fix: normal chat turns after breakout completion don't get stale breakout instructions)
- [x] 3.3 Extract post-turn completion check from `executeSdkBreakoutStage()` (lines 5500-5530) into a new private method `checkAndResumeBreakout()`:
  - Reads `this._activeBreakoutMeta`, returns early if null
  - Calls `checkBreakoutStageCompletion()` with meta
  - If completed: clears `_activeBreakoutMeta` and `_breakoutSystemPromptAppend` BEFORE calling `resumeFromBreakoutOrchestrator()` (F1 fix: prevents stale meta from triggering infinite auto-resume)
  - If NOT completed: does nothing — lets user continue working in SDK
- [x] 3.4 In `chat()`, insert post-turn breakout completion check at **line ~2121** (after `for await` loop completes, after defensive pending text flush, BEFORE `yield { type: 'complete' }`):
  - Check `if (this._activeBreakoutMeta)` → call `checkAndResumeBreakout()` + `return`
  - F3 fix: precise insertion point after SDK `for await` loop completion
- [x] 3.5 **Defensive cleanup**: Clear `_activeBreakoutMeta` and `_breakoutSystemPromptAppend` at the start of:
  - `runOrchestrator()` — new orchestrator run invalidates any stale breakout
  - `resumeOrchestrator()` — same
  - `resumeFromBreakoutOrchestrator()` — the resume itself clears breakout scope
  This prevents F1: stale breakout meta from affecting non-breakout conversations.
- [x] 3.6 **Sequential breakout handling** (F8): No special code needed. When `resumeFromBreakoutOrchestrator()` calls `resumeFromBreakout()` which calls `executePipeline()`, if ANOTHER stage is `sdk_breakout`, the orchestrator yields again → sets new `_sdkBreakoutContext` + `_breakoutSystemPromptAppend`. The clear-then-set order (3.3 clears BEFORE calling resume → resume sets new breakout context) is correct. Document this in a code comment.
- [x] 3.7 **`executeSdkBreakoutStage()` first-turn check**: Simplify remaining code after `yield* this.chat()` — since `checkAndResumeBreakout()` now handles completion detection in `chat()` itself (3.4), reduce post-chat code to: (a) if `_activeBreakoutMeta` is null (3.4 triggered auto-resume), just return; (b) if still set, yield "not completed yet" hint.
- [x] 3.8 Validate: `pnpm run typecheck:all`

### Phase 4: System Prompt — Explicit Scope Boundary

**Defense-in-depth: instructs the LLM to stop after completing the breakout stage.**

- [x] 4.1 In `buildBreakoutSystemPromptAppend()` (~line 5430): add explicit `<SCOPE_BOUNDARY>` section after `</COMPLETION_INSTRUCTIONS>`:
  - CRITICAL: scoped to stage N ONLY
  - After `stage_gate(complete)`, STOP working — do NOT start next stage
  - Orchestrator controls stage progression — CANNOT advance past stage N
  - If user says "carry on"/"continue" after pause, call `stage_gate(resume)` then STOP
  - Stage gate handler will REJECT any attempt to start stage N+1
- [x] 4.2 Validate: `pnpm run typecheck:all`

### Phase 5: Debug Context Writer Module

**New module: human-readable `.txt` debug files with structured headers, max 100 files.**

- [x] 5.1 Create `packages/shared/src/sessions/debug-context-writer.ts`
- [x] 5.2 Define `DebugContextParams` interface with fields: `sessionPath`, `agentSlug`, `stage`, `stageName`, `step`, `turnIndex`, `model`, `durationMs`, `usage`, `systemPrompt`, `userMessage`, `response`. F4 fix: no `runId` field.
- [x] 5.3 Implement `writeDebugContextFile(params: DebugContextParams): void`:
  - File path: `{sessionPath}/data/agents/{agentSlug}/contexts/context_{YYYYMMDD-HHmmss-SSS}_{stage}_{step}.txt`
  - Structured header with metadata, then SYSTEM PROMPT / USER MESSAGE / RESPONSE sections
  - Wrapped in try-catch — never crashes caller
- [x] 5.4 Implement `rotateDebugContextFiles(contextsDir: string, maxFiles: number = 100): void` — list `.txt` files, sort by name, delete oldest when count exceeds `maxFiles`. F10: TOCTOU race accepted.
- [x] 5.5 Call `rotateDebugContextFiles()` within `writeDebugContextFile()` after each write
- [x] 5.6 Export `writeDebugContextFile` from the module
- [x] 5.7 Validate: `pnpm run typecheck:all`

### Phase 6: Wire Debug Context Writer into Orchestrator Pipeline

**Connect the writer to `StageRunner.appendContextWindowEntry()` for orchestrator LLM calls.**

- [x] 6.1 Add optional `agentSlug: string | null` field to `StageRunner` with setter `setAgentSlug(slug: string): void`
- [x] 6.2 In `AgentOrchestrator.executePipeline()` (~line 570): call `this.stageRunner.setAgentSlug(agentConfig.slug)` before the stage loop
- [x] 6.3 In `StageRunner.appendContextWindowEntry()` (~line 1395): after `writeContextWindowEntry()`, if `this.agentSlug` is set, call `writeDebugContextFile()` with mapped fields
- [x] 6.4 Validate: `pnpm run typecheck:all`

### Phase 7: Wire Debug Context Writer into SDK Conversation Turns

**Connect the writer to `ClaudeAgent.convertSDKMessage()` path for SDK/breakout turns.**

F5 fix: `onContextWindowEntry` fires inside `convertSDKMessage()` where `_activeBreakoutMeta` is directly accessible.

- [x] 7.1 Import `writeDebugContextFile` from `../sessions/debug-context-writer.ts` in `claude-agent.ts`
- [x] 7.2 In the `onContextWindowEntry` block (~line 2861-2894, inside `convertSDKMessage()`), after existing callback, add debug file writing when `_activeBreakoutMeta` is set
- [x] 7.3 Guard: Only writes debug files during agent breakout — normal chat produces no debug files (intentional)
- [x] 7.4 Validate: `pnpm run typecheck:all`

### Phase 8: Tests & Validation

- [x] 8.1 Unit tests for breakout scope enforcement in `handleStart()`: `start(stage=2)` when `breakoutStage=1` → rejected
- [x] 8.2 Unit tests for breakout scope enforcement in `handleComplete()`: `complete(stage=2)` when `breakoutStage=1` → rejected
- [x] 8.3 Unit tests for `handleResume()` with `breakoutStage` set: response `reason` includes stop instruction
- [x] 8.4 Unit tests for `setBreakoutScope`/`clearBreakoutScope`: verify field set/deleted in JSON
- [x] 8.5 Regression: normal pipeline (no breakout stages) — `breakoutStage` undefined, `handleStart` allows all stages
- [x] 8.6 Unit tests for `writeDebugContextFile()`: verify file in correct directory, header format, content
- [x] 8.7 Unit tests for `rotateDebugContextFiles()`: 101 files → oldest deleted, 100 remain
- [x] 8.8 Regression: `_activeBreakoutMeta` cleared after `resumeFromBreakoutOrchestrator()` completes (F1 verification)
- [x] 8.9 Final validation: `pnpm run typecheck:all` PASS, `pnpm run lint` PASS, `pnpm run test` PASS

---

## Risks & Considerations

| Risk | Mitigation |
|------|------------|
| **F1: `_activeBreakoutMeta` persists after breakout → infinite auto-resume** | Cleared in `checkAndResumeBreakout()` BEFORE calling `resumeFromBreakoutOrchestrator()`. Defensive cleanup at orchestrator entry points. |
| **F2: `_breakoutSystemPromptAppend` pollutes non-breakout chats** | Conditional injection only when `_activeBreakoutMeta` is set. Cleared alongside meta. |
| Breakout scope blocks legitimate stage transitions | `breakoutStage` only set by orchestrator at sdk_breakout yield. Normal pipeline has `undefined` — no blocking. |
| LLM ignores scope boundary instructions | Soft barrier (Phase 4) + hard barrier (Phase 1). Handler rejects the tool call even if LLM tries. |
| **F4: StageRunner missing runId** | Debug files use `{agentSlug}/contexts/` path — no runId needed. |
| **F5: sessions.ts callback has no agent metadata** | Not needed — fires inside `convertSDKMessage()` where `_activeBreakoutMeta` is accessible. |
| **F7: handleResume typed result lacks extra fields** | Uses existing `reason?: string` field — no type extension needed. |
| **F8: Sequential breakouts may collide** | Clear-then-set order: clear breakout meta → resume orchestrator → new breakout context set. |
| Debug `.txt` files consume disk | 100-file rotation cap. ~5MB max per agent per session. |
| Cross-package dependency for utilities | `packages/shared` already depends on `@craft-agent/agent-pipeline-core`. |
| `setBreakoutScope` uses raw `fs` not `ctx.fs` | Necessary — orchestrator lacks `SessionToolContext`. Matches `PipelineState.saveTo()` pattern. |
| **F6/F10: TOCTOU races** | F6: no risk (sequential). F10: accepted (max 1 extra file). |

## Testing Strategy

- [x] `pnpm run typecheck:all` — TypeScript strict mode
- [x] `pnpm run lint` — ESLint check (5 pre-existing errors, 0 from this change)
- [x] `pnpm run test` — 17 new tests pass, 56 existing stage gate tests pass, pre-existing UI test failures unchanged
- [ ] Manual: invoke dev-loop → Stage 1 SDK breakout → complete Stage 1 → "carry on" → verify `start(stage=2)` REJECTED by handler
- [ ] Manual: verify orchestrator auto-resumes from Stage 2 after breakout completion
- [ ] Manual: after breakout completes + pipeline finishes → send normal chat → verify NO stale breakout instructions, NO auto-resume
- [ ] Manual: verify debug `.txt` files in `sessions/{id}/data/agents/{slug}/contexts/`
- [ ] Manual: verify max 100 `.txt` files — oldest rotated out
