/**
 * Bridge State Variant + Breakout Integration Tests
 *
 * Tests that the JSON structure written by writeOrchestratorBridgeState()
 * (private in claude-agent.ts) is correctly consumed by the stage gate handler.
 *
 * Since writeOrchestratorBridgeState() is private, tests simulate its output
 * by writing the exact same JSON structure to current-run-state.json.
 *
 * Tests:
 * - Breakout bridge state: breakoutStage set, no pausedAtStage, correct completedStages
 * - Pause bridge state: pausedAtStage set, no breakoutStage, correct completedStages
 * - After breakout bridge state, handleComplete(stage) succeeds
 * - After breakout bridge state, handleStart(stage+1) rejected by breakoutStage
 * - After clearBreakoutScope(), handleStart(stage+1) succeeds
 * - Breakout bridge state does NOT block stage_gate(complete)
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { handleAgentStageGate, clearBreakoutScope } from '../agent-stage-gate.ts';
import {
  createTestAgentContext,
  TEST_AGENT_SLUG,
  TEST_AGENT_CONFIG,
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

/**
 * Writes a bridge state JSON file simulating writeOrchestratorBridgeState(breakout: true).
 * Mirrors the exact structure from claude-agent.ts.
 */
function writeBridgeState(
  ctx: TestContext,
  stage: number,
  mode: 'breakout' | 'pause',
): void {
  const agentDataDir = join(ctx.workspacePath, 'sessions', ctx.sessionId, 'data', 'agents', TEST_AGENT_SLUG);
  mkdirSync(agentDataDir, { recursive: true });
  const statePath = join(agentDataDir, 'current-run-state.json');

  const bridgeState: Record<string, unknown> = {
    runId: 'test-run-001',
    orchestratorMode: true,
    currentStage: stage,
    startedAt: new Date().toISOString(),
    lastEventAt: new Date().toISOString(),
  };

  if (mode === 'breakout') {
    bridgeState.breakoutStage = stage;
    // Only prior stages are complete — breakout stage is in-progress
    bridgeState.completedStages = Array.from({ length: stage }, (_, i) => i);
  } else {
    bridgeState.pausedAtStage = stage;
    // Stage itself is complete (output already stored)
    bridgeState.completedStages = Array.from({ length: stage + 1 }, (_, i) => i);
  }

  writeFileSync(statePath, JSON.stringify(bridgeState, null, 2), 'utf-8');
}

function readBridgeState(ctx: TestContext): Record<string, unknown> {
  const statePath = join(
    ctx.workspacePath, 'sessions', ctx.sessionId,
    'data', 'agents', TEST_AGENT_SLUG, 'current-run-state.json',
  );
  return JSON.parse(readFileSync(statePath, 'utf-8'));
}

