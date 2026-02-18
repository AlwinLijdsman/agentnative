/**
 * E2E Test Utilities for Agent Stage Gate
 *
 * Provides a session harness, JSONL readers, and assertion helpers
 * to test full agent lifecycle flows (reset → start → complete → pause → resume).
 *
 * Uses REAL temp directories via createTestAgentContext() from test-utils.ts.
 */

import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { handleAgentStageGate } from '../agent-stage-gate.ts';
import {
  createTestAgentContext,
  createMockCallbacks,
  TEST_AGENT_SLUG,
  type TestContext,
  type MockCallbacks,
} from './test-utils.ts';
import type { AgentStageGateArgs } from '../agent-stage-gate.ts';

// ============================================================
// Types
// ============================================================

export interface E2EStageEvent {
  type: string;
  timestamp: string;
  runId: string;
  data: Record<string, unknown>;
}

export interface E2EHarnessOptions {
  /** Override agent slug (default: TEST_AGENT_SLUG) */
  agentSlug?: string;
  /** Custom agent config to write (default: uses TEST_AGENT_CONFIG from test-utils) */
  agentConfig?: Record<string, unknown>;
  /** Whether to add pauseInstructions to stage 0 */
  pauseInstructions?: string;
}

// ============================================================
// E2E Session Harness
// ============================================================

/**
 * Wraps createTestAgentContext() with a high-level lifecycle API for E2E tests.
 *
 * Usage:
 *   const harness = E2ESessionHarness.create();
 *   const result = await harness.gate('start', 0);
 *   harness.assertPauseAt(0);
 *   harness.cleanup();
 */
export class E2ESessionHarness {
  readonly ctx: TestContext;
  readonly callbacks: MockCallbacks;
  readonly agentSlug: string;

  private constructor(ctx: TestContext, callbacks: MockCallbacks, agentSlug: string) {
    this.ctx = ctx;
    this.callbacks = callbacks;
    this.agentSlug = agentSlug;
  }

  static create(options?: E2EHarnessOptions): E2ESessionHarness {
    const callbacks = createMockCallbacks();
    const ctx = createTestAgentContext({ callbacks });
    const slug = options?.agentSlug ?? TEST_AGENT_SLUG;

    // Apply custom config if provided
    if (options?.agentConfig) {
      writeAgentConfig(ctx, slug, options.agentConfig);
    }

    // Apply pauseInstructions if requested
    if (options?.pauseInstructions) {
      const configPath = join(ctx.workspacePath, 'agents', slug, 'config.json');
      const config = JSON.parse(ctx.fs.readFile(configPath)) as {
        controlFlow: {
          stages: Array<{ id: number; name: string; description: string; pauseInstructions?: string }>;
        };
      };
      config.controlFlow.stages[0]!.pauseInstructions = options.pauseInstructions;
      ctx.fs.writeFile(configPath, JSON.stringify(config, null, 2));
    }

    return new E2ESessionHarness(ctx, callbacks, slug);
  }

  /**
   * Call handleAgentStageGate and return parsed JSON result.
   */
  async gate(
    action: AgentStageGateArgs['action'],
    stage?: number,
    data?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const result = await handleAgentStageGate(this.ctx, {
      agentSlug: this.agentSlug,
      action,
      stage,
      data,
    });
    return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
  }

  /**
   * Execute a full reset → start(0) → complete(0) → pause flow.
   * Returns the complete(0) result.
   */
  async runToStage0Pause(data?: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.gate('reset', undefined, { force: true });
    await this.gate('start', 0);
    return this.gate('complete', 0, data);
  }

  /**
   * Read the agent-events.jsonl file and return parsed events.
   */
  readEvents(): E2EStageEvent[] {
    return readSessionJSONL(this.ctx, this.agentSlug);
  }

  /**
   * Read current-run-state.json for the agent.
   */
  readRunState(): Record<string, unknown> {
    const statePath = join(
      this.ctx.workspacePath, 'sessions', this.ctx.sessionId,
      'data', 'agents', this.agentSlug, 'current-run-state.json',
    );
    return JSON.parse(this.ctx.fs.readFile(statePath)) as Record<string, unknown>;
  }

