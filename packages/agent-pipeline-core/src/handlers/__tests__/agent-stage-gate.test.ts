/**
 * Agent Stage Gate — Integration Tests
 *
 * Tests: out-of-order blocking, repair lifecycle, repair limits,
 * staleness detection, error classification, pause enforcement,
 * per-iteration intermediates, metadata.json, domain events.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { handleAgentStageGate } from '../agent-stage-gate.ts';
import {
  createTestAgentContext,
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

async function advanceToStage(ctx: SessionToolContext, targetStage: number) {
  await gate(ctx, 'start', 0);
  if (targetStage === 0) return;
  await gate(ctx, 'complete', 0);

  for (let s = 1; s <= targetStage; s++) {
    await gate(ctx, 'start', s);
    if (s < targetStage) {
      await gate(ctx, 'complete', s);
    }
  }
}

describe('Agent Stage Gate', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestAgentContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  // ============================================================
  // Basic Lifecycle
  // ============================================================

  describe('basic lifecycle', () => {
    it('should start a new run at stage 0', async () => {
      const result = parseResult(await gate(ctx, 'start', 0));
      assert.equal(result.allowed, true);
      assert.equal(result.currentStage, 0);
      assert.match(result.runId as string, /^run-\d{3}$/);
    });

    it('should complete stage 0', async () => {
      await gate(ctx, 'start', 0);
      const result = parseResult(await gate(ctx, 'complete', 0, { query_plan: 'test' }));
      assert.equal(result.allowed, true);
      assert.ok((result.completedStages as number[]).includes(0));
    });

    it('should complete all 5 stages', async () => {
      await gate(ctx, 'start', 0);
      await gate(ctx, 'complete', 0);
      for (let s = 1; s <= 4; s++) {
        await gate(ctx, 'start', s);
        await gate(ctx, 'complete', s);
      }
      const result = parseResult(await gate(ctx, 'status'));
      assert.equal((result.completedStages as number[]).length, 5);
    });
  });

  // ============================================================
  // Out-of-Order Blocking
  // ============================================================

  describe('out-of-order blocking', () => {
    it('should block starting stage 2 without completing stage 1', async () => {
      await gate(ctx, 'start', 0);
      await gate(ctx, 'complete', 0);
      const result = parseResult(await gate(ctx, 'start', 2));
      assert.equal(result.allowed, false);
      assert.ok((result.reason as string).includes('Stage 1 must be completed'));
    });

    it('should block completing a stage that is not current', async () => {
      await gate(ctx, 'start', 0);
      const result = parseResult(await gate(ctx, 'complete', 1));
      assert.equal(result.allowed, false);
      assert.ok((result.reason as string).includes('Cannot complete stage 1'));
    });

    it('should reject starting stage > 0 without a run', async () => {
      const result = parseResult(await gate(ctx, 'start', 2));
      assert.equal(result.allowed, false);
      assert.ok((result.reason as string).includes('No active run'));
    });
  });

  // ============================================================
  // Repair Unit Lifecycle
  // ============================================================

  describe('repair unit lifecycle', () => {
    it('should start a repair unit at stage 3', async () => {
      await advanceToStage(ctx, 3);
      await gate(ctx, 'complete', 3);
      const result = parseResult(await gate(ctx, 'start_repair_unit'));
      assert.equal(result.allowed, true);
      assert.equal(result.repairUnitActive, true);
      assert.equal(result.repairIteration, 0);
    });

    it('should allow repair iteration', async () => {
      await advanceToStage(ctx, 3);
      await gate(ctx, 'complete', 3);
      await gate(ctx, 'start_repair_unit');
      const result = parseResult(await gate(ctx, 'repair'));
      assert.equal(result.allowed, true);
      assert.equal(result.repairIteration, 1);
      // Stages 2 and 3 should be removed from completedStages
      assert.ok(!(result.completedStages as number[]).includes(2));
      assert.ok(!(result.completedStages as number[]).includes(3));
    });

    it('should allow re-running repair unit stages', async () => {
      await advanceToStage(ctx, 3);
      await gate(ctx, 'complete', 3);
      await gate(ctx, 'start_repair_unit');
      await gate(ctx, 'repair');
      const result = parseResult(await gate(ctx, 'start', 2));
      assert.equal(result.allowed, true);
    });

    it('should end a repair unit', async () => {
      await advanceToStage(ctx, 3);
      await gate(ctx, 'complete', 3);
      await gate(ctx, 'start_repair_unit');
      const result = parseResult(await gate(ctx, 'end_repair_unit'));
      assert.equal(result.allowed, true);
      assert.equal(result.repairUnitActive, false);
    });

    it('should block start_repair_unit for unrelated stage', async () => {
      await advanceToStage(ctx, 1);
      const result = parseResult(await gate(ctx, 'start_repair_unit'));
      assert.equal(result.allowed, false);
      assert.ok((result.reason as string).includes('No repair unit defined'));
    });

    it('should block double start_repair_unit', async () => {
      await advanceToStage(ctx, 3);
      await gate(ctx, 'complete', 3);
      await gate(ctx, 'start_repair_unit');
      const result = parseResult(await gate(ctx, 'start_repair_unit'));
      assert.equal(result.allowed, false);
      assert.ok((result.reason as string).includes('already active'));
    });

    it('should block end_repair_unit when none active', async () => {
      await advanceToStage(ctx, 3);
      await gate(ctx, 'complete', 3);
      const result = parseResult(await gate(ctx, 'end_repair_unit'));
      assert.equal(result.allowed, false);
    });
  });

  // ============================================================
  // Repair Iteration Limits
  // ============================================================

  describe('repair iteration limits', () => {
    it('should enforce maxIterations=2', async () => {
      await advanceToStage(ctx, 3);
      await gate(ctx, 'complete', 3);
      await gate(ctx, 'start_repair_unit');

      // Iteration 1 — allowed
      const r1 = parseResult(await gate(ctx, 'repair'));
      assert.equal(r1.allowed, true);
      assert.equal(r1.repairIteration, 1);

      // Re-run stages 2 and 3
      await gate(ctx, 'start', 2);
      await gate(ctx, 'complete', 2);
      await gate(ctx, 'start', 3);
      await gate(ctx, 'complete', 3);

      // Iteration 2 — should exceed max (2)
      const r2 = parseResult(await gate(ctx, 'repair'));
      assert.equal(r2.allowed, false);
      assert.ok((r2.reason as string).includes('Max repair iterations'));
    });
  });

  // ============================================================
  // Staleness Detection
  // ============================================================

  describe('staleness detection', () => {
    it('should detect stale run (>300s old)', async () => {
      await gate(ctx, 'start', 0);

      // Manually set lastEventAt to 400s ago
      const statePath = join(
        ctx.workspacePath, 'sessions', ctx.sessionId, 'data', 'agents', TEST_AGENT_SLUG,
        'current-run-state.json',
      );
      const state = JSON.parse(ctx.fs.readFile(statePath));
      state.lastEventAt = new Date(Date.now() - 400_000).toISOString();
      ctx.fs.writeFile(statePath, JSON.stringify(state));

      const result = parseResult(await gate(ctx, 'status'));
      assert.ok(result.staleRun);
      assert.ok((result.staleRun as { ageSeconds: number }).ageSeconds > 300);
    });

    it('should not flag fresh run as stale', async () => {
      await gate(ctx, 'start', 0);
      const result = parseResult(await gate(ctx, 'status'));
      assert.equal(result.staleRun, undefined);
    });
  });

  // ============================================================
  // Error Classification
  // ============================================================

  describe('error classification', () => {
    it('should classify transient errors', async () => {
      await gate(ctx, 'start', 0);
      const result = parseResult(await gate(ctx, 'complete', 0, { error: 'Request timed out' }));
      assert.ok((result.reason as string).includes('Transient'));
    });

    it('should classify auth errors', async () => {
      await gate(ctx, 'start', 0);
      const result = parseResult(await gate(ctx, 'complete', 0, { error: 'Unauthorized: invalid API key' }));
      assert.ok((result.reason as string).includes('Authentication'));
    });

    it('should classify config errors', async () => {
      await gate(ctx, 'start', 0);
      const result = parseResult(await gate(ctx, 'complete', 0, { error: 'Invalid config: missing field' }));
      assert.ok((result.reason as string).includes('Configuration'));
    });

    it('should classify resource errors', async () => {
      await gate(ctx, 'start', 0);
      const result = parseResult(await gate(ctx, 'complete', 0, { error: '404 not found' }));
      assert.ok((result.reason as string).includes('Resource not found'));
    });

    it('should classify unknown errors', async () => {
      await gate(ctx, 'start', 0);
      const result = parseResult(await gate(ctx, 'complete', 0, { error: 'Something bizarre' }));
      assert.ok((result.reason as string).includes('Unknown'));
    });
  });

  // ============================================================
  // Pause Enforcement
  // ============================================================

  describe('pause enforcement', () => {
    it('should set pauseRequired=true for pauseAfterStages', async () => {
      const callbacks = createMockCallbacks();
      ctx = createTestAgentContext();
      (ctx as unknown as { callbacks: typeof callbacks }).callbacks = callbacks;

      await gate(ctx, 'start', 0);
      const result = parseResult(await gate(ctx, 'complete', 0));
      assert.equal(result.pauseRequired, true);
    });

    it('should call onAgentStagePause callback', async () => {
      const callbacks = createMockCallbacks();
      ctx = createTestAgentContext();
      (ctx as unknown as { callbacks: typeof callbacks }).callbacks = callbacks;

      await gate(ctx, 'start', 0);
      await gate(ctx, 'complete', 0);
      assert.equal(callbacks.onAgentStagePause.callCount, 1);
      assert.equal((callbacks.onAgentStagePause.calls[0]![0] as { stage: number }).stage, 0);
    });

    it('should use stage pauseInstructions in pause reason when provided', async () => {
      const configPath = join(ctx.workspacePath, 'agents', TEST_AGENT_SLUG, 'config.json');
      const config = JSON.parse(ctx.fs.readFile(configPath)) as {
        controlFlow: {
          stages: Array<{ id: number; name: string; description: string; pauseInstructions?: string }>;
        };
      };

      config.controlFlow.stages[0]!.pauseInstructions = 'Use concise clarification only.';
      ctx.fs.writeFile(configPath, JSON.stringify(config, null, 2));

      await gate(ctx, 'start', 0);
      const result = parseResult(await gate(ctx, 'complete', 0));
      assert.equal(result.pauseRequired, true);
      assert.ok((result.reason as string).includes('Use concise clarification only.'));
    });

    it('should NOT pause for non-pause stages', async () => {
      await gate(ctx, 'start', 0);
      await gate(ctx, 'complete', 0);
      await gate(ctx, 'start', 1);
      const result = parseResult(await gate(ctx, 'complete', 1));
      assert.equal(result.pauseRequired, false);
    });
  });

  // ============================================================
  // Per-Iteration Intermediates
  // ============================================================

  describe('per-iteration intermediates', () => {
    it('should name without iter suffix outside repair unit', async () => {
      await gate(ctx, 'start', 0);
      await gate(ctx, 'complete', 0);

      const runId = (parseResult(await gate(ctx, 'status')).runId) as string;
      const path = join(
        ctx.workspacePath, 'sessions', ctx.sessionId, 'data', 'agents', TEST_AGENT_SLUG,
        'runs', runId, 'evidence', 'intermediates', 'stage0_analyze_query.json',
      );
      assert.ok(ctx.fs.exists(path), `Expected file at ${path}`);
    });

    it('should name with _iter{N} inside repair unit', async () => {
      await advanceToStage(ctx, 3);
      await gate(ctx, 'complete', 3);
      await gate(ctx, 'start_repair_unit');
      await gate(ctx, 'repair'); // iteration 1

      await gate(ctx, 'start', 2);
      await gate(ctx, 'complete', 2, { synthesis: 'v2' });

      const runId = (parseResult(await gate(ctx, 'status')).runId) as string;
      const path = join(
        ctx.workspacePath, 'sessions', ctx.sessionId, 'data', 'agents', TEST_AGENT_SLUG,
        'runs', runId, 'evidence', 'intermediates', 'stage2_synthesize_iter1.json',
      );
      assert.ok(ctx.fs.exists(path), `Expected iter-suffixed file at ${path}`);

      const content = JSON.parse(ctx.fs.readFile(path));
      assert.equal(content.repairIteration, 1);
    });
  });

  // ============================================================
  // metadata.json
  // ============================================================

  describe('metadata.json on run completion', () => {
    it('should write metadata.json with all required fields', async () => {
      await gate(ctx, 'start', 0, { depthMode: 'deep' });
      await gate(ctx, 'complete', 0);
      for (let s = 1; s <= 3; s++) {
        await gate(ctx, 'start', s);
        await gate(ctx, 'complete', s);
      }
      await gate(ctx, 'start', 4);
      await gate(ctx, 'complete', 4, {
        verification_scores: { eg: 0.9, ca: 0.85 },
        debugModeActive: false,
        webSearchUsed: true,
        webSearchQueryCount: 3,
      });

      const runId = (parseResult(await gate(ctx, 'status')).runId) as string;
      const metadataPath = join(
        ctx.workspacePath, 'sessions', ctx.sessionId, 'data', 'agents', TEST_AGENT_SLUG,
        'runs', runId, 'metadata.json',
      );
      assert.ok(ctx.fs.exists(metadataPath));

      const metadata = JSON.parse(ctx.fs.readFile(metadataPath));
      assert.equal(metadata.runId, runId);
      assert.equal(metadata.depthMode, 'deep');
      assert.deepEqual(metadata.completedStages, [0, 1, 2, 3, 4]);
      assert.deepEqual(metadata.verificationScores, { eg: 0.9, ca: 0.85 });
      assert.equal(metadata.webSearchUsed, true);
      assert.equal(metadata.webSearchQueryCount, 3);
    });
  });

  // ============================================================
  // Domain Events
  // ============================================================

  describe('domain events', () => {
    it('should emit verification_result event', async () => {
      await gate(ctx, 'start', 0);
      await gate(ctx, 'complete', 0);
      await gate(ctx, 'start', 1);
      await gate(ctx, 'complete', 1);
      await gate(ctx, 'start', 2);
      await gate(ctx, 'complete', 2);
      await gate(ctx, 'start', 3);
      await gate(ctx, 'complete', 3, {
        verification_scores: { eg: 0.9 },
        all_passed: true,
      });

      const eventsPath = join(
        ctx.workspacePath, 'sessions', ctx.sessionId, 'data', 'agents', TEST_AGENT_SLUG,
        'agent-events.jsonl',
      );
      const events = ctx.fs.readFile(eventsPath).trim().split('\n').map((l: string) => JSON.parse(l));
      const verifyEvents = events.filter((e: { type: string }) => e.type === 'verification_result');
      assert.equal(verifyEvents.length, 1);
      assert.deepEqual(verifyEvents[0].data.scores, { eg: 0.9 });
    });

    it('should emit web_search_result event', async () => {
      await gate(ctx, 'start', 0);
      await gate(ctx, 'complete', 0, { web_search_result: { query: 'test', count: 5 } });

      const eventsPath = join(
        ctx.workspacePath, 'sessions', ctx.sessionId, 'data', 'agents', TEST_AGENT_SLUG,
        'agent-events.jsonl',
      );
      const events = ctx.fs.readFile(eventsPath).trim().split('\n').map((l: string) => JSON.parse(l));
      const webEvents = events.filter((e: { type: string }) => e.type === 'web_search_result');
      assert.equal(webEvents.length, 1);
      assert.equal(webEvents[0].data.query, 'test');
    });
  });

  // ============================================================
  // Reset + Active Run Blocking
  // ============================================================

  describe('reset', () => {
    it('should clear run state', async () => {
      await gate(ctx, 'start', 0);
      const result = parseResult(await gate(ctx, 'reset'));
      assert.ok((result.reason as string).includes('reset'));

      const status = parseResult(await gate(ctx, 'status'));
      assert.equal(status.allowed, false);
    });
  });

  describe('active run blocking', () => {
    it('should block new run when non-stale run exists', async () => {
      await gate(ctx, 'start', 0);
      const result = parseResult(await gate(ctx, 'start', 0));
      assert.equal(result.allowed, false);
      assert.ok(result.activeRun);
    });
  });

  // ============================================================
  // Error Escalation (auto-pause on non-recoverable errors)
  // ============================================================

  describe('error escalation', () => {
    let errCtx: TestContext;

    beforeEach(() => {
      errCtx = createTestAgentContext();
      // Add pauseOnErrors to the test config
      const configPath = join(errCtx.workspacePath, 'agents', TEST_AGENT_SLUG, 'config.json');
      const config = JSON.parse(errCtx.fs.readFile(configPath));
      config.controlFlow.pauseOnErrors = ['auth', 'config'];
      errCtx.fs.writeFile(configPath, JSON.stringify(config, null, 2));
    });

    afterEach(() => {
      errCtx.cleanup();
    });

    async function errGate(action: string, stage?: number, data?: Record<string, unknown>) {
      return handleAgentStageGate(errCtx, {
        agentSlug: TEST_AGENT_SLUG,
        action: action as 'start' | 'complete' | 'resume',
        stage,
        data,
      });
    }

    it('should auto-pause on auth error', async () => {
      const callbacks = createMockCallbacks();
      (errCtx as unknown as { callbacks: typeof callbacks }).callbacks = callbacks;

      await errGate('start', 0);
      const result = parseResult(await errGate('complete', 0, { error: 'Unauthorized: invalid API key' }));
      assert.equal(result.pauseRequired, true);
      assert.ok(result.errorClassification);
      assert.equal((result.errorClassification as { category: string }).category, 'auth');
      assert.equal(callbacks.onAgentStagePause.callCount, 1);
    });

    it('should auto-pause on config error', async () => {
      const callbacks = createMockCallbacks();
      (errCtx as unknown as { callbacks: typeof callbacks }).callbacks = callbacks;

      await errGate('start', 0);
      const result = parseResult(await errGate('complete', 0, { error: 'Invalid config: missing field xyz' }));
      assert.equal(result.pauseRequired, true);
      assert.ok(result.errorClassification);
      assert.equal((result.errorClassification as { category: string }).category, 'config');
    });

    it('should NOT auto-pause on transient error', async () => {
      await errGate('start', 0);
      const result = parseResult(await errGate('complete', 0, { error: 'Request timed out' }));
      // Stage 0 is in pauseAfterStages, so pauseRequired=true from normal pause, not error escalation
      assert.equal(result.errorClassification, undefined);
    });

    it('should include errorClassification in result for error pause', async () => {
      const callbacks = createMockCallbacks();
      (errCtx as unknown as { callbacks: typeof callbacks }).callbacks = callbacks;

      await errGate('start', 0);
      await errGate('complete', 0); // normal complete stage 0
      await errGate('resume', undefined, { decision: 'proceed' });
      await errGate('start', 1);
      // Stage 1 is NOT in pauseAfterStages, but auth error should trigger pause
      const result = parseResult(await errGate('complete', 1, { error: 'Forbidden access denied' }));
      assert.equal(result.pauseRequired, true);
      assert.ok(result.errorClassification);
    });
  });

  // ============================================================
  // Resume Decisions
  // ============================================================

  describe('resume decisions', () => {
    it('should resume-proceed and advance to next stage', async () => {
      const callbacks = createMockCallbacks();
      const resumeCtx = createTestAgentContext({ callbacks });

      await handleAgentStageGate(resumeCtx, { agentSlug: TEST_AGENT_SLUG, action: 'start', stage: 0 });
      await handleAgentStageGate(resumeCtx, { agentSlug: TEST_AGENT_SLUG, action: 'complete', stage: 0, data: { query_plan: 'test' } });

      const result = parseResult(await handleAgentStageGate(resumeCtx, {
        agentSlug: TEST_AGENT_SLUG,
        action: 'resume',
        data: { decision: 'proceed' },
      }));
      assert.equal(result.allowed, true);
      assert.equal(result.nextStage, 1);
      assert.equal(result.aborted, undefined);

      resumeCtx.cleanup();
    });

    it('should resume-modify and store modifications', async () => {
      const callbacks = createMockCallbacks();
      const resumeCtx = createTestAgentContext({ callbacks });

      await handleAgentStageGate(resumeCtx, { agentSlug: TEST_AGENT_SLUG, action: 'start', stage: 0 });
      await handleAgentStageGate(resumeCtx, { agentSlug: TEST_AGENT_SLUG, action: 'complete', stage: 0, data: { plan: 'original' } });

      const result = parseResult(await handleAgentStageGate(resumeCtx, {
        agentSlug: TEST_AGENT_SLUG,
        action: 'resume',
        data: { decision: 'modify', modifications: { sub_queries: ['new_query'] } },
      }));
      assert.equal(result.allowed, true);
      assert.deepEqual(result.modifications, { sub_queries: ['new_query'] });

      resumeCtx.cleanup();
    });

    it('should resume-abort and clear state', async () => {
      const callbacks = createMockCallbacks();
      const resumeCtx = createTestAgentContext({ callbacks });

      await handleAgentStageGate(resumeCtx, { agentSlug: TEST_AGENT_SLUG, action: 'start', stage: 0 });
      await handleAgentStageGate(resumeCtx, { agentSlug: TEST_AGENT_SLUG, action: 'complete', stage: 0, data: { plan: 'test' } });

      const result = parseResult(await handleAgentStageGate(resumeCtx, {
        agentSlug: TEST_AGENT_SLUG,
        action: 'resume',
        data: { decision: 'abort', reason: 'User cancelled' },
      }));
      assert.equal(result.allowed, true);
      assert.equal(result.aborted, true);

      // State should be cleared
      const status = parseResult(await handleAgentStageGate(resumeCtx, { agentSlug: TEST_AGENT_SLUG, action: 'status' }));
      assert.equal(status.allowed, false);

      resumeCtx.cleanup();
    });

    it('should fail resume when not paused', async () => {
      await gate(ctx, 'start', 0);
      const result = parseResult(await gate(ctx, 'resume', undefined, { decision: 'proceed' }));
      assert.equal(result.allowed, false);
      assert.ok((result.reason as string).includes('no stage is currently paused'));
    });

    it('should fail resume with invalid decision', async () => {
      const callbacks = createMockCallbacks();
      const resumeCtx = createTestAgentContext({ callbacks });

      await handleAgentStageGate(resumeCtx, { agentSlug: TEST_AGENT_SLUG, action: 'start', stage: 0 });
      await handleAgentStageGate(resumeCtx, { agentSlug: TEST_AGENT_SLUG, action: 'complete', stage: 0 });

      const result = parseResult(await handleAgentStageGate(resumeCtx, {
        agentSlug: TEST_AGENT_SLUG,
        action: 'resume',
        data: { decision: 'invalid' },
      }));
      assert.equal(result.allowed, false);
      assert.ok((result.reason as string).includes('Invalid decision'));

      resumeCtx.cleanup();
    });

    it('should pass modifications to next stage start', async () => {
      const callbacks = createMockCallbacks();
      const resumeCtx = createTestAgentContext({ callbacks });

      await handleAgentStageGate(resumeCtx, { agentSlug: TEST_AGENT_SLUG, action: 'start', stage: 0 });
      await handleAgentStageGate(resumeCtx, { agentSlug: TEST_AGENT_SLUG, action: 'complete', stage: 0, data: { plan: 'original' } });

      await handleAgentStageGate(resumeCtx, {
        agentSlug: TEST_AGENT_SLUG,
        action: 'resume',
        data: { decision: 'modify', modifications: { adjusted: true } },
      });

      const startResult = parseResult(await handleAgentStageGate(resumeCtx, {
        agentSlug: TEST_AGENT_SLUG,
        action: 'start',
        stage: 1,
      }));
      assert.equal(startResult.allowed, true);
      assert.deepEqual(startResult.modifications, { adjusted: true });

      // Starting stage 2 should NOT have modifications anymore
      await handleAgentStageGate(resumeCtx, { agentSlug: TEST_AGENT_SLUG, action: 'complete', stage: 1 });
      const start2Result = parseResult(await handleAgentStageGate(resumeCtx, {
        agentSlug: TEST_AGENT_SLUG,
        action: 'start',
        stage: 2,
      }));
      assert.equal(start2Result.modifications, undefined);

      resumeCtx.cleanup();
    });
  });

  // ============================================================
  // Schema Validation
  // ============================================================

  describe('schema validation', () => {
    let schemaCtx: TestContext;

    beforeEach(() => {
      schemaCtx = createTestAgentContext();
      // Add stageOutputSchemas to the test config
      const configPath = join(schemaCtx.workspacePath, 'agents', TEST_AGENT_SLUG, 'config.json');
      const config = JSON.parse(schemaCtx.fs.readFile(configPath));
      config.controlFlow.stageOutputSchemas = {
        '0': {
          required: ['query_plan'],
          properties: {
            query_plan: {
              type: 'object',
              required: ['original_query', 'sub_queries', 'depth_mode'],
              properties: {
                original_query: { type: 'string' },
                sub_queries: { type: 'array', minItems: 1 },
                depth_mode: { type: 'string', enum: ['quick', 'standard', 'deep'] },
              },
            },
          },
        },
      };
      schemaCtx.fs.writeFile(configPath, JSON.stringify(config, null, 2));
    });

    afterEach(() => {
      schemaCtx.cleanup();
    });

    async function schemaGate(action: string, stage?: number, data?: Record<string, unknown>) {
      return handleAgentStageGate(schemaCtx, {
        agentSlug: TEST_AGENT_SLUG,
        action: action as 'start' | 'complete',
        stage,
        data,
      });
    }

    it('should pass validation with valid data', async () => {
      await schemaGate('start', 0);
      const result = parseResult(await schemaGate('complete', 0, {
        query_plan: {
          original_query: 'test query',
          sub_queries: [{ query: 'sub1', role: 'primary' }],
          depth_mode: 'standard',
        },
      }));
      assert.equal(result.allowed, true);
      assert.equal(result.validationWarnings, undefined);
    });

    it('should warn on missing required field', async () => {
      await schemaGate('start', 0);
      const result = parseResult(await schemaGate('complete', 0, {
        not_query_plan: 'wrong key',
      }));
      assert.equal(result.allowed, true); // Warnings, not errors
      assert.ok(result.validationWarnings);
      assert.ok((result.validationWarnings as string[]).some(w => w.includes('query_plan') && w.includes('required')));
    });

    it('should warn on wrong type', async () => {
      await schemaGate('start', 0);
      const result = parseResult(await schemaGate('complete', 0, {
        query_plan: 'not an object',
      }));
      assert.equal(result.allowed, true);
      assert.ok(result.validationWarnings);
      assert.ok((result.validationWarnings as string[]).some(w => w.includes('type')));
    });

    it('should warn on enum violation', async () => {
      await schemaGate('start', 0);
      const result = parseResult(await schemaGate('complete', 0, {
        query_plan: {
          original_query: 'test',
          sub_queries: [{ query: 'q1' }],
          depth_mode: 'invalid_mode',
        },
      }));
      assert.equal(result.allowed, true);
      assert.ok(result.validationWarnings);
      assert.ok((result.validationWarnings as string[]).some(w => w.includes('enum')));
    });

    it('should warn on nested required field missing', async () => {
      await schemaGate('start', 0);
      const result = parseResult(await schemaGate('complete', 0, {
        query_plan: {
          original_query: 'test',
          // sub_queries missing, depth_mode missing
        },
      }));
      assert.equal(result.allowed, true);
      assert.ok(result.validationWarnings);
      assert.ok((result.validationWarnings as string[]).some(w => w.includes('sub_queries') && w.includes('required')));
    });

    it('should warn on minItems violation', async () => {
      await schemaGate('start', 0);
      const result = parseResult(await schemaGate('complete', 0, {
        query_plan: {
          original_query: 'test',
          sub_queries: [],
          depth_mode: 'standard',
        },
      }));
      assert.equal(result.allowed, true);
      assert.ok(result.validationWarnings);
      assert.ok((result.validationWarnings as string[]).some(w => w.includes('minItems') || w.includes('minimum')));
    });

    it('should skip validation when no schema defined for stage', async () => {
      await schemaGate('start', 0);
      await schemaGate('complete', 0, { query_plan: { original_query: 'x', sub_queries: ['q'], depth_mode: 'quick' } });
      await schemaGate('start', 1);
      const result = parseResult(await schemaGate('complete', 1, { anything: 'goes' }));
      assert.equal(result.allowed, true);
      assert.equal(result.validationWarnings, undefined);
    });

    it('should warn on empty data for required fields', async () => {
      await schemaGate('start', 0);
      const result = parseResult(await schemaGate('complete', 0, {}));
      assert.equal(result.allowed, true);
      assert.ok(result.validationWarnings);
      assert.ok((result.validationWarnings as string[]).length > 0);
    });
  });

  describe('invalid agent', () => {
    it('should error for non-existent agent', async () => {
      const result = await handleAgentStageGate(ctx, {
        agentSlug: 'non-existent-agent',
        action: 'start',
        stage: 0,
      });
      assert.equal(result.isError, true);
    });
  });

  // ============================================================
  // pausedAtStage persistence and status visibility
  // ============================================================

  describe('pausedAtStage persistence', () => {
    it('should persist pausedAtStage in run state after pause', async () => {
      const callbacks = createMockCallbacks();
      const pauseCtx = createTestAgentContext({ callbacks });

      await handleAgentStageGate(pauseCtx, { agentSlug: TEST_AGENT_SLUG, action: 'start', stage: 0 });
      await handleAgentStageGate(pauseCtx, { agentSlug: TEST_AGENT_SLUG, action: 'complete', stage: 0, data: { plan: 'test' } });

      // Read the raw run state file and verify pausedAtStage is present
      const stateFile = join(
        pauseCtx.workspacePath, 'sessions', pauseCtx.sessionId,
        'data', 'agents', TEST_AGENT_SLUG, 'current-run-state.json',
      );
      const rawState = JSON.parse(pauseCtx.fs.readFile(stateFile));
      assert.equal(rawState.pausedAtStage, 0, 'pausedAtStage should be 0 in the run state file');

      pauseCtx.cleanup();
    });

    it('should include pausedAtStage in status result when paused', async () => {
      const callbacks = createMockCallbacks();
      const pauseCtx = createTestAgentContext({ callbacks });

      await handleAgentStageGate(pauseCtx, { agentSlug: TEST_AGENT_SLUG, action: 'start', stage: 0 });
      await handleAgentStageGate(pauseCtx, { agentSlug: TEST_AGENT_SLUG, action: 'complete', stage: 0, data: { plan: 'test' } });

      const status = parseResult(await handleAgentStageGate(pauseCtx, { agentSlug: TEST_AGENT_SLUG, action: 'status' }));
      assert.equal(status.pausedAtStage, 0, 'status should include pausedAtStage');

      pauseCtx.cleanup();
    });

    it('should NOT include pausedAtStage in status when not paused', async () => {
      const callbacks = createMockCallbacks();
      const nopaCtx = createTestAgentContext({ callbacks });

      await handleAgentStageGate(nopaCtx, { agentSlug: TEST_AGENT_SLUG, action: 'start', stage: 0 });
      await handleAgentStageGate(nopaCtx, { agentSlug: TEST_AGENT_SLUG, action: 'complete', stage: 0 });
      // Stage 0 is in pauseAfterStages, so resume to clear the pause
      await handleAgentStageGate(nopaCtx, { agentSlug: TEST_AGENT_SLUG, action: 'resume', data: { decision: 'proceed' } });
      await handleAgentStageGate(nopaCtx, { agentSlug: TEST_AGENT_SLUG, action: 'start', stage: 1 });
      // Stage 1 is NOT in pauseAfterStages
      await handleAgentStageGate(nopaCtx, { agentSlug: TEST_AGENT_SLUG, action: 'complete', stage: 1 });

      const status = parseResult(await handleAgentStageGate(nopaCtx, { agentSlug: TEST_AGENT_SLUG, action: 'status' }));
      assert.equal(status.pausedAtStage, undefined, 'status should not have pausedAtStage when not paused');

      nopaCtx.cleanup();
    });

    it('should clear pausedAtStage after resume-proceed', async () => {
      const callbacks = createMockCallbacks();
      const pauseCtx = createTestAgentContext({ callbacks });

      await handleAgentStageGate(pauseCtx, { agentSlug: TEST_AGENT_SLUG, action: 'start', stage: 0 });
      await handleAgentStageGate(pauseCtx, { agentSlug: TEST_AGENT_SLUG, action: 'complete', stage: 0, data: { plan: 'test' } });

      // Verify paused
      let status = parseResult(await handleAgentStageGate(pauseCtx, { agentSlug: TEST_AGENT_SLUG, action: 'status' }));
      assert.equal(status.pausedAtStage, 0);

      // Resume
      await handleAgentStageGate(pauseCtx, { agentSlug: TEST_AGENT_SLUG, action: 'resume', data: { decision: 'proceed' } });

      // Verify no longer paused
      status = parseResult(await handleAgentStageGate(pauseCtx, { agentSlug: TEST_AGENT_SLUG, action: 'status' }));
      assert.equal(status.pausedAtStage, undefined, 'pausedAtStage should be cleared after resume');

      pauseCtx.cleanup();
    });

    it('should write pausedAtStage in single atomic write (no double-write)', async () => {
      const callbacks = createMockCallbacks();
      const pauseCtx = createTestAgentContext({ callbacks });

      // Track writeFile calls to the run state
      const stateFile = join(
        pauseCtx.workspacePath, 'sessions', pauseCtx.sessionId,
        'data', 'agents', TEST_AGENT_SLUG, 'current-run-state.json',
      );
      const originalWriteFile = pauseCtx.fs.writeFile.bind(pauseCtx.fs);
      const stateWrites: string[] = [];
      pauseCtx.fs.writeFile = (path: string, content: string) => {
        if (path.endsWith('current-run-state.json.tmp')) {
          stateWrites.push(content);
        }
        return originalWriteFile(path, content);
      };

      await handleAgentStageGate(pauseCtx, { agentSlug: TEST_AGENT_SLUG, action: 'start', stage: 0 });
      stateWrites.length = 0; // Reset — only track complete() writes

      await handleAgentStageGate(pauseCtx, { agentSlug: TEST_AGENT_SLUG, action: 'complete', stage: 0, data: { plan: 'test' } });

      // Should only have ONE write to the state file during complete()
      assert.equal(stateWrites.length, 1, 'complete() should write state exactly once');

      // And that single write should include pausedAtStage
      const writtenState = JSON.parse(stateWrites[0]!);
      assert.equal(writtenState.pausedAtStage, 0, 'the single write should include pausedAtStage');

      pauseCtx.cleanup();
    });
  });
});
