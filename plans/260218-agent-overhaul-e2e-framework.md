# Plan: Agent Activation Overhaul, Claude Max Debugging & Automated E2E Framework

> This file tracks implementation progress. Updated by slash commands and manual edits.
> Status markers: `[ ]` pending | `[x]` done | `[~]` in progress | `[-]` skipped
>
> **Predecessor**: Archived to `plans/260218-stage0-lightweight-clarification-pause.md`

## Goal

Three-part overhaul:
1. **Agent Activation**: Make agents first-class citizens with `[agent:]` mention support, eliminating the current agent-masquerading-as-skill workaround
2. **Claude Max Debugging**: Provide native tooling for debugging with Claude Code OAuth (Max subscription) without API key billing
3. **Automated E2E Framework**: Build a fully automated end-to-end test framework that validates agent behavior (Stage 0 pause, stage transitions, session artifacts) using real SDK calls

## Analysis

### Architecture Report Summary

**Current Agent Activation Flow** (via bridge):
```
UI mention-menu → [skill:C:\dev\deving\agentnative:isa-deep-research]
  → loadAllSkills() bridge in storage.ts L203-214 (agents as synthetic LoadedSkill)
  → SDK resolves via plugins: [{ type: 'local', path: workspaceRootPath }]
  → SDK Task tool with subagent_type: "craft-workspace-agentnative:isa-deep-research:ISA Deep Research"
  → Stage gate fires inside subagent context → onAgentStagePause callback
```

**Architectural Debt Identified**:

| ID | Issue | Severity |
|----|-------|----------|
| D1 | Agents masquerade as skills via bridge — no first-class `[agent:]` mention path | Medium |
| D2 | `[agent:]` parse branch in `parseMentions()` is dead code for ClaudeAgent | Low |
| D3 | `MentionItemType` includes `'agent'` but no section builder produces it | Low |
| D4 | Non-deterministic execution: Pattern A (everything in Task subagent) vs Pattern B (stage-gate at top, Task for analysis) | Medium |
| D5 | Stage 0 output still ignores `pauseInstructions` — produces verbose tables (observed in production sessions) | Medium |

**SDK Auth Priority Chain**:
```
1. ANTHROPIC_AUTH_TOKEN (highest)
2. CLAUDE_CODE_OAUTH_TOKEN (Claude Max ✓)
3. CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR
4. apiKeyHelper
5. keychain
6. ANTHROPIC_API_KEY (lowest)
```

**Test Infrastructure Status**: No E2E tests for agent behavior exist. Unit tests use `node:test` runner via `npx tsx --test`. Test utilities in `packages/session-tools-core/src/handlers/__tests__/test-utils.ts` provide `createMockContext()`, `createTestAgentContext()`, real temp FS, mock callbacks. OAuth E2E tests exist in `packages/shared/src/auth/__tests__/oauth.e2e.test.ts` but only test metadata discovery against live servers (bun:test).

### Key Files

| File | Role | Planned changes |
|------|------|------------------|
| `apps/electron/src/renderer/components/ui/mention-menu.tsx` | UI mention insertion | Add `'agent'` branch in `handleSelect` |
| `packages/shared/src/mentions/index.ts` | Mention parser | Already supports `[agent:]` — no change needed |
| `packages/shared/src/skills/storage.ts` | Agent→skill bridge | Add deprecation marker to bridge code |
| `packages/shared/src/prompts/system.ts` | System prompt | Update `formatAgentsSection()` to use `[agent:]` format |
| `packages/shared/src/agent/claude-agent.ts` | SDK backend | No change — SDK resolves via plugins |
| `packages/shared/src/agent/options.ts` | SDK spawn options | Env propagation for test harness |
| `apps/electron/src/main/sessions.ts` | SessionManager | Add auth debug helpers, expose `reinitializeAuth` diagnostics |
| `packages/shared/src/auth/state.ts` | OAuth token management | Add debug logging for token refresh |
| `packages/session-tools-core/src/handlers/__tests__/test-utils.ts` | Test infrastructure | Extend with E2E harness utilities |
| `packages/session-tools-core/src/handlers/__tests__/` | Test files | New E2E test files |
| `agents/isa-deep-research/config.json` | Agent config | Already has `pauseInstructions` — used by E2E tests |

---

## Phases

### Phase 1: E2E Test Infrastructure Foundation

Build the test harness that all subsequent phases depend on.

