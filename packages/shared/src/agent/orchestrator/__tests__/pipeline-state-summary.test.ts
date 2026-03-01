/**
 * Tests for PipelineState.generateSummary() — Orchestrator Context Continuity.
 *
 * Verifies that generateSummary():
 * - Extracts originalQuery from Stage 0 query plan
 * - Extracts synthesis/citations from Stage 3
 * - Extracts verification scores from Stage 4
 * - Handles complete pipelines (all stages done)
 * - Handles partial pipelines (breakout, error, paused)
 * - Handles empty/missing stage data gracefully
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PipelineState } from '../pipeline-state.ts';
import type { StageResult, PipelineSummary } from '../types.ts';
import { ZERO_USAGE } from '../types.ts';

const SESSION_ID = 'test-session-summary';
const AGENT_SLUG = 'isa-deep-research';

/** Helper: create a PipelineState with stage outputs and events for a complete pipeline. */
function createCompletePipeline(): PipelineState {
  let state = PipelineState.create(SESSION_ID, AGENT_SLUG);

  // Stage 0: Query Planning
  state = state.addEvent({ type: 'stage_started', stage: 0, data: {} });
  state = state.setStageOutput(0, {
    text: 'Query plan created',
    summary: 'Planned 3 sub-queries',
    usage: { inputTokens: 100, outputTokens: 200 },
    data: {
      query_plan: {
        original_query: 'What are the safety requirements for pressure vessels?',
        sub_queries: [
          { query: 'ASME BPVC Section VIII requirements', role: 'primary' },
          { query: 'Pressure vessel testing procedures', role: 'supporting' },
        ],
        depth_mode: 'thorough',
      },
      queries: ['query1', 'query2'],
    },
  });
  state = state.addEvent({ type: 'stage_completed', stage: 0, data: {} });

  // Stage 1: Web Search Calibration
  state = state.addEvent({ type: 'stage_started', stage: 1, data: {} });
  state = state.setStageOutput(1, {
    text: 'Calibration done',
    summary: 'Web search calibrated',
    usage: { inputTokens: 50, outputTokens: 100 },
    data: { websearch_calibration: { calibrated: true } },
  });
  state = state.addEvent({ type: 'stage_completed', stage: 1, data: {} });

  // Stage 2: KB Search (no key data needed for summary)
  state = state.addEvent({ type: 'stage_started', stage: 2, data: {} });
  state = state.setStageOutput(2, {
    text: 'Retrieved paragraphs',
    summary: '15 paragraphs found',
    usage: { inputTokens: 200, outputTokens: 300 },
    data: { paragraphs_found: 15 },
  });
  state = state.addEvent({ type: 'stage_completed', stage: 2, data: {} });

  // Stage 3: Synthesis
  state = state.addEvent({ type: 'stage_started', stage: 3, data: {} });
  state = state.setStageOutput(3, {
    text: 'Synthesis complete',
    summary: 'Answer synthesized with 8 citations',
    usage: { inputTokens: 500, outputTokens: 1000 },
    data: {
      synthesis: 'Pressure vessels must comply with ASME BPVC Section VIII Division 1...',
      citations: [
        { sourceRef: 'UG-16', claim: 'Minimum thickness requirements' },
        { sourceRef: 'UG-20', claim: 'Material toughness requirements' },
        { sourceRef: 'UG-22', claim: 'Loading conditions' },
      ],
      confidence: 'high',
      gaps: [],
      out_of_scope_notes: 'Excluded non-ASME jurisdictions',
      needs_repair: false,
    },
  });
  state = state.addEvent({ type: 'stage_completed', stage: 3, data: {} });

  // Stage 4: Verification
  state = state.addEvent({ type: 'stage_started', stage: 4, data: {} });
  state = state.setStageOutput(4, {
    text: 'Verification complete',
    summary: 'All checks passed',
    usage: { inputTokens: 300, outputTokens: 400 },
    data: {
      needsRepair: false,
      verification_scores: {
        entity_grounding: { score: 0.95, passed: true },
        citation_accuracy: { score: 0.92, passed: true },
        relation_preservation: { score: 0.88, passed: true },
        contradictions: { count: 0, passed: true },
      },
      totalCitations: 3,
      failedCount: 0,
    },
  });
  state = state.addEvent({ type: 'stage_completed', stage: 4, data: {} });

  // Stage 5: Render Output
  state = state.addEvent({ type: 'stage_started', stage: 5, data: {} });
  state = state.setStageOutput(5, {
    text: 'Output rendered',
    summary: 'Document written',
    usage: ZERO_USAGE,
    data: {
      outputPath: '/sessions/test/plans/answer.md',
      totalCitations: 3,
      sectionsCount: 10,
    },
  });
  state = state.addEvent({ type: 'stage_completed', stage: 5, data: {} });

  return state;
}

