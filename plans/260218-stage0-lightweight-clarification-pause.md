# Plan: Stage 0 Lightweight Clarification Pause

> This file tracks implementation progress. Updated by slash commands and manual edits.
> Status markers: `[ ]` pending | `[x]` done | `[~]` in progress | `[-]` skipped
>
> **Predecessor**: Archived to `plans/260218-natural-completion-stage-gate.md`

## Goal

Make Stage 0 pauses produce a brief intent-clarification question (2-5 sentences) instead of dumping the full query plan.

## Root Cause

Natural completion is now working, but instruction text is misaligned across multiple layers. The model is still told to "present stage results" and Stage 0 is still defined as a full plan presentation.

## Analysis

### Gaps to close

| ID | Severity | Gap | Location |
|----|----------|-----|----------|
| F1 | Critical | Tool-level pause rule says "present stage results" | `packages/shared/src/agent/session-scoped-tools.ts` |
| F2 | Warning | Stage-gate pause reason is generic and summary-oriented | `packages/session-tools-core/src/handlers/agent-stage-gate.ts` |
| F3 | Warning | ISA AGENT.md Stage 0 defines full plan presentation | `agents/isa-deep-research/AGENT.md` |
| F4 | Warning | Deep-research template still encodes old pause semantics | `agents/_templates/deep-research/AGENT.md.template` |
| F5 | Warning | Validator does not check new stage pause instruction fields | `packages/session-tools-core/src/handlers/agent-validate.ts` |

## Key Files

| File | Role | Planned changes |
|------|------|------------------|
| `packages/shared/src/agents/types.ts` | Shared type definitions | Add `pauseInstructions?: string` to `StageDefinition` |
| `packages/session-tools-core/src/handlers/agent-stage-gate.ts` | Stage-gate semantics | Add stage-level pause instructions support in `reason` generation |
| `packages/session-tools-core/src/handlers/agent-validate.ts` | Config validation | Validate `pauseInstructions` shape/type |
| `packages/shared/src/agent/session-scoped-tools.ts` | Tool instruction text | Change CRITICAL PAUSE RULE to follow tool result reason |
| `packages/shared/src/prompts/system.ts` | System prompt protocol | Clarify pause behavior follows tool `reason` instructions |
| `agents/isa-deep-research/config.json` | Agent control-flow config | Add Stage 0 `pauseInstructions` |
| `agents/isa-deep-research/AGENT.md` | Agent prompt | Separate internal Stage 0 planning from user-facing pause text |
| `agents/_templates/deep-research/AGENT.md.template` | Template | Mirror new pause semantics to prevent regressions |
| `packages/session-tools-core/src/handlers/__tests__/agent-stage-gate.test.ts` | Regression tests | Add unit test for custom stage pause instructions |

---

## Phases

### Phase 1: Stage-level pause instruction support

- [x] Add `pauseInstructions?: string` to `StageDefinition` in `packages/shared/src/agents/types.ts`
- [x] Add optional `pauseInstructions?: string` to stage type in `StageGateConfig` in `agent-stage-gate.ts`
- [x] In `handleComplete`, if stage has `pauseInstructions`, use it in pause `reason`; otherwise keep existing fallback
- [x] Preserve hard stop guardrails in reason: no tools, no same-turn resume/start, wait for user message
- [x] Validate: `pnpm run typecheck:all`

### Phase 2: Align tool + system pause rules (F1)

- [x] Update `agent_stage_gate` CRITICAL PAUSE RULE in `session-scoped-tools.ts` to follow tool result reason instead of "present your stage results"
- [x] Update Stage Gate protocol line in `system.ts` to follow pause instructions from tool result
- [x] Validate: `pnpm run typecheck:all`

### Phase 3: ISA agent behavior update (F3)

- [x] Add Stage 0 `pauseInstructions` in `agents/isa-deep-research/config.json` with concise clarification constraints
- [x] Update generic `pauseRequired` rule in `agents/isa-deep-research/AGENT.md` to follow tool result reason
- [x] Add explicit Stage 0 "internal vs user-facing" split: compute full plan internally, present only short clarification text to user

### Phase 4: Template and validator hardening (F4, F5)

- [x] Update `agents/_templates/deep-research/AGENT.md.template` pause semantics and Stage 0 pause presentation guidance
- [x] Extend `agent-validate.ts` stage validation to verify `pauseInstructions` is a string when present
- [x] Validate: `pnpm run typecheck:all`

### Phase 5: Tests + full validation

- [x] Add unit test in `agent-stage-gate.test.ts` to assert custom `pauseInstructions` appears in pause `reason`
- [x] Run targeted tests for stage gate handler (suite still has pre-existing failures; new test passes)
- [x] Run `pnpm run typecheck:all`
- [x] Run `pnpm run lint` (fails with pre-existing unrelated errors)
- [x] Run `pnpm run electron:build`
- [-] Manual check: Stage 0 now asks concise clarification instead of full plan dump (requires interactive app run)

## Risks & Considerations

- Highest risk: partial prompt alignment (changing one layer but not all) still yields verbose output
- Ensure fallback behavior remains sensible for agents without `pauseInstructions`
- Keep changes additive and backwards-compatible

## Testing Strategy

1. Unit test for stage-level pause instruction reason generation
2. Repository-wide typecheck gate
3. Lint/build validation and manual Stage 0 behavior check