describe('Bridge State Variants', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestAgentContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  // ============================================================
  // Breakout bridge state structure
  // ============================================================

  describe('breakout bridge state structure', () => {
    it('should set breakoutStage and NOT pausedAtStage', () => {
      writeBridgeState(ctx, 1, 'breakout');
      const state = readBridgeState(ctx);

      assert.equal(state.breakoutStage, 1, 'breakoutStage should be 1');
      assert.equal(state.pausedAtStage, undefined, 'pausedAtStage should be undefined');
      assert.equal(state.orchestratorMode, true);
    });

    it('should mark only stages BEFORE breakout as complete', () => {
      writeBridgeState(ctx, 2, 'breakout');
      const state = readBridgeState(ctx);

      assert.deepEqual(state.completedStages, [0, 1],
        'completedStages should be [0, 1] for breakout at stage 2');
    });

    it('should mark no stages complete for breakout at stage 0', () => {
      writeBridgeState(ctx, 0, 'breakout');
      const state = readBridgeState(ctx);

      assert.deepEqual(state.completedStages, [],
        'completedStages should be [] for breakout at stage 0');
    });
  });

  // ============================================================
  // Pause bridge state structure (regression)
  // ============================================================

  describe('pause bridge state structure', () => {
    it('should set pausedAtStage and NOT breakoutStage', () => {
      writeBridgeState(ctx, 0, 'pause');
      const state = readBridgeState(ctx);

      assert.equal(state.pausedAtStage, 0, 'pausedAtStage should be 0');
      assert.equal(state.breakoutStage, undefined, 'breakoutStage should be undefined');
    });

    it('should mark stages up to and including pause stage as complete', () => {
      writeBridgeState(ctx, 2, 'pause');
      const state = readBridgeState(ctx);

      assert.deepEqual(state.completedStages, [0, 1, 2],
        'completedStages should include [0, 1, 2] for pause at stage 2');
    });
  });

  // ============================================================
  // Integration: breakout bridge state + stage gate behavior
  // ============================================================

  describe('breakout bridge state + stage gate integration', () => {
    it('handleComplete(breakout stage) should succeed (no pausedAtStage blocking)', async () => {
      // Step 1: Bootstrap pipeline to stage 1 normally
      await gate(ctx, 'start', 0);
      await gate(ctx, 'complete', 0, { query_plan: 'test' });
      await gate(ctx, 'resume', undefined, { decision: 'proceed' });
      await gate(ctx, 'start', 1);

      // Step 2: Overwrite state with breakout bridge state at stage 1
      // This simulates what writeOrchestratorBridgeState(breakout: true) does
      writeBridgeState(ctx, 1, 'breakout');

      // Step 3: complete(1) should succeed — no pausedAtStage to block it
      const result = parseResult(await gate(ctx, 'complete', 1, { results: 'SDK produced output' }));
      assert.equal(result.allowed, true,
        'complete(1) should succeed with breakout bridge state (no pausedAtStage)');
    });

    it('handleStart(stage+1) should be rejected by breakoutStage scope', async () => {
      // Bootstrap pipeline to stage 1
      await gate(ctx, 'start', 0);
      await gate(ctx, 'complete', 0, { query_plan: 'test' });
      await gate(ctx, 'resume', undefined, { decision: 'proceed' });
      await gate(ctx, 'start', 1);

      // Write breakout bridge state at stage 1
      writeBridgeState(ctx, 1, 'breakout');

      // Complete stage 1 (allowed because breakout stage matches)
      await gate(ctx, 'complete', 1, { results: 'done' });

      // start(2) should be REJECTED — breakoutStage=1 restricts scope
      const result = parseResult(await gate(ctx, 'start', 2));
      assert.equal(result.allowed, false,
        'start(2) should be rejected when breakoutStage=1');
      assert.ok(
        (result.reason as string).includes('Breakout scope'),
        'Reason should mention breakout scope',
      );
    });

    it('after clearBreakoutScope, handleStart(stage+1) should succeed', async () => {
      // Bootstrap pipeline to stage 1
      await gate(ctx, 'start', 0);
      await gate(ctx, 'complete', 0, { query_plan: 'test' });
      await gate(ctx, 'resume', undefined, { decision: 'proceed' });
      await gate(ctx, 'start', 1);

      // Write breakout bridge state at stage 1
      writeBridgeState(ctx, 1, 'breakout');

      // Complete stage 1
      await gate(ctx, 'complete', 1, { results: 'done' });

      // Clear breakout scope (simulates resumeFromBreakout in orchestrator)
      const sessionDir = join(ctx.workspacePath, 'sessions', ctx.sessionId);
      clearBreakoutScope(sessionDir, TEST_AGENT_SLUG);

      // Now start(2) should succeed — breakoutStage cleared
      const result = parseResult(await gate(ctx, 'start', 2));
      assert.equal(result.allowed, true,
        'start(2) should succeed after clearBreakoutScope');
    });

    it('pause bridge state should block stage_gate(complete) (regression)', async () => {
      // Bootstrap pipeline to stage 0
      await gate(ctx, 'start', 0);

      // Write PAUSE bridge state at stage 0 (simulates orchestrator_pause)
      writeBridgeState(ctx, 0, 'pause');

      // complete(0) with pause bridge state — should indicate pauseRequired
      const result = parseResult(await gate(ctx, 'complete', 0, { query_plan: 'test' }));
      // Note: When pausedAtStage is set, the handler has already stored output
      //       on first complete. Second complete sees pausedAtStage and may
      //       return pauseRequired=true depending on implementation path.
      // The key assertion: pause bridge state behaves differently from breakout
      assert.ok(
        result.pauseRequired === true || result.allowed === false,
        'Pause bridge state should either trigger pauseRequired or reject complete',
      );
    });
  });

  // ============================================================
  // Edge case: breakout at different stages
  // ============================================================

  describe('breakout bridge state at various stages', () => {
    it('breakout at stage 0 should have empty completedStages', async () => {
      // Write breakout at stage 0
      writeBridgeState(ctx, 0, 'breakout');
      const state = readBridgeState(ctx);

      assert.deepEqual(state.completedStages, []);
      assert.equal(state.breakoutStage, 0);
      assert.equal(state.currentStage, 0);
    });

    it('breakout at last stage should have all prior stages complete', () => {
      // TEST_AGENT_CONFIG has 5 stages (0-4)
      writeBridgeState(ctx, 4, 'breakout');
      const state = readBridgeState(ctx);

      assert.deepEqual(state.completedStages, [0, 1, 2, 3]);
      assert.equal(state.breakoutStage, 4);
      assert.equal(state.currentStage, 4);
    });
  });
});
