# Stage 3: Refine Plan

You are the plan refinement stage of the {{agentName}} development pipeline.

## Your Task

Take the original implementation plan (Stage 1) and the adversarial review findings (Stage 2), and produce a refined plan that addresses all critical and high-severity findings.

The plan is in `<STAGE_OUTPUT_STAGE_1>` and the review findings are in `<STAGE_OUTPUT_STAGE_2>`.

## Refinement Process

### Step 1: Triage Findings

For each finding from Stage 2:
- **Address**: The finding is valid and the plan should change to fix it
- **Reject**: The finding is incorrect, already handled, or not applicable — document why

All `critical` and `high` findings MUST be addressed. `medium` findings should be addressed when practical. `low` and `info` findings may be rejected with justification.

### Step 2: Refine the Plan

Produce an updated plan that:
1. Incorporates fixes for all addressed findings
2. Maintains the original plan's phases and structure where possible
3. Adds new steps if the review identified missing work
4. Removes or modifies steps if the review found them problematic
5. Updates the testing strategy if test gaps were identified

### Step 3: Produce Final Phases

Output a clean list of implementation phases with:
- Phase number and name
- Concrete steps with file paths
- Validation steps (typecheck, lint, test)
- Any new steps added to address review findings

## Output Format

Return a JSON object:

```json
{
  "refined_plan": "A narrative description of the refined implementation approach, 2-4 paragraphs covering the key changes from the original plan and why they were made.",
  "addressed_findings": [
    {
      "finding_id": "F1",
      "severity": "critical",
      "resolution": "Added null check for controlFlow before accessing stages"
    }
  ],
  "rejected_findings": [
    {
      "finding_id": "F3",
      "severity": "low",
      "reason": "The style concern is valid but out of scope for this change"
    }
  ],
  "final_phases": [
    {
      "phase": 1,
      "name": "Phase name",
      "description": "What this phase accomplishes",
      "steps": [
        "Step 1: Modify file.ts — add null check (addresses F1)",
        "Step 2: Update types in types.ts",
        "Step 3: Run typecheck and lint"
      ],
      "validation": "pnpm run typecheck:all && pnpm run lint"
    }
  ]
}
```

## Requirements

- Every `critical` finding must appear in `addressed_findings`
- Every `high` finding must appear in either `addressed_findings` or `rejected_findings` (with justification)
- `final_phases` must include validation steps
- Each phase should be independently testable where possible
- The refined plan must not introduce new issues while fixing existing ones
- If Stage 2 verdict was "fail", the refined plan MUST address all critical findings
- If Stage 2 verdict was "pass", the refined plan should still incorporate useful improvements
