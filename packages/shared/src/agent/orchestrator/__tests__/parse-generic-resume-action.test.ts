/**
 * Tests for parseGenericResumeAction() — resume intent parsing for amend/cancel/proceed.
 *
 * Verifies:
 * - F5 guard: undefined/empty pauseChoices always returns 'proceed'
 * - Numeric choice matching (1/2/3)
 * - Keyword matching (proceed/amend/cancel families)
 * - Default behavior on ambiguous input
 * - ISA agent regression (no pauseChoices → always proceed)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseGenericResumeAction } from '../index.ts';

describe('parseGenericResumeAction()', () => {

  describe('F5 guard — no pauseChoices', () => {
    it('undefined pauseChoices → proceed', () => {
      assert.equal(parseGenericResumeAction('cancel everything', undefined), 'proceed');
    });

    it('empty pauseChoices → proceed', () => {
      assert.equal(parseGenericResumeAction('amend this', []), 'proceed');
    });

    it('ISA agent regression: "amend" without pauseChoices → proceed', () => {
      assert.equal(parseGenericResumeAction('amend', undefined), 'proceed');
    });
  });

  const choices = ['Proceed — scope looks correct', 'Amend — adjust scope', 'Cancel — abandon'];

  describe('numeric choice matching', () => {
    it('"1" → proceed', () => {
      assert.equal(parseGenericResumeAction('1', choices), 'proceed');
    });

    it('"1." → proceed', () => {
      assert.equal(parseGenericResumeAction('1.', choices), 'proceed');
    });

    it('"2" → amend', () => {
      assert.equal(parseGenericResumeAction('2', choices), 'amend');
    });

    it('"2." → amend', () => {
      assert.equal(parseGenericResumeAction('2.', choices), 'amend');
    });

    it('"3" → cancel', () => {
      assert.equal(parseGenericResumeAction('3', choices), 'cancel');
    });

    it('"3." → cancel', () => {
      assert.equal(parseGenericResumeAction('3.', choices), 'cancel');
    });
  });

  describe('keyword matching — proceed', () => {
    it('"looks good" → proceed', () => {
      assert.equal(parseGenericResumeAction('looks good', choices), 'proceed');
    });

    it('"yes" → proceed', () => {
      assert.equal(parseGenericResumeAction('yes', choices), 'proceed');
    });

    it('"approve" → proceed', () => {
      assert.equal(parseGenericResumeAction('approve', choices), 'proceed');
    });

    it('"lgtm" → proceed', () => {
      assert.equal(parseGenericResumeAction('lgtm', choices), 'proceed');
    });

    it('"ok" → proceed', () => {
      assert.equal(parseGenericResumeAction('ok', choices), 'proceed');
    });
  });

  describe('keyword matching — amend', () => {
    it('"amend this" → amend', () => {
      assert.equal(parseGenericResumeAction('amend this', choices), 'amend');
    });

    it('"I want to adjust the scope" → amend', () => {
      assert.equal(parseGenericResumeAction('I want to adjust the scope', choices), 'amend');
    });

    it('"please modify the plan" → amend', () => {
      assert.equal(parseGenericResumeAction('please modify the plan', choices), 'amend');
    });

    it('"change the approach" → amend', () => {
      assert.equal(parseGenericResumeAction('change the approach', choices), 'amend');
    });
  });

  describe('keyword matching — cancel', () => {
    it('"cancel" → cancel', () => {
      assert.equal(parseGenericResumeAction('cancel', choices), 'cancel');
    });

    it('"abort this" → cancel', () => {
      assert.equal(parseGenericResumeAction('abort this', choices), 'cancel');
    });

    it('"stop" → cancel', () => {
      assert.equal(parseGenericResumeAction('stop', choices), 'cancel');
    });

    it('"quit" → cancel', () => {
      assert.equal(parseGenericResumeAction('quit', choices), 'cancel');
    });
  });

  describe('default behavior — ambiguous input', () => {
    it('random text → proceed (conservative default)', () => {
      assert.equal(parseGenericResumeAction('the weather is nice today', choices), 'proceed');
    });

    it('empty string → proceed', () => {
      assert.equal(parseGenericResumeAction('', choices), 'proceed');
    });
  });
});
