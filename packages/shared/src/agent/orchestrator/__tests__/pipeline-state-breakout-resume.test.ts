/**
 * Tests for PipelineState breakout-resume getters:
 * - hasBreakout
 * - lastCompletedStageIndex
 * - isResumableAfterBreakout
 * - isBreakoutResumePending
 *
 * Verifies the event-sourced state detection for the resume-from-breakout flow.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PipelineState } from '../pipeline-state.ts';

const SESSION_ID = 'test-breakout-resume';
const AGENT_SLUG = 'isa-deep-research';

/** Helper: create a state with stage 0 completed. */
function createWithStage0Complete(): PipelineState {
  let state = PipelineState.create(SESSION_ID, AGENT_SLUG);
  state = state.addEvent({ type: 'stage_started', stage: 0, data: {} });
  state = state.addEvent({ type: 'stage_completed', stage: 0, data: {} });
  return state;
}

/** Helper: create a state with stages 0-1 completed. */
function createWithStages01Complete(): PipelineState {
  let state = createWithStage0Complete();
  state = state.addEvent({ type: 'stage_started', stage: 1, data: {} });
  state = state.addEvent({ type: 'stage_completed', stage: 1, data: {} });
  return state;
}

/** Helper: add breakout events (pending + confirmed) to a state. */
function addBreakout(state: PipelineState, stage: number): PipelineState {
  let s = state.addEvent({
    type: 'breakout_pending',
    stage,
    data: { userMessage: 'test breakout', detectionSource: 'keyword' },
  });
  s = s.addEvent({
    type: 'breakout',
    stage,
    data: { userMessage: 'test breakout', decision: 'confirm' },
  });
  return s;
}

// =============================================================================
// hasBreakout
// =============================================================================

describe('PipelineState.hasBreakout', () => {
  it('returns false for fresh state', () => {
    const state = PipelineState.create(SESSION_ID, AGENT_SLUG);
    assert.equal(state.hasBreakout, false);
  });

  it('returns false with only stage events', () => {
    const state = createWithStage0Complete();
    assert.equal(state.hasBreakout, false);
  });

  it('returns true after breakout event', () => {
    const state = addBreakout(createWithStage0Complete(), 0);
    assert.equal(state.hasBreakout, true);
  });

  it('returns true even after resume_from_breakout (breakout still happened)', () => {
    let state = addBreakout(createWithStage0Complete(), 0);
    state = state.addEvent({ type: 'resume_from_breakout', stage: 1, data: {} });
    assert.equal(state.hasBreakout, true);
  });
});

// =============================================================================
// lastCompletedStageIndex
// =============================================================================

describe('PipelineState.lastCompletedStageIndex', () => {
  it('returns -1 for fresh state', () => {
    const state = PipelineState.create(SESSION_ID, AGENT_SLUG);
    assert.equal(state.lastCompletedStageIndex, -1);
  });

  it('returns 0 when stage 0 is completed', () => {
    const state = createWithStage0Complete();
    assert.equal(state.lastCompletedStageIndex, 0);
  });

  it('returns 1 when stages 0-1 are completed', () => {
    const state = createWithStages01Complete();
    assert.equal(state.lastCompletedStageIndex, 1);
  });

  it('returns highest completed stage even after breakout', () => {
    const state = addBreakout(createWithStages01Complete(), 2);
    assert.equal(state.lastCompletedStageIndex, 1);
  });

  it('returns -1 when stage_started but not stage_completed', () => {
    let state = PipelineState.create(SESSION_ID, AGENT_SLUG);
    state = state.addEvent({ type: 'stage_started', stage: 0, data: {} });
    assert.equal(state.lastCompletedStageIndex, -1);
  });
});

// =============================================================================
// isResumableAfterBreakout
// =============================================================================

