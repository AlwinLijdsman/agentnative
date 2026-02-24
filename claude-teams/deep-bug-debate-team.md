# Deep Bug Debate Team

Create a team of agents.

## Bug Description

------: What I want / what is the bug
XXX
------

------: Output of previous run results
XXX
------

## Output

- **Report** → `claude-teams/deep-bug-debate/YYYYMMDD-HHMMSS_[bug_slug]_bug_fix_debate_output.md`
- **Log** → `claude-teams/claude-teams-logs/YYYYMMDD-HHMMSS_[session_name]_agentteamlog.jsonl`

## CRITICAL: No Code Changes

**READ-ONLY workflow.** No code, config, or repo files may be modified. Only two files are created: the report and the JSONL log. Investigators READ source code/logs/config for evidence. They NEVER edit anything. Output is a report for humans or implementation teams to act on.

---

## Pre-Flight Checks (MANDATORY — run before anything else)

Before creating the team or spawning any agents, the Moderator MUST complete these steps in order. Do NOT skip any step. Do NOT proceed to Phase 0 until all pass.

1. **Teardown existing team** — Check if you are already leading a team. If yes, run `TeamDelete` to end it first. A leader can only manage one team at a time. Failing to do this will cause a fatal error (`Already leading team "X"`).
2. **Create output directories** — Ensure `claude-teams/deep-bug-debate/` and `claude-teams/claude-teams-logs/` exist. Create if missing.
3. **Initialize SEB** — Create `claude-teams/deep-bug-debate/SEB.jsonl` (empty or with a `session_start` seed entry).
4. **Create the team** — Only after steps 1-3 succeed, create the new team and spawn agents.
5. **Verify all agents spawned** — Confirm all 5 investigators + moderator are active before proceeding to Phase 0.

**If any pre-flight step fails:** Stop, log the error, and report it to the user. Do NOT proceed with a partial team or missing SEB.

---

## Shared Evidence Board (SEB)

Central append-only log enabling full concurrency. All agents read/write at any time.

**SEB contents:** forensics findings, hypotheses (initial/updated/withdrawn/merged), evidence (supporting/contradicting), challenges, defenses, investigation requests, confidence updates, moderator interventions.

**Rules:**
- Every entry tagged with `author`, `timestamp`, `entry_type`, linked via `parent_seb_id`
- Entries are immutable — updates are new entries referencing the original
- Each hypothesis has one owner maintaining its current version
- Moderator maintains a live **Hypothesis Scoreboard** (all hypotheses + confidence + status + open challenges), updated after significant events

**SEB Entry Format:**
```json
{ "seb_id": "SEB-042", "entry_type": "forensic_finding|hypothesis|evidence|challenge|defense|investigation_request|confidence_update|moderator_intervention|hypothesis_merge|concession", "author": "investigator-1", "timestamp": "ISO-8601", "parent_seb_id": "SEB-038|null", "data": {} }
```

---

## Phase 0: Parallel Forensics Bootstrap

Build evidence base from prior sessions/logs. Split across agents by specialty; investigators begin working as soon as first SEB entries appear.

### Parallel Streams (all concurrent, post to SEB immediately — never batch)

| Stream | Agent | Focus |
|--------|-------|-------|
| A | Moderator | Session log analysis (steps 1-4) |
| B | Investigator 2 | Team log archaeology (step 5) |
| C | Investigator 4 | Codebase/config/build/deps scan (step 6) |

**Stream A — Moderator:**
1. Scan `sessions/` — list folders, sort by date (`YYMMDD-slug`), find most recent
2. Read most recent `session.jsonl` first line (metadata: name, model, tokens, preview) → post to SEB
3. Analyze full conversation — feature/bug worked on, tool calls + results (especially `isError: true`), what succeeded/failed, stage gate pauses, final state → post findings as they emerge
4. Search for `"isError":true`, failed tool calls, validation warnings → post each pattern immediately

**Stream B — Investigator 2:**
5. Read last 3 `*_agentteamlog.jsonl` files from `claude-teams/claude-teams-logs/` (sorted by date). Per log extract: feature worked on, approach, outcome, errors/gaps, solutions tried, decisions, unresolved issues. Post each log summary immediately upon completion.

