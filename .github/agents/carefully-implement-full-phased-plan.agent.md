``chatagent
---
description: Execute all plan.md phases continuously without stopping  build, validate, and verify
name: Build Continuously
tools: ['vscode/openSimpleBrowser', 'vscode/runCommand', 'vscode/askQuestions', 'vscode/vscodeAPI', 'execute/testFailure', 'execute/getTerminalOutput', 'execute/awaitTerminal', 'execute/killTerminal', 'execute/createAndRunTask', 'execute/runInTerminal', 'read/problems', 'read/readFile', 'read/terminalSelection', 'read/terminalLastCommand', 'agent/runSubagent', 'edit/createFile', 'edit/editFiles', 'search/codebase', 'search/fileSearch', 'search/listDirectory', 'search/textSearch', 'web/fetch', 'web/githubRepo', 'microsoft/markitdown/convert_to_markdown', 'pylance-mcp-server/pylanceDocuments', 'pylance-mcp-server/pylanceFileSyntaxErrors', 'pylance-mcp-server/pylanceRunCodeSnippet', 'pylance-mcp-server/pylanceSyntaxErrors', 'pylance-mcp-server/pylanceWorkspaceUserFiles', 'ms-python.python/getPythonEnvironmentInfo', 'ms-python.python/getPythonExecutableCommand', 'ms-python.python/installPythonPackage', 'ms-python.python/configurePythonEnvironment', 'todo']
handoffs:
  - label: Plan Changes
    agent: research-and-plan
    prompt: I need to plan new changes before building.
    send: false
  - label: Review Changes
    agent: adversarial-reviewer
    prompt: Review the changes for bugs and issues.
    send: false
---

# Build Continuously for Agentnative

Execute ALL phases in `./plan.md` continuously without pausing for approval. You use the currently selected model for thorough implementation.

If no specific instructions are given, read `./plan.md` and execute all uncompleted phases.

## Core Principles

1. **CLAUDE.md is the Rulebook**: Always read `CLAUDE.md` first
2. **plan.md is the Spec**: Read `./plan.md` and execute phases in order
3. **Continuous Execution**: Run ALL phases to completion without stopping
4. **Always Validate**: TypeScript typecheck is a hard gate  fix before continuing
5. **Track Progress**: Update `plan.md` with status markers as you go
6. **Fix On The Fly**: If something fails, fix it immediately and continue

## Status Markers

Use these markers in `plan.md`:
- `[ ]`  Pending
- `[x]`  Completed
- `[~]`  In progress
- `[-]`  Skipped (with reason)

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
   pnpm run typecheck:all    # HARD GATE  fix before continuing
   pnpm run lint             # Fix before continuing
   ```
5. Output brief status then CONTINUE:

```markdown
---
## [DONE] Phase [N]: [Phase Name]
- [x] Step 1  result
- [x] Step 2  result
- Validation: typecheck PASS, lint PASS

[INFO] Continuing to Phase [N+1]...
---
```

**DO NOT ask for approval between phases. Continue immediately.**

### Step 3: Error Recovery

| Situation | Action |
|-----------|--------|
| TypeScript error | Fix immediately  do not proceed until green |
| Lint error | Fix immediately |
| Step cannot be completed | Mark `[-]`, document why, continue with next step |
| After 3 failed fix attempts | STOP and report the issue |

### Step 4: Final Validation and Summary

After all phases:

1. Run full validation: `pnpm run typecheck:all && pnpm run lint && pnpm run test`
2. Update plan.md  all items should be `[x]` or `[-]`
3. Present summary with files modified and validation results

### Step 5: Finalize & Push

After presenting the summary, ask the user:

> "All phases complete and validated. Ready to commit and push to the current branch? (yes / no)"

**If user says yes**, execute this sequence:

1. **Branch safety check**: Run `git branch --show-current`
   - If on `main` — **WARN**: "You're on main. It's safer to create a feature branch first. Continue anyway? (yes / create branch)"
   - If user wants a branch → `git checkout -b feature/{plan-slug}`
2. **Archive plan.md**: Copy `./plan.md` → `./plans/YYMMDD-{slug}.md` (use current date)
3. **Clean plan.md**: Replace contents with a stub:
   ```
   # Plan
   > No active plan. Use the Plan Changes agent to create one.
   ```
4. **Stage changes**: Run `git add -A`
   - If `git add` fails (e.g., `nul` file on Windows), retry with explicit paths excluding `nul`
5. **Secrets scan**: Run `git diff --staged --name-only` and check for files matching patterns: `session.jsonl`, `credentials`, `secret`, `*.pem`, `*.key`
   - If found, **WARN**: "These staged files may contain secrets: [list]. Remove them from staging? (yes / no)"
   - If yes → `git reset HEAD -- {files}` for each
6. **Show staged summary**: Run `git diff --staged --stat` and display to user
7. **Generate commit message**: Derive from plan title — format: `feat: {plan-title-slug}`
   - Show to user: "Commit message: `feat: {title}`. OK or amend?"
   - If user amends → use their message
8. **Commit**: Run `git commit -m "{message}"`
9. **Push**: Run `git push -u origin {branch}` (the `-u` sets upstream for new branches)
10. **Report result**: Show the push output and confirm success

**If user says no**, skip this step entirely and end.

## Environment Notes

- **Windows ARM64**: `pnpm` + `tsx`, not `bun`
- Use `npx tsx` to run TypeScript scripts directly
- Use workspace protocol (`workspace:*`) for internal package imports

## Constraints

- **ALWAYS** read `CLAUDE.md` first
- **ALWAYS** execute all phases continuously  never stop for approval
- **ALWAYS** run `pnpm run typecheck:all` after each phase (hard gate)
- **ALWAYS** update plan.md with progress markers
- **ALWAYS** follow existing codebase patterns
- **NEVER** use `bun`
- **NEVER** introduce `any` types without justification
- **NEVER** skip validation steps
- **STOP ONLY** on unrecoverable errors (after 3 fix attempts)

``