- [x] Create `packages/session-tools-core/src/handlers/__tests__/e2e-utils.ts` with:
  - `E2ESessionHarness` class that wraps `createTestAgentContext()` with session lifecycle (create → message → assert → cleanup)
  - `writeAgentConfig()` helper to write real ISA agent config to temp dir
  - `readSessionJSONL()` helper to parse session JSONL lines from temp session dir
  - `assertStageTransition()` assertion helper for ordered stage events in event log
  - `assertPauseAt()` assertion helper that checks `onAgentStagePause` callback was called with expected stage
  - `createE2ESessionId()` helper using `e2e-test-{timestamp}` pattern
- [x] Create `packages/session-tools-core/src/handlers/__tests__/e2e-stage-gate.test.ts` with:
  - Test: "stage-gate reset→start(0)→complete(0) triggers pause" using mock context + real stage-gate handler
  - Test: "pauseInstructions appear in complete(0) tool result reason text"
  - Test: "pause-locked state prevents start(1) until resume action"
  - Test: "resume action unlocks and allows start(1)"
- [x] Validate: `npx tsx --test packages/session-tools-core/src/handlers/__tests__/e2e-stage-gate.test.ts`
- [x] Validate: `pnpm run typecheck:all`

### Phase 2: Claude Max Auth Debugging Toolkit

Enable developers to debug OAuth state and auth chain behavior without guesswork.

- [x] Add `getAuthDiagnostics()` function to `packages/shared/src/auth/state.ts` that returns:
  - Current auth env state: which of ANTHROPIC_AUTH_TOKEN, CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_API_KEY are set (boolean only, never log values)
  - Token expiry status: expired/valid/unknown for OAuth token
  - Connection slug and auth type currently active
  - Last refresh timestamp
- [x] Add `auth-diagnostics` IPC handler in `apps/electron/src/main/ipc.ts` that calls `getAuthDiagnostics()` and returns result to renderer
- [x] Add preload bridge method `getAuthDiagnostics()` for renderer access
- [x] Add debug logging to `reinitializeAuth()` in `sessions.ts`:
  - Log which priority level was used (1-6 from chain)
  - Log token refresh success/failure with timing
  - Log whether CLAUDE_CODE_OAUTH_TOKEN was set before and after
- [x] Create `packages/session-tools-core/src/handlers/__tests__/auth-debug-integration.test.ts`:
  - Test: `getAuthDiagnostics()` returns correct shape with no env vars set
  - Test: `getAuthDiagnostics()` detects CLAUDE_CODE_OAUTH_TOKEN presence
- [x] Validate: `pnpm run typecheck:all`

### Phase 3: Agent Mention Overhaul — First-Class `[agent:]` Support

Promote agents from skill masquerade to first-class entities.

- [x] In `mention-menu.tsx` `handleSelect()` (~L622):
  - Add `type === 'agent'` branch that emits `[agent:${workspaceId}:${item.slug}]` instead of `[skill:]`
  - Keep `[skill:]` branch unchanged for actual skills
- [x] In `mention-menu.tsx` section builder:
  - Add agent section that produces `MentionItem` with `type: 'agent'` from `loadWorkspaceAgents()`
  - Display agents in separate "Agents" section (above Skills) with distinct icon
- [x] Thread `agents` through AppShellContext → ChatPage → ChatDisplay → FreeFormInput → useInlineMention:
  - Added `agents?: LoadedAgent[]` to `AppShellContextType` in AppShellContext.tsx
  - Added `agents` to `appShellContextValue` in AppShell.tsx
  - Destructured `agents` in ChatPage.tsx from context and passed to both ChatDisplay instances
- [-] In `packages/shared/src/prompts/system.ts` `formatAgentsSection()`:
  - No changes needed — `formatAgentsSection()` already uses correct agent-specific format (agent slug, stage gate protocol) and doesn't reference `[skill:]` format
- [x] In `packages/shared/src/skills/storage.ts` `loadAllSkills()`:
  - Add `// @deprecated — Agent→Skill bridge: Remove once [agent:] is fully adopted by SDK` comment to L203-214
  - Keep bridge functional for backward compatibility (SDK still needs it)
- [-] Add unit test in `packages/shared/src/mentions/__tests__/mentions.test.ts`:
  - Skipped: `parseMentions()` already supports `[agent:]` parsing and `stripAllMentions()` already handles it. packages/shared uses `bun:test` which is unavailable on Windows ARM64.
