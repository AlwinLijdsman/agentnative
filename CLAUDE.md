# Craft Agent (agentnative)

Electron desktop app providing Claude Agent SDK-powered coding assistant with MCP server support.

## Quick Commands

```bash
pnpm install                    # Install dependencies
pnpm run electron:dev           # Development with hot reload
pnpm run electron:build         # Full build (main/preload/renderer)
pnpm run typecheck:all          # TypeScript check all packages
pnpm run lint                   # ESLint check
pnpm run test                   # Run tests
pnpm run test:e2e               # All E2E tests (stage-gate, session validation, stage0 pause)
pnpm run test:e2e:live          # Live SDK tests (requires CLAUDE_CODE_OAUTH_TOKEN)
pnpm run test:e2e:live:auto     # Live SDK tests with auto-extracted token (reads ~/.craft-agent/credentials.enc)
```

> **For agents running E2E tests**: Use `test:e2e:live:auto` or set the token first:
> ```powershell
> $env:CLAUDE_CODE_OAUTH_TOKEN = (npx tsx scripts/extract-oauth-token.ts)
> pnpm run test:e2e:live
> ```

## Project Structure

- `apps/electron/` - Main Electron app (main, preload, renderer)
- `packages/shared/` - Business logic (agent, auth, config, MCP, sessions)
- `packages/core/` - Type definitions
- `packages/ui/` - React components
- `packages/*-mcp-server/` - MCP server implementations
- `scripts/` - Build scripts (modified for Node.js/tsx on Windows ARM64)

## Key Conventions

- **TypeScript strict mode** - All code must type-check
- **pnpm workspaces** - Use workspace protocol for internal packages
- **Jotai atoms** - State management in renderer
- **esbuild** - Main/preload bundling
- **Vite** - Renderer bundling with React + Tailwind

## Windows ARM64 Notes

This fork uses `pnpm` + `tsx` instead of `bun` (not available on Windows ARM64).
Build scripts in `scripts/` have been modified accordingly.

## Slash Commands (Claude Code CLI)

Available via `/` prefix in Claude Code CLI sessions.

### Agentnative Development Commands

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `/an-research-and-plan` | Research codebase + write plan to `./plan.md` | Start here — describe your feature/bug |
| `/an-implement-full` | Execute all plan.md phases continuously | After planning, for quick implementation |
| `/an-implement-phased` | Execute plan.md one phase at a time with approval | For careful, step-by-step implementation |
| `/an-code-researcher` | Read-only codebase analysis with architecture tracing | Explore and understand existing code |
| `/an-adversarial-reviewer` | Adversarial review (TypeScript, Electron, security) | Final check before shipping |
| `/an-clean-plan-commit-push` | Archive completed plan, commit, push | After implementation is tested and working |

### General Template Commands (Python/Streamlit)

| Command | Purpose |
|---------|---------|
| `/research-and-plan` | Research + plan for general Python apps |
| `/carefully-implement-full-phased-plan` | Full continuous Python app build |
| `/carefully-implement-phased-plan` | Phase-by-phase Python app build with approval |
| `/code-researcher` | Read-only code analysis (general) |
| `/adversarial-reviewer` | Adversarial review for Python apps |

## Plan Tracking Convention

Implementation progress is tracked in `./plan.md` at project root (git-tracked).

### Status markers
- `[ ]` — Pending
- `[x]` — Completed
- `[~]` — In progress
- `[-]` — Skipped (with reason noted)

### Workflow
1. Use `/an-research-and-plan` to research and write a plan to `plan.md`
2. Use `/an-implement-phased` or `/an-implement-full` to execute the plan
3. Plan updates happen automatically during implementation
4. Never delete completed items — mark them done for audit trail

## MCP Integration

### PDF Aspose MCP Server

Available for PDF operations when configured. Key capabilities:

| Category | Tools |
|----------|-------|
| Text Extraction | `pdf_extract_text`, `pdf_find_text` |
| Layout Analysis | `pdf_analyze_layout`, `pdf_extract_tables` |
| Annotations | `pdf_add_comment`, `pdf_add_highlight`, `pdf_add_free_text` |
| Page Operations | `pdf_merge`, `pdf_split`, `pdf_rotate_pages`, `pdf_delete_pages` |
| Creation | `pdf_create_tool`, `pdf_from_text_tool`, `pdf_from_html_tool` |
| Conversion | `pdf_to_docx_tool`, `pdf_to_images_tool`, `pdf_to_html_tool` |

## Do NOT

- Modify `packages/shared/src/agent/` types without running `pnpm run typecheck:all`
- Use `bun` commands (not available on Windows ARM64)
- Skip TypeScript strict mode checks
- Add dependencies without workspace protocol for internal packages
- Commit `.claude/settings.local.json` (gitignored, user-specific)
- Introduce `any` types without explicit justification

## Do ALWAYS

- Run `pnpm run typecheck:all` before committing TypeScript changes
- Run `pnpm run lint` before committing
- Follow existing patterns in the codebase before introducing new ones
- Update `plan.md` when completing implementation phases
- Use workspace protocol (`workspace:*`) for internal package dependencies