describe('PipelineState.generateSummary()', () => {
  describe('complete pipeline', () => {
    it('should extract originalQuery from Stage 0 query plan', () => {
      const state = createCompletePipeline();
      const summary = state.generateSummary(6, 'completed');
      assert.equal(summary.originalQuery, 'What are the safety requirements for pressure vessels?');
    });

    it('should extract synthesis from Stage 3', () => {
      const state = createCompletePipeline();
      const summary = state.generateSummary(6, 'completed');
      assert.ok(summary.synthesis);
      assert.ok(summary.synthesis.includes('ASME BPVC Section VIII'));
    });

    it('should extract citation count from Stage 3', () => {
      const state = createCompletePipeline();
      const summary = state.generateSummary(6, 'completed');
      assert.equal(summary.citationCount, 3);
    });

    it('should extract confidence from Stage 3', () => {
      const state = createCompletePipeline();
      const summary = state.generateSummary(6, 'completed');
      assert.equal(summary.confidence, 'high');
    });

    it('should extract verification scores from Stage 4', () => {
      const state = createCompletePipeline();
      const summary = state.generateSummary(6, 'completed');
      assert.ok(summary.verificationScores);
      const scores = summary.verificationScores as Record<string, Record<string, unknown>>;
      assert.equal(scores['entity_grounding']?.['score'], 0.95);
      assert.equal(scores['citation_accuracy']?.['passed'], true);
    });

    it('should not need repair when verification passed', () => {
      const state = createCompletePipeline();
      const summary = state.generateSummary(6, 'completed');
      assert.equal(summary.neededRepair, false);
    });

    it('should list all completed stages', () => {
      const state = createCompletePipeline();
      const summary = state.generateSummary(6, 'completed');
      assert.deepEqual(summary.completedStages, [0, 1, 2, 3, 4, 5]);
    });

    it('should not be partial when all stages completed', () => {
      const state = createCompletePipeline();
      const summary = state.generateSummary(6, 'completed');
      assert.equal(summary.wasPartial, false);
      assert.equal(summary.exitReason, 'completed');
    });

    it('should include output path from Stage 5', () => {
      const state = createCompletePipeline();
      const summary = state.generateSummary(6, 'completed');
      assert.equal(summary.outputPath, '/sessions/test/plans/answer.md');
    });

    it('should include generatedAt timestamp', () => {
      const state = createCompletePipeline();
      const summary = state.generateSummary(6, 'completed');
      assert.ok(summary.generatedAt);
      // Should be a valid ISO timestamp
      assert.ok(!isNaN(new Date(summary.generatedAt).getTime()));
    });
  });

  describe('partial pipeline (breakout at Stage 0)', () => {
    it('should generate summary with only query plan data', () => {
      let state = PipelineState.create(SESSION_ID, AGENT_SLUG);
      state = state.addEvent({ type: 'stage_started', stage: 0, data: {} });
      state = state.setStageOutput(0, {
        text: 'Query plan created',
        summary: 'Planned queries',
        usage: { inputTokens: 100, outputTokens: 200 },
        data: {
          query_plan: { original_query: 'Test query', sub_queries: [] },
        },
      });
      state = state.addEvent({ type: 'stage_completed', stage: 0, data: {} });

      const summary = state.generateSummary(6, 'breakout');
      assert.equal(summary.originalQuery, 'Test query');
      assert.equal(summary.synthesis, null);
      assert.equal(summary.citationCount, 0);
      assert.equal(summary.confidence, null);
      assert.equal(summary.verificationScores, null);
      assert.equal(summary.outputPath, null);
      assert.equal(summary.wasPartial, true);
      assert.equal(summary.exitReason, 'breakout');
      assert.deepEqual(summary.completedStages, [0]);
    });
  });

  describe('partial pipeline (error at Stage 3)', () => {
    it('should include data from stages 0-2 but not 3-5', () => {
      let state = PipelineState.create(SESSION_ID, AGENT_SLUG);

      // Complete stages 0, 1, 2
      for (const stageId of [0, 1, 2]) {
        state = state.addEvent({ type: 'stage_started', stage: stageId, data: {} });
        state = state.setStageOutput(stageId, {
          text: `Stage ${stageId} done`,
          summary: `Stage ${stageId} summary`,
          usage: { inputTokens: 50, outputTokens: 50 },
          data: stageId === 0
            ? { query_plan: { original_query: 'Error test query' } }
            : {},
        });
        state = state.addEvent({ type: 'stage_completed', stage: stageId, data: {} });
      }

      // Stage 3 fails
      state = state.addEvent({ type: 'stage_started', stage: 3, data: {} });
      state = state.addEvent({ type: 'stage_failed', stage: 3, data: { error: 'LLM timeout' } });

      const summary = state.generateSummary(6, 'error');
      assert.equal(summary.originalQuery, 'Error test query');
      assert.equal(summary.synthesis, null);
      assert.equal(summary.wasPartial, true);
      assert.equal(summary.exitReason, 'error');
      assert.deepEqual(summary.completedStages, [0, 1, 2]);
    });
  });

  describe('empty pipeline', () => {
    it('should handle no stage outputs gracefully', () => {
      const state = PipelineState.create(SESSION_ID, AGENT_SLUG);
      const summary = state.generateSummary(6, 'error');
      assert.equal(summary.originalQuery, 'Unknown query');
      assert.equal(summary.synthesis, null);
      assert.equal(summary.citationCount, 0);
      assert.equal(summary.confidence, null);
      assert.equal(summary.verificationScores, null);
      assert.equal(summary.neededRepair, false);
      assert.deepEqual(summary.completedStages, []);
      assert.equal(summary.wasPartial, true);
    });
  });

  describe('synthesis truncation', () => {
    it('should truncate long synthesis to ~800 chars', () => {
      let state = PipelineState.create(SESSION_ID, AGENT_SLUG);
      state = state.addEvent({ type: 'stage_started', stage: 0, data: {} });
      state = state.setStageOutput(0, {
        text: '', summary: '', usage: ZERO_USAGE,
        data: { query_plan: { original_query: 'Long test' } },
      });
      state = state.addEvent({ type: 'stage_completed', stage: 0, data: {} });

      state = state.addEvent({ type: 'stage_started', stage: 3, data: {} });
      const longSynthesis = 'A'.repeat(2000);
      state = state.setStageOutput(3, {
        text: '', summary: '', usage: ZERO_USAGE,
        data: { synthesis: longSynthesis, citations: [], confidence: 'medium' },
      });
      state = state.addEvent({ type: 'stage_completed', stage: 3, data: {} });

      const summary = state.generateSummary(6, 'completed');
      assert.ok(summary.synthesis);
      assert.ok(summary.synthesis.length <= 820); // 800 + '...[truncated]'
      assert.ok(summary.synthesis.endsWith('...[truncated]'));
    });
  });

  describe('citations_used fallback', () => {
    it('should use citations_used field when citations is missing', () => {
      let state = PipelineState.create(SESSION_ID, AGENT_SLUG);
      state = state.addEvent({ type: 'stage_started', stage: 3, data: {} });
      state = state.setStageOutput(3, {
        text: '', summary: '', usage: ZERO_USAGE,
        data: {
          synthesis: 'Test',
          citations_used: [{ sourceRef: 'A' }, { sourceRef: 'B' }],
          confidence: 'low',
        },
      });
      state = state.addEvent({ type: 'stage_completed', stage: 3, data: {} });

      const summary = state.generateSummary(6, 'paused');
      assert.equal(summary.citationCount, 2);
    });
  });

  describe('repair detection', () => {
    it('should detect needsRepair from Stage 4', () => {
      let state = PipelineState.create(SESSION_ID, AGENT_SLUG);
      state = state.addEvent({ type: 'stage_started', stage: 4, data: {} });
      state = state.setStageOutput(4, {
        text: '', summary: '', usage: ZERO_USAGE,
        data: { needsRepair: true, verification_scores: {} },
      });
      state = state.addEvent({ type: 'stage_completed', stage: 4, data: {} });

      const summary = state.generateSummary(6, 'completed');
      assert.equal(summary.neededRepair, true);
    });
  });

  // ─── Phase 5A: Stage 0 enrichment fields ─────────────────────────────────

  describe('Stage 0 enrichment fields', () => {
    it('should extract queryDecomposition from sub_queries', () => {
      const state = createCompletePipeline();
      const summary = state.generateSummary(6, 'completed');
      assert.ok(summary.queryDecomposition);
      assert.equal(summary.queryDecomposition.length, 2);
      assert.equal(summary.queryDecomposition[0], 'ASME BPVC Section VIII requirements');
      assert.equal(summary.queryDecomposition[1], 'Pressure vessel testing procedures');
    });

    it('should extract queryDecomposition from "text" field (BAML path)', () => {
      let state = PipelineState.create(SESSION_ID, AGENT_SLUG);
      state = state.addEvent({ type: 'stage_started', stage: 0, data: {} });
      state = state.setStageOutput(0, {
        text: '', summary: '', usage: ZERO_USAGE,
        data: {
          query_plan: {
            original_query: 'Test',
            sub_queries: [{ text: 'BAML sub-query' }],
          },
        },
      });
      state = state.addEvent({ type: 'stage_completed', stage: 0, data: {} });
      const summary = state.generateSummary(6, 'breakout');
      assert.ok(summary.queryDecomposition);
      assert.equal(summary.queryDecomposition[0], 'BAML sub-query');
    });

    it('should extract assumptions from query_plan', () => {
      let state = PipelineState.create(SESSION_ID, AGENT_SLUG);
      state = state.addEvent({ type: 'stage_started', stage: 0, data: {} });
      state = state.setStageOutput(0, {
        text: '', summary: '', usage: ZERO_USAGE,
        data: {
          query_plan: {
            original_query: 'Test',
            assumptions: ['Working with carbon steel', 'Ambient temperature'],
          },
        },
      });
      state = state.addEvent({ type: 'stage_completed', stage: 0, data: {} });
      const summary = state.generateSummary(6, 'breakout');
      assert.ok(summary.assumptions);
      assert.deepEqual(summary.assumptions, ['Working with carbon steel', 'Ambient temperature']);
    });

    it('should extract primaryStandards from query_plan', () => {
      let state = PipelineState.create(SESSION_ID, AGENT_SLUG);
      state = state.addEvent({ type: 'stage_started', stage: 0, data: {} });
      state = state.setStageOutput(0, {
        text: '', summary: '', usage: ZERO_USAGE,
        data: {
          query_plan: {
            original_query: 'Test',
            primary_standards: ['ASME BPVC VIII-1', 'API 510'],
          },
        },
      });
      state = state.addEvent({ type: 'stage_completed', stage: 0, data: {} });
      const summary = state.generateSummary(6, 'breakout');
      assert.ok(summary.primaryStandards);
      assert.deepEqual(summary.primaryStandards, ['ASME BPVC VIII-1', 'API 510']);
    });

    it('should extract clarityScore from query_plan', () => {
      let state = PipelineState.create(SESSION_ID, AGENT_SLUG);
      state = state.addEvent({ type: 'stage_started', stage: 0, data: {} });
      state = state.setStageOutput(0, {
        text: '', summary: '', usage: ZERO_USAGE,
        data: {
          query_plan: {
            original_query: 'Test',
            clarity_score: 0.85,
          },
        },
      });
      state = state.addEvent({ type: 'stage_completed', stage: 0, data: {} });
      const summary = state.generateSummary(6, 'breakout');
      assert.equal(summary.clarityScore, 0.85);
    });

    it('should return undefined enrichment fields when Stage 0 has no query_plan', () => {
      let state = PipelineState.create(SESSION_ID, AGENT_SLUG);
      state = state.addEvent({ type: 'stage_started', stage: 0, data: {} });
      state = state.setStageOutput(0, {
        text: '', summary: '', usage: ZERO_USAGE,
        data: { other_key: 'value' },
      });
      state = state.addEvent({ type: 'stage_completed', stage: 0, data: {} });
      const summary = state.generateSummary(6, 'breakout');
      assert.equal(summary.queryDecomposition, undefined);
      assert.equal(summary.assumptions, undefined);
      assert.equal(summary.primaryStandards, undefined);
      assert.equal(summary.clarityScore, undefined);
    });

    it('should return undefined enrichment fields when no Stage 0 output', () => {
      const state = PipelineState.create(SESSION_ID, AGENT_SLUG);
      const summary = state.generateSummary(6, 'error');
      assert.equal(summary.queryDecomposition, undefined);
      assert.equal(summary.assumptions, undefined);
      assert.equal(summary.primaryStandards, undefined);
      assert.equal(summary.clarityScore, undefined);
    });

    it('should return undefined for empty arrays (assumptions, standards)', () => {
      let state = PipelineState.create(SESSION_ID, AGENT_SLUG);
      state = state.addEvent({ type: 'stage_started', stage: 0, data: {} });
      state = state.setStageOutput(0, {
        text: '', summary: '', usage: ZERO_USAGE,
        data: {
          query_plan: {
            original_query: 'Test',
            assumptions: [],
            primary_standards: [],
          },
        },
      });
      state = state.addEvent({ type: 'stage_completed', stage: 0, data: {} });
      const summary = state.generateSummary(6, 'breakout');
      assert.equal(summary.assumptions, undefined);
      assert.equal(summary.primaryStandards, undefined);
    });
  });
});