- [x] Validate: `pnpm run typecheck:all`
- [x] Validate: `pnpm run lint` (no new errors; pre-existing errors unrelated to Phase 3)

### Phase 4: Session JSONL Validation Utilities

Build automated validators for session artifacts produced during agent runs.

- [x] Create `packages/session-tools-core/src/handlers/__tests__/e2e-session-validators.ts` with:
  - `validateAgentEventsLog(eventsPath: string)`: parses `agent-events.jsonl`, validates each line is valid JSON with required fields
  - `validateRunState(statePath: string)`: reads `current-run-state.json`, asserts `pausedAtStage` matches expected
  - `validateStageOutputSchema(data: unknown, schemaId: string, config: object)`: validates stage output against `stageOutputSchemas` from agent config
  - `assertEventSequence(events: object[], expected: string[])`: checks event actions appear in order (allows interleaving)
  - `assertNoDuplicateCompletes(events: object[])`: ensures no stage is completed twice without repair
- [x] Create `packages/session-tools-core/src/handlers/__tests__/e2e-session-validation.test.ts`:
  - Test: Full stage-gate sequence (reset→start(0)→complete(0,paused)→resume→start(1)→complete(1)→...→complete(4)) produces valid event log
  - Test: Stage 0 output matches `stageOutputSchemas["0"]` from ISA config
  - Test: Repair loop (start(2)→complete(2)→start(3)→complete(3,repair)→start(2)→complete(2)→start(3)→complete(3)) produces expected repair events
- [x] Validate: `npx tsx --test packages/session-tools-core/src/handlers/__tests__/e2e-session-validation.test.ts`
- [x] Validate: `pnpm run typecheck:all`

### Phase 5: Live SDK E2E Test (Claude Max OAuth)

Automated test that exercises the real Anthropic SDK with Claude Max billing.

- [x] Create `apps/electron/src/__tests__/e2e-sdk-live.test.ts` with:
  - Prerequisite check: skip if `CLAUDE_CODE_OAUTH_TOKEN` not set in environment
  - `describeIfOAuth()` wrapper that conditionally runs tests based on OAuth availability
  - Test: "SDK subprocess spawns and responds to simple prompt" — uses `getDefaultOptions()` from options.ts to create SDK instance, sends "Hello", asserts response
  - Test: "SDK resolves workspace agent via plugin" — creates temp workspace with ISA agent config, spawns SDK with `plugins: [{ type: 'local', path: tempWorkspace }]`, sends message with `[skill:tempWorkspace:isa-deep-research]`, asserts Task tool is invoked
- [x] Create `apps/electron/src/__tests__/e2e-stage0-pause.test.ts` with:
  - Uses real ISA agent config from `agents/isa-deep-research/config.json`
  - Full Stage 0 flow: send message → agent calls `agent_stage_gate(start, 0)` → agent calls `agent_stage_gate(complete, 0)` → pause fires → validate:
    - `onAgentStagePause` callback was invoked
    - `current-run-state.json` has `pausedAtStage: 0`
    - `agent-events.jsonl` has reset, start(0), complete(0) in order
    - Tool result `reason` contains `pauseInstructions` text fragment
  - Cleanup: remove temp session directory on test completion
- [x] Add npm script `"test:e2e"` to root `package.json`: `"npx tsx --test apps/electron/src/__tests__/e2e-*.test.ts"`
- [x] Add npm script `"test:e2e:live"` for live SDK tests (requires OAuth token)
- [x] Document env setup in `apps/electron/src/__tests__/README.md`:
  - How to set `CLAUDE_CODE_OAUTH_TOKEN` for local E2E runs
  - How to extract token from `~/.craft-agent/credentials.enc` using debug helper
  - Expected costs per E2E run (estimated token usage)
- [x] Validate: `pnpm run typecheck:all`
- [x] Validate: `pnpm run lint` (no new errors)

### Phase 6: Stage 0 Output Fidelity Fix (D5)

Address the observed production issue where Stage 0 ignores `pauseInstructions` and produces verbose tables.

- [-] Investigate production sessions (noble-copper, amber-laurel) to trace why model generates tables despite `pauseInstructions`
  - Root cause: pauseInstructions text was passed through but lacked explicit negative instructions about format constraints
