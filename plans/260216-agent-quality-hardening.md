# Plan: Agent Quality Hardening & Intent Clarification

> This file tracks implementation progress. Updated by slash commands and manual edits.
> Status markers: `[ ]` pending | `[x]` done | `[~]` in progress | `[-]` skipped

## Goal

Address the 5 critical and 3 medium gaps identified in the adversarial review comparing the ISA Deep Research agent against the personalmcptools agent-workflows system. Introduce stage output validation, user intent clarification, structured pause decisions (PROCEED/MODIFY/ABORT), and integration tests.

## Analysis

### Architecture Context

The ISA Deep Research agent runs as the **same Claude Opus 4.6** model in the conversation. AGENT.md instructions are delivered via the agent-skill bridge (`loadAllSkills()` in `packages/shared/src/skills/storage.ts`). The stage gate tool (`agent_stage_gate`) enforces stage sequencing and triggers pauses via `forceAbort(AbortReason.AgentStageGatePause)`. When a pause occurs, execution stops completely. The user's next message resumes the conversation, and the LLM reads previous context to continue.

### Key Findings

1. **No output validation** -- `handleComplete()` in `agent-stage-gate.ts` stores `args.data` directly without schema validation. Malformed data propagates silently.
2. **No user decision mechanism** -- Stage 0 pause is view-only. User cannot MODIFY the query plan, SKIP a stage, or ABORT the pipeline. The LLM just continues when the user sends any message.
3. **No intent clarification** -- AGENT.md says "infer the most likely intent." No mechanism exists for the agent to ask clarifying questions before committing to a query plan.
4. **60 tests total** -- 49 stage gate + 21 state tests cover infrastructure. Zero integration tests for the full pipeline, repair loops, or follow-up delta retrieval.
5. **Error recovery is LLM-dependent** -- AGENT.md has an error table but no structured escalation to the user.

### Design Decisions

- **Stage output schemas** live in `config.json` (not separate files) alongside existing `controlFlow`
- **User decisions** are processed via a new `resume` action on `agent_stage_gate` (not a new tool)
- **Intent clarification** is handled by AGENT.md instructions + pause mechanism (no new tool needed)
- **Integration tests** use the existing `node:test` framework with real temp directories (matching existing pattern in `test-utils.ts`)
- All changes are additive -- existing behavior preserved when schemas/decisions are not configured

## Key Files

| File | Role |
|------|------|
| `packages/session-tools-core/src/handlers/agent-stage-gate.ts` | Stage gate handler -- add schema validation, resume action, decision processing |
| `packages/session-tools-core/src/context.ts` | Callback interface -- extend for resume decisions |
| `packages/session-tools-core/src/handlers/__tests__/agent-stage-gate.test.ts` | Existing 49 tests -- extend with validation & decision tests |
| `packages/session-tools-core/src/handlers/__tests__/test-utils.ts` | Test utilities -- extend with schema fixtures |
| `agents/isa-deep-research/config.json` | ISA agent config -- add stage output schemas |
| `agents/isa-deep-research/AGENT.md` | ISA agent instructions -- add intent clarification protocol |
| `packages/session-mcp-server/src/index.ts` | MCP server -- update tool schema for resume action |
| `packages/session-tools-core/src/handlers/__tests__/agent-integration.test.ts` | NEW: Integration tests |
| `isa-kb-mcp-server/tests/test_tools.py` | Existing Python tests -- extend |

---

## Phases

### Phase 0: Stage Output Schema Validation (GAP 1 & 2)

Add JSON schema definitions per stage in `config.json` and validate in `handleComplete()`.

**config.json extension:**
```json
{
  "controlFlow": {
    "stages": [...],
    "stageOutputSchemas": {
      "0": {
        "required": ["query_plan"],
        "properties": {
          "query_plan": {
            "required": ["original_query", "sub_queries", "depth_mode"],
            "properties": {
              "original_query": { "type": "string" },
              "sub_queries": { "type": "array", "minItems": 1 },
              "depth_mode": { "type": "string", "enum": ["quick", "standard", "deep"] }
            }
          }
        }
      }
    }
  }
}
```

