# Plan: Fix SDK Breakout Auto-Resume — Deferred `complete` Event

> **Status: [x] COMPLETED** — All changes implemented, tested, and verified in a live pipeline run.
> Prior plan archived to: `plans/260313-auto-chain-orchestrator-resume.md`
>
> Status markers: `[ ]` pending | `[x]` done | `[~]` in progress | `[-]` skipped

---

## Problem Statement

The dev-loop agent pipeline stalls after SDK breakout stages (Stage 1, 4, 5). When the LLM calls
`stage_gate(complete)` during an SDK breakout, `checkAndResumeBreakout()` should fire and auto-chain
into the next orchestrator/breakout stage. Instead it **never fires** because `generator.return()`
propagation kills the generator chain before post-loop code executes.

### Symptom (session `260313-early-poplar`)

Pipeline stuck at Stage 1 (`plan`, `sdk_breakout` mode). After `stage_gate(complete)` is called:
- `breakoutStage: 1` persists in `current-run-state.json`
- Stage 2 (review) never starts
- User must manually intervene

### Root Cause

`chat()` has a for-await loop that yields every event from `convertSDKMessage()`, including
`{type: 'complete', usage}`. The delegation chain is:

```
sessions.ts consumer → for-await chatIterator
  └─ executeSdkBreakoutStage()     ← sets _activeBreakoutMeta
       └─ yield* chat()
            └─ for-await SDK messages → convertSDKMessage() → yield event
```

When `{type: 'complete'}` is yielded at line ~2083:
1. It propagates through `yield*` to sessions.ts
2. sessions.ts does `return` on `event.type === 'complete'`
3. `return` triggers `generator.return()` per ECMAScript spec
4. `generator.return()` propagates through the entire yield* chain
5. Post-loop code at line ~2125 (`checkAndResumeBreakout()`) is **never reached**
6. `_activeBreakoutMeta` stays set, `clearBreakoutScope()` never runs

### Solution

Single-point fix in `chat()`'s inner event loop: when `_activeBreakoutMeta` is set (i.e., inside
an SDK breakout), intercept `{type: 'complete'}` — capture `usage` data but **don't yield it**.
The for-await loop exits naturally, reaching `checkAndResumeBreakout()` which triggers auto-resume.

Deferred `usage` data is re-emitted as `{type: 'usage_update'}` so sessions.ts token tracking
isn't lost.

---

## All Changes Made (4 Files Modified/Created)

### File 1: `packages/core/src/types/message.ts` (line 410)

**What changed:** Widened the `usage_update` type in the `AgentEvent` union so it can carry full
`AgentEventUsage` data (not just `inputTokens` + `contextWindow`). This is needed because deferred
`complete` events carry `outputTokens`, `costUsd`, `cacheReadTokens`, etc.

**Before:**
```typescript
| { type: 'usage_update'; usage: Pick<AgentEventUsage, 'inputTokens' | 'contextWindow'> }
```

**After:**
```typescript
| { type: 'usage_update'; usage: Pick<AgentEventUsage, 'inputTokens'> & Partial<Omit<AgentEventUsage, 'inputTokens'>> }
```

**Why:** The original narrow type only allowed `inputTokens` and `contextWindow`. But when deferring
a `complete` event during breakout, the usage data includes `outputTokens`, `costUsd`,
`cacheReadTokens`, `cacheCreationTokens` — all of which need to flow through `usage_update` to
sessions.ts. The widened type makes `inputTokens` required and everything else optional, which is
backward-compatible with existing callers.

---

### File 2: `packages/shared/src/agent/claude-agent.ts` (3 changes)

#### Change 2a: Import `AgentEventUsage` type (line 95)

**Before:**
```typescript
import type { AgentEvent } from '@craft-agent/core/types';
```

**After:**
```typescript
import type { AgentEvent, AgentEventUsage } from '@craft-agent/core/types';
```