**Stream C — Investigator 4:**
6. Read `plan.md` (root) first — it is the single source of truth for architecture, stack, conventions, and technical spec. Extract sections relevant to the bug (folder map, component architecture, data flow, conventions). Post architectural context to SEB immediately.
7. Scan config files, package.json, build scripts, tsconfig, env setup relevant to bug. Post findings as discovered.

### Soft Transition

No hard boundary between forensics and investigation:
- **Investigators 1, 3, 5** begin reading SEB and starting preliminary investigation as soon as first forensics entries appear
- May post early hypotheses marked `preliminary: true` before forensics completes
- Refine theories as more forensics land

**Moderator Forensics Summary** — posted as `forensics_summary` once all streams have core findings. Checkpoint only; does NOT block in-progress work. Contains: last session name/date, what was worked on, what succeeded/failed (exact errors), prior team attempts (per-log: date, feature, approach, outcome, key errors, decisions; cross-log patterns: recurring errors, failed/working approaches), architecture & design context from `plan.md` (relevant stack/conventions/component architecture), codebase state, unfinished work, implications for current bug.

---

## Phase 1: Concurrent Investigation & Debate

5 investigators concurrently investigate, hypothesize, challenge, defend, re-investigate, and converge. Investigation and debate are merged — one continuous event-driven cycle.

### Team

| Role | Agent | Specialty | Hypothesis Style | Phase 0 Role |
|------|-------|-----------|-----------------|-------------|
| **Moderator** | moderator | Orchestration, scoreboard, interventions, convergence monitoring, rigor enforcement | — | Stream A |
| **Inv 1** | investigator-1 | Code path tracing: call chain from entry to failure | "Bug occurs because at step X, function Y does Z instead of W" | — |
| **Inv 2** | investigator-2 | Error archaeology: error history, regressions, prior fix attempts | "Regression caused by change X in session Y, broke assumption Z" | Stream B |
| **Inv 3** | investigator-3 | State & data: data flow, state management, runtime values | "State X not updated when event Y fires, leaving inconsistent state" | — |
| **Inv 4** | investigator-4 | Environment: config, deps, build, platform, timing | "Dependency X updated to Y, changed behavior of Z" | Stream C |
| **Inv 5** | investigator-5 | Adversarial skeptic: contrarian, questions assumptions | "Reported behavior is correct because X; real issue is Y" | — |

**Moderator** logs: CONTEXT_RECEIVED, REASONING (orchestration decisions), OUTPUT (scoreboard updates, intervention rationale, convergence assessments).

**All investigators:** Post hypothesis as soon as formed (even preliminary). Read others' SEB entries. Challenge competing hypotheses. Defend when challenged. Re-investigate when gaps found. Inv 2 and Inv 4 naturally transition from forensics to investigation.

### Investigation-Debate Loop

Each investigator runs **asynchronously and independently** until Moderator declares convergence:

```
LOOP:
  1. INVESTIGATE    → Read SEB + search codebase + gather evidence
  2. POST           → Post/update hypothesis + evidence to SEB
  3. SCAN           → Read others' recent SEB entries
  4. CHALLENGE      → Rebut hypotheses you can weaken/disprove
  5. DEFEND         → Respond to challenges on your hypothesis
  6. CHECK          → Answer Investigation Requests you can help with
  7. RE-INVESTIGATE → If gaps/new leads found, gather more evidence (→ step 1)
  8. CONVERGE       → If confident + no open challenges, signal readiness
```

No waiting between investigators. Challenges, defenses, and merges happen organically in real-time.

### Investigation Requests

Any agent posts when hitting a gap — triggers targeted re-investigation instead of stalling on unknowns.

```json
{ "entry_type": "investigation_request", "author": "investigator-5",
  "data": { "request_id": "IR-3", "question": "...", "context": "...",
    "priority": "HIGH|MEDIUM|LOW", "suggested_investigator": "investigator-1|any",
    "claimed_by": null, "status": "open|claimed|answered" } }
```

**Rules:** Any agent can post. Any investigator can claim (prevents duplicates). Moderator assigns unclaimed requests by specialty fit. Answers posted as `evidence` entries referencing the request. HIGH priority = pick up before other work. Moderator flags requests blocking convergence.

### Debate Rules