- [x] Add `StageOutputSchema` interface to `agent-stage-gate.ts` (simple JSON-like schema with `required`, `properties`, `type`, `enum`, `minItems`) (`packages/session-tools-core/src/handlers/agent-stage-gate.ts`)
- [x] Add `validateStageOutput(data, schema)` function -- lightweight recursive validator (no external deps, ~80 lines). Returns `{ valid: boolean, errors: string[] }` (`packages/session-tools-core/src/handlers/agent-stage-gate.ts`)
- [x] Integrate validation into `handleComplete()` -- after storing `stageOutputs` but before pause check. When validation fails: emit `stage_output_validation_warning` event, include `validationWarnings` in result. Do NOT block completion (warnings, not errors -- the LLM is unreliable and blocking would break the pipeline) (`packages/session-tools-core/src/handlers/agent-stage-gate.ts`)
- [x] Extend `StageGateConfig` interface to include optional `stageOutputSchemas` field (`packages/session-tools-core/src/handlers/agent-stage-gate.ts`)
- [x] Add stage output schemas to ISA agent config.json for stages 0-4 (`agents/isa-deep-research/config.json`)
- [x] Add 8+ tests for schema validation: valid data passes, missing required field warns, wrong type warns, enum violation warns, nested validation works, no schema = no validation, empty data = warn for required fields, minItems check (`packages/session-tools-core/src/handlers/__tests__/agent-stage-gate.test.ts`)
- [x] Validate: `cd packages/session-tools-core && npx tsx --test src/handlers/__tests__/*.test.ts`

### Phase 1: Structured Pause Decisions -- PROCEED/MODIFY/ABORT (GAP 4)

Add a `resume` action to `agent_stage_gate` that processes structured user decisions when resuming from a pause.

**New stage gate action:**
```typescript
agent_stage_gate({
  agentSlug: "isa-deep-research",
  action: "resume",
  data: {
    decision: "proceed" | "modify" | "abort",
    modifications: { ... },  // Only when decision = "modify"
    reason: "..."             // Optional: user's note
  }
})
```

- [x] Add `resume` to the `action` union type in `AgentStageGateArgs` (`packages/session-tools-core/src/handlers/agent-stage-gate.ts`)
- [x] Add `handleResume()` function implementing three decisions:
  - `proceed` -- Mark pause as resolved, return `allowed: true` with `nextStage` field
  - `modify` -- Store `modifications` in run state (new `pendingModifications` field on RunState), mark pause resolved, return `allowed: true` with modifications attached
  - `abort` -- Emit `agent_run_aborted` event, clear run state, return `allowed: true` with `aborted: true`
  (`packages/session-tools-core/src/handlers/agent-stage-gate.ts`)
