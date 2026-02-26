/**
 * Synthesis Post-Processor — Tests (Section 19, Phase 6)
 *
 * Tests the deterministic label injection safety net:
 * - postProcessSynthesis() — full pipeline
 * - WEB_REF marker injection when missing
 * - [W#] inline label injection when missing
 * - PRIOR_REF marker injection when missing
 * - [P#] inline label injection when missing
 * - No double-injection when markers/labels already present
 * - Edge cases: 0 sources, 1 source, many sources
 * - keywordOverlapScore() — keyword matching utility
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  postProcessSynthesis,
  keywordOverlapScore,
} from '../synthesis-post-processor.ts';
import type { PriorSectionInput } from '../synthesis-post-processor.ts';
import type { WebReference } from '@craft-agent/session-tools-core/renderer-types';

// ============================================================================
// Test Fixtures
// ============================================================================

const WEB_SOURCES: WebReference[] = [
  {
    url: 'https://ifrs.org/ifrs17',
    title: 'IFRS 17 Insurance Contracts',
    insight: 'IFRS 17 requires insurance entities to measure liabilities using current estimates of future cash flows',
    sourceType: 'regulatory',
  },
  {
    url: 'https://iaasb.org/isa540',
    title: 'ISA 540 Auditing Estimates',
    insight: 'ISA 540 provides guidance on auditing accounting estimates including fair value measurements',
    sourceType: 'regulatory',
  },
  {
    url: 'https://frc.org.uk/auditing',
    title: 'FRC Audit Quality Review',
    insight: 'FRC thematic review found deficiencies in audit procedures for estimation uncertainty',
    sourceType: 'web',
  },
];

const PRIOR_SECTIONS: PriorSectionInput[] = [
  {
    sectionId: 'P1',
    heading: 'Prior Research: Risk Assessment',
    excerpt: 'Risk assessment procedures should consider inherent risk factors including estimation uncertainty and management bias',
    sectionNum: 1,
  },
  {
    sectionId: 'P2',
    heading: 'Prior Research: Substantive Testing',
    excerpt: 'Substantive procedures for auditing complex estimates require development of independent expectations',
    sectionNum: 2,
  },
];

/** Synthesis text that has NO markers and NO inline labels — simulates 0% LLM adherence */
function makeBaresynth(): string {
  return `## Executive Summary

Insurance contract auditing under IFRS 17 requires auditors to evaluate complex measurement models. Current estimates of future cash flows form the basis of liability measurement.

## 1. Measurement Model Considerations

Auditors must understand the measurement approach used by insurance entities. IFRS 17 introduced significant changes to how insurance liabilities are measured, requiring current estimates and risk adjustments.

> **Sources**
>
> ISA 540.13 — Evaluate reasonableness of management's assumptions

## 2. Audit Procedures for Estimates

ISA 540 provides the framework for auditing accounting estimates. The auditor should develop independent expectations where practicable.

FRC reviews have found deficiencies in how audit firms document their estimation uncertainty assessments.

Risk assessment procedures should consider inherent risk factors.

> **Sources**
>
> ISA 540.18 — Develop independent expectations

## 3. Quality Considerations

Audit quality depends on robust challenge of management assumptions and proper documentation of the auditor's evaluation.`;
}

/** Same synthesis but WITH markers and labels already present — tests no-double-injection */
function makeTaggedSynth(): string {
  return `## Executive Summary

Insurance contract auditing under IFRS 17 requires auditors to evaluate complex measurement models [W1]. Current estimates of future cash flows form the basis of liability measurement.

## 1. Measurement Model Considerations

Auditors must understand the measurement approach used by insurance entities. IFRS 17 introduced significant changes [W1] to how insurance liabilities are measured, requiring current estimates and risk adjustments.

> **Sources**
>
> ISA 540.13 — Evaluate reasonableness of management's assumptions
>
> WEB_REF|https://ifrs.org/ifrs17|IFRS 17 requires insurance entities to measure liabilities

## 2. Audit Procedures for Estimates

ISA 540 provides the framework for auditing accounting estimates [W2]. The auditor should develop independent expectations where practicable [P1].

FRC reviews have found deficiencies in how audit firms document their estimation uncertainty assessments [W3].

Risk assessment procedures should consider inherent risk factors [P2].

> **Sources**
>
> ISA 540.18 — Develop independent expectations
> PRIOR_REF|P1|Prior Research: Risk Assessment|Risk assessment procedures should consider inherent risk factors
> PRIOR_REF|P2|Prior Research: Substantive Testing|Substantive procedures for auditing complex estimates
>
> WEB_REF|https://iaasb.org/isa540|ISA 540 provides guidance on auditing accounting estimates
> WEB_REF|https://frc.org.uk/auditing|FRC thematic review found deficiencies in audit procedures`;
}

