/**
 * E2E Stage Gate Tests
 *
 * Tests full agent lifecycle flows using real FS and the stage-gate handler.
 * Validates pause enforcement, pauseInstructions propagation, pause-lock,
 * and resume unlocking.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { E2ESessionHarness } from './e2e-utils.ts';

describe('E2E Stage Gate', () => {
  let harness: E2ESessionHarness;

  afterEach(() => {
    harness?.cleanup();
  });

  // ============================================================
  // Test 1: reset → start(0) → complete(0) triggers pause
  // ============================================================

  it('stage-gate reset→start(0)→complete(0) triggers pause', async () => {
    harness = E2ESessionHarness.create();

    const result = await harness.runToStage0Pause({ query_plan: 'test plan' });

    // Verify pause was triggered
    assert.equal(result.pauseRequired, true, 'pauseRequired should be true after complete(0)');
    assert.equal(result.allowed, false, 'allowed should be false when paused');

    // Verify callback was fired
    harness.assertPauseAt(0);

    // Verify run state persistence
    const state = harness.readRunState();
    assert.equal(state.pausedAtStage, 0, 'run state should show pausedAtStage=0');

    // Verify event log has correct sequence
    // Note: start(0) emits 'agent_run_started', not 'stage_started'
    harness.assertStageTransitions([
      'agent_run_started',
      'stage_completed',
      'stage_gate_pause',
    ]);
  });

  // ============================================================
  // Test 2: pauseInstructions appear in complete(0) reason text
  // ============================================================

  it('pauseInstructions appear in complete(0) tool result reason text', async () => {
    const pauseText = 'Present a concise 2-3 sentence clarification question to the user.';
    harness = E2ESessionHarness.create({ pauseInstructions: pauseText });

    const result = await harness.runToStage0Pause({ query_plan: 'test' });

    assert.equal(result.pauseRequired, true);
    assert.ok(
      (result.reason as string).includes(pauseText),
      `Expected reason to contain pauseInstructions text. Got: ${result.reason}`,
    );
  });

  // ============================================================
  // Test 3: pause-locked state prevents start(1) until resume
  // ============================================================

  it('pause-locked state prevents start(1) until resume action', async () => {
    harness = E2ESessionHarness.create();

    await harness.runToStage0Pause({ query_plan: 'test' });

    // Attempting to start stage 1 while paused should fail
    const startResult = await harness.gate('start', 1);
    assert.equal(startResult.allowed, false, 'start(1) should be blocked while paused at stage 0');
    assert.ok(
      (startResult.reason as string).toLowerCase().includes('pause'),
      `Reason should mention pause state. Got: ${startResult.reason}`,
    );

    // Also verify complete is blocked
    const completeResult = await harness.gate('complete', 0);
    assert.equal(completeResult.allowed, false, 'complete(0) again should be blocked while paused');
  });

  // ============================================================
  // Test 4: resume action unlocks and allows start(1)
  // ============================================================

  it('resume action unlocks and allows start(1)', async () => {
    harness = E2ESessionHarness.create();

    await harness.runToStage0Pause({ query_plan: 'test' });

    // Resume with proceed
    const resumeResult = await harness.gate('resume', undefined, { decision: 'proceed' });
    assert.equal(resumeResult.allowed, true, 'resume-proceed should be allowed');
    assert.equal(resumeResult.nextStage, 1, 'next stage should be 1');

    // Now start(1) should succeed
    const startResult = await harness.gate('start', 1);
    assert.equal(startResult.allowed, true, 'start(1) should be allowed after resume');
    assert.equal(startResult.currentStage, 1);

    // Verify event log shows the full lifecycle
    harness.assertStageTransitions([
      'agent_run_started',   // start(0)
      'stage_completed',     // complete(0)
      'stage_gate_pause',    // pause
      'stage_gate_resumed',  // resume
      'stage_started',       // start(1)
    ]);
  });

  // ============================================================
  // Test 5: pauseInstructions pass through verbatim (no wrapper mangling)
  // ============================================================

  it('complete(0) tool result reason passes pauseInstructions through verbatim', async () => {
    const customInstructions = 'TEST_MARKER: Use MODE A if clear, MODE B if ambiguous. No tables.';
    harness = E2ESessionHarness.create({ pauseInstructions: customInstructions });

    const result = await harness.runToStage0Pause({ query_plan: 'test' });
    const reason = result.reason as string;

    assert.ok(
      reason.includes(customInstructions),
      `Expected reason to contain the full pauseInstructions verbatim. Got: ${reason}`,
    );
  });

  // ============================================================
  // Test 6: without pauseInstructions, fallback text is used
  // ============================================================

  it('complete(0) tool result reason uses fallback text when no pauseInstructions', async () => {
    // Default harness uses TEST_AGENT_CONFIG which has no pauseInstructions on stage 0
    harness = E2ESessionHarness.create();

    const result = await harness.runToStage0Pause({ query_plan: 'test' });
    const reason = result.reason as string;

    assert.ok(
      reason.includes('Present a clear, concise summary'),
      `Expected fallback reason text. Got: ${reason}`,
    );
  });
});
