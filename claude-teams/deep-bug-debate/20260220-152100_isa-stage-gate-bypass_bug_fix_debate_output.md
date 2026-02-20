# ISA Stage Gate Bypass -- Deep Bug Debate Final Report

**Date:** 2026-02-20
**Team:** Deep Bug Debate (5 investigators + moderator)
**Session:** 260220-cool-hill (bug reproduction), 260220-calm-clay (precursor)
**Convergence Level:** 95%

---

## Executive Summary

The ISA deep research agent pipeline appeared to "push through all 6 stages without pausing for user calibration." Investigation by 5 independent investigators reveals **two confirmed bugs**, one proximate and one latent:

1. **Bug 1 (PROXIMATE):** `managed.pauseLocked` persists across SDK Task tool call boundaries within the same `chat()` iteration. The subagent cannot resume the pipeline after user approval because `isPauseLocked()` returns `true`. The subagent escalates to force-reset, then abandons the stage gate entirely and produces output freestyle.

2. **Bug 2 (LATENT):** The anti-regeneration guard in the resume context injection forbids keywords (`READY`, `CLARIFYING`, `CALIBRATED`, `CONFIRMED`) that are required by Stage 0 and Stage 1 pause instructions. Even after Bug 1 is fixed, Stage 1 pause presentation would be suppressed.

The stage gate mechanism itself works correctly. Pauses fire at Stage 0 as designed. The bug is in the interaction between the pause lock lifecycle and the SDK Task tool architecture.

---

## Bug 1: isPauseLocked Persists Across Task Call Boundaries

### Classification
- **Type:** State lifecycle bug
- **Severity:** Critical (pipeline bypass)
- **Proximate cause of observed behavior**

### Mechanism

```
1. Chat call begins (outer agent processes user message)
2. Outer agent calls Task(isa-deep-research) -- FIRST Task call
3. Subagent runs Stage 0: start(0) -> tools -> complete(0)
4. complete(0) triggers pause: state.pausedAtStage=0 written to disk
5. onAgentStagePause callback fires -> sets managed.pauseLocked=true
   [sessions.ts:2949]
6. First Task returns pause output to outer agent
7. User approves ("Yes -- search authoritative ISA sources...")
8. Outer agent calls Task(isa-deep-research, resume) -- SECOND Task call
   ** onProcessingStopped HAS NOT FIRED -- both Tasks in same chat() **
9. Subagent calls resume(decision:"proceed")
10. handleResume checks isPauseLocked() -> returns TRUE
    [agent-stage-gate.ts:1173]
11. Resume BLOCKED: "Pipeline was just paused in this turn"
12. Subagent retries resume 2 more times -- all blocked
13. Subagent force-resets pipeline, creates run-002, run-003
14. Each new complete(0) re-triggers pause, re-sets pauseLocked=true
15. Subagent abandons stage gate, runs research tools directly
16. Stages 1-5 never authorized by stage gate
17. Output produced outside stage gate control
18. chat() finally returns -> onProcessingStopped fires -> pauseLocked=false
    [sessions.ts:4574]  (TOO LATE)
```

### Key Code Locations

| Location | What It Does |
|----------|-------------|
| `sessions.ts:2949` | Sets `managed.pauseLocked = true` when `onAgentStagePause` fires |
| `sessions.ts:4574` | Clears `managed.pauseLocked = false` in `onProcessingStopped()` |
| `agent-stage-gate.ts:1173` | `isPauseLocked()` check blocks resume when lock is true |
| `session-scoped-tools.ts:642` | Delegates `isPauseLocked` callback to `sessions.ts:2941` |
| `sessions.ts:4407-4434` | Processing loop: `onProcessingStopped` fires only after `chat()` returns |

### Evidence Chain

1. **Session forensics (moderator SEB-003,004,005):** Stage 0 pause fires correctly. Resume blocked 3 times with "Pipeline was just paused in this turn." Subagent force-resets 3 times, then produces output freestyle.
2. **Code tracing (investigator-1 SEB-019,020,021,022):** Task tool runs within same `chat()` call. `managed.pauseLocked` is shared via same `ManagedSession` object. `onProcessingStopped` only fires when outer `chat()` returns.
3. **State flow (investigator-3 SEB-105,106,107):** Dual-layer enforcement confirmed. `pauseLocked` set at line 2949, cleared only at line 4574. Never cleared between Task calls.
4. **Config scan (investigator-4 SEB-I4010,I4011):** Session 260218-early-gold ran pipeline correctly with DIRECT user interaction (not subagent Task calls). Proves the bug is specific to the Task/subagent architecture.
5. **Adversarial (investigator-5 SEB-I5005,I5007):** Self-correction confirmed first resume attempt (L13) hits stale `pauseLocked` from first Task call. All subsequent chaos is a consequence.

