# Agent Team Workflow: Research and Plan Team

Create a team of agents

## Feature Description

XXX

## Output file: plan.md

## Phase 1: Plan

Goal: Create a team of agents to automate the proper development of a plan to implement the feature described above. plan.md is the main reference document on how this repository is set up.

### Prerequisites

- Ensure that you are on the right branch or create a new git branch for this feature.

### The Team

Team Lead (1 member):
- Orchestrates the workflow and manages agent-to-agent handoffs.
- Maintains the shared context ledger: a structured accumulation of all findings, decisions, and open questions across the team.
- Decides routing: which outputs go to which agents, in what order.
- Writes the session_start and session_end events.

Researchers (2 members):
- Each receives the feature description + shared context ledger.
- Carefully research the code structure and propose plans.
- Must log:
  - CONTEXT_RECEIVED: The exact input bundle they were given (feature desc, file list, prior findings if any).
  - REASONING: Their step-by-step thinking as they analyze the codebase — what they looked at, what they considered, what they ruled out, and why.
  - OUTPUT: The full unabridged research findings, not a summary.
  - CONFIDENCE: A self-assessed confidence score (0-1) for each finding, with justification.

Adversarial Reviewers (4 members), each with a different focus:
1. Structure Compliance — Whether plan.md is properly considered and the plan follows the existing structure and requirements.
2. Best Practices — Searches 3 best practices online and compares the gaps against those.
3. Technical Integration — Focuses on integration of the code throughout the codebase.
4. Debuggability — Whether debugging is properly included so that proper debugging can be executed afterwards.

Each reviewer MUST:
- Log CONTEXT_RECEIVED: The exact research outputs they are reviewing (from which researcher, which specific findings).
- Log INTERPRETATION: How they understood and interpreted the input — their own restatement of what was proposed, to verify comprehension before critiquing.
- Log REASONING: Their evaluation logic — what they checked, what passed, what failed, and the evidence/rationale for each judgment.
- Log OUTPUT: Full review with structured verdicts (PASS/FAIL/WARNING per item), gaps identified with severity (CRITICAL/IMPORTANT/MODERATE/LOW), and specific recommendations.
- Log DISSENT: If they disagree with another reviewer's findings (cross-referenced by span_id), they must state what they disagree with and why.

Synthesizer (1 member):
- Receives ALL outputs from researchers and ALL outputs from reviewers.
- Logs CONTEXT_RECEIVED: The complete input bundle (all research + all reviews).
- Logs INTERPRETATION: A structured summary of agreements, disagreements, and unresolved tensions across the team.
- Logs REASONING: How they resolved conflicts — which researcher's approach was chosen and why, how each gap was addressed or why it was deprioritized.
- Logs OUTPUT: The full synthesized plan.
- Presents the full plan back to the user.
- Asks if it can write the plan to plan.md so it can serve as the implementation plan to be picked up.

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
  "agent":          "researcher-1",      // Agent name
  "role":           "researcher",        // Agent role category

  // WHEN
  "timestamp":      "ISO-8601",          // When this event occurred
  "sequence":       42,                  // Monotonic counter for ordering

  // WHAT
  "event_type":     "one of the types below",
  "phase":          "plan | implement | test | review",
  "task_id":        "1.2",              // Hierarchical task identifier

  // CONTENT (varies by event_type)
  "data":           { }
}
```

#### Event Types

**SESSION events (Team Lead only):**
- `session_start`: Team composition, feature goal, branch, files to analyze.
- `session_end`: Summary, total duration, total agents, outcome.

**CONTEXT events (every agent, every turn):**
- `context_received`:
  ```json
  {
    "source_spans": ["span_id_1", "span_id_2"],
    "input_documents": [
      { "type": "feature_description", "content": "..." },
      { "type": "agent_output", "from_agent": "researcher-1", "from_span": "...", "content": "..." },
      { "type": "file_content", "path": "...", "lines": "1-50", "content": "..." }
    ],
    "context_summary": "Agent's own 2-3 sentence summary of what they received"
  }
  ```

**REASONING events (every agent, every turn):**
- `thinking_started`: `{ "task": "description of what agent is about to reason about" }`
- `thinking_step`:
  ```json
  {
    "step_number": 1,
    "thought": "Full chain-of-thought text for this reasoning step",
    "evidence": ["file:path/to/file.ts#L10-L50", "prior_finding:span_id_xyz"],
    "conclusion": "What this step determined",
    "confidence": 0.85,
    "alternatives_considered": ["Alternative A and why rejected", "Alternative B and why rejected"]
  }
  ```
- `thinking_complete`:
  ```json
  {
    "total_steps": 5,
    "final_reasoning_summary": "...",
    "overall_confidence": 0.82
  }
  ```

**OUTPUT events (every agent, every turn):**
- `output_produced`:
  ```json
  {
    "output_type": "research_findings | review_verdict | synthesized_plan",
    "content": "FULL UNABRIDGED OUTPUT — never summarized in the log",
    "structured_data": { },
    "confidence": 0.85,
    "open_questions": ["Question 1", "Question 2"],
    "dependencies": ["span_id of outputs this builds on"]
  }
  ```

**HANDOFF events (Team Lead):**
- `handoff`:
  ```json
  {
    "from_agent": "researcher-1",
    "from_span": "span_id",
    "to_agent": "reviewer-compliance",
    "to_task": "Review research findings for plan.md compliance",
    "payload_spans": ["span_id_1", "span_id_2"],
    "routing_reason": "Why this output goes to this agent"
  }
  ```

**INTERPRETATION events (receiving agent):**
- `input_interpreted`:
  ```json
  {
    "source_spans": ["span_id_1"],
    "interpretation": "My understanding of what was proposed: ...",
    "key_claims_extracted": [
      { "claim": "Stage gate handler is fully data-driven", "source_span": "...", "agree": true },
      { "claim": "Only config.json needs changes", "source_span": "...", "agree": false,
        "dissent_reason": "AGENT.md also needs changes" }
    ],
    "questions_for_source": ["Clarification question 1"]
  }
  ```

**REVIEW events (reviewers):**
- `review_verdict`:
  ```json
  {
    "items_reviewed": [
      { "item": "Description", "verdict": "PASS|FAIL|WARNING", "evidence": "...", "severity": "CRITICAL|HIGH|MODERATE|LOW" }
    ],
    "gaps": [
      { "id": "GAP-1", "severity": "CRITICAL", "description": "...", "recommendation": "...",
        "affects_spans": ["span_id"] }
    ],
    "cross_references": [
      { "other_reviewer": "reviewer-best-practices", "other_span": "...",
        "relationship": "agrees|disagrees|extends", "detail": "..." }
    ]
  }
  ```

**DECISION events (Synthesizer / Team Lead):**
- `conflict_resolved`:
  ```json
  {
    "conflict": "Description of the disagreement",
    "positions": [
      { "agent": "researcher-1", "span": "...", "position": "..." },
      { "agent": "reviewer-compliance", "span": "...", "position": "..." }
    ],
    "resolution": "Which position was adopted and why",
    "confidence": 0.9
  }
  ```

**ERROR / RETRY events:**
- `error`: `{ "message": "...", "stack": "...", "recoverable": true }`
- `retry`: `{ "original_span": "...", "reason": "...", "attempt": 2 }`

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
- The synthesizer's final `output_produced` event contains the COMPLETE plan — a human reading only that one event should understand the full plan.
