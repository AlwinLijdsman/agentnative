/**
 * Auth Debug Integration Tests
 *
 * Tests the getAuthDiagnostics() function from packages/shared/src/auth/state.ts.
 * Validates the diagnostics shape and env var detection.
 *
 * Note: These tests manipulate process.env so they must restore state in afterEach.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Dynamic import to avoid module-level initialization issues with credential manager
// Use relative path since session-tools-core doesn't depend on @craft-agent/shared
async function importAuthState() {
  return import('../../../../shared/src/auth/state.ts');
}

describe('Auth Diagnostics', () => {
  // Save original env vars
  const originalEnv: Record<string, string | undefined> = {};
  const envKeys = [
    'ANTHROPIC_AUTH_TOKEN',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_BASE_URL',
  ];

  beforeEach(() => {
    // Save and clear auth env vars
    for (const key of envKeys) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    // Restore original env vars
    for (const key of envKeys) {
      if (originalEnv[key] !== undefined) {
        process.env[key] = originalEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it('should return correct shape with no env vars set', async () => {
    const { getAuthDiagnostics, _resetDiagnosticsState } = await importAuthState();
    _resetDiagnosticsState();

    const diag = await getAuthDiagnostics();

    // Verify shape
    assert.ok(diag.envState, 'envState should exist');
    assert.equal(typeof diag.envState.hasAnthropicAuthToken, 'boolean');
    assert.equal(typeof diag.envState.hasClaudeCodeOAuthToken, 'boolean');
    assert.equal(typeof diag.envState.hasAnthropicApiKey, 'boolean');
    assert.equal(typeof diag.envState.hasAnthropicBaseUrl, 'boolean');

    // All should be false since we cleared env
    assert.equal(diag.envState.hasAnthropicAuthToken, false);
    assert.equal(diag.envState.hasClaudeCodeOAuthToken, false);
    assert.equal(diag.envState.hasAnthropicApiKey, false);
    assert.equal(diag.envState.hasAnthropicBaseUrl, false);

    // Token status should be 'none' with no env vars
    assert.equal(diag.tokenStatus, 'none');

    // Connection fields should exist
    assert.ok('activeConnection' in diag);
    assert.ok('lastRefreshAt' in diag);
    assert.equal(typeof diag.refreshInProgress, 'boolean');
  });

  it('should detect CLAUDE_CODE_OAUTH_TOKEN presence', async () => {
    const { getAuthDiagnostics } = await importAuthState();

    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'test-token-value';

    const diag = await getAuthDiagnostics();

    assert.equal(diag.envState.hasClaudeCodeOAuthToken, true);
    assert.equal(diag.envState.hasAnthropicApiKey, false);
    // Token status should not be 'none' since we have an OAuth token
    assert.notEqual(diag.tokenStatus, 'none');
  });

  it('should detect ANTHROPIC_API_KEY presence', async () => {
    const { getAuthDiagnostics } = await importAuthState();

    process.env.ANTHROPIC_API_KEY = 'sk-test-key';

    const diag = await getAuthDiagnostics();

    assert.equal(diag.envState.hasAnthropicApiKey, true);
    assert.equal(diag.envState.hasClaudeCodeOAuthToken, false);
    assert.equal(diag.tokenStatus, 'valid'); // API keys are always "valid"
  });

  it('should record and report token refresh timestamp', async () => {
    const { getAuthDiagnostics, recordTokenRefresh, _resetDiagnosticsState } = await importAuthState();
    _resetDiagnosticsState();

    // Initially no refresh
    let diag = await getAuthDiagnostics();
    assert.equal(diag.lastRefreshAt, null);

    // Record a refresh
    recordTokenRefresh();

    diag = await getAuthDiagnostics();
    assert.notEqual(diag.lastRefreshAt, null);
    // Should be a valid ISO date
    assert.ok(!isNaN(new Date(diag.lastRefreshAt!).getTime()), 'lastRefreshAt should be valid ISO date');
  });
});
