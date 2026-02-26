/**
 * Blockquote Normalization — Tests (Section 19, Phase 5)
 *
 * Tests the normalizeOrphanedMarkers() function that handles orphaned
 * WEB_REF and PRIOR_REF markers appearing outside of blockquotes.
 *
 * Based on real pipeline data (bright-rose session) where the LLM placed
 * WEB_REF markers as standalone lines between sections.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeOrphanedMarkers } from '../agent-render-output/renderer.ts';

// ============================================================================
// normalizeOrphanedMarkers() Tests
// ============================================================================

describe('normalizeOrphanedMarkers', () => {
  it('moves orphaned WEB_REF into preceding Sources blockquote', () => {
    const input = [
      '## 1. Section One',
      '',
      'Some body text about insurance.',
      '',
      '> **Sources**',
      '>',
      '> ISA 540.13 — Evaluate assumptions',
      '',
      'WEB_REF|https://example.com|Key insight about insurance',
      '',
      '## 2. Section Two',
      '',
      'More text here.',
    ].join('\n');

    const result = normalizeOrphanedMarkers(input);

    // The orphaned WEB_REF should now be inside the Sources blockquote
    assert.ok(result.includes('> WEB_REF|https://example.com|Key insight'), 'WEB_REF should be in blockquote');
    // It should NOT appear as a standalone line anymore
    const lines = result.split('\n');
    const orphaned = lines.filter(l => l.startsWith('WEB_REF|'));
    assert.equal(orphaned.length, 0, 'No orphaned WEB_REF lines should remain');
  });

  it('moves multiple orphaned markers into preceding Sources blockquote', () => {
    const input = [
      '## 1. Section',
      '',
      'Body text.',
      '',
      '> **Sources**',
      '>',
      '> ISA 540.13 — Citation',
      '',
      'WEB_REF|https://a.com|Insight A',
      'WEB_REF|https://b.com|Insight B',
      'WEB_REF|https://c.com|Insight C',
      '',
      '## 2. Next Section',
    ].join('\n');

    const result = normalizeOrphanedMarkers(input);

    assert.ok(result.includes('> WEB_REF|https://a.com|Insight A'), 'First WEB_REF in blockquote');
    assert.ok(result.includes('> WEB_REF|https://b.com|Insight B'), 'Second WEB_REF in blockquote');
    assert.ok(result.includes('> WEB_REF|https://c.com|Insight C'), 'Third WEB_REF in blockquote');
  });

  it('moves orphaned PRIOR_REF into preceding Sources blockquote', () => {
    const input = [
      '## 1. Section',
      '',
      'Body text about risk assessment.',
      '',
      '> **Sources**',
      '>',
      '> ISA 315.5 — Risk assessment',
      '',
      'PRIOR_REF|P1|Prior Risk Assessment|Risk assessment procedures',
      '',
      '## 2. Next',
    ].join('\n');

    const result = normalizeOrphanedMarkers(input);

    assert.ok(result.includes('> PRIOR_REF|P1|'), 'PRIOR_REF should be in blockquote');
    const orphaned = result.split('\n').filter(l => l.startsWith('PRIOR_REF|'));
    assert.equal(orphaned.length, 0, 'No orphaned PRIOR_REF lines');
  });

  it('creates new Sources blockquote when none exists before orphaned markers', () => {
    const input = [
      '## 1. Section',
      '',
      'Body text.',
      '',
      'WEB_REF|https://example.com|Insight',
      '',
      '## 2. Next',
    ].join('\n');

    const result = normalizeOrphanedMarkers(input);

    assert.ok(result.includes('> **Sources**'), 'Should create Sources blockquote');
    assert.ok(result.includes('> WEB_REF|https://example.com|Insight'), 'WEB_REF in new blockquote');
  });

  it('leaves properly blockquoted markers untouched', () => {
    const input = [
      '## 1. Section',
      '',
      'Body text.',
      '',
      '> **Sources**',
      '>',
      '> ISA 540.13 — Citation',
      '> WEB_REF|https://example.com|Already in blockquote',
      '',
      '## 2. Next',
    ].join('\n');

    const result = normalizeOrphanedMarkers(input);

    // Should be identical — nothing to normalize
    assert.equal(result, input, 'Should not modify already-correct blockquoted markers');
  });

  it('handles text with no markers at all', () => {
    const input = [
      '## 1. Section',
      '',
      'Just regular body text.',
      '',
      '> **Sources**',
      '>',
      '> ISA 540.13 — Citation',
    ].join('\n');

    const result = normalizeOrphanedMarkers(input);
    assert.equal(result, input, 'Should not modify text without orphaned markers');
  });

  it('handles orphaned markers at end of text', () => {
    const input = [
      '## 1. Section',
      '',
      'Body text.',
      '',
      '> **Sources**',
      '>',
      '> ISA 540.13 — Citation',
      '',
      'WEB_REF|https://example.com|Trailing marker',
    ].join('\n');

    const result = normalizeOrphanedMarkers(input);

    assert.ok(result.includes('> WEB_REF|https://example.com|Trailing marker'), 'Trailing marker in blockquote');
    assert.ok(!result.split('\n').some(l => l === 'WEB_REF|https://example.com|Trailing marker'), 'No orphan');
  });

  it('handles mixed WEB_REF and PRIOR_REF orphaned markers', () => {
    const input = [
      '## 1. Section',
      '',
      'Body text.',
      '',
      '> **Sources**',
      '>',
      '> ISA 540.13',
      '',
      'PRIOR_REF|P1|Prior Study|Excerpt text',
      'WEB_REF|https://example.com|Web insight',
      '',
      '## 2. Next',
    ].join('\n');

    const result = normalizeOrphanedMarkers(input);

    assert.ok(result.includes('> PRIOR_REF|P1|'), 'PRIOR_REF in blockquote');
    assert.ok(result.includes('> WEB_REF|https://example.com|'), 'WEB_REF in blockquote');
  });
});