// =============================================================================
// PipelineState.isBreakoutPending — Confirmation Gate State
// =============================================================================

describe('PipelineState.isBreakoutPending', () => {
  it('should return false when no events exist', () => {
    const state = PipelineState.create(SESSION_ID, AGENT_SLUG);
    assert.equal(state.isBreakoutPending, false);
  });

  it('should return false when only non-breakout events exist', () => {
    let state = PipelineState.create(SESSION_ID, AGENT_SLUG);
    state = state.addEvent({ type: 'stage_started', stage: 0, data: {} });
    state = state.addEvent({ type: 'stage_completed', stage: 0, data: {} });
    state = state.addEvent({ type: 'pause_requested', stage: 1, data: {} });
    assert.equal(state.isBreakoutPending, false);
  });

  it('should return true when breakout_pending event exists with no resolution', () => {
    let state = PipelineState.create(SESSION_ID, AGENT_SLUG);
    state = state.addEvent({ type: 'pause_requested', stage: 1, data: {} });
    state = state.addEvent({ type: 'breakout_pending', stage: 1, data: { userMessage: 'something else' } });
    assert.equal(state.isBreakoutPending, true);
  });

  it('should return false when breakout_pending is followed by resumed (denied)', () => {
    let state = PipelineState.create(SESSION_ID, AGENT_SLUG);
    state = state.addEvent({ type: 'pause_requested', stage: 1, data: {} });
    state = state.addEvent({ type: 'breakout_pending', stage: 1, data: { userMessage: 'exit' } });
    state = state.addEvent({ type: 'resumed', stage: 1, data: { breakoutDenied: true } });
    assert.equal(state.isBreakoutPending, false);
  });

  it('should return false when breakout_pending is followed by breakout (confirmed)', () => {
    let state = PipelineState.create(SESSION_ID, AGENT_SLUG);
    state = state.addEvent({ type: 'pause_requested', stage: 1, data: {} });
    state = state.addEvent({ type: 'breakout_pending', stage: 1, data: { userMessage: 'exit' } });
    state = state.addEvent({ type: 'breakout', stage: 1, data: { decision: 'confirm' } });
    assert.equal(state.isBreakoutPending, false);
  });

  it('should handle paused AND pending simultaneously', () => {
    // Pipeline is paused (pause_requested > resumed) AND breakout is pending
    let state = PipelineState.create(SESSION_ID, AGENT_SLUG);
    state = state.addEvent({ type: 'stage_started', stage: 0, data: {} });
    state = state.addEvent({ type: 'stage_completed', stage: 0, data: {} });
    state = state.addEvent({ type: 'pause_requested', stage: 1, data: {} });
    state = state.addEvent({ type: 'breakout_pending', stage: 1, data: {} });
    assert.equal(state.isPaused, true, 'should still be paused');
    assert.equal(state.isBreakoutPending, true, 'should be breakout pending');
  });

  it('should handle deny then re-trigger: breakout_pending → resumed → breakout_pending', () => {
    let state = PipelineState.create(SESSION_ID, AGENT_SLUG);
    state = state.addEvent({ type: 'pause_requested', stage: 1, data: {} });
    // First attempt — denied
    state = state.addEvent({ type: 'breakout_pending', stage: 1, data: { attempt: 1 } });
    state = state.addEvent({ type: 'resumed', stage: 1, data: { breakoutDenied: true } });
    assert.equal(state.isBreakoutPending, false, 'first pending should be resolved');
    // Second attempt — not yet resolved
    state = state.addEvent({ type: 'breakout_pending', stage: 1, data: { attempt: 2 } });
    assert.equal(state.isBreakoutPending, true, 'second pending should be active');
  });
});

