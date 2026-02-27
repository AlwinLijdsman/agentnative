/**
 * Follow-Up Context & Inline Labels — Tests (Section 18, Phase 7)
 *
 * Tests cover:
 * - parseAnswerSections() — markdown splitting, metadata filtering, truncation
 * - loadFollowUpContext() — answer.json loading, graceful degradation
 * - buildPriorContextHint() — Stage 0 hint string assembly
 * - injectWebAndPriorMarkers() — line-by-line marker processing + blockquote handling
 * - buildPriorResearchReferences() — filtering to only referenced sections
 * - Integration: renderDocument() with prior + web data + inline labels
 * - answer.json persistence structure validation
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  parseAnswerSections,
  loadFollowUpContext,
  buildPriorContextHint,
} from '../../../../shared/src/agent/orchestrator/follow-up-context.ts';

import {
  renderDocument,
  injectWebAndPriorMarkers,
  processWebRefLine,
  processPriorRefLine,
} from '../agent-render-output/renderer.ts';
import { mergeRenderConfig } from '../agent-render-output/config-loader.ts';
import { createSourceLinker } from '../agent-render-output/source-linker.ts';
import type { FinalAnswer, RenderConfig, WebReference, PriorSection } from '../agent-render-output/types.ts';

// ============================================================================
// Test Helpers
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

/** Create a temporary directory that is cleaned up automatically. */
function makeTempDir(prefix: string): string {
  const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ============================================================================
// parseAnswerSections() Tests
// ============================================================================

describe('parseAnswerSections', () => {
  it('parses markdown with multiple ## sections', () => {
    const answer = [
      '## Risk Assessment Framework',
      'The framework identifies three tiers of risk assessment.',
      '',
      '## Compliance Requirements',
      'Key compliance areas include liquidity and capital requirements.',
      '',
      '## Audit Procedures',
      'Standard procedures for auditing complex estimates.',
      '',
      '## Internal Controls',
      'Control activities should be designed to mitigate identified risks.',
      '',
      '## Reporting Standards',
      'Reporting should follow ISA 700 requirements.',
    ].join('\n');

    const sections = parseAnswerSections(answer);
    assert.equal(sections.length, 5);
    assert.equal(sections[0]?.sectionId, 'P1');
    assert.equal(sections[0]?.heading, 'Risk Assessment Framework');
    assert.equal(sections[0]?.sectionNum, 1);
    assert.ok(sections[0]?.excerpt.includes('framework identifies'));
    assert.equal(sections[4]?.sectionId, 'P5');
    assert.equal(sections[4]?.heading, 'Reporting Standards');
  });

  it('filters out metadata headings', () => {
    const answer = [
      '## Risk Assessment',
      'Content here.',
      '',
      '## Verification Summary',
      'Should be filtered out.',
      '',
      '## Citations Used',
      'Also filtered.',
      '',
      '## External Good Practice References',
      'Also filtered.',
      '',
      '## Audit Approach',
      'This should remain.',
    ].join('\n');

    const sections = parseAnswerSections(answer);
    assert.equal(sections.length, 2);
    assert.equal(sections[0]?.heading, 'Risk Assessment');
    assert.equal(sections[0]?.sectionId, 'P1');
    assert.equal(sections[1]?.heading, 'Audit Approach');
    assert.equal(sections[1]?.sectionId, 'P2');
  });

  it('truncates excerpts to ~500 chars at word boundary', () => {
    const longContent = 'word '.repeat(200); // 1000 chars
    const answer = `## Long Section\n${longContent}`;

    const sections = parseAnswerSections(answer);
    assert.equal(sections.length, 1);
    assert.ok(sections[0]!.excerpt.length <= 510, `Excerpt too long: ${sections[0]!.excerpt.length}`);
    assert.ok(sections[0]!.excerpt.endsWith('...'), 'Truncated excerpt should end with ...');
  });

  it('returns empty array for empty input', () => {
    assert.deepEqual(parseAnswerSections(''), []);
    assert.deepEqual(parseAnswerSections('   '), []);
  });

  it('skips content before first ## heading', () => {
    const answer = [
      '# Main Title',
      'Preamble text.',
      '',
      '## First Section',
      'Real content here.',
    ].join('\n');

    const sections = parseAnswerSections(answer);
    assert.equal(sections.length, 1);
    assert.equal(sections[0]?.heading, 'First Section');
  });

  it('filters out-of-scope headings case-insensitively', () => {
    const answer = [
      '## Real Section',
      'Content.',
      '',
      '## Out-of-Scope Notes',
      'Should be filtered.',
      '',
      '## Appendix: Research Decomposition',
      'Also filtered.',
    ].join('\n');

    const sections = parseAnswerSections(answer);
    assert.equal(sections.length, 1);
    assert.equal(sections[0]?.heading, 'Real Section');
  });
});

// ============================================================================
// loadFollowUpContext() Tests
// ============================================================================

describe('loadFollowUpContext', () => {
  it('loads valid answer.json and returns FollowUpContext', () => {
    const sessionsDir = makeTempDir('test-sessions');
    const sessionId = 'test-session-001';
    const dataDir = join(sessionsDir, sessionId, 'data');
    mkdirSync(dataDir, { recursive: true });

    const answerJson = {
      version: 1,
      answer: '## Risk Assessment\nThe framework identifies three tiers.\n\n## Audit Procedures\nStandard procedures.',
      original_query: 'What are ISA 540 requirements?',
      followup_number: 0,
      citations: [
        { source_ref: 'ISA540.13', claim: 'Risk assessment required', paragraph_id: 'p13' },
        { source_ref: 'ISA540.18', claim: 'Evaluation required', paragraph_id: 'p18' },
      ],
      sub_queries: [
        { text: 'ISA 540 risk assessment', role: 'primary', standards: ['ISA 540'] },
        { text: 'Complex estimates audit', role: 'supplementary', standards: ['ISA 540', 'ISA 315'] },
      ],
      web_references: [],
    };
    writeFileSync(join(dataDir, 'answer.json'), JSON.stringify(answerJson, null, 2));

    try {
      const ctx = loadFollowUpContext(sessionsDir, sessionId);
      assert.ok(ctx, 'Should return a context');
      assert.equal(ctx.followupNumber, 1, 'Should increment followup number');
      assert.equal(ctx.priorQuery, 'What are ISA 540 requirements?');
      assert.equal(ctx.priorParagraphIds.length, 2);
      assert.ok(ctx.priorParagraphIds.includes('p13'));
      assert.ok(ctx.priorParagraphIds.includes('p18'));
      assert.equal(ctx.priorSubQueries.length, 2);
      assert.equal(ctx.priorSections.length, 2);
      assert.equal(ctx.priorSections[0]?.sectionId, 'P1');
      assert.equal(ctx.priorSections[0]?.heading, 'Risk Assessment');
      assert.ok(ctx.priorAnswerText.includes('Risk Assessment'));
    } finally {
      rmSync(sessionsDir, { recursive: true, force: true });
    }
  });

  it('returns null when answer.json does not exist', () => {
    const sessionsDir = makeTempDir('test-sessions');
    try {
      const ctx = loadFollowUpContext(sessionsDir, 'nonexistent-session');
      assert.equal(ctx, null);
    } finally {
      rmSync(sessionsDir, { recursive: true, force: true });
    }
  });

  it('returns null for malformed JSON', () => {
    const sessionsDir = makeTempDir('test-sessions');
    const sessionId = 'malformed-session';
    const dataDir = join(sessionsDir, sessionId, 'data');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'answer.json'), '{ invalid json }}}');

    try {
      const ctx = loadFollowUpContext(sessionsDir, sessionId);
      assert.equal(ctx, null);
    } finally {
      rmSync(sessionsDir, { recursive: true, force: true });
    }
  });

  it('returns null for unknown version', () => {
    const sessionsDir = makeTempDir('test-sessions');
    const sessionId = 'version-session';
    const dataDir = join(sessionsDir, sessionId, 'data');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'answer.json'), JSON.stringify({ version: 99, answer: 'test' }));

    try {
      const ctx = loadFollowUpContext(sessionsDir, sessionId);
      assert.equal(ctx, null);
    } finally {
      rmSync(sessionsDir, { recursive: true, force: true });
    }
  });

  it('returns null when answer field is missing', () => {
    const sessionsDir = makeTempDir('test-sessions');
    const sessionId = 'no-answer-session';
    const dataDir = join(sessionsDir, sessionId, 'data');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'answer.json'), JSON.stringify({ version: 1, original_query: 'test' }));

    try {
      const ctx = loadFollowUpContext(sessionsDir, sessionId);
      assert.equal(ctx, null);
    } finally {
      rmSync(sessionsDir, { recursive: true, force: true });
    }
  });

  it('increments followup_number', () => {
    const sessionsDir = makeTempDir('test-sessions');
    const sessionId = 'followup-3';
    const dataDir = join(sessionsDir, sessionId, 'data');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'answer.json'), JSON.stringify({
      version: 1,
      answer: '## Section\nContent.',
      original_query: 'test',
      followup_number: 3,
    }));

    try {
      const ctx = loadFollowUpContext(sessionsDir, sessionId);
      assert.ok(ctx);
      assert.equal(ctx.followupNumber, 4, 'Should be 3 + 1 = 4');
    } finally {
      rmSync(sessionsDir, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// buildPriorContextHint() Tests
// ============================================================================

describe('buildPriorContextHint', () => {
  it('includes follow-up number and prior query', () => {
    const ctx = {
      followupNumber: 2,
      priorAnswerText: 'answer text',
      priorQuery: 'What are ISA 540 requirements?',
      priorSubQueries: [],
      priorParagraphIds: [],
      priorSections: [],
    };

    const hint = buildPriorContextHint(ctx);
    assert.ok(hint.includes('Follow-up #2'));
    assert.ok(hint.includes('What are ISA 540 requirements?'));
  });

  it('includes prior sub-queries (max 5)', () => {
    const ctx = {
      followupNumber: 1,
      priorAnswerText: '',
      priorQuery: 'test',
      priorSubQueries: [
        { text: 'Query 1', role: 'primary', standards: ['ISA 540'] },
        { text: 'Query 2', role: 'supplementary', standards: ['ISA 315'] },
        { text: 'Query 3', role: 'primary', standards: [] },
        { text: 'Query 4', role: 'primary', standards: ['ISA 700'] },
        { text: 'Query 5', role: 'primary', standards: [] },
        { text: 'Query 6 should be truncated', role: 'extra', standards: [] },
      ],
      priorParagraphIds: [],
      priorSections: [],
    };

    const hint = buildPriorContextHint(ctx);
    assert.ok(hint.includes('Query 1'));
    assert.ok(hint.includes('Query 5'));
    assert.ok(!hint.includes('Query 6 should be truncated'), 'Should limit to 5 sub-queries');
    assert.ok(hint.includes('1 more'), 'Should indicate truncation');
  });

  it('includes prior section headings', () => {
    const ctx = {
      followupNumber: 1,
      priorAnswerText: '',
      priorQuery: 'test',
      priorSubQueries: [],
      priorParagraphIds: [],
      priorSections: [
        { sectionNum: 1, sectionId: 'P1', heading: 'Risk Assessment', excerpt: '' },
        { sectionNum: 2, sectionId: 'P2', heading: 'Compliance', excerpt: '' },
      ],
    };

    const hint = buildPriorContextHint(ctx);
    assert.ok(hint.includes('[P1] Risk Assessment'));
    assert.ok(hint.includes('[P2] Compliance'));
  });
});

// ============================================================================
// processWebRefLine() Tests (Section 18, Phase 2)
// ============================================================================

describe('processWebRefLine', () => {
  const config = makeConfig();

  it('formats WEB_REF with known reference', () => {
    const webRefs: WebReference[] = [
      { url: 'https://example.com/report', title: 'Example Report', insight: 'Key finding', sourceType: 'web' },
    ];
    const labelMap = new Map<string, number>();

    const result = processWebRefLine(
      'WEB_REF|https://example.com/report|Key compliance finding',
      webRefs, labelMap, 1, config,
    );

    assert.ok(result.text.includes('[W1]'), `Expected [W1] in: ${result.text}`);
    assert.ok(result.text.includes('Example Report'), `Expected title in: ${result.text}`);
    assert.ok(result.text.includes('Key compliance finding'), `Expected insight in: ${result.text}`);
    assert.ok(result.text.startsWith('*'), 'Should be italic');
    assert.ok(result.text.endsWith('*'), 'Should end italic');
  });

  it('uses domain as fallback title for unknown URL', () => {
    const labelMap = new Map<string, number>();

    const result = processWebRefLine(
      'WEB_REF|https://unknown.com/page|Some insight',
      [], labelMap, 1, config,
    );

    assert.ok(result.text.includes('[W1]'));
    assert.ok(result.text.includes('unknown.com'), 'Should use domain as fallback');
  });

  it('assigns sequential labels', () => {
    const labelMap = new Map<string, number>();

    const r1 = processWebRefLine('WEB_REF|https://a.com|A', [], labelMap, 1, config);
    const r2 = processWebRefLine('WEB_REF|https://b.com|B', [], labelMap, r1.nextIdx, config);

    assert.ok(r1.text.includes('[W1]'));
    assert.ok(r2.text.includes('[W2]'));
  });
});

// ============================================================================
// processPriorRefLine() Tests (Section 18, Phase 2)
// ============================================================================

describe('processPriorRefLine', () => {
  const config = makeConfig();

  it('formats PRIOR_REF with heading and excerpt', () => {
    const priorSections: PriorSection[] = [
      { sectionNum: 1, heading: 'Risk Assessment', excerpt: 'Framework identifies tiers' },
    ];

    const result = processPriorRefLine(
      'PRIOR_REF|P1|Risk Assessment|The framework identifies three tiers',
      priorSections, config,
    );

    assert.equal(result.lines.length, 2, 'Should have heading + excerpt lines');
    assert.ok(result.lines[0]?.includes('[P1]'), `Expected [P1] in: ${result.lines[0]}`);
    assert.ok(result.lines[0]?.includes('From prior research'), `Expected 'From prior research' in: ${result.lines[0]}`);
    assert.ok(result.lines[0]?.includes('Risk Assessment'), `Expected heading in: ${result.lines[0]}`);
    assert.ok(result.lines[0]?.startsWith('*[P1]'), `Expected label at start: ${result.lines[0]}`);
    assert.ok(result.lines[1]?.includes('framework identifies'), `Expected excerpt in: ${result.lines[1]}`);
  });

  it('handles PRIOR_REF with missing section data gracefully', () => {
    const result = processPriorRefLine(
      'PRIOR_REF|P99|Unknown|Some excerpt',
      [], config,
    );

    assert.ok(result.lines.length >= 1);
    assert.ok(result.lines[0]?.includes('Unknown'));
  });
});

// ============================================================================
// injectWebAndPriorMarkers() Tests — Blockquote handling (Section 18, F3)
// ============================================================================

describe('injectWebAndPriorMarkers — blockquote handling', () => {
  const config = makeConfig();

  it('strips > prefix before matching WEB_REF and re-emits in blockquote', () => {
    const body = [
      '> **Sources**',
      '> WEB_REF|https://example.com|Key finding',
    ].join('\n');
    const webRefs: WebReference[] = [
      { url: 'https://example.com', title: 'Example', insight: 'Key finding', sourceType: 'web' },
    ];

    const result = injectWebAndPriorMarkers(body, webRefs, [], config);
    assert.ok(result.includes('> *[W1]'), 'Should be in blockquote');
    assert.ok(!result.includes('WEB_REF|'), 'WEB_REF marker should be replaced');
  });

  it('strips > prefix before matching PRIOR_REF and re-emits in blockquote', () => {
    const body = [
      '> **Sources**',
      '> PRIOR_REF|P1|Risk|The framework identifies risk tiers',
    ].join('\n');
    const priorSections: PriorSection[] = [
      { sectionNum: 1, heading: 'Risk', excerpt: '' },
    ];

    const result = injectWebAndPriorMarkers(body, [], priorSections, config);
    assert.ok(result.includes('> *[P1] From prior research'), 'Should have formatted prior ref in blockquote with label first');
    assert.ok(!result.includes('PRIOR_REF|'), 'PRIOR_REF marker should be replaced');
  });

  it('leaves inline [W1] and [P1] labels untouched in body text', () => {
    const body = 'The analysis [W1] shows that risk [P1] is significant.';
    const result = injectWebAndPriorMarkers(body, [], [], config);
    assert.equal(result, body, 'Inline labels should be preserved as-is');
  });

  it('handles mixed markers and regular text', () => {
    const body = [
      '## Analysis Section',
      'Key finding about risk [W1].',
      '> **Sources**',
      '> *ISA 540.13: "The auditor shall..."*',
      '> WEB_REF|https://example.com|Supporting evidence',
      '> PRIOR_REF|P1|Risk|Framework identifies tiers',
      '',
      'More prose text.',
    ].join('\n');
    const webRefs: WebReference[] = [
      { url: 'https://example.com', title: 'Example', insight: 'Supporting evidence', sourceType: 'web' },
    ];
    const priorSections: PriorSection[] = [
      { sectionNum: 1, heading: 'Risk', excerpt: '' },
    ];

    const result = injectWebAndPriorMarkers(body, webRefs, priorSections, config);
    assert.ok(result.includes('## Analysis Section'), 'Regular headings preserved');
    assert.ok(result.includes('[W1]'), 'Inline label preserved in prose');
    assert.ok(result.includes('> *ISA 540.13'), 'ISA source preserved');
    assert.ok(!result.includes('WEB_REF|'), 'WEB_REF replaced');
    assert.ok(!result.includes('PRIOR_REF|'), 'PRIOR_REF replaced');
    assert.ok(result.includes('More prose text'), 'Trailing text preserved');
  });
});

// ============================================================================
// buildPriorResearchReferences filtering Tests (Section 18, F6)
// ============================================================================

describe('renderDocument — prior research filtering', () => {
  it('only shows referenced [P#] sections in Prior Research References', () => {
    const priorSections: PriorSection[] = [
      { sectionNum: 1, heading: 'Risk Assessment', excerpt: 'The framework identifies risk tiers' },
      { sectionNum: 2, heading: 'Compliance', excerpt: 'Key compliance areas' },
      { sectionNum: 3, heading: 'Audit Procedures', excerpt: 'Standard procedures' },
    ];

    // Synthesis body only references [P1] and [P3]
    const finalAnswer = makeMinimalFinalAnswer({
      synthesis: '## Summary\n\nRisk assessment [P1] and audit procedures [P3] are key.',
      priorSections,
    });
    const config = makeConfig();
    const linker = makeLinker();

    const doc = renderDocument(finalAnswer, config, linker);

    assert.ok(doc.includes('## Prior Research References'), 'Should have Prior Research section');
    assert.ok(doc.includes('Risk Assessment'), 'P1 should be included');
    assert.ok(doc.includes('Audit Procedures'), 'P3 should be included');
    assert.ok(!doc.includes('Compliance'), 'P2 should NOT be included (not referenced)');
  });

  it('shows no Prior Research section when body has no [P#] references and no sections', () => {
    const finalAnswer = makeMinimalFinalAnswer({
      synthesis: '## Summary\n\nNo prior references here.',
    });
    const config = makeConfig();
    const linker = makeLinker();

    const doc = renderDocument(finalAnswer, config, linker);
    assert.ok(!doc.includes('## Prior Research References'), 'Should NOT have Prior Research section');
  });
});

// ============================================================================
// Integration: renderDocument with prior + web data + inline labels
// ============================================================================

describe('renderDocument — full follow-up integration', () => {
  it('renders document with both web and prior markers + inline labels', () => {
    const webRefs: WebReference[] = [
      { url: 'https://example.com/report', title: 'Example Report', insight: 'Key finding', sourceType: 'web' },
    ];
    const priorSections: PriorSection[] = [
      { sectionNum: 1, sectionId: 'P1', heading: 'Risk Assessment', excerpt: 'The framework identifies risk tiers' },
    ];

    const finalAnswer = makeMinimalFinalAnswer({
      synthesis: [
        '## Executive Summary',
        '',
        'The analysis [W1] builds on prior risk assessment [P1].',
        '> **Sources**',
        '> *ISA 540.13: "Required standard."*',
        '> PRIOR_REF|P1|Risk Assessment|The framework identifies risk tiers',
        '> WEB_REF|https://example.com/report|Key finding',
      ].join('\n'),
      webReferences: webRefs,
      priorSections,
    });
    const config = makeConfig();
    const linker = makeLinker();

    const doc = renderDocument(finalAnswer, config, linker);

    // Inline labels should be preserved
    assert.ok(doc.includes('[W1]'), 'Inline [W1] should be in body');
    assert.ok(doc.includes('[P1]'), 'Inline [P1] should be in body');

    // Markers should be replaced
    assert.ok(!doc.includes('WEB_REF|'), 'WEB_REF marker should be replaced');
    assert.ok(!doc.includes('PRIOR_REF|'), 'PRIOR_REF marker should be replaced');

    // Reference sections should exist
    assert.ok(doc.includes('## External References'), 'Should have External References');
    assert.ok(doc.includes('## Prior Research References'), 'Should have Prior Research References');
    assert.ok(doc.includes('Example Report'), 'Should include web ref title');
    assert.ok(doc.includes('Risk Assessment'), 'Should include prior section heading');
  });

  it('renders document with followupNumber in metadata', () => {
    const finalAnswer = makeMinimalFinalAnswer({
      followupNumber: 2,
    });
    const config = makeConfig();
    const linker = makeLinker();

    const doc = renderDocument(finalAnswer, config, linker);
    // The document should render successfully with followupNumber
    assert.ok(doc.length > 0, 'Should produce output');
  });
});

// ============================================================================
// answer.json structure validation
// ============================================================================

describe('answer.json structure', () => {
  it('validates expected answer.json fields for follow-up loading', () => {
    // Simulate what runOutput() writes to answer.json
    const answerJson = {
      version: 1,
      answer: '## Summary\nContent here.',
      original_query: 'What are ISA 540 requirements?',
      followup_number: 0,
      depth_mode: 'deep',
      citations: [
        { source_ref: 'ISA540.13', claim: 'Required', paragraph_id: 'p13' },
      ],
      sub_queries: [
        { text: 'ISA 540 risk', role: 'primary', standards: ['ISA 540'] },
      ],
      web_references: [
        { url: 'https://example.com', title: 'Example', insight: 'Finding', sourceType: 'web' },
      ],
    };

    // Validate structure
    assert.equal(answerJson.version, 1);
    assert.equal(typeof answerJson.answer, 'string');
    assert.equal(typeof answerJson.original_query, 'string');
    assert.equal(typeof answerJson.followup_number, 'number');
    assert.ok(Array.isArray(answerJson.citations));
    assert.ok(Array.isArray(answerJson.sub_queries));
    assert.ok(Array.isArray(answerJson.web_references));

    // Write and re-load to verify round-trip
    const tempDir = makeTempDir('answer-json-test');
    const sessionDir = join(tempDir, 'test-session', 'data');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, 'answer.json'), JSON.stringify(answerJson, null, 2));

    try {
      const loaded = loadFollowUpContext(tempDir, 'test-session');
      assert.ok(loaded, 'Should load the answer.json');
      assert.equal(loaded.followupNumber, 1, 'Should increment followup number');
      assert.equal(loaded.priorQuery, 'What are ISA 540 requirements?');
      assert.equal(loaded.priorParagraphIds.length, 1);
      assert.equal(loaded.priorParagraphIds[0], 'p13');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
