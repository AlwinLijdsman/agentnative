# Plan: Fix Dev-Loop Workflow — Attachment Injection + Resume Intent Handling (v2)

> Fixes dev-loop workflow smoothness issues from session 260302-nimble-canyon.
> Addresses all adversarial review findings F1-F7.
> Prior plan archived to: `plans/260302-dev-loop-agent-pipeline.md`
>
> Status markers: `[ ]` pending | `[x]` done | `[~]` in progress | `[-]` skipped

---

## Goal

Fix the three cascading issues that made the dev-loop workflow in session 260302-nimble-canyon "not smooth": orchestrator attachment blindness, non-functional amend/cancel, and lost original context on re-run. Minimal, targeted changes across 7 files.

## Analysis

### Root Cause (session 260302-nimble-canyon)

```
chat(userMessage, attachments)
  -> runOrchestrator(userMessage)        // attachments LOST here
    -> orchestrator.run(userMessage)     // Stage 0 LLM sees text only
      -> Stage 0 output: "Read plan.md" // Wrong -- plan was in attachment
```

User selected "2. Amend" but the pipeline just advanced to Stage 1 instead of re-running Stage 0. The amend/cancel options in pauseInstructions are non-functional -- `parseResumeIntent()` only handles ISA websearch skip.

### Adversarial Review Findings Incorporated

| Finding | Issue | Resolution |
|---------|-------|------------|
| **F1** (Critical) | Amend re-run loses original context -- `resume()` gets `userResponse`, not original `userMessage` | Store `originalUserMessage` in `PipelineState`. Amend re-run uses `originalUserMessage + amendment` |
| **F2** (High) | `clearStageOutput` violates immutability + workspace metadata condition | Don't clear output. Pass `forceWorkspaceMetadata: true` to `runPromptDrivenStage` on amend re-runs |
| **F3** (High) | Auto-execute SDK breakout removes intentional user control point | **Dropped Phase 4 from v1 entirely.** The extra turn is a feature, not a bug |
| **F4** (Medium) | Resume path attachments are `undefined` in practice | Only embed attachments in `runOrchestrator()` (initial run). Amend re-run uses stored `originalUserMessage` |
| **F5** (Medium) | Resume intent parsing conflicts with ISA skip logic | Gate `parseGenericResumeAction()` to only run when `pauseChoices` are configured. ISA agents have no `pauseChoices` |
| **F6** (Medium) | Duplicate events on re-run break audit integrity | Add `uniqueCompletedStages` dedup helper. Raw events preserved for full audit |
| **F7** (Low) | `FileAttachment.text` already available | Check `attachment.text` first, then fall back to `readFileSync(storedPath)` |

## Key Files

| File | Role |
|------|------|
| `packages/shared/src/agent/orchestrator/pipeline-state.ts` | Add `originalUserMessage` field + `uniqueCompletedStages` dedup helper |
| `packages/shared/src/agent/orchestrator/index.ts` | Resume intent routing (amend/cancel), pass originalUserMessage to PipelineState |
| `packages/shared/src/agent/orchestrator/types.ts` | Add `'amended'`/`'cancelled'` to StageEventType, add `ResumeAction` type, add `pauseChoices` to StageConfig |
| `packages/shared/src/agent/orchestrator/stage-runner.ts` | Add `forceWorkspaceMetadata` option to `runPromptDrivenStage()` |
| `packages/shared/src/agent/claude-agent.ts` | Embed attachment content in `runOrchestrator()` userMessage |
| `packages/shared/src/agents/types.ts` | Add `pauseChoices` to StageDefinition |
| `agents/dev-loop/config.json` | Add `pauseChoices` arrays to Stage 0 and Stage 3 |

---

## System Prompt Architecture

`packages/shared/src/prompts/system.ts` generates the **base SDK system prompt** for every conversation turn. This is **separate from orchestrator stage prompts** (those are built by `stage-runner.ts`).

Assembly order (all concatenated):
1. `getCraftAssistantPrompt()` — identity, sources, permissions, interaction guidelines (**mostly hardcoded strings**)
2. `formatAgentsSection()` — dynamically calls `loadWorkspaceAgents()` every invocation; reads `agents/*/AGENT.md` + `config.json` live from disk
3. `formatPreferencesForPrompt()` — `~/.craft-agent/preferences.json`
4. `formatDebugModeContext()` — dev build only (log file path, query guide)
5. `getProjectContextFilesPrompt()` — `glob('**/{agents,claude}.md', cwd: workingDirectory)`

