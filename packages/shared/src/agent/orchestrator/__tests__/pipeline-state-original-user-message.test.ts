/**
 * Tests for PipelineState.originalUserMessage persistence.
 *
 * Verifies that originalUserMessage:
 * - Is accepted by create() and carried through all mutations
 * - Survives toSnapshot() / fromSnapshot() round-trip
 * - Defaults to undefined for backward compatibility
 * - uniqueCompletedStages deduplicates stage_completed events
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PipelineState } from '../pipeline-state.ts';

describe('PipelineState.originalUserMessage', () => {
  const SESSION_ID = 'test-session-001';
  const AGENT_SLUG = 'dev-loop';
  const ORIGINAL_MSG = 'Implement feature X\n\n<ATTACHED_FILE name="plan.txt">\nPlan content here\n</ATTACHED_FILE>';

  it('create() with originalUserMessage persists it', () => {
    const state = PipelineState.create(SESSION_ID, AGENT_SLUG, undefined, ORIGINAL_MSG);
    assert.equal(state.originalUserMessage, ORIGINAL_MSG);
  });

  it('create() without originalUserMessage defaults to undefined', () => {
    const state = PipelineState.create(SESSION_ID, AGENT_SLUG);
    assert.equal(state.originalUserMessage, undefined);
  });

  it('addEvent() carries originalUserMessage to new instance', () => {
    const state = PipelineState.create(SESSION_ID, AGENT_SLUG, undefined, ORIGINAL_MSG);
    const next = state.addEvent({ type: 'stage_started', stage: 0, data: {} });
    assert.equal(next.originalUserMessage, ORIGINAL_MSG);
    // Original unchanged
    assert.equal(state.events.length, 0);
    assert.equal(next.events.length, 1);
  });

  it('setStageOutput() carries originalUserMessage to new instance', () => {
    const state = PipelineState.create(SESSION_ID, AGENT_SLUG, undefined, ORIGINAL_MSG);
    const next = state.setStageOutput(0, {
      text: 'test',
      summary: 'test',
      usage: { inputTokens: 0, outputTokens: 0 },
      data: {},
    });
    assert.equal(next.originalUserMessage, ORIGINAL_MSG);
  });

  it('toSnapshot() includes originalUserMessage when present', () => {
    const state = PipelineState.create(SESSION_ID, AGENT_SLUG, undefined, ORIGINAL_MSG);
    const snapshot = state.toSnapshot();
    assert.equal(snapshot.originalUserMessage, ORIGINAL_MSG);
  });

  it('toSnapshot() omits originalUserMessage when undefined', () => {
    const state = PipelineState.create(SESSION_ID, AGENT_SLUG);
    const snapshot = state.toSnapshot();
    assert.equal(snapshot.originalUserMessage, undefined);
    assert.equal('originalUserMessage' in snapshot, false);
  });

  it('fromSnapshot() round-trip preserves originalUserMessage', () => {
    const original = PipelineState.create(SESSION_ID, AGENT_SLUG, undefined, ORIGINAL_MSG);
    const withEvent = original.addEvent({ type: 'stage_started', stage: 0, data: {} });
    const snapshot = withEvent.toSnapshot();
    const restored = PipelineState.fromSnapshot(snapshot);
    assert.equal(restored.originalUserMessage, ORIGINAL_MSG);
    assert.equal(restored.sessionId, SESSION_ID);
    assert.equal(restored.agentSlug, AGENT_SLUG);
    assert.equal(restored.events.length, 1);
  });

  it('fromSnapshot() handles missing originalUserMessage (backward compat)', () => {
    const legacySnapshot = {
      sessionId: SESSION_ID,
      agentSlug: AGENT_SLUG,
      events: [] as const,
      currentStage: -1,
      stageOutputs: {},
      savedAt: new Date().toISOString(),
    };
    const restored = PipelineState.fromSnapshot(legacySnapshot);
    assert.equal(restored.originalUserMessage, undefined);
  });

  it('multiple mutations preserve originalUserMessage through chain', () => {
    let state = PipelineState.create(SESSION_ID, AGENT_SLUG, undefined, ORIGINAL_MSG);
    state = state.addEvent({ type: 'stage_started', stage: 0, data: {} });
    state = state.setStageOutput(0, {
      text: 'output',
      summary: 'done',
      usage: { inputTokens: 100, outputTokens: 200 },
      data: { test: true },
    });
    state = state.addEvent({ type: 'stage_completed', stage: 0, data: {} });
    state = state.addEvent({ type: 'pause_requested', stage: 0, data: {} });
    state = state.addEvent({ type: 'resumed', stage: 0, data: { userResponse: 'yes' } });
    assert.equal(state.originalUserMessage, ORIGINAL_MSG);
    assert.equal(state.events.length, 4);
  });
});

describe('PipelineState.uniqueCompletedStages', () => {
  const SESSION_ID = 'test-session-002';
  const AGENT_SLUG = 'dev-loop';

  it('returns empty array when no stages completed', () => {
    const state = PipelineState.create(SESSION_ID, AGENT_SLUG);
    assert.deepEqual(state.uniqueCompletedStages, []);
    assert.equal(state.completedStageCount, 0);
  });

  it('returns single stage for one completion', () => {
    let state = PipelineState.create(SESSION_ID, AGENT_SLUG);
    state = state.addEvent({ type: 'stage_completed', stage: 0, data: {} });
    assert.deepEqual(state.uniqueCompletedStages, [0]);
    assert.equal(state.completedStageCount, 1);
  });

  it('deduplicates when same stage completed multiple times (amend re-run)', () => {
    let state = PipelineState.create(SESSION_ID, AGENT_SLUG);
    // First run of stage 0
    state = state.addEvent({ type: 'stage_completed', stage: 0, data: {} });
    state = state.addEvent({ type: 'pause_requested', stage: 0, data: {} });
    state = state.addEvent({ type: 'amended', stage: 0, data: { amendment: 'adjust scope' } });
    // Second run of stage 0 (amend re-run)
    state = state.addEvent({ type: 'stage_completed', stage: 0, data: {} });

    assert.deepEqual(state.uniqueCompletedStages, [0]);
    assert.equal(state.completedStageCount, 1);
    // But raw events have 2 stage_completed events
    assert.equal(state.events.filter(e => e.type === 'stage_completed').length, 2);
  });

  it('returns sorted stages across multiple stage completions', () => {
    let state = PipelineState.create(SESSION_ID, AGENT_SLUG);
    state = state.addEvent({ type: 'stage_completed', stage: 3, data: {} });
    state = state.addEvent({ type: 'stage_completed', stage: 0, data: {} });
    state = state.addEvent({ type: 'stage_completed', stage: 1, data: {} });
    assert.deepEqual(state.uniqueCompletedStages, [0, 1, 3]);
    assert.equal(state.completedStageCount, 3);
  });
});

describe('PipelineState.isPaused with amended/cancelled events', () => {
  const SESSION_ID = 'test-session-003';
  const AGENT_SLUG = 'dev-loop';

  it('amended event resolves pause', () => {
    let state = PipelineState.create(SESSION_ID, AGENT_SLUG);
    state = state.addEvent({ type: 'pause_requested', stage: 0, data: {} });
    assert.equal(state.isPaused, true);

    state = state.addEvent({ type: 'resumed', stage: 0, data: {} });
    state = state.addEvent({ type: 'amended', stage: 0, data: { amendment: 'change scope' } });
    assert.equal(state.isPaused, false);
  });

  it('cancelled event resolves pause', () => {
    let state = PipelineState.create(SESSION_ID, AGENT_SLUG);
    state = state.addEvent({ type: 'pause_requested', stage: 0, data: {} });
    assert.equal(state.isPaused, true);

    state = state.addEvent({ type: 'resumed', stage: 0, data: {} });
    state = state.addEvent({ type: 'cancelled', stage: 0, data: {} });
    assert.equal(state.isPaused, false);
  });
});
