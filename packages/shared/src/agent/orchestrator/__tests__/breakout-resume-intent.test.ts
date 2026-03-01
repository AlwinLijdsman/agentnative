/**
 * Tests for classifyBreakoutResumeResponse() and classifyResumeIntent()
 * — Resume-from-breakout intent classification.
 *
 * Verifies that:
 * - Numeric "1" / "2" responses are correctly classified
 * - Resume/fresh-start keywords are detected
 * - Free-form resume intent is detected from agent re-invocation messages
 * - Fresh-start intent is detected from natural language
 * - Ambiguous messages return 'unclear'
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyBreakoutResumeResponse,
  classifyResumeIntent,
} from '../../claude-agent.ts';

// =============================================================================
// classifyBreakoutResumeResponse()
// =============================================================================

describe('classifyBreakoutResumeResponse()', () => {
  describe('numeric responses', () => {
    it('"1" → resume', () => {
      assert.equal(classifyBreakoutResumeResponse('1'), 'resume');
    });

    it('"1." → resume', () => {
      assert.equal(classifyBreakoutResumeResponse('1.'), 'resume');
    });

    it('"2" → fresh_start', () => {
      assert.equal(classifyBreakoutResumeResponse('2'), 'fresh_start');
    });

    it('"2." → fresh_start', () => {
      assert.equal(classifyBreakoutResumeResponse('2.'), 'fresh_start');
    });
  });

  describe('resume keywords', () => {
    const resumeMessages = [
      'resume',
      'continue',
      'pick up where we left off',
      'carry on',
      'go ahead',
      'proceed',
      'yes',
      'yeah',
      'yep',
      'sure',
      'Yes please, continue the pipeline',
    ];

    for (const msg of resumeMessages) {
      it(`"${msg}" → resume`, () => {
        assert.equal(classifyBreakoutResumeResponse(msg), 'resume');
      });
    }
  });

  describe('fresh-start keywords', () => {
    const freshMessages = [
      'start fresh',
      'start over',
      'start new',
      'from scratch',
      'new pipeline',
      'new research',
      'fresh start',
      'no',
      'nah',
      'nope',
      'No, start fresh please',
    ];

    for (const msg of freshMessages) {
      it(`"${msg}" → fresh_start`, () => {
        assert.equal(classifyBreakoutResumeResponse(msg), 'fresh_start');
      });
    }
  });

  describe('unclear messages', () => {
    const unclearMessages = [
      'what?',
      'hmm',
      'I need to think about this',
      '3',
      'hello',
    ];

    for (const msg of unclearMessages) {
      it(`"${msg}" → unclear`, () => {
        assert.equal(classifyBreakoutResumeResponse(msg), 'unclear');
      });
    }
  });

  describe('fresh-start takes priority over resume keywords', () => {
    it('"no, start fresh" → fresh_start (not resume via keyword collision)', () => {
      assert.equal(classifyBreakoutResumeResponse('no, start fresh'), 'fresh_start');
    });
  });
});

// =============================================================================
// classifyResumeIntent()
// =============================================================================

describe('classifyResumeIntent()', () => {
  describe('resume intent', () => {
    const resumeMessages = [
      '[agent:isa-deep-research] continue with stage 2',
      '[agent:isa-deep-research] resume the pipeline',
      '[agent:isa-deep-research] pick up where we left off',
      '[agent:isa-deep-research] carry on from stage 3',
      '[agent:isa-deep-research] proceed with the analysis',
      '[agent:isa-deep-research] go back to the research',
      'continue with stage 2',
      'resume',
      'stage 3 please',
    ];

    for (const msg of resumeMessages) {
      it(`"${msg}" → resume`, () => {
        assert.equal(classifyResumeIntent(msg), 'resume');
      });
    }
  });

  describe('fresh-start intent', () => {
    const freshMessages = [
      '[agent:isa-deep-research] start fresh with a new query',
      '[agent:isa-deep-research] start over',
      '[agent:isa-deep-research] from scratch please',
      '[agent:isa-deep-research] new research on a different topic',
      '[agent:isa-deep-research] brand new pipeline',
      'start fresh',
      'forget the previous research and start new',
    ];

    for (const msg of freshMessages) {
      it(`"${msg}" → fresh_start`, () => {
        assert.equal(classifyResumeIntent(msg), 'fresh_start');
      });
    }
  });

  describe('unclear intent (triggers confirmation prompt)', () => {
    const unclearMessages = [
      '[agent:isa-deep-research] what are the safety requirements for pressure vessels?',
      '[agent:isa-deep-research] analyze this document',
      'hello there',
      'can you help me with something?',
    ];

    for (const msg of unclearMessages) {
      it(`"${msg}" → unclear`, () => {
        assert.equal(classifyResumeIntent(msg), 'unclear');
      });
    }
  });

  describe('fresh-start takes priority over resume keywords', () => {
    it('"start fresh and continue" → fresh_start (fresh-start regex checked first)', () => {
      assert.equal(classifyResumeIntent('start fresh and continue'), 'fresh_start');
    });
  });
});
