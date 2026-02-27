/**
 * Unit tests for the Output Renderer.
 *
 * Tests the core rendering engine: document assembly, source block injection,
 * verification table, citations table, and section processing.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { renderDocument, injectSourceBlocks } from '../renderer.ts';
import { mergeRenderConfig } from '../config-loader.ts';
import { createSourceLinker } from '../source-linker.ts';
import type { FinalAnswer, RenderConfig, SourceLinker } from '../types.ts';

// ============================================================
// Test Fixtures
// ============================================================

function createTestFinalAnswer(overrides: Partial<FinalAnswer> = {}): FinalAnswer {
  return {
    originalQuery: 'What are the ISA 540 requirements for auditing accounting estimates?',
    synthesis: `## Executive Summary

ISA 540 establishes comprehensive requirements for auditing accounting estimates.
The standard requires auditors to assess risks (ISA 540.13) and evaluate management's process (ISA 540.18).

## Key Requirements

The auditor shall design and perform further audit procedures (ISA 540.13).
Documentation requirements are specified in ISA 230.8.

## Application to Fair Value

ISA 540 applies to fair value measurements (ISA 540.3).`,
    citations: [
      { sourceRef: 'ISA 540.13', claim: 'The auditor shall design and perform further audit procedures', verified: true, matchLevel: 'exact' },
      { sourceRef: 'ISA 540.18', claim: 'The auditor shall evaluate management estimation process', verified: true, matchLevel: 'partial' },
      { sourceRef: 'ISA 230.8', claim: 'Documentation of audit procedures', verified: false, matchLevel: 'not_found', errorCategory: 'NOT_FOUND' },
    ],
    verificationScores: {
      entity_grounding: { score: 0.92, passed: true },
      citation_accuracy: { score: 0.88, passed: true },
      relation_preservation: { score: 0.75, passed: true },
      contradictions: { count: 0, passed: true },
    },
    sourceTexts: {
      'ISA 540.13': 'The auditor shall design and perform further audit procedures whose nature, timing and extent are responsive to the assessed risks of material misstatement.',
      'ISA 540.18': 'The auditor shall evaluate, based on the audit procedures performed and the audit evidence obtained, whether the accounting estimates are reasonable.',
    },
    subQueries: [
      { query: 'ISA 540 requirements for auditing estimates', role: 'primary', standards: ['ISA 540'], paragraphsFound: 15 },
      { query: 'ISA 500 audit evidence requirements', role: 'supporting', standards: ['ISA 500'], paragraphsFound: 8 },
      { query: 'ISA 230 documentation requirements', role: 'context', standards: ['ISA 230'], paragraphsFound: 3 },
    ],
    depthMode: 'standard',
    ...overrides,
  };
}

function createTestConfig(): RenderConfig {
  return mergeRenderConfig({
    renderer: { type: 'research', version: '1.0' },
    titleTemplate: 'ISA Research',
    citationFormat: 'ISA {number}.{paragraph}',
    citationRegex: '\\(ISA \\d{3}(?:\\.\\d+)?(?:\\([a-z]\\))?(?:\\.A\\d+)?\\)',
    sourceDiscovery: { enabled: false, linkerType: 'noop' },
    files: { answerFile: 'isa-research-output.md' },
  });
}

function createTestLinker(): SourceLinker {
  return createSourceLinker('noop');
}

// ============================================================
// Tests
// ============================================================

describe('OutputRenderer', () => {
  describe('renderDocument', () => {
    it('should produce a document with all structural sections', () => {
      const fa = createTestFinalAnswer();
      const config = createTestConfig();
      const linker = createTestLinker();

      const doc = renderDocument(fa, config, linker);

      // Title
      assert.ok(doc.includes('# ISA Research'), 'should have title');

      // Original question
      assert.ok(doc.includes('## Original Question'), 'should have original question section');
      assert.ok(doc.includes('> What are the ISA 540'), 'should quote the original query');

      // Confidence
      assert.ok(doc.includes('Overall Confidence'), 'should have confidence qualifier');

      // Synthesis body
      assert.ok(doc.includes('## Executive Summary'), 'should include executive summary from synthesis');
      assert.ok(doc.includes('## Key Requirements'), 'should include key requirements section');

      // Verification summary
      assert.ok(doc.includes('## Verification Summary'), 'should have verification table');
      assert.ok(doc.includes('Entity Grounding'), 'should list EG axis');
      assert.ok(doc.includes('Citation Accuracy'), 'should list CA axis');
      assert.ok(doc.includes('Relation Preservation'), 'should list RP axis');
      assert.ok(doc.includes('Contradictions'), 'should list CD axis');

      // Citations table
      assert.ok(doc.includes('## Citations Used'), 'should have citations table');
      assert.ok(doc.includes('ISA 540.13'), 'should list ISA 540.13 citation');
      assert.ok(doc.includes('[OK]'), 'should show verified status');
      assert.ok(doc.includes('[FAIL]'), 'should show failed status');

      // Research decomposition
      assert.ok(doc.includes('Research Decomposition'), 'should have decomposition appendix');
    });

    it('should show high confidence for scores >= 0.85', () => {
      const fa = createTestFinalAnswer({
        verificationScores: {
          entity_grounding: { score: 0.95, passed: true },
          citation_accuracy: { score: 0.90, passed: true },
          relation_preservation: { score: 0.88, passed: true },
          contradictions: { count: 0, passed: true },
        },
      });
      const doc = renderDocument(fa, createTestConfig(), createTestLinker());
      assert.ok(doc.includes('High'), 'should show High confidence');
    });

    it('should show medium confidence for scores 0.70-0.84', () => {
      const fa = createTestFinalAnswer({
        verificationScores: {
          entity_grounding: { score: 0.80, passed: true },
          citation_accuracy: { score: 0.75, passed: true },
          relation_preservation: { score: 0.72, passed: true },
          contradictions: { count: 0, passed: true },
        },
      });
      const doc = renderDocument(fa, createTestConfig(), createTestLinker());
      assert.ok(doc.includes('Medium'), 'should show Medium confidence');
    });

    it('should show low confidence for scores < 0.70', () => {
      const fa = createTestFinalAnswer({
        verificationScores: {
          entity_grounding: { score: 0.50, passed: false },
          citation_accuracy: { score: 0.40, passed: false },
          relation_preservation: { score: 0.30, passed: false },
          contradictions: { count: 2, passed: false },
        },
      });
      const doc = renderDocument(fa, createTestConfig(), createTestLinker());
      assert.ok(doc.includes('Low'), 'should show Low confidence');
    });

    it('should include out-of-scope notes when present', () => {
      const fa = createTestFinalAnswer({
        outOfScopeNotes: 'IFRS 13 fair value measurement is outside ISA scope.',
      });
      const doc = renderDocument(fa, createTestConfig(), createTestLinker());
      assert.ok(doc.includes('## Out of Scope'), 'should have out-of-scope section');
      assert.ok(doc.includes('IFRS 13'), 'should include the note content');
    });

    it('should handle empty citations gracefully', () => {
      const fa = createTestFinalAnswer({ citations: [] });
      const doc = renderDocument(fa, createTestConfig(), createTestLinker());
      assert.ok(doc.includes('No citations'), 'should show no citations message');
    });

    it('should include web references when present', () => {
      const fa = createTestFinalAnswer({
        webReferences: [
          { url: 'https://ifac.org/guide', title: 'IFAC Guide', insight: 'Key guidance on ISA 540', sourceType: 'standard-setting' },
        ],
      });
      const config = createTestConfig();
      const doc = renderDocument(fa, config, createTestLinker());
      assert.ok(doc.includes('External'), 'should have external references section');
      assert.ok(doc.includes('IFAC Guide'), 'should include reference title');
      assert.ok(doc.includes('https://ifac.org/guide'), 'should include URL');
    });

    it('should include prior research references for follow-ups', () => {
      const fa = createTestFinalAnswer({
        followupNumber: 2,
        priorSections: [
          { sectionNum: 2, heading: 'Risk Assessment Framework', excerpt: 'ISA 315 establishes the foundation for risk assessment...' },
        ],
      });
      const config = createTestConfig();
      const doc = renderDocument(fa, config, createTestLinker());
      assert.ok(doc.includes('Prior Research'), 'should have prior research section');
      assert.ok(doc.includes('[P2]'), 'should use P# notation');
      assert.ok(doc.includes('Risk Assessment Framework'), 'should include section heading');
    });

    it('should use follow-up title template for follow-up queries', () => {
      const fa = createTestFinalAnswer({ followupNumber: 3 });
      const config = mergeRenderConfig({
        titleTemplate: 'ISA Research',
        followupTitleTemplate: 'ISA Research Follow-Up #{n}',
      });
      const doc = renderDocument(fa, config, createTestLinker());
      assert.ok(doc.includes('# ISA Research Follow-Up #3'), 'should use follow-up title with number');
    });

    it('should include metadata header with depth, sub-queries, citations', () => {
      const fa = createTestFinalAnswer();
      const doc = renderDocument(fa, createTestConfig(), createTestLinker());
      assert.ok(doc.includes('**Depth Mode:** standard'), 'should show depth mode');
      assert.ok(doc.includes('**Sub-queries:** 3'), 'should show sub-query count');
      assert.ok(doc.includes('**Citations:** 3'), 'should show citation count');
    });
  });

  describe('injectSourceBlocks', () => {
    // Old regex requiring parens (for backwards compat tests)
    const parenCitationRegex = '\\(ISA \\d{3}(?:\\.\\d+)?(?:\\([a-z]\\))?\\)';
    // New regex with optional parens (matches real ISA config)
    const citationRegex = '(?:\\()?ISA \\d{3}(?:\\.\\d+)?(?:\\([a-z]\\))?(?:\\.A\\d+)?(?:\\))?';

    it('should inject source blocks for citations with parentheses', () => {
      const section = '## Requirements\n\nThe auditor must assess risks (ISA 540.13) and evaluate estimates (ISA 540.18).';
      const sourceTexts = {
        'ISA 540.13': 'The auditor shall design and perform further audit procedures.',
        'ISA 540.18': 'The auditor shall evaluate accounting estimates.',
      };

      const result = injectSourceBlocks(section, sourceTexts, parenCitationRegex);
      assert.ok(result.includes('> **Sources**'), 'should add Sources blockquote');
      assert.ok(result.includes('ISA 540.13'), 'should include first ref');
      assert.ok(result.includes('ISA 540.18'), 'should include second ref');
      assert.ok(result.includes('The auditor shall design'), 'should include source text');
    });

    it('should inject source blocks for citations WITHOUT parentheses', () => {
      const section = '## Requirements\n\nISA 540.13 requires the auditor to assess risks. Per ISA 540.18, the auditor evaluates estimates.';
      const sourceTexts = {
        'ISA 540.13': 'The auditor shall design and perform further audit procedures.',
        'ISA 540.18': 'The auditor shall evaluate accounting estimates.',
      };

      const result = injectSourceBlocks(section, sourceTexts, citationRegex);
      assert.ok(result.includes('> **Sources**'), 'should add Sources blockquote for bare citations');
      assert.ok(result.includes('The auditor shall design'), 'should include first source text');
      assert.ok(result.includes('The auditor shall evaluate'), 'should include second source text');
    });

    it('should inject source blocks for application material refs like ISA 540.A42', () => {
      const section = '## Application\n\nISA 540.A42 defines significant assumptions. ISA 540.A49 covers disclosure requirements.';
      const sourceTexts = {
        'ISA 540.A42': 'Assumptions used in making an accounting estimate are referred to as significant.',
        'ISA 540.A49': 'In some cases, the applicable financial reporting framework may require specific disclosures.',
      };

      const result = injectSourceBlocks(section, sourceTexts, citationRegex);
      assert.ok(result.includes('> **Sources**'), 'should add Sources blockquote for .A refs');
      assert.ok(result.includes('significant'), 'should include A42 source text');
      assert.ok(result.includes('specific disclosures'), 'should include A49 source text');
    });

    it('should not inject source blocks when no citations match', () => {
      const section = '## Overview\n\nGeneral introduction with no specific citations.';
      const sourceTexts = { 'ISA 540.13': 'some text' };

      const result = injectSourceBlocks(section, sourceTexts, citationRegex);
      assert.strictEqual(result, section, 'should return section unchanged');
    });

    it('should skip citations with missing source texts', () => {
      const section = '## Test\n\nCite (ISA 540.13) and (ISA 315.12).';
      const sourceTexts = {
        'ISA 540.13': 'Actual paragraph text.',
        // ISA 315.12 intentionally missing
      };

      const result = injectSourceBlocks(section, sourceTexts, parenCitationRegex);
      assert.ok(result.includes('> **Sources**'), 'should have sources block');
      assert.ok(result.includes('Actual paragraph text'), 'should include text for found ref');
      // The source block should only contain entries for refs with source text
      const sourceBlock = result.split('> **Sources**')[1] ?? '';
      assert.ok(sourceBlock.includes('ISA 540.13'), 'source block should include ref with text');
      assert.ok(!sourceBlock.includes('ISA 315.12'), 'source block should NOT include ref without text');
    });

    it('should deduplicate repeated citations in same section', () => {
      const section = '## Test\n\nFirst mention ISA 540.13. Second mention ISA 540.13.';
      const sourceTexts = {
        'ISA 540.13': 'The auditor shall design audit procedures.',
      };

      const result = injectSourceBlocks(section, sourceTexts, citationRegex);
      const matches = result.match(/ISA 540\.13.*auditor/g);
      // Should only appear once in the source block (deduplicated)
      assert.strictEqual(matches?.length, 1, 'should deduplicate repeated refs');
    });

    it('should handle mixed parenthesized and bare citations in same section', () => {
      const section = '## Mixed\n\nISA 540.13 states requirements. Per (ISA 540.18), the evaluation is key.';
      const sourceTexts = {
        'ISA 540.13': 'Design further audit procedures.',
        'ISA 540.18': 'Evaluate accounting estimates.',
      };

      const result = injectSourceBlocks(section, sourceTexts, citationRegex);
      assert.ok(result.includes('> **Sources**'), 'should add Sources blockquote');
      assert.ok(result.includes('Design further'), 'should include ISA 540.13 source text');
      assert.ok(result.includes('Evaluate accounting'), 'should include ISA 540.18 source text');
    });
  });

  describe('SourceLinker', () => {
    it('noop linker should return references as-is', () => {
      const linker = createSourceLinker('noop');
      assert.strictEqual(linker.linkifyRef('ISA 540.13'), 'ISA 540.13');
      assert.strictEqual(linker.extractIdentifier('ISA 540.13'), null);
      assert.deepStrictEqual(linker.getSourceFileMap(), {});
    });

    it('ISA PDF linker should produce markdown links when files exist', () => {
      const linker = createSourceLinker('isa-pdf', {
        linkBase: '../staging/pdf/',
        fileList: [
          'ISA 540 - Auditing Accounting Estimates.pdf',
          'ISA 315 - Identifying Risks.pdf',
        ],
      });

      const linked = linker.linkifyRef('ISA 540.13');
      assert.ok(linked.startsWith('[ISA 540.13]('), 'should create markdown link');
      assert.ok(linked.includes('../staging/pdf/'), 'should use link base');
      assert.ok(linked.includes('ISA%20540'), 'should URL-encode filename');
    });

    it('ISA PDF linker should return plain text when no matching file', () => {
      const linker = createSourceLinker('isa-pdf', {
        linkBase: '../staging/pdf/',
        fileList: ['ISA 540 - Estimates.pdf'],
      });

      const linked = linker.linkifyRef('ISA 999.1');
      assert.strictEqual(linked, 'ISA 999.1', 'should return plain text for unmatched ISA');
    });

    it('ISA PDF linker should extract ISA number from refs', () => {
      const linker = createSourceLinker('isa-pdf', {
        fileList: ['ISA 540 - Test.pdf'],
      });

      assert.strictEqual(linker.extractIdentifier('ISA 540.13'), '540');
      assert.strictEqual(linker.extractIdentifier('ISA 540.13(a)'), '540');
      assert.strictEqual(linker.extractIdentifier('ISA 315.12'), '315');
      assert.strictEqual(linker.extractIdentifier('some random text'), null);
    });

    it('ISA PDF linker should build file map from file list', () => {
      const linker = createSourceLinker('isa-pdf', {
        fileList: [
          'ISA 540 - Estimates.pdf',
          'ISA 315 - Risks.pdf',
          'README.txt',
        ],
      });

      const map = linker.getSourceFileMap();
      assert.strictEqual(map['540'], 'ISA 540 - Estimates.pdf');
      assert.strictEqual(map['315'], 'ISA 315 - Risks.pdf');
      assert.strictEqual(Object.keys(map).length, 2, 'should only include PDF files with ISA pattern');
    });
  });

  describe('Config Merging', () => {
    it('should produce complete config from defaults alone', () => {
      const config = mergeRenderConfig(null);
      assert.ok(config.renderer.type, 'should have renderer type');
      assert.ok(config.titleTemplate, 'should have title template');
      assert.ok(config.files.answerFile, 'should have answer file name');
      assert.ok(config.confidence.qualifierThresholds.high, 'should have thresholds');
    });

    it('should merge agent config over defaults', () => {
      const config = mergeRenderConfig({
        titleTemplate: 'ISA Research',
        citationRegex: '\\(ISA \\d{3}\\)',
      });
      assert.strictEqual(config.titleTemplate, 'ISA Research');
      assert.strictEqual(config.citationRegex, '\\(ISA \\d{3}\\)');
      // Defaults should be preserved for unset fields
      assert.ok(config.files.answerFile, 'should keep default answerFile');
    });

    it('should merge runtime overrides over agent config', () => {
      const config = mergeRenderConfig(
        { titleTemplate: 'ISA Research' },
        { titleTemplate: 'Custom Title' },
      );
      assert.strictEqual(config.titleTemplate, 'Custom Title', 'runtime should override agent config');
    });

    it('should deep merge nested objects', () => {
      const config = mergeRenderConfig({
        confidence: { qualifierThresholds: { high: 0.90 } },
      } as Partial<RenderConfig>);
      assert.strictEqual(config.confidence.qualifierThresholds.high, 0.90, 'should override nested high threshold');
      assert.strictEqual(config.confidence.qualifierThresholds.medium, 0.70, 'should keep default medium threshold');
    });
  });
});
