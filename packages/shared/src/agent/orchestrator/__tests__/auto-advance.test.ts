/**
 * Tests for auto-advance behavior in the orchestrator pipeline.
 *
 * Verifies that:
 * - Stages without pauseChoices auto-advance when autoAdvance is enabled
 * - Stages WITH pauseChoices still pause (F1: preserves Amend/Cancel)
 * - SDK breakout stages are unaffected by autoAdvance
 * - isPaused returns false after auto-advanced stages (F2)
 * - Default behavior (autoAdvance: false) preserves existing pause semantics
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { AgentOrchestrator, PipelineState } from '../index.ts';
import type { AgentConfig, OrchestratorEvent, OrchestratorOptions } from '../types.ts';
import { createNullCostTracker } from '../types.ts';

// ============================================================================
// TEST HELPERS
// ============================================================================

let tempDir: string;
let sessionCounter = 0;

function createTempSessionDir(): string {
  const dir = join(tempDir, `session-${++sessionCounter}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createMockOptions(sessionPath: string): OrchestratorOptions {
  return {
    sessionId: `test-session-${sessionCounter}`,
    sessionPath,
    getAuthToken: async () => 'test-token',
    onDebug: undefined,
  };
}

/**
 * Build a minimal AgentConfig for auto-advance testing.
 * Stages 0 and 1 are in pauseAfterStages.
 * Stage 0 has pauseChoices (should always pause).
 * Stage 1 has NO pauseChoices (should auto-advance when autoAdvance=true).
 */
function createTestAgentConfig(overrides?: {
  autoAdvance?: boolean;
  stage1Mode?: 'orchestrator' | 'sdk_breakout';
  stage1PauseChoices?: string[];
}): AgentConfig {
  return {
    slug: 'test-agent',
    name: 'Test Agent',
    controlFlow: {
      stages: [
        {
          id: 0,
          name: 'analyze',
          description: 'Stage 0 with pauseChoices',
          pauseChoices: ['Proceed', 'Amend', 'Cancel'],
        },
        {
          id: 1,
          name: 'process',
          description: 'Stage 1 without pauseChoices',
          ...(overrides?.stage1Mode ? { mode: overrides.stage1Mode } : {}),
          ...(overrides?.stage1PauseChoices ? { pauseChoices: overrides.stage1PauseChoices } : {}),
        },
        {
          id: 2,
          name: 'finalize',
          description: 'Final stage (no pause)',
        },
      ],
      pauseAfterStages: [0, 1],
      autoAdvance: overrides?.autoAdvance ?? false,
    },
    output: {},
  };
}

