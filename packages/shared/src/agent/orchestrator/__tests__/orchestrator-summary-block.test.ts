/**
 * Tests for PromptBuilder.buildOrchestratorSummaryBlock() — Context Injection.
 *
 * Verifies:
 * - Summary file is read and formatted as XML block
 * - Missing file returns null (no-op)
 * - Malformed file returns null (no-op)
 * - XML special characters are escaped
 * - Partial pipeline summaries are rendered correctly
 * - Full mode: pipeline-state.json is used when available and under budget
 * - Compact mode: pipeline-summary.json fallback with wasCompacted flag
 * - Return type is OrchestratorContextResult { block, wasCompacted }
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PromptBuilder } from '../../core/prompt-builder.ts';
import type { PipelineSummary } from '../types.ts';
import { PipelineState } from '../pipeline-state.ts';

const TEST_DIR = join(tmpdir(), `craft-agent-test-summary-${Date.now()}`);

function createPromptBuilder(): PromptBuilder {
  return new PromptBuilder({
    workspace: { rootPath: TEST_DIR, id: 'test', name: 'test', createdAt: Date.now() },
  });
}

function writeSummary(sessionPath: string, summary: PipelineSummary): void {
  const dataDir = join(sessionPath, 'data');
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, 'pipeline-summary.json'), JSON.stringify(summary), 'utf-8');
}

function createSummary(overrides: Partial<PipelineSummary> = {}): PipelineSummary {
  return {
    originalQuery: 'What are the ASME BPVC requirements?',
    synthesis: 'Pressure vessels must comply with Section VIII Division 1.',
    citationCount: 5,
    confidence: 'high',
    verificationScores: {
      entity_grounding: { score: 0.95, passed: true },
      citation_accuracy: { score: 0.90, passed: true },
    },
    neededRepair: false,
    completedStages: [0, 1, 2, 3, 4, 5],
    totalStages: 6,
    wasPartial: false,
    exitReason: 'completed',
    outputPath: '/sessions/test/plans/answer.md',
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Create a minimal PipelineState with Stage 0 data and save to disk.
 * This simulates a pipeline that completed Stage 0 (query analysis).
 */
function writePipelineState(sessionPath: string, opts: {
  originalQuery?: string;
  subQueries?: Array<{ query: string; priority?: string; standard?: string }>;
  assumptions?: string[];
  primaryStandards?: string[];
  clarityScore?: number;
  stage1Text?: string;
  stage3Text?: string;
} = {}): void {
  const query = opts.originalQuery ?? 'What are the ASME BPVC requirements?';

  // Build a PipelineState with events and stage outputs
  let state = PipelineState.create(query);

  // Stage 0: query analysis
  state = state.addEvent({ type: 'stage_started', stage: 0, data: {} });
  const queryPlan: Record<string, unknown> = {
    original_query: query,
  };
  if (opts.subQueries) {
    queryPlan['sub_queries'] = opts.subQueries;
  }
  if (opts.assumptions) {
    queryPlan['assumptions'] = opts.assumptions;
  }
  if (opts.primaryStandards) {
    queryPlan['primary_standards'] = opts.primaryStandards;
  }
  if (opts.clarityScore !== undefined) {
    queryPlan['clarity_score'] = opts.clarityScore;
  }
  state = state.setStageOutput(0, {
    text: 'Query analysis complete',
    summary: 'Analyzed query',
    usage: { inputTokens: 100, outputTokens: 50 },
    data: { query_plan: queryPlan },
  });
  state = state.addEvent({ type: 'stage_completed', stage: 0, data: {} });

  // Stage 1: web calibration (optional)
  if (opts.stage1Text) {
    state = state.addEvent({ type: 'stage_started', stage: 1, data: {} });
    state = state.setStageOutput(1, {
      text: opts.stage1Text,
      summary: 'Web calibration',
      usage: { inputTokens: 200, outputTokens: 100 },
      data: {},
    });
    state = state.addEvent({ type: 'stage_completed', stage: 1, data: {} });
  }

  // Stage 3: synthesis (optional)
  if (opts.stage3Text) {
    state = state.addEvent({ type: 'stage_started', stage: 3, data: {} });
    state = state.setStageOutput(3, {
      text: opts.stage3Text,
      summary: 'Synthesis',
      usage: { inputTokens: 500, outputTokens: 300 },
      data: { synthesis: opts.stage3Text, confidence: 'high' },
    });
    state = state.addEvent({ type: 'stage_completed', stage: 3, data: {} });
  }

  state.saveTo(sessionPath);
}

