/**
 * Tests for PipelineState.previousSessionId persistence (Section 20 — F1, F4, F5).
 *
 * Verifies that previousSessionId:
 * - Is accepted by create() and carried through all mutations
 * - Survives toSnapshot() / fromSnapshot() round-trip
 * - Defaults to undefined for backward compatibility
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PipelineState } from '../pipeline-state.ts';

describe('PipelineState.previousSessionId', () => {
  const SESSION_ID = 'test-session-001';
  const AGENT_SLUG = 'isa-deep-research';
  const PREV_SESSION_ID = 'prev-session-000';

  it('create() with previousSessionId persists it', () => {
    const state = PipelineState.create(SESSION_ID, AGENT_SLUG, PREV_SESSION_ID);
    assert.equal(state.previousSessionId, PREV_SESSION_ID);
    assert.equal(state.sessionId, SESSION_ID);
    assert.equal(state.agentSlug, AGENT_SLUG);
  });

  it('create() without previousSessionId defaults to undefined', () => {
    const state = PipelineState.create(SESSION_ID, AGENT_SLUG);
    assert.equal(state.previousSessionId, undefined);
  });

  it('addEvent() carries previousSessionId to new instance', () => {
    const state = PipelineState.create(SESSION_ID, AGENT_SLUG, PREV_SESSION_ID);
    const next = state.addEvent({ type: 'stage_started', stage: 0, data: {} });
    assert.equal(next.previousSessionId, PREV_SESSION_ID);
    // Original unchanged
    assert.equal(state.events.length, 0);
    assert.equal(next.events.length, 1);
  });

  it('setStageOutput() carries previousSessionId to new instance', () => {
    const state = PipelineState.create(SESSION_ID, AGENT_SLUG, PREV_SESSION_ID);
    const next = state.setStageOutput(0, {
      text: 'test',
      summary: 'test',
      usage: { inputTokens: 0, outputTokens: 0 },
      data: {},
    });
    assert.equal(next.previousSessionId, PREV_SESSION_ID);
  });

  it('toSnapshot() includes previousSessionId when present', () => {
    const state = PipelineState.create(SESSION_ID, AGENT_SLUG, PREV_SESSION_ID);
    const snapshot = state.toSnapshot();
    assert.equal(snapshot.previousSessionId, PREV_SESSION_ID);
  });

  it('toSnapshot() omits previousSessionId when undefined', () => {
    const state = PipelineState.create(SESSION_ID, AGENT_SLUG);
    const snapshot = state.toSnapshot();
    assert.equal(snapshot.previousSessionId, undefined);
    // Should not be present as a key at all (spread conditional)
    assert.equal('previousSessionId' in snapshot, false);
  });

  it('fromSnapshot() round-trip preserves previousSessionId', () => {
    const original = PipelineState.create(SESSION_ID, AGENT_SLUG, PREV_SESSION_ID);
    const withEvent = original.addEvent({ type: 'stage_started', stage: 0, data: {} });
    const snapshot = withEvent.toSnapshot();
    const restored = PipelineState.fromSnapshot(snapshot);
    assert.equal(restored.previousSessionId, PREV_SESSION_ID);
    assert.equal(restored.sessionId, SESSION_ID);
    assert.equal(restored.agentSlug, AGENT_SLUG);
    assert.equal(restored.events.length, 1);
  });

  it('fromSnapshot() handles missing previousSessionId (backward compat)', () => {
    // Simulate a pre-Section 20 snapshot without previousSessionId
    const legacySnapshot = {
      sessionId: SESSION_ID,
      agentSlug: AGENT_SLUG,
      events: [],
      currentStage: -1,
      stageOutputs: {},
      savedAt: new Date().toISOString(),
    };
    const restored = PipelineState.fromSnapshot(legacySnapshot);
    assert.equal(restored.previousSessionId, undefined);
    assert.equal(restored.sessionId, SESSION_ID);
  });

  it('multiple mutations preserve previousSessionId through chain', () => {
    let state = PipelineState.create(SESSION_ID, AGENT_SLUG, PREV_SESSION_ID);
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
    assert.equal(state.previousSessionId, PREV_SESSION_ID);
    assert.equal(state.events.length, 4);
  });
});