1. **Evidence-based only** — cite `file:line` or `log timestamp T`, never "I think"
2. **Address the hypothesis, not the investigator**
3. **Concessions valued** — withdrawing disproven hypothesis = strength
4. **Merging encouraged** — complementary hypotheses should merge
5. **Moderator enforces rigor** — flags vague arguments, rejects claims without evidence
6. **Re-investigation expected** — when challenged, gather evidence rather than speculate

### Challenge Format
```json
{ "entry_type": "challenge", "author": "investigator-3", "parent_seb_id": "SEB-025",
  "data": { "target_hypothesis_id": "H-1", "target_investigator": "investigator-1",
    "challenge_type": "DISPROVE|WEAKEN|QUESTION|ALTERNATIVE_EXPLANATION",
    "quoted_claim": "exact claim from hypothesis", "argument": "specific argument",
    "evidence": [{ "type": "code|log|config|test", "source": "file:line", "content": "...", "relevance": "..." }],
    "severity": "FATAL|SIGNIFICANT|MINOR",
    "alternative": "what better explains the evidence (if applicable)",
    "investigation_request": "optional — gap revealed by challenge" } }
```

### Defense Format
```json
{ "entry_type": "defense", "author": "investigator-1", "parent_seb_id": "SEB-030",
  "data": { "responding_to_seb_ids": ["SEB-030","SEB-033"],
    "defense_type": "REFUTED|PARTIALLY_CONCEDED|FULLY_CONCEDED|STRENGTHENED",
    "argument": "response", "new_evidence": [{ "type":"...", "source":"...", "content":"...", "relevance":"..." }],
    "updated_confidence": 0.65, "concessions": ["points conceded"],
    "hypothesis_updated": true, "updated_hypothesis": "revised statement",
    "further_investigation_needed": "what to look into next" } }
```

### Moderator Interventions

Posted to SEB as `moderator_intervention` throughout investigation:

| Type | Trigger | Example |
|------|---------|---------|
| **Redirect** | Evidence contradicts own hypothesis | "Inv 4, SEB-041 supports H-1 — re-evaluate" |
| **Merge Nudge** | Hypotheses overlap significantly | "Inv 1+3, your hypotheses are complementary — discuss merge" |
| **Priority** | IR blocking convergence | "IR-3 blocks convergence — Inv 2, prioritize" |
| **Prune** | FATAL challenge, no defense for 2 cycles | "Inv 5, H-5 has 3 undefended FATAL challenges — consider withdrawing" |
| **Focus** | Investigation too broad | "Evidence concentrates on stage gate handler — Inv 3+4, focus there" |
| **Escalate** | Critical question unanswered | "Build output vs source unchecked — new HIGH priority IR" |

### Hypothesis Lifecycle

```
PRELIMINARY → FORMED → CHALLENGED → DEFENDED → [STRENGTHENED|WEAKENED|MERGED|WITHDRAWN]
     ↑                                    |
     └────── RE-INVESTIGATED ←────────────┘
```

States: PRELIMINARY (early, pre-forensics), FORMED (full + evidence + predictions), CHALLENGED (open challenges), DEFENDED (all addressed), STRENGTHENED (survived + gained evidence), WEAKENED (partly conceded), MERGED (combined), WITHDRAWN (disproven), RE-INVESTIGATED (gathering more evidence).

### Investigation Report Format

Consolidated snapshot requested by Moderator before convergence assessment:

```json
{ "investigator": "investigator-1", "specialty": "Code Path Tracer", "investigation_cycle": 3,
  "hypothesis": { "statement": "...", "version": 2, "previous_versions_seb_ids": ["SEB-025","SEB-042"],
    "predicted_evidence": ["If correct, we'd see X"], "predicted_counter_evidence": ["If wrong, we'd see Z"] },
  "evidence": {
    "supporting": [{ "type": "code|log|config|test|doc", "source": "file:line", "content": "...", "relevance": "...", "seb_id": "SEB-028" }],
    "contradicting": [{ "type":"...", "source":"...", "content":"...", "relevance":"...", "seb_id":"SEB-035" }] },
  "challenges_received": [{ "from": "investigator-3", "seb_id": "SEB-030", "severity": "SIGNIFICANT", "status": "REFUTED" }],
  "challenges_sent": [{ "target": "investigator-3", "seb_id": "SEB-032", "severity": "FATAL", "status": "CONCEDED" }],
  "investigation_requests_answered": ["IR-2"],
  "confidence": 0.75, "confidence_justification": "what would raise/lower it",
  "reproduction_steps": ["Step 1","Step 2"],
  "suggested_fix": { "description": "...", "files": ["path/to/file"], "risk": "..." },
  "open_questions": ["..."] }
```

