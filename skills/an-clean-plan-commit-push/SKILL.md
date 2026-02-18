---
name: "AN: Clean Plan, Commit & Push"
description: "Archive completed plan from plan.md, commit all changes, and push to remote"
alwaysAllow: ["Bash", "Write", "Edit", "Read", "Glob", "Grep"]
---

# Clean Plan, Commit & Push for Agentnative

After a plan has been fully implemented and tested, this command:
1. Archives the completed plan from `plan.md` Section 11 to `plans/YYMMDD-{slug}.md`
2. Updates the archive table in `plan.md` Section 10
3. Clears Section 11 for the next plan
4. Commits everything on the current branch
5. Pushes to remote

Run this **after** you have verified the implementation works (tests pass, app runs correctly).

## Core Principles

1. **CLAUDE.md is the Rulebook**: Always read `CLAUDE.md` first
2. **Never Lose Work**: Archive before clearing — completed plans are preserved in `plans/`
3. **Validate Before Commit**: Run typecheck + lint + tests before committing
4. **Clean State**: After this command, `plan.md` Section 11 is empty and ready for the next plan

## Conversation Flow

### Step 1: Read & Validate Current State

1. Read `CLAUDE.md` for conventions
2. Read `./plan.md` — find Section 11 (Active Implementation Plan)
3. **Verify the plan is complete**:
   - Scan all status markers in Section 11
   - ALL phases should be `[x]` (completed) or `[-]` (skipped with reason)
   - If ANY `[ ]` (pending) or `[~]` (in-progress) items exist: **STOP and warn the user**
     - Show which items are incomplete
     - Ask: "These items are not done. Continue anyway? (They'll be archived as-is)"
   - If Section 11 says "No active plan" or is empty: **STOP** — nothing to archive

### Step 2: Extract Plan Metadata

From Section 11, extract:
- **Title**: from the `## 11. Active Implementation Plan — {title}` heading
- **Slug**: lowercase, hyphens, no special chars (e.g., "Agent Default Sources" → `agent-default-sources`)
- **Branch**: from the `> **Branch**:` line if present
- **Date**: today's date in YYMMDD format

### Step 3: Archive the Plan

1. **Create archive file**: `plans/YYMMDD-{slug}.md`
   - Copy the full Section 11 content (everything between `## 11.` and `## 12.`)
   - Add a header: `# Plan: {title}` and `> **Status**: COMPLETED ({date})`
   - Preserve all phases, items, and status markers as-is for audit trail

2. **Update archive table** in `plan.md` Section 10:
   - Add a new row: `| YYMMDD | \`{slug}\` | {one-line summary} |`
   - Place it at the end of the table (chronological order)

3. **Clear Section 11**:
   - Replace all content between `## 11.` and `## 12.` with:
     ```
     ## 11. Active Implementation Plan

     > No active plan. Use `/an-research-and-plan` to create one, then `/an-implement-full` or `/an-clean-plan-commit-push` after completion.
     ```

4. **Update timestamp**: Change `_Last updated:` at the bottom of plan.md to today's date

### Step 4: Run Validation

Before committing, run:
```bash
pnpm run typecheck:all    # Must pass
pnpm run lint             # Must pass (no new errors)
```

If either fails, **STOP and report**. Do not commit broken code.

### Step 5: Commit

1. Stage all changed/new files:
   ```bash
   git add plan.md plans/YYMMDD-{slug}.md
   ```
   Also stage any implementation files that are part of this feature but not yet committed.
   Use `git status` to check — stage tracked modified files and relevant untracked files.
   **DO NOT** stage: `.claude/`, `sessions/`, `node_modules/`, `.env`, `credentials.enc`

2. Create commit with descriptive message:
   ```
   feat: {slug} — archive completed plan and implementation

   Phases completed:
   - Phase 1: {name}
   - Phase 2: {name}
   ...

   Files: {count} modified, {count} new
   Tests: {pass count} pass

   Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
   ```

### Step 6: Push

1. Check if current branch tracks a remote:
   ```bash
   git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null
   ```
2. If tracked: `git push`
3. If not tracked: `git push -u origin {current-branch}`

### Step 7: Summary

Present final summary:

```markdown
---
## Clean Plan Complete

### Archived
- Plan: **{title}**
- Archive: `plans/YYMMDD-{slug}.md`
- Archive table updated in plan.md

### Committed & Pushed
- Branch: `{branch}`
- Commit: `{short hash}` — {commit message first line}
- Remote: {remote URL}

### plan.md State
- Section 11: Empty (ready for next plan)
- Section 10: {N} archived plans

### Next Steps
- Create a new plan with `/an-research-and-plan`
- Or start a new feature branch
---
```

## Error Handling

| Situation | Action |
|-----------|--------|
| Section 11 is empty/no active plan | STOP — nothing to archive |
| Incomplete items in plan | WARN — ask user to confirm |
| typecheck fails | STOP — do not commit |
| lint fails with NEW errors | STOP — do not commit |
| lint fails with PRE-EXISTING errors only | Continue — note in output |
| git push fails | Report error — user may need to pull first |
| plans/ directory doesn't exist | Create it |

## Environment Notes

- **Windows ARM64**: `pnpm` + `tsx`, not `bun`
- **Shell**: bash (MINGW64) — use Unix-style paths
- **Git**: Use HEREDOC for multi-line commit messages

## Constraints

- **ALWAYS** read `CLAUDE.md` first
- **ALWAYS** validate before committing
- **ALWAYS** archive before clearing Section 11
- **NEVER** delete completed plan items — they're archived for audit trail
- **NEVER** force-push
- **NEVER** commit `.env`, `credentials.enc`, `sessions/`, `.claude/settings.local.json`
- **NEVER** amend existing commits — always create new ones