// =============================================================================
// PipelineState.isPaused — Breakout resolves pause (F11)
// =============================================================================

describe('PipelineState.isPaused after breakout (F11)', () => {
  it('should return false when breakout event follows pause_requested', () => {
    let state = PipelineState.create(SESSION_ID, AGENT_SLUG);
    state = state.addEvent({ type: 'stage_started', stage: 0, data: {} });
    state = state.addEvent({ type: 'stage_completed', stage: 0, data: {} });
    state = state.addEvent({ type: 'pause_requested', stage: 0, data: {} });
    assert.equal(state.isPaused, true, 'should be paused before breakout');
    state = state.addEvent({ type: 'breakout_pending', stage: 0, data: {} });
    assert.equal(state.isPaused, true, 'should still be paused during pending');
    state = state.addEvent({ type: 'breakout', stage: 0, data: { decision: 'confirm' } });
    assert.equal(state.isPaused, false, 'should NOT be paused after breakout');
  });

  it('should return true when one of two pauses is unresolved after breakout', () => {
    let state = PipelineState.create(SESSION_ID, AGENT_SLUG);
    // First pause → breakout
    state = state.addEvent({ type: 'pause_requested', stage: 0, data: {} });
    state = state.addEvent({ type: 'breakout', stage: 0, data: { decision: 'confirm' } });
    assert.equal(state.isPaused, false, 'first pause resolved by breakout');
    // Second pause → unresolved
    state = state.addEvent({ type: 'pause_requested', stage: 1, data: {} });
    assert.equal(state.isPaused, true, 'second pause is unresolved');
  });

  it('should correctly count mixed resumed + breakout as resolving events', () => {
    let state = PipelineState.create(SESSION_ID, AGENT_SLUG);
    state = state.addEvent({ type: 'pause_requested', stage: 0, data: {} });
    state = state.addEvent({ type: 'resumed', stage: 0, data: {} });
    state = state.addEvent({ type: 'pause_requested', stage: 1, data: {} });
    state = state.addEvent({ type: 'breakout', stage: 1, data: { decision: 'confirm' } });
    assert.equal(state.isPaused, false, '2 pauses, 1 resumed + 1 breakout = not paused');
  });
});

