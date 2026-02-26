# Agent Team Workflow: Implement Plan Team

Create a team of agents

## Feature Description

------
XXX
------

## Phase 1: Implement

Goal: Create a team of agents that takes the plan from plan.md (or the feature description above) and carefully implements it.

### The Team

Team Lead (1 member):
- Orchestrates the workflow, manages handoffs, maintains shared context ledger.
- Routes bug reports through the fix cycle.
- Logs all routing decisions with rationale.

Implementer (1 member):
- Carefully implements each phase of the plan.
- Must log:
  - CONTEXT_RECEIVED: The plan phase being implemented, all relevant code context read.
  - REASONING: Step-by-step implementation thinking — what approach was chosen, what alternatives were considered, what edge cases were identified.
  - OUTPUT: The full diff/change description with file paths, line numbers, and the exact code written. Every line of code change is captured in the log.
  - SELF_REVIEW: Before handing off, the implementer reviews their own changes and logs any concerns or areas of uncertainty.

Unit Tester (1 member):
- Runs the relevant unit tests right after each phase to verify proper implementation.
- Must log:
  - CONTEXT_RECEIVED: Which implementation changes they are testing (span_ids), which test files they are running.
  - REASONING: Why these specific tests are relevant, what they expect to see.
  - OUTPUT: Full test output (stdout/stderr), pass/fail per test, coverage if available.
  - INTERPRETATION: If tests fail, their analysis of WHY — root cause hypothesis with evidence.

