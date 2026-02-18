# E2E Tests

End-to-end tests for the Craft Agent application.

## Test Categories

### Unit-Level E2E (No Network)

Tests that exercise the stage-gate handler with real filesystem operations but no API calls:

```bash
# All E2E tests (both unit-level and live-guarded)
pnpm run test:e2e

# Stage 0 pause tests specifically
npx tsx --test apps/electron/src/__tests__/e2e-stage0-pause.test.ts

# Session validation tests (in session-tools-core)
npx tsx --test packages/session-tools-core/src/handlers/__tests__/e2e-*.test.ts
```

### Live SDK Tests (Requires OAuth)

Tests that make real Anthropic API calls using Claude Max OAuth billing:

```bash
pnpm run test:e2e:live
```

These tests are **automatically skipped** if `CLAUDE_CODE_OAUTH_TOKEN` is not set.

## Environment Setup

### Setting CLAUDE_CODE_OAUTH_TOKEN

For live SDK tests, you need a valid Claude Max OAuth token.

#### Automated (Recommended — for agents and CI on developer machines)

A helper script reads the token directly from `~/.craft-agent/credentials.enc` (the same store the running app uses). This works on any machine where the user has signed in via Claude Max at least once:

```powershell
# PowerShell — set in current shell
$env:CLAUDE_CODE_OAUTH_TOKEN = (npx tsx scripts/extract-oauth-token.ts)
pnpm run test:e2e:live
```

```bash
# bash / zsh
export CLAUDE_CODE_OAUTH_TOKEN=$(npx tsx scripts/extract-oauth-token.ts)
pnpm run test:e2e:live
```

Or use the all-in-one script that extracts and injects automatically:

```powershell
pnpm run test:e2e:live:auto
```

> **For future agents**: Before running `test:e2e:live`, always run:
> ```powershell
> $env:CLAUDE_CODE_OAUTH_TOKEN = (npx tsx scripts/extract-oauth-token.ts)
> ```
> This will fail with a clear error if no token is stored (user not signed in).
> You can verify the token is valid first with `npx tsx scripts/extract-oauth-token.ts --json`.

#### Manual / DevTools

Use the auth diagnostics in the app's DevTools console to check whether OAuth is active (this never exposes the token value itself):
```js
// In Electron DevTools (Ctrl+Shift+I)
const diag = await window.electronAPI.getAuthDiagnostics()
console.log(diag) // shows hasClaudeCodeOAuthToken: true/false
```

#### For CI Pipelines

Set `CLAUDE_CODE_OAUTH_TOKEN` as a repository secret and pass it to the test step:
```bash
export CLAUDE_CODE_OAUTH_TOKEN="${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}"
pnpm run test:e2e:live
```

### Expected Costs

| Test Suite | Est. Tokens | Est. Cost |
|-----------|-------------|-----------|
| SDK spawn (basic) | ~200 | < $0.01 |
| Agent resolution | ~500 | < $0.02 |
| Full Stage 0 flow | ~1000 | < $0.05 |

**Total per run: ~$0.01–$0.08**

## Architecture

### Two Execution Patterns

The SDK may execute agent stage gates in one of two patterns:

**Pattern A: Task-nested** (most common)
```
User message → SDK creates Task subagent → subagent calls agent_stage_gate(start, 0)
→ subagent calls agent_stage_gate(complete, 0) → pause fires → subagent stops
```

**Pattern B: Top-level**
```
User message → SDK calls agent_stage_gate(start, 0) directly
→ SDK calls agent_stage_gate(complete, 0) → pause fires → SDK stops
```

Tests use **outcome-based assertions** (not order-based) to work with either pattern:
- "Session is paused at stage 0" — regardless of nesting depth
- "Pause reason includes pauseInstructions" — regardless of tool call order

### Test Infrastructure

- **E2ESessionHarness** (`e2e-utils.ts`): Wraps `createTestAgentContext()` with lifecycle API
- **Session Validators** (`e2e-session-validators.ts`): Validate JSONL artifacts, run state, schemas
- **Stage Gate Tests** (`e2e-stage-gate.test.ts`): Core pause/resume lifecycle
- **Session Validation Tests** (`e2e-session-validation.test.ts`): Full pipeline + repair loops
- **Stage 0 Pause Tests** (`e2e-stage0-pause.test.ts`): Comprehensive Stage 0 scenarios
- **Live SDK Tests** (`e2e-sdk-live.test.ts`): Real API calls (OAuth-guarded)
