/**
 * Tests for isBreakoutIntent() and classifyBreakoutResponse()
 * — Pipeline Breakout Detection and Confirmation Gate.
 *
 * Verifies that:
 * - Explicit breakout keywords are detected
 * - Normal resume messages are NOT detected as breakout
 * - Trimmed Tier 2 patterns are no longer detected
 * - Case-insensitivity works
 * - Partial matches within sentences work
 * - classifyBreakoutResponse() correctly distinguishes confirm/deny/implicit
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isBreakoutIntent, classifyBreakoutResponse } from '../../claude-agent.ts';

// =============================================================================
// isBreakoutIntent()
// =============================================================================

describe('isBreakoutIntent()', () => {
  describe('should detect explicit breakout keywords', () => {
    const breakoutMessages = [
      // Tier 1: Explicit pipeline commands
      'break out',
      'Break Out',
      'BREAK OUT',
      'breakout',
      'I want to breakout of this pipeline',
      'exit pipeline',
      'exit agent',
      'stop pipeline',
      'stop agent',
      'cancel pipeline',
      'cancel agent',
      'forget the pipeline',
      'skip pipeline',
      'leave pipeline',
      'abandon pipeline',
      'quit pipeline',
      'Please break out and let me ask something else',
      'Can you exit pipeline? I want to discuss something different',
      // Tier 2: Natural language breakout signals (retained)
      'I want to do something else',
      'something else - just tell me about the weather',
      'I have a different question',
      'different topic please',
      "let's change topic",
      'change the topic',
      'new question',
      'I have a new question',
      'new topic - what is the GDP of France?',
      'never mind',
      'nevermind',
      'forget it',
      'I changed my mind',
      'something different entirely',
      'I want to do something else - just tell me what the weather in zurich is today',
    ];

    for (const msg of breakoutMessages) {
      it(`should detect: "${msg}"`, () => {
        assert.equal(isBreakoutIntent(msg), true, `Expected breakout for: "${msg}"`);
      });
    }
  });

  describe('should NOT detect normal resume messages', () => {
    const resumeMessages = [
      'proceed',
      'continue',
      'yes',
      'go ahead',
      'looks good, continue',
      'Please continue with the analysis',
      'I want more details on section 3',
      'Can you re-check citation 5?',
      'Add more citations',
      'The results look incomplete',
      'What about safety valves?',
      '',
      '   ',
      'hello',
      'thanks',
      'tell me more',
      'Explain the verification scores',
      'yes, start retrieval',
      'proceed with the refined plan',
      'modify the queries',
      'add ISA 700 to the plan',
    ];

    for (const msg of resumeMessages) {
      it(`should NOT detect: "${msg}"`, () => {
        assert.equal(isBreakoutIntent(msg), false, `Expected no breakout for: "${msg}"`);
      });
    }
  });

  describe('trimmed Tier 2 patterns should NOT match', () => {
    // These patterns were removed in the confirmation gate update
    // because they match too many resume-intent messages
    const trimmedPatterns = [
      'I want to ask about the results',
      'I want to do the search now',
      'instead can you re-check that citation?',
      'instead tell me more about section 2',
      'instead just proceed with the plan',
    ];

    for (const msg of trimmedPatterns) {
      it(`should NOT detect trimmed pattern: "${msg}"`, () => {
        assert.equal(isBreakoutIntent(msg), false, `Expected no breakout for trimmed: "${msg}"`);
      });
    }
  });

  describe('edge cases', () => {
    it('should handle whitespace-only input', () => {
      assert.equal(isBreakoutIntent('   '), false);
    });

    it('should handle empty string', () => {
      assert.equal(isBreakoutIntent(''), false);
    });

    it('should be case-insensitive', () => {
      assert.equal(isBreakoutIntent('BREAK OUT'), true);
      assert.equal(isBreakoutIntent('Break Out'), true);
      assert.equal(isBreakoutIntent('bReAk OuT'), true);
    });

    it('should trim whitespace before checking', () => {
      assert.equal(isBreakoutIntent('  break out  '), true);
      assert.equal(isBreakoutIntent('\tcancel pipeline\n'), true);
    });
  });

  describe('pause message option "3. Exit" handling (F9)', () => {
    it('should detect standalone "3" as breakout', () => {
      assert.equal(isBreakoutIntent('3'), true);
    });

    it('should detect "3." as breakout', () => {
      assert.equal(isBreakoutIntent('3.'), true);
    });

    it('should NOT detect "3" within longer text (substring safety)', () => {
      // "3" in context of a pipeline response should NOT trigger
      assert.equal(isBreakoutIntent('Check section 3 of the report'), false);
      assert.equal(isBreakoutIntent('Add ISA 315 to the plan'), false);
    });
  });
});

// =============================================================================
// classifyBreakoutResponse()
// =============================================================================

describe('classifyBreakoutResponse()', () => {
  describe('should classify explicit confirmations', () => {
    const confirmMessages = [
      'yes',
      'Yes',
      'YES',
      'yeah',
      'yep',
      'yup',
      'sure',
      'confirm',
      'quit',
      'leave',
      'exit',
      'terminate',
      'stop',
      'abort',
      'end it',
      'kill it',
      'close it',
      'cancel',                      // F4: moved from deny to confirm
      'cancel the pipeline',          // F4: "cancel" means exit during confirmation
      'sure, go ahead and quit',
      'yes please exit the pipeline',
    ];

    for (const msg of confirmMessages) {
      it(`should classify as confirm: "${msg}"`, () => {
        assert.equal(classifyBreakoutResponse(msg), 'confirm', `Expected confirm for: "${msg}"`);
      });
    }
  });

  describe('should classify explicit denials', () => {
    const denyMessages = [
      'no',
      'No',
      'NO',
      'nah',
      'nope',
      // 'cancel' removed — moved to confirm (F4)
      'stay',
      'keep going',
      'continue',
      'proceed',
      'resume',
      'go back',
      'go on',
      'carry on',
      'never mind',
      'forget i said that',
      'back to the research',
      'no, continue with the pipeline',
      'nope, keep going please',
    ];

    for (const msg of denyMessages) {
      it(`should classify as deny: "${msg}"`, () => {
        assert.equal(classifyBreakoutResponse(msg), 'deny', `Expected deny for: "${msg}"`);
      });
    }
  });

  describe('should classify implicit confirmations (neither confirm nor deny)', () => {
    const implicitMessages = [
      'What is the weather in Zurich?',
      'Tell me about cats',
      'How do I audit goodwill?',
      'random unrelated text',
      '42',
      'What is the meaning of life?',
      'Explain quantum physics',
      'hello world',
    ];

    for (const msg of implicitMessages) {
      it(`should classify as implicit_confirm: "${msg}"`, () => {
        assert.equal(classifyBreakoutResponse(msg), 'implicit_confirm', `Expected implicit_confirm for: "${msg}"`);
      });
    }
  });

  describe('denial takes priority over confirmation (semantic inversion)', () => {
    // When both deny and confirm patterns exist, denial wins.
    // This is correct: "no, continue" should stay in the pipeline.
    it('"yes, continue" should be deny (continue wins over yes)', () => {
      assert.equal(classifyBreakoutResponse('yes, continue'), 'deny');
    });

    it('"no, I mean yes quit" should be deny (no is checked first)', () => {
      assert.equal(classifyBreakoutResponse('no, I mean yes quit'), 'deny');
    });

    it('"proceed with exit" should be deny (proceed wins)', () => {
      assert.equal(classifyBreakoutResponse('proceed with exit'), 'deny');
    });
  });

  describe('edge cases', () => {
    it('should handle empty string as implicit_confirm', () => {
      assert.equal(classifyBreakoutResponse(''), 'implicit_confirm');
    });

    it('should handle whitespace-only as implicit_confirm', () => {
      assert.equal(classifyBreakoutResponse('   '), 'implicit_confirm');
    });

    it('should be case-insensitive', () => {
      assert.equal(classifyBreakoutResponse('YES'), 'confirm');
      assert.equal(classifyBreakoutResponse('NO'), 'deny');
      assert.equal(classifyBreakoutResponse('Keep Going'), 'deny');
    });

    it('should trim whitespace', () => {
      assert.equal(classifyBreakoutResponse('  yes  '), 'confirm');
      assert.equal(classifyBreakoutResponse('\tno\n'), 'deny');
    });

    it('"1" should be confirm (numeric option for "1. Yes") (F3)', () => {
      assert.equal(classifyBreakoutResponse('1'), 'confirm');
    });

    it('"1." should be confirm (numeric with period) (F3)', () => {
      assert.equal(classifyBreakoutResponse('1.'), 'confirm');
    });

    it('"2" should be deny (numeric option for "2. No") (F3)', () => {
      assert.equal(classifyBreakoutResponse('2'), 'deny');
    });

    it('"2." should be deny (numeric with period) (F3)', () => {
      assert.equal(classifyBreakoutResponse('2.'), 'deny');
    });

    it('"1" should not match inside longer text (exact match only)', () => {
      // "Stage 1 looks good" should NOT be classified as confirm
      assert.equal(classifyBreakoutResponse('Stage 1 looks good'), 'implicit_confirm');
    });

    it('"2" should not match inside longer text (exact match only)', () => {
      // "Check citation 2" should NOT be classified as deny
      assert.equal(classifyBreakoutResponse('Check citation 2'), 'implicit_confirm');
    });
  });
});