- [x] Add `pendingModifications` and `pausedAtStage` fields to `RunState` interface (`packages/session-tools-core/src/handlers/agent-stage-gate.ts`)
- [x] In `handleComplete()`, when pause is triggered, set `pausedAtStage` on run state (`packages/session-tools-core/src/handlers/agent-stage-gate.ts`)
- [x] In `handleResume()`, validate that `pausedAtStage` matches (can't resume if not paused) (`packages/session-tools-core/src/handlers/agent-stage-gate.ts`)
- [x] Add `resume` action to the MCP tool schema enum in session-mcp-server (`packages/session-mcp-server/src/index.ts`)
- [x] Update system prompt to document the `resume` action and decision types (`packages/shared/src/prompts/system.ts`) -- find the `agent_stage_gate` tool description and add resume documentation
- [x] Add 6+ tests: resume-proceed advances, resume-modify stores modifications, resume-abort clears state, resume without pause fails, resume with wrong stage fails, modifications available in next stage start (`packages/session-tools-core/src/handlers/__tests__/agent-stage-gate.test.ts`)
- [x] Update test fixtures in `test-utils.ts` if needed (`packages/session-tools-core/src/handlers/__tests__/test-utils.ts`)
- [x] Validate: `cd packages/session-tools-core && npx tsx --test src/handlers/__tests__/*.test.ts`

### Phase 2: Intent Clarification Protocol (GAP 8)

Update AGENT.md to add an intent clarification step within Stage 0. When the query is ambiguous, the agent presents assumptions and alternatives in the Stage 0 output, which the user sees during the pause.

No code changes needed -- this is an AGENT.md instruction update that leverages the existing pause mechanism and the new resume-with-modifications from Phase 1.

- [x] Add "Intent Clarification" section to AGENT.md Stage 0 instructions. Between step 1 (clarity assessment) and step 2 (primary ISA identification), add protocol for when `clarity_score < 0.7` OR the query could target multiple distinct topics -- include `assumptions`, `alternative_interpretations`, and `recommended_action` in the Stage 0 output (`agents/isa-deep-research/AGENT.md`)
- [x] Update the Stage 0 output JSON example to include `assumptions`, `alternative_interpretations`, and `recommended_action` fields (`agents/isa-deep-research/AGENT.md`)
- [x] Update the Stage 0 output schema in config.json to include the new fields (optional, not required -- backward compatible) (`agents/isa-deep-research/config.json`)
- [x] Add Resume Protocol section to AGENT.md explaining how to handle user decisions after any stage pause:
  - "approved/proceed/looks good" → call resume with proceed
  - "abort/cancel/stop" → call resume with abort
  - Any modification request → call resume with modify + adjusted data
  - Read `pendingModifications` from the resume result and apply them
  (`agents/isa-deep-research/AGENT.md`)
- [x] Validate: Agent validate tool passes

### Phase 3: Enhanced Error Escalation (GAP 6)

Upgrade error handling so that when the agent encounters a non-recoverable error, it surfaces a structured error to the user via an automatic pause.

- [x] Add error-triggered pause logic to `handleComplete()`. When `args.data?.error` is present AND the error classification is in the `pauseOnErrors` list (default: `["auth", "config"]`), automatically trigger a pause regardless of `pauseAfterStages` config. Set `pauseRequired: true` and include `errorClassification` in the result. (`packages/session-tools-core/src/handlers/agent-stage-gate.ts`)
- [x] Add `pauseOnErrors` config option to `StageGateConfig.controlFlow` (default: empty array = disabled). This list of error categories triggers automatic pause for human decision. (`packages/session-tools-core/src/handlers/agent-stage-gate.ts`)
- [x] Emit `agent_error_escalation` real-time event when error pause triggers, including `suggestedActions` from the error classifier (`packages/session-tools-core/src/handlers/agent-stage-gate.ts`)
- [x] Update AGENT.md Error Recovery table to reference the automatic pause behavior (`agents/isa-deep-research/AGENT.md`)
- [x] Add `pauseOnErrors` to ISA agent config.json: `"pauseOnErrors": ["auth", "config"]` (`agents/isa-deep-research/config.json`)
- [x] Add 4+ tests: auth error triggers pause, config error triggers pause, transient error does NOT pause, error pause includes classification in result (`packages/session-tools-core/src/handlers/__tests__/agent-stage-gate.test.ts`)
- [x] Validate: `cd packages/session-tools-core && npx tsx --test src/handlers/__tests__/*.test.ts`

### Phase 4: Integration Tests (GAP 5)

Add end-to-end integration tests that exercise the full stage gate lifecycle including the new features.

- [x] Create `agent-integration.test.ts` with the following test suites:
  **Happy Path Pipeline** (3 tests):
  - Full 5-stage pipeline from start to completion
  - Pipeline with pause after Stage 0 and resume-proceed
  - Pipeline with all stages producing valid schema-conforming output

  **Repair Loop Lifecycle** (3 tests):
  - Verification failure triggers repair, re-synthesize, re-verify passes
  - Max repair iterations reached, end repair unit, continue with best attempt
  - Repair loop with schema validation on each iteration

  **Resume Decisions** (3 tests):
  - Resume with modify stores modifications, next stage receives them
  - Resume with abort clears state cleanly
  - Resume from error escalation pause

  **Follow-Up Delta** (2 tests):
  - Second run uses accumulated state from first run
  - State persists across runs (init → update → read)

  **Error Recovery** (2 tests):
  - Transient error → retryable, no pause
  - Auth error → auto-pause, user resumes with decision

  (`packages/session-tools-core/src/handlers/__tests__/agent-integration.test.ts`)
- [x] Add integration test helper to `test-utils.ts`: `runFullPipeline(ctx, slug, stageData[])` that executes start(0) → complete(0) → start(1) → ... → complete(N) in sequence (`packages/session-tools-core/src/handlers/__tests__/test-utils.ts`)
- [x] Ensure test config includes stageOutputSchemas and pauseOnErrors for realistic coverage (`packages/session-tools-core/src/handlers/__tests__/test-utils.ts`)
- [x] Validate: `cd packages/session-tools-core && npx tsx --test src/handlers/__tests__/*.test.ts`

### Phase 5: AGENT.md Guard Rails (GAP 1 hardening)

Add explicit verification checklists and output constraints to AGENT.md so the LLM has clearer instructions on what it MUST produce.

- [x] Add "Output Requirements Checklist" after each stage section in AGENT.md with specific minimum quality constraints per stage (`agents/isa-deep-research/AGENT.md`)
- [x] Add "Minimum Output Quality" section with hard constraints:
  - Stage 0: At least 3 sub-queries for standard mode, 8 for deep
  - Stage 1: At least 10 unique paragraphs retrieved
  - Stage 2: At least 5 citations in synthesis
  - Stage 3: All 4 verification axes executed
  - Stage 4: Verification summary table present
  (`agents/isa-deep-research/AGENT.md`)
- [x] Validate: Agent validate passes

### Phase 6: Python MCP Server Test Extensions (GAP 5 continued)

Extend the Python test suite for the ISA KB MCP server with additional coverage.

- [x] Add `test_entity_verify_scoring` -- verify entity grounding score calculation with mixed found/not-found entities (`isa-kb-mcp-server/tests/test_tools.py`)
- [x] Add `test_citation_verify_term_overlap` -- verify term overlap threshold (30%) with edge cases (`isa-kb-mcp-server/tests/test_tools.py`)
- [x] Add `test_relation_verify_implicit` -- verify same-ISA implicit relation detection (`isa-kb-mcp-server/tests/test_tools.py`)
- [x] Add `test_context_role_caps` -- verify role caps (supporting: 15, context: 5) are enforced (`isa-kb-mcp-server/tests/test_tools.py`)
- [-] Add `test_hop_retrieve_cycle_prevention` -- verify cycle detection in graph traversal (skipped: requires database connection; replaced with test_format_context_xml_structure which tests pure logic) (`isa-kb-mcp-server/tests/test_tools.py`)
- [x] Add `test_format_context_xml_structure` -- verify XML output has correct structure and attributes (`isa-kb-mcp-server/tests/test_tools.py`)
- [x] Validate: `cd isa-kb-mcp-server && .venv/Scripts/python.exe -m pytest tests/ -v`

### Phase 7: Final Validation & Documentation

- [x] Run full TypeScript type check: `pnpm run typecheck:all`
- [-] Run ESLint: `pnpm run lint` (pre-existing errors in apps/electron and packages/shared — none in files modified by this plan)
- [x] Run all TypeScript tests: 82/82 pass (55 unit + 14 state + 13 integration)
- [x] Run Python tests: 19/19 pass (`cd isa-kb-mcp-server && .venv/Scripts/python.exe -m pytest tests/ -v`)
- [x] Run agent validate: `mcp__session__agent_validate({ agentSlug: "isa-deep-research" })` — PASS
- [x] Verify app starts: `pnpm run electron:dev` — app initialized successfully, window created
- [x] Deployment verification: All 3 fixes confirmed in `main.cjs` after app restart (pausedAtStage: 6 matches, context re-injection: 2 matches, handleResume: 2 matches)

---

## Risks & Considerations

| Risk | Mitigation |
|------|------------|
| Schema validation too strict breaks existing runs | Validation emits warnings, never blocks completion |
| Resume action conflicts with existing pause flow | Resume only works when `pausedAtStage` is set; existing flow continues to work |
| Intent clarification adds latency | Only triggers when `clarity_score < 0.7`; user can immediately proceed |
| AGENT.md changes not followed by LLM | Guard rails are advisory; schema validation catches output issues |
| Integration tests slow due to real FS | Tests use temp dirs with cleanup; no network calls |
| Breaking change to config.json format | All new fields are optional; existing configs continue to work |
| `resume` action in MCP schema needs backward compat | Added to enum; old clients that don't send it are unaffected |

## Testing Strategy

- [x] `cd packages/session-tools-core && npx tsx --test src/handlers/__tests__/*.test.ts` -- 82/82 pass (55 unit + 14 state + 13 integration)
- [x] `pnpm run typecheck:all` -- TypeScript strict mode passes
- [-] `pnpm run lint` -- Pre-existing errors in apps/electron and packages/shared (none in modified files)
- [x] `cd isa-kb-mcp-server && .venv/Scripts/python.exe -m pytest tests/ -v` -- 19/19 pass (existing 14 + 5 new)
- [x] `mcp__session__agent_validate({ agentSlug: "isa-deep-research" })` -- Agent validation passes
- [ ] Manual: Invoke `/isa-deep-research` with an ambiguous query, verify clarification prompt appears in Stage 0 pause

---

## Phase 8: Pipeline Deployment Fix (2026-02-16)

**Root causes identified from sessions 260214-sharp-mesa, 260216-bold-fjord:**

### 8.1 Safe Mode Allowlist
- [x] Add `agent_stage_gate`, `agent_state`, `agent_validate` to `readOnlySessionTools` in `mode-manager.ts`
- These are operational pipeline tools, not configuration mutations — were incorrectly blocked in Explore mode

### 8.2 Rename `SubmitPlan` → `submit_plan`
- [x] Tool registration strings (2 files: session-scoped-tools.ts, session-mcp-server/index.ts)
- [x] String comparisons / switch cases (3 files: base-agent.ts, session-mcp-server/index.ts, sessions.ts)
- [x] TOOL_DESCRIPTIONS key (session-scoped-tools.ts)
- [x] Mode-manager allowlists (ALWAYS_ALLOWED_TOOLS + readOnlySessionTools)
- [x] Pre-tool-use allowlist (pre-tool-use.ts)
- [x] UI display name mapping (sessions.ts)
- [x] System prompt / LLM instructions (6 occurrences in system.ts)
- [x] Config generator emitted text (config-generator.ts)
- [x] ~26 comment/doc updates across 15 files
- TS symbols kept as-is: `handleSubmitPlan`, `SubmitPlanArgs`, `submitPlanSchema` (valid TS conventions)

### 8.3 Fix `loadWorkspaceSkills` → `loadAllSkills`
- [x] sessions.ts L585 — skill icon lookup during tool result processing
- [x] sessions.ts L5490 — `resolveHookMentions()` for skill mention resolution
- [x] Added `loadAllSkills` to top-level import, removed redundant dynamic import

### 8.4 Subagent Dispatch Guard
- [x] Enhanced SubagentStop logging with agent_type field
- [x] Added warning detection for missing agent_id (potential silent failure)

### 8.5 Validation
- [x] `pnpm run typecheck:all` — PASS
- [x] `pnpm run lint` — 5 pre-existing errors, 0 new
- [x] `pnpm run electron:build` — PASS
- [x] Build verification: `agent_stage_gate` in allowlist, `submit_plan` (29 refs), no `'SubmitPlan'`, `loadAllSkills` (7 refs)
- [ ] Manual: Restart Electron, verify ISA Deep Research in @ menu, run pipeline in Explore mode

## Summary of Gaps Addressed

| Gap | Severity | Phase | Approach |
|-----|----------|-------|----------|
| GAP 1: LLM-dependent orchestration | High | Phase 0 + 5 | Schema validation warnings + output checklists |
| GAP 2: No type-safe outputs | High | Phase 0 | JSON schema validation in stage gate |
| GAP 4: No human decisions beyond Stage 0 | High | Phase 1 | Resume action with PROCEED/MODIFY/ABORT |
| GAP 5: Inadequate test coverage | High | Phase 4 + 6 | Integration tests + Python test extensions |
| GAP 6: No error escalation | High | Phase 3 | Auto-pause on non-recoverable errors |
| GAP 8: No intent clarification | Medium | Phase 2 | AGENT.md protocol + resume-with-modify |

### Not Addressed (Architectural / Out of Scope)

| Gap | Reason |
|-----|--------|
| GAP 3: No multi-model routing | Architectural -- requires SDK-level changes to spawn sub-conversations with different models. The Craft Agent SDK runs a single model per conversation. Tracked as future enhancement. |
| GAP 7: No context summarization | Medium severity, requires LLM-powered summarization infrastructure. Can be addressed by leveraging the SDK's built-in context compression which already handles long conversations. |
| GAP 9: No CLI | Low severity -- Craft Agent is a desktop app; headless mode not required for current use case. |
| GAP 10: Verification vs adversarial review | Low severity -- ISA 4-axis verification is domain-appropriate. |
