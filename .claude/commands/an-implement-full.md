# Full Continuous Implementation for Agentnative

Execute ALL phases in `./plan.md` continuously without pausing for approval.

**User request:** $ARGUMENTS

If `$ARGUMENTS` is empty, read `./plan.md` and execute all uncompleted phases.

## Core Principles

1. **CLAUDE.md is the Rulebook**: Always read `CLAUDE.md` first
2. **Continuous Execution**: Run ALL phases to completion without stopping
3. **Always Validate**: TypeScript typecheck is a hard gate — fix before continuing
4. **Track Progress**: Update `plan.md` with status markers as you go
5. **Fix On The Fly**: If something fails, fix it immediately and continue

## Status Markers

Use these markers in `plan.md`:
- `[ ]` — Pending
- `[x]` — Completed
- `[~]` — In progress
- `[-]` — Skipped (with reason)

## Conversation Flow

### Step 1: Load Rules and Plan

1. Read `CLAUDE.md` to load project conventions
2. Read `./plan.md` to identify all uncompleted phases
3. Present brief overview and BEGIN IMMEDIATELY:

```markdown
## Implementing: [Plan Title]

| Phase | Description |
|-------|-------------|
| [N] | [name] |
| [N+1] | [name] |

[INFO] Starting continuous implementation...
```

### Step 2: Execute All Phases

For each phase sequentially:

1. Mark steps `[~]` when starting
2. Implement each step
3. Mark steps `[x]` when complete
4. Run validation after each phase:
   ```bash
   pnpm run typecheck:all    # HARD GATE — fix before continuing
   pnpm run lint             # Fix before continuing
   ```
5. Output brief status then CONTINUE:

```markdown
---
## [DONE] Phase [N]: [Phase Name]
- [x] Step 1 — result
- [x] Step 2 — result
- Validation: typecheck PASS, lint PASS

[INFO] Continuing to Phase [N+1]...
---
```

**DO NOT ask for approval between phases. Continue immediately.**

### Step 3: Error Recovery

| Situation | Action |
|-----------|--------|
| TypeScript error | Fix immediately — do not proceed until green |
| Lint error | Fix immediately |
| Step cannot be completed | Mark `[-]`, document why, continue with next step |
| After 3 failed fix attempts | STOP and report the issue |

### Step 4: Final Validation and Summary

After all phases:

1. Run full validation: `pnpm run typecheck:all && pnpm run lint && pnpm run test`
2. Update plan.md — all items should be `[x]` or `[-]`
3. Present summary:

```markdown
---

## [DONE] Implementation Complete

### All Phases
| Phase | Name | Status |
|-------|------|--------|
| 1 | [name] | Done |
| 2 | [name] | Done |

### Files Modified
| File | Changes |
|------|---------|
| `path` | [description] |

### Validation Results
- TypeScript: PASS
- Lint: PASS
- Tests: PASS

### Next Steps
- Run `/an-adversarial-reviewer` to review the changes
- Test with `pnpm run electron:dev`

---
```

## Environment Notes

- **Windows ARM64**: `pnpm` + `tsx`, not `bun`
- **Shell**: bash (MINGW64) — use Unix-style paths
- Use `npx tsx` to run TypeScript scripts directly

## Constraints

- **ALWAYS** read `CLAUDE.md` first
- **ALWAYS** execute all phases continuously — never stop for approval
- **ALWAYS** run `pnpm run typecheck:all` after each phase (hard gate)
- **ALWAYS** update plan.md with progress markers
- **ALWAYS** follow existing codebase patterns
- **NEVER** use `bun`
- **NEVER** introduce `any` types without justification
- **NEVER** skip validation steps
- **STOP ONLY** on unrecoverable errors (after 3 fix attempts)
