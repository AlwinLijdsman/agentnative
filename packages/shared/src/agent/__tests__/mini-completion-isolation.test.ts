/**
 * Tests for runMiniCompletion() cwd isolation
 *
 * Verifies that mini completions (title generation, summarization) use an
 * isolated cwd to prevent SDK transcript collision with the main chat.
 *
 * Root cause: Without cwd isolation, concurrent SDK subprocesses (e.g. title
 * generation firing alongside the first chat response) write transcripts to
 * the same ~/.claude/projects/<hash>/ directory, corrupting the main chat's
 * session transcript and causing resume failures.
 *
 * Bug evidence: 43% of sessions with sdkSessionId had missing transcripts
 * (lean-whale, silver-torrent, ruby-nebula).
 *
 * Strategy: Rather than instantiating ClaudeAgent (which has heavy constructor
 * side-effects and requires bun for mocking), we read the source code and verify
 * the options construction statically. This is deterministic and platform-safe.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read the source file to verify the fix is in place
const claudeAgentSource = readFileSync(
  join(__dirname, '..', 'claude-agent.ts'),
  'utf-8'
);

describe('runMiniCompletion cwd isolation', () => {
  // Extract the runMiniCompletion method body for inspection
  const methodStart = claudeAgentSource.indexOf('async runMiniCompletion(prompt: string)');
  const methodBody = claudeAgentSource.slice(methodStart, methodStart + 1200);

  it('should import tmpdir from node:os', () => {
    // Verify the import exists at module level
    assert.ok(
      claudeAgentSource.includes("import { tmpdir } from 'node:os'"),
      'claude-agent.ts must import tmpdir from node:os'
    );
  });

  it('should pass cwd: tmpdir() in the options object', () => {
    // Verify the options block includes cwd: tmpdir()
    assert.ok(
      methodBody.includes('cwd: tmpdir()'),
      'runMiniCompletion options must include cwd: tmpdir() to isolate SDK transcript storage'
    );
  });

  it('should set persistSession: false for ephemeral completions', () => {
    // Verify persistSession: false is in the options
    assert.ok(
      methodBody.includes('persistSession: false'),
      'runMiniCompletion options must include persistSession: false to prevent transcript accumulation'
    );
  });

  it('should have cwd AFTER getDefaultOptions() spread (not overridden)', () => {
    // The cwd must appear AFTER ...getDefaultOptions() so it overrides any default
    const spreadIdx = methodBody.indexOf('...getDefaultOptions()');
    const cwdIdx = methodBody.indexOf('cwd: tmpdir()');
    assert.ok(spreadIdx > 0, 'getDefaultOptions() spread must be present');
    assert.ok(cwdIdx > 0, 'cwd: tmpdir() must be present');
    assert.ok(
      cwdIdx > spreadIdx,
      'cwd: tmpdir() must appear AFTER ...getDefaultOptions() to ensure it overrides any default cwd'
    );
  });

  it('should have documentation comment explaining the race condition', () => {
    // Verify the JSDoc comment explains WHY cwd isolation is needed
    const docStart = claudeAgentSource.lastIndexOf('/**', methodStart);
    const docEnd = claudeAgentSource.indexOf('*/', docStart);
    const docComment = claudeAgentSource.slice(docStart, docEnd);

    assert.ok(
      docComment.includes('cwd') || docComment.includes('transcript'),
      'runMiniCompletion JSDoc must document the cwd isolation rationale'
    );
    assert.ok(
      docComment.includes('concurrent') || docComment.includes('collision'),
      'runMiniCompletion JSDoc must mention concurrency or collision risk'
    );
  });

  it('tmpdir() resolves to a valid string on this platform', () => {
    const tmp = tmpdir();
    assert.ok(typeof tmp === 'string', 'tmpdir() must return a string');
    assert.ok(tmp.length > 0, 'tmpdir() must return a non-empty path');
  });
});