**What this means for plans:**
- Editing `agents/dev-loop/AGENT.md` frontmatter or `config.json` → changes reflected in system prompt automatically (no code change needed)
- Changing core persona, guidelines, or permission mode descriptions → requires editing `system.ts` directly
- The orchestrator stage prompts (Stage 0–6 LLM calls) are **not** this prompt — they come from `stage-runner.ts → StageRunner.getStagePrompt()`
- Plans that change stage behavior should target `stage-runner.ts` / `agents/dev-loop/config.json`, not `system.ts`

---

## Phases

### Phase 1: Store Original UserMessage in PipelineState

**Addresses: F1 (Critical) -- amend re-run can access original context**

- [x] 1.1 Add `readonly originalUserMessage?: string` property to `PipelineState` class (`pipeline-state.ts:54-76`)
- [x] 1.2 Add `originalUserMessage?: string` to the private constructor (`pipeline-state.ts:82-96`) -- 7th parameter
- [x] 1.3 Add `originalUserMessage?: string` parameter to `PipelineState.create()` (`pipeline-state.ts:98-101`), pass to constructor
- [x] 1.4 Add `readonly originalUserMessage?: string` to `PipelineStateSnapshot` interface (`pipeline-state.ts:36-48`)
- [x] 1.5 Include `originalUserMessage` in `toSnapshot()` spread (`pipeline-state.ts:502-516`): `...(this.originalUserMessage ? { originalUserMessage: this.originalUserMessage } : {})`
- [x] 1.6 Pass `snapshot.originalUserMessage` in `fromSnapshot()` constructor call (`pipeline-state.ts:521-534`)
- [x] 1.7 Thread through all immutable mutation methods (`addEvent`, `setStageOutput`) -- they must propagate `originalUserMessage` to the new PipelineState instance
- [x] 1.8 In `AgentOrchestrator.run()` (`index.ts:~278`), pass `userMessage` to `PipelineState.create()`: `PipelineState.create(this.sessionId, agentConfig.slug, this.previousSessionId, userMessage)`
- [x] 1.9 Validate: `pnpm run typecheck:all`

### Phase 2: Embed Attachment Content in Orchestrator UserMessage

**Addresses: F4 (Medium) -- initial run only, F7 (Low) -- check text field first**

- [x] 2.1 Add `attachments?: FileAttachment[]` parameter to `runOrchestrator()` signature (`claude-agent.ts:4606`)
- [x] 2.2 Add private helper `embedAttachmentContext(userMessage: string, attachments?: FileAttachment[]): string` in `claude-agent.ts`
- [x] 2.3 Call `embedAttachmentContext()` in `runOrchestrator()` before `orchestrator.run()`
- [x] 2.4 Pass `enrichedMessage` to `orchestrator.run()` instead of `userMessage`
- [x] 2.5 Pass `attachments` from `chat()` call site at line 1151
- [x] 2.6 Do NOT add attachments to `resumeOrchestrator()` -- per F4
- [x] 2.7 Validate: `pnpm run typecheck:all`

### Phase 3: Generalize Resume Intent Parsing

**Addresses: F5 (Medium) -- gated to agents with `pauseChoices`**

- [x] 3.1 Add `ResumeAction` type to `types.ts`
- [x] 3.2 Add `pauseChoices?: string[]` to `StageConfig` in `types.ts`
- [x] 3.3 Add `pauseChoices?: string[]` to `StageDefinition` in `agents/types.ts`
- [x] 3.4 Thread `pauseChoices` through `toOrchestratorAgentConfig()` in `claude-agent.ts`
- [x] 3.5 Add exported `parseGenericResumeAction()` in `index.ts` with F5 guard, numeric/keyword matching, and conservative default
- [x] 3.6 Validate: `pnpm run typecheck:all`

### Phase 4: Implement Amend Re-run and Cancel in resume()

**Addresses: F1 (Critical) -- uses stored originalUserMessage, F2 (High) -- no clearStageOutput, F6 (Medium) -- dedup**

- [x] 4.1 Add `'amended'` and `'cancelled'` to `StageEventType` union
- [x] 4.2 Add generic resume action parsing in `resume()` with pauseChoices gate
- [x] 4.3 Add cancel path: record event, save, yield complete, return
- [x] 4.4 Add amend path: record event, build re-run message with originalUserMessage, re-run from paused stage
- [x] 4.5 Update `isPaused` getter to resolve on `'amended'` and `'cancelled'`
- [x] 4.6 Add `uniqueCompletedStages` getter with Set-based dedup
- [x] 4.7 Update `generateSummary()` to use `uniqueCompletedStages`
- [x] 4.8 Update `completedStageCount` to use `uniqueCompletedStages.length`
- [x] 4.9 Validate: `pnpm run typecheck:all`

