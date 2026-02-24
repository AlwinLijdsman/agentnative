# Deep Bug Debate: ISA Deep Research Output Presentation

> **Date:** 2026-02-20
> **Bug:** ISA deep research pipeline output is not nicely presented in the UI; user wants formatted output + clickable .md file link
> **Team:** moderator, investigator-1 through investigator-5
> **Sessions Analyzed:** 260220-prime-falls, 260220-cool-hill, 260220-high-meadow, 260220-calm-clay
> **SEB Entries:** 31+ findings across all investigators

---

## Executive Summary

The ISA deep research agent's output presentation failure is **NOT a UI/renderer bug**. The Electron app's markdown renderer (react-markdown + remarkGfm, TurnCard/ResponseCard components) fully supports rich formatted output including tables, headings, code blocks, and file links.

The bug is a **compound failure of 3 independent root causes**:

1. **Agent LLM non-determinism in Stage 5** -- The agent sometimes follows Stage 5 output instructions (file write + rich inline content) and sometimes skips them entirely
2. **Non-blocking stage gate validation** -- The pipeline's output schema validation logs warnings but never blocks completion, allowing the agent to skip all required output actions
3. **Latent file link regex mismatch** -- Even when the output file IS written, the AGENT.md-instructed bare filename reference is not detected as clickable by the UI's FILE_PATH_REGEX

---

## Evidence Base

### Session Comparison: prime-falls vs cool-hill

| Aspect | 260220-prime-falls (FAILED) | 260220-cool-hill (SUCCESS) |
|--------|---------------------------|---------------------------|
| Pipeline stages completed | All 6 (0-5) | All 6 (0-5) |
| Stage 5 tool calls | **ZERO** | Write (x2), agent_state, Read |
| isa-research-output.md created | **NO** | YES (414 lines, 14 sections) |
| Final assistant message | 445 chars, 2-sentence summary | ~2800 chars with tables + ISA references |
| Stage 5 completion data fields | output_delivered, sections, kb_limitation_noted | answer_delivered, output_file_path, state_updated |
| Validation warnings | "answer_delivered: required field missing" | None for Stage 5 |
| File reference in response | **NO** | YES (but not clickable -- see RC3) |

### Key Evidence Points

**Prime-falls session.jsonl structure (31 lines):**
- Lines 1-11: User query, Stage 0 (analyze), pause, resume
- Lines 12-22: Stage 1 (websearch), pause, resume, Stage 2 (retrieve) with ISA KB searches
- Lines 23-29: Stages 3-5 (synthesize, verify, output) -- stage gate calls only, no Write/state tools
- Line 30: Final assistant message -- 445 chars, brief summary

**Cool-hill session.jsonl (55 lines):**
- Line 49: Write to workspace root BLOCKED by Explore mode
- Line 50: Write to `{{SESSION_PATH}}/plans/isa-research-output.md` SUCCEEDED
- Line 54: Final assistant message with rich formatted tables and key takeaways

### Stage Gate Validation Warnings (prime-falls)

Every single stage in prime-falls had validation warnings for missing required fields:

| Stage | Warning |
|-------|---------|
| 0 (Analyze) | `query_plan: required field missing` |
| 1 (Websearch) | `websearch_calibration: required field missing` |
| 2 (Retrieve) | `total_paragraphs_found`, `unique_after_dedup`, `standards_covered` missing |
| 3 (Synthesize) | `synthesis: required field missing`, `citations_used: required field missing` |
| 4 (Verify) | `verification_scores: required field missing`, `all_passed: required field missing` |
| 5 (Output) | `answer_delivered: required field missing` |

All were logged but **none blocked pipeline progression**. The stage gate returned `allowed: true` for every subsequent stage.

---

## Root Cause Analysis

### RC1: Agent LLM Non-Determinism in Stage 5

**Severity: HIGH | Status: UNFIXED**

The AGENT.md Stage 5 instructions (lines 373-430) specify 5 requirements:
1. Write complete formatted answer as `isa-research-output.md`
2. Include metadata header with run ID and date
3. Reference the file path in the response to the user
4. Include `output_file_path` in Stage 5 completion data
5. Update accumulated state via `agent_state`

In prime-falls, **all 5 were skipped**. In cool-hill, **all 5 were met**. Same agent definition, same model (claude-opus-4-6), different behavior. The agent also used incorrect field names (`output_delivered` instead of `answer_delivered`).