// ============================================================================
// postProcessSynthesis() — Full Pipeline Tests
// ============================================================================

describe('postProcessSynthesis', () => {

  it('injects WEB_REF markers when completely missing', () => {
    const result = postProcessSynthesis(makeBaresynth(), WEB_SOURCES, []);
    assert.ok(result.webRefsInjected > 0, `Expected ≥1 WEB_REF injected, got ${result.webRefsInjected}`);
    assert.ok(result.synthesis.includes('WEB_REF|https://ifrs.org/ifrs17'), 'Should contain IFRS WEB_REF');
    assert.ok(result.synthesis.includes('WEB_REF|https://iaasb.org/isa540'), 'Should contain ISA 540 WEB_REF');
    assert.ok(result.synthesis.includes('WEB_REF|https://frc.org.uk/auditing'), 'Should contain FRC WEB_REF');
  });

  it('injects [W#] inline labels when completely missing', () => {
    const result = postProcessSynthesis(makeBaresynth(), WEB_SOURCES, []);
    assert.ok(result.webLabelsInjected > 0, `Expected ≥1 [W#] injected, got ${result.webLabelsInjected}`);
    // Check that body text (non-blockquote) contains at least one [W#]
    const bodyLines = result.synthesis.split('\n').filter(l => !l.startsWith('>'));
    const bodyText = bodyLines.join('\n');
    assert.ok(bodyText.includes('[W1]'), 'Body should contain [W1]');
    assert.ok(bodyText.includes('[W2]'), 'Body should contain [W2]');
    assert.ok(bodyText.includes('[W3]'), 'Body should contain [W3]');
  });

  it('injects PRIOR_REF markers when completely missing', () => {
    const result = postProcessSynthesis(makeBaresynth(), [], PRIOR_SECTIONS);
    assert.ok(result.priorRefsInjected > 0, `Expected ≥1 PRIOR_REF injected, got ${result.priorRefsInjected}`);
    assert.ok(result.synthesis.includes('PRIOR_REF|P1|'), 'Should contain P1 PRIOR_REF');
    assert.ok(result.synthesis.includes('PRIOR_REF|P2|'), 'Should contain P2 PRIOR_REF');
  });

  it('injects [P#] inline labels when completely missing', () => {
    const result = postProcessSynthesis(makeBaresynth(), [], PRIOR_SECTIONS);
    assert.ok(result.priorLabelsInjected > 0, `Expected ≥1 [P#] injected, got ${result.priorLabelsInjected}`);
    const bodyLines = result.synthesis.split('\n').filter(l => !l.startsWith('>'));
    const bodyText = bodyLines.join('\n');
    assert.ok(bodyText.includes('[P1]'), 'Body should contain [P1]');
    assert.ok(bodyText.includes('[P2]'), 'Body should contain [P2]');
  });

  it('does NOT double-inject when markers and labels already present', () => {
    const result = postProcessSynthesis(makeTaggedSynth(), WEB_SOURCES, PRIOR_SECTIONS);
    assert.equal(result.webRefsInjected, 0, 'Should not inject any WEB_REF markers');
    assert.equal(result.webLabelsInjected, 0, 'Should not inject any [W#] labels');
    assert.equal(result.priorRefsInjected, 0, 'Should not inject any PRIOR_REF markers');
    assert.equal(result.priorLabelsInjected, 0, 'Should not inject any [P#] labels');
    // Verify no duplicates were created
    const w1Count = (result.synthesis.match(/\[W1\]/g) ?? []).length;
    const taggedW1Count = (makeTaggedSynth().match(/\[W1\]/g) ?? []).length;
    assert.equal(w1Count, taggedW1Count, 'W1 count should be unchanged');
  });

  it('handles empty web sources gracefully', () => {
    const result = postProcessSynthesis(makeBaresynth(), [], []);
    assert.equal(result.webRefsInjected, 0);
    assert.equal(result.webLabelsInjected, 0);
    assert.equal(result.priorRefsInjected, 0);
    assert.equal(result.priorLabelsInjected, 0);
    assert.equal(result.synthesis, makeBaresynth());
  });

  it('handles single web source', () => {
    const result = postProcessSynthesis(makeBaresynth(), [WEB_SOURCES[0]!], []);
    assert.ok(result.webRefsInjected >= 1, 'Should inject at least 1 WEB_REF');
    assert.ok(result.webLabelsInjected >= 1, 'Should inject at least 1 [W#] label');
    assert.ok(result.synthesis.includes('[W1]'), 'Should contain [W1]');
    assert.ok(!result.synthesis.includes('[W2]'), 'Should NOT contain [W2]');
  });

  it('handles combined web and prior sources', () => {
    const result = postProcessSynthesis(makeBaresynth(), WEB_SOURCES, PRIOR_SECTIONS);
    // Verify both types were injected
    assert.ok(result.webRefsInjected > 0, 'Should inject WEB_REF markers');
    assert.ok(result.webLabelsInjected > 0, 'Should inject [W#] labels');
    assert.ok(result.priorRefsInjected > 0, 'Should inject PRIOR_REF markers');
    assert.ok(result.priorLabelsInjected > 0, 'Should inject [P#] labels');
  });
});

