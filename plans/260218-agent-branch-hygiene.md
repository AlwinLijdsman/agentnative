# Plan: Git Branch Hygiene & Commit/Push Workflow in Copilot Agents

> Status markers: `[ ]` pending | `[x]` done | `[~]` in progress | `[-]` skipped
> Predecessor: Archived to `plans/260218-auto-enable-agent-sources.md`

## Goal

Update the `.github/agents/` agent definitions so that:

1. **Plan Changes** (`research-and-plan`) — before researching, checks the current git branch and ensures we're not developing on `main`. Creates or switches to a feature branch if needed.
2. **Build Continuously** (`carefully-implement-full-phased-plan`) — after all phases pass and user confirms, archives `plan.md`, commits all changes, and pushes to the feature branch.
3. **Build Step-by-Step** (`carefully-implement-phased-plan`) — same commit/push finalization as Build Continuously, but triggered after the last phase is approved.

## Analysis

### Agents to Modify

| Agent File | Role | Change |
|---|---|---|
| `research-and-plan.agent.md` | Plan Changes | Add "Branch Check" step before research. Detect current branch, warn if on `main`, offer to create feature branch |
| `carefully-implement-full-phased-plan.agent.md` | Build Continuously | Add "Finalize & Push" step after all phases. Archive plan, commit, push |
| `carefully-implement-phased-plan.agent.md` | Build Step-by-Step | Add "Finalize & Push" step after last phase approved. Archive plan, commit, push |

### Agents NOT Modified

| Agent File | Why |
|---|---|
| `adversarial-reviewer.agent.md` | Read-only agent — no git operations |
| `code-researcher.agent.md` | Read-only agent — no git operations |
| `e2e-test-runner.agent.md` | Test runner — doesn't own the commit lifecycle |

---

## Phases

### Phase 1: Update `research-and-plan.agent.md` — Branch Check

- [x] Insert "Step 0.5: Branch & Git Check" between Step 0 and Step 1
- [x] Validate: agent file loads in VS Code Copilot Chat

### Phase 2: Update `carefully-implement-full-phased-plan.agent.md` — Finalize & Push

- [x] Insert "Step 5: Finalize & Push" after Step 4
- [x] Validate: agent file loads in VS Code Copilot Chat

### Phase 3: Update `carefully-implement-phased-plan.agent.md` — Finalize & Push

- [x] Insert "Step 5: Finalize & Push" after Step 4
- [x] Validate: agent file loads in VS Code Copilot Chat

### Phase 4: Smoke Test

- [x] Verify all 3 modified agent files have no syntax errors
- [x] Commit and push changes — merged to main via `feature/agent-branch-hygiene-commit-push`

## Risks & Considerations

| Risk | Mitigation |
|---|---|
| Agent tries to commit secrets | Pre-commit check scans staged file names for session/credential patterns |
| `nul` files on Windows block `git add -A` | `.gitignore` already excludes `nul`; agent catches error and skips |
| User doesn't want to commit yet | Always ask before committing; "no" is a clean exit |
| Branch already exists remotely | `git push` will just update it; no force-push |
| Plan title has special characters | Slugify: lowercase, replace spaces with hyphens, strip non-alphanumeric |
