# Investigation Report: ISA Deep Research Output Not Displayed in Chat

**Date:** 2026-02-20
**Status:** FIXED — 3 Root Causes Identified, 2 Fixes Implemented
**Severity:** P0 (Critical — output not displayed in chat)

---

## Executive Summary

The ISA Deep Research agent completes all 6 stages but the full research output is NOT displayed in the chat. Instead, a brief 2-line summary appears and the "Presenting final output" spinner remains stuck indefinitely. The investigation found **3 root causes**, with the most critical being a **bug introduced in the previous fix** that causes an infinite blocking loop.

---

## Root Cause 1 (CRITICAL — P0): File Existence Check Looks in Wrong Directories

### Evidence

**File:** `packages/session-tools-core/src/handlers/agent-stage-gate.ts:706-746`

The file existence check added in the previous implementation looks at:

```typescript
const candidatePaths = [
  join(ctx.plansFolderPath, fileName),
  // = ~/.craft-agent/workspaces/{id}/sessions/{sessionId}/plans/isa-research-output.md

  join(ctx.workspacePath, 'sessions', ctx.sessionId, fileName),
  // = ~/.craft-agent/workspaces/{id}/sessions/{sessionId}/isa-research-output.md
];
```

But the agent writes `./isa-research-output.md` relative to the **project root** (CWD), which resolves to:
```
C:\dev\deving\agentnative\isa-research-output.md
```

The path mismatch exists because:
- `ctx.workspacePath` = `~/.craft-agent/workspaces/{id}` (internal Craft Agent workspace, NOT the project directory)
- `ctx.plansFolderPath` = `~/.craft-agent/workspaces/{id}/sessions/{sessionId}/plans/` (session plans subfolder)
- Neither of these is the project root where the Copilot SDK's Write tool actually places files

**Proof from code:**
- `session-mcp-server/src/index.ts:217`: `workspacePath: workspaceRootPath` (set from `--workspace-root` CLI arg)
- `shared/src/agent/copilot-agent.ts:1019`: `'--workspace-root', workspaceRootPath` (Craft Agent workspace path)
- `shared/src/agent/base-agent.ts:169`: `this.workingDirectory = config.session?.workingDirectory ?? config.workspace.rootPath ?? process.cwd()` (agent CWD is the project root)

### Effect

Stage 5 completion is **ALWAYS blocked** because the file exists at the project root but the check never looks there. This creates an infinite retry loop:

1. Agent writes file to project root via Write tool
2. Agent calls `stage_complete(5, { output_file_path: './isa-research-output.md' })`
3. Stage gate checks plans folder and sessions folder — file not found
4. Returns `allowed: false` with blocking message
5. Agent tries to re-write and re-complete
6. Go to step 3 — **infinite loop**
7. "Presenting final output" spinner stays stuck

### Fix

**Option A (Recommended): Remove the file existence check entirely.** The check was well-intentioned but fundamentally broken because the SessionToolContext doesn't have access to the agent's CWD. The schema validation already ensures the `output_file_path` field is present. Lines 703-746 should be removed.

**Option B: Add `process.cwd()` as a candidate path.** This would fix the path mismatch but relies on the MCP server's CWD matching the agent's CWD (may not always be true).

---

## Root Cause 2 (SECONDARY): `isIntermediate` Flag Buries Agent Output in Activities

### Evidence

**File:** `packages/shared/src/agent/backend/copilot/event-adapter.ts:219-228`

```typescript
case 'assistant.message': {
  if (event.data.content && !this.hasEmittedFinalText) {
    const isIntermediate = !!(event.data.parentToolCallId || event.data.toolRequests?.length);
    //                      ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    //                      TRUE whenever the message includes tool calls alongside text

    this.hasEmittedFinalText = true;
    yield {
      type: 'text_complete',
      text: event.data.content,
      isIntermediate,  // <-- TRUE = buried in activities
    };
  }
```

When the agent produces its final research text AND calls `stage_complete` in the same message (which is the normal flow), `event.data.toolRequests?.length > 0` makes `isIntermediate = true`.

**File:** `packages/ui/src/components/chat/turn-utils.ts:579-623`

```typescript
if (message.isIntermediate || message.isPending) {
  // Added to activities as 'intermediate' type — NOT the primary response
  const intermediateActivity: ActivityItem = {
    id: message.id,
    type: 'intermediate',
    status: message.isPending ? 'running' : 'completed',
    content: message.content,
    // ...
  };
  currentTurn.activities.push(intermediateActivity);
  continue;
}
```

### Partial Mitigation Already Exists

**File:** `packages/ui/src/components/chat/turn-utils.ts:416-428`

There's a fallback that promotes the last intermediate text to the response:
```typescript
if (!interrupted && !hasPlan && !currentTurn.response && currentTurn.isComplete) {
  const lastTextActivity = [...currentTurn.activities]
    .reverse()
    .find(a => a.type === 'intermediate' && a.content);
  if (lastTextActivity?.content) {
    currentTurn.response = { text: lastTextActivity.content, isStreaming: false };
  }
}
```

But this only works when `currentTurn.isComplete = true` — which it NEVER is while the agent is stuck in RC1's infinite loop.

