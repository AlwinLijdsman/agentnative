/**
 * Agent Stage Gate — Integration Tests
 *
 * End-to-end tests exercising the full stage gate lifecycle including
 * schema validation, resume decisions, error escalation, repair loops,
 * and follow-up delta retrieval via agent state.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { handleAgentStageGate } from '../agent-stage-gate.ts';
import { handleAgentState } from '../agent-state.ts';
import {
  createExtendedTestAgentContext,
  createMockCallbacks,
  TEST_AGENT_SLUG,
  type TestContext,
} from './test-utils.ts';
import type { SessionToolContext } from '../../context.ts';

function parseResult(result: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(result.content[0]!.text);
}

async function gate(
  ctx: SessionToolContext,
  action: string,
  stage?: number,
  data?: Record<string, unknown>,
) {
  return handleAgentStageGate(ctx, {
    agentSlug: TEST_AGENT_SLUG,
    action: action as 'start' | 'complete' | 'repair' | 'start_repair_unit' | 'end_repair_unit' | 'status' | 'reset' | 'resume',
    stage,
    data,
  });
}

// ============================================================
// Happy Path Pipeline
// ============================================================

describe('Integration: Happy Path Pipeline', () => {
  let ctx: TestContext;

  beforeEach(() => {
    const callbacks = createMockCallbacks();
    ctx = createExtendedTestAgentContext({ callbacks });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('should complete full 5-stage pipeline', async () => {
    // Stage 0
    await gate(ctx, 'start', 0);
    const s0 = parseResult(await gate(ctx, 'complete', 0, {
      query_plan: { original_query: 'test', sub_queries: ['q1'], depth_mode: 'standard' },
    }));
    assert.equal(s0.allowed, true);
    assert.equal(s0.pauseRequired, true);
    assert.equal(s0.validationWarnings, undefined); // Valid data

    // Resume after pause
    const resume = parseResult(await gate(ctx, 'resume', undefined, { decision: 'proceed' }));
    assert.equal(resume.allowed, true);
    assert.equal(resume.nextStage, 1);

    // Stages 1-4
    for (let s = 1; s <= 4; s++) {
      await gate(ctx, 'start', s);
      await gate(ctx, 'complete', s, { stage_data: `stage_${s}_output` });
    }

    const status = parseResult(await gate(ctx, 'status'));
    assert.deepEqual(status.completedStages, [0, 1, 2, 3, 4]);
  });

  it('should pause after Stage 0 and resume-proceed', async () => {
    const callbacks = ctx.callbacks as ReturnType<typeof createMockCallbacks>;

    await gate(ctx, 'start', 0);
    await gate(ctx, 'complete', 0, {
      query_plan: { original_query: 'test', sub_queries: ['q1'], depth_mode: 'deep' },
    });

    // Verify pause was triggered
    assert.equal(callbacks.onAgentStagePause.callCount, 1);

    // Resume
    const r = parseResult(await gate(ctx, 'resume', undefined, { decision: 'proceed' }));
    assert.equal(r.nextStage, 1);
  });

  it('should produce valid schema-conforming output for all stages', async () => {
    await gate(ctx, 'start', 0);
    const s0 = parseResult(await gate(ctx, 'complete', 0, {
      query_plan: { original_query: 'ISA 315', sub_queries: ['q1', 'q2'], depth_mode: 'standard' },
    }));
    assert.equal(s0.validationWarnings, undefined);

    await gate(ctx, 'resume', undefined, { decision: 'proceed' });

    // Stages 1-4 don't have schemas in the extended config (only stage 0 does)
    for (let s = 1; s <= 4; s++) {
      await gate(ctx, 'start', s);
      const result = parseResult(await gate(ctx, 'complete', s));
      assert.equal(result.validationWarnings, undefined);
    }
  });
});

// ============================================================
// Repair Loop Lifecycle
// ============================================================

describe('Integration: Repair Loop Lifecycle', () => {
  let ctx: TestContext;

  beforeEach(() => {
    const callbacks = createMockCallbacks();
    ctx = createExtendedTestAgentContext({ callbacks });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  async function advancePastStage0() {
    await gate(ctx, 'start', 0);
    await gate(ctx, 'complete', 0, {
      query_plan: { original_query: 'test', sub_queries: ['q1'], depth_mode: 'standard' },
    });
    await gate(ctx, 'resume', undefined, { decision: 'proceed' });
  }

  it('should repair after verification failure, then pass', async () => {
    await advancePastStage0();

    // Stage 1: Retrieve
    await gate(ctx, 'start', 1);
    await gate(ctx, 'complete', 1, { retrieval: 'data' });

    // Stage 2: Synthesize (first attempt)
    await gate(ctx, 'start', 2);
    await gate(ctx, 'complete', 2, { synthesis: 'v1' });

    // Stage 3: Verify (fails)
    await gate(ctx, 'start', 3);
    await gate(ctx, 'complete', 3, {
      verification_scores: { eg: 0.6 },
      all_passed: false,
      repair_instructions: { failed_axes: ['entity_grounding'] },
    });

    // Start repair unit
    await gate(ctx, 'start_repair_unit');
    await gate(ctx, 'repair'); // iteration 1

    // Re-synthesize
    await gate(ctx, 'start', 2);
    await gate(ctx, 'complete', 2, { synthesis: 'v2_improved' });

    // Re-verify (passes)
    await gate(ctx, 'start', 3);
    await gate(ctx, 'complete', 3, {
      verification_scores: { eg: 0.95 },
      all_passed: true,
    });

    // End repair
    await gate(ctx, 'end_repair_unit');

    // Continue to output
    await gate(ctx, 'start', 4);
    await gate(ctx, 'complete', 4, { answer_delivered: true });

    const status = parseResult(await gate(ctx, 'status'));
    assert.deepEqual(status.completedStages, [0, 1, 2, 3, 4]);
  });

  it('should hit max repair iterations and proceed with best attempt', async () => {
    await advancePastStage0();
    await gate(ctx, 'start', 1);
    await gate(ctx, 'complete', 1);

    // First pass
    await gate(ctx, 'start', 2);
    await gate(ctx, 'complete', 2, { synthesis: 'v1' });
    await gate(ctx, 'start', 3);
    await gate(ctx, 'complete', 3, { all_passed: false });

    await gate(ctx, 'start_repair_unit');

    // Iteration 1
    await gate(ctx, 'repair');
    await gate(ctx, 'start', 2);
    await gate(ctx, 'complete', 2, { synthesis: 'v2' });
    await gate(ctx, 'start', 3);
    await gate(ctx, 'complete', 3, { all_passed: false });

    // Iteration 2 — should be blocked (maxIterations=2)
    const r2 = parseResult(await gate(ctx, 'repair'));
    assert.equal(r2.allowed, false);
    assert.ok((r2.reason as string).includes('Max repair iterations'));

    // End repair unit and proceed
    await gate(ctx, 'end_repair_unit');
    await gate(ctx, 'start', 4);
    const s4 = parseResult(await gate(ctx, 'complete', 4, { answer_delivered: true }));
    assert.equal(s4.allowed, true);
  });

  it('should track repair iteration in schema validation', async () => {
    await advancePastStage0();
    await gate(ctx, 'start', 1);
    await gate(ctx, 'complete', 1);

    await gate(ctx, 'start', 2);
    await gate(ctx, 'complete', 2);
    await gate(ctx, 'start', 3);
    await gate(ctx, 'complete', 3, { all_passed: false });

    await gate(ctx, 'start_repair_unit');
    await gate(ctx, 'repair');

    // Re-run stage 2 inside repair
    await gate(ctx, 'start', 2);
    const result = parseResult(await gate(ctx, 'complete', 2, { synthesis: 'v2' }));
    assert.equal(result.repairIteration, 1);
    assert.equal(result.repairUnitActive, true);
  });
});

// ============================================================
// Resume Decisions
// ============================================================

describe('Integration: Resume Decisions', () => {
  let ctx: TestContext;

  beforeEach(() => {
    const callbacks = createMockCallbacks();
    ctx = createExtendedTestAgentContext({ callbacks });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('should pass modifications from resume to next stage', async () => {
    await gate(ctx, 'start', 0);
    await gate(ctx, 'complete', 0, {
      query_plan: { original_query: 'test', sub_queries: ['q1'], depth_mode: 'standard' },
    });

    await gate(ctx, 'resume', undefined, {
      decision: 'modify',
      modifications: { adjusted_queries: ['new_q1', 'new_q2'] },
    });

    const startResult = parseResult(await gate(ctx, 'start', 1));
    assert.deepEqual(startResult.modifications, { adjusted_queries: ['new_q1', 'new_q2'] });
  });

  it('should cleanly abort and allow new run', async () => {
    await gate(ctx, 'start', 0);
    await gate(ctx, 'complete', 0, {
      query_plan: { original_query: 'test', sub_queries: ['q1'], depth_mode: 'quick' },
    });

    const abortResult = parseResult(await gate(ctx, 'resume', undefined, {
      decision: 'abort',
      reason: 'Wrong query',
    }));
    assert.equal(abortResult.aborted, true);

    // Should be able to start a new run
    const newRun = parseResult(await gate(ctx, 'start', 0));
    assert.equal(newRun.allowed, true);
  });

  it('should handle resume from error escalation pause', async () => {
    await gate(ctx, 'start', 0);
    await gate(ctx, 'complete', 0, {
      query_plan: { original_query: 'test', sub_queries: ['q1'], depth_mode: 'standard' },
    });
    await gate(ctx, 'resume', undefined, { decision: 'proceed' });

    // Stage 1 with auth error
    await gate(ctx, 'start', 1);
    const errResult = parseResult(await gate(ctx, 'complete', 1, {
      error: 'Unauthorized: invalid API key',
    }));
    assert.equal(errResult.pauseRequired, true);
    assert.ok(errResult.errorClassification);

    // Resume after error pause
    const resumeResult = parseResult(await gate(ctx, 'resume', undefined, { decision: 'proceed' }));
    assert.equal(resumeResult.allowed, true);
    assert.equal(resumeResult.nextStage, 2);
  });
});

// ============================================================
// Follow-Up Delta
// ============================================================

describe('Integration: Follow-Up Delta', () => {
  let ctx: TestContext;

  beforeEach(() => {
    const callbacks = createMockCallbacks();
    ctx = createExtendedTestAgentContext({ callbacks });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('should persist state across runs', async () => {
    // Initialize state
    await handleAgentState(ctx, { agentSlug: TEST_AGENT_SLUG, action: 'init' });

    // First run
    await gate(ctx, 'start', 0);
    await gate(ctx, 'complete', 0, {
      query_plan: { original_query: 'ISA 315', sub_queries: ['q1'], depth_mode: 'standard' },
    });
    await gate(ctx, 'resume', undefined, { decision: 'proceed' });
    for (let s = 1; s <= 4; s++) {
      await gate(ctx, 'start', s);
      await gate(ctx, 'complete', s);
    }

    // Update state after first run
    await handleAgentState(ctx, {
      agentSlug: TEST_AGENT_SLUG,
      action: 'update',
      data: { queriesSoFar: ['ISA 315'], totalRuns: 1 },
    });

    // Read state
    const state1 = parseResult(await handleAgentState(ctx, {
      agentSlug: TEST_AGENT_SLUG,
      action: 'read',
    }));
    const s1 = state1.state as Record<string, unknown>;
    assert.deepEqual(s1.queriesSoFar, ['ISA 315']);
    assert.equal(s1.totalRuns, 1);

    // Reset for second run
    await gate(ctx, 'reset');

    // Second run
    await gate(ctx, 'start', 0);
    await gate(ctx, 'complete', 0, {
      query_plan: { original_query: 'ISA 500', sub_queries: ['q2'], depth_mode: 'quick' },
    });

    // Read state — should still have first run data
    const state2 = parseResult(await handleAgentState(ctx, {
      agentSlug: TEST_AGENT_SLUG,
      action: 'read',
    }));
    const s2 = state2.state as Record<string, unknown>;
    assert.deepEqual(s2.queriesSoFar, ['ISA 315']);
    assert.equal(s2.totalRuns, 1);

    // Update with combined data
    await handleAgentState(ctx, {
      agentSlug: TEST_AGENT_SLUG,
      action: 'update',
      data: { queriesSoFar: ['ISA 315', 'ISA 500'], totalRuns: 2 },
    });

    const state3 = parseResult(await handleAgentState(ctx, {
      agentSlug: TEST_AGENT_SLUG,
      action: 'read',
    }));
    const s3 = state3.state as Record<string, unknown>;
    assert.deepEqual(s3.queriesSoFar, ['ISA 315', 'ISA 500']);
    assert.equal(s3.totalRuns, 2);
  });

  it('should init state and verify it persists', async () => {
    await handleAgentState(ctx, { agentSlug: TEST_AGENT_SLUG, action: 'init' });
    const stateResult = parseResult(await handleAgentState(ctx, {
      agentSlug: TEST_AGENT_SLUG,
      action: 'read',
    }));
    assert.equal(stateResult.initialized, true);

    await handleAgentState(ctx, {
      agentSlug: TEST_AGENT_SLUG,
      action: 'update',
      data: { key: 'value' },
    });

    const updated = parseResult(await handleAgentState(ctx, {
      agentSlug: TEST_AGENT_SLUG,
      action: 'read',
    }));
    assert.equal((updated.state as Record<string, unknown>).key, 'value');
  });
});

// ============================================================
// Error Recovery
// ============================================================

describe('Integration: Error Recovery', () => {
  let ctx: TestContext;

  beforeEach(() => {
    const callbacks = createMockCallbacks();
    ctx = createExtendedTestAgentContext({ callbacks });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('should not auto-pause on transient error at non-pause stage', async () => {
    await gate(ctx, 'start', 0);
    await gate(ctx, 'complete', 0, {
      query_plan: { original_query: 'test', sub_queries: ['q1'], depth_mode: 'standard' },
    });
    await gate(ctx, 'resume', undefined, { decision: 'proceed' });

    await gate(ctx, 'start', 1);
    const result = parseResult(await gate(ctx, 'complete', 1, {
      error: 'Request timed out',
    }));
    // Transient errors are NOT in pauseOnErrors, and stage 1 is not in pauseAfterStages
    assert.equal(result.pauseRequired, false);
    assert.equal(result.errorClassification, undefined);
  });

  it('should auto-pause on auth error and allow resume', async () => {
    await gate(ctx, 'start', 0);
    await gate(ctx, 'complete', 0, {
      query_plan: { original_query: 'test', sub_queries: ['q1'], depth_mode: 'standard' },
    });
    await gate(ctx, 'resume', undefined, { decision: 'proceed' });

    await gate(ctx, 'start', 1);
    const errResult = parseResult(await gate(ctx, 'complete', 1, {
      error: 'Unauthorized: expired token',
    }));
    assert.equal(errResult.pauseRequired, true);
    assert.ok(errResult.errorClassification);

    // User decides to proceed anyway
    const resumeResult = parseResult(await gate(ctx, 'resume', undefined, { decision: 'proceed' }));
    assert.equal(resumeResult.allowed, true);

    // Can continue with next stage
    const s2 = parseResult(await gate(ctx, 'start', 2));
    assert.equal(s2.allowed, true);
  });
});
