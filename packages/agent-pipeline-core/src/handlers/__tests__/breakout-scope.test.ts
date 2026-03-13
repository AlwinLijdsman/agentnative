/**
 * Breakout Scope Enforcement — Tests
 *
 * Tests:
 * - 8.1: handleStart rejects stage != breakoutStage
 * - 8.2: handleComplete rejects stage != breakoutStage
 * - 8.3: handleResume with breakoutStage includes stop instruction
 * - 8.4: setBreakoutScope / clearBreakoutScope utilities
 * - 8.5: Normal pipeline (no breakoutStage) allows all stages
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { handleAgentStageGate, setBreakoutScope, clearBreakoutScope } from '../agent-stage-gate.ts';
import {
  createTestAgentContext,
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

describe('Breakout Scope Enforcement', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestAgentContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  // ============================================================
  // 8.1: handleStart rejects stage != breakoutStage
  // ============================================================

  describe('handleStart with breakout scope', () => {
    it('should reject start(stage=2) when breakoutStage=1', async () => {
      // Start run at stage 0, complete, resume (pauseAfterStages: [0])
      await gate(ctx, 'start', 0);
      await gate(ctx, 'complete', 0, { query_plan: 'test' });
      await gate(ctx, 'resume', undefined, { decision: 'proceed' });

      // Start stage 1
      await gate(ctx, 'start', 1);

      // Set breakoutStage=1
      const sessionDir = join(ctx.workspacePath, 'sessions', ctx.sessionId);
      setBreakoutScope(sessionDir, TEST_AGENT_SLUG, 1);

      // Complete stage 1 (allowed — matches breakoutStage)
      await gate(ctx, 'complete', 1, { results: 'done' });

      // Now try start(2) — should be REJECTED because breakoutStage=1
      const startResult = parseResult(await gate(ctx, 'start', 2));
      assert.equal(startResult.allowed, false, 'start(2) should be rejected');
      assert.ok(
        (startResult.reason as string).includes('Breakout scope active'),
        'Reason should mention breakout scope',
      );
    });

    it('should allow start(stage=1) when breakoutStage=1', async () => {
      // Start run at stage 0, complete, resume
      await gate(ctx, 'start', 0);
      await gate(ctx, 'complete', 0, { query_plan: 'test' });
      await gate(ctx, 'resume', undefined, { decision: 'proceed' });

      // Set breakout scope to 1 before starting it
      const sessionDir = join(ctx.workspacePath, 'sessions', ctx.sessionId);
      setBreakoutScope(sessionDir, TEST_AGENT_SLUG, 1);

      // start(1) should be allowed — matches breakoutStage
      const result = parseResult(await gate(ctx, 'start', 1));
      assert.equal(result.allowed, true, 'start(1) should be allowed when breakoutStage=1');
    });
  });

  // ============================================================
  // 8.2: handleComplete rejects stage != breakoutStage
  // ============================================================

  describe('handleComplete with breakout scope', () => {
    it('should reject complete(stage=2) when breakoutStage=1', async () => {
      // Start run, advance to stage 1
      await gate(ctx, 'start', 0);
      await gate(ctx, 'complete', 0, { query_plan: 'test' });
      await gate(ctx, 'resume', undefined, { decision: 'proceed' });
      await gate(ctx, 'start', 1);

      // Set breakout scope to stage 1
      const sessionDir = join(ctx.workspacePath, 'sessions', ctx.sessionId);
      setBreakoutScope(sessionDir, TEST_AGENT_SLUG, 1);

      // Try to complete stage 2 — rejected (either by currentStage check or breakout scope)
      const result = parseResult(await gate(ctx, 'complete', 2, { results: 'hacky' }));
      assert.equal(result.allowed, false, 'complete(2) should be rejected');
    });

    it('should allow complete(stage=1) when breakoutStage=1', async () => {
      // Start run, advance to stage 1
      await gate(ctx, 'start', 0);
      await gate(ctx, 'complete', 0, { query_plan: 'test' });
      await gate(ctx, 'resume', undefined, { decision: 'proceed' });
      await gate(ctx, 'start', 1);

      // Set breakout scope to stage 1
      const sessionDir = join(ctx.workspacePath, 'sessions', ctx.sessionId);
      setBreakoutScope(sessionDir, TEST_AGENT_SLUG, 1);

      // complete(1) should be allowed — matches breakoutStage
      const result = parseResult(await gate(ctx, 'complete', 1, { results: 'done' }));
      assert.equal(result.allowed, true, 'complete(1) should be allowed when breakoutStage=1');
    });
  });

  // ============================================================
  // 8.3: handleResume with breakoutStage includes stop instruction
  // ============================================================

  describe('handleResume with breakout scope', () => {
    it('should include stop instruction in reason when breakoutStage is set', async () => {
      // Use stage 0 pause since TEST_AGENT_CONFIG has pauseAfterStages: [0]
      await gate(ctx, 'start', 0);
      await gate(ctx, 'complete', 0, { query_plan: 'test' });

      // Set breakout scope to stage 0 (before resume)
      const sessionDir = join(ctx.workspacePath, 'sessions', ctx.sessionId);
      setBreakoutScope(sessionDir, TEST_AGENT_SLUG, 0);

      // Resume should work and include stop instruction
      const result = parseResult(await gate(ctx, 'resume', undefined, { decision: 'proceed' }));
      assert.equal(result.allowed, true, 'resume should be allowed');

      // The reason field should have stop instructions
      const reason = result.reason as string | undefined;
      assert.ok(reason, 'Reason should be present');
      assert.ok(
        reason!.includes('STOP working'),
        'Reason should include "STOP working"',
      );
      assert.ok(
        reason!.includes('stage_gate(start)'),
        'Reason should warn against calling stage_gate(start)',
      );
    });

    it('should NOT include stop instruction when breakoutStage is not set', async () => {
      // No breakout scope
      await gate(ctx, 'start', 0);
      await gate(ctx, 'complete', 0, { query_plan: 'test' });

      // Resume without breakout scope
      const result = parseResult(await gate(ctx, 'resume', undefined, { decision: 'proceed' }));
      assert.equal(result.allowed, true, 'resume should be allowed');
      assert.equal(result.reason, undefined, 'No reason should be present without breakout scope');
    });
  });

  // ============================================================
  // 8.4: setBreakoutScope / clearBreakoutScope utilities
  // ============================================================

  describe('setBreakoutScope / clearBreakoutScope utilities', () => {
    it('should set breakoutStage in run state file', async () => {
      // Start a run to create the state file
      await gate(ctx, 'start', 0);

      const sessionDir = join(ctx.workspacePath, 'sessions', ctx.sessionId);
      setBreakoutScope(sessionDir, TEST_AGENT_SLUG, 1);

      // Read back the state file
      const stateFile = join(sessionDir, 'data', 'agents', TEST_AGENT_SLUG, 'current-run-state.json');
      const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
      assert.equal(state.breakoutStage, 1, 'breakoutStage should be set to 1');
    });

    it('should clear breakoutStage from run state file', async () => {
      // Start a run and set breakout scope
      await gate(ctx, 'start', 0);

      const sessionDir = join(ctx.workspacePath, 'sessions', ctx.sessionId);
      setBreakoutScope(sessionDir, TEST_AGENT_SLUG, 1);

      // Now clear it
      clearBreakoutScope(sessionDir, TEST_AGENT_SLUG);

      // Read back the state file
      const stateFile = join(sessionDir, 'data', 'agents', TEST_AGENT_SLUG, 'current-run-state.json');
      const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
      assert.equal(state.breakoutStage, undefined, 'breakoutStage should be undefined after clear');
    });

    it('should be a no-op when state file does not exist', () => {
      const sessionDir = join(ctx.workspacePath, 'sessions', ctx.sessionId);
      // Should not throw even when no state file
      setBreakoutScope(sessionDir, TEST_AGENT_SLUG, 1);
      clearBreakoutScope(sessionDir, TEST_AGENT_SLUG);
    });
  });

  // ============================================================
  // 8.5: Normal pipeline (no breakoutStage) allows all stages
  // ============================================================

  describe('normal pipeline without breakout scope', () => {
    it('should allow all stage transitions when breakoutStage is undefined', async () => {
      // Full pipeline run without breakout scope
      await gate(ctx, 'start', 0);
      // complete(0) triggers pause (pauseAfterStages: [0]) — allowed: false, pauseRequired: true
      const r0 = parseResult(await gate(ctx, 'complete', 0, { query_plan: 'test' }));
      assert.equal(r0.pauseRequired, true, 'complete(0) should trigger pause');

      await gate(ctx, 'resume', undefined, { decision: 'proceed' });

      const r1_start = parseResult(await gate(ctx, 'start', 1));
      assert.equal(r1_start.allowed, true, 'start(1) should be allowed');

      const r1_complete = parseResult(await gate(ctx, 'complete', 1, { results: 'ok' }));
      assert.equal(r1_complete.allowed, true, 'complete(1) should be allowed');

      const r2_start = parseResult(await gate(ctx, 'start', 2));
      assert.equal(r2_start.allowed, true, 'start(2) should be allowed');

      const r2_complete = parseResult(await gate(ctx, 'complete', 2, { synthesis: 'done' }));
      assert.equal(r2_complete.allowed, true, 'complete(2) should be allowed');
    });
  });
});
