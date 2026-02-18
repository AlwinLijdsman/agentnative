# Plan: Generic Craft Agent E2E Test Framework

> Status markers: [ ] pending | [x] done | [~] in progress | [-] skipped
> Predecessor: Archived to plans/260218-agent-overhaul-e2e-framework-complete.md

## Goal

Build a reusable E2E test framework that validates the full Craft Agent pipeline for
any agent defined in the workspace. The framework uses real SDK calls (Claude Code Max
OAuth) to confirm that the agent lifecycle — stage gate sequencing, pause/resume,
session artifact writing, repair loops — works correctly end-to-end.

## Analysis

### What already exists

| Asset | What it covers | Gap |
|-------|---------------|-----|
| `e2e-stage-gate.test.ts` | Stage gate handler unit tests (mock, no SDK) | No live SDK call |
| `e2e-stage0-pause.test.ts` | Stage 0 pause assertions (mock handler) | No resume, no stages 1-N |
| `e2e-sdk-live.test.ts` | SDK smoke: hello + plugin resolve | No stage gate wired |
| `e2e-session-validation.test.ts` | Session artifact schema validation (mock) | Not run against live output |
| `scripts/test-stage0-e2e.ts` | Live dev script, Stage 0 only | One-off, not a test suite |
| `e2e-utils.ts` | Harness class + assertion helpers | Missing `resume()`, multi-stage helpers |

### The Craft Agent contract being tested

Every agent config must satisfy:
1. `agent_stage_gate(start, N)` → `agent_stage_gate(complete, N, data)` for each stage in order
2. Stages in `pauseAfterStages` → `pauseRequired: true` returned → `onAgentStagePause` fires
3. Pause lock: `start(N+1)` is blocked until resume action
4. Resume: sending a follow-up message causes `start(N+1)` to proceed
5. Repair units: repeated `complete(A)→complete(B,repair)` cycles are capped at `maxIterations`
6. Artifacts written: `agent-events.jsonl`, `current-run-state.json`, stage intermediate files

### Key Files

| File | Role | Changes |
|------|------|---------|
| `packages/session-tools-core/src/handlers/__tests__/e2e-utils.ts` | Harness | Add `resume()`, `runStage()`, `runFullPipeline()` |
| `packages/session-tools-core/src/handlers/__tests__/e2e-session-validators.ts` | Validators | Add `validateIntermediates()` |
| `packages/session-tools-core/src/handlers/__tests__/e2e-contract.test.ts` | New: contract tests | Full lifecycle, repair, pause-lock (mock) |
| `apps/electron/src/__tests__/e2e-sdk-live.test.ts` | Live SDK tests | Add stage gate + resume scenarios |
| `scripts/run-e2e-suite.ts` | New: orchestration runner | Runs all live scenarios, prints report |
| `.github/agents/e2e-test-runner.agent.md` | New: Copilot agent | E2E test execution agent |
| `package.json` (root) | npm scripts | Add `test:e2e:suite` |

---

## Phases

### Phase 1: Harness Extensions

- [x] Create `.github/agents/e2e-test-runner.agent.md` — Copilot agent for E2E test execution
- [ ] In `e2e-utils.ts`, extend `E2ESessionHarness`:
  - Add `resume(userMessage?: string)`: calls stage gate with `action: 'resume'`, clears pause lock, records event
  - Add `runStage(stageId, outputData)`: convenience wrapper for `start(N)` + `complete(N, data)` in one call
  - Add `runFullPipeline(stagesData: Record<number, unknown>)`: runs reset through all stages, pausing and auto-resuming at each pause point
- [ ] In `e2e-session-validators.ts`, add `validateIntermediates(ctx, agentSlug, stageIds)`:
  - Asserts each `runs/{runId}/evidence/intermediates/stage{N}_*.json` exists and is valid JSON
- [ ] Validate: `pnpm run typecheck:all`

### Phase 2: Generic Agent Contract Tests (unit-level, no SDK)

- [ ] Create `packages/session-tools-core/src/handlers/__tests__/e2e-contract.test.ts`:
  - Test: "full stage sequence produces complete event log and all intermediates"
    - `runFullPipeline` across all stages → assert `agent-events.jsonl` has start/complete per stage
    - Assert `current-run-state.json.status === 'completed'`
    - Assert `validateIntermediates` passes for each stage
  - Test: "pause lock blocks start(N+1) until resume"
    - Complete stage 0 → assert pause → attempt `start(1)` → assert `allowed: false`
    - Call `resume()` → attempt `start(1)` again → assert `allowed: true`
  - Test: "repair loop is capped at maxIterations"
    - Cycle `complete(A) → complete(B, repair)` beyond `maxIterations` → assert blocked
    - Assert repair event count in `agent-events.jsonl` ≤ `maxIterations`
  - Test: "reset clears run state and starts fresh run ID"
    - Complete stage 0 → `reset` → `start(0)` → assert new `runId` ≠ previous `runId`
  - Test: "staleRun detection fires when run is older than threshold"
    - Write a run state file with `lastEventAt` set far in the past → call `start(0)` → assert `staleRun: true`
