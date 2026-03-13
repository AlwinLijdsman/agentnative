# Plan: Auto-Chain Orchestrator Resume → SDK Breakout Execution

> Fixes double-continue problem where user must send two messages after a paused stage to start SDK breakout execution (session 260306-crisp-aurora).
> Prior plan archived to: `plans/260306-breakout-scope-enforcement-v2.md`
>
> Status markers: `[ ]` pending | `[x]` done | `[~]` in progress | `[-]` skipped

---

## Goal

Eliminate the double-continue problem: after the user says "continue" from a paused stage, the orchestrator should seamlessly transition into the SDK breakout stage within the same turn — no second "continue" required.

## Analysis

### Symptom (session 260306-crisp-aurora)

1. User sends `[agent:dev-loop]` request → stage 0 runs and pauses (shows Proceed/Amend/Cancel)
2. User says "Ok please continue" → orchestrator resumes, hits stage 1 (`sdk_breakout`), yields "Send any message to start execution" → **turn ends**
3. User must send ANOTHER message → SDK breakout finally executes

Expected: step 2 should directly chain into SDK breakout execution without requiring step 3.

### Root Cause

The 3 orchestrator entry points (`runOrchestrator`, `resumeOrchestrator`, `resumeFromBreakoutOrchestrator`) all share the same pattern:

```
try {
  if (exitReason === 'sdk_breakout') {
    yield { text: "Send any message to start execution" }  // notification
  }
  yield { type: 'complete' }  // consumer returns, turn ENDS
} finally {
  writePipelineSummary(...)      // cleanup
  mcpLifecycle.close()           // cleanup
}
// UNREACHABLE — consumer called generator.return() on 'complete'
```

The consumer (sessions.ts) catches `{ type: 'complete' }` and immediately returns, terminating the generator. Code after the finally block is unreachable.

The `_sdkBreakoutContext` (set during `processOrchestratorEvents`) is only consumed on the NEXT `chat()` call — requiring another user message.

### Solution

When `exitReason === 'sdk_breakout'`, skip the `{ type: 'complete' }` yield and auto-chain into `executeSdkBreakoutStage()` after cleanup:

```
try {
  if (exitReason !== 'sdk_breakout') {
    yield { type: 'complete' }     // normal + paused paths still end the turn
  }
} finally {
  writePipelineSummary(...)        // always runs
  mcpLifecycle.close()             // always runs
}
// NOW REACHABLE (no generator.return() was called on sdk_breakout path)
if (exitReason === 'sdk_breakout' && this._sdkBreakoutContext) {
  yield* this.executeSdkBreakoutStage(userMessage)  // auto-chain!
}
```

### Safety Analysis

1. MCP lifecycle is fully closed in the finally block before SDK breakout starts (different execution context)
2. Pipeline summary is written before SDK breakout
3. Bridge state is preserved (neither paused nor sdk_breakout clears it)
4. `executeSdkBreakoutStage()` → `chat()` inner call:
   - `_sdkBreakoutContext` is null (consumed by `executeSdkBreakoutStage`)
   - `PipelineState.isPaused` = false (resolved by `resumed` + `breakout` events)
   - Bridge state has no `pausedAtStage` (only `breakoutStage`) → fallback detection skips
   - `detectOrchestratableAgent` won't match resume/breakout messages (no `[agent:xxx]`)
5. The inner `chat()` yields its own `{ type: 'complete' }` at the end of the SDK turn

## Key Files

| File | Changes |
|------|---------|
| `packages/shared/src/agent/claude-agent.ts` | All 3 orchestrator entry points: remove "Send any message" text, skip `complete` on sdk_breakout, add auto-chain after finally |

---

## Phases

### Phase 1: Auto-Chain in All 3 Orchestrator Entry Points

- [x] 1.1 `resumeOrchestrator` (line ~5198): Remove sdk_breakout text yield, skip `{ type: 'complete' }` when sdk_breakout, add `yield* this.executeSdkBreakoutStage(userMessage)` after finally block
- [x] 1.2 `runOrchestrator` (line ~4977): Same pattern
- [x] 1.3 `resumeFromBreakoutOrchestrator` (line ~4339): Same pattern
- [x] 1.4 Validate: `pnpm run typecheck:all` — PASS
- [x] 1.5 Validate: `pnpm run lint` — 5 pre-existing errors, 0 new

### Phase 2: Test Validation

- [x] 2.1 Run existing test suite: `pnpm run test` — 236/237 pass (1 pre-existing failure in agent-integration.test.ts)
- [x] 2.2 Verify existing breakout-scope tests still pass

---

## Risks & Considerations

1. **`runOrchestrator` edge case**: If an agent's stage 0 is `sdk_breakout`, the original userMessage (containing `[agent:xxx]`) would be passed to `executeSdkBreakoutStage()` → `chat()`, where `detectOrchestratableAgent()` could re-detect the agent. **Mitigation**: No current agent has stage 0 as sdk_breakout. Dev-loop stage 0 is `orchestrator_llm`. Theoretical edge case for future agents.

2. **Generator depth**: Auto-chain adds depth to the `yield*` delegation chain (resumeOrchestrator → executeSdkBreakoutStage → chat → SDK). JavaScript generators support this without issues.

3. **Sequential breakouts**: If the pipeline hits consecutive `sdk_breakout` stages (e.g., stage 1 completes → stage 4 is sdk_breakout), the existing `checkAndResumeBreakout` → `resumeFromBreakoutOrchestrator` → auto-chain path handles this correctly.

## Testing Strategy

- `pnpm run typecheck:all` — type safety
- `pnpm run lint` — no new errors
- `pnpm run test` — no regressions (236/237 pre-existing baseline)
