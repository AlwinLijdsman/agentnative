/**
 * Tests for Stage 1 empty web results handling (Section 20 — Bug 3, Bug 4).
 *
 * Verifies:
 * - normalizeStage1Data() handles skipped calibration
 * - normalizeStage1Data() recovers from rawText fallback
 * - formatStage1PauseMessage() renders skipped message
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStage1Data, formatStage1PauseMessage } from '../pause-formatter.ts';

describe('normalizeStage1Data — skipped calibration', () => {
  it('recognizes { websearch_calibration: { skipped: true } }', () => {
    const data = {
      websearch_calibration: { skipped: true },
      queries: [],
      webResults: [],
    };
    const result = normalizeStage1Data(data);
    assert.notEqual(result, null);
    assert.equal(result!.skipped, true);
    assert.equal(result!.queryPlanRefined, false);
    assert.equal(result!.webSourceCount, 0);
    assert.deepEqual(result!.queriesAdded, []);
    assert.deepEqual(result!.queriesModified, []);
    assert.deepEqual(result!.queriesDemoted, []);
  });

  it('recognizes top-level { skipped: true }', () => {
    const data = {
      skipped: true,
      queries: [],
    };
    const result = normalizeStage1Data(data);
    assert.notEqual(result, null);
    assert.equal(result!.skipped, true);
  });

  it('does NOT match { websearch_calibration: { skipped: false } }', () => {
    const data = {
      websearch_calibration: {
        skipped: false,
        web_research_context: 'Some context',
        intent_changes: {
          sub_queries_added: [],
          sub_queries_modified: [],
          sub_queries_demoted: [],
        },
      },
      webResults: [],
    };
    const result = normalizeStage1Data(data);
    assert.notEqual(result, null);
    // Should use normal Zod path, not skipped path
    assert.equal(result!.skipped, false);
  });
});

describe('normalizeStage1Data — rawText recovery', () => {
  it('recovers JSON from rawText when top-level keys missing', () => {
    // Simulates what happens when extractRawJson fails in stage-runner
    // but rawText contains valid JSON with websearch_calibration
    const innerJson = JSON.stringify({
      websearch_calibration: {
        skipped: false,
        web_research_context: 'Recovered context',
        intent_changes: {
          sub_queries_added: [
            { query: 'test query', role: 'primary', reason: 'needed' },
          ],
          sub_queries_modified: [],
          sub_queries_demoted: [],
        },
      },
    });

    const data = {
      rawText: innerJson,
      webResults: [],
    };

    const result = normalizeStage1Data(data);
    assert.notEqual(result, null);
    assert.equal(result!.skipped, false);
    assert.equal(result!.queriesAdded.length, 1);
    assert.equal(result!.queriesAdded[0]!.query, 'test query');
  });

  it('returns null when rawText contains no valid JSON', () => {
    const data = {
      rawText: 'This is just plain text, not JSON at all',
      webResults: [],
    };
    const result = normalizeStage1Data(data);
    assert.equal(result, null);
  });

  it('recovers skipped from rawText', () => {
    const innerJson = JSON.stringify({
      websearch_calibration: { skipped: true },
    });

    const data = {
      rawText: `Some preamble text\n\`\`\`json\n${innerJson}\n\`\`\`\nSome trailing text`,
      webResults: [],
    };

    const result = normalizeStage1Data(data);
    assert.notEqual(result, null);
    assert.equal(result!.skipped, true);
  });
});

describe('normalizeStage1Data — normal paths still work', () => {
  it('normalizes Zod path data', () => {
    const data = {
      websearch_calibration: {
        skipped: false,
        web_research_context: 'Some web context',
        intent_changes: {
          sub_queries_added: [
            { query: 'new q', role: 'supporting', reason: 'web sources' },
          ],
          sub_queries_modified: [
            { original: 'old q', modified: 'refined q', reason: 'better' },
          ],
          sub_queries_demoted: [],
        },
      },
      webResults: [{ query: 'test', results: [] }],
    };
    const result = normalizeStage1Data(data);
    assert.notEqual(result, null);
    assert.equal(result!.skipped, false);
    assert.equal(result!.queriesAdded.length, 1);
    assert.equal(result!.queriesModified.length, 1);
    assert.equal(result!.queryPlanRefined, true);
    assert.equal(result!.webSourceCount, 1);
  });

  it('normalizes BAML path data', () => {
    const data = {
      calibration: {
        queries: [
          {
            original_text: 'old',
            refined_text: 'new',
            action: 'modified',
            reason: 'updated',
          },
        ],
        calibration_summary: 'BAML summary',
      },
      webResults: [],
    };
    const result = normalizeStage1Data(data);
    assert.notEqual(result, null);
    assert.equal(result!.skipped, false);
    assert.equal(result!.queriesModified.length, 1);
    assert.equal(result!.summary, 'BAML summary');
  });
});

describe('formatStage1PauseMessage — skipped rendering', () => {
  it('renders skip message when cal.skipped is true', () => {
    const cal = {
      skipped: true,
      executionStatus: 'no_results' as const,
      summary: 'Web search calibration was skipped.',
      queriesAdded: [],
      queriesModified: [],
      queriesDemoted: [],
      scopeChanged: false,
      webSourceCount: 0,
      queryPlanRefined: false,
    };
    const message = formatStage1PauseMessage(cal, '{}');
    assert.ok(message.includes('NO RESULTS'), 'Should contain NO RESULTS label');
    assert.ok(message.includes('calibration was skipped'), 'Should explain skip');
    assert.ok(message.includes('Shall I proceed'), 'Should have proceed prompt');
    assert.ok(!message.includes('CALIBRATED'), 'Should NOT say CALIBRATED');
    assert.ok(!message.includes('CONFIRMED'), 'Should NOT say CONFIRMED');
  });

  it('renders user-choice skip state distinctly', () => {
    const cal = {
      skipped: true,
      executionStatus: 'user_skipped' as const,
      summary: 'Web search was skipped by user choice — proceeding with the Stage 0 query plan.',
      queriesAdded: [],
      queriesModified: [],
      queriesDemoted: [],
      scopeChanged: false,
      webSourceCount: 0,
      queryPlanRefined: false,
      warnings: [],
    };
    const message = formatStage1PauseMessage(cal, '{}');
    assert.ok(message.includes('USER CHOICE'), 'Should show user-choice label');
  });

  it('renders unavailable state and warnings', () => {
    const cal = {
      skipped: true,
      executionStatus: 'unavailable' as const,
      summary: 'Web search could not run because MCP bridge/tools were unavailable.',
      queriesAdded: [],
      queriesModified: [],
      queriesDemoted: [],
      scopeChanged: false,
      webSourceCount: 0,
      queryPlanRefined: false,
      warnings: ['MCP bridge unavailable'],
    };
    const message = formatStage1PauseMessage(cal, '{}');
    assert.ok(message.includes('UNAVAILABLE'), 'Should show unavailable label');
    assert.ok(message.includes('Warnings'), 'Should include warnings section');
  });

  it('renders normal message when cal.skipped is false', () => {
    const cal = {
      skipped: false,
      summary: 'Calibrated the query plan.',
      queriesAdded: [{ query: 'test q', role: 'primary', reason: 'needed' }],
      queriesModified: [],
      queriesDemoted: [],
      scopeChanged: false,
      webSourceCount: 3,
      queryPlanRefined: true,
    };
    const message = formatStage1PauseMessage(cal, '{}');
    assert.ok(message.includes('CALIBRATED'), 'Should say CALIBRATED');
    assert.ok(message.includes('Queries Added'), 'Should list added queries');
    assert.ok(!message.includes('SKIPPED'), 'Should NOT say SKIPPED');
  });

  it('includes cost footer in skipped message when provided', () => {
    const cal = {
      skipped: true,
      summary: 'Skipped.',
      queriesAdded: [],
      queriesModified: [],
      queriesDemoted: [],
      scopeChanged: false,
      webSourceCount: 0,
      queryPlanRefined: false,
    };
    const message = formatStage1PauseMessage(cal, '{}', {
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.001,
    });
    assert.ok(message.includes('100 input'), 'Should include input tokens');
    assert.ok(message.includes('50 output'), 'Should include output tokens');
  });
});
