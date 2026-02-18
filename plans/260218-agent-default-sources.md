# Plan: Agent Default Sources

> **Branch**: `feature/agent-default-sources`
> **Status**: COMPLETED (2026-02-18)
> **Goal**: Harden the auto-enable agent sources pipeline so that when users @mention an agent in chat, its required MCP/API sources are resolved, enabled, connected, and reported to the user — with full diagnostic logging at every decision point and zero silent failure paths.

## Analysis

**Current state**: The auto-enable code at `apps/electron/src/main/sessions.ts:4206-4258` works for happy paths. The `parseMentions` regex in `packages/shared/src/mentions/index.ts` handles Windows paths via `[^\]]*` patterns. The guard `message.includes('[agent:')` is a fast-path optimization before parsing.

**Pipeline flow** (sequential, no race conditions):
```
guard → loadWorkspaceAgents → parseMentions → iterate agents → required sources
  → getSourcesBySlugs → isSourceUsable → add to enabledSourceSlugs → persist
  → buildServersFromSources → setSourceServers → chat()
```

**Key findings (2 researchers, 4 reviewers)**:
- Renderer already has `agentsAtom` + `sourcesAtom` — no new IPC needed for UI badges
- `CreateSessionOptions` type does not exist — dropped from proposal
- 6 silent failure paths where auto-enable fails with zero user visibility (CRITICAL)
- `parseMentions` has zero diagnostic logging — the exact failure point of the original bug (CRITICAL)

**Resolved conflicts**:

| Conflict | Resolution | Rationale |
|----------|-----------|-----------|
| IPC handler for renderer preview | Dropped | Renderer already has agent + source atoms |
| `CreateSessionOptions.agentSlug` | Dropped | Type doesn't exist in codebase |
| Block on ANY vs ALL source failure | Block on ALL fail, warn on partial | Partial value > no value; individual failures logged as warnings |
| Timeouts, circuit breakers, tool verification | Deferred to Phase 6 | Core debuggability delivers 80% of value; operational resilience adds complexity |

## Phases

### Phase 1: Diagnostic Logging for Auto-Enable Pipeline [x]

- [x] **1.1** Guard entry log
- [x] **1.2** loadWorkspaceAgents count + slugs
- [x] **1.3** parseMentions input/matched/zero-match
- [x] **1.4** Agent iteration diagnostics
- [x] **1.5** Enhanced source-not-found/not-usable warnings
- [x] **1.6** Final enabledSourceSlugs log
- [x] **1.7** Full error + stack trace in catch

### Phase 2: Extract `resolveAgentEnvironment()` Pure Function [x]

- [x] **2.1** Create `packages/shared/src/agents/environment.ts`
- [x] **2.2** Implement pure function
- [x] **2.3** Export from index
- [x] **2.4** Refactor sessions.ts
- [x] **2.5** Verify identical behavior

### Phase 3: UI Source Badges When Agent @Mentioned [x]

- [x] **3.1** Agent handling in mention-badge.tsx
- [x] **3.2** Computed source badges in FreeFormInput.tsx
- [x] **3.3** Status indicators (green/yellow/red)

### Phase 4: User-Visible System Messages [x]

- [x] **4.1** Success message listing enabled sources
- [x] **4.2** Warning messages per failed source
- [x] **4.3** Error when ALL required sources fail
- [x] **4.4** No message when no mentions (normal)
- [x] **4.5** Uses existing addMessage roles

### Phase 5: Test Coverage [x]

- [x] **5.1** 17 unit tests for resolveAgentEnvironment
- [x] **5.2** Failure path tests
- [x] **5.3** Integration test
- [x] **5.4** typecheck passes
- [x] **5.5** lint passes (no new errors)

### Phase 6: Deferred Improvements [ ]

- [ ] **6.1** MCP server startup timeout
- [ ] **6.2** Circuit breaker
- [ ] **6.3** Post-startup tool verification
- [ ] **6.4** Session restore re-validation
- [ ] **6.5** Configurable strictness
- [ ] **6.6** Test dependency injection

## Files Changed

| File | Change |
|------|--------|
| `packages/shared/src/agents/environment.ts` | NEW — pure `resolveAgentEnvironment()` function |
| `packages/shared/src/agents/__tests__/environment.test.ts` | NEW — 17 unit tests |
| `packages/shared/src/agents/index.ts` | Added export |
| `apps/electron/src/main/sessions.ts` | Refactored auto-enable to use pure function + diagnostic logging + system messages |
| `apps/electron/src/renderer/components/ui/mention-badge.tsx` | NEW `AgentSourceBadges` component |
| `apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx` | Agent source badge rendering |

## Validation

- typecheck: PASS
- Unit tests (environment.test.ts): 17/17 PASS
- E2E tests (e2e-auto-enable-sources.test.ts): 17/17 PASS
- Lint: 0 new errors
