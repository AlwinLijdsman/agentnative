# Phased Implementation for Agentnative

Execute the plan in `./plan.md` one phase at a time, pausing for user approval between phases.

**User request:** $ARGUMENTS

If `$ARGUMENTS` is empty, read `./plan.md` and start from the first uncompleted phase.

## Core Principles

1. **CLAUDE.md is the Rulebook**: Always read `CLAUDE.md` first
2. **One Phase At A Time**: Implement ONE phase, then STOP for approval
3. **Always Validate**: Run typecheck and lint after every phase
4. **Track Progress**: Update `plan.md` with status markers after each step
5. **Think Before Acting**: Reason through your approach before each major step

## Status Markers

Use these markers in `plan.md`:
- `[ ]` — Pending
- `[x]` — Completed
- `[~]` — In progress
- `[-]` — Skipped (with reason)

## Conversation Flow

### Step 1: Load Rules and Plan

1. Read `CLAUDE.md` to load project conventions
2. Read `./plan.md` to identify the current phase (first uncompleted phase)
3. Present an overview and ASK to start:

```markdown
## Implementing: [Plan Title]

| Phase | Status | Description |
|-------|--------|-------------|
| 1 | [done/pending] | [name] |
| 2 | [done/pending] | [name] |
| 3 | [done/pending] | [name] |

**Starting Phase [N]. Ready?** (yes / abort)
```

### Step 2: Phase Implementation Cycle

For EACH phase:

#### A. Implement the Phase

- Follow existing patterns in the codebase
- Use TypeScript strict mode — no `any` types unless justified
- Use workspace protocol for internal package imports
- Mark each step `[~]` when starting, `[x]` when done in plan.md

#### B. Validate

After implementing all steps in the phase:
```bash
pnpm run typecheck:all    # MUST pass — fix before continuing
pnpm run lint             # MUST pass — fix before continuing
```

#### C. Provide Summary + Preview Next

```markdown
---

## [DONE] Phase [N]: [Phase Name]

### What Was Done
- [x] Step description — result
- [x] Step description — result

### Validation
- TypeScript: PASS/FAIL
- Lint: PASS/FAIL

### Files Modified
| File | Changes |
|------|---------|
| `path/to/file.ts` | [what changed] |

---

## [NEXT] Phase [N+1]: [Phase Name]

### What Will Be Done
- [ ] Step description
- [ ] Step description

---

**Proceed with Phase [N+1]?** (yes / pause / abort)
```

#### D. Wait for Approval

- **yes** — Proceed to next phase
- **pause** — Stop here, can resume later (plan.md tracks progress)
- **abort** — Stop implementation

**CRITICAL: DO NOT proceed without explicit approval.**

### Step 3: Final Phase Completion

After the last phase:

1. Run full validation: `pnpm run typecheck:all && pnpm run lint && pnpm run test`
2. Update all remaining items in plan.md to `[x]`
3. Test with `pnpm run electron:dev` if applicable

### Step 4: Final Summary

```markdown
---

## [DONE] Implementation Complete

### All Phases
| Phase | Name | Status |
|-------|------|--------|
| 1 | [name] | Done |
| 2 | [name] | Done |
| 3 | [name] | Done |

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

## Error Handling

| Situation | Action |
|-----------|--------|
| TypeScript error | Fix immediately — do not proceed until green |
| Lint error | Fix immediately |
| Step cannot be completed | Mark `[-]` in plan.md, document why, ask user |
| Circular dependency | Check package.json workspace refs, fix imports |
| Missing type definitions | Check packages/core/ for existing types |

## Environment Notes

- **Windows ARM64**: `pnpm` + `tsx`, not `bun`
- **Shell**: bash (MINGW64) — use Unix-style paths
- Use `npx tsx` to run TypeScript scripts directly

## Constraints

- **ALWAYS** read `CLAUDE.md` first
- **ALWAYS** wait for explicit approval between phases
- **ALWAYS** run `pnpm run typecheck:all` after each phase
- **ALWAYS** update plan.md with progress markers
- **ALWAYS** follow existing codebase patterns
- **NEVER** proceed without explicit "yes"
- **NEVER** use `bun`
- **NEVER** introduce `any` types without justification
- **NEVER** skip validation steps

## Resume Capability

If user says "pause" and returns later:
1. Read `./plan.md` to find the last completed phase
2. Show current progress
3. Ask: "Resume from Phase [N]?"
4. Continue the cycle
