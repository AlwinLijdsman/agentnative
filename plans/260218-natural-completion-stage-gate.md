# Plan: Natural Completion for Stage Gate Pause (with Risk Mitigations)

> This file tracks implementation progress. Updated by slash commands and manual edits.
> Status markers: `[ ]` pending | `[x]` done | `[~]` in progress | `[-]` skipped
>
> **Predecessor**: Archived to `plans/260218-stage-gate-diagnostics-logging.md`

## Goal

Remove `forceAbort` from the stage-gate pause flow so the LLM finishes its turn naturally and produces readable stage summaries, while closing known queue/UI/prompt gaps discovered in adversarial analysis.

## Root Cause

`onAgentStagePause` currently calls `forceAbort(AgentStageGatePause)`, terminating the SDK loop before natural assistant output can complete. This results in synthetic/raw pause messaging and brittle UX. The stage-gate `complete` response already returns `allowed: false` + `pauseRequired: true`, which should be sufficient to stop tool-calling in normal behavior.

## Analysis

### Existing safeguards to keep

| Guard | Location | Purpose |
|------|----------|---------|
| `isPauseLocked` | `agent-stage-gate.ts` | Blocks same-turn `resume`/`start`/`complete` |
| `allowed: false` on pause | `handleComplete` in `agent-stage-gate.ts` | Instructs model to stop tool calls |
| `pausedAtStage` persisted | `writeRunState` path | Ensures restart-safe pause state |
| Queue hold while paused | `onProcessingStopped` in `sessions.ts` | Prevents auto-continue without user decision |
| Resume-context injection | `getPausedAgentResumeContext` in `sessions.ts` | Guides the next turn to `resume` then `start` |

### Risk register and planned mitigations

| ID | Severity | Risk | Mitigation |
|----|----------|------|------------|
| R1 | HIGH | Early user message during pause-summary stream can be queued then held indefinitely | Add pause-aware queue path in `sendMessage` and explicit drain trigger after resume |
| R2 | MEDIUM | No visible pause CTA if model output is short/empty; `pausedAgent` is not rendered in UI | Add pause banner in chat UI reading `session.pausedAgent` |
| R3 | LOW | AGENT.md pause wording conflicts with natural completion behavior | Update prompt wording to summary-then-wait semantics |
| R4 | LOW | Potential duplicate final text from subagent/parent completion | Validate with event logs and manual regression |
| R5 | LOW | `pausedAgent` can remain stale if flow ends without new stage start | Clear `pausedAgent` in renderer `handleComplete` |

## Key Files

| File | Role | Planned changes |
|------|------|------------------|
| `apps/electron/src/main/sessions.ts` | Pause callback, queueing, completion handling | Remove forceAbort/synthetic pause text flow, add pause-aware queue behavior |
| `packages/session-tools-core/src/handlers/agent-stage-gate.ts` | Stage-gate result semantics | Strengthen `reason` wording for natural summary + wait |
| `agents/isa-deep-research/AGENT.md` | Agent operating instructions | Align pause protocol with natural completion |
| `apps/electron/src/renderer/event-processor/handlers/session.ts` | Renderer completion state | Clear stale `pausedAgent` on completion |
| `packages/ui/src/components/chat/ChatDisplay.tsx` | Chat UX | Show visible pause indicator and guidance |

---

## Phases

### Phase 1: Remove forceAbort Pause Path

- [x] In `sessions.ts` `onAgentStagePause`, removed `forceAbort(AgentStageGatePause)` logic and associated stopRequested coupling
- [x] Removed synthetic pause message construction and synthetic `text_complete` emission
- [x] Kept pause lock + `agent_stage_gate_pause` event + tool status updates + error handling logs
- [x] Added explicit info log: natural-completion mode active
- [x] Validate: `pnpm run typecheck:all` (PASS)

### Phase 2: Strengthen Stage-Gate Pause Reasoning

- [x] Updated `handleComplete` pause `reason` to explicitly instruct: summarize results, stop tool calls, wait for next user message
- [x] Preserved strict prohibition against same-turn `resume`/`start`
- [x] Validate: `pnpm run typecheck:all` (PASS)

### Phase 3: Fix Queue-Hold Loop (R1)

- [x] In `sendMessage`, added pause-aware branch: if `isProcessing && pauseLocked`, queue message without Redirect abort
- [x] Queue messages created during pause continue to emit clear user-visible queued state
- [x] Queue drain continues after explicit resume/unpause path via `onProcessingStopped` + pause-state check
- [x] Added structured logs for queue-hold and queue-drain transitions
- [x] Validate: `pnpm run typecheck:all` (PASS)

### Phase 4: Add Pause UI + Stale State Cleanup (R2, R5)

- [x] Rendered pause indicator/banner in chat UI when `session.pausedAgent` exists
- [x] Included actionable guidance: proceed / modify / abort
- [x] In renderer `handleComplete`, clear stale `pausedAgent` when processing ends without stage restart
- [x] Validate: `pnpm run typecheck:all` (PASS)

### Phase 5: Prompt and Comment Alignment (R3)

- [x] Updated `agents/isa-deep-research/AGENT.md` pause wording to match natural completion semantics
- [x] Updated stale comments in `agent-stage-gate.ts`/`sessions.ts` that referenced forceAbort as pause mechanism
- [x] Validate: `pnpm run typecheck:all` (PASS)

### Phase 6: Full Validation & Regression

- [x] `pnpm run typecheck:all` — PASS
- [x] `pnpm run lint` — no new errors attributable to this work (global lint remains failing with pre-existing issues)
- [x] `pnpm run electron:build` — PASS
- [-] Manual happy-path: stage 0 pause emits natural assistant summary, then resumes correctly on user decision (requires interactive app run)
- [-] Manual R1 test: user sends message mid-summary, verify no deadlock and predictable queue behavior (requires interactive app run)
- [-] Manual R4 test: verify no duplicate final assistant turn from subagent/parent completion (requires interactive app run)
- [-] Manual R5 test: stop/abort without resume clears pause UI state (requires interactive app run)

## Risks & Considerations

- Highest risk is queue/processing coordination during transitional pause windows (R1)
- UI resilience requires explicit pause-state rendering rather than relying on model verbosity (R2)
- Prompt/runtime alignment is essential to avoid contradictory model behavior (R3)

## Testing Strategy

1. Phase-by-phase type-check gates (`pnpm run typecheck:all`)
2. End-state lint/build (`pnpm run lint`, `pnpm run electron:build`)
3. Focused manual adversarial scenarios for R1/R2/R4/R5 prior to merge