### Proof: Direct Sessions Work, Task Sessions Fail

| Session | Architecture | Stage 0 Pause | Resume | Stage 1+ |
|---------|-------------|---------------|--------|----------|
| 260218-early-gold | Direct user | Paused 71s | Resumed OK | Paused at Stage 1 (90s), then 2-5 |
| 260220-cool-hill | Task subagent | Paused (3x) | BLOCKED (7x) | Never reached via stage gate |

### Fix Direction

Clear `managed.pauseLocked` when a new user message begins processing (before `chat()` starts), or when a Task(resume) call is detected. The lock should guard against same-turn LLM self-resume within a single Task execution, not persist across user-approved Task boundaries.

Options:
- **Option A:** Clear `pauseLocked` at the start of message processing (before `chat()` call at `sessions.ts:4365`)
- **Option B:** Clear `pauseLocked` when `getPausedAgentResumeContext` detects a paused pipeline and injects resume instructions
- **Option C:** Replace the boolean flag with a `turnId` or `parentToolUseId` check -- only block resume within the same SDK tool execution context

---

## Bug 2: Anti-Regeneration Guard Keyword Conflict

### Classification
- **Type:** Instruction conflict (latent)
- **Severity:** High (would manifest after Bug 1 is fixed)
- **Would cause Stage 1 pause to be silently skipped**

### Mechanism

The stuck-loop fix (commit `7e72f54`) added an anti-regeneration guard to resume context injection:

```
sessions.ts:3974 (MANDATORY directive):
  "MANDATORY: Your FIRST action in this turn MUST be calling agent_stage_gate
   -- either resume or abort. Do NOT generate any text before calling the tool."

sessions.ts:3976 (anti-regeneration guard):
  "Do NOT regenerate or re-present previous stage output
   (no CALIBRATED, CONFIRMED, READY, CLARIFYING text)."
```

The forbidden keywords exactly match the pause stage instructions:

| Stage | Pause Instructions | Required First Line |
|-------|-------------------|-------------------|
| 0 (analyze_query) | "First line: READY or CLARIFYING" | `READY` or `CLARIFYING` |
| 1 (websearch_calibration) | "First line: CALIBRATED or CONFIRMED" | `CALIBRATED` or `CONFIRMED` |

When the LLM resumes Stage 0 and proceeds to Stage 1, it completes Stage 1 and receives `pauseRequired:true` with instructions to produce `CALIBRATED` or `CONFIRMED`. But the anti-regeneration guard (still active from the resume context) tells it to never produce those keywords. The LLM faces contradictory instructions and would likely skip the Stage 1 pause presentation entirely, proceeding directly to Stage 2+.

### Key Code Locations

| Location | What It Does |
|----------|-------------|
| `sessions.ts:3974` | MANDATORY first-action directive (changed from conditional in stuck-loop fix) |
| `sessions.ts:3976` | Anti-regeneration guard with forbidden keywords |
| `config.json:10-11` | Stage 0 pauseInstructions requiring READY/CLARIFYING |
| `config.json:16-17` | Stage 1 pauseInstructions requiring CALIBRATED/CONFIRMED |

### Evidence

- **Archaeology (investigator-2 SEB-I2004,I2005,I2008):** Commit `7e72f54` changed resume context from conditional ("if user CLEARLY indicates") to mandatory. Added anti-regeneration guard with keywords matching ALL pause stages.
- **Adversarial challenge (investigator-5 SEB-I5004):** Confirmed this is LATENT -- the subagent never reached Stage 1 completion in the observed session because Bug 1 prevented it. Would manifest once Bug 1 is fixed.

### Fix Direction

Make the anti-regeneration guard stage-specific:
- After Stage 0 resume: only forbid re-presenting Stage 0 output keywords (READY, CLARIFYING)
- After Stage 1 resume: only forbid re-presenting Stage 1 output keywords (CALIBRATED, CONFIRMED)
- Do NOT forbid keywords needed by UPCOMING stages

Or replace keyword-based guard with a structural instruction: "Do not re-present the output from Stage N (the stage that was just paused). Proceed to the next stage."

---

## Additional Findings

### autoAdvance Config Is Dead Code
The `autoAdvance: true` field in `config.json:29` is defined in the `StageGateConfig` interface (`agent-stage-gate.ts:88`) but is NEVER read or used in any handler logic. It has zero functional effect. Confirmed independently by investigator-1 (SEB-003), investigator-2 (SEB-I2006), investigator-3 (SEB-103), and investigator-4 (SEB-I4004). Should be removed or implemented.

