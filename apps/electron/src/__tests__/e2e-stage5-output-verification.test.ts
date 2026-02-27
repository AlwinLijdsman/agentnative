/**
 * E2E: Stage 5 Output File Verification
 *
 * Tests the post-schema-validation file existence check added to the
 * stage gate handler. When Stage 5 completes with answer_delivered: true
 * and output_file_path set, the handler now verifies the file actually
 * exists on disk before allowing completion.
 *
 * Run: npx tsx --test apps/electron/src/__tests__/e2e-stage5-output-verification.test.ts
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import {
  E2ESessionHarness,
} from '../../../../packages/agent-pipeline-core/src/handlers/__tests__/e2e-utils.ts';

// Use real ISA agent config from the project
const ISA_AGENT_CONFIG_PATH = join(
  process.cwd(),
  'agents',
  'isa-deep-research',
  'config.json',
);

function loadRealISAConfig(): Record<string, unknown> {
  if (!existsSync(ISA_AGENT_CONFIG_PATH)) {
    return {};
  }
  return JSON.parse(readFileSync(ISA_AGENT_CONFIG_PATH, 'utf-8')) as Record<string, unknown>;
}

// ============================================================
// Minimal stage completion data for stages 0-4
// ============================================================

const STAGE_0_DATA = {
  query_plan: {
    original_query: 'What does ISA 315 require for risk assessment?',
    sub_queries: ['ISA 315 risk assessment requirements'],
    depth_mode: 'quick',
    assumptions: [],
    recommended_action: 'proceed',
  },
};

const STAGE_1_DATA = {
  websearch_calibration: {
    skipped: true,
    skip_reason: 'quick mode',
    web_queries_executed: 0,
    web_sources: [],
    query_plan_refined: false,
  },
};

const STAGE_2_DATA = {
  retrieval_summary: {
    total_paragraphs_found: 5,
    unique_after_dedup: 3,
    standards_covered: ['ISA 315'],
  },
};

const STAGE_3_DATA = {
  synthesis: 'ISA 315 requires the auditor to identify and assess risks of material misstatement.',
  citations_used: ['ISA 315.5', 'ISA 315.12'],
};

const STAGE_4_DATA = {
  verification_scores: { EG: 0.9, CA: 0.85, RP: 0.8, CD: 0 },
  all_passed: true,
  source_texts: {
    'ISA 315.5': 'The auditor shall identify and assess the risks of material misstatement.',
    'ISA 315.12': 'The auditor shall obtain an understanding of the entity and its environment.',
  },
};

const STAGE_5_DATA_VALID = {
  answer_delivered: true,
  output_file_path: './isa-research-output.md',
  total_citations: 2,
  source_texts_used: 2,
  renderer_tool_called: true,
};

// ============================================================
// Helper: Run stages 0 through 4 (with resume past pauses)
// ============================================================

async function runToStage5(harness: E2ESessionHarness): Promise<void> {
  // Reset
  await harness.gate('reset', undefined, { force: true });

  // Stage 0: analyze_query (pauses after)
  await harness.gate('start', 0);
  await harness.gate('complete', 0, STAGE_0_DATA);
  // Resume past stage 0 pause
  await harness.gate('resume', undefined, { decision: 'proceed' });

  // Stage 1: websearch_calibration (pauses after)
  await harness.gate('start', 1);
  await harness.gate('complete', 1, STAGE_1_DATA);
  // Resume past stage 1 pause
  await harness.gate('resume', undefined, { decision: 'proceed' });

  // Stage 2: retrieve
  await harness.gate('start', 2);
  await harness.gate('complete', 2, STAGE_2_DATA);

  // Stage 3: synthesize
  await harness.gate('start', 3);
  await harness.gate('complete', 3, STAGE_3_DATA);

  // Stage 4: verify
  await harness.gate('start', 4);
  await harness.gate('complete', 4, STAGE_4_DATA);
}

// ============================================================
// Tests
// ============================================================

describe('E2E: Stage 5 Output File Verification', () => {
  let harness: E2ESessionHarness;

  afterEach(() => {
    harness?.cleanup();
  });

  // ── T1: Stage 5 blocks when output file is missing ──

  it('Stage 5 blocks completion when output file does not exist on disk', async () => {
    const realConfig = loadRealISAConfig();
    harness = Object.keys(realConfig).length > 0
      ? E2ESessionHarness.create({ agentConfig: realConfig })
      : E2ESessionHarness.create();

    await runToStage5(harness);

    // Start and complete Stage 5 WITHOUT writing the file
    await harness.gate('start', 5);
    const result = await harness.gate('complete', 5, STAGE_5_DATA_VALID);

    // Should be blocked because file doesn't exist
    assert.equal(result.allowed, false,
      'Stage 5 should be blocked when output file does not exist');
    assert.ok(
      typeof result.reason === 'string' && (result.reason as string).includes('not found on disk'),
      `Reason should mention file not found. Got: ${result.reason}`,
    );
  });

  // ── T2: Stage 5 succeeds when output file exists in plans folder ──

  it('Stage 5 succeeds when output file exists in plans folder', async () => {
    const realConfig = loadRealISAConfig();
    harness = Object.keys(realConfig).length > 0
      ? E2ESessionHarness.create({ agentConfig: realConfig })
      : E2ESessionHarness.create();

    await runToStage5(harness);

    // Write the output file to the plans folder (where explore/safe mode writes go)
    const plansFolder = harness.ctx.plansFolderPath;
    mkdirSync(plansFolder, { recursive: true });
    writeFileSync(
      join(plansFolder, 'isa-research-output.md'),
      '# ISA Research: Test\n\nThis is the full research output.',
      'utf-8',
    );

    // Now complete Stage 5 — should succeed
    await harness.gate('start', 5);
    const result = await harness.gate('complete', 5, STAGE_5_DATA_VALID);

    assert.notEqual(result.allowed, false,
      `Stage 5 should succeed when file exists. Reason: ${result.reason}`);
  });

  // ── T3: Stage 5 accepts output_file_path with ./ prefix ──

  it('Stage 5 correctly strips ./ prefix from output_file_path', async () => {
    const realConfig = loadRealISAConfig();
    harness = Object.keys(realConfig).length > 0
      ? E2ESessionHarness.create({ agentConfig: realConfig })
      : E2ESessionHarness.create();

    await runToStage5(harness);

    // Write the file
    const plansFolder = harness.ctx.plansFolderPath;
    mkdirSync(plansFolder, { recursive: true });
    writeFileSync(
      join(plansFolder, 'isa-research-output.md'),
      '# Research output',
      'utf-8',
    );

    // Complete with ./isa-research-output.md (with ./ prefix)
    await harness.gate('start', 5);
    const result = await harness.gate('complete', 5, {
      answer_delivered: true,
      output_file_path: './isa-research-output.md',
      total_citations: 2,
      source_texts_used: 2,
      renderer_tool_called: true,
    });

    assert.notEqual(result.allowed, false,
      `Stage 5 should handle ./ prefix correctly. Reason: ${result.reason}`);
  });

  // ── T4: Stage 5 accepts output_file_path WITHOUT ./ prefix ──

  it('Stage 5 accepts output_file_path without ./ prefix', async () => {
    const realConfig = loadRealISAConfig();
    harness = Object.keys(realConfig).length > 0
      ? E2ESessionHarness.create({ agentConfig: realConfig })
      : E2ESessionHarness.create();

    await runToStage5(harness);

    const plansFolder = harness.ctx.plansFolderPath;
    mkdirSync(plansFolder, { recursive: true });
    writeFileSync(
      join(plansFolder, 'isa-research-output.md'),
      '# Research output',
      'utf-8',
    );

    await harness.gate('start', 5);
    const result = await harness.gate('complete', 5, {
      answer_delivered: true,
      output_file_path: 'isa-research-output.md',
      total_citations: 2,
      source_texts_used: 2,
      renderer_tool_called: true,
    });

    assert.notEqual(result.allowed, false,
      `Stage 5 should work without ./ prefix. Reason: ${result.reason}`);
  });

  // ── T5: Event log contains file_missing event on failure ──

  it('event log contains stage_output_file_missing event when file is absent', async () => {
    const realConfig = loadRealISAConfig();
    harness = Object.keys(realConfig).length > 0
      ? E2ESessionHarness.create({ agentConfig: realConfig })
      : E2ESessionHarness.create();

    await runToStage5(harness);

    await harness.gate('start', 5);
    await harness.gate('complete', 5, STAGE_5_DATA_VALID);

    // Check event log
    const events = harness.readEvents();
    const fileMissingEvents = events.filter(e => e.type === 'stage_output_file_missing');
    assert.ok(fileMissingEvents.length >= 1,
      `Expected stage_output_file_missing event. Events: ${events.map(e => e.type).join(', ')}`);
    assert.equal(fileMissingEvents[0]!.data.stage, 5);
  });

  // ── T6: Event log contains file_verified event on success ──

  it('event log contains stage_output_file_verified event when file exists', async () => {
    const realConfig = loadRealISAConfig();
    harness = Object.keys(realConfig).length > 0
      ? E2ESessionHarness.create({ agentConfig: realConfig })
      : E2ESessionHarness.create();

    await runToStage5(harness);

    // Write file
    const plansFolder = harness.ctx.plansFolderPath;
    mkdirSync(plansFolder, { recursive: true });
    writeFileSync(
      join(plansFolder, 'isa-research-output.md'),
      '# Research',
      'utf-8',
    );

    await harness.gate('start', 5);
    await harness.gate('complete', 5, STAGE_5_DATA_VALID);

    // Check event log
    const events = harness.readEvents();
    const fileVerifiedEvents = events.filter(e => e.type === 'stage_output_file_verified');
    assert.ok(fileVerifiedEvents.length >= 1,
      `Expected stage_output_file_verified event. Events: ${events.map(e => e.type).join(', ')}`);
    assert.equal(fileVerifiedEvents[0]!.data.stage, 5);
  });

  // ── T6b: Verified event includes output_file_content ──

  it('stage_output_file_verified event includes output_file_content for chat injection', async () => {
    const realConfig = loadRealISAConfig();
    harness = Object.keys(realConfig).length > 0
      ? E2ESessionHarness.create({ agentConfig: realConfig })
      : E2ESessionHarness.create();

    await runToStage5(harness);

    // Write file with known content
    const plansFolder = harness.ctx.plansFolderPath;
    mkdirSync(plansFolder, { recursive: true });
    const expectedContent = '# ISA Research: Risk Assessment\n\nFull research output with citations.';
    writeFileSync(
      join(plansFolder, 'isa-research-output.md'),
      expectedContent,
      'utf-8',
    );

    await harness.gate('start', 5);
    await harness.gate('complete', 5, STAGE_5_DATA_VALID);

    // Check that the verified event includes the file content
    const events = harness.readEvents();
    const fileVerifiedEvents = events.filter(e => e.type === 'stage_output_file_verified');
    assert.ok(fileVerifiedEvents.length >= 1,
      `Expected stage_output_file_verified event`);
    assert.equal(fileVerifiedEvents[0]!.data.output_file_content, expectedContent,
      'Verified event should include the file content for auto-injection into chat');
  });

  // ── T7: Stage 5 without output_file_path still works (schema catches it) ──

  it('Stage 5 without output_file_path is caught by schema validation, not file check', async () => {
    const realConfig = loadRealISAConfig();
    harness = Object.keys(realConfig).length > 0
      ? E2ESessionHarness.create({ agentConfig: realConfig })
      : E2ESessionHarness.create();

    await runToStage5(harness);

    await harness.gate('start', 5);
    // Complete without output_file_path — schema validation should catch this first
    const result = await harness.gate('complete', 5, {
      answer_delivered: true,
      total_citations: 2,
      // no output_file_path
    });

    // Should be blocked by schema validation (enforcement: "block")
    assert.equal(result.allowed, false,
      'Stage 5 should be blocked when output_file_path is missing');
  });

  // ── T8: Re-completing Stage 5 after writing file succeeds ──

  it('Stage 5 can be re-completed after initially failing due to missing file', async () => {
    const realConfig = loadRealISAConfig();
    harness = Object.keys(realConfig).length > 0
      ? E2ESessionHarness.create({ agentConfig: realConfig })
      : E2ESessionHarness.create();

    await runToStage5(harness);

    // First attempt: fail (no file)
    await harness.gate('start', 5);
    const fail = await harness.gate('complete', 5, STAGE_5_DATA_VALID);
    assert.equal(fail.allowed, false, 'First attempt should fail');

    // Write the file
    const plansFolder = harness.ctx.plansFolderPath;
    mkdirSync(plansFolder, { recursive: true });
    writeFileSync(
      join(plansFolder, 'isa-research-output.md'),
      '# ISA Research\n\nFull output here.',
      'utf-8',
    );

    // Second attempt: succeed (file now exists)
    // Note: stage was removed from completedStages on failure, so we need to re-start
    await harness.gate('start', 5);
    const success = await harness.gate('complete', 5, STAGE_5_DATA_VALID);
    assert.notEqual(success.allowed, false,
      `Re-completion should succeed after writing file. Reason: ${success.reason}`);
  });

  // ── T9: Stage 5 succeeds when output_file_path is an ABSOLUTE path ──
  // This is the actual production behavior: in safe mode, the agent resolves
  // the path to the plans folder and provides the full absolute path.

  it('Stage 5 succeeds when output_file_path is an absolute path to plans folder', async () => {
    const realConfig = loadRealISAConfig();
    harness = Object.keys(realConfig).length > 0
      ? E2ESessionHarness.create({ agentConfig: realConfig })
      : E2ESessionHarness.create();

    await runToStage5(harness);

    // Write the file to plans folder
    const plansFolder = harness.ctx.plansFolderPath;
    mkdirSync(plansFolder, { recursive: true });
    const expectedContent = '# ISA Research: Absolute Path Test\n\nFull research output.';
    writeFileSync(
      join(plansFolder, 'isa-research-output.md'),
      expectedContent,
      'utf-8',
    );

    // Complete with the ABSOLUTE path (matches real ISA agent behavior in safe mode)
    const absolutePath = join(plansFolder, 'isa-research-output.md');
    await harness.gate('start', 5);
    const result = await harness.gate('complete', 5, {
      answer_delivered: true,
      output_file_path: absolutePath,
      total_citations: 2,
      source_texts_used: 2,
      renderer_tool_called: true,
    });

    assert.notEqual(result.allowed, false,
      `Stage 5 should succeed with absolute path. Reason: ${result.reason}`);

    // Verify the event includes file content
    const events = harness.readEvents();
    const fileVerifiedEvents = events.filter(e => e.type === 'stage_output_file_verified');
    assert.ok(fileVerifiedEvents.length >= 1,
      `Expected stage_output_file_verified event with absolute path`);
    assert.equal(fileVerifiedEvents[0]!.data.output_file_content, expectedContent,
      'Verified event should include file content even with absolute path');
  });

  // ── T10: Stage 5 verified event content flows through to stage_completed ──

  it('output_file_content flows from verified event to stage_completed args.data', async () => {
    const realConfig = loadRealISAConfig();
    harness = Object.keys(realConfig).length > 0
      ? E2ESessionHarness.create({ agentConfig: realConfig })
      : E2ESessionHarness.create();

    await runToStage5(harness);

    // Write file
    const plansFolder = harness.ctx.plansFolderPath;
    mkdirSync(plansFolder, { recursive: true });
    const expectedContent = '# Full Research\n\nComplete output for injection.';
    writeFileSync(
      join(plansFolder, 'isa-research-output.md'),
      expectedContent,
      'utf-8',
    );

    await harness.gate('start', 5);
    await harness.gate('complete', 5, STAGE_5_DATA_VALID);

    // Check that stage_completed event includes output_file_content in its data
    const events = harness.readEvents();
    const stageCompletedEvents = events.filter(
      e => e.type === 'stage_completed' && e.data.stage === 5
    );
    assert.ok(stageCompletedEvents.length >= 1,
      `Expected stage_completed event for stage 5`);
    assert.equal(stageCompletedEvents[0]!.data.output_file_content, expectedContent,
      'stage_completed event should include output_file_content for auto-injection');
  });
});