**Contributing factors:**
- The AGENT.md Stage 5 section uses "should" language in some places instead of "MUST"
- The instructions mix file-writing with inline-output without being explicit that BOTH are required
- No concrete examples of what the final assistant message should look like

### RC2: Non-Blocking Stage Gate Validation

**Severity: HIGH | Status: UNFIXED**

The `stageOutputSchemas` in `config.json` define required fields for each stage's completion data. The stage gate validates these and logs warnings, but validation failures do NOT prevent stage completion. This means:

- The agent can submit incomplete data and the pipeline continues
- Critical output actions (file write, state update) have no programmatic enforcement
- The `answer_delivered` field being missing in Stage 5 is a direct signal that the output was not properly delivered, yet the pipeline allows completion

**Evidence path:** `agents/isa-deep-research/config.json` lines 88-111 (stageOutputSchemas), `packages/shared/src/agent/` (stage gate implementation)

### RC3: Latent FILE_PATH_REGEX Mismatch

**Severity: MEDIUM | Status: UNFIXED (latent)**

The UI's `Markdown.tsx` component has a `FILE_PATH_REGEX` (line 73-74) that detects file paths in rendered text and makes them clickable via `onFileClick`. The regex requires paths to start with `/`, `~/`, or `./` followed by path segments.

The AGENT.md instructs the agent to write: *"The full research output has been saved to `isa-research-output.md`."* This is a bare filename in a backtick code span -- it does NOT match the regex pattern. Even in the cool-hill success case where the file was written, the reference was NOT clickable in the UI.

**Evidence path:** `packages/ui/src/components/markdown/Markdown.tsx:73-74`, `agents/isa-deep-research/AGENT.md:406`

---

## Eliminated Hypotheses

| Hypothesis | Evidence Against | Eliminated By |
|------------|-----------------|---------------|
| Renderer doesn't support rich markdown | ResponseCard uses react-markdown + remarkGfm, supports tables, headings, code blocks | investigator-1 (F1-codepath-02), investigator-5 (AC5-04) |
| 540px max-height hides content | Fullscreen expand button exists (Maximize2 icon) | investigator-1 (F1-codepath-03) |
| Outer agent summarizes/filters output | ISA agent IS the primary agent, no relay layer | investigator-5 (AC5-05), moderator (SEB-006) |
| Stage gate bypass prevents Stage 5 | Prime-falls completed all 6 stages; stage bypass was a different bug, now fixed | moderator (MOD-SEB-003) |

---

## Recommended Fixes

> **Critical insight (investigator-5):** The cool-hill session proves the current AGENT.md instructions ARE sufficient when the LLM follows them. This means prompt-level fixes alone are unreliable -- the same instructions produce compliant behavior in one run and non-compliant behavior in another. **The primary fix must be programmatic enforcement in the stage gate**, not prompt strengthening. Prompt changes are belt-and-suspenders only.

### P0: Programmatic Enforcement (only reliable fix for non-determinism)

**Fix 1: Make Stage 5 `output_file_path` + `answer_delivered` validation BLOCKING**

In the stage gate handler, when Stage 5 completes, check:
- `data.answer_delivered` is exactly `true`
- `data.output_file_path` is present and non-empty

If either is missing, return `allowed: false` with a clear message instructing the agent to write the output file and include the full research in its response. This turns non-deterministic LLM compliance into deterministic system enforcement.

**Fix 2: Add configurable enforcement mode to stageOutputSchemas**

Add an `enforcement` field to each stage's output schema:
```json
{
  "stage5": {
    "required": ["answer_delivered", "output_file_path"],
    "enforcement": "block"  // "warn" or "block"
  }
}
```

This makes the fix systemic -- any stage can have blocking validation, not just Stage 5.

### P1: Latent File Link Bug Fix

**Fix 3: Change file reference to use relative path prefix**

In AGENT.md line 406, change:
```
"The full research output has been saved to `isa-research-output.md`."
```
To:
```
"The full research output has been saved to [./isa-research-output.md](./isa-research-output.md)."
```

This makes the path match `FILE_PATH_REGEX` (which requires `./` prefix) AND renders it as a clickable markdown link.

### P2: Belt-and-Suspenders (prompt strengthening)

