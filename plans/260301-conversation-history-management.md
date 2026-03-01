# Conversation History Management (Delete, Edit, Restore, Branch)

> **Status**: [x] Complete — All 6 phases implemented
> **Date**: 2026-03-01
> **Archived from**: plan.md Section 15

## Overview

Add four conversation control features to give users fine-grained control over
conversation history — matching industry-standard patterns from ChatGPT, Claude Web,
and Cursor:

1. **Delete message** — Remove any message (user, assistant, or system) and all subsequent messages; deleted messages are excluded from LLM context on subsequent turns
2. **Edit message** — Edit a user message and re-send (user messages only)
3. **Restore checkpoint** — Roll back to the state after any assistant turn
4. **Branch to new conversation** — Fork at any point into a new session

## Architecture Analysis

**Key constraints discovered during research:**

| Constraint | Detail |
|------------|--------|
| **SDK conversation continuity** | The Claude Agent SDK tracks conversation state via `sdkSessionId` stored in a JSONL transcript at `~/.claude/projects/{cwd-slug}/{sessionId}.jsonl`. Truncating our UI messages does NOT retroactively edit the SDK transcript. |
| **SDK resume model** | The SDK's `resume: sessionId` sends the full transcript to the API. We cannot partially truncate the SDK transcript. |
| **Fresh restart required** | When we delete/edit/restore, we must clear `sdkSessionId` so the next message starts a fresh SDK session. The truncated message history gets injected as context via the `getRecoveryMessages` callback (wired at `sessions.ts:2771`). |
| **Context recovery gap** | `buildRecoveryContext()` in `base-agent.ts:621` is ONLY called on the resume-failure path. After truncation clears `sdkSessionId`, a new injection point is required in `sendMessage()` to prepend context for truncated sessions. |
| **JSONL persistence** | Messages are stored in `session.jsonl` (line 1 = header, lines 2+ = messages). Truncation = rewrite the JSONL with fewer messages. |
| **Event dual-type system** | Events must be added to BOTH `SessionEvent` (in `shared/types.ts`) AND `AgentEvent` (in `event-processor/types.ts`). |

## Phases Completed

- **Phase 1** — Data Layer: Truncate & Branch Operations (31 tasks)
- **Phase 2** — Event Handling: Renderer Pipeline (8 tasks)
- **Phase 3** — UI: Actions Menus for All Turn Types (27 tasks)
- **Phase 4** — Preload Bridge & IPC (3 tasks)
- **Phase 5** — SDK Context Recovery After Truncation (5 tasks)
- **Phase 6** — Tests & Validation (16 tasks)

## Files Modified

| File | Changes |
|------|---------|
| `apps/electron/src/shared/types.ts` | Add 4 `SessionCommand` variants, `messages_truncated` event, update `sessionCommand` return type |
| `apps/electron/src/main/ipc.ts` | Add 4 cases to `SessionCommand` switch routing to `SessionManager` methods |
| `apps/electron/src/main/sessions.ts` | Add `truncateAtMessage()`, `deleteFromMessage()`, `editAndResend()`, `restoreCheckpoint()`, `branchFromMessage()`, `pendingContextRecovery` field, context injection in `sendMessage()` |
| `apps/electron/src/renderer/event-processor/types.ts` | Add `MessagesTruncatedEvent` to `AgentEvent` union |
| `apps/electron/src/renderer/event-processor/handlers/session.ts` | Add `handleMessagesTruncated()` handler |
| `apps/electron/src/renderer/event-processor/processor.ts` | Add `case 'messages_truncated'` to switch |
| `apps/electron/src/renderer/App.tsx` | Handle branch navigation, metadata sync after truncation |
| `packages/ui/src/components/chat/UserMessageActionsMenu.tsx` | **NEW** — Dropdown menu for user message actions |
| `packages/ui/src/components/chat/TurnCardActionsMenu.tsx` | Add `onDelete`, `onRestore`, `onBranch` props and menu items |
| `packages/ui/src/components/chat/TurnCard.tsx` | Add `onDelete`, `onRestore`, `onBranch` to props |
| `packages/ui/src/components/chat/index.ts` | Export `UserMessageActionsMenu` |
| `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx` | Wire up callbacks for all turn types |