---

## Phase 2: Convergence

Continuous assessment running alongside Phase 1. Moderator declares convergence when ALL thresholds met:

| Criterion | Threshold |
|-----------|-----------|
| Confidence stability | No hypothesis changed >0.1 in last 5 SEB events |
| Evidence saturation | No new evidence in last 3 investigation cycles |
| Challenge resolution | All FATAL/SIGNIFICANT challenges have defenses |
| Investigation Requests | All HIGH priority answered |
| Consensus | ≥3 of 5 investigators agree on same/merged hypothesis |
| Hard timeout | Max 8 cycles per investigator |

Moderator posts `convergence_check` at minimum every 5 SEB events:
```json
{ "entry_type": "convergence_check", "author": "moderator",
  "data": { "check_number": 4,
    "criteria": {
      "confidence_stability": { "met": true, "detail": "..." },
      "evidence_saturation": { "met": false, "detail": "..." },
      "challenge_resolution": { "met": false, "detail": "..." },
      "investigation_requests": { "met": true, "detail": "..." },
      "consensus_threshold": { "met": true, "detail": "..." },
      "hard_timeout": { "met": false, "detail": "..." } },
    "overall": "NOT_CONVERGED|CONVERGED|TIMEOUT",
    "blocking_items": ["..."], "next_action": "..." } }
```

### Convergence Declaration

When criteria met (or hard timeout reached):
1. Request consolidated Investigation Reports from all investigators
2. Post convergence report:

```json
{ "entry_type": "convergence_declared", "author": "moderator",
  "data": {
    "surviving_hypotheses": [{ "investigator": "investigator-1", "hypothesis_seb_id": "SEB-042", "final_confidence": 0.85, "status": "STRONG" }],
    "withdrawn_hypotheses": [{ "investigator": "investigator-4", "hypothesis_seb_id": "SEB-038", "reason": "..." }],
    "merged_hypotheses": [{ "from": ["investigator-1","investigator-3"], "merged_statement": "...", "merge_seb_id": "SEB-055" }],
    "consensus_status": "CONSENSUS|MAJORITY|SPLIT",
    "total_investigation_cycles": { "investigator-1": 5, "investigator-2": 6, "investigator-3": 4, "investigator-4": 3, "investigator-5": 5 },
    "total_seb_entries": 67, "total_challenges": 18, "total_investigation_requests": 5,
    "moderator_rationale": "..." } }
```

### Hard Timeout Without Consensus

If 8 cycles reached without natural convergence:
1. Moderator posts **Final Positions Request**
2. Each hypothesis holder makes one final case
3. Moderator declares outcome — may be a documented SPLIT with remaining hypotheses, evidence, and unresolved tensions

---

## Phase 3: Bug Fix Debate Report

Produce comprehensive report capturing input, debate, and conclusions. **Report only — no code changed.**

### Consensus Writer (1 member)

Reads entire SEB + convergence report. Produces the report.

Must log: CONTEXT_RECEIVED (SEB contents, convergence report), REASONING (how outcome was distilled — emphasis, deprioritization, conflict resolution), OUTPUT (report content), FINDINGS_PRODUCED (link to output file).

### Report Structure

Written to: `claude-teams/deep-bug-debate/YYYYMMDD-HHMMSS_[bug_slug]_bug_fix_debate_output.md`

Three parts: **Input** (what went in), **Debate** (what was argued), **Conclusions** (what to do).