describe('PromptBuilder.buildOrchestratorSummaryBlock()', () => {
  let sessionPath: string;
  let builder: PromptBuilder;

  beforeEach(() => {
    sessionPath = join(TEST_DIR, `session-${Date.now()}`);
    mkdirSync(join(sessionPath, 'data'), { recursive: true });
    builder = createPromptBuilder();
  });

  afterEach(() => {
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  });

  // ════════════════════════════════════════════════════════════════════════════
  // NULL CASES
  // ════════════════════════════════════════════════════════════════════════════

  it('should return null when no summary or state file exists', () => {
    const result = builder.buildOrchestratorSummaryBlock(sessionPath);
    assert.equal(result, null);
  });

  it('should return null for malformed pipeline-summary.json (no state file)', () => {
    const dataDir = join(sessionPath, 'data');
    writeFileSync(join(dataDir, 'pipeline-summary.json'), 'not valid json{{{', 'utf-8');
    const result = builder.buildOrchestratorSummaryBlock(sessionPath);
    assert.equal(result, null);
  });

  // ════════════════════════════════════════════════════════════════════════════
  // COMPACT MODE (pipeline-summary.json only, no pipeline-state.json)
  // ════════════════════════════════════════════════════════════════════════════

  it('should return compact XML block with wasCompacted=true for summary-only', () => {
    writeSummary(sessionPath, createSummary());
    const result = builder.buildOrchestratorSummaryBlock(sessionPath);
    assert.ok(result);
    assert.equal(result.wasCompacted, true);
    assert.ok(result.block.includes('<orchestrator_prior_research mode="compact">'));
    assert.ok(result.block.includes('</orchestrator_prior_research>'));
    assert.ok(result.block.includes('ASME BPVC'));
    assert.ok(result.block.includes('complete (completed)'));
    assert.ok(result.block.includes('0, 1, 2, 3, 4, 5 of 6 total'));
  });

  it('should include compacted_notice in compact mode', () => {
    writeSummary(sessionPath, createSummary());
    const result = builder.buildOrchestratorSummaryBlock(sessionPath)!;
    assert.ok(result.block.includes('<compacted_notice>'));
    assert.ok(result.block.includes('compacted'));
  });

  it('should include synthesis when present (compact)', () => {
    writeSummary(sessionPath, createSummary());
    const result = builder.buildOrchestratorSummaryBlock(sessionPath)!;
    assert.ok(result.block.includes('<synthesis>'));
    assert.ok(result.block.includes('Pressure vessels must comply'));
    assert.ok(result.block.includes('</synthesis>'));
  });

  it('should include citation count (compact)', () => {
    writeSummary(sessionPath, createSummary());
    const result = builder.buildOrchestratorSummaryBlock(sessionPath)!;
    assert.ok(result.block.includes('<citations>5 citations</citations>'));
  });

  it('should include confidence level (compact)', () => {
    writeSummary(sessionPath, createSummary());
    const result = builder.buildOrchestratorSummaryBlock(sessionPath)!;
    assert.ok(result.block.includes('<confidence>high</confidence>'));
  });

  it('should include verification scores (compact)', () => {
    writeSummary(sessionPath, createSummary());
    const result = builder.buildOrchestratorSummaryBlock(sessionPath)!;
    assert.ok(result.block.includes('<verification>'));
    assert.ok(result.block.includes('entity_grounding: 0.95 (pass)'));
    assert.ok(result.block.includes('citation_accuracy: 0.9 (pass)'));
  });

  it('should include output file path (compact)', () => {
    writeSummary(sessionPath, createSummary());
    const result = builder.buildOrchestratorSummaryBlock(sessionPath)!;
    assert.ok(result.block.includes('<output_file>'));
    assert.ok(result.block.includes('answer.md'));
  });

  it('should show partial status for incomplete pipelines (compact)', () => {
    writeSummary(sessionPath, createSummary({
      wasPartial: true,
      exitReason: 'breakout',
      completedStages: [0, 1],
      synthesis: null,
      citationCount: 0,
      confidence: null,
      verificationScores: null,
      outputPath: null,
    }));
    const result = builder.buildOrchestratorSummaryBlock(sessionPath)!;
    assert.ok(result.block.includes('partial (breakout)'));
    assert.ok(result.block.includes('0, 1 of 6 total'));
    assert.ok(!result.block.includes('<synthesis>'));
    assert.ok(!result.block.includes('<verification>'));
    assert.ok(!result.block.includes('<output_file>'));
  });

  it('should show repair indicator (compact)', () => {
    writeSummary(sessionPath, createSummary({ neededRepair: true }));
    const result = builder.buildOrchestratorSummaryBlock(sessionPath)!;
    assert.ok(result.block.includes('<repair>'));
    assert.ok(result.block.includes('citations were repaired'));
  });

  it('should escape XML special characters (compact)', () => {
    writeSummary(sessionPath, createSummary({
      originalQuery: 'What is <TAG> & "attribute"?',
      synthesis: 'Contains <b>HTML</b> & special chars',
    }));
    const result = builder.buildOrchestratorSummaryBlock(sessionPath)!;
    assert.ok(result.block.includes('&lt;TAG&gt;'));
    assert.ok(result.block.includes('&amp;'));
    assert.ok(!result.block.includes('<TAG>'));
    assert.ok(!result.block.includes('<b>HTML</b>'));
  });

  it('should omit sections with null values (compact)', () => {
    writeSummary(sessionPath, createSummary({
      synthesis: null,
      citationCount: 0,
      confidence: null,
      verificationScores: null,
      outputPath: null,
      neededRepair: false,
    }));
    const result = builder.buildOrchestratorSummaryBlock(sessionPath)!;
    assert.ok(!result.block.includes('<synthesis>'));
    assert.ok(!result.block.includes('<citations>'));
    assert.ok(!result.block.includes('<confidence>'));
    assert.ok(!result.block.includes('<verification>'));
    assert.ok(!result.block.includes('<output_file>'));
    assert.ok(!result.block.includes('<repair>'));
  });

  it('should include Stage 0 enrichment fields in compact mode', () => {
    writeSummary(sessionPath, createSummary({
      queryDecomposition: ['What is ASME Section VIII?', 'What are Division 1 rules?'],
      assumptions: ['Working with carbon steel'],
      primaryStandards: ['ASME BPVC VIII-1'],
      clarityScore: 0.85,
    }));
    const result = builder.buildOrchestratorSummaryBlock(sessionPath)!;
    assert.ok(result.block.includes('<sub_queries>'));
    assert.ok(result.block.includes('What is ASME Section VIII?'));
    assert.ok(result.block.includes('What are Division 1 rules?'));
    assert.ok(result.block.includes('<assumptions>'));
    assert.ok(result.block.includes('Working with carbon steel'));
    assert.ok(result.block.includes('<primary_standards>ASME BPVC VIII-1</primary_standards>'));
    assert.ok(result.block.includes('<clarity_score>0.85</clarity_score>'));
  });

  // ════════════════════════════════════════════════════════════════════════════
  // FULL MODE (pipeline-state.json available, under budget)
  // ════════════════════════════════════════════════════════════════════════════

  it('should return full mode (wasCompacted=false) when pipeline-state.json fits under budget', () => {
    writePipelineState(sessionPath, {
      subQueries: [
        { query: 'Sub Q1', priority: 'high', standard: 'ASME VIII' },
        { query: 'Sub Q2', priority: 'medium' },
      ],
      assumptions: ['Carbon steel vessel'],
      primaryStandards: ['ASME BPVC VIII-1'],
      clarityScore: 0.9,
    });
    const result = builder.buildOrchestratorSummaryBlock(sessionPath);
    assert.ok(result);
    assert.equal(result.wasCompacted, false);
    assert.ok(result.block.includes('<orchestrator_prior_research mode="full">'));
    assert.ok(result.block.includes('<stage_0_query_analysis>'));
    assert.ok(result.block.includes('Sub Q1'));
    assert.ok(result.block.includes('Sub Q2'));
    assert.ok(result.block.includes('priority="high"'));
    assert.ok(result.block.includes('standard="ASME VIII"'));
    assert.ok(result.block.includes('Carbon steel vessel'));
    assert.ok(result.block.includes('ASME BPVC VIII-1'));
    assert.ok(result.block.includes('<clarity_score>0.9</clarity_score>'));
  });

  it('should include Stage 1 web calibration in full mode', () => {
    writePipelineState(sessionPath, {
      stage1Text: 'Found relevant web sources for calibration.',
    });
    const result = builder.buildOrchestratorSummaryBlock(sessionPath);
    assert.ok(result);
    assert.equal(result.wasCompacted, false);
    assert.ok(result.block.includes('<stage_1_web_calibration>'));
    assert.ok(result.block.includes('Found relevant web sources'));
  });

  it('should include Stage 3 synthesis in full mode when under budget', () => {
    writePipelineState(sessionPath, {
      stage3Text: 'The synthesis of all findings indicates...',
    });
    const result = builder.buildOrchestratorSummaryBlock(sessionPath);
    assert.ok(result);
    assert.equal(result.wasCompacted, false);
    assert.ok(result.block.includes('<stage_3_synthesis>'));
    assert.ok(result.block.includes('synthesis of all findings'));
    assert.ok(result.block.includes('<confidence>high</confidence>'));
  });

  it('should show completed stages from events in full mode', () => {
    writePipelineState(sessionPath, {
      stage1Text: 'Web data',
      stage3Text: 'Synthesis result',
    });
    const result = builder.buildOrchestratorSummaryBlock(sessionPath)!;
    assert.ok(result.block.includes('<stages_completed>0, 1, 3</stages_completed>'));
  });

  it('should prefer pipeline-state.json over pipeline-summary.json when both exist', () => {
    writePipelineState(sessionPath, {
      subQueries: [{ query: 'From state file' }],
    });
    writeSummary(sessionPath, createSummary({
      originalQuery: 'From summary file',
    }));
    const result = builder.buildOrchestratorSummaryBlock(sessionPath)!;
    // Should use full mode from pipeline-state.json
    assert.ok(result.block.includes('mode="full"'));
    assert.ok(result.block.includes('From state file'));
    assert.equal(result.wasCompacted, false);
  });

  // ════════════════════════════════════════════════════════════════════════════
  // BACKWARD COMPATIBILITY
  // ════════════════════════════════════════════════════════════════════════════

  it('should work with legacy summary files missing Stage 0 enrichment fields', () => {
    // Simulate a summary written before Phase 5A (no queryDecomposition, etc.)
    const legacySummary = createSummary();
    // Explicitly ensure the new fields are absent
    delete (legacySummary as unknown as Record<string, unknown>)['queryDecomposition'];
    delete (legacySummary as unknown as Record<string, unknown>)['assumptions'];
    delete (legacySummary as unknown as Record<string, unknown>)['primaryStandards'];
    delete (legacySummary as unknown as Record<string, unknown>)['clarityScore'];
    writeSummary(sessionPath, legacySummary);
    const result = builder.buildOrchestratorSummaryBlock(sessionPath);
    assert.ok(result);
    assert.ok(result.block.includes('ASME BPVC'));
    assert.ok(!result.block.includes('<sub_queries>'));
    assert.ok(!result.block.includes('<assumptions>'));
    assert.ok(!result.block.includes('<primary_standards>'));
    assert.ok(!result.block.includes('<clarity_score>'));
  });
});
