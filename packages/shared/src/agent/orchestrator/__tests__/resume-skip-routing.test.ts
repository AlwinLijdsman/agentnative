/**
 * Tests for resume skip routing (Section 20 — F2, F3, F6).
 *
 * Verifies that:
 * - parseResumeIntent() correctly identifies skip patterns
 * - Default-to-run fallback works (F6)
 * - Only active at Stage 0→1 boundary
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseResumeIntent } from '../index.ts';

describe('parseResumeIntent', () => {
  // ── Skip patterns (pausedAtStage === 0) ──────────────────────────────

  it('"B. No — proceed directly" → skip', () => {
    const result = parseResumeIntent('B. No — proceed directly', 0);
    assert.equal(result.skipNextStage, true);
  });

  it('"b" → skip', () => {
    const result = parseResumeIntent('b', 0);
    assert.equal(result.skipNextStage, true);
  });

  it('"B" → skip', () => {
    const result = parseResumeIntent('B', 0);
    assert.equal(result.skipNextStage, true);
  });

  it('"b." → skip', () => {
    const result = parseResumeIntent('b.', 0);
    assert.equal(result.skipNextStage, true);
  });

  it('"no web search please" → skip', () => {
    const result = parseResumeIntent('no web search please', 0);
    assert.equal(result.skipNextStage, true);
  });

  it('"No websearch" → skip', () => {
    const result = parseResumeIntent('No websearch', 0);
    assert.equal(result.skipNextStage, true);
  });

  it('"skip web" → skip', () => {
    const result = parseResumeIntent('skip web', 0);
    assert.equal(result.skipNextStage, true);
  });

  it('"skip the web search" → skip', () => {
    const result = parseResumeIntent('skip the web search', 0);
    assert.equal(result.skipNextStage, true);
  });

  it('"proceed directly" → skip', () => {
    const result = parseResumeIntent('proceed directly', 0);
    assert.equal(result.skipNextStage, true);
  });

  it('"no, proceed" → skip', () => {
    const result = parseResumeIntent('no, proceed', 0);
    assert.equal(result.skipNextStage, true);
  });

  it('"no. proceed" → skip', () => {
    const result = parseResumeIntent('no. proceed', 0);
    assert.equal(result.skipNextStage, true);
  });

  it('"B. No" at start → skip', () => {
    const result = parseResumeIntent('B. No', 0);
    assert.equal(result.skipNextStage, true);
  });

  // ── Non-skip patterns (pausedAtStage === 0) ─────────────────────────

  it('"Yes search" → run (not skip)', () => {
    const result = parseResumeIntent('Yes search', 0);
    assert.equal(result.skipNextStage, false);
  });

  it('"A. Yes — search authoritative ISA sources" → run', () => {
    const result = parseResumeIntent('A. Yes — search authoritative ISA sources', 0);
    assert.equal(result.skipNextStage, false);
  });

  it('"proceed" alone → run (ambiguous, F6 safe default)', () => {
    const result = parseResumeIntent('proceed', 0);
    assert.equal(result.skipNextStage, false);
  });

  it('"yes" → run', () => {
    const result = parseResumeIntent('yes', 0);
    assert.equal(result.skipNextStage, false);
  });

  it('"1" → run', () => {
    const result = parseResumeIntent('1', 0);
    assert.equal(result.skipNextStage, false);
  });

  it('empty string → run', () => {
    const result = parseResumeIntent('', 0);
    assert.equal(result.skipNextStage, false);
  });

  // ── Wrong stage boundary ─────────────────────────────────────────────

  it('"No web search" at stage 1 → run (wrong boundary)', () => {
    const result = parseResumeIntent('No web search', 1);
    assert.equal(result.skipNextStage, false);
  });

  it('"B" at stage 1 → run (wrong boundary)', () => {
    const result = parseResumeIntent('B', 1);
    assert.equal(result.skipNextStage, false);
  });

  it('"skip web" at stage 2 → run (wrong boundary)', () => {
    const result = parseResumeIntent('skip web', 2);
    assert.equal(result.skipNextStage, false);
  });

  // ── Edge cases ───────────────────────────────────────────────────────

  it('whitespace-padded "  b  " → skip', () => {
    const result = parseResumeIntent('  b  ', 0);
    assert.equal(result.skipNextStage, true);
  });

  it('"B, no" at start → skip', () => {
    const result = parseResumeIntent('B, no', 0);
    assert.equal(result.skipNextStage, true);
  });
});
