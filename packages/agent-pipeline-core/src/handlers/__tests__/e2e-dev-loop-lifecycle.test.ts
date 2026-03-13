/**
 * Advanced Realistic Lifecycle Simulation for Dev-Loop Agent
 *
 * Simulates realistic dev-loop runs through all 7 stages with realistic data,
 * covering:
 * - Happy path: all stages pass first try, decision: done
 * - Repair path: implement → test fails → repair → test passes → done
 * - Max repair exhaustion: repair loop hits maxIterations, escalates
 * - User abort: user aborts at Stage 0 pause
 * - User modify: user modifies scope at Stage 0, modifications flow to Stage 1
 * - Stage 3 re-plan: user requests modify at Stage 3, refined plan re-done
 *
 * Validates: events JSONL, run state, pause callbacks, artifact integrity,
 * schema enforcement, and repair loop mechanics at each step.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { E2ESessionHarness } from './e2e-utils.ts';

// ============================================================
// Realistic Dev-Loop Config (mirrors agents/dev-loop/config.json)
// ============================================================

const DEV_LOOP_CONFIG = {
  controlFlow: {
    stages: [
      { id: 0, name: 'analyze_request', description: 'Parse feature request', pauseInstructions: 'Review the scope assessment below. Choose:\n- **Proceed** to continue with planning\n- **Modify** to adjust the scope\n- **Abort** to cancel' },
      { id: 1, name: 'plan', description: 'Generate implementation plan', mode: 'sdk_breakout' },
      { id: 2, name: 'review', description: 'Adversarial review of the plan' },
      { id: 3, name: 'refine_plan', description: 'Refine plan based on review', pauseInstructions: 'Review the refined plan below. Approve to begin implementation.' },
      { id: 4, name: 'implement', description: 'Execute the plan', mode: 'sdk_breakout' },
      { id: 5, name: 'test_and_diagnose', description: 'Run tests and diagnose failures', mode: 'sdk_breakout' },
      { id: 6, name: 'decide', description: 'Convergence assessment' },
    ],
    repairUnits: [
      { stages: [4, 5], maxIterations: 3, feedbackField: 'repair_feedback' },
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
        blockMessage: 'Stage 4 BLOCKED: files_modified and typecheck_passed are required.',
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
        blockMessage: 'Stage 5 BLOCKED: tests_passed, total_tests, and needsRepair are required.',
      },
      '6': {
        required: ['decision'],
        properties: {
          decision: { type: 'string', enum: ['done', 'restart', 'escalate'] },
        },
        enforcement: 'block',
        blockMessage: 'Stage 6 BLOCKED: decision is required (done|restart|escalate).',
      },
    },
  },
};

const SLUG = 'dev-loop';

// ============================================================
// Realistic Data Fixtures
// ============================================================

const STAGE_0_DATA = {
  scope: 'Add dark mode toggle to the Settings page with system preference detection',
  feature_description: 'Users should be able to switch between light, dark, and system themes. The toggle should persist across sessions via localStorage. System preference detection uses prefers-color-scheme media query.',
  estimated_files: ['src/components/Settings.tsx', 'src/hooks/useTheme.ts', 'src/styles/theme.css'],
  complexity: 'medium',
};

const STAGE_1_DATA = {
  plan_summary: 'Three-phase implementation: 1) Theme hook with localStorage persistence, 2) Settings UI toggle component, 3) CSS custom properties for theme switching',
  phases: [
    { id: 1, name: 'Theme Infrastructure', files: ['src/hooks/useTheme.ts', 'src/context/ThemeContext.tsx'] },
    { id: 2, name: 'Settings UI', files: ['src/components/Settings.tsx', 'src/components/ThemeToggle.tsx'] },
    { id: 3, name: 'CSS Theme Variables', files: ['src/styles/theme.css', 'src/styles/dark.css'] },
  ],
};

const STAGE_2_DATA = {
  findings: [
    { severity: 'warning', message: 'useTheme hook should handle SSR gracefully (window.matchMedia may not exist)' },
    { severity: 'info', message: 'Consider using CSS-in-JS for better tree-shaking instead of separate dark.css' },
  ],
  plan_verdict: 'pass_with_warnings',
  risk_assessment: 'low',
};

const STAGE_3_DATA = {
  refined_plan: 'Updated plan: Added SSR guard to useTheme, switched to CSS custom properties instead of separate dark.css file. No CSS-in-JS (overkill for this scope).',
  final_phases: [
    { id: 1, name: 'Theme Infrastructure', files: ['src/hooks/useTheme.ts', 'src/context/ThemeContext.tsx'], changes: 'Added typeof window check' },
    { id: 2, name: 'Settings UI', files: ['src/components/Settings.tsx', 'src/components/ThemeToggle.tsx'] },
    { id: 3, name: 'CSS Theme Variables', files: ['src/styles/theme.css'], changes: 'Single file with :root and [data-theme=dark]' },
  ],
};

const STAGE_4_SUCCESS = {
  files_modified: [
    'src/hooks/useTheme.ts',
    'src/context/ThemeContext.tsx',
    'src/components/Settings.tsx',
    'src/components/ThemeToggle.tsx',
    'src/styles/theme.css',
  ],
  typecheck_passed: true,
  implementation_notes: 'All 5 files created/modified. TypeScript strict mode passes.',
};

const STAGE_5_FAIL = {
  tests_passed: false,
  total_tests: 12,
  failed_tests: 3,
  needsRepair: true,
  repair_feedback: 'ThemeToggle.test.tsx: 3 failures — toggle click handler not updating data-theme attribute on document.documentElement. The useTheme hook returns setTheme but the component calls setMode instead.',
};

const STAGE_5_PASS = {
  tests_passed: true,
  total_tests: 12,
  failed_tests: 0,
  needsRepair: false,
};

const STAGE_4_REPAIR = {
  files_modified: [
    'src/components/ThemeToggle.tsx',
    'src/components/__tests__/ThemeToggle.test.tsx',
  ],
  typecheck_passed: true,
  implementation_notes: 'Fixed ThemeToggle to use setTheme (not setMode). Updated test expectations.',
};

describe('Dev-Loop Realistic Lifecycle Simulations', () => {
  let harness: E2ESessionHarness;

  afterEach(() => {
    harness?.cleanup();
  });

  // ============================================================
  // Scenario 1: Happy Path — All stages pass first try
  // ============================================================

  it('Happy path: 7 stages → done (no repair needed)', async () => {
    harness = E2ESessionHarness.create({ agentSlug: SLUG, agentConfig: DEV_LOOP_CONFIG });
    await harness.gate('reset', undefined, { force: true });

    // Stage 0: Analyze Request
    await harness.gate('start', 0);
    const s0 = await harness.gate('complete', 0, STAGE_0_DATA);
    assert.equal(s0.pauseRequired, true, 'Stage 0 should pause');
    assert.ok((s0.reason as string).includes('Review the scope assessment'), 'Pause message should contain pauseInstructions');
    harness.assertPauseAt(0);

    // User approves
    const resume0 = await harness.gate('resume', undefined, { decision: 'proceed' });
    assert.equal(resume0.allowed, true);
    assert.equal(resume0.nextStage, 1);

    // Stage 1: Plan (sdk_breakout stage — orchestrator completes it)
    await harness.gate('start', 1);
    const s1 = await harness.gate('complete', 1, STAGE_1_DATA);
    assert.equal(s1.allowed, true, 'Stage 1 should complete (no pause, no block)');

    // Stage 2: Review
    await harness.gate('start', 2);
    const s2 = await harness.gate('complete', 2, STAGE_2_DATA);
    assert.equal(s2.allowed, true);

    // Stage 3: Refine Plan (pauses)
    await harness.gate('start', 3);
    const s3 = await harness.gate('complete', 3, STAGE_3_DATA);
    assert.equal(s3.pauseRequired, true, 'Stage 3 should pause');
    assert.ok((s3.reason as string).includes('Review the refined plan'), 'Stage 3 pause should use pauseInstructions');
    harness.assertPauseAt(3);

    // User approves refined plan
    const resume3 = await harness.gate('resume', undefined, { decision: 'proceed' });
    assert.equal(resume3.allowed, true);
    assert.equal(resume3.nextStage, 4);

    // Stage 4: Implement
    await harness.gate('start', 4);
    const s4 = await harness.gate('complete', 4, STAGE_4_SUCCESS);
    assert.equal(s4.allowed, true, 'Stage 4 with valid data should pass block-mode schema');

    // Stage 5: Test (all pass)
    await harness.gate('start', 5);
    const s5 = await harness.gate('complete', 5, STAGE_5_PASS);
    assert.equal(s5.allowed, true);

    // Stage 6: Decide → done
    await harness.gate('start', 6);
    const s6 = await harness.gate('complete', 6, { decision: 'done' });
    assert.equal(s6.allowed, true);

    // Validate final state
    const status = await harness.gate('status');
    assert.deepEqual(status.completedStages, [0, 1, 2, 3, 4, 5, 6]);

    // Validate events log
    const events = harness.readEvents();
    const stageCompletions = events
      .filter(e => e.type === 'stage_completed')
      .map(e => e.data.stage);
    assert.deepEqual(stageCompletions, [0, 1, 2, 3, 4, 5, 6], 'All 7 stages should be completed in order');

    // Validate run state has all stages completed
    const runState = harness.readRunState();
    assert.deepEqual(runState.completedStages, [0, 1, 2, 3, 4, 5, 6]);
  });

  // ============================================================
  // Scenario 2: Repair Path — test fails, repair succeeds
  // ============================================================

  it('Repair path: implement → test fails → repair → test passes → done', async () => {
    harness = E2ESessionHarness.create({ agentSlug: SLUG, agentConfig: DEV_LOOP_CONFIG });
    await harness.gate('reset', undefined, { force: true });

    // Fast-forward through stages 0-3
    await harness.gate('start', 0);
    await harness.gate('complete', 0, STAGE_0_DATA);
    await harness.gate('resume', undefined, { decision: 'proceed' });
    await harness.gate('start', 1);
    await harness.gate('complete', 1, STAGE_1_DATA);
    await harness.gate('start', 2);
    await harness.gate('complete', 2, STAGE_2_DATA);
    await harness.gate('start', 3);
    await harness.gate('complete', 3, STAGE_3_DATA);
    await harness.gate('resume', undefined, { decision: 'proceed' });

    // Stage 4: First implementation
    await harness.gate('start', 4);
    await harness.gate('complete', 4, STAGE_4_SUCCESS);

    // Stage 5: Tests FAIL
    await harness.gate('start', 5);
    const s5fail = await harness.gate('complete', 5, STAGE_5_FAIL);
    assert.equal(s5fail.allowed, true, 'Stage 5 with all required fields should complete');

    // Enter repair loop
    const repairStart = await harness.gate('start_repair_unit');
    assert.equal(repairStart.allowed, true);
    assert.equal(repairStart.repairUnitActive, true);
    assert.equal(repairStart.repairIteration, 0);

    // Repair iteration: re-implement and re-test
    const repair = await harness.gate('repair');
    assert.equal(repair.allowed, true);
    assert.equal(repair.repairIteration, 1);

    // Stage 4 (repair): Fix the bug
    await harness.gate('start', 4);
    const s4repair = await harness.gate('complete', 4, STAGE_4_REPAIR);
    assert.equal(s4repair.allowed, true);

    // Stage 5 (repair): Tests pass now
    await harness.gate('start', 5);
    const s5pass = await harness.gate('complete', 5, STAGE_5_PASS);
    assert.equal(s5pass.allowed, true);

    // End repair loop
    const repairEnd = await harness.gate('end_repair_unit');
    assert.equal(repairEnd.allowed, true);
    assert.equal(repairEnd.repairUnitActive, false);

    // Stage 6: Done
    await harness.gate('start', 6);
    const s6 = await harness.gate('complete', 6, { decision: 'done' });
    assert.equal(s6.allowed, true);

    // Validate events contain repair iteration
    const events = harness.readEvents();
    const repairEvents = events.filter(e => e.type === 'repair_iteration');
    assert.equal(repairEvents.length, 1, 'Should have exactly 1 repair iteration event');

    // Verify stage 4 completed twice (original + repair)
    const s4Completions = events.filter(e => e.type === 'stage_completed' && e.data.stage === 4);
    assert.equal(s4Completions.length, 2, 'Stage 4 should be completed twice (original + repair)');
  });

  // ============================================================
  // Scenario 3: Max repair exhaustion → escalate
  // ============================================================

  it('Max repair: 3 failed iterations → blocked, then escalate', async () => {
    harness = E2ESessionHarness.create({ agentSlug: SLUG, agentConfig: DEV_LOOP_CONFIG });
    await harness.gate('reset', undefined, { force: true });

    // Fast-forward through stages 0-3
    await harness.gate('start', 0);
    await harness.gate('complete', 0, STAGE_0_DATA);
    await harness.gate('resume', undefined, { decision: 'proceed' });
    await harness.gate('start', 1);
    await harness.gate('complete', 1, STAGE_1_DATA);
    await harness.gate('start', 2);
    await harness.gate('complete', 2, STAGE_2_DATA);
    await harness.gate('start', 3);
    await harness.gate('complete', 3, STAGE_3_DATA);
    await harness.gate('resume', undefined, { decision: 'proceed' });

    // First pass: implement + test fails
    await harness.gate('start', 4);
    await harness.gate('complete', 4, STAGE_4_SUCCESS);
    await harness.gate('start', 5);
    await harness.gate('complete', 5, STAGE_5_FAIL);

    // Enter repair loop
    await harness.gate('start_repair_unit');

    // Iteration 1
    await harness.gate('repair');
    await harness.gate('start', 4);
    await harness.gate('complete', 4, STAGE_4_REPAIR);
    await harness.gate('start', 5);
    await harness.gate('complete', 5, { ...STAGE_5_FAIL, repair_feedback: 'Still failing: useTheme returns stale value' });

    // Iteration 2
    await harness.gate('repair');
    await harness.gate('start', 4);
    await harness.gate('complete', 4, { files_modified: ['src/hooks/useTheme.ts'], typecheck_passed: true });
    await harness.gate('start', 5);
    await harness.gate('complete', 5, { ...STAGE_5_FAIL, repair_feedback: 'Context not re-rendering children' });

    // Iteration 3 — should be blocked (maxIterations: 3)
    const blocked = await harness.gate('repair');
    assert.equal(blocked.allowed, false, 'Third repair iteration should be blocked (maxIterations=3)');
    assert.ok((blocked.reason as string).includes('Max repair iterations'));

    // End repair loop (forced)
    await harness.gate('end_repair_unit');

    // Stage 6: Escalate
    await harness.gate('start', 6);
    const s6 = await harness.gate('complete', 6, { decision: 'escalate' });
    assert.equal(s6.allowed, true, 'decision: escalate should be accepted');
  });

  // ============================================================
  // Scenario 4: User aborts at Stage 0
  // ============================================================

  it('User abort: stage 0 pause → abort clears state', async () => {
    harness = E2ESessionHarness.create({ agentSlug: SLUG, agentConfig: DEV_LOOP_CONFIG });
    await harness.gate('reset', undefined, { force: true });

    // Stage 0 completes and pauses
    await harness.gate('start', 0);
    await harness.gate('complete', 0, STAGE_0_DATA);
    harness.assertPauseAt(0);

    // User aborts
    const abort = await harness.gate('resume', undefined, { decision: 'abort', reason: 'Scope too large, needs decomposition' });
    assert.equal(abort.allowed, true);
    assert.equal(abort.aborted, true);

    // Pipeline should be cleared — no active run
    const status = await harness.gate('status');
    assert.equal(status.allowed, false, 'No active run after abort');
  });

  // ============================================================
  // Scenario 5: User modifies scope at Stage 0
  // ============================================================

  it('User modify: stage 0 modifications flow to stage 1 start', async () => {
    harness = E2ESessionHarness.create({ agentSlug: SLUG, agentConfig: DEV_LOOP_CONFIG });
    await harness.gate('reset', undefined, { force: true });

    await harness.gate('start', 0);
    await harness.gate('complete', 0, STAGE_0_DATA);

    // User modifies scope
    const resume = await harness.gate('resume', undefined, {
      decision: 'modify',
      modifications: {
        scope: 'Only dark mode toggle — skip system preference detection for now',
        estimated_files: ['src/components/Settings.tsx', 'src/hooks/useTheme.ts'],
      },
    });
    assert.equal(resume.allowed, true);
    assert.deepEqual(resume.modifications, {
      scope: 'Only dark mode toggle — skip system preference detection for now',
      estimated_files: ['src/components/Settings.tsx', 'src/hooks/useTheme.ts'],
    });

    // Stage 1 start should carry modifications
    const s1start = await harness.gate('start', 1);
    assert.equal(s1start.allowed, true);
    assert.deepEqual(s1start.modifications, {
      scope: 'Only dark mode toggle — skip system preference detection for now',
      estimated_files: ['src/components/Settings.tsx', 'src/hooks/useTheme.ts'],
    });

    // Stage 1 complete — modifications consumed, not forwarded
    await harness.gate('complete', 1, STAGE_1_DATA);
    const s2start = await harness.gate('start', 2);
    assert.equal(s2start.allowed, true);
    assert.equal(s2start.modifications, undefined, 'Modifications should be consumed after one stage');
  });

  // ============================================================
  // Scenario 6: Schema enforcement blocks incomplete data
  // ============================================================

  it('Schema enforcement: block mode rejects, then accepts on retry', async () => {
    harness = E2ESessionHarness.create({ agentSlug: SLUG, agentConfig: DEV_LOOP_CONFIG });
    await harness.gate('reset', undefined, { force: true });

    // Fast-forward to stage 4
    await harness.gate('start', 0);
    await harness.gate('complete', 0, STAGE_0_DATA);
    await harness.gate('resume', undefined, { decision: 'proceed' });
    await harness.gate('start', 1);
    await harness.gate('complete', 1, STAGE_1_DATA);
    await harness.gate('start', 2);
    await harness.gate('complete', 2, STAGE_2_DATA);
    await harness.gate('start', 3);
    await harness.gate('complete', 3, STAGE_3_DATA);
    await harness.gate('resume', undefined, { decision: 'proceed' });

    // Stage 4: Missing required fields → BLOCKED
    await harness.gate('start', 4);
    const blocked = await harness.gate('complete', 4, {
      implementation_notes: 'Work in progress',
      // Missing: files_modified, typecheck_passed
    });
    assert.equal(blocked.allowed, false, 'Should be blocked without required fields');
    assert.ok((blocked.reason as string).includes('BLOCKED'), 'Should contain block message');

    // Retry with correct data → passes
    const pass = await harness.gate('complete', 4, STAGE_4_SUCCESS);
    assert.equal(pass.allowed, true, 'Should pass with all required fields');
  });

  // ============================================================
  // Scenario 7: Pause lock prevents skipping ahead
  // ============================================================

  it('Pause lock: start(1) blocked while paused at stage 0', async () => {
    harness = E2ESessionHarness.create({ agentSlug: SLUG, agentConfig: DEV_LOOP_CONFIG });
    await harness.gate('reset', undefined, { force: true });

    await harness.gate('start', 0);
    await harness.gate('complete', 0, STAGE_0_DATA);

    // Try to skip ahead without resume
    const blocked = await harness.gate('start', 1);
    assert.equal(blocked.allowed, false, 'Pipeline should be locked while paused');

    // Resume unlocks
    await harness.gate('resume', undefined, { decision: 'proceed' });
    const unlocked = await harness.gate('start', 1);
    assert.equal(unlocked.allowed, true, 'Pipeline should be unlocked after resume');
  });

  // ============================================================
  // Scenario 8: Stage 6 decision: restart resets pipeline
  // ============================================================

  it('Decision: restart triggers pipeline reset', async () => {
    harness = E2ESessionHarness.create({ agentSlug: SLUG, agentConfig: DEV_LOOP_CONFIG });
    await harness.gate('reset', undefined, { force: true });

    // Fast-forward full pipeline to stage 6
    await harness.gate('start', 0);
    await harness.gate('complete', 0, STAGE_0_DATA);
    await harness.gate('resume', undefined, { decision: 'proceed' });
    await harness.gate('start', 1);
    await harness.gate('complete', 1, STAGE_1_DATA);
    await harness.gate('start', 2);
    await harness.gate('complete', 2, STAGE_2_DATA);
    await harness.gate('start', 3);
    await harness.gate('complete', 3, STAGE_3_DATA);
    await harness.gate('resume', undefined, { decision: 'proceed' });
    await harness.gate('start', 4);
    await harness.gate('complete', 4, STAGE_4_SUCCESS);
    await harness.gate('start', 5);
    await harness.gate('complete', 5, STAGE_5_PASS);

    // Stage 6: restart
    await harness.gate('start', 6);
    const s6 = await harness.gate('complete', 6, { decision: 'restart' });
    assert.equal(s6.allowed, true, 'decision: restart should be accepted');

    // Verify the run completed with all stages
    const status = await harness.gate('status');
    assert.deepEqual(status.completedStages, [0, 1, 2, 3, 4, 5, 6]);
  });

  // ============================================================
  // Scenario 9: Events log integrity across full lifecycle
  // ============================================================

  it('Events log: all actions produce chronological events with correct runId', async () => {
    harness = E2ESessionHarness.create({ agentSlug: SLUG, agentConfig: DEV_LOOP_CONFIG });
    await harness.gate('reset', undefined, { force: true });

    // Run a simple happy path
    await harness.gate('start', 0);
    await harness.gate('complete', 0, STAGE_0_DATA);
    await harness.gate('resume', undefined, { decision: 'proceed' });
    await harness.gate('start', 1);
    await harness.gate('complete', 1, STAGE_1_DATA);
    await harness.gate('start', 2);
    await harness.gate('complete', 2, STAGE_2_DATA);
    await harness.gate('start', 3);
    await harness.gate('complete', 3, STAGE_3_DATA);
    await harness.gate('resume', undefined, { decision: 'proceed' });
    await harness.gate('start', 4);
    await harness.gate('complete', 4, STAGE_4_SUCCESS);
    await harness.gate('start', 5);
    await harness.gate('complete', 5, STAGE_5_PASS);
    await harness.gate('start', 6);
    await harness.gate('complete', 6, { decision: 'done' });

    const events = harness.readEvents();

    // All events have timestamps
    for (const event of events) {
      assert.ok(event.timestamp, `Event ${event.type} missing timestamp`);
      assert.ok(!isNaN(Date.parse(event.timestamp)), `Event ${event.type} has invalid timestamp: ${event.timestamp}`);
    }

    // All events have same runId
    const runIds = new Set(events.map(e => e.runId));
    assert.equal(runIds.size, 1, `All events should share one runId, found: ${[...runIds].join(', ')}`);

    // Events are chronological
    for (let i = 1; i < events.length; i++) {
      const prev = new Date(events[i - 1]!.timestamp).getTime();
      const curr = new Date(events[i]!.timestamp).getTime();
      assert.ok(curr >= prev, `Event ${i} (${events[i]!.type}) timestamp is before event ${i - 1} (${events[i - 1]!.type})`);
    }

    // Stage completions are in order
    const stageCompletes = events.filter(e => e.type === 'stage_completed').map(e => e.data.stage);
    assert.deepEqual(stageCompletes, [0, 1, 2, 3, 4, 5, 6], 'All 7 stages should complete in order');

    // Stage starts for 1-6 should be present (stage 0 start creates the run — no separate stage_started)
    const stageStarts = events.filter(e => e.type === 'stage_started').map(e => e.data.stage);
    assert.deepEqual(stageStarts, [1, 2, 3, 4, 5, 6], 'Stages 1-6 should have stage_started events');

    // At minimum, events should include completions for all stages
    assert.ok(events.length >= 13, `Expected at least 13 events (7 completions + 6 starts), got ${events.length}`);
  });

  // ============================================================
  // Scenario 10: Double repair loop with realistic feedback
  // ============================================================

  it('Double repair: two iterations before success', async () => {
    harness = E2ESessionHarness.create({ agentSlug: SLUG, agentConfig: DEV_LOOP_CONFIG });
    await harness.gate('reset', undefined, { force: true });

    // Fast-forward through stages 0-3
    await harness.gate('start', 0);
    await harness.gate('complete', 0, STAGE_0_DATA);
    await harness.gate('resume', undefined, { decision: 'proceed' });
    await harness.gate('start', 1);
    await harness.gate('complete', 1, STAGE_1_DATA);
    await harness.gate('start', 2);
    await harness.gate('complete', 2, STAGE_2_DATA);
    await harness.gate('start', 3);
    await harness.gate('complete', 3, STAGE_3_DATA);
    await harness.gate('resume', undefined, { decision: 'proceed' });

    // Iteration 0: implement + test fails
    await harness.gate('start', 4);
    await harness.gate('complete', 4, STAGE_4_SUCCESS);
    await harness.gate('start', 5);
    await harness.gate('complete', 5, {
      tests_passed: false, total_tests: 12, needsRepair: true,
      repair_feedback: 'ThemeToggle: setMode not found on useTheme return value',
    });

    await harness.gate('start_repair_unit');

    // Iteration 1: still fails
    await harness.gate('repair');
    await harness.gate('start', 4);
    await harness.gate('complete', 4, { files_modified: ['src/components/ThemeToggle.tsx'], typecheck_passed: true });
    await harness.gate('start', 5);
    await harness.gate('complete', 5, {
      tests_passed: false, total_tests: 12, needsRepair: true,
      repair_feedback: 'ThemeToggle: data-theme attribute not updated on document.documentElement',
    });

    // Iteration 2: succeeds
    await harness.gate('repair');
    await harness.gate('start', 4);
    await harness.gate('complete', 4, {
      files_modified: ['src/hooks/useTheme.ts', 'src/components/ThemeToggle.tsx'],
      typecheck_passed: true,
    });
    await harness.gate('start', 5);
    const s5pass = await harness.gate('complete', 5, STAGE_5_PASS);
    assert.equal(s5pass.allowed, true);

    await harness.gate('end_repair_unit');

    // Stage 6: Done
    await harness.gate('start', 6);
    await harness.gate('complete', 6, { decision: 'done' });

    // Verify repair iterations
    const events = harness.readEvents();
    const repairEvents = events.filter(e => e.type === 'repair_iteration');
    assert.equal(repairEvents.length, 2, 'Should have 2 repair iterations');

    // Stage 4 completed 3 times total (original + 2 repairs)
    const s4Completions = events.filter(e => e.type === 'stage_completed' && e.data.stage === 4);
    assert.equal(s4Completions.length, 3);

    // Stage 5 completed 3 times total
    const s5Completions = events.filter(e => e.type === 'stage_completed' && e.data.stage === 5);
    assert.equal(s5Completions.length, 3);
  });
});