```markdown
# Bug Fix Debate Report: [Bug Title]
**Date**: YYYY-MM-DD | **Session**: [trace_id] | **Consensus**: CONSENSUS|MAJORITY|SPLIT | **Confidence**: X.XX
**Note**: Read-only investigation report. No code was modified.

---
# Part 1: Input

## 1.1 Bug Description
[Verbatim from input]

## 1.2 Reproduction Steps
1. ...

## 1.3 Previous Run Output
[Verbatim from input]

## 1.4 Session Forensics Summary
### Last Session Analysis
- **Session**: [name/date] | **Worked on**: ... | **Succeeded**: ... | **Failed**: [exact error] | **State**: complete/incomplete/abandoned

### Prior Team Attempts
| # | Date | Team Log | Feature/Bug | Approach | Outcome | Key Errors | Key Decisions |
|---|------|---------|-------------|---------|---------|-----------|---------------|
| 1 | ... | ... | ... | ... | ... | ... | ... |

### Patterns Across Attempts
- Recurring errors: ... | Failed approaches: ... | Working approaches: ... | Unfinished work: ...

## 1.5 Codebase Context
| File | Relevance | Key Functions/Areas |
|------|----------|-------------------|
| `path/file.ts` | ... | `fn()` — does X |

## 1.6 Architecture & Design Context (from plan.md)
[Relevant excerpts from `plan.md` — the project's single source of truth for architecture, stack, conventions, and technical spec. Include only sections that inform this bug: component architecture, data flow, relevant conventions, current implementation status. If the investigation produces new technical insights that belong in plan.md, note them here for the implementation team to update.]

---
# Part 2: Debate

## 2.1 Investigation Timeline
| Time | Agent | Action | SEB Entry | Detail |
|------|-------|--------|-----------|--------|
| T+0 | Moderator | Forensics started | SEB-001 | Session log analysis |
| ... | ... | ... | ... | ... |

## 2.2 Hypotheses Formed
### H-1: [Title] — Investigator 1 (Code Path Tracer)
**Statement**: ... | **Initial confidence**: X.XX | **Lens**: Code path tracing
**Supporting evidence**:
| # | Type | Source | Content | Relevance |
|---|------|--------|---------|----------|
**Contradicting evidence**:
| # | Type | Source | Content | Relevance |
|---|------|--------|---------|----------|
**Predicted evidence**: ... | **Predicted counter-evidence**: ...

[Repeat for H-2 through H-5]

## 2.3 Challenges & Rebuttals
### Challenges to H-1
| # | From | Severity | Type | Summary |
|---|------|---------|------|--------|
**C-1 detail**: Quoted claim: "..." | Argument: ... | Evidence: [source] — [content] | Alternative: ...

[Repeat per hypothesis]

## 2.4 Defenses
### Defenses of H-1
| # | Responding to | Type | Confidence Change | Summary |
|---|-------------|------|------------------|--------|
**D-1 detail**: Type: REFUTED | Argument: ... | New evidence: ... | Concessions: ... | Gaps remaining: ...

[Repeat per hypothesis]

## 2.5 Investigation Requests
| # | Question | By | Priority | Claimed By | Status | Answer |
|---|---------|---|---------|-----------|--------|--------|
**IR-1 detail**: Question: ... | Context: ... | Blocking: [hypotheses] | Answer: ... | Impact: ...

## 2.6 Hypothesis Merges
| From | By | Merged Statement | Rationale |
|-----|---|-----------------|----------|

## 2.7 Concessions & Withdrawals
| Hypothesis | Investigator | Reason | Disproven By | Remaining Value |
|-----------|-------------|--------|-------------|----------------|

## 2.8 Moderator Interventions
| # | Type | Target | Message | Rationale |
|---|------|--------|---------|----------|

## 2.9 Convergence Process
| Criterion | Met? | Detail |
|-----------|------|--------|

---
# Part 3: Conclusions
**No code was changed. Instructions for the implementation team.**

## 3.1 Executive Summary
[2-3 paragraphs: root cause, actionable, no process details]

## 3.2 Root Cause Analysis
### Consensus Finding
[Root cause. If SPLIT: majority view first, then minority.]
### Key Evidence
[Strongest evidence with code refs, log excerpts, linked to investigators/SEB entries]
### Hypothesis Outcome Summary
| # | Hypothesis | Investigator | Confidence | Outcome | Key Factor |
|---|-----------|-------------|-----------|---------|------------|

## 3.3 What Has Been Tried Before
| Attempt | Session/Log | Approach | Outcome | Why It Failed |
|---------|-----------|---------|---------|-------------|

## 3.4 Recommended Fix
**RECOMMENDATION ONLY. No code changed by this workflow.**
### Approach
[What to change]
### Files to Modify
| File | Function/Area | Change | Why |
|------|-------------|--------|-----|
### Implementation Sequence
1. First: ... — because ...
2. Then: ... — depends on 1
3. Finally: ...
### Warnings
- **Do NOT** [prior failed approach]
- **Watch out for** [gotcha from investigation]
### Risk Assessment
[Side effects, concerns]

## 3.5 Test Plan
**Verification**: 1. ... 2. ... | **Expected outcomes**: ...

## 3.6 Key Debate Arguments
### Turning Points
[Evidence that shifted consensus — what, who, what it disproved]

## 3.7 Unresolved Questions
| # | Question | Why It Matters | Impact on Fix |
|---|---------|---------------|--------------|
```

