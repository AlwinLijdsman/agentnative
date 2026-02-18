# Plan: Stage Gate Diagnostics, Error Badge Fix & Comprehensive Logging

> This file tracks implementation progress. Updated by slash commands and manual edits.
> Status markers: `[ ]` pending | `[x]` done | `[~]` in progress | `[-]` skipped
>
> **Predecessor**: Archived to `plans/260217-stage-gate-pause-enforcement.md`

## Goal

Fix two observed bugs from the latest test run (`260217-snug-cedar`) and add comprehensive structured logging to make future debugging tractable without code changes.

**Observed symptoms:**
1. Red "Error" badge on "ISA Deep Research" tool row in UI, even though the stage-gate pause succeeded
2. `Unhandled rejection at: {} reason: {}` in main.log at pause time — error details lost due to Promise/object serialization failure

## Root Cause Analysis

### Error Badge (Root Cause 1)
The Claude SDK's `Skill` tool call fails with `Unknown skill: craft-workspace-agentnative:isa-deep-research` (`isError: true`). Claude then falls back to the `Task` tool, which succeeds and runs through stage 0 correctly. However, `getToolStatus()` in `turn-utils.ts` unconditionally maps `isError: true → 'error'` status. The failed Skill tool activity shows a red Error badge in the UI, even though the Task fallback succeeded.

### Empty Rejection (Root Cause 2)
`index.ts` logs `promise` and `reason` directly via `mainLog.error()`. The logger's JSON serializer calls `JSON.stringify()` on the data array. `Promise` objects serialize to `{}`, losing all context.

## Key Files

| File | Role | Changes |
|------|------|---------|
| `apps/electron/src/main/index.ts` | Unhandled rejection handler | Fix Promise/Error serialization |
| `apps/electron/src/main/sessions.ts` | Session manager | Add diagnostic logs at 12+ points |
| `packages/ui/src/components/chat/turn-utils.ts` | Activity status mapping | Suppress error for Skill→Task fallback |
| `apps/electron/src/renderer/event-processor/processor.ts` | Renderer event handling | Add debug-level event arrival logs |

---

## Phases

### Phase 1: Fix Unhandled Rejection Logging (Root Cause 2)

- [x] In `process.on('unhandledRejection', ...)` handler in `index.ts`: replace raw Promise/reason logging with structured Error serialization
- [x] Validate: `pnpm run typecheck:all`

### Phase 2: Stage Gate Diagnostic Logging (8 log points in `onAgentStagePause`)

- [x] Log entry at callback start: agent, stage, runId
- [x] Log after `pauseLocked = true`
- [x] Log after marking tool completed (include toolUseId)
- [x] Log after building resume message (include messageId, content length)
- [x] Log after `flushDelta()`
- [x] Log after emitting `text_complete` event (include turnId)
- [x] Log after emitting `agent_stage_gate_pause` event
- [x] Log after `forceAbort()` call
- [x] Wrap entire callback body in try/catch — log error and re-throw
- [x] Validate: `pnpm run typecheck:all`

### Phase 3: Chat Loop Exit Path Logging (7 exit paths)

- [x] Tag each exit path: complete, auth_retry, stop_drained, unexpected, abort, error, finally_safety
- [x] Validate: `pnpm run typecheck:all`

### Phase 4: Skill Resolution Logging

- [x] In `resolveToolDisplayMeta()` Skill branch: add debug logs for resolution hit/miss with available skills list
- [x] Validate: `pnpm run typecheck:all`

### Phase 5: Renderer Event Arrival Logging

- [x] `console.debug` at text_complete, agent_stage_gate_pause, and complete handlers
- [x] Validate: `pnpm run typecheck:all`

### Phase 6: Fix Skill Tool Error Badge (Root Cause 1)

- [x] In `getToolStatus()`: suppress error status for Skill tool (expected SDK fallback behavior)
- [x] Validate: `pnpm run typecheck:all`

### Phase 7: Validate & Build

- [x] `pnpm run typecheck:all` — PASS
- [x] `pnpm run lint` — 5 errors + 61 warnings (all pre-existing, no new issues)
- [x] `pnpm run electron:build` — PASS, verified new logs in built output
