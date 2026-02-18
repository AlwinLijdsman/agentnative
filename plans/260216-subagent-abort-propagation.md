# Plan: Subagent Abort Propagation Fix

> This file tracks implementation progress. Updated by slash commands and manual edits.
> Status markers: `[ ]` pending | `[x]` done | `[~]` in progress | `[-]` skipped

## Goal

Fix `forceAbort()` so that stage gate pauses immediately terminate running subagent Tasks. Currently, when the ISA Deep Research agent completes Stage 0 and triggers a pause, the subagent Task (running extended thinking inside the SDK's CLI subprocess) continues for 10+ minutes because `forceAbort()` only sends SIGTERM with no SIGKILL fallback. The user never sees the Stage 0 output and cannot provide intent feedback — which is the designated design.

## Analysis

### Root Cause

`ClaudeAgent.forceAbort()` at `claude-agent.ts` L2612 only calls `this.currentQueryAbortController.abort(reason)`, which sends **SIGTERM** to the CLI subprocess via the ProcessTransport's abort handler. There is **no SIGKILL fallback**. When the subprocess is blocked on an API call with extended thinking (10+ min), SIGTERM is ineffective because the process is waiting on a network socket.

The SDK provides `Query.close()` which does:
```javascript
// ProcessTransport.close() — from SDK source
close() {
  this.processStdin.end();           // Close stdin
  this.process.kill("SIGTERM");       // Send SIGTERM
  setTimeout(() => {
    if (!this.process.killed)
      this.process.kill("SIGKILL");   // Force kill after 5s
  }, 5000);
}
```

**`close()` is never called by `forceAbort()`.** The query reference is simply nulled.

### Gaps Identified (including adversarial review)

| # | Gap | Description | Impact |
|---|-----|-------------|--------|
| 1 | **No SIGKILL fallback** | `abort()` sends SIGTERM only. `close()` has SIGTERM + 5s SIGKILL. | Subagent hangs 10+ minutes |
| 2 | **No cleanup on abort** | `currentQuery` nulled without `close()`, orphans subprocess | Resource leak |
| 3 | **Immediate `close()` preempts AbortError** | `close()` calls `inputStream.done()` which ends the `for await` loop *normally* before `AbortError` fires. This breaks the `AbortError` catch path which does critical session cleanup (clear `lastAbortReason`, session ID management, emit "Interrupted" status). Affects ALL 6 callers of `forceAbort()`. | Silent session state corruption, lost interrupt status |
| 4 | **MCP response send failure** | `forceAbort()` is called from inside MCP tool handler (`agent_stage_gate`). Immediate `close()` kills transport before tool result is sent → `SdkMcpTransport.send()` throws `"Transport is closed"` → potential unhandled rejection | Process crash risk |
| 5 | **Duplicate `complete` events** | `onAgentStagePause` sends `complete` + sets `isProcessing=false`. After `close()`, the `for await` loop exits and the consumer also produces a `complete` event via `onProcessingStopped`. | Double `complete` sent to renderer |
| 6 | **`finally` block `close()` is no-op for abort** | Plan originally proposed `close()` in `finally`. But `forceAbort()` nulls `currentQuery` BEFORE the loop exits, so `this.currentQuery?.close()` in `finally` is always `null?.close()`. | False sense of safety |

### SDK Evidence

From `@anthropic-ai/claude-agent-sdk` (sdk.d.ts):
- `Query.stopTask(taskId: string): Promise<void>` — gracefully stops a running task
- `Query.close(): void` — forcefully ends the query with SIGTERM + 5s SIGKILL

From ProcessTransport abort handler (sdk.mjs):
```javascript
// abort handler — SIGTERM only, NO fallback
let z4 = () => { if (this.process && !this.process.killed) this.process.kill("SIGTERM"); };
this.abortController.signal.addEventListener("abort", this.abortHandler);
```

From Query.close() (sdk.mjs):
```javascript
// close() calls cleanup() which:
// 1. transport.close() → SIGTERM + 5s SIGKILL
// 2. inputStream.done() → ends the for-await iterator NORMALLY (no AbortError!)
// 3. Rejects all pending control/MCP responses with "Query closed before response received"
close() { this.cleanup() }
```

### Session Evidence (260216-apt-inlet)

- Stage 0 completes in ~40 seconds (events confirm `stage_gate_pause` fires correctly)
- `forceAbort(AgentStageGatePause)` is called
- SIGTERM is sent to CLI subprocess
- Subagent Task continues with extended thinking for 10+ minutes
- User never receives Stage 0 output for review

### Call Flow (current — broken)

```
handleComplete() → onAgentStagePause callback (synchronous, inside MCP tool handler)
  └─ sessions.ts L2960:
       managed.agent.forceAbort(AgentStageGatePause)
       managed.isProcessing = false
       sendEvent({ type: 'complete' })             ← 1st complete
       persistSession(managed)
  └─ tool handler returns result to SDK
  └─ SDK sends MCP response
  └─ for-await loop calls .next()
       └─ abort signal set → throws AbortError
       └─ catch: reason=AgentStageGatePause → no onProcessingStopped (not in whitelist)
       └─ yields { type: 'complete' }               ← 2nd complete (but ignored: return exits after 1st)
       
  PROBLEM: if SIGTERM doesn't kill the process, the for-await loop NEVER gets another
  .next() call, so AbortError never fires. Loop hangs forever.
```

### Design Decision — Delayed `close()` Pattern

**Critical insight**: `close()` cannot be called immediately because it:
1. Calls `inputStream.done()` which ends the `for await` loop normally, bypassing the `AbortError` catch path that does essential cleanup
2. Closes the MCP transport before the tool handler can send its result

**Solution: Delayed `close()` with 2-second timeout.**

```
forceAbort(reason):
  1. abort(reason)                    ← SIGTERM + sets abort signal
  2. Save query reference             ← before nulling
  3. null currentQuery                 ← drop reference (existing behavior)
  4. setTimeout(() => ref.close(), 2s) ← SIGKILL fallback if SIGTERM failed
```

**Why 2 seconds?**
- Gives SIGTERM time to work (normal case: process dies → AbortError fires → proper cleanup)
- Gives the MCP tool handler time to send its response (avoids transport-closed errors)
- If process is stuck (API call with extended thinking), `close()` fires at 2s, SIGKILL at 7s (2s delay + 5s internal)
- Worst case: 7 seconds total — far better than 10+ minutes

**Why this preserves ALL 6 callers:**
| Caller (sessions.ts) | AbortReason | SIGTERM works (normal) | SIGTERM fails (stuck) |
|---|---|---|---|
| `cancelProcessing` L4416 | UserStop | AbortError fires → "Interrupted" status ✓ | close() at 2s → SIGKILL at 7s |
| Stop button L3888 | UserStop | Same | Same |
| `sendMessage` redirect L4033 | Redirect | AbortError fires → session cleanup ✓ | close() at 2s → SIGKILL at 7s |
| `deleteSession` L3888 | UserStop | AbortError fires | close() at 2s (session being deleted anyway) |
| `onPlanSubmitted` L2834 | PlanSubmitted | AbortError fires → silent | close() at 2s |
| `onAgentStagePause` L2961 | AgentStageGatePause | AbortError fires → silent | close() at 2s → **THIS IS THE FIX** |

### `stopTask()` — Deferred

`Query.stopTask(taskId)` is the SDK's graceful subagent stop mechanism but is deferred because:
- `SubagentStartHookInput.agent_id` ≠ `stopTask(taskId)` task IDs (task IDs come from `task_notification` events which only fire on completion/stop/failure — not on start)
- No reliable way to track active task IDs without consuming `task_notification` messages in the `for await` loop, which fires asynchronously

## Key Files

| File | Role | Changes |
|------|------|---------|
| `packages/shared/src/agent/claude-agent.ts` | `forceAbort()` at L2612 | **Delayed `close()` + error handling** |
| `packages/shared/src/agent/claude-agent.ts` | `chat()` finally at L1816 | **Cleanup safety net for normal exits** |
| `apps/electron/src/main/sessions.ts` | `onAgentStagePause` at L2959 | **Add `stopRequested=true` before `forceAbort()`** |
| `apps/electron/src/main/sessions.ts` | AbortError catch at L4362 | **Add `AgentStageGatePause` to `onProcessingStopped` whitelist** |

---

## Phases

### Phase 1: Fix `forceAbort()` with Delayed `close()` (PRIMARY)

Modify `forceAbort()` to use a delayed `close()` that preserves the existing `AbortError` error handling path while adding a SIGKILL fallback for stuck processes.

- [x] Update `forceAbort()` in `claude-agent.ts` (L2612-2619):
  - Save `this.currentQuery` reference before nulling
  - After `abort()` + null: schedule `setTimeout(() => { try { queryRef.close(); } catch {} }, 2000)`
  - The try-catch around `close()` prevents errors if the query was already cleaned up
  - Update JSDoc to document delayed close behavior and SIGKILL fallback
  (`packages/shared/src/agent/claude-agent.ts`)

- [x] Add cleanup safety net in `chat()` `finally` block (L1816-1821):
  - Save `this.currentQuery` into local variable at start of `finally`
  - Null `this.currentQuery` first (existing behavior)
  - Then call `queryRef?.close()` wrapped in try-catch
  - This covers **normal completion** where `forceAbort()` was NOT called (no delayed timeout queued)
  - When `forceAbort()` WAS called: `this.currentQuery` is already null, so local var is null — no double close
  (`packages/shared/src/agent/claude-agent.ts`)

- [x] Validate: `pnpm run typecheck:all`

### Phase 2: Fix Consumer Exit Path in `sessions.ts`

Ensure the `for await` consumer in `sendMessage()` handles the stage-gate-pause abort correctly — no duplicate `complete` events, proper exit path.

- [x] In `onAgentStagePause` handler (L2959-2969), add `managed.stopRequested = true` BEFORE calling `forceAbort()`:
  - This ensures when the `for await` loop exits (after AbortError or generator end), the consumer takes the `stopRequested` path at L4337 ("Chat loop completed after stop request") instead of logging "Chat loop exited unexpectedly"
  - The `onProcessingStopped('interrupted')` call at L4339 will be guarded because `managed.isProcessing` is already `false` (set at L2962)
  - Removed duplicate `isProcessing = false`, `complete` event, and `persistSession` from onAgentStagePause — let `onProcessingStopped` handle centrally
  (`apps/electron/src/main/sessions.ts`)

- [x] In the `catch(sdkError)` AbortError handler at L4362, add `AgentStageGatePause` to the reason whitelist that calls `onProcessingStopped`:
  - Currently: `if (reason === AbortReason.UserStop || reason === AbortReason.Redirect || reason === undefined)`
  - Change to: `if (reason === AbortReason.UserStop || reason === AbortReason.Redirect || reason === AbortReason.AgentStageGatePause || reason === undefined)`
  - Guard: `onProcessingStopped` checks `managed.isProcessing` indirectly (idempotent state reset), and the `complete` event it sends is to the renderer which handles duplicates gracefully
  - BUT: `managed.isProcessing` is already `false` at this point. Check if `onProcessingStopped` guards on this. If it sets `isProcessing = false` unconditionally, it's harmless. If it skips when already false, we need the finally block to handle it.
  (`apps/electron/src/main/sessions.ts`)

- [-] Verify `onProcessingStopped` at L4455 is safe to call when `isProcessing` is already `false` (skipped: verified during implementation — it sets `isProcessing = false` unconditionally which is harmless, and the duplicate `complete` event was eliminated by removing it from `onAgentStagePause`)

- [x] Validate: `pnpm run typecheck:all`

### Phase 3: Add Debug Logging for Process Termination

Add logging to track whether the process is actually killed, for future debugging.

- [x] In `forceAbort()`, log the current abort reason and whether a query is active, at `debug` level:
  `debug('[ClaudeAgent] forceAbort: reason=%s, hasQuery=%s, hasAbortController=%s', reason, !!this.currentQuery, !!this.currentQueryAbortController)`
  (`packages/shared/src/agent/claude-agent.ts`)

- [x] Log the delayed close scheduling:
  `debug('[ClaudeAgent] forceAbort: scheduled delayed close() in 2s for SIGKILL fallback')`
  (`packages/shared/src/agent/claude-agent.ts`)

- [x] Validate: `pnpm run typecheck:all`

### Phase 4: Build and Verify

- [x] Run full build: `pnpm run electron:build`
- [x] Verify `forceAbort` in built `main.cjs`:
  - Contains `setTimeout` with `close()` call
  - Contains `try { queryRef.close() } catch` error handling
- [-] Run lint: `pnpm run lint` (5 pre-existing errors, 0 new — none in modified files)

### Phase 5: Update Plan

- [x] Mark all items complete in plan.md

---

## Risks & Considerations

| Risk | Mitigation |
|------|------------|
| **Delayed `close()` timer leaks if process dies early** | `ProcessTransport.close()` has internal `cleanupPerformed` guard — double call is no-op. `process.kill()` on already-killed process is harmless. |
| **2s delay too short for MCP response** | MCP tool result is a small JSON payload. SDK sends it within milliseconds after handler returns. 2s is generous. |
| **2s delay too long for user experience** | In normal case, SIGTERM kills process immediately and AbortError fires. The 2s timeout only activates if SIGTERM fails (stuck on API call). User sees Stage 0 output immediately via `onAgentStagePause` handler — the process cleanup is background. |
| **Double SIGTERM (abort sends one, close sends another)** | Harmless — `process.kill()` on already-killed process is a no-op |
| **Delayed `close()` fires after session deleted** | try-catch around `close()` catches any errors. `cleanupPerformed` guard in SDK prevents actual work. |
| **`onProcessingStopped` duplicate** | Addressed in Phase 2 — either guard at entry or consolidate `complete` emission. |
| **`finally` block close for normal exit** | `currentQuery` is non-null only for normal exits (no `forceAbort`). For abort exits, `forceAbort()` already nulled it and scheduled delayed close — `finally` is a no-op. No double close. |
| **`lastAbortReason` stale after delayed close exits normally** | If delayed `close()` causes normal loop exit (AbortError never fires), `lastAbortReason` stays set. It's overwritten on next `forceAbort()` call — not a functional issue but technically stale. For stage gate pause, `onAgentStagePause` has already handled all cleanup, so stale reason is harmless. |

## Testing Strategy

- [x] `pnpm run typecheck:all` — TypeScript strict mode
- [-] `pnpm run lint` — 5 pre-existing errors, 0 new (none in modified files)
- [x] `pnpm run electron:build` — Build succeeds
- [ ] Manual: Start ISA Deep Research → Stage 0 completes → pause fires → execution stops within 7 seconds (not 10+ minutes)
- [ ] Manual: Normal user stop (cancel button) still shows "Response interrupted" message
- [ ] Manual: Sending new message while processing still works (redirect abort path)
- [ ] Manual: Delete session while processing doesn't crash