---

## Logging Specification

Log file: `claude-teams/claude-teams-logs/YYYYMMDD-HHMMSS_[session_name]_agentteamlog.jsonl`

### Trace Model

Every log line:
```json
{ "trace_id": "uuid-v4", "span_id": "uuid-v4", "parent_span_id": "uuid-v4|null",
  "agent": "investigator-1", "role": "investigator",
  "timestamp": "ISO-8601", "sequence": 42,
  "event_type": "...", "phase": "forensics|investigation_debate|convergence|findings",
  "task_id": "2.1", "seb_id": "SEB-042|null", "data": {} }
```

### Standard Event Types

From `research-and-plan-team.md` / `implement-plan-team.md`: `session_start`, `session_end`, `context_received`, `thinking_started`, `thinking_step`, `thinking_complete`, `output_produced`, `handoff`, `conflict_resolved`, `dissent`.

### Concurrent Investigation Event Types

**SEB events** (primary channel):
- `evidence_board_entry`: `{ "seb_id":"...", "entry_type":"forensic_finding|hypothesis|evidence|challenge|defense|investigation_request|confidence_update|moderator_intervention|hypothesis_merge|concession|forensics_summary|convergence_check", "parent_seb_id":"...|null", "data":{} }`

**Investigation events:**
- `hypothesis_formed`: `{ "hypothesis_id":"H-1", "version":1, "preliminary":false, "statement":"...", "predicted_evidence":["..."], "predicted_counter_evidence":["..."], "confidence":0.75, "specialty_lens":"code_path_trace|error_archaeology|state_data|env_config|adversarial", "investigation_cycle":1 }`
- `hypothesis_updated`: `{ "hypothesis_id":"H-1", "version":2, "previous_version_seb_id":"SEB-025", "statement":"...", "change_reason":"...", "confidence":0.80, "investigation_cycle":3 }`
- `evidence_gathered`: `{ "hypothesis_id":"H-1", "evidence_type":"supporting|contradicting", "source_type":"code|log|config|test|doc|runtime", "source_ref":"path/file:L10-L25", "content":"...", "relevance":"...", "investigation_cycle":2 }`
- `investigation_cycle`: `{ "investigator":"investigator-1", "cycle_number":3, "actions_taken":["..."], "hypothesis_status":"FORMED|CHALLENGED|DEFENDED|STRENGTHENED|WEAKENED", "current_confidence":0.80, "next_planned_action":"..." }`

