# Context Window Logging — Implementation Plan

> Log full LLM context windows (system prompt, user message, response, metadata) for every API call — both orchestrator AND regular SDK conversations.
> Branch: `feature/context-window-logging`
> Prior plan archived to: `plans/260301-craft-agent-technical-specification.md`

---

## Goal

**Part 1 (Orchestrator — COMPLETE):** Log the full LLM context window for every orchestrator API call. All entries appended to `context-windows.json` per session.

**Part 2 (Conversations — TODO):** Extend the same logging to capture every regular SDK conversation API call, with per-turn data (model, response text, token usage, stop reason). Purely additive — no existing behavior changes.

---

## Analysis

**Current state**: The orchestrator makes up to 3 LLM calls per pipeline run (Stage 0 at L275, Stage 1 at L500, Stage 3 at L807 in `stage-runner.ts`). The system prompt + user message + full response are **never persisted**  only truncated summaries appear in `agent-events.jsonl`.

**Proposed output path**:
```
sessions/{id}/data/context-windows.json
```

**File format**  single JSON file with a top-level array of entries:
```json
[
  {
    "stageId": 0,
    "stageName": "analyze_query",
    "repairIteration": null,
    "timestamp": "2026-03-01T14:32:01.123Z",
    "durationMs": 8423,
    "llm": {
      "model": "claude-opus-4-6",
      "effort": "max",
      "desiredMaxTokens": 16000
    },
    "input": {
      "systemPrompt": "...",
      "userMessage": "...",
      "estimatedInputTokens": 12340
    },
    "output": {
      "responseText": "...",
      "thinkingSummary": "...",
      "redactedThinkingBlocks": 0,
      "stopReason": "end_turn"
    },
    "usage": {
      "inputTokens": 11800,
      "outputTokens": 4200
    }
  }
]
```

---

## Key Design Decisions

