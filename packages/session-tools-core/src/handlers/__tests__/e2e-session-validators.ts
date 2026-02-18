/**
 * Session JSONL Validation Utilities
 *
 * Automated validators for session artifacts produced during agent runs.
 * Validates event log structure, run state persistence, stage output schemas,
 * event ordering, and duplicate detection.
 */

import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { TestContext } from './test-utils.ts';
import type { E2EStageEvent } from './e2e-utils.ts';
import { readSessionJSONL } from './e2e-utils.ts';

// ============================================================
// Types
// ============================================================

/** Minimal stage output schema (mirrors agent-stage-gate.ts). */
interface StageOutputSchemaProperty {
  type?: 'string' | 'number' | 'boolean' | 'array' | 'object';
  enum?: unknown[];
  minItems?: number;
  required?: string[];
  properties?: Record<string, StageOutputSchemaProperty>;
}

interface StageOutputSchema {
  required?: string[];
  properties?: Record<string, StageOutputSchemaProperty>;
}

interface AgentConfig {
  controlFlow: {
    stages: Array<{ id: number; name: string; description: string; pauseInstructions?: string }>;
    repairUnits: Array<{ stages: [number, number]; maxIterations: number; feedbackField: string }>;
    pauseAfterStages: number[];
    autoAdvance: boolean;
    stageOutputSchemas?: Record<string, StageOutputSchema>;
  };
}

// ============================================================
// Event Log Validators
// ============================================================

/**
 * Validate that an agent-events.jsonl file contains well-formed events.
 * Each line must be valid JSON with required fields: type, timestamp, runId.
 * Returns parsed events for further assertion.
 */
export function validateAgentEventsLog(
  ctx: TestContext,
  agentSlug: string,
): E2EStageEvent[] {
  const events = readSessionJSONL(ctx, agentSlug);

  assert.ok(
    events.length > 0,
    'agent-events.jsonl should contain at least one event',
  );

  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    assert.ok(
      typeof event.type === 'string' && event.type.length > 0,
      `Event ${i}: 'type' must be a non-empty string, got: ${JSON.stringify(event.type)}`,
    );
    assert.ok(
      typeof event.timestamp === 'string' && event.timestamp.length > 0,
      `Event ${i}: 'timestamp' must be a non-empty string, got: ${JSON.stringify(event.timestamp)}`,
    );
    assert.ok(
      typeof event.runId === 'string' && event.runId.length > 0,
      `Event ${i}: 'runId' must be a non-empty string, got: ${JSON.stringify(event.runId)}`,
    );
  }

  return events;
}

// ============================================================
// Run State Validators
// ============================================================

/**
 * Validate that current-run-state.json exists and has correct structure.
 * Returns parsed state for further assertion.
 */
export function validateRunState(
  ctx: TestContext,
  agentSlug: string,
  expectedPausedAtStage?: number,
): Record<string, unknown> {
  const statePath = join(
    ctx.workspacePath, 'sessions', ctx.sessionId,
    'data', 'agents', agentSlug, 'current-run-state.json',
  );
  assert.ok(
    ctx.fs.exists(statePath),
    `current-run-state.json should exist at ${statePath}`,
  );

  const state = JSON.parse(ctx.fs.readFile(statePath)) as Record<string, unknown>;

  // Must have runId
  assert.ok(
    typeof state.runId === 'string' && (state.runId as string).length > 0,
    'run state must have a non-empty runId',
  );

  // Validate pausedAtStage if expected
  if (expectedPausedAtStage !== undefined) {
    assert.equal(
      state.pausedAtStage,
      expectedPausedAtStage,
      `Expected pausedAtStage=${expectedPausedAtStage}, got ${state.pausedAtStage}`,
    );
  }

  return state;
}

// ============================================================
// Stage Output Schema Validation
// ============================================================

/**
 * Validate stage output data against a stage output schema.
 * Returns array of warning strings (empty = valid).
 */