// =============================================================================
// originalQuery getter
// =============================================================================

describe('PipelineState.originalQuery', () => {
  it('should return original_query from Stage 0 query plan', () => {
    let state = PipelineState.create(SESSION_ID, AGENT_SLUG);
    state = state.setStageOutput(0, {
      text: 'Plan',
      summary: 'Planned',
      usage: ZERO_USAGE,
      data: { query_plan: { original_query: 'What are ISA 540 requirements?' } },
    });
    assert.equal(state.originalQuery, 'What are ISA 540 requirements?');
  });

  it('should fall back to user_query if original_query is missing', () => {
    let state = PipelineState.create(SESSION_ID, AGENT_SLUG);
    state = state.setStageOutput(0, {
      text: 'Plan',
      summary: 'Planned',
      usage: ZERO_USAGE,
      data: { query_plan: { user_query: 'Fallback query text' } },
    });
    assert.equal(state.originalQuery, 'Fallback query text');
  });

  it('should return "Unknown query" when no Stage 0 output exists', () => {
    const state = PipelineState.create(SESSION_ID, AGENT_SLUG);
    assert.equal(state.originalQuery, 'Unknown query');
  });

  it('should return "Unknown query" when query_plan is missing', () => {
    let state = PipelineState.create(SESSION_ID, AGENT_SLUG);
    state = state.setStageOutput(0, {
      text: 'Plan',
      summary: 'Planned',
      usage: ZERO_USAGE,
      data: { other_key: 'some value' },
    });
    assert.equal(state.originalQuery, 'Unknown query');
  });

  it('should work with generateSummary() (uses same getter)', () => {
    const pipeline = createCompletePipeline();
    const summary = pipeline.generateSummary(6, 'completed');
    assert.equal(summary.originalQuery, pipeline.originalQuery);
  });
});