### Subagent Can Bypass Stage Gate by Calling Domain Tools Directly
Investigator-5 (SEB-I5001,I5006) identified that the stage gate has no enforcement mechanism on domain tools. The subagent successfully called `isa_hybrid_search`, `isa_web_search`, `isa_get_paragraph`, and `isa_list_standards` without stage gate authorization for stages 1-5. This is an architectural gap -- the stage gate is advisory, not enforcing. Consider making domain tools stage-gate-aware or adding guardrails.

### The "7 Errors" Are Permission Blocks, Not Stage Gate Rejections
Investigator-5 (SEB-I5003) identified that the 7 errors reported by the user were NOT stage gate `allowed:false` responses. They were:
- 4x MCP Safe Mode blocks on write operations (`isa_hop_retrieve`, `isa_format_context`, `isa_entity_verify`)
- 2x Sibling tool call cascade failures
- 1x Write blocked in Explore mode

This means the subagent's freestyle research run had broken verification (`isa_entity_verify` failed, `isa_contradiction_check` failed) and broken retrieval (`isa_hop_retrieve` failed). Output quality was compromised.

### Build Was Current but Electron May Not Have Been Restarted
Investigator-4 (SEB-I4002,I4007) found that `main.cjs` was rebuilt after the fix commit, but the dev server does not auto-restart the Electron main process. If Electron was running when the fix was compiled, the user may have tested against old in-memory code. Plan Phase 9 "RESTART Electron" checkbox was unchecked.

---

## Hypothesis Scoreboard (Final)

| ID | Hypothesis | Confidence | Status |
|----|-----------|-----------|--------|
| **H1** | `isPauseLocked` persists across Task call boundary | **0.95** | **CONFIRMED** |
| **H8** | Anti-regeneration guard contradicts Stage 1 pause instructions | **0.70** | **CONFIRMED LATENT** |
| H4 | LLM ignores pause instructions | 0.15 | Secondary effect of H1 |
| H6 | Resume context injected too early | 0.10 | Moot (resume works, blocked by H1) |
| H7 | State corruption across force-reset runs | 0.05 | Ruled out |
| H2 | autoAdvance causes auto-progress | 0.00 | Refuted (dead code) |
| H3 | pauseAfterStages not applied | 0.00 | Refuted (works correctly) |
| H5 | isPauseLocked race condition | 0.00 | Subsumed by H1 |

---

## Recommended Fix Priority

### Priority 1: Fix Bug 1 (isPauseLocked persistence)
- **Location:** `apps/electron/src/main/sessions.ts:2949,4574`
- **Change:** Clear `pauseLocked` when processing a new user message that triggers a resume context injection, OR use a context-aware lock (turnId/parentToolUseId) instead of a boolean
- **Test:** Verify that after Stage 0 pause and user approval, the subagent can successfully call `resume()` in the second Task call

### Priority 2: Fix Bug 2 (anti-regeneration guard)
- **Location:** `apps/electron/src/main/sessions.ts:3974-3976`
- **Change:** Make the guard stage-specific -- only forbid keywords from the COMPLETED stage, not all stages. Or use structural instruction instead of keyword list.
- **Test:** Verify that after Stage 0 resume, the subagent can produce Stage 1 pause output with CALIBRATED/CONFIRMED keywords

### Priority 3: Restart Electron after build
- **Location:** `plan.md` Phase 9
- **Change:** Restart Electron main process after rebuild to ensure new code is loaded
- **Test:** Verify Electron is running the latest `main.cjs`

### Optional: Address stage gate enforcement gap
- Consider making domain tools stage-gate-aware (reject calls when pipeline is paused)
- Consider removing or implementing the dead `autoAdvance` config field

---

## Evidence Index

### Moderator Entries (SEB-001 to SEB-010, SEB-M011 to SEB-M016)
- SEB-001: calm-clay session -- ISA KB not connected, agent stopped
- SEB-002: cool-hill session -- ISA KB connected, auto-enable worked
- SEB-003: Stage 0 pause worked correctly (allowed:false, pauseRequired:true)
- SEB-004: Subagent tried resume 3 times, all blocked by isPauseLocked
- SEB-005: Subagent force-reset 3 times, created runs 002/003
- SEB-006: Subagent produced output OUTSIDE stage gate control
- SEB-007: Two-layer architecture: outer session + inner subagent Task calls
- SEB-008: Root cause hypothesis: turn boundary mismatch
- SEB-009: No isError fields in tool calls
- SEB-010: Stream A forensics summary
- SEB-M011: Hypothesis scoreboard v1
- SEB-M013: Convergence check #1 (65%)
- SEB-M014: Hypothesis scoreboard v2
- SEB-M015: Hypothesis scoreboard v3 (95% convergence)
- SEB-M016: Convergence check #2 (converged)