Code Reviewer (1 member):
- Verifies whether the implementation is done properly and didn't miss anything given the structure and the plan.
- Must log:
  - CONTEXT_RECEIVED: The plan phase, the implementation diff (from implementer's output_produced span), and the test results.
  - INTERPRETATION: Their understanding of what was implemented vs. what was planned.
  - REASONING: Line-by-line review logic — what they checked, potential issues found.
  - OUTPUT: Structured review with PASS/FAIL per plan item, gaps identified, suggestions for improvement.
  - Reports any potential gaps to the team lead.

UI Tester (1 member, if applicable):
- Runs a Playwright MCP server and tests the user interface diligently.
- Must log:
  - CONTEXT_RECEIVED: What UI behavior should exist per the plan, which pages/flows to test.
  - REASONING: Test strategy — what scenarios to test, what constitutes success.
  - OUTPUT: Full test execution log, screenshots (as base64 or file paths), pass/fail per scenario with visual evidence.
  - INTERPRETATION: If something looks wrong, description of visual discrepancy with screenshot reference.
- Passes along screenshots to the reviewing team members to show if the implementation worked as intended.
- This team member is critical and doesn't accept easy answers.

Plan Evaluator (1 member):
- Considers feedback from all checks (unit tests, code review, UI tests) and evaluates if the high-level plan needs adjustment.
- Must log:
  - CONTEXT_RECEIVED: All feedback spans from tester, code reviewer, UI tester.
  - INTERPRETATION: Consolidated view of all feedback — what's working, what's not.
  - REASONING: Whether feedback warrants plan changes — analysis of whether issues are implementation bugs vs. plan-level design problems.
  - OUTPUT: Either "plan confirmed, no changes" (with justification) or specific plan amendments with rationale for each change.
  - DECISION: If plan changes are made, log a `conflict_resolved` event explaining the original plan intent vs. the new direction.

### End-to-End Validation Loop

Once all phases are complete, the following loop runs until the E2E test fully passes:

1. **E2E Tester**:
   - Runs the code end-to-end (not just unit tests).
   - Writes real input, tests real output, and checks E2E if this works.
   - Must log:
     - CONTEXT_RECEIVED: What end-to-end behavior is expected, test input data.
     - REASONING: Test design rationale — what scenarios cover the full feature.
     - OUTPUT: Full test execution log, all inputs, all outputs, all errors with stack traces, timing information.
     - BUG_REPORT (if failures):
       ```json
       {
         "bug_id": "BUG-1",
         "severity": "CRITICAL|HIGH|MODERATE",
         "reproduction_steps": ["Step 1", "Step 2"],
         "expected_behavior": "...",
         "actual_behavior": "...",
         "error_output": "full stderr/stdout",
         "relevant_code_spans": ["span_ids of implementation that likely caused this"],
         "environment": { "os": "...", "node_version": "..." }
       }
       ```

2. **Adversarial Bug Reviewer**:
   - Carefully scrutinizes the bug report.
   - Must log:
     - CONTEXT_RECEIVED: The bug report span + relevant implementation spans.
     - INTERPRETATION: Their understanding of the bug — restatement in own words.
     - REASONING: Root cause analysis — trace through the code path, identify the exact failure point, consider whether the bug is in implementation, plan, test setup, or environment.
     - OUTPUT: Validated bug report with root cause hypothesis, affected code paths, and risk assessment of the fix (what else could break).
     - DISSENT: If they believe the bug report is incorrect (e.g., test is wrong, not the code), they must state this with evidence.

3. **Fix Planner**:
   - Takes the validated bug report and creates a fix plan.
   - Must log:
     - CONTEXT_RECEIVED: Bug report + bug reviewer analysis + original implementation.
     - REASONING: Fix strategy — what needs to change, what should NOT change, risk assessment of the fix, rollback plan if fix fails.
     - OUTPUT: Specific fix plan with exact files, functions, and the intended change description. Also specifies which tests should be re-run to verify.

4. **Back to Implementer**:
   - The fix plan is provided back to the implementer.
   - The handoff event explicitly links: bug_report_span → bug_review_span → fix_plan_span → implementation_span.
   - The whole loop continues again.

5. **Completion**:
   - Once the E2E test fully passes, a completion report is produced containing:
     - The E2E report (full test output).
     - What the input was.
     - What the output was.
     - Why this is in line with the intended functionality.
     - A `loop_summary`: how many iterations, what bugs were found and fixed, total time elapsed.
     - A confidence assessment from the team lead.

### Logging Specification

All input, output, context, and interaction is logged and written out to:
`claude-teams/claude-teams-logs/YYYYMMDD-HHMMSS_[session_name]_agentteamlog.jsonl`

#### Trace Model (inspired by OpenTelemetry)

Every log line is a JSON object with these mandatory fields:

```json
{
  // TRACE IDENTITY
  "trace_id":       "uuid-v4",           // Unique per session (all agents share this)
  "span_id":        "uuid-v4",           // Unique per log event
  "parent_span_id": "uuid-v4 | null",    // Links to the triggering event (null for root)

  // WHO
  "agent":          "implementer",       // Agent name
  "role":           "implementer",       // Agent role category

  // WHEN
  "timestamp":      "ISO-8601",          // When this event occurred
  "sequence":       42,                  // Monotonic counter for ordering

  // WHAT
  "event_type":     "one of the types below",
  "phase":          "implement | test | review | fix",
  "task_id":        "1.2",              // Hierarchical task identifier

  // CONTENT (varies by event_type)
  "data":           { }
}
```

#### Event Types

All event types from the Plan workflow apply here, plus the following additional types:

**IMPLEMENTATION events:**
- `implementation_diff`:
  ```json
  {
    "file": "path/to/file",
    "changes": [
      { "line_start": 10, "line_end": 15, "old_code": "...", "new_code": "...", "reason": "..." }
    ]
  }
  ```

- `self_review`:
  ```json
  {
    "changes_reviewed": ["span_id_of_implementation"],
    "concerns": ["Area of uncertainty 1", "Area of uncertainty 2"],
    "confidence": 0.85,
    "ready_for_review": true
  }
  ```

**TEST events:**
- `test_execution`:
  ```json
  {
    "test_file": "path/to/test",
    "test_name": "test_xyz",
    "status": "pass|fail|error|skip",
    "duration_ms": 1234,
    "stdout": "...",
    "stderr": "...",
    "assertion_details": "..."
  }
  ```

**BUG CYCLE events:**
- `bug_report`: (see E2E Tester section above)

- `fix_cycle`:
  ```json
  {
    "iteration": 2,
    "bug_id": "BUG-1",
    "status": "investigating|fix_planned|fix_applied|verified|closed",
    "related_spans": ["span_id_1", "span_id_2"]
  }
  ```

- `loop_summary`:
  ```json
  {
    "total_iterations": 3,
    "bugs_found": 2,
    "bugs_fixed": 2,
    "bugs_remaining": 0,
    "total_duration_ms": 180000,
    "confidence": 0.95
  }
  ```

#### Streaming & Real-Time Monitoring

- Each event is appended to the JSONL file immediately when it occurs (flush after each write).
- `thinking_step` events stream in real-time so progress is visible during long reasoning.
- A companion viewer/parser can render the JSONL as:
  1. **Timeline view**: Chronological list of all events with agent color-coding.
  2. **Agent view**: Filter to one agent's full journey (context → thinking → output).
  3. **Flow view**: Mermaid diagram of handoffs showing data flow between agents.
  4. **Trace tree**: Hierarchical parent-child span tree (like a debugger call stack).
  5. **Conflict view**: All disagreements and their resolutions.

#### Log Readability Requirements

- Must be readable by a technical human scanning the raw JSONL.
- Every `content` and `thought` field uses plain English, not shorthand.
- Every reference to another agent's output includes the span_id for traceability.
- File references include path and line range.
