/**
 * Regression tests for session-expiry recovery (Section 22).
 *
 * Validates:
 * 1. isSessionExpiredError() — single source-of-truth helper used by both
 *    the event-loop (result-error) and catch (thrown-error) recovery paths.
 * 2. Detection is case-insensitive and format-tolerant.
 * 3. False-positive safety — unrelated errors are not matched.
 *
 * Integration-level chat() recovery cannot be meaningfully tested here because
 * CraftAgent.chat() is tightly coupled to the live SDK subprocess.
 * The helper unit tests guarantee that the correct decision is made at the
 * branch points; the branch wiring itself is verified via manual smoke test
 * and the SESSION_RECOVERY breadcrumb logs.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isSessionExpiredError } from '../claude-agent.ts';

// ============================================================================
// isSessionExpiredError — positive matches
// ============================================================================

describe('isSessionExpiredError', () => {
  describe('positive matches (should return true)', () => {
    it('matches exact API error message with UUID', () => {
      assert.equal(isSessionExpiredError(
        'No conversation found with session ID: 9e45a6b2-1234-5678-abcd-ef0123456789'
      ), true);
    });

    it('matches lowercased form (as used in catch-path errorMsg)', () => {
      assert.equal(isSessionExpiredError(
        'no conversation found with session id: 39fedf04-abcd-1234-5678-000000000000'
      ), true);
    });

    it('matches when embedded in longer stderr output', () => {
      const stderr = [
        '[ERROR] Something went wrong',
        'No conversation found with session ID: abc-123',
        'Process exited with code 1',
      ].join('\n');
      assert.equal(isSessionExpiredError(stderr), true);
    });

    it('matches mixed-case variant', () => {
      assert.equal(isSessionExpiredError(
        'NO CONVERSATION FOUND WITH SESSION ID: XYZ'
      ), true);
    });

    it('matches without trailing UUID (partial message)', () => {
      assert.equal(isSessionExpiredError(
        'No conversation found with session ID'
      ), true);
    });

    it('matches when prefixed by error wrapper text', () => {
      assert.equal(isSessionExpiredError(
        'Error: No conversation found with session ID: abc-def'
      ), true);
    });
  });

  // ============================================================================
  // isSessionExpiredError — negative matches (false-positive safety)
  // ============================================================================

  describe('negative matches (should return false)', () => {
    it('rejects null', () => {
      assert.equal(isSessionExpiredError(null), false);
    });

    it('rejects undefined', () => {
      assert.equal(isSessionExpiredError(undefined), false);
    });

    it('rejects empty string', () => {
      assert.equal(isSessionExpiredError(''), false);
    });

    it('rejects generic session error', () => {
      assert.equal(isSessionExpiredError('Session error occurred'), false);
    });

    it('rejects "process exited with code 1" without session text', () => {
      assert.equal(isSessionExpiredError(
        'Claude Code process exited with code 1'
      ), false);
    });

    it('rejects authentication errors', () => {
      assert.equal(isSessionExpiredError(
        'Authentication failed: invalid API key'
      ), false);
    });

    it('rejects billing errors', () => {
      assert.equal(isSessionExpiredError(
        '402 Payment required'
      ), false);
    });

    it('rejects rate limit errors', () => {
      assert.equal(isSessionExpiredError(
        '429 Too Many Requests'
      ), false);
    });

    it('rejects partial match "no conversation found"', () => {
      // Must include "with session id" to prevent over-matching
      assert.equal(isSessionExpiredError(
        'No conversation found'
      ), false);
    });

    it('rejects partial match "session id" alone', () => {
      assert.equal(isSessionExpiredError(
        'Invalid session ID format'
      ), false);
    });

    it('rejects unrelated SDK errors', () => {
      assert.equal(isSessionExpiredError(
        'CLI output was not valid JSON. This may indicate an error during startup.'
      ), false);
    });

    it('rejects config corruption errors', () => {
      assert.equal(isSessionExpiredError(
        'Error reading .claude.json: configuration file corrupted'
      ), false);
    });
  });

  // ============================================================================
  // isSessionExpiredError — edge-case robustness
  // ============================================================================

  describe('edge cases', () => {
    it('handles very long stderr with session error buried inside', () => {
      const longStderr = 'x'.repeat(10000) +
        '\nNo conversation found with session ID: test-uuid\n' +
        'y'.repeat(10000);
      assert.equal(isSessionExpiredError(longStderr), true);
    });

    it('handles whitespace-only string', () => {
      assert.equal(isSessionExpiredError('   \n\t  '), false);
    });

    it('handles string with only newlines', () => {
      assert.equal(isSessionExpiredError('\n\n\n'), false);
    });
  });
});
