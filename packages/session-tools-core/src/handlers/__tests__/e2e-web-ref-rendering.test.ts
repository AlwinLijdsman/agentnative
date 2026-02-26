/**
 * Web Reference Rendering — Tests (Section 17, Phase 6)
 *
 * Tests the full web reference pipeline:
 * - extractWebReferences() — Zod/BAML shape handling
 * - extractWebResearchContext() — Zod/BAML shape handling
 * - injectWebAndPriorMarkers() — WEB_REF/PRIOR_REF marker processing
 * - fuzzyUrlLookup() — exact and domain-based matching
 * - escapeMd() — pipe character escaping
 * - formatSourceBlockSpacing() — blockquote spacing
 * - Integration: renderDocument() with populated webReferences
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { renderDocument, injectWebAndPriorMarkers, fuzzyUrlLookup } from '../agent-render-output/renderer.ts';
import { escapeMd, formatSourceBlockSpacing } from '../agent-render-output/markdown-formatters.ts';
import { mergeRenderConfig } from '../agent-render-output/config-loader.ts';
import { createSourceLinker } from '../agent-render-output/source-linker.ts';
import type { FinalAnswer, RenderConfig, WebReference, PriorSection } from '../agent-render-output/types.ts';

// Re-implement extractWebReferences and extractWebResearchContext locally for testing
// (they live in packages/shared but are pure functions — we test the logic here)
import { extractWebReferences, extractWebResearchContext } from '../../../../shared/src/agent/orchestrator/stage-runner.ts';

// ============================================================================
// Test Fixtures
// ============================================================================

function makeConfig(): RenderConfig {
  return mergeRenderConfig(null);
}

function makeLinker() {
  return createSourceLinker('noop', {});
}

function makeMinimalFinalAnswer(overrides?: Partial<FinalAnswer>): FinalAnswer {
  return {
    originalQuery: 'Test query',
    synthesis: '## Executive Summary\n\nTest synthesis content.',
    citations: [],
    verificationScores: {
      entity_grounding: { score: 0.9, passed: true },
      citation_accuracy: { score: 0.9, passed: true },
      relation_preservation: { score: 0.9, passed: true },
      contradictions: { count: 0, passed: true },
    },
    sourceTexts: {},
    subQueries: [],
    depthMode: 'standard',
    ...overrides,
  };
}

// ============================================================================
// extractWebReferences() Tests
// ============================================================================

describe('extractWebReferences', () => {
  it('extracts from Zod-shape data (websearch_calibration.web_sources)', () => {
    const stageData: Record<string, unknown> = {
      websearch_calibration: {
        web_sources: [
          { url: 'https://example.com/a', title: 'Source A', relevance_note: 'Relevant to topic A', source_type: 'regulatory', domain: 'example.com' },
          { url: 'https://example.com/b', title: 'Source B', relevance_note: 'Relevant to topic B', source_type: 'web', domain: 'example.com' },
        ],
        web_research_context: 'Some context here',
      },
    };

    const refs = extractWebReferences(stageData);
    assert.equal(refs.length, 2);
    assert.equal(refs[0]?.url, 'https://example.com/a');
    assert.equal(refs[0]?.title, 'Source A');
    assert.equal(refs[0]?.insight, 'Relevant to topic A');
    assert.equal(refs[0]?.sourceType, 'regulatory');
    assert.equal(refs[1]?.url, 'https://example.com/b');
  });

  it('extracts from BAML-shape data (webResults)', () => {
    const stageData: Record<string, unknown> = {
      webResults: [
        {
          query: 'test query',
          results: [
            { url: 'https://baml.com/1', title: 'BAML Source 1', snippet: 'Key finding from BAML' },
            { url: 'https://baml.com/2', title: 'BAML Source 2', snippet: 'Another finding' },
          ],
        },
      ],
    };

    const refs = extractWebReferences(stageData);
    assert.equal(refs.length, 2);
    assert.equal(refs[0]?.url, 'https://baml.com/1');
    assert.equal(refs[0]?.title, 'BAML Source 1');
    assert.equal(refs[0]?.insight, 'Key finding from BAML');
    assert.equal(refs[0]?.sourceType, 'web');
  });

  it('returns empty array when no data present', () => {
    const refs = extractWebReferences({});
    assert.equal(refs.length, 0);
  });

  it('returns empty array when websearch_calibration has no web_sources', () => {
    const stageData: Record<string, unknown> = {
      websearch_calibration: { intent_changes: 'none' },
    };
    const refs = extractWebReferences(stageData);
    assert.equal(refs.length, 0);
  });
});

// ============================================================================
// extractWebResearchContext() Tests
// ============================================================================

describe('extractWebResearchContext', () => {
  it('extracts from Zod-shape data (websearch_calibration.web_research_context)', () => {
    const stageData: Record<string, unknown> = {
      websearch_calibration: {
        web_research_context: '## Web Research Context\n\nKey findings about compliance...',
      },
    };

    const ctx = extractWebResearchContext(stageData);
    assert.ok(ctx.includes('Web Research Context'));
    assert.ok(ctx.length > 0);
  });

  it('extracts from BAML-shape data (calibration.calibration_summary)', () => {
    const stageData: Record<string, unknown> = {
      calibration: {
        calibration_summary: 'Summary of calibration findings',
      },
    };

    const ctx = extractWebResearchContext(stageData);
    assert.equal(ctx, 'Summary of calibration findings');
  });

  it('returns empty string when no context present', () => {
    const ctx = extractWebResearchContext({});
    assert.equal(ctx, '');
  });
});

// ============================================================================
// injectWebAndPriorMarkers() Tests
// ============================================================================

describe('injectWebAndPriorMarkers', () => {
  const config = makeConfig();

  it('replaces WEB_REF markers with [W1] formatted citations', () => {
    const body = '> **Sources**\n> WEB_REF|https://example.com/report|Key compliance finding';
    const webRefs: WebReference[] = [
      { url: 'https://example.com/report', title: 'Compliance Report', insight: 'Key compliance finding', sourceType: 'regulatory' },
    ];

    const result = injectWebAndPriorMarkers(body, webRefs, [], config);
    assert.ok(result.includes('[W1]'), `Expected [W1] in: ${result}`);
    assert.ok(result.includes('Key compliance finding'), `Expected insight text in: ${result}`);
    assert.ok(!result.includes('WEB_REF|'), `WEB_REF marker should be removed: ${result}`);
  });

  it('replaces PRIOR_REF markers with [P1] formatted citations', () => {
    const body = '> **Sources**\n> PRIOR_REF|P1|Risk Assessment|The framework identifies three tiers here.';
    const priorSections: PriorSection[] = [
      { sectionNum: 1, heading: 'Risk Assessment', excerpt: 'The framework identifies three tiers...' },
    ];

    const result = injectWebAndPriorMarkers(body, [], priorSections, config);
    assert.ok(result.includes('[P1]'), `Expected [P1] in: ${result}`);
    assert.ok(result.includes('Risk Assessment'), `Expected heading in: ${result}`);
    assert.ok(!result.includes('PRIOR_REF|'), `PRIOR_REF marker should be removed: ${result}`);
  });

  it('handles multiple WEB_REF markers with sequential numbering', () => {
    const body = [
      '> **Sources**',
      '> WEB_REF|https://a.com|Finding A',
      '> WEB_REF|https://b.com|Finding B',
    ].join('\n');
    const webRefs: WebReference[] = [
      { url: 'https://a.com', title: 'Site A', insight: 'Finding A' },
      { url: 'https://b.com', title: 'Site B', insight: 'Finding B' },
    ];

    const result = injectWebAndPriorMarkers(body, webRefs, [], config);
    assert.ok(result.includes('[W1]'), 'Expected [W1]');
    assert.ok(result.includes('[W2]'), 'Expected [W2]');
  });

  it('leaves text unchanged when no markers present', () => {
    const body = 'No markers in this text at all.';
    const result = injectWebAndPriorMarkers(body, [], [], config);
    assert.equal(result, body);
  });

  it('handles WEB_REF with unknown URL gracefully', () => {
    const body = 'WEB_REF|https://unknown.com|Some insight here.';

    const result = injectWebAndPriorMarkers(body, [], [], config);
    assert.ok(result.includes('[W1]'), 'Should still assign a label');
    assert.ok(result.includes('Some insight'), 'Should preserve the insight');
  });
});

// ============================================================================
// fuzzyUrlLookup() Tests
// ============================================================================

describe('fuzzyUrlLookup', () => {
  const refs: WebReference[] = [
    { url: 'https://example.com/reports/2024', title: 'Example Report', insight: 'Key finding', sourceType: 'web' },
    { url: 'https://other.org/docs', title: 'Other Doc', insight: 'Other finding', sourceType: 'regulatory' },
  ];

  it('finds exact URL match', () => {
    const result = fuzzyUrlLookup('https://example.com/reports/2024', refs);
    assert.ok(result);
    assert.equal(result.title, 'Example Report');
  });

  it('finds domain-based match when exact fails', () => {
    const result = fuzzyUrlLookup('https://example.com/different/path', refs);
    assert.ok(result);
    assert.equal(result.title, 'Example Report');
  });

  it('returns undefined when no match', () => {
    const result = fuzzyUrlLookup('https://nomatch.net/page', refs);
    assert.equal(result, undefined);
  });

  it('handles malformed URLs gracefully', () => {
    const result = fuzzyUrlLookup('not-a-url', refs);
    assert.equal(result, undefined);
  });
});

// ============================================================================
// escapeMd() Tests
// ============================================================================

describe('escapeMd', () => {
  it('escapes pipe characters', () => {
    assert.equal(escapeMd('a|b|c'), 'a\\|b\\|c');
  });

  it('leaves text without pipes unchanged', () => {
    assert.equal(escapeMd('no pipes here'), 'no pipes here');
  });

  it('handles empty string', () => {
    assert.equal(escapeMd(''), '');
  });
});

// ============================================================================
// formatSourceBlockSpacing() Tests
// ============================================================================

describe('formatSourceBlockSpacing', () => {
  it('inserts blank > line between consecutive source entries', () => {
    const input = [
      '> **Sources**',
      '>',
      '> *ISA 540.13: "The auditor shall..."*',
      '> *ISA 540.18: "The auditor shall evaluate..."*',
    ].join('\n');

    const result = formatSourceBlockSpacing(input);
    const lines = result.split('\n');

    // Should have a blank > line between the two source entries
    const entry1Idx = lines.findIndex(l => l.includes('ISA 540.13'));
    assert.ok(entry1Idx >= 0, 'Should find first entry');
    assert.equal(lines[entry1Idx + 1], '>', 'Should have blank > after first entry');
    assert.ok(lines[entry1Idx + 2]?.includes('ISA 540.18'), 'Should have second entry after blank');
  });

  it('leaves single entry unchanged', () => {
    const input = [
      '> **Sources**',
      '>',
      '> *ISA 540.13: "The auditor shall..."*',
    ].join('\n');

    const result = formatSourceBlockSpacing(input);
    assert.equal(result, input);
  });

  it('handles text without blockquotes', () => {
    const input = 'Just regular text\nwith no blockquotes';
    const result = formatSourceBlockSpacing(input);
    assert.equal(result, input);
  });
});

// ============================================================================
// Integration: renderDocument() with populated webReferences
// ============================================================================

describe('renderDocument with webReferences', () => {
  it('renders [W1] [W2] labels in External References section', () => {
    const webRefs: WebReference[] = [
      { url: 'https://example.com/report', title: 'Example Report', insight: 'Key compliance finding', sourceType: 'regulatory' },
      { url: 'https://other.org/guide', title: 'Practice Guide', insight: 'Best practice overview', sourceType: 'web' },
    ];

    const finalAnswer = makeMinimalFinalAnswer({ webReferences: webRefs });
    const config = makeConfig();
    const linker = makeLinker();

    const doc = renderDocument(finalAnswer, config, linker);

    assert.ok(doc.includes('## External References'), 'Should have External References section');
    assert.ok(doc.includes('[W1]'), 'Should have [W1] label');
    assert.ok(doc.includes('[W2]'), 'Should have [W2] label');
    assert.ok(doc.includes('Example Report'), 'Should include title');
    assert.ok(doc.includes('https://example.com/report'), 'Should include URL');
    assert.ok(doc.includes('Key compliance finding'), 'Should include insight');
  });

  it('renders [P1] [P2] labels in Prior Research section', () => {
    const priorSections: PriorSection[] = [
      { sectionNum: 1, heading: 'Risk Assessment Framework', excerpt: 'The framework identifies three tiers of risk' },
      { sectionNum: 2, heading: 'Compliance Requirements', excerpt: 'Key compliance areas include liquidity' },
    ];

    const finalAnswer = makeMinimalFinalAnswer({ priorSections });
    const config = makeConfig();
    const linker = makeLinker();

    const doc = renderDocument(finalAnswer, config, linker);

    assert.ok(doc.includes('## Prior Research References'), 'Should have Prior Research section');
    assert.ok(doc.includes('[P1]'), 'Should have [P1] label');
    assert.ok(doc.includes('[P2]'), 'Should have [P2] label');
    assert.ok(doc.includes('Risk Assessment Framework'), 'Should include heading');
  });

  it('skips sections when no web/prior data', () => {
    const finalAnswer = makeMinimalFinalAnswer();
    const config = makeConfig();
    const linker = makeLinker();

    const doc = renderDocument(finalAnswer, config, linker);

    assert.ok(!doc.includes('## External References'), 'Should NOT have External References section');
    assert.ok(!doc.includes('## Prior Research References'), 'Should NOT have Prior Research section');
  });

  it('processes WEB_REF markers in synthesis Sources blockquote and renders External References', () => {
    const webRefs: WebReference[] = [
      { url: 'https://example.com/report', title: 'Example Report', insight: 'Key compliance finding', sourceType: 'regulatory' },
    ];

    // Section 18: WEB_REF markers appear on their own line in Sources blockquotes,
    // not inline in prose. The line-by-line processor matches startsWith('WEB_REF|').
    const finalAnswer = makeMinimalFinalAnswer({
      synthesis: '## Executive Summary\n\nThe analysis shows [W1] that compliance is needed.\n> **Sources**\n> WEB_REF|https://example.com/report|Key compliance finding',
      webReferences: webRefs,
    });
    const config = makeConfig();
    const linker = makeLinker();

    const doc = renderDocument(finalAnswer, config, linker);

    // WEB_REF marker should be replaced in the blockquote
    assert.ok(!doc.includes('WEB_REF|'), 'WEB_REF marker should be replaced');
    assert.ok(doc.includes('[W1]'), 'Should have [W1] inline');
    // External References section should exist
    assert.ok(doc.includes('## External References'), 'Should have External References section');
  });
});
