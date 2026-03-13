/**
 * E2E Tests for Dev-Loop Agent Stage Gate Lifecycle
 *
 * Tests the dev-loop agent's full lifecycle using the E2ESessionHarness.
 * Covers: pause with pauseInstructions, schema enforcement (block mode),
 * repair loop, and Stage 6 decision variants.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { E2ESessionHarness } from './e2e-utils.ts';

// Dev-loop config matching agents/dev-loop/config.json
const DEV_LOOP_CONFIG = {
  controlFlow: {
    stages: [
      { id: 0, name: 'analyze_request', description: 'Parse feature request', pauseInstructions: 'Review the scope assessment.' },
      { id: 1, name: 'plan', description: 'Generate implementation plan', mode: 'sdk_breakout' },
      { id: 2, name: 'review', description: 'Adversarial review' },
      { id: 3, name: 'refine_plan', description: 'Refine plan', pauseInstructions: 'Review the refined plan.' },
      { id: 4, name: 'implement', description: 'Execute plan', mode: 'sdk_breakout' },
      { id: 5, name: 'test_and_diagnose', description: 'Run tests', mode: 'sdk_breakout' },
      { id: 6, name: 'decide', description: 'Convergence assessment' },
    ],
    repairUnits: [
      { stages: [4, 5], maxIterations: 5, feedbackField: 'repair_feedback' },
    ],
    pauseAfterStages: [0, 3],
    autoAdvance: true,
    stageOutputSchemas: {
      '0': {
        required: ['scope', 'feature_description'],
        properties: {
          scope: { type: 'string' },
          feature_description: { type: 'string' },
        },
      },
      '4': {
        required: ['files_modified', 'typecheck_passed'],
        properties: {
          files_modified: { type: 'array' },
          typecheck_passed: { type: 'boolean' },
        },
        enforcement: 'block',
        blockMessage: 'Stage 4 BLOCKED: files_modified and typecheck_passed required.',
      },
      '5': {
        required: ['tests_passed', 'total_tests', 'needsRepair'],
        properties: {
          tests_passed: { type: 'boolean' },
          total_tests: { type: 'number' },
          needsRepair: { type: 'boolean' },
          repair_feedback: { type: 'string' },
        },
        enforcement: 'block',
        blockMessage: 'Stage 5 BLOCKED: tests_passed, total_tests, and needsRepair required.',
      },
      '6': {
        required: ['decision'],
        properties: {
          decision: { type: 'string', enum: ['done', 'restart', 'escalate'] },
        },
        enforcement: 'block',
        blockMessage: 'Stage 6 BLOCKED: decision required.',
      },
    },
  },
};

const DEV_LOOP_SLUG = 'dev-loop';

describe('E2E Dev-Loop Agent', () => {
  let harness: E2ESessionHarness;

  afterEach(() => {
    harness?.cleanup();
  });

  // ============================================================
  // Test 1: Stage 0 pause fires with pauseInstructions
  // ============================================================

  it('Stage 0 pause uses pauseInstructions from config (not ISA fallback)', async () => {
    harness = E2ESessionHarness.create({
      agentSlug: DEV_LOOP_SLUG,
      agentConfig: DEV_LOOP_CONFIG,
    });

    await harness.gate('reset', undefined, { force: true });
    await harness.gate('start', 0);
    const result = await harness.gate('complete', 0, {
      scope: 'Add dark mode toggle',
      feature_description: 'Allow users to switch between light and dark themes',
    });

    assert.equal(result.pauseRequired, true, 'Stage 0 should pause');
    assert.equal(result.allowed, false);
    // Verify pauseInstructions text appears in the reason
    assert.ok(
      (result.reason as string).includes('Review the scope assessment'),
      `Expected pauseInstructions text in reason. Got: ${(result.reason as string).slice(0, 200)}`,
    );
    harness.assertPauseAt(0);
  });

  // ============================================================
  // Test 2: Stage 3 pause fires with pauseInstructions
  // ============================================================

  it('Stage 3 pause uses pauseInstructions from config', async () => {
    harness = E2ESessionHarness.create({
      agentSlug: DEV_LOOP_SLUG,
      agentConfig: DEV_LOOP_CONFIG,
    });

    // Run through stages 0-3
    await harness.gate('reset', undefined, { force: true });
    await harness.gate('start', 0);
    await harness.gate('complete', 0, { scope: 'test', feature_description: 'test' });
    await harness.gate('resume', undefined, { decision: 'proceed' });

    // Stages 1 and 2 (non-pause)
    await harness.gate('start', 1);
    await harness.gate('complete', 1, { plan_summary: 'test plan', phases: ['phase1'] });
    await harness.gate('start', 2);
    await harness.gate('complete', 2, { findings: [], plan_verdict: 'pass' });

    // Stage 3 should pause
    await harness.gate('start', 3);
    const result = await harness.gate('complete', 3, {
      refined_plan: 'Updated plan',
      final_phases: ['phase1'],
    });

    assert.equal(result.pauseRequired, true, 'Stage 3 should pause');
    assert.ok(
      (result.reason as string).includes('Review the refined plan'),
      `Expected pauseInstructions text. Got: ${(result.reason as string).slice(0, 200)}`,
    );
  });

  // ============================================================
  // Test 3: Schema enforcement — Stage 4 blocked without required fields
  // ============================================================

  it('Stage 4 blocks when missing required fields (enforcement: block)', async () => {
    harness = E2ESessionHarness.create({
      agentSlug: DEV_LOOP_SLUG,
      agentConfig: DEV_LOOP_CONFIG,
    });

    // Run through to stage 4
    await harness.gate('reset', undefined, { force: true });
    await harness.gate('start', 0);
    await harness.gate('complete', 0, { scope: 'test', feature_description: 'test' });
    await harness.gate('resume', undefined, { decision: 'proceed' });
    await harness.gate('start', 1);
    await harness.gate('complete', 1, { plan_summary: 'test', phases: ['p1'] });
    await harness.gate('start', 2);
    await harness.gate('complete', 2, { findings: [], plan_verdict: 'pass' });
    await harness.gate('start', 3);
    await harness.gate('complete', 3, { refined_plan: 'test', final_phases: ['p1'] });
    await harness.gate('resume', undefined, { decision: 'proceed' });

    // Stage 4 without required fields
    await harness.gate('start', 4);
    const result = await harness.gate('complete', 4, { implementation_notes: 'partial' });

    assert.equal(result.allowed, false, 'Should be blocked without required fields');
    assert.ok(
      (result.reason as string).includes('BLOCKED'),
      `Should contain blockMessage. Got: ${result.reason}`,
    );
  });

  // ============================================================
  // Test 4: Schema enforcement — Stage 5 blocked without needsRepair
  // ============================================================

  it('Stage 5 blocks when missing needsRepair field', async () => {
    harness = E2ESessionHarness.create({
      agentSlug: DEV_LOOP_SLUG,
      agentConfig: DEV_LOOP_CONFIG,
    });

    await harness.gate('reset', undefined, { force: true });
    await harness.gate('start', 0);
    await harness.gate('complete', 0, { scope: 'test', feature_description: 'test' });
    await harness.gate('resume', undefined, { decision: 'proceed' });
    await harness.gate('start', 1);
    await harness.gate('complete', 1, { plan_summary: 'test', phases: ['p1'] });
    await harness.gate('start', 2);
    await harness.gate('complete', 2, { findings: [], plan_verdict: 'pass' });
    await harness.gate('start', 3);
    await harness.gate('complete', 3, { refined_plan: 'test', final_phases: ['p1'] });
    await harness.gate('resume', undefined, { decision: 'proceed' });
    await harness.gate('start', 4);
    await harness.gate('complete', 4, { files_modified: ['a.ts'], typecheck_passed: true });

    // Stage 5 without needsRepair
    await harness.gate('start', 5);
    const result = await harness.gate('complete', 5, { tests_passed: true, total_tests: 10 });

    assert.equal(result.allowed, false, 'Should be blocked without needsRepair');
  });

  // ============================================================
  // Test 5: Stage 6 decision variants
  // ============================================================

  it('Stage 6 accepts decision: done', async () => {
    harness = E2ESessionHarness.create({
      agentSlug: DEV_LOOP_SLUG,
      agentConfig: DEV_LOOP_CONFIG,
    });

    // Run full pipeline to stage 6
    await harness.gate('reset', undefined, { force: true });
    await harness.gate('start', 0);
    await harness.gate('complete', 0, { scope: 'test', feature_description: 'test' });
    await harness.gate('resume', undefined, { decision: 'proceed' });
    await harness.gate('start', 1);
    await harness.gate('complete', 1, { plan_summary: 'test', phases: ['p1'] });
    await harness.gate('start', 2);
    await harness.gate('complete', 2, { findings: [], plan_verdict: 'pass' });
    await harness.gate('start', 3);
    await harness.gate('complete', 3, { refined_plan: 'test', final_phases: ['p1'] });
    await harness.gate('resume', undefined, { decision: 'proceed' });
    await harness.gate('start', 4);
    await harness.gate('complete', 4, { files_modified: ['a.ts'], typecheck_passed: true });
    await harness.gate('start', 5);
    await harness.gate('complete', 5, { tests_passed: true, total_tests: 10, needsRepair: false });

    // Stage 6 with valid decision
    await harness.gate('start', 6);
    const result = await harness.gate('complete', 6, { decision: 'done' });

    assert.equal(result.allowed, true, 'decision: done should be allowed');
  });

  it('Stage 6 blocks invalid decision value', async () => {
    harness = E2ESessionHarness.create({
      agentSlug: DEV_LOOP_SLUG,
      agentConfig: DEV_LOOP_CONFIG,
    });

    await harness.gate('reset', undefined, { force: true });
    await harness.gate('start', 0);
    await harness.gate('complete', 0, { scope: 'test', feature_description: 'test' });
    await harness.gate('resume', undefined, { decision: 'proceed' });
    await harness.gate('start', 1);
    await harness.gate('complete', 1, { plan_summary: 'test', phases: ['p1'] });
    await harness.gate('start', 2);
    await harness.gate('complete', 2, { findings: [], plan_verdict: 'pass' });
    await harness.gate('start', 3);
    await harness.gate('complete', 3, { refined_plan: 'test', final_phases: ['p1'] });
    await harness.gate('resume', undefined, { decision: 'proceed' });
    await harness.gate('start', 4);
    await harness.gate('complete', 4, { files_modified: ['a.ts'], typecheck_passed: true });
    await harness.gate('start', 5);
    await harness.gate('complete', 5, { tests_passed: true, total_tests: 10, needsRepair: false });

    // Stage 6 without decision field
    await harness.gate('start', 6);
    const result = await harness.gate('complete', 6, { next_action: 'celebrate' });

    assert.equal(result.allowed, false, 'Should be blocked without decision');
  });

  // ============================================================
  // Test 6: Repair loop lifecycle
  // ============================================================

  it('repair loop: stages 4-5 can iterate', async () => {
    harness = E2ESessionHarness.create({
      agentSlug: DEV_LOOP_SLUG,
      agentConfig: DEV_LOOP_CONFIG,
    });

    // Run to stage 5 with needsRepair: true
    await harness.gate('reset', undefined, { force: true });
    await harness.gate('start', 0);
    await harness.gate('complete', 0, { scope: 'test', feature_description: 'test' });
    await harness.gate('resume', undefined, { decision: 'proceed' });
    await harness.gate('start', 1);
    await harness.gate('complete', 1, { plan_summary: 'test', phases: ['p1'] });
    await harness.gate('start', 2);
    await harness.gate('complete', 2, { findings: [], plan_verdict: 'pass' });
    await harness.gate('start', 3);
    await harness.gate('complete', 3, { refined_plan: 'test', final_phases: ['p1'] });
    await harness.gate('resume', undefined, { decision: 'proceed' });

    // First iteration of stages 4-5
    await harness.gate('start', 4);
    await harness.gate('complete', 4, { files_modified: ['a.ts'], typecheck_passed: true });
    await harness.gate('start', 5);
    await harness.gate('complete', 5, {
      tests_passed: false,
      total_tests: 10,
      needsRepair: true,
      repair_feedback: 'Fix test for dark mode toggle',
    });

    // Start repair loop
    const repairStart = await harness.gate('start_repair_unit');
    assert.equal(repairStart.allowed, true, 'start_repair_unit should be allowed');

    // Repair iteration: re-run stages 4-5
    await harness.gate('start', 4);
    await harness.gate('complete', 4, { files_modified: ['a.ts', 'b.ts'], typecheck_passed: true });
    await harness.gate('start', 5);
    const repairResult = await harness.gate('complete', 5, {
      tests_passed: true,
      total_tests: 10,
      needsRepair: false,
    });

    assert.equal(repairResult.allowed, true, 'Successful repair should be allowed');

    // End repair loop
    const endRepair = await harness.gate('end_repair_unit');
    assert.equal(endRepair.allowed, true, 'end_repair_unit should be allowed');
  });
});
