/**
 * Debug Context Writer — Tests
 *
 * Tests:
 * - 8.6: writeDebugContextFile creates file in correct directory with correct format
 * - 8.7: rotateDebugContextFiles caps at max files
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { writeDebugContextFile, rotateDebugContextFiles } from '../src/sessions/debug-context-writer.ts';

describe('Debug Context Writer', () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // ============================================================
  // 8.6: writeDebugContextFile
  // ============================================================

  describe('writeDebugContextFile', () => {
    it('should create a file in the correct directory', () => {
      tempDir = mkdtempSync(join(tmpdir(), 'debug-writer-test-'));
      const sessionPath = tempDir;
      const agentSlug = 'test-agent';

      writeDebugContextFile({
        sessionPath,
        agentSlug,
        stage: 1,
        stageName: 'retrieve',
        step: 'main',
        turnIndex: 0,
        model: 'claude-opus-4-6',
        durationMs: 1234,
        usage: { inputTokens: 500, outputTokens: 200, cacheReadTokens: 50 },
        systemPrompt: 'You are a research assistant.',
        userMessage: 'What is quantum computing?',
        response: 'Quantum computing leverages quantum mechanics...',
      });

      const contextsDir = join(sessionPath, 'data', 'agents', agentSlug, 'contexts');
      const files = readdirSync(contextsDir).filter(f => f.endsWith('.txt'));
      assert.equal(files.length, 1, 'Should create exactly one file');
      assert.ok(files[0]!.startsWith('context_'), 'File should start with "context_"');
      assert.ok(files[0]!.includes('stage1'), 'File should include stage number');
      assert.ok(files[0]!.includes('main'), 'File should include step name');
    });

    it('should contain structured header and content sections', () => {
      tempDir = mkdtempSync(join(tmpdir(), 'debug-writer-test-'));
      const sessionPath = tempDir;
      const agentSlug = 'test-agent';

      writeDebugContextFile({
        sessionPath,
        agentSlug,
        stage: 2,
        stageName: 'synthesize',
        step: 'repair_iter1',
        turnIndex: 3,
        model: 'claude-sonnet-4-20250514',
        durationMs: 5678,
        usage: { inputTokens: 1000, outputTokens: 500 },
        systemPrompt: 'System prompt here.',
        userMessage: 'User message here.',
        response: 'Response text here.',
      });

      const contextsDir = join(sessionPath, 'data', 'agents', agentSlug, 'contexts');
      const files = readdirSync(contextsDir).filter(f => f.endsWith('.txt'));
      const content = readFileSync(join(contextsDir, files[0]!), 'utf-8');

      // Check header
      assert.ok(content.includes('=== Debug Context Capture ==='), 'Should have header marker');
      assert.ok(content.includes('Agent: test-agent'), 'Should include agent slug');
      assert.ok(content.includes('Stage: 2 (synthesize)'), 'Should include stage info');
      assert.ok(content.includes('Step: repair_iter1'), 'Should include step');
      assert.ok(content.includes('Turn: 3'), 'Should include turn index');
      assert.ok(content.includes('Model: claude-sonnet-4-20250514'), 'Should include model');
      assert.ok(content.includes('Duration: 5678ms'), 'Should include duration');
      assert.ok(content.includes('Input Tokens: 1000'), 'Should include input tokens');
      assert.ok(content.includes('Output Tokens: 500'), 'Should include output tokens');

      // Check content sections
      assert.ok(content.includes('--- SYSTEM PROMPT ---'), 'Should have system prompt section');
      assert.ok(content.includes('System prompt here.'), 'Should include system prompt text');
      assert.ok(content.includes('--- USER MESSAGE ---'), 'Should have user message section');
      assert.ok(content.includes('User message here.'), 'Should include user message text');
      assert.ok(content.includes('--- RESPONSE ---'), 'Should have response section');
      assert.ok(content.includes('Response text here.'), 'Should include response text');
    });

    it('should handle null durationMs', () => {
      tempDir = mkdtempSync(join(tmpdir(), 'debug-writer-test-'));

      writeDebugContextFile({
        sessionPath: tempDir,
        agentSlug: 'test-agent',
        stage: 0,
        stageName: 'analyze',
        step: 'sdk_turn_0',
        turnIndex: 0,
        model: 'test-model',
        durationMs: null,
        usage: { inputTokens: 100, outputTokens: 50 },
        systemPrompt: 'sp',
        userMessage: 'um',
        response: 'r',
      });

      const contextsDir = join(tempDir, 'data', 'agents', 'test-agent', 'contexts');
      const files = readdirSync(contextsDir).filter(f => f.endsWith('.txt'));
      const content = readFileSync(join(contextsDir, files[0]!), 'utf-8');
      assert.ok(content.includes('Duration: N/A'), 'Should show N/A for null duration');
    });
  });

  // ============================================================
  // 8.7: rotateDebugContextFiles
  // ============================================================

  describe('rotateDebugContextFiles', () => {
    it('should delete oldest files when count exceeds maxFiles', () => {
      tempDir = mkdtempSync(join(tmpdir(), 'debug-rotate-test-'));
      const contextsDir = join(tempDir, 'contexts');
      mkdirSync(contextsDir, { recursive: true });

      // Create 101 files with sortable names
      for (let i = 0; i < 101; i++) {
        const name = `context_20250305-${String(i).padStart(6, '0')}_stage1_main.txt`;
        writeFileSync(join(contextsDir, name), `content ${i}`, 'utf-8');
      }

      assert.equal(
        readdirSync(contextsDir).filter(f => f.endsWith('.txt')).length,
        101,
        'Should start with 101 files',
      );

      rotateDebugContextFiles(contextsDir, 100);

      const remaining = readdirSync(contextsDir).filter(f => f.endsWith('.txt'));
      assert.equal(remaining.length, 100, 'Should have exactly 100 files after rotation');

      // The oldest file (000000) should be deleted
      assert.ok(
        !remaining.includes('context_20250305-000000_stage1_main.txt'),
        'Oldest file should be deleted',
      );
      // The newest file (000100) should remain
      assert.ok(
        remaining.includes('context_20250305-000100_stage1_main.txt'),
        'Newest file should remain',
      );
    });

    it('should not delete files when under the cap', () => {
      tempDir = mkdtempSync(join(tmpdir(), 'debug-rotate-test-'));
      const contextsDir = join(tempDir, 'contexts');
      mkdirSync(contextsDir, { recursive: true });

      // Create 50 files
      for (let i = 0; i < 50; i++) {
        const name = `context_20250305-${String(i).padStart(6, '0')}_stage1_main.txt`;
        writeFileSync(join(contextsDir, name), `content ${i}`, 'utf-8');
      }

      rotateDebugContextFiles(contextsDir, 100);

      const remaining = readdirSync(contextsDir).filter(f => f.endsWith('.txt'));
      assert.equal(remaining.length, 50, 'All 50 files should remain');
    });

    it('should be safe when directory does not exist', () => {
      // Should not throw
      rotateDebugContextFiles('/nonexistent/path/contexts', 100);
    });

    it('should ignore non-context files', () => {
      tempDir = mkdtempSync(join(tmpdir(), 'debug-rotate-test-'));
      const contextsDir = join(tempDir, 'contexts');
      mkdirSync(contextsDir, { recursive: true });

      // Create 101 context files
      for (let i = 0; i < 101; i++) {
        const name = `context_20250305-${String(i).padStart(6, '0')}_stage1_main.txt`;
        writeFileSync(join(contextsDir, name), `content ${i}`, 'utf-8');
      }
      // Create a non-context file
      writeFileSync(join(contextsDir, 'readme.txt'), 'ignore me', 'utf-8');
      writeFileSync(join(contextsDir, 'notes.md'), '# Notes', 'utf-8');

      rotateDebugContextFiles(contextsDir, 100);

      const allFiles = readdirSync(contextsDir);
      const contextFiles = allFiles.filter(f => f.startsWith('context_') && f.endsWith('.txt'));
      assert.equal(contextFiles.length, 100, 'Should cap at 100 context files');
      assert.ok(allFiles.includes('readme.txt'), 'Non-context .txt file should be preserved');
      assert.ok(allFiles.includes('notes.md'), 'Non-.txt file should be preserved');
    });
  });
});