- [ ] Validate: `npx tsx --test packages/session-tools-core/src/handlers/__tests__/e2e-contract.test.ts`
- [ ] Validate: `pnpm run typecheck:all`

### Phase 3: Live SDK Contract Tests (OAuth required)

- [ ] In `apps/electron/src/__tests__/e2e-sdk-live.test.ts`, add under `describeIfOAuth`:
  - Test: "agent calls stage_gate start + complete for stage 0"
    - Wire session MCP + register callbacks (pattern from `test-stage0-e2e.ts`)
    - Send a clear query → collect all tool_use events
    - Assert tool calls include `agent_stage_gate` with `action: 'start', stage: 0` AND `action: 'complete', stage: 0`
    - Assert `onAgentStagePause` fired
  - Test: "pause fires and pause-lock is respected in same SDK turn"
    - After pause fires, assert `isPauseLocked()` returns true
    - Assert no `start(1)` tool call appears in the same turn
  - Test: "second SDK call with resume prompt causes stage 1 to start"
    - After stage 0 pause: send follow-up "please proceed" via a second `query()` call
    - Assert second turn contains `agent_stage_gate` with `action: 'start', stage: 1`
  - Test: "session artifact files exist after stage 0 completes"
    - After stage 0 + pause: read temp workspace `agent-events.jsonl` and `current-run-state.json`
    - Assert both files exist and parse as valid JSON
    - Run `validateIntermediates` for stage 0
- [ ] Validate: `pnpm run typecheck:all`

### Phase 4: `scripts/run-e2e-suite.ts` Orchestration Script

- [ ] Create `scripts/run-e2e-suite.ts`:
  - Accepts `--agent <slug>` (default: first agent found in `agents/`) and `--auto-auth`
  - Reuses `ensureAuth()` + workspace setup pattern from `test-stage0-e2e.ts`
  - Runs each scenario below as an independent try/catch block, reports PASS/FAIL:
    1. `stage_gate_sequence`: send a clear prompt → assert `start(0)` + `complete(0)` tool calls fired in order
    2. `pause_fires`: assert `onAgentStagePause` callback fires after stage 0 complete
    3. `pause_lock`: after pause, assert no `start(1)` in same turn
    4. `artifact_written`: after pause, assert `agent-events.jsonl` + `current-run-state.json` exist on disk
    5. `resume`: second query with "proceed" → assert `start(1)` fires in second turn
  - Final table: scenario / PASS or FAIL / elapsed ms
  - Exit code 0 if all pass, 1 if any fail
- [ ] Add `"test:e2e:suite": "npx tsx scripts/run-e2e-suite.ts --auto-auth"` to root `package.json`
- [ ] Validate: `pnpm run typecheck:all`

### Phase 5: Test Registry + Documentation Update

- [ ] Update `test:e2e` npm script in `package.json` to glob both:
  - `apps/electron/src/__tests__/e2e-*.test.ts`
  - `packages/session-tools-core/src/handlers/__tests__/e2e-*.test.ts`
- [ ] Update `apps/electron/src/__tests__/README.md`:
  - Add "Contract Tests" section (Phase 2 tests, what each covers)
  - Add "Live SDK Contract Tests" section (Phase 3, OAuth required)
  - Add `test:e2e:suite` command documentation + target agent config requirements
- [ ] Update `CLAUDE.md` Quick Commands table with `test:e2e:suite`

### Phase 6: Integration Validation

- [ ] `npx tsx --test packages/session-tools-core/src/handlers/__tests__/e2e-*.test.ts` — all pass
- [ ] `npx tsx --test apps/electron/src/__tests__/e2e-*.test.ts` — all pass (live tests skip gracefully without OAuth)
- [ ] `npx tsx scripts/run-e2e-suite.ts --auto-auth` — all 5 scenarios PASS
- [ ] `pnpm run typecheck:all` — clean
- [ ] `pnpm run lint` — no new errors
- [ ] Archive this plan upon completion

## Risks & Considerations

| Risk | Mitigation |
|------|-----------|
| Resume across two `query()` calls may not carry session context | Investigate whether `sessionId` injected via MCP server is enough to re-hydrate state; fall back to single multi-turn call if needed |
| Repair loop unit test needs deterministic iteration counts | Use mock handler with real config — `maxIterations` is enforced in handler code, not by the model |
| `run-e2e-suite.ts` target agent must have `pauseAfterStages` configured | Script warns and skips pause scenarios if agent config lacks it |
| Claude Code Max subscription covers token costs | Still document estimated usage per run in README |

## Testing Strategy

1. **Phases 1-2**: Unit-level, real FS, mock handler. Zero API calls. `npx tsx --test`.
2. **Phase 3**: Real SDK calls, guarded by `CLAUDE_CODE_OAUTH_TOKEN`. Estimated ~$0.02-0.10 per run.
3. **Phase 4**: Live orchestration script, 5 scenarios, real SDK.
4. **Gates**: `pnpm run typecheck:all` + `pnpm run lint` after every phase.
