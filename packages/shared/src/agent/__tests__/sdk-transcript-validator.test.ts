import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getSdkConfigDir,
  slugifyCwd,
  getTranscriptPath,
  isResumableTranscript,
} from '../sdk-transcript-validator.ts';

describe('sdk-transcript-validator', () => {
  // ---- slugifyCwd ----
  describe('slugifyCwd', () => {
    it('replaces backslashes with dashes', () => {
      assert.equal(slugifyCwd('C:\\dev\\project'), 'C--dev-project');
    });

    it('replaces forward slashes with dashes', () => {
      assert.equal(slugifyCwd('/home/user/project'), '-home-user-project');
    });

    it('replaces colons with dashes', () => {
      assert.equal(slugifyCwd('C:'), 'C-');
    });

    it('handles mixed separators', () => {
      assert.equal(slugifyCwd('C:\\dev/mixed\\path'), 'C--dev-mixed-path');
    });

    it('handles paths without special characters', () => {
      assert.equal(slugifyCwd('simple'), 'simple');
    });

    it('handles Windows UNC-style paths', () => {
      assert.equal(slugifyCwd('\\\\server\\share'), '--server-share');
    });
  });

  // ---- getSdkConfigDir ----
  describe('getSdkConfigDir', () => {
    it('returns a non-empty string', () => {
      const dir = getSdkConfigDir();
      assert.ok(dir.length > 0, 'Config dir should be non-empty');
    });

    it('respects CLAUDE_CONFIG_DIR env variable', () => {
      const original = process.env.CLAUDE_CONFIG_DIR;
      try {
        process.env.CLAUDE_CONFIG_DIR = '/custom/config';
        assert.equal(getSdkConfigDir(), '/custom/config');
      } finally {
        if (original !== undefined) {
          process.env.CLAUDE_CONFIG_DIR = original;
        } else {
          delete process.env.CLAUDE_CONFIG_DIR;
        }
      }
    });
  });

  // ---- getTranscriptPath ----
  describe('getTranscriptPath', () => {
    it('builds correct path from sdkCwd and sessionId', () => {
      const path = getTranscriptPath('/home/user/project', 'abc-123');
      const configDir = getSdkConfigDir();
      const expected = join(configDir, 'projects', '-home-user-project', 'abc-123.jsonl');
      assert.equal(path, expected);
    });

    it('handles Windows cwd', () => {
      const path = getTranscriptPath('C:\\dev\\project', 'session-456');
      const configDir = getSdkConfigDir();
      const expected = join(configDir, 'projects', 'C--dev-project', 'session-456.jsonl');
      assert.equal(path, expected);
    });
  });

  // ---- isResumableTranscript ----
  describe('isResumableTranscript', () => {
    const testDir = join(tmpdir(), 'craft-transcript-validator-test');
    const testCwd = join(testDir, 'test-cwd');

    // Create a fake .claude/projects/ structure for testing
    function setupTestTranscript(sessionId: string, content: string): void {
      const slug = slugifyCwd(testCwd);
      const configDir = join(testDir, '.claude');
      const projectDir = join(configDir, 'projects', slug);
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(join(projectDir, `${sessionId}.jsonl`), content, 'utf-8');

      // Temporarily override config dir
      process.env.CLAUDE_CONFIG_DIR = configDir;
    }

    function cleanupTest(): void {
      delete process.env.CLAUDE_CONFIG_DIR;
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    }

    it('returns false for missing file', () => {
      process.env.CLAUDE_CONFIG_DIR = join(testDir, '.claude');
      try {
        assert.equal(isResumableTranscript(testCwd, 'nonexistent'), false);
      } finally {
        delete process.env.CLAUDE_CONFIG_DIR;
      }
    });

    it('returns false for small file (dequeue-only)', () => {
      try {
        // Simulate a dequeue-only transcript (≈139 bytes)
        const dequeueContent = '{"type":"queue-operation","operation":"dequeue","timestamp":"2026-02-27T10:00:00.000Z"}\n';
        setupTestTranscript('small-session', dequeueContent);
        assert.equal(isResumableTranscript(testCwd, 'small-session'), false);
      } finally {
        cleanupTest();
      }
    });

    it('returns false for large file without assistant content', () => {
      try {
        // Large file but no assistant message
        const lines: string[] = [];
        for (let i = 0; i < 20; i++) {
          lines.push(JSON.stringify({ type: 'user', message: { content: `Message ${i} `.repeat(10) } }));
        }
        setupTestTranscript('no-assistant', lines.join('\n'));
        assert.equal(isResumableTranscript(testCwd, 'no-assistant'), false);
      } finally {
        cleanupTest();
      }
    });

    it('returns true for valid transcript with assistant message', () => {
      try {
        const lines = [
          JSON.stringify({ type: 'system', subtype: 'init', session_id: 'valid-session' }),
          JSON.stringify({ type: 'user', message: { content: 'Hello world '.repeat(20) } }),
          JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello! How can I help? '.repeat(20) }] } }),
        ];
        setupTestTranscript('valid-session', lines.join('\n'));
        assert.equal(isResumableTranscript(testCwd, 'valid-session'), true);
      } finally {
        cleanupTest();
      }
    });

    it('returns false gracefully on any error', () => {
      // With no CLAUDE_CONFIG_DIR override and a non-existent cwd, should return false
      assert.equal(isResumableTranscript('/nonexistent/path/xyz', 'fake-id'), false);
    });
  });
});
