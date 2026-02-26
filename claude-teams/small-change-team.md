# Agent Team Workflow: Small Change Team

Create a team of agents

## Feature / Bug Description

------: What I want / request as feature
XXX
------


------: Output of previous run results
XXX
------

## Phase 1: Plan

Goal: Create a team of agents to assess the small change, verify its impact, and produce a lightweight implementation plan. plan.md is the main reference document on how this repository is set up.

### Prerequisites

- Ensure that you are on the right branch or create a new git branch for this change.
- Check for the latest session logs in `claude-teams/claude-teams-logs/` to understand recent agent team context and decisions.

### Mandatory: Craft Agent Session Log Analysis

Before ANY planning or implementation begins, the team MUST:

1. **Scan the Craft Agent sessions directory** (`sessions/`) — list all session folders, sort by date (folder names are `YYMMDD-slug`), and identify the most recent sessions.
2. **Read the most recent session's `session.jsonl`** — the first line is session metadata (name, model, token usage, message count, preview). Read it to understand what was last worked on.
3. **Analyze the full conversation** — read all messages in the session.jsonl, paying attention to:
   - What feature/bug was being worked on
   - What tool calls were made and their results (especially `isError: true` entries)
   - What the agent attempted, what succeeded, and what failed
   - Any stage gate pauses, user decisions, and agent responses
   - The final state: did it complete successfully or was it left incomplete?
4. **Check for error patterns** — search the session log for `"isError":true`, failed tool calls, validation warnings, and any error messages. Document exactly what went wrong, what the error was, and what code/config it was related to.
5. **Read the last 3 claude-teams logs** — list all `*_agentteamlog.jsonl` files in `claude-teams/claude-teams-logs/`, sort by filename (date-prefixed), and read the 3 most recent ones in full. For each log:
   - What feature/change was the team working on?
   - What did the team attempt and what was the outcome?
   - What errors, bugs, or gaps were found?
   - What solutions were tried — and did they work or fail?
   - What decisions were made and what trade-offs were accepted?
   - Were there any unresolved issues or open questions?
6. **Produce a Session Analysis Report** as the first logged event, containing:
   - Last Craft Agent session name and date
   - What was being worked on
   - What succeeded
   - What failed (with exact error text)
   - **Prior team attempts summary** (from the 3 most recent claude-teams logs):
     - For each log: date, feature, approach taken, outcome (success/failure), key errors, key decisions
     - Patterns across attempts: recurring errors, approaches that didn't work, approaches that did
   - Current state of the codebase based on all of the above
   - Any unfinished work or known issues
   - How this informs the current change

This analysis is logged as a `context_received` event with input_document type `craft_session_analysis` and is provided to ALL team members as foundational context.

### The Team

Team Lead (1 member):
- Orchestrates the workflow, manages handoffs, maintains shared context ledger.
- Performs the mandatory Craft Agent session log analysis (see above) as the first action.
- Logs all routing decisions.

Diagnostician (1 member) — **runs first, before the Planner**:
- This is the dedicated discovery agent. Their sole job is to figure out what has been going wrong.
- Independently reads:
  - The most recent Craft Agent session log (`sessions/*/session.jsonl`)
  - The last 3 claude-teams logs (`claude-teams/claude-teams-logs/*_agentteamlog.jsonl`)
- Performs a deep forensic analysis across all logs:
  - What approaches were tried in prior team runs? List each approach with its outcome.
  - What specific errors occurred? Extract exact error messages, stack traces, and affected files.
  - Were the same errors repeated across multiple attempts? Identify recurring failure patterns.
  - What was the root cause each time? Was it a code bug, a wrong assumption, a missing dependency, a config issue, or a misunderstanding of the plan?
  - What worked in prior attempts that should be preserved?
  - What was explicitly abandoned and why?
- Produces a **Diagnostic Report** containing:
  - `prior_approaches`: A numbered list of every approach tried across the last 3 team logs, with: what was done, what the result was, and why it failed or succeeded.
  - `recurring_errors`: Errors that appeared more than once, with exact text and the approach that caused them.
  - `root_causes`: The diagnosed root cause for each failure.
  - `what_works`: Things that were confirmed working and should not be touched.
  - `what_to_avoid`: Specific approaches, patterns, or assumptions that have been proven wrong.
  - `recommended_direction`: Based on all evidence, what the next attempt should do differently.
- Must log: CONTEXT_RECEIVED (all session + team logs read), REASONING (step-by-step forensic analysis with evidence from specific log entries), OUTPUT (full Diagnostic Report).

Planner (1 member):
- Receives the Session Analysis Report from the Team Lead AND the Diagnostic Report from the Diagnostician.
- Uses both to understand what was previously implemented, what failed, what the root causes were, and what approaches to avoid.
- Researches the relevant code area and proposes a focused plan for the change.
- Identifies any files, functions, or dependencies affected.
- The plan MUST explicitly reference the Diagnostic Report's `what_to_avoid` list and explain how each item is addressed or avoided.
- If proposing an approach that resembles a prior failed attempt, the planner MUST explain what is materially different this time.
- Must log: CONTEXT_RECEIVED (session analysis + diagnostic report), REASONING (with explicit references to diagnostic findings and how they inform the plan), OUTPUT.

