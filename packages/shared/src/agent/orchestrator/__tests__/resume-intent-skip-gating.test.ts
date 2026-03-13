/**
 * Tests for parseResumeIntent() with nextStageName gating (F6 fix).
 *
 * Verifies that:
 * - Skip detection only fires when nextStageName === 'websearch_calibration'
 * - Dev-loop agents (nextStageName === 'plan') are never skipped
 * - Missing nextStageName defaults to no-skip
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseResumeIntent } from '../index.ts';

describe('parseResumeIntent() — nextStageName gating', () => {

  describe('ISA agent (nextStageName = websearch_calibration)', () => {
    it('"proceed directly" → skipNextStage: true', () => {
      const intent = parseResumeIntent('proceed directly', 0, 'websearch_calibration');
      assert.equal(intent.skipNextStage, true);
    });

    it('"skip web search" → skipNextStage: true', () => {
      const intent = parseResumeIntent('skip web search', 0, 'websearch_calibration');
      assert.equal(intent.skipNextStage, true);
    });

    it('"looks good" → skipNextStage: false (not a skip pattern)', () => {
      const intent = parseResumeIntent('looks good', 0, 'websearch_calibration');
      assert.equal(intent.skipNextStage, false);
    });
  });

  describe('dev-loop agent (nextStageName = plan)', () => {
    it('"proceed directly" → skipNextStage: false (skip gated to ISA)', () => {
      const intent = parseResumeIntent('proceed directly', 0, 'plan');
      assert.equal(intent.skipNextStage, false);
    });

    it('"skip web search" → skipNextStage: false', () => {
      const intent = parseResumeIntent('skip web search', 0, 'plan');
      assert.equal(intent.skipNextStage, false);
    });
  });

  describe('no nextStageName (backward compat)', () => {
    it('"proceed directly" → skipNextStage: false', () => {
      const intent = parseResumeIntent('proceed directly', 0, undefined);
      assert.equal(intent.skipNextStage, false);
    });

    it('"skip" → skipNextStage: false', () => {
      const intent = parseResumeIntent('skip', 0);
      assert.equal(intent.skipNextStage, false);
    });
  });

  describe('non-stage-0 pause', () => {
    it('pausedAtStage=3 with websearch_calibration → skipNextStage: false', () => {
      const intent = parseResumeIntent('proceed directly', 3, 'websearch_calibration');
      assert.equal(intent.skipNextStage, false);
    });
  });
});