**Fix 4: Strengthen AGENT.md Stage 5 instructions**

Add explicit MUST language and a concrete example of what the final message should contain. This reduces the frequency of non-compliance but cannot eliminate it -- hence P2, not P0:

```markdown
## Stage 5: Output & Visualization

**CRITICAL REQUIREMENTS (all MUST be satisfied):**

1. Your final assistant response MUST include the COMPLETE formatted research output
   with all sections, tables, citations, and verification summary. Do NOT summarize.
   The user expects to read the full research in the chat window.

2. You MUST also write the complete output to a markdown file using the Write tool.
   Save to: `./isa-research-output.md` (relative to working directory)

3. After writing the file, you MUST reference it with the full relative path:
   "The full research output has been saved to [./isa-research-output.md](./isa-research-output.md)."
   Use a markdown link, NOT a backtick code span.

4. Your Stage 5 completion data MUST include `answer_delivered: true` and
   `output_file_path: "isa-research-output.md"`.
```

### P3: Stretch Goals

**Fix 5: Post-Stage 5 file existence check**

After the agent completes Stage 5, the stage gate handler can check whether `isa-research-output.md` actually exists in the session's plans folder. If not, return a repair instruction.

**Fix 6: Auto-render research output in UI**

When the agent pipeline completes, the renderer could detect the output file and display it in a dedicated panel (like a document viewer) rather than relying solely on the chat message.

**Fix 7: Extend FILE_PATH_REGEX**

Modify the regex in `Markdown.tsx` to also match bare filenames with common extensions (`.md`, `.pdf`, `.txt`) even without a path prefix. This would catch references like `` `isa-research-output.md` ``.

---

## Convergence Assessment

**Convergence achieved:** 5 of 6 investigation threads (moderator + inv-1 + inv-2 + inv-3 + inv-5) independently reached the same conclusions. No contradicting hypotheses remain.

**Key agreement points:**
- The renderer is NOT the problem (unanimous across all 5 reporters)
- Agent behavior is the primary cause (unanimous)
- Non-blocking validation is a contributing factor (4/5 threads)
- File link regex is a latent bug (4/5 threads)
- The 3-failure-mode decomposition is accepted (all reporting threads)
- **Post-convergence refinement (inv-5):** Cool-hill success proves prompt fixes are insufficient; programmatic enforcement in stage gate is the only reliable fix for LLM non-determinism. Fix priorities re-ordered accordingly (P0 = blocking validation, P2 = prompt strengthening).

**Dissenting or pending views:**
- Investigator-4 had not posted findings at time of convergence declaration
- No dissenting views were raised by any investigator

---

## Files Referenced

| File | Role |
|------|------|
| `agents/isa-deep-research/AGENT.md:373-430` | Stage 5 output instructions |
| `agents/isa-deep-research/config.json:88-111` | stageOutputSchemas with required fields |
| `packages/ui/src/components/markdown/Markdown.tsx:73-74` | FILE_PATH_REGEX |
| `packages/ui/src/components/chat/TurnCard.tsx:1301,1319-1576` | ResponseCard with 540px max-height |
| `sessions/260220-prime-falls/session.jsonl` | Failed output session |
| `sessions/260220-cool-hill/session.jsonl` | Successful output session |
| `sessions/260220-cool-hill/plans/isa-research-output.md` | Successfully written research output (414 lines) |
| `sessions/260220-prime-falls/data/agents/isa-deep-research/agent-events.jsonl` | Stage gate events with validation warnings |

---

## SEB Evidence Trail

All forensic findings are logged in:
`claude-teams/deep-bug-debate/SEB-output-presentation.jsonl`

Key SEB entries by investigator:
- **Moderator:** MOD-SEB-001 through MOD-SEB-004 (session forensics, 3 failure modes, hypothesis scoreboard)
- **Investigator-1:** F1-codepath-01 through F1-codepath-05, H1-codepath-01 (code path tracing, file link regex discovery)
- **Investigator-2:** F2-archaeology-01 through F2-archaeology-08, H2-archaeology-01 (team log archaeology, root cause chain)
- **Investigator-3:** F3-dataflow-01 through F3-dataflow-08, H3-dataflow-01 (data flow analysis, file existence verification, ContentBadge limitation)
- **Investigator-5:** AC5-01 through AC5-08 (adversarial challenges, root cause decomposition, fix recommendations)