**Debate events:**
- `challenge`: `{ "target_hypothesis_id":"H-3", "target_hypothesis_seb_id":"SEB-025", "target_investigator":"investigator-3", "challenge_type":"DISPROVE|WEAKEN|QUESTION|ALTERNATIVE_EXPLANATION", "quoted_claim":"...", "argument":"...", "evidence":[{"source":"...","content":"...","relevance":"..."}], "severity":"FATAL|SIGNIFICANT|MINOR", "alternative":"...", "triggers_investigation_request":"IR-3|null" }`
- `defense`: `{ "responding_to_seb_ids":["SEB-030","SEB-033"], "defense_type":"REFUTED|PARTIALLY_CONCEDED|FULLY_CONCEDED|STRENGTHENED", "argument":"...", "new_evidence":[...], "concessions":["..."], "further_investigation_needed":"..." }`
- `investigation_request`: `{ "request_id":"IR-3", "question":"...", "context":"...", "priority":"HIGH|MEDIUM|LOW", "suggested_investigator":"...|any", "blocking_hypotheses":["H-1","H-3"], "status":"open|claimed|answered" }`
- `investigation_request_update`: `{ "request_id":"IR-3", "update_type":"claimed|answered", "claimed_by":"investigator-1", "answer":"...", "answer_evidence_seb_id":"SEB-048", "impact":"..." }`
- `concession`: `{ "hypothesis_id":"H-4", "reason":"...", "disproven_by_seb_ids":["SEB-030","SEB-033"], "remaining_value":"..." }`
- `confidence_update`: `{ "hypothesis_id":"H-1", "old_confidence":0.75, "new_confidence":0.85, "reason":"...", "triggered_by_seb_ids":["SEB-045","SEB-048"], "investigation_cycle":4 }`
- `hypothesis_merge`: `{ "merged_hypothesis_ids":["H-1","H-3"], "merged_by":["investigator-1","investigator-3"], "merged_statement":"...", "merge_rationale":"...", "new_hypothesis_id":"H-1+3", "new_confidence":0.88 }`

**Moderator events:**
- `moderator_intervention`: `{ "intervention_type":"redirect|merge_nudge|priority|prune|focus|escalate", "target_investigators":["investigator-4"], "message":"...", "rationale":"...", "referenced_seb_ids":["SEB-041","SEB-038"] }`
- `convergence_check`: `{ "check_number":4, "criteria":{ "confidence_stability":{"met":true,"detail":"..."}, "evidence_saturation":{"met":false,"detail":"..."}, "challenge_resolution":{"met":false,"detail":"..."}, "investigation_requests":{"met":true,"detail":"..."}, "consensus_threshold":{"met":true,"detail":"..."}, "hard_timeout":{"met":false,"detail":"..."} }, "overall":"NOT_CONVERGED|CONVERGED|TIMEOUT", "blocking_items":["..."], "next_action":"..." }`
- `cycle_summary`: `{ "cycle_range":"SEB-040 through SEB-055", "hypotheses_standing":3, "hypotheses_withdrawn":2, "investigation_requests_open":1, "investigation_requests_answered":3, "key_developments":["..."], "moderator_assessment":"...", "convergence_estimate":"..." }`
- `consensus_declared`: `{ "consensus_type":"CONSENSUS|MAJORITY|SPLIT", "winning_hypothesis_ids":["H-1+3"], "winning_confidence":0.90, "dissenting_hypothesis_ids":[], "total_cycles":{"investigator-1":5,...}, "total_seb_entries":67, "total_challenges":18, "total_investigation_requests":5, "total_concessions":3, "moderator_rationale":"..." }`
- `findings_produced`: `{ "output_file":"claude-teams/deep-bug-debate/YYYYMMDD-HHMMSS_bug-slug_bug_fix_debate_output.md", "consensus_type":"CONSENSUS", "root_cause_summary":"...", "recommended_fix_summary":"...", "investigation_stats":{"investigators":5, "hypotheses_formed":5, "hypotheses_surviving":2, "total_cycles_all_investigators":23, "total_seb_entries":67, "total_evidence_items":47, "total_challenges":18, "total_investigation_requests":5, "total_investigation_requests_answered":5} }`

### Streaming & Monitoring

- Flush each event to JSONL immediately
- SEB `evidence_board_entry` events are the primary stream
- `thinking_step` events stream in real-time for progress visibility
- Challenge/defense/IR events logged in real-time for live following

**Viewer modes:** Timeline (chronological, color-coded), Agent (one investigator's journey), SEB (live feed with threading), Hypothesis tracker (confidence/status/challenges), IR tracker (open/claimed/answered), Evidence map (by hypothesis, supporting/contradicting), Convergence dashboard (criteria status), Trace tree (parent-child span hierarchy).

### Log Readability

- Readable by humans scanning raw JSONL
- All `content`/`thought` fields in plain English
- Every cross-agent reference includes both `span_id` and `seb_id`
- File references include path + line range
- Arguments must be self-contained (understandable without lookups)
- Challenges must quote the specific claim challenged
- IRs must include enough context for any investigator to answer