**Why:** The `deferredCompleteUsage` variable needs the `AgentEventUsage` type annotation.

#### Change 2b: Declare `deferredCompleteUsage` variable + defer complete in inner loop (line ~1960 and ~2088)

**Added variable declaration** at line 1955-1960 (before the for-await loop):
```typescript
// Deferred usage from a 'complete' event suppressed during SDK breakout.
// When _activeBreakoutMeta is set, we must NOT yield 'complete' (it would
// trigger generator.return() from the consumer, killing the chain before
// checkAndResumeBreakout() can execute). The usage is emitted post-loop
// via 'usage_update' so token tracking is preserved.
let deferredCompleteUsage: AgentEventUsage | undefined;
```

**Added deferral logic** in the inner event loop at line ~2088-2098:
```typescript
if (event.type === 'complete') {
  receivedComplete = true;
  // When inside an SDK breakout, defer the 'complete' yield.
  // Yielding 'complete' triggers generator.return() from the consumer
  // (sessions.ts), killing the yield* chain before post-loop code
  // (checkAndResumeBreakout) can execute. Instead, capture usage and
  // let the for-await loop exit naturally when the SDK has no more messages.
  if (this._activeBreakoutMeta) {
    deferredCompleteUsage = event.usage;
    continue;
  }
}
yield event;
```

**How it works:** When `event.type === 'complete'` arrives from the SDK during an active breakout:
1. `receivedComplete` is set to `true` (existing behavior)
2. The usage data is captured into `deferredCompleteUsage`
3. The loop `continue`s — skipping the `yield event` statement
4. The for-await loop exits naturally when the SDK stream ends
5. Post-loop code (including `checkAndResumeBreakout()`) is now reachable

When NOT in a breakout (`_activeBreakoutMeta` is falsy), behavior is completely unchanged —
the `complete` event is yielded normally.

#### Change 2c: Emit deferred usage before auto-resume check (line ~2140-2155)

**Added** in the post-loop breakout section (before the existing `checkAndResumeBreakout()` call):
```typescript
// Post-turn breakout completion check — runs on EVERY turn while
// breakout is active. If the stage was completed via stage_gate(complete),
// auto-resumes the orchestrator pipeline.
if (this._activeBreakoutMeta) {
  // Emit deferred usage via usage_update before auto-resume check.
  // Can't yield 'complete' here (would trigger generator.return()),
  // but usage_update lets sessions.ts track tokens without ending the turn.
  if (deferredCompleteUsage) {
    yield { type: 'usage_update', usage: deferredCompleteUsage };
  }
  yield* this.checkAndResumeBreakout();
  // Only reachable if auto-resume did NOT fire (stage not completed).
  // Auto-resume path: generator.return() from the eventual 'complete'
  // inside the orchestrator kills the chain before reaching here.
  // Yield 'complete' without usage (already tracked via usage_update above).
  yield { type: 'complete' };
  return;
}
```

**How it works:** After the for-await loop exits naturally:
1. If `deferredCompleteUsage` was captured, emit it as `usage_update` → sessions.ts accumulates
   the output tokens, cost, cache tokens
2. `checkAndResumeBreakout()` runs — if stage was completed via `stage_gate(complete)`, this
   triggers auto-resume into the next stage via `resumeFromBreakoutOrchestrator()`
3. If auto-resume fired, we never reach the final `yield { type: 'complete' }` because
   the orchestrator's auto-chain takes over
4. If auto-resume did NOT fire (stage not yet completed), yield a bare `complete` and return

---

### File 3: `apps/electron/src/main/sessions.ts` (line ~6420-6440)

**What changed:** Extended the `usage_update` handler in `processEvent()` to also accumulate
`outputTokens`, `totalTokens`, `costUsd`, `cacheReadTokens`, `cacheCreationTokens` when present.