// =============================================================================
// subQueryTexts getter
// =============================================================================

describe('PipelineState.subQueryTexts', () => {
  it('should extract sub-query texts from "query" field (Zod path)', () => {
    let state = PipelineState.create(SESSION_ID, AGENT_SLUG);
    state = state.setStageOutput(0, {
      text: 'Plan',
      summary: 'Planned',
      usage: ZERO_USAGE,
      data: {
        query_plan: {
          original_query: 'Test',
          sub_queries: [
            { query: 'First sub-query', role: 'primary' },
            { query: 'Second sub-query', role: 'supporting' },
          ],
        },
      },
    });
    const texts = state.subQueryTexts;
    assert.equal(texts.length, 2);
    assert.equal(texts[0], 'First sub-query');
    assert.equal(texts[1], 'Second sub-query');
  });

  it('should extract sub-query texts from "text" field (BAML path)', () => {
    let state = PipelineState.create(SESSION_ID, AGENT_SLUG);
    state = state.setStageOutput(0, {
      text: 'Plan',
      summary: 'Planned',
      usage: ZERO_USAGE,
      data: {
        query_plan: {
          original_query: 'Test',
          sub_queries: [
            { text: 'BAML sub-query 1' },
            { text: 'BAML sub-query 2' },
          ],
        },
      },
    });
    const texts = state.subQueryTexts;
    assert.equal(texts.length, 2);
    assert.equal(texts[0], 'BAML sub-query 1');
  });

  it('should return empty array when no Stage 0 output', () => {
    const state = PipelineState.create(SESSION_ID, AGENT_SLUG);
    assert.deepEqual([...state.subQueryTexts], []);
  });

  it('should return empty array when sub_queries is missing', () => {
    let state = PipelineState.create(SESSION_ID, AGENT_SLUG);
    state = state.setStageOutput(0, {
      text: 'Plan',
      summary: 'Planned',
      usage: ZERO_USAGE,
      data: { query_plan: { original_query: 'Test' } },
    });
    assert.deepEqual([...state.subQueryTexts], []);
  });

  it('should limit to first 5 sub-queries', () => {
    let state = PipelineState.create(SESSION_ID, AGENT_SLUG);
    const subQueries = Array.from({ length: 8 }, (_, i) => ({ query: `Sub-query ${i + 1}` }));
    state = state.setStageOutput(0, {
      text: 'Plan',
      summary: 'Planned',
      usage: ZERO_USAGE,
      data: { query_plan: { original_query: 'Test', sub_queries: subQueries } },
    });
    const texts = state.subQueryTexts;
    assert.equal(texts.length, 5);
    assert.equal(texts[4], 'Sub-query 5');
  });

  it('should filter out empty sub-query texts', () => {
    let state = PipelineState.create(SESSION_ID, AGENT_SLUG);
    state = state.setStageOutput(0, {
      text: 'Plan',
      summary: 'Planned',
      usage: ZERO_USAGE,
      data: {
        query_plan: {
          original_query: 'Test',
          sub_queries: [
            { query: 'Valid query' },
            { query: '' },
            { other_field: 'no query or text' },
            { query: 'Another valid' },
          ],
        },
      },
    });
    const texts = state.subQueryTexts;
    assert.equal(texts.length, 2);
    assert.equal(texts[0], 'Valid query');
    assert.equal(texts[1], 'Another valid');
  });
});
