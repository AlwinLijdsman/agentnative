/**
 * Tests for pauseInstructions priority in formatPauseMessage().
 *
 * Verifies that:
 * - pauseInstructions takes priority over ISA normalizers for ALL stages
 * - ISA normalizers still work when pauseInstructions is absent
 * - normalizationPath returns 'pauseInstructions' for the generic path
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatPauseMessage } from '../pause-formatter.ts';

describe('formatPauseMessage() — pauseInstructions priority', () => {

  const baseData = { scope: 'test', feature_description: 'Test feature' };

  it('pauseInstructions at Stage 0 uses buildPauseInstructionsMessage (not ISA normalizer)', () => {
    const result = formatPauseMessage(0, 'analyze_request', baseData, JSON.stringify(baseData), {
      pauseInstructions: 'Review the scope assessment below.',
    });
    // Should contain the pause instructions text
    assert.ok(
      result.message.includes('Review the scope assessment below'),
      `Expected message to include pauseInstructions. Got: ${result.message.slice(0, 200)}`,
    );
    assert.equal(result.normalizationPath, 'pauseInstructions');
  });

  it('pauseInstructions at Stage 3 uses buildPauseInstructionsMessage', () => {
    const data = { refined_plan: 'test' };
    const result = formatPauseMessage(3, 'refine_plan', data, JSON.stringify(data), {
      pauseInstructions: 'The plan has been reviewed and refined.',
    });
    assert.ok(
      result.message.includes('The plan has been reviewed and refined'),
      `Expected message to include pauseInstructions. Got: ${result.message.slice(0, 200)}`,
    );
    assert.equal(result.normalizationPath, 'pauseInstructions');
  });

  it('Stage 0 without pauseInstructions falls through to ISA normalizer', () => {
    const data = {
      query_plan: { original_query: 'test', sub_queries: [], depth_mode: 'standard' },
    };
    const result = formatPauseMessage(0, 'analyze_query', data, JSON.stringify(data));
    // ISA normalizer should produce a non-empty message
    assert.ok(result.message.length > 0, 'ISA normalizer should produce output');
    // normalizationPath should NOT be 'pauseInstructions'
    assert.notEqual(result.normalizationPath, 'pauseInstructions');
  });

  it('Stage 1 without pauseInstructions falls through to ISA normalizer', () => {
    const data = {
      queries: [{ text: 'test query' }],
      webResults: [],
    };
    const result = formatPauseMessage(1, 'websearch_calibration', data, JSON.stringify(data));
    assert.ok(result.message.length > 0, 'ISA normalizer should produce output');
    assert.notEqual(result.normalizationPath, 'pauseInstructions');
  });

  it('normalizationPath is "pauseInstructions" when pauseInstructions is used', () => {
    const data = { findings: [] };
    const result = formatPauseMessage(2, 'review', data, JSON.stringify(data), {
      pauseInstructions: 'Check the review findings.',
    });
    assert.equal(result.normalizationPath, 'pauseInstructions');
  });
});
