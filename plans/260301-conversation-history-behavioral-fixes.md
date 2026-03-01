# Conversation History Management — Behavioral Fixes

> **Status**: [x] Complete — all 6 phases done
> **Date**: 2026-03-01
> **Depends on**: conversation-history-management (complete)
> **Archived from**: plan.md Section 16

## Goal

Fix 4 behavioral issues discovered during user testing of the conversation history management implementation:

1. **Single-message delete** — delete only the target message, not cascade
2. **In-place edit** — edit changes the text only, no truncation/re-send; maintain edit history
3. **Restore checkpoint → input box** — restore rolls back AND populates input box with restored message content
4. **Direct hover action bar** — replace 3-dot dropdown with inline icon buttons positioned above the message

## Current vs Desired Behavior

| Feature | Current Behavior | Desired Behavior |
|---------|-----------------|------------------|
| **Delete** | `deleteFromMessage` → removes target + all after | Remove only the target message; everything else stays |
| **Edit** | `editAndResend()` → destroys all messages after, re-sends | In-place text update only; store original content for history; no re-send |
| **Restore** | Only on assistant turns; doesn't populate input box | Available on all turns; truncates after; populates input box with last user message |
| **UI** | 3-dot `SimpleDropdown` (overlays message) | Inline icon button bar floating above message |

## Phases Completed

- **Phase 1** — Data Layer: Types, Message Schema & Field Mapping (10 tasks)
- **Phase 2** — Backend: Single Delete, In-Place Edit, Restore Content (7 tasks)
- **Phase 3** — Renderer Event Pipeline (9 tasks)
- **Phase 4** — UI: User Message Action Bar & Edit Indicator (10 tasks)
- **Phase 5** — UI: Assistant/System Turn Action Bar (7 tasks)
- **Phase 6** — Polish & Validation (10 tasks)

## Additional Fix Applied

**Restore-on-user-message duplication fix**: Added `inclusive?: boolean` to `restoreCheckpoint` command. When restoring a user message, `inclusive: true` removes the message from chat while populating the input box with its content, preventing duplicate messages on send.

## Files Modified

| File | Changes |
|------|---------|
| `packages/core/src/types/message.ts` | Add `editedAt`, `originalContent` to `Message` + `StoredMessage` |
| `apps/electron/src/shared/types.ts` | Add `deleteSingleMessage` command, `message_edited` event, `restoredContent` field, deprecate `deleteFromMessage` |
| `apps/electron/src/main/sessions.ts` | Update mapping functions, new `deleteSingleMessage()`, replace `editAndResend()` → `editMessageInPlace()`, modify `restoreCheckpoint()` + `truncateAtMessage()` |
| `apps/electron/src/main/ipc.ts` | Add `deleteSingleMessage` case, update `editMessage` case |
| `packages/ui/src/components/chat/turn-utils.ts` | Update `storedToMessage()` with edit fields |
| `apps/electron/src/renderer/event-processor/types.ts` | Add `MessageEditedEvent`, `restoredContent` field |
| `apps/electron/src/renderer/event-processor/handlers/session.ts` | Add `handleMessageEdited()`, modify `handleMessagesTruncated()` |
| `apps/electron/src/renderer/event-processor/processor.ts` | Add `case 'message_edited'` |
| `apps/electron/src/renderer/App.tsx` | Add `'message_edited'` to handoff |
| `apps/electron/src/renderer/pages/ChatPage.tsx` | Listen for `craft:restore-input` with sessionId filter |
| `packages/ui/src/components/chat/UserMessageBubble.tsx` | Add edit props, "(edited)" indicator |
| `packages/ui/src/components/chat/UserMessageActionsMenu.tsx` | Full rewrite: dropdown → icon bar |
| `packages/ui/src/components/chat/TurnCardActionsMenu.tsx` | Rewrite: dropdown → icon bar + overflow |
| `packages/ui/src/components/chat/TurnCard.tsx` | Add `onCopy` prop, adjust header layout |
| `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx` | Reposition action bars, wire callbacks, update memo, pass edit props |