export function validateStageOutputSchema(
  data: unknown,
  schema: StageOutputSchema,
): string[] {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return [`Expected an object, got ${typeof data}`];
  }

  const obj = data as Record<string, unknown>;
  const warnings: string[] = [];

  // Check top-level required fields
  if (schema.required) {
    for (const req of schema.required) {
      if (!(req in obj)) {
        warnings.push(`${req}: required field missing`);
      }
    }
  }

  // Validate known properties
  if (schema.properties) {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (key in obj) {
        warnings.push(...validatePropertyValue(obj[key], propSchema, key));
      }
    }
  }

  return warnings;
}

function validatePropertyValue(
  value: unknown,
  schema: StageOutputSchemaProperty,
  path: string,
): string[] {
  const warnings: string[] = [];

  if (schema.type) {
    const actualType = Array.isArray(value) ? 'array' : typeof value;
    if (value !== undefined && value !== null && actualType !== schema.type) {
      warnings.push(`${path}: expected type '${schema.type}', got '${actualType}'`);
    }
  }

  if (schema.enum && value !== undefined) {
    if (!schema.enum.includes(value)) {
      warnings.push(`${path}: value '${String(value)}' not in enum [${schema.enum.map(String).join(', ')}]`);
    }
  }

  if (schema.minItems !== undefined && Array.isArray(value)) {
    if (value.length < schema.minItems) {
      warnings.push(`${path}: array has ${value.length} items, minimum is ${schema.minItems}`);
    }
  }

  if (schema.properties && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (schema.required) {
      for (const req of schema.required) {
        if (!(req in obj)) {
          warnings.push(`${path}.${req}: required field missing`);
        }
      }
    }
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (key in obj) {
        warnings.push(...validatePropertyValue(obj[key], propSchema, `${path}.${key}`));
      }
    }
  }

  return warnings;
}

// ============================================================
// Event Sequence Assertions
// ============================================================

/**
 * Assert that events contain expected action types in the given order.
 * Allows interleaving of other events — only checks relative order.
 */
export function assertEventSequence(
  events: E2EStageEvent[],
  expected: string[],
): void {
  let expectedIdx = 0;
  for (const event of events) {
    if (expectedIdx < expected.length && event.type === expected[expectedIdx]) {
      expectedIdx++;
    }
  }
  assert.equal(
    expectedIdx,
    expected.length,
    `Expected event sequence ${JSON.stringify(expected)} but only matched ${expectedIdx}/${expected.length}. ` +
    `Actual events: ${events.map(e => e.type).join(', ')}`,
  );
}

/**
 * Assert that no stage is completed twice without a repair action in between.
 * Handles repair scenarios by clearing completed set when repair events appear.
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
    } else if (event.type === 'repair_started' || event.type === 'repair_iteration' || event.type === 'repair_unit_started') {
      // Clear repair unit stages from completed set
      const repairStages = event.data.stages as number[] | undefined;
      if (repairStages) {
        for (const s of repairStages) {
          completed.delete(s);
        }
      }
      // If no explicit stages in event data, clear ALL stages in completed set
      // (repair resets the slate for re-execution)
      if (!repairStages) {
        completed.clear();
      }
    }
  }
}

/**
 * Load and parse the ISA agent config from the test workspace.
 */
export function loadAgentConfig(
  ctx: TestContext,
  agentSlug: string,
): AgentConfig {
  const configPath = join(ctx.workspacePath, 'agents', agentSlug, 'config.json');
  assert.ok(
    ctx.fs.exists(configPath),
    `Agent config should exist at ${configPath}`,
  );
  return JSON.parse(ctx.fs.readFile(configPath)) as AgentConfig;
}

/**
 * Validate stage output against the agent's stageOutputSchemas config.
 * Returns warnings array (empty = valid).
 */
