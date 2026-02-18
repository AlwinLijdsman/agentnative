/**
 * run-e2e-live.ts
 *
 * Extracts the Claude OAuth token from the local credential store and runs
 * the live SDK E2E tests with the token injected into the environment.
 *
 * Usage:
 *   pnpm run test:e2e:live:auto
 *   npx tsx scripts/run-e2e-live.ts
 *
 * For future agents: this is the preferred way to run live E2E tests
 * without manually setting CLAUDE_CODE_OAUTH_TOKEN. It reads the token
 * from ~/.craft-agent/credentials.enc using the same logic as the app.
 */

import { spawnSync } from 'child_process';
import { CredentialManager } from '../packages/shared/src/credentials/manager.ts';

async function main() {
  // Step 1: Extract token from credential store
  const manager = new CredentialManager();
  const creds = await manager.getClaudeOAuthCredentials();

  if (!creds?.accessToken) {
    process.stderr.write(
      'ERROR: No Claude OAuth token found in credentials store.\n' +
      'Make sure you have signed in to the app at least once with Claude Max.\n'
    );
    process.exit(1);
  }

  const { accessToken, expiresAt } = creds;

  if (expiresAt && expiresAt < Date.now()) {
    process.stderr.write(
      `WARNING: Token expired at ${new Date(expiresAt).toISOString()}.\n` +
      'Launch the app to refresh before running live tests.\n'
    );
    // Don't exit — SDK may auto-refresh via refresh token
  }

  console.log('[run-e2e-live] Token extracted from credential store, running live E2E tests...');

  // Step 2: Run live tests with token in environment
  const result = spawnSync(
    'npx',
    ['tsx', '--test', 'apps/electron/src/__tests__/e2e-sdk-live.test.ts'],
    {
      stdio: 'inherit',
      shell: true,
      env: {
        ...process.env,
        CLAUDE_CODE_OAUTH_TOKEN: accessToken,
      },
    }
  );

  process.exit(result.status ?? 1);
}

main().catch((err) => {
  process.stderr.write(`ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