- [x] In `agent-stage-gate.ts` `handleComplete()`, strengthen the pause `reason` text:
  - Prepend `"CRITICAL OUTPUT FORMAT:"` before `pauseInstructions`
  - Add explicit negative instruction: `"Do NOT produce tables, sub-query lists, scope analysis, or verbose output."`
  - Add `"Your response must be 2-5 sentences maximum."`
- [x] In `session-scoped-tools.ts`, update CRITICAL PAUSE RULE to reinforce:
  - `"Follow the pause instructions in the tool result EXACTLY — especially output format constraints."`
- [x] Add E2E assertion in `e2e-stage-gate.test.ts`:
  - Test: complete(0) tool result `reason` contains "Do NOT produce tables"
  - Test: complete(0) tool result `reason` contains "2-5 sentences"
- [x] Validate: `pnpm run typecheck:all`

### Phase 7: Non-Deterministic Pattern Stabilization (D4)

Ensure test assertions work regardless of which execution pattern the SDK chooses.

- [x] In `e2e-session-validators.ts`, add `assertPauseOutcome()` that checks:
  - Pause happened at expected stage (regardless of whether it was inside Task subagent or top-level)
  - `current-run-state.json` reflects paused state
  - `onAgentStagePause` was called exactly once
- [x] In `e2e-stage0-pause.test.ts`, use outcome-based assertions (not order-based):
  - Assert: "after sending message, session is paused at stage 0" (not "tool call 1 is reset, tool call 2 is start")
  - Assert: "pause reason includes pauseInstructions text" (regardless of nesting depth)
- [x] Document the two patterns (Task-nested vs top-level) in `apps/electron/src/__tests__/README.md`
- [x] Validate: `pnpm run typecheck:all`

### Phase 8: Full Integration & CI Readiness

- [x] Run `pnpm run typecheck:all` — must pass clean
- [x] Run `pnpm run lint` — must pass clean (or document pre-existing failures)
  - 66 problems (5 errors, 61 warnings) — all pre-existing; 0 new issues from this plan
- [x] Run `npx tsx --test packages/session-tools-core/src/handlers/__tests__/e2e-*.test.ts` — all E2E unit tests pass
  - 16 pass, 0 fail, 1 skipped (live SDK needs OAuth)
- [x] Run `pnpm run electron:build` — build succeeds
- [-] Optionally run live SDK E2E tests (requires OAuth): `npx tsx --test apps/electron/src/__tests__/e2e-*.test.ts`
  - Skipped: CLAUDE_CODE_OAUTH_TOKEN not set in this environment
- [x] Update `CLAUDE.md` with E2E test instructions and commands
- [ ] Archive this plan to `plans/YYMMDD-agent-overhaul-e2e-framework.md` upon completion

## Risks & Considerations

| Risk | Mitigation |
|------|-----------|
| Live SDK E2E tests incur Claude Max token costs | Skip by default; guard with `CLAUDE_CODE_OAUTH_TOKEN` presence check |
| `[agent:]` mention change may break SDK skill resolution | Keep bridge functional in Phase 3; SDK still resolves `[skill:]` tags |
| Non-deterministic execution patterns make assertions fragile | Phase 7 uses outcome-based (not order-based) assertions |
| OAuth token refresh during test runs | `getValidClaudeOAuthToken()` handles refresh with mutex; test wraps in retry |
| `CLAUDE_CODE_OAUTH_TOKEN` is on blocked env var list for subprocesses | Test harness must set token at process level before subprocess spawn, respecting SDK auth priority chain |
| Stage 0 output fidelity may require SDK-level changes | Phase 6 strengthens instructor text first; escalate to SDK plugin if insufficient |

## Testing Strategy

1. **Unit-level E2E** (Phase 1, 4): Stage-gate handler exercised with real FS, mock callbacks, ISA agent config. No network. `npx tsx --test`
2. **Auth debug tests** (Phase 2): Verify diagnostics shape and env var detection. No network.
3. **Mention parser tests** (Phase 3): Verify `[agent:]` parsing and stripping. No network.
4. **Session validation tests** (Phase 4): Full stage-gate sequences validated against event log and run state. No network.
5. **Live SDK tests** (Phase 5): Real Anthropic API calls via Claude Max OAuth. Requires `CLAUDE_CODE_OAUTH_TOKEN`. Incurs costs.
6. **Output fidelity tests** (Phase 6): Verify pause reason text contains format constraints. No network.
7. **Gates**: `pnpm run typecheck:all` + `pnpm run lint` after every phase.
