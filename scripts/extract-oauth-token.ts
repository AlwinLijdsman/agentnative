/**
 * extract-oauth-token.ts
 *
 * Reads the Claude OAuth token from the local credentials store
 * (~/.craft-agent/credentials.enc) and prints it to stdout.
 *
 * Usage:
 *   npx tsx scripts/extract-oauth-token.ts
 *
 * Output modes:
 *   Default  — prints just the access token (for piping / env assignment)
 *   --json   — prints full credential object as JSON
 *   --env    — prints shell export line: export CLAUDE_CODE_OAUTH_TOKEN=...
 *   --ps1    — prints PowerShell assignment: $env:CLAUDE_CODE_OAUTH_TOKEN = "..."
 *
 * Typical CI / E2E usage (PowerShell):
 *   $env:CLAUDE_CODE_OAUTH_TOKEN = (npx tsx scripts/extract-oauth-token.ts)
 *
 * Typical CI / E2E usage (bash):
 *   export CLAUDE_CODE_OAUTH_TOKEN=$(npx tsx scripts/extract-oauth-token.ts)
 *
 * Future agents running E2E tests should call this script at the START of
 * the test run so that live SDK tests are not skipped due to missing token.
 */

import { CredentialManager } from '../packages/shared/src/credentials/manager.ts';

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0]; // --json | --env | --ps1 | (default: plain token)

  const manager = new CredentialManager();
  const creds = await manager.getClaudeOAuthCredentials();

  if (!creds || !creds.accessToken) {
    process.stderr.write(
      'ERROR: No Claude OAuth token found in credentials store.\n' +
      'Make sure you have signed in to the app at least once with Claude Max.\n'
    );
    process.exit(1);
  }

  const { accessToken, expiresAt, source } = creds;

  // Warn if token is already expired
  if (expiresAt && expiresAt < Date.now()) {
    process.stderr.write(
      `WARNING: Token expires at ${new Date(expiresAt).toISOString()} and appears to be expired.\n` +
      'Consider running the app to refresh it before running live E2E tests.\n'
    );
  }

  switch (mode) {
    case '--json':
      console.log(JSON.stringify({ accessToken, expiresAt, source }, null, 2));
      break;
    case '--env':
      console.log(`export CLAUDE_CODE_OAUTH_TOKEN="${accessToken}"`);
      break;
    case '--ps1':
      console.log(`$env:CLAUDE_CODE_OAUTH_TOKEN = "${accessToken}"`);
      break;
    default:
      // Plain token — safe for subshell capture
      process.stdout.write(accessToken + '\n');
      break;
  }
}

main().catch((err) => {
  process.stderr.write(`ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