### Phase 5: Force Workspace Metadata on Amend Re-run

**Addresses: F2 (High) -- workspace metadata condition at stage-runner.ts:1279**

- [x] 5.1 Add optional `forceWorkspaceMetadata?: boolean` parameter to `runStage()` method and thread to `runPromptDrivenStage()`
- [x] 5.2 Update workspace metadata condition to include `forceWorkspaceMetadata` (F2)
- [x] 5.3 Detect amend re-run in `executePipeline()` pause-after path and pass `{ forceWorkspaceMetadata: true }`
- [x] 5.4 Validate: `pnpm run typecheck:all` PASS, lint on modified files PASS (pre-existing errors in unrelated files)

### Phase 6: Configure Dev-Loop Agent

- [x] 6.1 Add `pauseChoices` to Stage 0 config in `agents/dev-loop/config.json`
- [x] 6.2 Add `pauseChoices` to Stage 3 config in `agents/dev-loop/config.json`
- [x] 6.3 Verify: config is valid JSON, pauseChoices threaded via `toOrchestratorAgentConfig`

### Phase 7: Tests & Validation

- [x] 7.1 Unit tests for `parseGenericResumeAction()`: 26 tests (F5 guard, numeric, keyword, default)
- [-] 7.2 Unit tests for `embedAttachmentContext()`: private method — deferred to manual testing
- [x] 7.3 Unit tests for `PipelineState.originalUserMessage`: 8 tests (create, snapshot, mutations)
- [-] 7.4 Integration test: amend re-run flow: Requires full orchestrator mock — deferred to manual
- [-] 7.5 Integration test: cancel flow: Same — deferred to manual
- [x] 7.6 Unit test: `uniqueCompletedStages` dedup: 4 tests (empty, single, dedup, sorted)
- [x] 7.7 Regression test: ISA resume (no pauseChoices) → 'proceed': covered in F5 guard
- [x] 7.8 Final validation: typecheck PASS, lint PASS, 445 orchestrator tests PASS (39 new, 0 regressions)

---

## Risks & Considerations

| Risk | Mitigation |
|------|------------|
| Large text attachments bloating orchestrator context | 20KB cap per attachment in `embedAttachmentContext()`. Truncation notice shown. |
| Amend re-run adding duplicate events to audit log | Append-only preserved. `uniqueCompletedStages` dedup helper for derived properties only. Raw events remain for full audit trail. |
| `parseGenericResumeAction` misclassifying free-form text | Gated by `pauseChoices` config -- only active when agent explicitly opts in. ISA agents never affected. Conservative default is proceed. |
| `originalUserMessage` increasing PipelineState JSON size | Single string field. For most messages <1KB. Attachment-enriched messages up to ~60KB (3 x 20KB cap). Acceptable for JSON state file. |
| Amend re-run workspace metadata stale | `gatherWorkspaceMetadata()` reads live from disk on every call -- always fresh. |
| `FileAttachment.text` field may not be populated for all text files | Check `text` first, then `storedPath` fallback. Guard both with undefined checks. |

## What Was Dropped (from v1)

**Phase 4 from v1 (Auto-Execute SDK Breakout Without Extra Turn)** was removed entirely per adversarial finding F3. The "Send any message to start execution" prompt is an intentional user control point that allows the user to:
1. Add context before SDK breakout runs
2. Change permission mode (e.g., Explore -> Execute)
3. Cancel if the orchestrator plan looks wrong

The extra turn is a feature, not a bug. It stays.

## Testing Strategy

- [x] `pnpm run typecheck:all` -- TypeScript strict mode passes
- [x] `pnpm run lint` -- ESLint passes on modified files (pre-existing errors in unrelated files)
- [x] `pnpm run test` -- 445 orchestrator tests pass, 0 regressions. 39 new tests added.
- [ ] Manual: invoke dev-loop with .txt attachment -> Stage 0 should see attachment content in scope assessment
- [ ] Manual: select "2. Amend" at Stage 0 pause -> stage should re-run with original message + amendment
- [ ] Manual: select "3. Cancel" -> pipeline should abort gracefully
- [ ] Manual: ISA agent resume -> no amend/cancel behavior triggered (regression check)
