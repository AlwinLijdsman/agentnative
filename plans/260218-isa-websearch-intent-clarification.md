# ISA Websearch Intent Clarification

> Archived from plan.md Section 11 on 2026-02-18

### Goal

Add an optional websearch intent clarification stage to the ISA Deep Research agent pipeline. After Stage 0's intent clarification pause, the user is asked if they want a web search to better clarify their intent. If accepted, a new Stage 1 ("websearch_calibration") runs web searches, refines the query plan, and pauses for user approval before proceeding to retrieval. If declined (or in `quick` depth mode), Stage 1 runs as a no-op.

**Scope**: 2 files changed (`config.json`, `AGENT.md`). Zero TypeScript code changes — the stage gate handler is fully data-driven.

### Analysis

**Current pipeline**: 5 stages (0-4): analyze_query → retrieve → synthesize → verify → output
**New pipeline**: 6 stages (0-5): analyze_query → websearch_calibration → retrieve → synthesize → verify → output

**Key design decisions**:

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Stage 1 skip mechanism | No-op with `{skipped: true}` output | Simpler than conditional routing; stage gate is data-driven |
| `quick` mode handling | Stage 1 always skipped (quick has `enableWebSearch: false`) | Consistent with existing depth mode semantics |
| `debug.skipWebSearch` | Also skips Stage 1 | Maintains debug mode parity |
| Pause presentation | Show WHAT CHANGED (diff), not just refined plan | Best practice from cascaded clarification patterns |
| Stage 1 output schema | Includes `skipped`, `skip_reason`, `web_sources`, `intent_changes` | Full observability for both paths |

**Risk assessment**: LOW — only ISA agent definition files change; stage gate handler is generic and data-driven; no hardcoded stage numbers anywhere in TypeScript.

---

### Phase 1: Update config.json — New stage, schemas, pause config, repair units

**Files**: `agents/isa-deep-research/config.json`

- [x] **1.1** Insert new stage at index 1 in `controlFlow.stages` array
- [x] **1.2** Renumber existing stages: retrieve→2, synthesize→3, verify→4, output→5
- [x] **1.3** Update `controlFlow.pauseAfterStages` from `[0]` to `[0, 1]`
- [x] **1.4** Update `controlFlow.repairUnits[0].stages` from `[2, 3]` to `[3, 4]`
- [x] **1.5** Append websearch question to Stage 0 pauseInstructions
- [x] **1.6** Add pauseInstructions for new Stage 1
- [x] **1.7** Add new Stage 1 output schema to stageOutputSchemas key "1"
- [x] **1.8** Renumber existing stageOutputSchemas keys: "1"→"2", "2"→"3", "3"→"4", "4"→"5"
- [x] **1.9** Verify complete config.json validity

---

### Phase 2: Update AGENT.md — Extract websearch calibration, renumber stages, update instructions

**Files**: `agents/isa-deep-research/AGENT.md`

- [x] **2.1** Remove "Second Calibration (Web Search)" from Stage 0; remove web_calibration_used/web_hints from output
- [x] **2.2** Update Stage 0 Pause Presentation to mention websearch question
- [x] **2.3** Add new "## Stage 1: Websearch Calibration" section with skip conditions, execution, output, requirements
- [x] **2.4** Renumber Stage 1: Retrieve → Stage 2: Retrieve
- [x] **2.5** Renumber Stage 2: Synthesize → Stage 3: Synthesize
- [x] **2.6** Renumber Stage 3: Verify → Stage 4: Verify
- [x] **2.7** Renumber Stage 4: Output → Stage 5: Output
- [x] **2.8** Update Repair Loop Protocol: stage 2/3 → stage 3/4
- [x] **2.9** Update Resume Protocol: add websearch decline row
- [x] **2.10** Update Debug Mode: add Stage 1 skip line
- [x] **2.11** Update Stage 0 output JSON: remove moved fields
- [x] **2.12** Update Follow-Up Protocol: add webSearchQueryCount note

---

### Phase 3: Testing

- [x] **3.1** Validate config.json structure
- [x] **3.2** Validate AGENT.md structure
- [x] **3.3** Websearch accepted path trace
- [x] **3.4** Websearch declined path trace
- [x] **3.5** Quick mode path trace
- [x] **3.6** Debug mode path trace
- [x] **3.7** Regression: test-stage0-e2e.ts compatibility
- [x] **3.8** typecheck:all passed
- [x] **3.9** lint passed

---

### Phase 4: Validation & Archival

- [x] **4.1** Final cross-file review
- [x] **4.2** No old stage numbers remain
- [x] **4.3** Archived to plans/260218-isa-websearch-intent-clarification.md
- [x] **4.4** Section 11 cleared
- [x] **4.5** Entry added to Section 10

---

### Implementation Notes

- Implemented by agent team `isa-websearch-impl` with 7 roles: implementer, unit-tester, phase-reviewer, feedback-evaluator, e2e-tester, bug-reviewer, fix-planner
- Planning done by agent team `isa-websearch-planning` with 7 roles: 2 researchers, 4 adversarial reviewers, 1 synthesizer
- E2E validation passed with 0 bugs — no bug report loop needed
- Full interaction logs: `20260218-184018_isa-websearch-intent_agentteamlog.jsonl` (planning), `20260218-190710_isa-websearch-impl_agentteamlog.jsonl` (implementation)