### Effect

Even if RC1 is fixed, the research text produced alongside tool calls gets classified as "intermediate" and buried in the collapsed activities panel rather than shown as the primary chat response. The fallback promotion would work **only after the turn completes**.

### Fix

After fixing RC1, the fallback at turn-utils.ts:416-428 should correctly promote the last intermediate text to the response. No additional code change needed for this specific mechanism.

However, if the LLM's text is a brief summary (see RC3), the promoted text is still just a summary.

---

## Root Cause 3 (TERTIARY): LLM Produces Brief Summary Instead of Full Research

### Evidence

The AGENT.md (lines 392-396) instructs:
> "Your response MUST contain the COMPLETE research output — not a summary, not a reference to the file, but the FULL formatted answer with all sections and citations inline"

But the actual output observed in the screenshot is:
> "Research complete. The full output has also been saved to isa-research-output.md."
> "Pipeline summary: 6 stages completed | 5 ISA standards analyzed | 65+ paragraphs retrieved | 13 citations verified | 0 contradictions found"

The LLM rationally summarizes rather than reproducing a 10K+ word document inline. This is a fundamental limitation: prompt instructions to "include everything" conflict with the LLM's training to be concise and not repeat content that's already been saved to a file.

### Fix

**Recommended: Auto-render the output file in the chat.** Instead of relying on the LLM to reproduce the full text inline, the system should:

1. When Stage 5 completes with `output_file_path`, read the file contents
2. Emit the file contents as a `text_complete` event with `isIntermediate: false`
3. This becomes the primary response shown in the chat

Implementation location: The `onAgentEvent` callback in the stage gate handler can trigger this. When a `stage_output_file_verified` event fires, read the file and inject its contents.

Alternative: Add a `DocumentCard` component that auto-renders when `output_file_path` is detected in the final response text. The UI already has `DocumentFormattedMarkdownOverlay` for full-page reading.

---

## Event Flow Diagram

```
Normal flow (what SHOULD happen):
  Agent writes ./isa-research-output.md → project root
  Agent calls stage_complete(5, { output_file_path: './isa-research-output.md' })
  Stage gate validates schema ✓
  Stage gate checks file exists ✓
  Stage gate returns allowed: true
  Agent emits final text
  UI shows response

What ACTUALLY happens:
  Agent writes ./isa-research-output.md → project root  ✓
  Agent calls stage_complete(5, { output_file_path: './isa-research-output.md' })
  Stage gate validates schema ✓
  Stage gate checks file exists:
    Check 1: ~/.craft-agent/.../plans/isa-research-output.md  ✗ (not here)
    Check 2: ~/.craft-agent/.../sessions/{id}/isa-research-output.md  ✗ (not here)
  Stage gate returns allowed: false  ← BUG
  Agent retries → same result → infinite loop
  "Presenting final output" spinner stuck forever
```

---

## Recommended Implementation Plan

### Phase 1: Remove File Existence Check (P0 — fixes stuck spinner)

**File:** `packages/session-tools-core/src/handlers/agent-stage-gate.ts`
**Action:** Remove lines 703-746 (the entire post-validation file existence check block)
**Risk:** Low — schema validation still enforces the field presence
**Tests:** Update E2E tests to remove `writeStage5OutputFile()` helper calls (no longer needed)

### Phase 2: Auto-Inject Output File Content (P1 — shows full report)

**File:** `packages/shared/src/agent/backend/copilot/event-adapter.ts` or `copilot-agent.ts`
**Action:** When `stage_complete` tool returns success for Stage 5 with `output_file_path`:
1. Read the file from disk (resolve relative to CWD)
2. Emit a `text_complete` event with the file contents as `isIntermediate: false`
3. This becomes the primary response in the chat

**Alternative approach (simpler):** Modify the stage gate handler's return value for Stage 5 to include the file contents in the result, which the agent can then emit.

### Phase 3: Update E2E Tests

- Remove `writeStage5OutputFile()` from test files
- Remove `e2e-stage5-output-verification.test.ts` (or update to test the new behavior)
- Add new test: Stage 5 completion triggers file content injection

---

## Files Analyzed

| File | Lines Read | Key Finding |
|------|-----------|-------------|
| `agent-stage-gate.ts` | 690-770 | File existence check looks in wrong paths |
| `event-adapter.ts` | 1-652 (full) | `isIntermediate` flag buries text with tool calls |
| `turn-utils.ts` | 1-1201 (full) | Intermediate text promotion fallback exists but requires `isComplete` |
| `context.ts` | 1-406 (full) | `workspacePath` is Craft Agent internal path, not project root |
| `copilot-agent.ts` | 740-755, 1005-1025 | Confirms workspacePath != workingDirectory |
| `base-agent.ts` | 165-182 | `workingDirectory` = project root (CWD) |
| `session-mcp-server/index.ts` | 210-228 | Context uses `workspaceRootPath` (internal), not project root |
| `config.json` | Full | Stage 5 schema with `enforcement: "block"` |
| `AGENT.md` | 386-447 | Stage 5 instructions require COMPLETE inline + file |
| `sessions/storage.ts` | 125-129 | `plansFolderPath` = workspace/sessions/{id}/plans |