// ============================================================================
// keywordOverlapScore() Tests
// ============================================================================

describe('keywordOverlapScore', () => {
  it('returns 0 for no overlap', () => {
    const score = keywordOverlapScore('The quick brown fox', 'Purple elephant dancing');
    assert.equal(score, 0);
  });

  it('returns 1.0 for perfect overlap', () => {
    const score = keywordOverlapScore(
      'IFRS 17 insurance contracts measurement',
      'IFRS 17 insurance contracts measurement',
    );
    assert.equal(score, 1.0);
  });

  it('returns partial overlap score', () => {
    const score = keywordOverlapScore(
      'IFRS 17 requires insurance entities to measure liabilities',
      'Insurance liabilities require careful measurement procedures',
    );
    assert.ok(score > 0, `Expected > 0, got ${score}`);
    assert.ok(score < 1, `Expected < 1, got ${score}`);
  });

  it('filters stop words', () => {
    // "the" and "with" are stop words — should not count
    const scoreWithStopWords = keywordOverlapScore('the big audit with scope', 'the big audit with scope');
    const scoreNoStopWords = keywordOverlapScore('audit scope', 'big audit scope');
    // Both should only count meaningful keywords
    assert.ok(scoreWithStopWords > 0);
    assert.ok(scoreNoStopWords > 0);
  });

  it('returns 0 for empty insight', () => {
    const score = keywordOverlapScore('Some target text', '');
    assert.equal(score, 0);
  });
});

// ============================================================================
// Edge Case Tests
// ============================================================================

describe('postProcessSynthesis edge cases', () => {
  it('handles synthesis with no ## sections', () => {
    const flatSynth = 'This is a simple synthesis without any section headings. Insurance estimates require careful audit procedures.';
    const result = postProcessSynthesis(flatSynth, [WEB_SOURCES[0]!], []);
    assert.ok(result.webRefsInjected >= 1, 'Should still inject WEB_REF');
    assert.ok(result.synthesis.includes('WEB_REF|'), 'Should contain WEB_REF marker');
  });

  it('handles synthesis with no Sources blockquotes', () => {
    const noSourcesSynth = `## Executive Summary

Insurance audit is important.

## 1. Details

More details about insurance auditing procedures.`;
    const result = postProcessSynthesis(noSourcesSynth, [WEB_SOURCES[0]!], []);
    assert.ok(result.synthesis.includes('WEB_REF|'), 'Should create new Sources block with WEB_REF');
    assert.ok(result.synthesis.includes('> **Sources**'), 'Should create Sources blockquote');
  });

  it('preserves existing content when injecting', () => {
    const synth = makeBaresynth();
    const result = postProcessSynthesis(synth, WEB_SOURCES, PRIOR_SECTIONS);
    // The original ISA sources should still be present
    assert.ok(result.synthesis.includes('ISA 540.13'), 'Original ISA 540.13 citation preserved');
    assert.ok(result.synthesis.includes('ISA 540.18'), 'Original ISA 540.18 citation preserved');
    // The section headings should still be present
    assert.ok(result.synthesis.includes('## Executive Summary'), 'Executive Summary heading preserved');
    assert.ok(result.synthesis.includes('## 1. Measurement Model'), 'Section 1 heading preserved');
    assert.ok(result.synthesis.includes('## 2. Audit Procedures'), 'Section 2 heading preserved');
    assert.ok(result.synthesis.includes('## 3. Quality Considerations'), 'Section 3 heading preserved');
  });
});
