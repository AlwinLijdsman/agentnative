/**
 * E2E Session Validation Tests
 *
 * Tests that validate the session JSONL artifacts, run state persistence,
 * stage output schemas, and full multi-stage sequences.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { E2ESessionHarness } from './e2e-utils.ts';
import { TEST_AGENT_CONFIG_EXTENDED } from './test-utils.ts';
import {
  validateAgentEventsLog,
  validateRunState,
  validateStageOutputSchema,
  assertEventSequence,
  assertNoDuplicateCompletes,
  loadAgentConfig,
  validateStageOutputAgainstConfig,
} from './e2e-session-validators.ts';

describe('E2E Session Validation', () => {
  let harness: E2ESessionHarness;

  afterEach(() => {
    harness?.cleanup();
  });

  // ============================================================
  // Test 1: Full stage-gate sequence produces valid event log
  // ============================================================

  it('full sequence reset→start(0)→complete(0,paused)→resume→start(1)→complete(1)→...→complete(4) produces valid event log', async () => {
    harness = E2ESessionHarness.create();

    // Stage 0: triggers pause
    await harness.gate('reset', undefined, { force: true });
    await harness.gate('start', 0);
    await harness.gate('complete', 0, {
      query_plan: {
        original_query: 'test query',
        sub_queries: ['sub1'],
        depth_mode: 'standard',
      },
    });

    // Resume from pause
    await harness.gate('resume', undefined, { decision: 'proceed' });

    // Stages 1–4: no pause
    for (let stage = 1; stage <= 4; stage++) {
      await harness.gate('start', stage);
      const stageData = getStageData(stage);
      await harness.gate('complete', stage, stageData);
    }

    // Validate event log structure
    const events = validateAgentEventsLog(harness.ctx, harness.agentSlug);

    // Validate event sequence
    assertEventSequence(events, [
      'agent_run_started',   // start(0)
      'stage_completed',     // complete(0)
      'stage_gate_pause',    // pause after 0
      'stage_gate_resumed',  // resume
      'stage_started',       // start(1)
      'stage_completed',     // complete(1)
      'stage_started',       // start(2)
      'stage_completed',     // complete(2)
      'stage_started',       // start(3)
      'stage_completed',     // complete(3)
      'stage_started',       // start(4)
      'stage_completed',     // complete(4)
    ]);

    // No duplicate completes
    assertNoDuplicateCompletes(events);

    // Final run state should not be paused (pipeline completed)
    const state = validateRunState(harness.ctx, harness.agentSlug);
    // After all stages complete, pausedAtStage should not be set
    // (it's cleared on resume and stays clear through remaining stages)
    assert.ok(
      state.pausedAtStage === undefined || state.pausedAtStage === null,
      `Expected pausedAtStage to be cleared after full pipeline completion, got ${state.pausedAtStage}`,
    );
  });

  // ============================================================
  // Test 2: Stage 0 output matches stageOutputSchemas["0"]
  // ============================================================

  it('stage 0 output matches stageOutputSchemas["0"] from agent config', async () => {
    harness = E2ESessionHarness.create({ agentConfig: TEST_AGENT_CONFIG_EXTENDED });

    // Verify config has stage 0 schema
    const config = loadAgentConfig(harness.ctx, harness.agentSlug);
    assert.ok(
      config.controlFlow.stageOutputSchemas?.['0'],
      'Agent config should have stageOutputSchemas for stage 0',
    );

    // Valid stage 0 data
    const validData = {
      query_plan: {
        original_query: 'What does ISA 315 say about risk assessment?',
        sub_queries: ['ISA 315 risk assessment requirements'],
        depth_mode: 'standard',
        assumptions: ['Focus on revised ISA 315'],
        recommended_action: 'proceed',
      },
    };

    const warnings = validateStageOutputAgainstConfig(
      harness.ctx,
      harness.agentSlug,
      0,
      validData,
    );
    assert.deepEqual(
      warnings,
      [],
      `Expected no validation warnings for valid stage 0 data, got: ${warnings.join(', ')}`,
    );

    // Invalid data: missing required field
    const invalidData = {
      not_query_plan: 'wrong field',
    };

    const invalidWarnings = validateStageOutputAgainstConfig(
      harness.ctx,
      harness.agentSlug,
      0,
      invalidData,
    );
    assert.ok(
      invalidWarnings.length > 0,
      'Expected validation warnings for invalid stage 0 data (missing query_plan)',
    );
    assert.ok(
      invalidWarnings.some(w => w.includes('query_plan') && w.includes('required')),
      `Expected warning about missing query_plan field, got: ${invalidWarnings.join(', ')}`,
    );
  });

  // ============================================================
  // Test 3: Repair loop produces expected repair events
  // ============================================================

  it('repair loop produces valid events with no duplicate completes', async () => {
    harness = E2ESessionHarness.create();

    // Setup: run through stage 0 pause + resume + stages 1-3
    await harness.gate('reset', undefined, { force: true });
    await harness.gate('start', 0);
    await harness.gate('complete', 0, {
      query_plan: {
        original_query: 'test',
        sub_queries: ['sub1'],
        depth_mode: 'standard',
      },
    });
    await harness.gate('resume', undefined, { decision: 'proceed' });

    // Stage 1
    await harness.gate('start', 1);
    await harness.gate('complete', 1, {
      retrieval_summary: {
        total_paragraphs_found: 10,
        unique_after_dedup: 8,
        standards_covered: ['ISA 315'],
      },
    });

    // Stage 2 (synthesis — part of repair unit [2,3])
    await harness.gate('start', 2);
    await harness.gate('complete', 2, {
      synthesis: 'Initial synthesis of ISA standards.',
      citations_used: ['ISA 315.4a'],
    });

    // Stage 3 (verify — part of repair unit [2,3])
    await harness.gate('start', 3);
    // Complete with a repair request
    await harness.gate('complete', 3, {
      verification_scores: { EG: 0.6, CA: 0.8, RP: 0.7, CD: 0.5 },
      all_passed: false,
    });

    // Start repair loop
    const repairStart = await harness.gate('start_repair_unit', undefined, {
      stages: [2, 3],
      repair_instructions: 'Improve citation density',
    });
    assert.equal(repairStart.repairUnitActive, true, 'repair unit should be active after start_repair_unit');

    // Re-run stages 2 and 3 within repair
    await harness.gate('start', 2);
    await harness.gate('complete', 2, {
      synthesis: 'Improved synthesis with more citations.',
      citations_used: ['ISA 315.4a', 'ISA 315.11'],
    });

    await harness.gate('start', 3);
    await harness.gate('complete', 3, {
      verification_scores: { EG: 0.9, CA: 0.9, RP: 0.9, CD: 0.9 },
      all_passed: true,
    });

    // End repair loop
    const repairEnd = await harness.gate('end_repair_unit');
    assert.equal(repairEnd.repairUnitActive, false, 'repair unit should be inactive after end_repair_unit');

    // Complete pipeline
    await harness.gate('start', 4);
    await harness.gate('complete', 4, {
      answer_delivered: true,
      total_citations: 3,
    });

    // Validate the event log
    const events = validateAgentEventsLog(harness.ctx, harness.agentSlug);

    // No illegal duplicate completes (repair clears the set)
    assertNoDuplicateCompletes(events);

    // Verify event sequence includes repair events
    assertEventSequence(events, [
      'agent_run_started',      // start(0)
      'stage_completed',        // complete(0)
      'stage_gate_pause',       // pause
      'stage_gate_resumed',     // resume
      'stage_started',          // start(1)
      'stage_completed',        // complete(1)
      'stage_started',          // start(2) — first pass
      'stage_completed',        // complete(2)
      'stage_started',          // start(3) — first pass
      'stage_completed',        // complete(3)
      'repair_unit_started',    // start_repair_unit
      'stage_started',          // start(2) — repair pass
      'stage_completed',        // complete(2)
      'stage_started',          // start(3) — repair pass
      'stage_completed',        // complete(3)
      'repair_unit_completed',  // end_repair_unit
      'stage_started',          // start(4)
      'stage_completed',        // complete(4)
    ]);
  });

  // ============================================================
  // Test 4: validateStageOutputSchema catches type mismatches
  // ============================================================

  it('validateStageOutputSchema detects type mismatches and enum violations', () => {
    const schema = {
      required: ['name', 'count'],
      properties: {
        name: { type: 'string' as const },
        count: { type: 'number' as const },
        mode: { type: 'string' as const, enum: ['quick', 'standard', 'deep'] },
        items: { type: 'array' as const, minItems: 1 },
      },
    };

    // Valid data
    const valid = validateStageOutputSchema(
      { name: 'test', count: 5, mode: 'quick', items: ['a'] },
      schema,
    );
    assert.deepEqual(valid, [], 'Valid data should produce no warnings');

    // Missing required fields
    const missingRequired = validateStageOutputSchema({}, schema);
    assert.ok(
      missingRequired.some(w => w.includes('name') && w.includes('required')),
      `Expected warning about missing 'name', got: ${missingRequired.join(', ')}`,
    );
    assert.ok(
      missingRequired.some(w => w.includes('count') && w.includes('required')),
      `Expected warning about missing 'count', got: ${missingRequired.join(', ')}`,
    );

    // Type mismatch
    const typeMismatch = validateStageOutputSchema(
      { name: 123, count: 'not-a-number' },
      schema,
    );
    assert.ok(
      typeMismatch.some(w => w.includes('name') && w.includes("expected type 'string'")),
      `Expected type mismatch for 'name', got: ${typeMismatch.join(', ')}`,
    );

    // Enum violation
    const enumViolation = validateStageOutputSchema(
      { name: 'test', count: 5, mode: 'ultra' },
      schema,
    );
    assert.ok(
      enumViolation.some(w => w.includes('mode') && w.includes('not in enum')),
      `Expected enum violation for 'mode', got: ${enumViolation.join(', ')}`,
    );

    // MinItems violation
    const minItemsViolation = validateStageOutputSchema(
      { name: 'test', count: 5, items: [] },
      schema,
    );
    assert.ok(
      minItemsViolation.some(w => w.includes('items') && w.includes('minimum')),
      `Expected minItems warning, got: ${minItemsViolation.join(', ')}`,
    );
  });
});

// ============================================================
// Helpers
// ============================================================

/** Generate plausible stage output data for stages 1-4. */
function getStageData(stage: number): Record<string, unknown> {
  switch (stage) {
    case 1:
      return {
        retrieval_summary: {
          total_paragraphs_found: 15,
          unique_after_dedup: 12,
          standards_covered: ['ISA 315', 'ISA 330'],
        },
      };
    case 2:
      return {
        synthesis: 'Synthesized analysis of ISA standards.',
        citations_used: ['ISA 315.4a', 'ISA 330.7'],
      };
    case 3:
      return {
        verification_scores: { EG: 0.95, CA: 0.9, RP: 0.88, CD: 0.92 },
        all_passed: true,
      };
    case 4:
      return {
        answer_delivered: true,
        total_citations: 5,
      };
    default:
      return {};
  }
}