1. **Single file per session**  `context-windows.json` in `data/` holds all entries. Read -> push -> write. One file to inspect, correlate across stages, and export.
2. **LLM metadata per entry**  `model`, `effort`, `desiredMaxTokens` captured at each call site. Each entry is self-describing  you can see exactly which model and settings produced each response.
3. **Repair iterations**  `repairIteration` is `null` for first pass, `1+` for repair loops. Repair entries append to the same array (e.g., Stage 3 repair = second entry with `stageId: 3, repairIteration: 1`).
4. **Timing**  `timestamp` (ISO string) + `durationMs` (wall-clock) captured around `llmClient.call()`.
5. **Token accounting**  Both `estimatedInputTokens` (heuristic, pre-call via `estimateTokens()` which computes `ceil(chars/4 * 1.1)`) and actual `usage.inputTokens` (API response) logged side-by-side.
6. **BAML bypass**  3 early-return paths (Stage 0 ~L231, Stage 1 ~L455, Stage 3 ~L745) skip `llmClient.call()` entirely. These will NOT be logged (BAML doesn't expose raw payloads). Each path gets a `// TODO: BAML path  context window not logged` marker.
7. **Resume safety**  `resume()` continues from `pausedStage + 1` (L313 in index.ts). `resumeFromBreakout()` continues from a specified `fromStage`. New entries append to the existing array  no overwrite risk.
8. **`.gitignore`**  `sessions/` directory is already gitignored.

---

## Key Files

| File | Role | Lines |
|------|------|-------|
| `packages/shared/src/agent/orchestrator/types.ts` | Add `ContextWindowEntry` + `ContextWindowLlmMeta` interfaces | 554 |
| `packages/shared/src/agent/orchestrator/stage-runner.ts` | Add `appendContextWindowEntry()` method, inject at 3 call sites | 1419 |
| `packages/shared/src/agent/orchestrator/context-budget.ts` | `estimateTokens()` -- already exported, needs import in stage-runner.ts | ~155 |

---

## Phase 1: Add `ContextWindowEntry` type to `types.ts`

- [x] Add new interfaces at end of file (after `FollowUpContext` which ends at L554 -- purely additive, no breaking changes):

```typescript
// ============================================================================
// CONTEXT WINDOW LOGGING -- Full LLM I/O capture for diagnostics
// ============================================================================

/** LLM configuration metadata for a context window log entry. */
export interface ContextWindowLlmMeta {
  /** Model used for this call (e.g., 'claude-opus-4-6'). */
  model: string;
  /** Reasoning effort level used (e.g., 'max', 'high'). */
  effort: string;
  /** Desired max output tokens requested for this call. */
  desiredMaxTokens: number;
}

/** A single logged context window -- one entry per LLM API call. */
export interface ContextWindowEntry {
  /** Pipeline stage ID (0-5). */
  stageId: number;
  /** Pipeline stage name (e.g., 'analyze_query', 'synthesize'). */
  stageName: string;
  /** Repair iteration: null for first pass, 1+ for repair loops. */
  repairIteration: number | null;
  /** ISO timestamp when the LLM call started. */
  timestamp: string;
  /** Wall-clock duration of the LLM call in milliseconds. */
  durationMs: number;
  /** LLM configuration used for this call. */
  llm: ContextWindowLlmMeta;
  /** Input sent to the LLM. */
  input: {
    /** Full system prompt text. */
    systemPrompt: string;
    /** Full user message / context text. */
    userMessage: string;
    /** Pre-call heuristic token estimate (via estimateTokens). */
    estimatedInputTokens: number;
  };
  /** Output received from the LLM. */
  output: {
    /** Full response text. */
    responseText: string;
    /** Adaptive thinking summary (null if no thinking occurred). */
    thinkingSummary: string | null;
    /** Number of redacted thinking blocks (Anthropic safety system). */
    redactedThinkingBlocks: number;
    /** API stop reason (e.g., 'end_turn', 'max_tokens'). */
    stopReason: string;
  };
  /** Actual API token usage from the response. */
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}
```

- [x] Both interfaces are exported (top-level `export interface`)
- [x] Run `pnpm run typecheck:all` -- must pass with zero new errors

---

## Phase 2: Add `appendContextWindowEntry()` method to `StageRunner`

- [x] Add `ContextWindowEntry` to the existing type import block at L20-33:
  ```typescript
  import type {
    AgentConfig,
    ContextWindowEntry,   // <- NEW
    FollowUpContext,
    ...
  } from './types.ts';
  ```
- [x] Add new import for `estimateTokens` from `./context-budget.ts` (currently NOT imported in stage-runner.ts; only imported by llm-client.ts). Place after `import { buildPriorContextHint } from './follow-up-context.ts';` at L38:
  ```typescript
  import { estimateTokens } from './context-budget.ts';
  ```
- [x] Add private helper method to `StageRunner` class. Insert before the class closing brace at L1166, after `getStageEffort()` at L1165:

```typescript
/**
 * Append a context window log entry to the session's context-windows.json.
 * Reads existing array (or initializes empty), pushes new entry, writes back.
 *
 * File path: sessions/{id}/data/context-windows.json
 *
 * Captures the full LLM I/O (system prompt, user message, response)
 * for every orchestrator API call -- enabling post-hoc debugging, prompt
 * iteration, and token usage analysis.
 */
private appendContextWindowEntry(entry: ContextWindowEntry): void {
  const dir = join(this.sessionPath, 'data');
  const filePath = join(dir, 'context-windows.json');
  mkdirSync(dir, { recursive: true });

  let entries: ContextWindowEntry[] = [];
  if (existsSync(filePath)) {
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        entries = parsed as ContextWindowEntry[];
      }
    } catch {
      // Corrupted file -- start fresh array (non-fatal)
      entries = [];
    }
  }
  entries.push(entry);
  writeFileSync(filePath, JSON.stringify(entries, null, 2), 'utf-8');
}
```

- [x] Verify all FS functions are already imported -- confirmed: `existsSync, mkdirSync, readFileSync, writeFileSync` from `'fs'` at L1279 and `join` from `'path'` at L1280
- [x] Run `pnpm run typecheck:all`

---

## Phase 3: Inject logging at all 3 LLM call sites

For each call site: capture `systemPrompt` + `userMessage` + `effort` + `desiredMaxTokens` before the call, wrap `llmClient.call()` with `Date.now()` timing, then call `appendContextWindowEntry()` after receiving the result.

### 3a. Stage 0 -- `runAnalyzeQuery()` at L275

**Variables in scope** (verified at L255-282):
- `systemPrompt` -- loaded at L258
- `enhancedMessage` -- the actual user message passed to LLM (L275: `userMessage: enhancedMessage`)
- `desiredTokens` -- set at L256
- `orchestratorConfig` -- set at L222
- `stage` -- method parameter

**Changes**:
- [x] Before `const result = await this.llmClient.call({` at L275: add `const callStart = Date.now();`
- [x] After `this.emitProgress(...)` at L283 (the `llm_complete` emission): add context window entry construction and `this.appendContextWindowEntry(entry)`

```typescript
// Context window logging -- capture full LLM I/O
this.appendContextWindowEntry({
  stageId: stage.id,
  stageName: 'analyze_query',
  repairIteration: null,
  timestamp: new Date(callStart).toISOString(),
  durationMs: Date.now() - callStart,
  llm: {
    model: orchestratorConfig?.model ?? 'claude-opus-4-6',
    effort: this.getStageEffort(orchestratorConfig),
    desiredMaxTokens: desiredTokens,
  },
  input: {
    systemPrompt,
    userMessage: enhancedMessage,
    estimatedInputTokens: estimateTokens(systemPrompt + enhancedMessage),
  },
  output: {
    responseText: result.text,
    thinkingSummary: result.thinkingSummary ?? null,
    redactedThinkingBlocks: result.redactedThinkingBlocks,
    stopReason: result.stopReason,
  },
  usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
});
```

- [x] Add `// TODO: BAML path -- context window not logged` comment at the BAML early-return (L231, the `return {` inside the `if (bamlResult)` block)

### 3b. Stage 1 -- `runWebsearchCalibration()` at L500

**Variables in scope** (verified at L481-509):
- `systemPrompt` -- loaded at L484
- `userContent` -- built at L487
- `webContext` -- built at L494-496
- Actual user message passed to LLM: `userContent + webContext` (L501: `userMessage: userContent + webContext`)
- `desiredTokens` -- set at L482
- `orchestratorConfig` -- set at L441
- `stage` -- method parameter

**Changes**:
- [x] Before `const result = await this.llmClient.call({` at L500: add `const callStart = Date.now();`
- [x] After `this.emitProgress(...)` at L508 (the `llm_complete` emission): add context window entry construction

```typescript
// Context window logging -- capture full LLM I/O
const fullUserMessage = userContent + webContext;
this.appendContextWindowEntry({
  stageId: stage.id,
  stageName: 'websearch_calibration',
  repairIteration: null,
  timestamp: new Date(callStart).toISOString(),
  durationMs: Date.now() - callStart,
  llm: {
    model: orchestratorConfig?.model ?? 'claude-opus-4-6',
    effort: this.getStageEffort(orchestratorConfig),
    desiredMaxTokens: desiredTokens,
  },
  input: {
    systemPrompt,
    userMessage: fullUserMessage,
    estimatedInputTokens: estimateTokens(systemPrompt + fullUserMessage),
  },
  output: {
    responseText: result.text,
    thinkingSummary: result.thinkingSummary ?? null,
    redactedThinkingBlocks: result.redactedThinkingBlocks,
    stopReason: result.stopReason,
  },
  usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
});
```

- [x] Add `// TODO: BAML path -- context window not logged` comment at the BAML early-return (L455, the `return {` inside the `if (bamlResult)` block)

### 3c. Stage 3 -- `runSynthesize()` at L807

**Variables in scope** (verified at L775-820):
- `systemPrompt` -- loaded at L780
- `userContent` -- built at L782-799
- Actual user message passed to LLM: `userContent` (L809: `userMessage: userContent`)
- `desiredTokens` -- set at L777
- `orchestratorConfig` -- set at L678
- `stage` -- method parameter
- `lastRepairEvent` -- extracted at L687-689 (for repair iteration)
- `streamTracker` -- wraps the LLM call for streaming progress (L806); `streamTracker.flush()` called at L816 post-call

**Repair iteration extraction** -- `lastRepairEvent` is already in scope at L687-689:
```typescript
const repairIterationValue = (lastRepairEvent?.data['repairIteration'] as number | undefined) ?? null;
```

**Changes**:
- [x] Before `const result = await this.llmClient.call({` at L807: add `const callStart = Date.now();`
- [x] After `streamTracker.flush()` at L816 and `this.emitProgress(...)` at L818 (the `llm_complete` emission): add context window entry

```typescript
// Context window logging -- capture full LLM I/O
const repairIterationValue = (lastRepairEvent?.data['repairIteration'] as number | undefined) ?? null;
this.appendContextWindowEntry({
  stageId: stage.id,
  stageName: 'synthesize',
  repairIteration: repairIterationValue,
  timestamp: new Date(callStart).toISOString(),
  durationMs: Date.now() - callStart,
  llm: {
    model: orchestratorConfig?.model ?? 'claude-opus-4-6',
    effort: this.getStageEffort(orchestratorConfig),
    desiredMaxTokens: desiredTokens,
  },
  input: {
    systemPrompt,
    userMessage: userContent,
    estimatedInputTokens: estimateTokens(systemPrompt + userContent),
  },
  output: {
    responseText: result.text,
    thinkingSummary: result.thinkingSummary ?? null,
    redactedThinkingBlocks: result.redactedThinkingBlocks,
    stopReason: result.stopReason,
  },
  usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
});
```

- [x] Add `// TODO: BAML path -- context window not logged` comment at the BAML early-return (L745, the `return {` inside the `if (bamlResult)` block)

- [x] Run `pnpm run typecheck:all` -- must pass
- [x] Run `pnpm run lint` -- must pass

---

## Phase 3d: Fix model logging accuracy

**Problem**: All 3 orchestrator call sites logged `orchestratorConfig?.model ?? 'claude-opus-4-6'` — the *configured* model. But `LlmCallResult.model` (populated from `response.model` in `llm-client.ts:175`) contains the actual model returned by the API. These can diverge with routing or fallback.

**Fix**: Replace configured model with `result.model` at all 3 call sites.

- [x] 3d.1 Stage 0 (`runAnalyzeQuery`, ~L298): `model: orchestratorConfig?.model ?? 'claude-opus-4-6'` → `model: result.model`
- [x] 3d.2 Stage 1 (`runWebsearchCalibration`, ~L552): same change
- [x] 3d.3 Stage 3 (`runSynthesize`, ~L891): same change
- [x] 3d.4 Run `pnpm run typecheck:all` — zero errors (type is already `string`)

---

## Phase 4: E2E Verification

- [x] Run a live orchestrator session (e.g., `npx tsx scripts/test-orchestrator-live-e2e.ts`)
- [x] Verify `sessions/{id}/data/context-windows.json` is created
- [x] Verify it contains a valid JSON array with one entry per LLM call made
- [x] Verify each entry has all required fields: `stageId`, `stageName`, `timestamp`, `durationMs`, `llm.model`, `llm.effort`, `llm.desiredMaxTokens`, `input.systemPrompt`, `input.userMessage`, `input.estimatedInputTokens`, `output.responseText`, `output.stopReason`, `usage.inputTokens`, `usage.outputTokens`
- [x] Verify `estimatedInputTokens` vs `usage.inputTokens` are in the same ballpark (within ~25%)
- [x] If a repair loop triggers: verify a second Stage 3 entry with `repairIteration: 1`
- [x] Verify session viewer discovers the new file

---

## Risks & Considerations

| Risk | Mitigation |
|------|------------|
| **Large file size** -- synthesis responses can be 50-100KB | Acceptable: max ~3-4 entries per session (3 stages + possible repair). File stays well under 1MB. |
| **Read-modify-write race** -- concurrent calls could clobber | Not a risk: orchestrator runs stages sequentially (for-loop in `executePipeline`). One `llmClient.call()` at a time. |
| **BAML paths unlogged** -- 3 early-return paths skip logging | Documented with TODO markers at L231, L455, L745. BAML adapter doesn't expose raw prompt/response. |
| **Corrupted JSON on crash** -- partial write during OS kill | `appendContextWindowEntry()` has try/catch on read: falls back to fresh array. |
| **Token estimate drift** -- `estimateTokens()` = `ceil(chars/4 * 1.1)` | Both estimate AND actual logged side-by-side. Enables accuracy analysis. |
| **Resume appends correctly** | `resume()` at L313 continues from `pausedStage + 1`. `resumeFromBreakout()` at L360 continues from `fromStage`. New entries push onto existing array. |
| **Stage 3 `streamTracker`** -- timing must include flush | `callStart` set before L807; `durationMs` computed after `streamTracker.flush()` (L816) -- captures full wall-clock including stream finalization. |

---

## Testing Strategy

1. `pnpm run typecheck:all` -- type safety for new interfaces + all call sites
2. `pnpm run lint` -- code style compliance
3. `pnpm run test` -- no regressions
4. Manual live E2E -- verify file creation, content structure, multi-entry array
5. Optional: repair loop E2E -- verify `repairIteration` field

---
---

# Part 2: Conversation Context Window Logging

> Extend orchestrator-only `context-windows.json` logging to also capture every regular SDK conversation API call (per-turn). Purely additive — no existing behavior changes.

---

## Conversation Logging — Analysis

### SDK Message Flow Per `query()` Call

A single `query()` call produces this message sequence (verified from SDK types and `convertSDKMessage()` code):

```
stream_event (message_start)   → turn N begins
stream_event (content_block_*)  → streaming text/tool_use
assistant                       → full message: content blocks + usage (all token fields)
stream_event (message_delta)    → stop_reason + output_tokens
user                            → tool results (SDK-constructed)
  ... repeat for next turn ...
result                          → once, cumulative: total_cost_usd, modelUsage, num_turns
```

**Key fact**: Multiple `assistant` messages fire per `query()` during tool-use loops. Each one is a separate API call with its own usage data. The `result` fires exactly once at the end.

### Data Availability Per-Turn (from `assistant` message)

| Field | Source | Available? |
|---|---|---|
| `input_tokens` | `message.message.usage.input_tokens` | Yes, per-turn |
| `cache_read_input_tokens` | `message.message.usage.cache_read_input_tokens` | Yes, per-turn |
| `cache_creation_input_tokens` | `message.message.usage.cache_creation_input_tokens` | Yes, per-turn |
| `output_tokens` | `message.message.usage.output_tokens` | Yes, per-turn (`BetaUsage.output_tokens: number`) |
| `stop_reason` | `message.message.stop_reason` | Yes, per-turn (`BetaMessage.stop_reason`) |
| `model` | `message.message.model` | Yes, per-turn (`BetaMessage.model: string`) |
| `response text` | `message.message.content` text blocks | Yes, per-turn |
| `parent_tool_use_id` | `message.parent_tool_use_id` | Yes (null=main, string=sidechain) |
| `turn_id` | From `message_start` stream event `message.id` | Yes, arrives BEFORE the `assistant` message |

### Data Available Only From `result` (Once Per query())

| Field | Source |
|---|---|
| `total_cost_usd` | `message.total_cost_usd` (cumulative) |
| `contextWindow` | `message.modelUsage[model].contextWindow` |
| `num_turns` | `message.num_turns` |
| `duration_ms` | `message.duration_ms` (total, not per-turn) |

### Architecture Decision

**Logging location**: Inside `convertSDKMessage()` in `ClaudeAgent`, on each `assistant` message. All data is available in one place. `isReplay` guard already filters replayed messages.

**File I/O**: Via callback `onContextWindowEntry` set by `SessionManager`, using a shared writer utility (extracted from StageRunner's private method to eliminate code duplication).

### Type Strategy: Discriminated Union

Refactor `ContextWindowEntry` into a discriminated union with `source` field:
- `OrchestratorContextWindowEntry` — existing type + `source: 'orchestrator'`
- `ConversationContextWindowEntry` — new type + `source: 'conversation'`

This keeps all existing orchestrator fields **required** (no optionals added) while adding conversation-specific fields that differ (no `stageId`, no `thinkingSummary`, different `input` shape).

---

## Conversation Logging — Key Files

| File | Role | Change Type |
|---|---|---|
| `packages/shared/src/agent/orchestrator/types.ts` | Refactor into discriminated union | Modify (additive) |
| `packages/shared/src/agent/orchestrator/stage-runner.ts` | Add `source: 'orchestrator'` to 3 call sites; replace private method with shared utility | Modify (minimal) |
| `packages/shared/src/sessions/context-window-writer.ts` | **New**: shared `appendContextWindowEntry()` utility | Create |
| `packages/shared/src/agent/claude-agent.ts` | Add `onContextWindowEntry` callback + per-turn entry emission | Modify (additive) |
| `apps/electron/src/main/sessions.ts` | Wire callback in `getOrCreateAgent()` | Modify (minimal) |

---

## Phase 5: Refactor types into discriminated union

- [x] 5.1 In `types.ts`: Add `ContextWindowEntryBase` interface with shared fields (`timestamp`, `durationMs`, `usage` with optional `cacheReadTokens` + `cacheCreationTokens`)
- [x] 5.2 Rename existing `ContextWindowEntry` to `OrchestratorContextWindowEntry`, extending `ContextWindowEntryBase`. Add `source: 'orchestrator'` literal field. Keep ALL existing fields required.
- [x] 5.3 Add `ConversationContextWindowEntry` extending `ContextWindowEntryBase`:
  ```typescript
  interface ConversationContextWindowEntry extends ContextWindowEntryBase {
    source: 'conversation';
    turnIndex: number;              // 0-based within this query() call
    turnId: string | null;          // message.id from message_start
    isSidechain: boolean;           // true = subagent/Task
    parentToolUseId: string | null;
    model: string;                  // from BetaMessage.model (actual, not config)
    input: {
      systemPromptAppend: string;   // only the append portion; Claude Code preset is internal
      userMessage: string;          // actual for turn 0, "[SDK-managed turn]" for subsequent
      inputTokens: number;          // actual API-reported input_tokens
    };
    output: {
      responseText: string;
      stopReason: string | null;
    };
    costUsd: number | null;         // only available from result (null on per-turn entries)
    contextWindow: number | null;   // only available from result (null on per-turn entries)
  }
  ```
- [x] 5.4 Add union type: `type ContextWindowEntry = OrchestratorContextWindowEntry | ConversationContextWindowEntry`
- [x] 5.5 Export `ConversationContextWindowEntry` (for ClaudeAgent to import)
- [x] 5.6 Run `pnpm run typecheck:all` — expect compile errors in `stage-runner.ts` (renamed type + missing `source`)

## Phase 6: Extract shared file I/O utility + fix orchestrator references

- [x] 6.1 Create `packages/shared/src/sessions/context-window-writer.ts` with:
  ```typescript
  export function appendContextWindowEntry(sessionPath: string, entry: ContextWindowEntry): void
  ```
  Extracted from `StageRunner`'s private method (read→push→write, try-catch, mkdir).
- [x] 6.2 In `stage-runner.ts`: replace private `appendContextWindowEntry()` method body with call to imported shared writer
- [x] 6.3 In `stage-runner.ts`: update 3 call sites to add `source: 'orchestrator'` to each entry object
- [x] 6.4 Update import in `stage-runner.ts`: `ContextWindowEntry` → `OrchestratorContextWindowEntry` (or keep using the union since it's assignable)
- [x] 6.5 Run `pnpm run typecheck:all` — zero errors

## Phase 7: Add context window logging to ClaudeAgent

- [x] 7.1 Import `ConversationContextWindowEntry` type in `claude-agent.ts`
- [x] 7.2 Add callback property:
  ```typescript
  public onContextWindowEntry: ((entry: ConversationContextWindowEntry) => void) | null = null
  ```
- [x] 7.3 Add private state fields tracking current `query()`:
  - `_cwSystemPromptAppend: string = ''` — captured at query() construction
  - `_cwUserMessage: string = ''` — captured at query() construction
  - `_cwTurnIndex: number = 0` — incremented each assistant message
- [x] 7.4 In `chat()` at `query()` construction (~L1823-1835): Capture `_cwSystemPromptAppend` (from `getSystemPrompt()` result), `_cwUserMessage` (from `buildTextPrompt()` or user's text), reset `_cwTurnIndex = 0`
- [x] 7.5 In `convertSDKMessage()` `case 'assistant'`: After `isReplay` guard, after `isSidechain` check, build and emit entry:
  - Extract `textContent` (already computed at this point)
  - Read `message.message.usage` for all token fields (input + output + cache)
  - Read `message.message.stop_reason` for stop reason
  - Read `message.message.model` for actual model used
  - Set `input.userMessage` to actual message for `turnIndex === 0`, `"[SDK-managed turn]"` for subsequent
  - Set `isSidechain = message.parent_tool_use_id !== null`
  - Set `durationMs = null` (per-turn timing not available from SDK)
  - Set `costUsd = null`, `contextWindow = null` (cumulative only, from result)
  - Increment `_cwTurnIndex`
- [x] 7.6 For sidechain messages (`isSidechain === true`): log with `systemPromptAppend: '[subagent — system prompt unknown]'`, `userMessage: '[subagent — message unknown]'`
- [x] 7.7 Wrap ALL context window logging code in try-catch with `console.warn` — never crash the conversation
- [x] 7.8 Run `pnpm run typecheck:all` — zero errors

## Phase 8: Wire callback in SessionManager

- [x] 8.1 Import `appendContextWindowEntry` from shared writer and `ConversationContextWindowEntry` from types
- [x] 8.2 In `getOrCreateAgent()`, after existing callback wiring (`onPlanSubmitted`), add:
  ```typescript
  agent.onContextWindowEntry = (entry) => {
    try {
      const sessionPath = getSessionStoragePath(managed.workspace.rootPath, managed.id)
      appendContextWindowEntry(sessionPath, entry)
    } catch (err) {
      console.warn('[SessionManager] Failed to write context window entry:', err)
    }
  }
  ```
- [x] 8.3 Run `pnpm run typecheck:all` — zero errors

## Phase 9: Validation

- [x] 9.1 Run `pnpm run typecheck:all` — zero new errors
- [x] 9.2 Run `pnpm run lint` — zero new warnings
- [ ] 9.3 Manual smoke test: send a single message → verify `context-windows.json` has conversation entry
- [ ] 9.4 Manual smoke test: tool-use conversation (e.g., "list files in src") → verify multiple entries with incrementing `turnIndex`
- [ ] 9.5 Verify orchestrator entries still have `source: 'orchestrator'` (run agent pipeline)

---

## Conversation Logging — Backward Compatibility

| Concern | Status | Evidence |
|---|---|---|
| Existing `ContextWindowEntry` consumers | Safe | No code reads `context-windows.json` (only append logic in `stage-runner.ts`). Verified by grep — zero read consumers. |
| Orchestrator logging behavior | Unchanged | Additive only: add `source: 'orchestrator'` field. All existing required fields stay required. |
| `session.jsonl` format | Untouched | No modifications to `SessionPersistenceQueue`, `writeSessionJsonl`, or `StoredMessage`. |
| `agent-events.jsonl` format | Untouched | No modifications to `appendEvent()` or `AgentEvent`. |
| `SessionManager.processEvent()` | Untouched | No new event types. Callback wired separately. |
| ClaudeAgent public API | Additive only | One new optional callback. If not wired, no logging occurs (null-safe). |
| File I/O contention | Safe | Both orchestrator and conversation write to same file via shared utility. Writes are synchronous, single Node.js event loop. |

## Conversation Logging — Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **SDK doesn't provide full system prompt** | Field named `systemPromptAppend` with doc comment. Claude Code preset is internal to SDK. |
| **User message unknown for tool-use loop turns** | `"[SDK-managed turn]"` sentinel. `turnIndex > 0` distinguishes. |
| **Large file size for long conversations** | Try-catch prevents crashes. Future: consider JSONL or pagination. |
| **`stop_reason` may be null during streaming** | `BetaMessage.stop_reason` is non-null after streaming completes. Type allows `null` as safety. |
| **Sidechain messages (Task subagents)** | Logged with `isSidechain: true` and sentinel values for unknown prompt/message. |
| **`durationMs` not measurable per-turn** | Set to `null`. Could estimate from message_start timing in future. |
| **Cost cumulative only** | `costUsd: null` on all entries. Per-turn cost derivable from token counts + model pricing. |

## Conversation Logging — Testing Strategy

1. `pnpm run typecheck:all` — at each phase
2. `pnpm run lint` — at each phase
3. Manual: single-message conversation → verify entry logged
4. Manual: tool-use conversation → verify multiple entries with incrementing `turnIndex`
5. Manual: orchestrator pipeline → verify entries have `source: 'orchestrator'`