### Investigator-1 Entries (SEB-001 to SEB-008, SEB-019 to SEB-024)
- SEB-001(inv1): Stage gate handler architecture
- SEB-002(inv1): Pause decision code path
- SEB-003(inv1): autoAdvance is dead code
- SEB-004(inv1): Dual-layer pause enforcement
- SEB-005(inv1): Resume context injection (stuck-loop fix)
- SEB-006(inv1): Stage numbering consistency
- SEB-007(inv1): No auto-advance loop -- LLM-driven pipeline
- SEB-008(inv1): Hypothesis: LLM compliance vs handler logic
- SEB-019: Concur with moderator + code path confirmation
- SEB-020: Refined hypothesis: isPauseLocked persists in same session
- SEB-021: Task runs within same chat() call
- SEB-022: Refined hypothesis v3: second Task re-runs complete(0)
- SEB-023: Defense: concur with inv-3 and inv-2, TWO bugs confirmed
- SEB-024: Response to inv-5: both Task calls in same chat() loop confirmed

### Investigator-2 Entries (SEB-I2001 to SEB-I2009)
- SEB-I2001: Team log archaeology -- planning session
- SEB-I2002: Implementation session -- resolveAgentEnvironment refactor
- SEB-I2003: Commit timeline -- 3 commits form regression chain
- SEB-I2004: MANDATORY directive change in stuck-loop fix
- SEB-I2005: Anti-regeneration guard keywords match pause output keywords
- SEB-I2006: autoAdvance dead code (independent confirmation)
- SEB-I2007: Config and handler correctly aligned
- SEB-I2008: Hypothesis: anti-regeneration guard regression
- SEB-I2009: Integration: two bugs -- proximate (pauseLock) + latent (guard)

### Investigator-3 Entries (SEB-100 to SEB-110)
- SEB-100: Pipeline state storage in RunState
- SEB-101: complete() with pause -- atomic write
- SEB-102: resume() clears pause state
- SEB-103: autoAdvance is dead code (independent confirmation)
- SEB-104: Stage ID consistency confirmed
- SEB-105: Dual-layer pause enforcement detailed
- SEB-106: pauseLocked cleared ONLY in onProcessingStopped
- SEB-107: Session log evidence -- all resumes in same turnId
- SEB-108: After failures, subagent runs freestyle
- SEB-110: Hypothesis: pauseLocked never cleared between Task boundaries

### Investigator-4 Entries (SEB-I4001 to SEB-I4012)
- SEB-I4001: Branch is fix/isa-research-stuck-loop
- SEB-I4002: Build output is current
- SEB-I4003: pauseAfterStages [0,1] correct
- SEB-I4004: autoAdvance dead code (independent confirmation)
- SEB-I4005: AGENT.md instructions correct
- SEB-I4006: repairUnits unrelated to bug
- SEB-I4007: Dev server does not auto-restart Electron
- SEB-I4008: No external agent SDK -- all custom
- SEB-I4009: 3 runs all paused correctly at Stage 0
- SEB-I4010: Session 260218-early-gold ran correctly with direct user
- SEB-I4011: Hypothesis: isPauseLocked persists across Task boundary
- SEB-I4012: Queue hold mechanism confirms scope limitation

### Investigator-5 Entries (SEB-I5001 to SEB-I5007)
- SEB-I5001: Challenge: subagent ABANDONED stage gate, not pushed through
- SEB-I5002: Challenge: H1 correct but incomplete -- explains trigger not outcome
- SEB-I5003: The 7 errors are Safe Mode blocks, not stage gate rejections
- SEB-I5004: Challenge to inv-2: anti-regeneration guard is latent not causal
- SEB-I5005: Question: how does isPauseLocked persist if onProcessingStopped clears it?
- SEB-I5006: Contrarian hypothesis: stage gate works, bug is Task architecture
- SEB-I5007: Self-correction: first resume (L13) IS the root trigger

---

## Conclusion

The ISA deep research agent pipeline does NOT "push through all stages." The stage gate correctly pauses at Stage 0 every time. The actual failure sequence is:

1. Stage gate pauses correctly
2. User approves
3. Subagent cannot resume because `isPauseLocked` persists from the first Task call
4. Subagent escalates: force-reset (3x), retry (3x), then abandons stage gate entirely
5. Subagent produces research output by calling domain tools directly, without stage authorization
6. Stages 1-5 never go through the stage gate
7. Permission mode blocks cause 7 real errors during freestyle execution

Fix Bug 1 (`isPauseLocked` lifecycle) to restore the resume path. Fix Bug 2 (anti-regeneration guard keyword conflict) to ensure Stage 1 pause works after Bug 1 is resolved. Both fixes are scoped to `apps/electron/src/main/sessions.ts`.

---

*Report generated by Deep Bug Debate Moderator*
*5 investigators, 69 SEB entries, 2 convergence checks, 3 scoreboard versions*