**Before** (only handled `inputTokens` and `contextWindow`):
```typescript
case 'usage_update':
  if (event.usage) {
    // ... init block ...
    managed.tokenUsage.inputTokens = event.usage.inputTokens
    if (event.usage.contextWindow) {
      managed.tokenUsage.contextWindow = event.usage.contextWindow
    }
    // Send to renderer...
  }
  break
```

**After** (additional accumulation block added):
```typescript
case 'usage_update':
  if (event.usage) {
    // ... init block ...
    managed.tokenUsage.inputTokens = event.usage.inputTokens
    if (event.usage.contextWindow) {
      managed.tokenUsage.contextWindow = event.usage.contextWindow
    }
    // Accumulate output tokens and cost when present (deferred breakout usage).
    // During SDK breakout auto-resume, the 'complete' event is suppressed to
    // prevent generator.return() — full usage is emitted via usage_update instead.
    if (event.usage.outputTokens !== undefined) {
      managed.tokenUsage.outputTokens += event.usage.outputTokens
      managed.tokenUsage.totalTokens = managed.tokenUsage.inputTokens + managed.tokenUsage.outputTokens
    }
    if (event.usage.costUsd !== undefined) {
      managed.tokenUsage.costUsd += event.usage.costUsd
    }
    if (event.usage.cacheReadTokens !== undefined) {
      managed.tokenUsage.cacheReadTokens = event.usage.cacheReadTokens
    }
    if (event.usage.cacheCreationTokens !== undefined) {
      managed.tokenUsage.cacheCreationTokens = event.usage.cacheCreationTokens
    }
    // Send to renderer...
  }
  break
```

**Why:** Without this, the `outputTokens`, `costUsd`, and cache token counts from SDK breakout
turns would be lost. The `complete` event that normally carries this data is suppressed, so the
`usage_update` channel must carry it instead.

---

### File 4: `packages/shared/src/agent/__tests__/breakout-auto-resume.test.ts` (NEW FILE — 237 lines)

**What it tests:** 8 unit tests validating the deferred-complete mechanism using simplified async
generators that mirror the real delegation chain.

**Test structure:**

```
describe('Breakout auto-resume: deferred complete mechanism')
├── describe('generator.return() propagation (demonstrates the bug)')
│   ├── BROKEN: consumer return on complete kills post-loop code
│   └── BROKEN: yield* delegation chain is killed by generator.return()
├── describe('deferred complete (the fix)')
│   ├── post-loop code is reachable when complete is deferred
│   ├── deferred usage is emitted as usage_update with full data
│   ├── sessions.ts consumer return does NOT kill chain when complete is deferred
│   └── non-breakout path still yields complete normally
└── describe('usage_update type compatibility')
    ├── AgentEventUsage is assignable to usage_update usage field
    └── minimal usage (inputTokens only) still works with usage_update
```

**Key test helpers:**
- `brokenChatLoop()` — simulates the OLD behavior (yields `complete` unconditionally)
- `fixedChatLoop()` — simulates the FIXED behavior (defers `complete` when breakout active)
- `consumeWithReturn()` — simulates sessions.ts consumer that returns on `complete`
- `wrapWithYieldStar()` — simulates the `yield*` delegation chain

**What each test proves:**
1. **BROKEN tests** — Demonstrate the original bug: `consumeWithReturn(brokenChatLoop(...))` never
   sees `POST_LOOP_REACHED` because `generator.return()` kills the chain
2. **post-loop reachable** — `fixedChatLoop()` with breakout active: `complete` is not yielded,
   `POST_LOOP_REACHED` is yielded, proving post-loop code is reachable
3. **usage_update data** — Deferred usage is emitted with ALL fields (outputTokens, costUsd,
   cacheReadTokens, cacheCreationTokens, contextWindow)
4. **yield* chain survives** — When wrapped with `wrapWithYieldStar()`, both inner POST_LOOP and
   outer POST_DELEGATION markers appear (proving the delegation chain is not killed)
5. **non-breakout unchanged** — `fixedChatLoop(events, false)` yields `complete` normally, no
   `usage_update`, no post-loop breakout code — proving the fix is scoped