describe('PipelineState.isResumableAfterBreakout', () => {
  it('returns false for fresh state (no breakout)', () => {
    const state = PipelineState.create(SESSION_ID, AGENT_SLUG);
    assert.equal(state.isResumableAfterBreakout, false);
  });

  it('returns false when paused (isPaused=true)', () => {
    let state = createWithStage0Complete();
    state = state.addEvent({ type: 'pause_requested', stage: 1, data: {} });
    assert.equal(state.isResumableAfterBreakout, false);
  });

  it('returns true after breakout with completed stages', () => {
    const state = addBreakout(createWithStages01Complete(), 2);
    assert.equal(state.isResumableAfterBreakout, true);
  });

  it('returns false after breakout + resume_from_breakout (already resumed)', () => {
    let state = addBreakout(createWithStages01Complete(), 2);
    state = state.addEvent({ type: 'resume_from_breakout', stage: 2, data: {} });
    assert.equal(state.isResumableAfterBreakout, false);
  });

  it('returns true after breakout → resume → 2nd breakout (G5: multi-cycle)', () => {
    let state = addBreakout(createWithStages01Complete(), 2);
    // First resume
    state = state.addEvent({ type: 'resume_from_breakout', stage: 2, data: {} });
    state = state.addEvent({ type: 'stage_started', stage: 2, data: {} });
    state = state.addEvent({ type: 'stage_completed', stage: 2, data: {} });
    // Second breakout
    state = addBreakout(state, 3);
    assert.equal(state.isResumableAfterBreakout, true);
  });

  it('returns true even after all stages completed (orchestrator handles overflow gracefully)', () => {
    let state = createWithStages01Complete();
    state = state.addEvent({ type: 'stage_started', stage: 2, data: {} });
    state = state.addEvent({ type: 'stage_completed', stage: 2, data: {} });
    state = addBreakout(state, 2);
    // This is technically a degenerate case — breakout after all stages completed.
    // isResumableAfterBreakout returns true because breakout happened with completed stages.
    // The orchestrator's resumeFromBreakout(fromStage=3) would simply complete immediately
    // since fromStage exceeds total stages. No harm done.
    assert.equal(state.isResumableAfterBreakout, true);
  });

  it('returns false with breakout but no completed stages', () => {
    let state = PipelineState.create(SESSION_ID, AGENT_SLUG);
    state = state.addEvent({ type: 'stage_started', stage: 0, data: {} });
    // Breakout before completing stage 0
    state = state.addEvent({ type: 'breakout', stage: 0, data: {} });
    assert.equal(state.isResumableAfterBreakout, false);
  });
});

// =============================================================================
// isBreakoutResumePending
// =============================================================================

describe('PipelineState.isBreakoutResumePending', () => {
  it('returns false for fresh state', () => {
    const state = PipelineState.create(SESSION_ID, AGENT_SLUG);
    assert.equal(state.isBreakoutResumePending, false);
  });

  it('returns false with only breakout events (no pending)', () => {
    const state = addBreakout(createWithStage0Complete(), 0);
    assert.equal(state.isBreakoutResumePending, false);
  });

  it('returns true when breakout_resume_pending is the last event', () => {
    let state = addBreakout(createWithStage0Complete(), 0);
    state = state.addEvent({
      type: 'breakout_resume_pending',
      stage: 1,
      data: { agentSlug: AGENT_SLUG },
    });
    assert.equal(state.isBreakoutResumePending, true);
  });

  it('returns false after breakout_resume_pending → resume_from_breakout', () => {
    let state = addBreakout(createWithStage0Complete(), 0);
    state = state.addEvent({
      type: 'breakout_resume_pending',
      stage: 1,
      data: { agentSlug: AGENT_SLUG },
    });
    state = state.addEvent({ type: 'resume_from_breakout', stage: 1, data: {} });
    assert.equal(state.isBreakoutResumePending, false);
  });

  it('returns false after breakout_resume_pending → stage_started (fresh start)', () => {
    let state = addBreakout(createWithStage0Complete(), 0);
    state = state.addEvent({
      type: 'breakout_resume_pending',
      stage: 1,
      data: { agentSlug: AGENT_SLUG },
    });
    state = state.addEvent({ type: 'stage_started', stage: 0, data: {} });
    assert.equal(state.isBreakoutResumePending, false);
  });
});
