# Plan: Auto-Enable Agent-Required Sources on Agent Mention

> Status markers: [ ] pending | [x] done | [~] in progress | [-] skipped
> Predecessor: Archived to plans/260218-generic-e2e-test-framework.md

## Goal

When a user sends a message that mentions an agent (e.g. `[agent:isa-deep-research]`), automatically add the agent's required sources (declared in AGENT.md frontmatter) to the session's `enabledSourceSlugs` **before** source servers are built. This eliminates the agent wasting 5+ tool calls discovering and activating its own sources at runtime via `onSourceActivationRequest`.

## Analysis

### Problem

The `isa-deep-research` agent declares `sources: [{ slug: isa-knowledge-base, required: true }]` in its AGENT.md, but when invoked via `[agent:isa-deep-research]`, the session only has `["agentnative"]` in `enabledSourceSlugs` (from workspace defaults). The agent wastes token-expensive tool calls discovering the ISA knowledge base source is inactive, checking its config, testing the connection, and activating it — all before starting its actual Stage 0 work.

### Key Findings

1. **Agent source declarations already parsed** — `AgentMetadata.sources` (type `AgentSourceBinding[]`) is populated from AGENT.md YAML frontmatter by `parseAgentFile()` in `packages/shared/src/agents/storage.ts`. The `isa-deep-research` agent declares `isa-knowledge-base` as `required: true`.

2. **Session `enabledSourceSlugs`** is set from workspace config defaults during `createSession()` in `apps/electron/src/main/sessions.ts` — no agent-awareness at session creation time.

3. **Reactive fallback** exists via `onSourceActivationRequest` — when agent hits an inactive source tool, it auto-enables it. This works but wastes tokens on discovery overhead.

4. **Correct hook point** is in `sendMessage()`, after `sendSpan.mark('sources.loaded')` and before the `if (managed.enabledSourceSlugs?.length)` block. At this point, `workspaceRootPath` is declared and any new slugs added to `managed.enabledSourceSlugs` will feed directly into the existing source-building block.

5. **`loadWorkspaceAgents` needs top-level import** — currently only used via dynamic import elsewhere.

6. **Early exit guard** — only load agents if message text contains `[agent:` to avoid unnecessary I/O on every message.

### Key Files

| File | Role | Changes |
|------|------|---------|
| `apps/electron/src/main/sessions.ts` | SessionManager | Add top-level import + agent source auto-enable in `sendMessage()` |
| `packages/shared/src/agents/storage.ts` | Agent loading | No changes needed |
| `packages/shared/src/agents/types.ts` | AgentSourceBinding type | No changes needed |
| `packages/shared/src/mentions/index.ts` | Mention parsing | No changes needed |

---

## Phases

### Phase 1: Auto-Enable Agent Required Sources in sendMessage

- [x] Add top-level import for `loadWorkspaceAgents` from `@craft-agent/shared/agents`
- [x] Add top-level import for `parseMentions` from `@craft-agent/shared/mentions`
- [x] In `sendMessage()`, insert auto-enable block after `sendSpan.mark('sources.loaded')` and before `if (managed.enabledSourceSlugs?.length)`:
  - Early exit guard: `if (!message.includes('[agent:'))` — skip the entire block
  - Load workspace agents, extract slugs, parse mentions
  - For each detected agent, check `metadata.sources` for `required: true` bindings
  - Auto-add usable required sources to `managed.enabledSourceSlugs`
  - Emit `sources_changed` event and persist session if any sources added
- [x] Validate: `pnpm run typecheck:all`
- [x] Validate: `pnpm run lint` (0 new errors — 5 pre-existing errors unrelated to this change)

### Phase 2: Testing

- [ ] Manual test: Send `[agent:isa-deep-research] test query` to a new session with only `["agentnative"]` enabled
- [ ] Verify `isa-knowledge-base` appears in `enabledSourceSlugs` before the first tool call
- [ ] Verify the agent proceeds directly to Stage 0 without source discovery overhead
- [ ] Verify sessions that already have the source enabled aren't affected
- [ ] Verify messages without `[agent:` don't trigger any agent loading

## Risks & Considerations

| Risk | Mitigation |
|------|-----------|
| Source may not be usable (disabled/needs auth) | Only auto-enable sources that pass `isSourceUsable()` check; log warning for unusable required sources |
| Performance: loading agents on every message | Early exit guard `message.includes('[agent:')` means zero I/O for non-agent messages |
| Agent mentioned but not actually invoked | Acceptable — source would get enabled via `onSourceActivationRequest` anyway |
| Multiple agents with overlapping required sources | Merge using Set semantics — duplicates handled naturally |