6. **Type compatibility** — Full `AgentEventUsage` and minimal `{inputTokens}` both satisfy the
   widened `usage_update` type

---

## Validation Results

### Typecheck
- [x] `pnpm run typecheck:all` — **PASS** (0 errors)

### Lint
- [x] `pnpm run lint` — 5 pre-existing errors, **0 new errors introduced**

### Unit Tests
- [x] `pnpm run test` — **8/8 new tests pass**, 66/66 pipeline tests pass
- Pre-existing failures (unrelated): `base-agent.test.ts` (import issues), `tool-matching.test.ts`
  (import issues), `skills/storage.test.ts` (`bun:` scheme error)

### Live Pipeline Verification (session `260313-fresh-lotus`)
- [x] Pipeline ran correctly: Stage 0 → 1 → 2 → 3 with auto-resume working
- [x] Stage 1 (sdk_breakout) auto-resumed into Stage 2 (review) — **the bug is fixed**
- [x] Stage 2 produced 8 adversarial review findings
- [x] Stage 3 refined the plan addressing 7/8 findings, rejecting 1
- [x] Pipeline paused at Stage 3 as configured (`pauseAfterStages: [0, 3]`)
- Event sequence: `stage_started(0) → stage_completed(0) → pause(0) → resumed(0) →
  stage_started(1) → breakout(1) → resume_from_breakout(2) → stage_started(2) →
  stage_completed(2) → stage_started(3) → stage_completed(3) → pause(3)`
- Model: `claude-opus-4-6`, 153 tool calls during Stage 1 breakout

---

## Risks & Considerations

1. **`runOrchestrator` edge case**: If an agent's stage 0 is `sdk_breakout`, the original userMessage
   (containing `[agent:xxx]`) would be passed to `executeSdkBreakoutStage()` → `chat()`, where
   `detectOrchestratableAgent()` could re-detect the agent. **Mitigation**: No current agent has
   stage 0 as sdk_breakout. Dev-loop stage 0 is `orchestrator_llm`.

2. **Generator depth**: Auto-chain adds depth to the `yield*` delegation chain. JavaScript generators
   support this without issues.

3. **Sequential breakouts**: Consecutive `sdk_breakout` stages (e.g., stage 1 → stage 4) are handled
   correctly by the existing `checkAndResumeBreakout` → `resumeFromBreakoutOrchestrator` path.

---

## File Change Summary (for applying to another branch)

| # | File | Action | Lines Changed |
|---|------|--------|---------------|
| 1 | `packages/core/src/types/message.ts` | Modified | Line 410: widened `usage_update` type |
| 2 | `packages/shared/src/agent/claude-agent.ts` | Modified | Line 95: added `AgentEventUsage` import |
| 3 | `packages/shared/src/agent/claude-agent.ts` | Modified | Lines 1955-1960: added `deferredCompleteUsage` variable |
| 4 | `packages/shared/src/agent/claude-agent.ts` | Modified | Lines 2088-2098: defer `complete` in inner loop |
| 5 | `packages/shared/src/agent/claude-agent.ts` | Modified | Lines 2140-2155: emit deferred usage + post-loop complete |
| 6 | `apps/electron/src/main/sessions.ts` | Modified | Lines 6420-6440: extended `usage_update` handler |
| 7 | `packages/shared/src/agent/__tests__/breakout-auto-resume.test.ts` | Created | 237 lines: 8 unit tests |

### Git Diff Snapshot

To generate the exact diff for transfer:
```bash
git diff HEAD -- packages/core/src/types/message.ts packages/shared/src/agent/claude-agent.ts apps/electron/src/main/sessions.ts
git diff HEAD -- packages/shared/src/agent/__tests__/breakout-auto-resume.test.ts
```

Or to create a patch file:
```bash
git diff HEAD > breakout-auto-resume-fix.patch
```