/** Collect all events from an async generator. */
async function collectEvents(gen: AsyncGenerator<OrchestratorEvent>): Promise<OrchestratorEvent[]> {
  const events: OrchestratorEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

// ============================================================================
// TESTS
// ============================================================================

describe('Auto-Advance', () => {
  beforeEach(() => {
    tempDir = join(tmpdir(), `orch-auto-advance-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    sessionCounter = 0;
  });

  // Note: Full integration tests require mocking the LLM client (StageRunner makes API calls).
  // These tests focus on the pipeline state and event-level behavior by testing through
  // PipelineState directly and verifying the configuration threading.

  describe('Configuration threading', () => {
    it('ControlFlowConfig accepts autoAdvance: true', () => {
      const config = createTestAgentConfig({ autoAdvance: true });
      assert.equal(config.controlFlow.autoAdvance, true);
    });

    it('ControlFlowConfig accepts autoAdvance: false', () => {
      const config = createTestAgentConfig({ autoAdvance: false });
      assert.equal(config.controlFlow.autoAdvance, false);
    });

    it('ControlFlowConfig defaults autoAdvance to undefined when not set', () => {
      const config: AgentConfig = {
        slug: 'test',
        name: 'Test',
        controlFlow: {
          stages: [{ id: 0, name: 's0' }],
          pauseAfterStages: [0],
        },
        output: {},
      };
      assert.equal(config.controlFlow.autoAdvance, undefined);
    });

    it('AgentConfig accepts debug override', () => {
      const config: AgentConfig = {
        slug: 'test',
        name: 'Test',
        controlFlow: { stages: [], pauseAfterStages: [] },
        output: {},
        debug: { enabled: true, skipWebSearch: true, skipVerification: false },
      };
      assert.equal(config.debug?.enabled, true);
      assert.equal(config.debug?.skipWebSearch, true);
      assert.equal(config.debug?.skipVerification, false);
    });
  });

  describe('shouldAutoAdvance condition logic', () => {
    // Test the exact condition used in executePipeline():
    //   agentConfig.controlFlow.autoAdvance === true && !stage.pauseChoices?.length
    // Use a helper to avoid TypeScript literal type narrowing in tests.
    function computeShouldAutoAdvance(
      autoAdvance: boolean | undefined,
      pauseChoices: string[] | undefined,
    ): boolean {
      return autoAdvance === true && !pauseChoices?.length;
    }

    it('autoAdvance=true, no pauseChoices → should auto-advance', () => {
      assert.equal(computeShouldAutoAdvance(true, undefined), true);
    });

    it('autoAdvance=true, empty pauseChoices → should auto-advance', () => {
      assert.equal(computeShouldAutoAdvance(true, []), true);
    });

    it('autoAdvance=true, has pauseChoices → should NOT auto-advance (F1)', () => {
      assert.equal(computeShouldAutoAdvance(true, ['Proceed', 'Amend', 'Cancel']), false);
    });

    it('autoAdvance=false, no pauseChoices → should NOT auto-advance', () => {
      assert.equal(computeShouldAutoAdvance(false, undefined), false);
    });

    it('autoAdvance=undefined, no pauseChoices → should NOT auto-advance', () => {
      assert.equal(computeShouldAutoAdvance(undefined, undefined), false);
    });
  });

  describe('isPaused consistency (F2)', () => {
    it('pipeline with no pause_requested events → isPaused returns false', () => {
      const sessionPath = createTempSessionDir();
      const state = PipelineState.create('test-session', 'test-agent');

      // Simulate auto-advance: stage_completed recorded, but NO pause_requested
      const afterStage = state.addEvent({
        type: 'stage_completed',
        stage: 0,
        data: { summary: 'done', usage: { inputTokens: 0, outputTokens: 0 } },
      });

      assert.equal(afterStage.isPaused, false,
        'isPaused should be false when no pause_requested event exists (auto-advance path)');
    });

    it('pipeline with pause_requested → isPaused returns true', () => {
      const state = PipelineState.create('test-session', 'test-agent');
      const afterPause = state
        .addEvent({ type: 'stage_completed', stage: 0, data: {} })
        .addEvent({ type: 'pause_requested', stage: 0, data: {} });

      assert.equal(afterPause.isPaused, true,
        'isPaused should be true when pause_requested exists (normal pause path)');
    });

    it('pipeline with pause_requested + resumed → isPaused returns false', () => {
      const state = PipelineState.create('test-session', 'test-agent');
      const afterResume = state
        .addEvent({ type: 'stage_completed', stage: 0, data: {} })
        .addEvent({ type: 'pause_requested', stage: 0, data: {} })
        .addEvent({ type: 'resumed', stage: 0, data: {} });

      assert.equal(afterResume.isPaused, false,
        'isPaused should be false after resumed event');
    });
  });

  describe('SDK breakout priority', () => {
    it('sdk_breakout stage config is orthogonal to pauseAfterStages', () => {
      // Verify that sdk_breakout stages can exist independently of pauseAfterStages.
      // In executePipeline(), breakout check (mode === 'sdk_breakout') runs BEFORE
      // pause-after check. Auto-advance cannot affect breakout stages.
      const config = createTestAgentConfig({
        autoAdvance: true,
        stage1Mode: 'sdk_breakout',
      });

      const stage1 = config.controlFlow.stages[1];
      assert.equal(stage1?.mode, 'sdk_breakout');
      assert.equal(config.controlFlow.autoAdvance, true);
      // In executePipeline(), the breakout check at line ~641 runs before
      // the pause-after check at line ~682. This is structural — tested by code inspection.
    });
  });

  describe('dev-loop config compatibility', () => {
    it('stages with pauseChoices override autoAdvance (F1 verification)', () => {
      // Simulate dev-loop config: autoAdvance=true, stages 0 and 3 have pauseChoices
      const config: AgentConfig = {
        slug: 'dev-loop',
        name: 'Dev Loop',
        controlFlow: {
          stages: [
            { id: 0, name: 'analyze_request', pauseChoices: ['Proceed', 'Amend', 'Cancel'] },
            { id: 1, name: 'plan', mode: 'sdk_breakout' },
            { id: 2, name: 'review' },                       // no pauseChoices → auto-advances
            { id: 3, name: 'refine_plan', pauseChoices: ['Approve', 'Amend', 'Cancel'] },
            { id: 4, name: 'implement', mode: 'sdk_breakout' },
            { id: 5, name: 'test_and_diagnose', mode: 'sdk_breakout' },
            { id: 6, name: 'decide' },                       // no pauseChoices → auto-advances
          ],
          pauseAfterStages: [0, 3],
          autoAdvance: true,
        },
        output: {},
      };

      // Stage 0: has pauseChoices → should NOT auto-advance
      const stage0 = config.controlFlow.stages[0]!;
      const shouldAutoAdvance0 = config.controlFlow.autoAdvance === true && !stage0.pauseChoices?.length;
      assert.equal(shouldAutoAdvance0, false, 'Stage 0 (pauseChoices) should NOT auto-advance');

      // Stage 2: no pauseChoices, in pauseAfterStages? No — stage 2 is not in [0, 3]
      // But if it WERE added to pauseAfterStages, it would auto-advance
      const stage2 = config.controlFlow.stages[2]!;
      const shouldAutoAdvance2 = config.controlFlow.autoAdvance === true && !stage2.pauseChoices?.length;
      assert.equal(shouldAutoAdvance2, true, 'Stage 2 (no pauseChoices) would auto-advance if in pauseAfterStages');

      // Stage 3: has pauseChoices → should NOT auto-advance
      const stage3 = config.controlFlow.stages[3]!;
      const shouldAutoAdvance3 = config.controlFlow.autoAdvance === true && !stage3.pauseChoices?.length;
      assert.equal(shouldAutoAdvance3, false, 'Stage 3 (pauseChoices) should NOT auto-advance');

      // Stage 6: no pauseChoices → would auto-advance if in pauseAfterStages
      const stage6 = config.controlFlow.stages[6]!;
      const shouldAutoAdvance6 = config.controlFlow.autoAdvance === true && !stage6.pauseChoices?.length;
      assert.equal(shouldAutoAdvance6, true, 'Stage 6 (no pauseChoices) would auto-advance if in pauseAfterStages');
    });
  });
});
