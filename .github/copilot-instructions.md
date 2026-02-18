# GitHub Copilot Instructions

This file provides context to GitHub Copilot for the agentnative project.

## Project Overview

- **Type**: Electron desktop app  Claude Agent SDK-powered coding assistant with MCP server support
- **Language**: TypeScript (strict mode)
- **Runtime**: Electron (main + renderer), Node.js
- **Package Manager**: pnpm (workspaces)
- **Build**: esbuild (main/preload), Vite (renderer)
- **State Management**: Jotai atoms (renderer)
- **Styling**: Tailwind CSS
- **Platform Note**: Windows ARM64  uses `pnpm` + `tsx`, NOT `bun`

## Stack Rules

| Layer | Choice |
|-------|--------|
| Language | TypeScript 5.x (strict mode) |
| Runtime | Electron + Node.js |
| UI | React + Tailwind CSS |
| State | Jotai atoms |
| Build (main/preload) | esbuild |
| Build (renderer) | Vite |
| AI SDK | anthropic (Claude Agent SDK) |
| Package Manager | pnpm (workspace protocol) |
| Config | `.env` for secrets |

## Monorepo Structure

`
agentnative/
+-- apps/electron/           # Main Electron app
|   +-- src/main/            # Main process (esbuild)
|   +-- src/preload/         # Preload scripts (esbuild)
|   +-- src/renderer/        # Renderer process (Vite + React)
+-- packages/shared/         # Business logic (agent, auth, config, MCP, sessions)
+-- packages/core/           # Type definitions
+-- packages/ui/             # React components
+-- packages/*-mcp-server/   # MCP server implementations
+-- scripts/                 # Build scripts
+-- skills/                  # Craft Agent skill definitions (SKILL.md)
+-- sessions/                # Session logs (JSONL format)
+-- plan.md                  # Implementation progress tracking
+-- CLAUDE.md                # Project conventions (source of truth)
`

## Code Conventions

### TypeScript
- Strict mode everywhere  no `any` types unless explicitly justified
- Proper type narrowing, no unsafe casts (`as`)
- No unhandled promises
- Use workspace protocol (`workspace:*`) for internal package dependencies
- Follow existing patterns before introducing new ones

### Naming
- `camelCase` for functions and variables
- `PascalCase` for types, interfaces, classes, React components
- `UPPER_SNAKE_CASE` for constants

### Imports
- Use workspace protocol: `"@agentnative/shared": "workspace:*"`
- Relative imports within a package
- Absolute workspace imports across packages

### Electron
- Respect main/renderer process boundary
- Never use `nodeIntegration: true`
- All IPC goes through preload bridge
- Proper security context isolation

### State Management
- Jotai atoms for renderer state
- No Redux, no MobX, no Zustand

## Plan Tracking

Implementation progress tracked in `./plan.md`:

| Marker | Meaning |
|--------|---------|
| `[ ]` | Pending |
| `[x]` | Completed |
| `[~]` | In progress |
| `[-]` | Skipped (reason noted) |

- Never delete completed items  mark them done for audit trail
- Archive completed plans to `./plans/YYMMDD-{slug}.md` before starting new work

## Session Logs

`sessions/` contains JSONL-format session logs:
- First line: session metadata (`messageCount`, `tokenUsage`, `permissionMode`)
- Subsequent lines: tool calls, results, errors
- Check for `"isError":true` to find failures
- Useful for diagnosing agent runtime issues

## Quick Reference

| Action | Command |
|--------|---------|
| Install deps | `pnpm install` |
| Dev with hot reload | `pnpm run electron:dev` |
| Full build | `pnpm run electron:build` |
| TypeScript check | `pnpm run typecheck:all` |
| Lint | `pnpm run lint` |
| Test | `pnpm run test` |

## Do NOT

- Use `bun` (not available on Windows ARM64)
- Introduce `any` types without explicit justification
- Use `nodeIntegration: true` in Electron
- Skip TypeScript strict mode checks
- Add dependencies without workspace protocol for internal packages
- Hard-code credentials or API keys
- Use non-Anthropic AI models unless explicitly requested
- Commit `.claude/settings.local.json`

## Do ALWAYS

- Read `CLAUDE.md` first for full project conventions
- Run `pnpm run typecheck:all` before considering changes complete
- Run `pnpm run lint` before considering changes complete
- Follow existing patterns in the codebase
- Update `plan.md` when completing implementation phases
- Use workspace protocol (`workspace:*`) for internal package dependencies
- Use `npx tsx` to run TypeScript scripts directly