  /**
   * Assert that onAgentStagePause was called with expected stage.
   */
  assertPauseAt(expectedStage: number): void {
    assertPauseAt(this.callbacks, expectedStage);
  }

  /**
   * Assert that events contain expected stage transitions in order.
   */
  assertStageTransitions(expectedActions: string[]): void {
    assertStageTransition(this.readEvents(), expectedActions);
  }

  cleanup(): void {
    this.ctx.cleanup();
  }
}

// ============================================================
// Standalone Helpers
// ============================================================

/**
 * Generate an E2E session ID with timestamp for traceability.
 */
export function createE2ESessionId(): string {
  const ts = Date.now().toString(36);
  return `e2e-test-${ts}`;
}

/**
 * Write a custom agent config.json to the test workspace.
 */
export function writeAgentConfig(
  ctx: TestContext,
  agentSlug: string,
  config: Record<string, unknown>,
): void {
  const agentDir = join(ctx.workspacePath, 'agents', agentSlug);
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, 'config.json'), JSON.stringify(config, null, 2));
}

/**
 * Read and parse agent-events.jsonl from the session data directory.
 */
export function readSessionJSONL(ctx: TestContext, agentSlug: string): E2EStageEvent[] {
  const eventsPath = join(
    ctx.workspacePath, 'sessions', ctx.sessionId,
    'data', 'agents', agentSlug, 'agent-events.jsonl',
  );
  if (!ctx.fs.exists(eventsPath)) return [];
  return ctx.fs.readFile(eventsPath)
    .trim()
    .split('\n')
    .filter((line: string) => line.length > 0)
    .map((line: string) => JSON.parse(line) as E2EStageEvent);
}

/**
 * Assert that events contain expected action types in the given order.
 * Allows interleaving of other events — only checks relative order.
 */
export function assertStageTransition(
  events: E2EStageEvent[],
  expectedActions: string[],
): void {
  let expectedIdx = 0;
  for (const event of events) {
    if (expectedIdx < expectedActions.length && event.type === expectedActions[expectedIdx]) {
      expectedIdx++;
    }
  }
  assert.equal(
    expectedIdx,
    expectedActions.length,
    `Expected event sequence ${JSON.stringify(expectedActions)} but only matched ${expectedIdx}/${expectedActions.length}. ` +
    `Actual events: ${events.map(e => e.type).join(', ')}`,
  );
}

/**
 * Assert that onAgentStagePause callback was called with expected stage.
 */
export function assertPauseAt(callbacks: MockCallbacks, expectedStage: number): void {
  assert.ok(
    callbacks.onAgentStagePause.callCount >= 1,
    `Expected onAgentStagePause to be called at least once, but callCount=${callbacks.onAgentStagePause.callCount}`,
  );
  const lastCall = callbacks.onAgentStagePause.calls[callbacks.onAgentStagePause.callCount - 1]!;
  const pauseData = lastCall[0] as { stage: number };
  assert.equal(
    pauseData.stage,
    expectedStage,
    `Expected pause at stage ${expectedStage}, got stage ${pauseData.stage}`,
  );
}

/**
 * Assert that no stage is completed twice without a repair action in between.
 */
export function assertNoDuplicateCompletes(events: E2EStageEvent[]): void {
  const completed = new Set<number>();
  for (const event of events) {
    if (event.type === 'stage_completed') {
      const stage = event.data.stage as number;
      assert.ok(
        !completed.has(stage),
        `Stage ${stage} was completed twice without a repair. Events: ${events.map(e => `${e.type}(${e.data.stage ?? ''})`).join(', ')}`,
      );
      completed.add(stage);
    } else if (event.type === 'repair_iteration') {
      // Clear repair unit stages from completed set
      const repairStages = event.data.stages as number[] | undefined;
      if (repairStages) {
        for (const s of repairStages) {
          completed.delete(s);
        }
      }
    }
  }
}