export function validateStageOutputAgainstConfig(
  ctx: TestContext,
  agentSlug: string,
  stageId: number,
  data: unknown,
): string[] {
  const config = loadAgentConfig(ctx, agentSlug);
  const schemas = config.controlFlow.stageOutputSchemas;
  if (!schemas) return [];

  const schema = schemas[String(stageId)];
  if (!schema) return [];

  return validateStageOutputSchema(data, schema);
}

/**
 * Assert that events show a valid repair loop pattern:
 * A repair loop should have start_repair_unit → repeated (start→complete) → end_repair_unit.
 */
export function assertRepairLoop(
  events: E2EStageEvent[],
  repairStages: [number, number],
): void {
  // Find repair boundaries
  const repairStartIdx = events.findIndex(e => e.type === 'repair_unit_started');
  assert.ok(repairStartIdx >= 0, 'Expected repair_unit_started event');

  const repairEndIdx = events.findIndex(
    (e, i) => i > repairStartIdx && e.type === 'repair_unit_ended',
  );
  assert.ok(repairEndIdx >= 0, 'Expected repair_unit_ended event');

  // Within the repair, check that repair stages are re-executed
  const repairEvents = events.slice(repairStartIdx + 1, repairEndIdx);
  const stageStarts = repairEvents
    .filter(e => e.type === 'stage_started')
    .map(e => e.data.stage as number);

  for (const stage of repairStages) {
    assert.ok(
      stageStarts.includes(stage),
      `Repair loop should re-execute stage ${stage}. Started stages: ${stageStarts.join(', ')}`,
    );
  }
}

// ============================================================
// Outcome-Based Assertions (Pattern-Agnostic)
// ============================================================

/**
 * Assert that a pause occurred at the expected stage using outcome-based checks.
 * Works regardless of whether the SDK executed via Task-nested or top-level pattern.
 *
 * Checks three independent indicators:
 * 1. Event log contains a stage_gate_pause event with the expected stage
 * 2. Run state file reflects the paused stage
 * 3. onAgentStagePause callback was called with the expected stage
 */
export function assertPauseOutcome(
  ctx: TestContext,
  agentSlug: string,
  callbacks: { onAgentStagePause: { callCount: number; calls: unknown[][] } },
  expectedStage: number,
): void {
  // 1. Event log contains pause event at expected stage
  const events = readSessionJSONL(ctx, agentSlug);
  const pauseEvents = events.filter(e => e.type === 'stage_gate_pause');
  assert.ok(
    pauseEvents.length >= 1,
    `Expected at least one stage_gate_pause event, got ${pauseEvents.length}. ` +
    `Events: ${events.map(e => e.type).join(', ')}`,
  );
  const pauseAtStage = pauseEvents.find(
    e => (e.data.stage as number) === expectedStage,
  );
  assert.ok(
    pauseAtStage !== undefined,
    `Expected stage_gate_pause at stage ${expectedStage}. ` +
    `Pause events at stages: ${pauseEvents.map(e => e.data.stage).join(', ')}`,
  );

  // 2. Run state reflects paused stage
  const statePath = join(
    ctx.workspacePath, 'sessions', ctx.sessionId,
    'data', 'agents', agentSlug, 'current-run-state.json',
  );
  if (ctx.fs.exists(statePath)) {
    const state = JSON.parse(ctx.fs.readFile(statePath)) as Record<string, unknown>;
    assert.equal(
      state.pausedAtStage,
      expectedStage,
      `Run state should show pausedAtStage=${expectedStage}, got ${state.pausedAtStage}`,
    );
  }

  // 3. Callback was called exactly once with expected stage
  assert.equal(
    callbacks.onAgentStagePause.callCount,
    1,
    `Expected onAgentStagePause to be called exactly once, got ${callbacks.onAgentStagePause.callCount}`,
  );
  const callData = callbacks.onAgentStagePause.calls[0]![0] as { stage: number };
  assert.equal(
    callData.stage,
    expectedStage,
    `Expected pause callback at stage ${expectedStage}, got stage ${callData.stage}`,
  );
}