Approach Validator (1 member) — **runs after the Planner, before the Reviewer**:
- This is the independent verification agent. Their job is to catch the team repeating old mistakes.
- Independently reads the same source material as the Diagnostician (does NOT just read the Diagnostician's report — gathers the raw logs themselves):
  - The last 3 claude-teams logs in full
  - The most recent Craft Agent session log
- Then reads the Planner's proposed plan.
- Performs a structured comparison:
  - For each prior approach in the logs: Is the new plan substantially different, or is it repeating the same approach? Score each as: DIFFERENT / SIMILAR / IDENTICAL.
  - For each prior failure: Does the new plan address the root cause, or could the same failure recur? Score each as: ADDRESSED / PARTIALLY_ADDRESSED / NOT_ADDRESSED.
  - For the Diagnostician's `what_to_avoid` list: Does the plan violate any item? Flag each as: CLEAR / RISK / VIOLATION.
- Produces an **Approach Validation Report** with:
  - `novelty_assessment`: Is this plan genuinely different from prior attempts? (YES / PARTIALLY / NO, with evidence)
  - `failure_coverage`: Does it address all known root causes? (list each with status)
  - `risk_flags`: Any concerns that this plan might fail for the same reasons as before
  - `viability_verdict`: PROCEED / REVISE / REJECT, with justification
  - If REVISE or REJECT: specific recommendations for what needs to change
- Must log: CONTEXT_RECEIVED (raw logs + planner's plan), INTERPRETATION (independent assessment of prior attempts vs. new plan), REASONING (structured comparison logic), OUTPUT (full Approach Validation Report).
- If the verdict is REVISE or REJECT, the plan goes back to the Planner with the validation report before proceeding.

Reviewer (1 member):
- Verifies the plan against plan.md to ensure it follows the existing structure and requirements.
- Cross-references the Approach Validation Report — only proceeds if the Approach Validator gave a PROCEED verdict.
- Checks that the change doesn't introduce unintended side effects.
- If gaps are found, reports them back to the planner for revision.
- Must log: CONTEXT_RECEIVED (session analysis + diagnostic report + approach validation + plan), INTERPRETATION (of planner's proposal + how it relates to prior session findings), REASONING, OUTPUT (with structured PASS/FAIL verdicts).

Synthesizer (1 member):
- Takes the planner's proposal, the Approach Validator's report, and the reviewer's feedback.
- Produces the final plan and presents it to the user.
- Asks if it can write the plan to plan.md or proceed directly to implementation.
- Must log: CONTEXT_RECEIVED (all inputs), INTERPRETATION (agreements/disagreements), REASONING (conflict resolution), OUTPUT (final plan).

### Logging Specification

All input, output, context, and interaction is logged and written out to:
`claude-teams/claude-teams-logs/YYYYMMDD-HHMMSS_[session_name]_agentteamlog.jsonl`

Same trace model as the full Plan workflow (see `claude-teams/research-and-plan-team.md`), but with a lighter footprint:
- `thinking_step` events can be batched (one event with multiple steps) for small changes.
- The session log review is captured as a `context_received` input_document of type `session_log_extract`.

---

## Phase 2: Implement and Test

Goal: Implement the small change following the plan and validate it works correctly.

### The Team

Team Lead (1 member):
- Orchestrates the workflow, manages handoffs.

Implementer (1 member):
- Receives the Session Analysis Report and uses it to understand prior implementation attempts, known errors, and current codebase state.
- If the session analysis shows prior failed attempts at the same or similar changes, the implementer MUST review the exact errors from those attempts before writing any code.
- Implements the change in a single pass.
- Must log: CONTEXT_RECEIVED (including session analysis), REASONING (with explicit notes on what prior session errors informed this approach), OUTPUT (full diff), SELF_REVIEW.

Code Reviewer (1 member):
- Verifies the implementation matches the plan and didn't miss anything.
- Checks that existing functionality is not broken.
- Reports any gaps back to the implementer.
- Must log: CONTEXT_RECEIVED, INTERPRETATION, REASONING, OUTPUT.

### Validation Loop

Once the change is implemented, the following loop runs until the test passes:

1. **Tester** — Runs the relevant unit tests and one focused E2E test with real input and real output. If things don't work, creates a concise bug report.
   Logs: CONTEXT_RECEIVED, REASONING, OUTPUT (full test output), BUG_REPORT (if failures).

2. **Log Investigator** — After the E2E test (whether it passes or fails):
   - Re-reads the latest Craft Agent session logs (`sessions/*/session.jsonl`) to check for additional implementation details, prior errors, or context that may explain the current behaviour.
   - Reads the last 3 claude-teams logs in `claude-teams/claude-teams-logs/` (including the current session's log-so-far) to understand the full history of prior team attempts.
   - Searches all logs for `"isError":true`, failed tool calls, and validation warnings that match the current failure pattern.
   - Compares actual test results against what the logs indicate should have been implemented.
   - Explicitly checks: is the current error the same as any error from the last 3 team runs? If yes, flags this as a **recurring failure** and references the Diagnostician's root cause analysis from Phase 1.
   - Reports any discrepancies, missing pieces, or patterns where the same error occurred in prior sessions.
   Logs: CONTEXT_RECEIVED (test results + Craft Agent session logs + last 3 agent team logs), INTERPRETATION (what logs say vs. what happened, recurring failure detection), REASONING, OUTPUT.

3. **Fix Implementer** — Takes the bug report and the log investigator's findings, identifies the root cause, and applies the fix.
   Logs: CONTEXT_RECEIVED (bug report span + log investigator span), REASONING (root cause analysis), OUTPUT (fix diff), SELF_REVIEW.

4. **Back to Tester** — The loop continues until the test fully passes and the log investigator confirms the implementation aligns with all prior session context.

5. **Completion** — Once the test passes, a short report is provided containing: what was changed, the test input and output, any relevant findings from the session logs, and confirmation that the change works as intended. Includes a `loop_summary` event.

### Logging Specification

All input, output, context, and interaction is logged and written out to:
`claude-teams/claude-teams-logs/YYYYMMDD-HHMMSS_[session_name]_agentteamlog.jsonl`

Same trace model and event types as the full Implement workflow (see `claude-teams/implement-plan-team.md`).
