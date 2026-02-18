/**
 * E2E Stage 0 Pause Tests
 *
 * Comprehensive tests for the Stage 0 pause lifecycle using real ISA agent config.
 * Validates pause enforcement, run state persistence, event log integrity,
 * and pauseInstructions propagation.
 *
 * These tests use the mock stage-gate handler (no network calls).
 * Run: npx tsx --test apps/electron/src/__tests__/e2e-stage0-pause.test.ts
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import {
  E2ESessionHarness,
} from '../../../../packages/session-tools-core/src/handlers/__tests__/e2e-utils.ts';
import {
  validateAgentEventsLog,
  validateRunState,
  assertEventSequence,
  assertPauseOutcome,
} from '../../../../packages/session-tools-core/src/handlers/__tests__/e2e-session-validators.ts';

// Use real ISA agent config from the project
const ISA_AGENT_CONFIG_PATH = join(
  process.cwd(),
  'agents',
  'isa-deep-research',
  'config.json',
);

function loadRealISAConfig(): Record<string, unknown> {
  if (!existsSync(ISA_AGENT_CONFIG_PATH)) {
    // Fall back to test default if real config not available (CI)
    return {};
  }
  return JSON.parse(readFileSync(ISA_AGENT_CONFIG_PATH, 'utf-8')) as Record<string, unknown>;
}

describe('E2E Stage 0 Pause (ISA Agent Config)', () => {
  let harness: E2ESessionHarness;

  afterEach(() => {
    harness?.cleanup();
  });

  // ============================================================
  // Test 1: Full Stage 0 flow with real ISA config
  // ============================================================

  it('complete stage 0 flow triggers pause with correct artifacts', async () => {
    const realConfig = loadRealISAConfig();

    // Create harness — if real config is available, use it; else use default
    if (Object.keys(realConfig).length > 0) {
      harness = E2ESessionHarness.create({ agentConfig: realConfig });
    } else {
      harness = E2ESessionHarness.create();
    }

    // Full Stage 0 lifecycle
    await harness.gate('reset', undefined, { force: true });
    await harness.gate('start', 0);
    const completeResult = await harness.gate('complete', 0, {
      query_plan: {
        original_query: 'What does ISA 315 require for risk assessment in audit planning?',
        sub_queries: ['ISA 315 risk assessment requirements', 'audit planning procedures'],
        depth_mode: 'standard',
        assumptions: ['Focus on revised ISA 315 (2019)'],
        recommended_action: 'proceed',
      },
    });

    // Assert 1-3: Outcome-based assertion — verifies pause occurred at stage 0
    // regardless of Task-nested vs top-level execution pattern.
    // Checks: (a) event log has stage_gate_pause at stage 0,
    //         (b) run state has pausedAtStage=0,
    //         (c) onAgentStagePause called exactly once at stage 0
    assertPauseOutcome(harness.ctx, harness.agentSlug, harness.callbacks, 0);

    // Also validate event log structure is well-formed
    const events = validateAgentEventsLog(harness.ctx, harness.agentSlug);
    assertEventSequence(events, [
      'agent_run_started',
      'stage_completed',
      'stage_gate_pause',
    ]);

    // Assert 4: Tool result has pauseRequired flag and reason text
    assert.equal(completeResult.pauseRequired, true, 'pauseRequired should be true');
    assert.equal(completeResult.allowed, false, 'allowed should be false when paused');
    assert.ok(
      typeof completeResult.reason === 'string' && (completeResult.reason as string).length > 0,
      `Reason should be a non-empty string, got: ${typeof completeResult.reason}`,
    );
  });

  // ============================================================
  // Test 2: pauseInstructions from ISA config appear in tool result
  // ============================================================

  it('pauseInstructions from real ISA config appear in tool result reason', async () => {
    const realConfig = loadRealISAConfig();
    const config = realConfig as { controlFlow?: { stages?: Array<{ pauseInstructions?: string }> } };
    const pauseInstructions = config?.controlFlow?.stages?.[0]?.pauseInstructions;

    if (!pauseInstructions) {
      // Skip if no real config or no pauseInstructions
      harness = E2ESessionHarness.create({
        pauseInstructions: 'Briefly confirm your understanding of the user question.',
      });
    } else {
      harness = E2ESessionHarness.create({ agentConfig: realConfig });
    }

    const result = await harness.runToStage0Pause({
      query_plan: {
        original_query: 'test',
        sub_queries: ['test'],
        depth_mode: 'standard',
      },
    });

    const expectedText = pauseInstructions || 'Briefly confirm your understanding';
    assert.ok(
      (result.reason as string).includes(expectedText),
      `Expected reason to contain pauseInstructions text "${expectedText.substring(0, 50)}...". Got: ${(result.reason as string).substring(0, 200)}`,
    );
  });

  // ============================================================
  // Test 3: Paused state blocks all further stage operations
  // ============================================================

  it('paused state after stage 0 blocks start(1), complete(0), and start(0)', async () => {
    harness = E2ESessionHarness.create();
    await harness.runToStage0Pause({ query_plan: { original_query: 'test', sub_queries: ['s1'], depth_mode: 'quick' } });

    // start(1) blocked
    const start1 = await harness.gate('start', 1);
    assert.equal(start1.allowed, false, 'start(1) should be blocked while paused');

    // complete(0) blocked (already completed)
    const complete0 = await harness.gate('complete', 0);
    assert.equal(complete0.allowed, false, 'complete(0) again should be blocked while paused');

    // start(0) blocked (already started/completed)
    const start0 = await harness.gate('start', 0);
    assert.equal(start0.allowed, false, 'start(0) should be blocked while paused');
  });

  // ============================================================
  // Test 4: Resume-proceed unlocks next stage
  // ============================================================

  it('resume-proceed after stage 0 pause unlocks start(1)', async () => {
    harness = E2ESessionHarness.create();
    await harness.runToStage0Pause({ query_plan: { original_query: 'test', sub_queries: ['s1'], depth_mode: 'quick' } });

    // Resume
    const resumeResult = await harness.gate('resume', undefined, { decision: 'proceed' });
    assert.equal(resumeResult.allowed, true, 'resume-proceed should be allowed');
    assert.equal(resumeResult.nextStage, 1, 'next stage after resume should be 1');

    // start(1) now allowed
    const start1 = await harness.gate('start', 1);
    assert.equal(start1.allowed, true, 'start(1) should be allowed after resume');
  });

  // ============================================================
  // Test 5: Resume-abort terminates pipeline
  // ============================================================

  it('resume-abort after stage 0 pause terminates pipeline', async () => {
    harness = E2ESessionHarness.create();
    await harness.runToStage0Pause({ query_plan: { original_query: 'test', sub_queries: ['s1'], depth_mode: 'quick' } });

    // Resume with abort
    const resumeResult = await harness.gate('resume', undefined, { decision: 'abort' });
    assert.equal(resumeResult.allowed, true, 'resume-abort should be allowed');
    assert.equal(resumeResult.aborted, true, 'aborted flag should be true');
  });

  // ============================================================
  // Test 6: Session directory contains expected artifacts
  // ============================================================

  it('session directory contains expected agent artifacts after stage 0', async () => {
    harness = E2ESessionHarness.create();
    await harness.runToStage0Pause({ query_plan: { original_query: 'test', sub_queries: ['s1'], depth_mode: 'quick' } });

    const agentDataDir = join(
      harness.ctx.workspacePath, 'sessions', harness.ctx.sessionId,
      'data', 'agents', harness.agentSlug,
    );

    // Check events log exists
    assert.ok(
      harness.ctx.fs.exists(join(agentDataDir, 'agent-events.jsonl')),
      'agent-events.jsonl should exist',
    );

    // Check run state exists
    assert.ok(
      harness.ctx.fs.exists(join(agentDataDir, 'current-run-state.json')),
      'current-run-state.json should exist',
    );
  });
});
