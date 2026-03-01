/**
 * Unit tests for SegmentedProgressBar utility functions.
 *
 * Tests the pure logic extracted into segmented-progress-utils.ts:
 * - deriveProgressState: maps run state → visual segment states
 * - computeSubstepProgress: easeOutCubic time → progress
 * - resolveCompletionPhase: state machine transitions
 */

import { describe, it, expect } from 'bun:test'
import {
  deriveProgressState,
  computeSubstepProgress,
  resolveCompletionPhase,
} from '../segmented-progress-utils'

const STAGES = [
  { id: 0, name: 'Analyze' },
  { id: 1, name: 'Search' },
  { id: 2, name: 'Retrieve' },
  { id: 3, name: 'Synthesize' },
  { id: 4, name: 'Verify' },
  { id: 5, name: 'Output' },
]

const makeRun = (currentStage: number, sessionId = 'sess-1') => ({
  agentSlug: 'isa-agent',
  runId: 'run-1',
  currentStage,
  stageName: STAGES[currentStage]?.name ?? '',
  isRunning: true,
  sessionId,
})

describe('deriveProgressState', () => {
  it('returns not visible when no active run and no paused agent', () => {
    const result = deriveProgressState(undefined, STAGES, undefined, 0, -1)
    expect(result.visible).toBe(false)
  })

  it('returns not visible when stages array is empty', () => {
    const run = makeRun(2)
    const result = deriveProgressState(run, [], undefined, 0.5, 2)
    expect(result.visible).toBe(false)
  })

  it('correctly derives state for active run at stage 2 of 6', () => {
    const run = makeRun(2)
    const result = deriveProgressState(run, STAGES, undefined, 0.5, 2)

    expect(result.visible).toBe(true)
    expect(result.activeIndex).toBe(2)
    expect(result.isPaused).toBe(false)

    // Stages 0, 1 should be done
    expect(result.stages[0].state).toBe('done')
    expect(result.stages[0].fillPercent).toBe(100)
    expect(result.stages[1].state).toBe('done')
    expect(result.stages[1].fillPercent).toBe(100)

    // Stage 2 should be active with substep progress
    expect(result.stages[2].state).toBe('active')
    expect(result.stages[2].fillPercent).toBe(50)

    // Stages 3, 4, 5 should be pending
    expect(result.stages[3].state).toBe('pending')
    expect(result.stages[3].fillPercent).toBe(0)
    expect(result.stages[4].state).toBe('pending')
    expect(result.stages[5].state).toBe('pending')
  })

  it('shows paused state when only pausedAgent is present', () => {
    const paused = { agentSlug: 'isa-agent', stage: 0, runId: 'run-1' }
    const result = deriveProgressState(undefined, STAGES, paused, 0, 0)

    expect(result.visible).toBe(true)
    expect(result.isPaused).toBe(true)
    expect(result.activeIndex).toBe(0)
    expect(result.stages[0].state).toBe('paused')
    expect(result.stages[0].fillPercent).toBe(100)
  })

  it('keeps completed stages during repair loop (currentStage goes 4→3)', () => {
    // maxReachedStage is 4, but current is back at 3
    const run = makeRun(3)
    const result = deriveProgressState(run, STAGES, undefined, 0.3, 4)

    expect(result.stages[0].state).toBe('done')
    expect(result.stages[1].state).toBe('done')
    expect(result.stages[2].state).toBe('done')
    expect(result.stages[3].state).toBe('active')
    // Stage 4 should still be done because maxReachedStage=4
    expect(result.stages[4].state).toBe('done')
    expect(result.stages[5].state).toBe('pending')
  })

  it('applies minimum 2% fill for active segment', () => {
    const run = makeRun(0)
    const result = deriveProgressState(run, STAGES, undefined, 0, 0)
    expect(result.stages[0].state).toBe('active')
    expect(result.stages[0].fillPercent).toBe(2) // min 2%
  })

  it('shows all stages as done when run is completed', () => {
    const completedRun = {
      agentSlug: 'isa-agent',
      runId: 'run-1',
      currentStage: -1,
      stageName: '',
      isRunning: false,
      isCompleted: true,
      sessionId: 'sess-1',
    }
    const result = deriveProgressState(completedRun, STAGES, undefined, 0, 5)

    expect(result.visible).toBe(true)
    expect(result.isPaused).toBe(false)
    expect(result.activeIndex).toBe(-1)

    // All stages should be done with 100% fill
    for (const stage of result.stages) {
      expect(stage.state).toBe('done')
      expect(stage.fillPercent).toBe(100)
    }
  })

  it('shows paused state from atom isPaused flag (survives handleComplete)', () => {
    const pausedRun = {
      agentSlug: 'isa-agent',
      runId: 'run-1',
      currentStage: 0,
      stageName: '',
      isRunning: false,
      isPaused: true,
      sessionId: 'sess-1',
    }
    // No pausedAgent prop — simulates after handleComplete clears session.pausedAgent
    const result = deriveProgressState(pausedRun, STAGES, undefined, 0, 0)

    expect(result.visible).toBe(true)
    expect(result.isPaused).toBe(true)
    expect(result.stages[0].state).toBe('paused')
    expect(result.stages[0].fillPercent).toBe(100)
    expect(result.stages[1].state).toBe('pending')
  })

  it('paused run at stage 2 shows prior stages as done', () => {
    const pausedRun = {
      agentSlug: 'isa-agent',
      runId: 'run-1',
      currentStage: 2,
      stageName: '',
      isRunning: false,
      isPaused: true,
      sessionId: 'sess-1',
    }
    const result = deriveProgressState(pausedRun, STAGES, undefined, 0, 2)

    expect(result.stages[0].state).toBe('done')
    expect(result.stages[1].state).toBe('done')
    expect(result.stages[2].state).toBe('paused')
    expect(result.stages[3].state).toBe('pending')
  })

  it('completed run takes priority over pausedAgent', () => {
    const completedRun = {
      agentSlug: 'isa-agent',
      runId: 'run-1',
      currentStage: -1,
      stageName: '',
      isRunning: false,
      isCompleted: true,
      sessionId: 'sess-1',
    }
    const paused = { agentSlug: 'isa-agent', stage: 3, runId: 'run-1' }
    const result = deriveProgressState(completedRun, STAGES, paused, 0, 5)

    // Should show completed state, not paused
    expect(result.isPaused).toBe(false)
    for (const stage of result.stages) {
      expect(stage.state).toBe('done')
    }
  })
})

describe('computeSubstepProgress', () => {
  const DURATION = 45000

  it('returns 0 at t=0', () => {
    const now = 1000
    expect(computeSubstepProgress(now, now, DURATION)).toBe(0)
  })

  it('returns approximately 0.5 at half duration (eased)', () => {
    const start = 0
    const now = DURATION / 2
    const result = computeSubstepProgress(start, now, DURATION)
    // easeOutCubic at 0.5 = 1 - (0.5)^3 = 0.875, * 0.95 = 0.83125
    // So at half time it should be well above 0.5 due to easeOutCubic
    expect(result).toBeGreaterThan(0.5)
    expect(result).toBeLessThan(0.95)
  })

  it('caps at 0.95 at full duration', () => {
    const start = 0
    const now = DURATION
    const result = computeSubstepProgress(start, now, DURATION)
    expect(result).toBe(0.95)
  })

  it('stays at 0.95 even at 2x duration', () => {
    const start = 0
    const now = DURATION * 2
    const result = computeSubstepProgress(start, now, DURATION)
    expect(result).toBe(0.95)
  })

  it('returns 0 for negative elapsed time', () => {
    const start = 1000
    const now = 500
    expect(computeSubstepProgress(start, now, DURATION)).toBe(0)
  })
})

describe('resolveCompletionPhase', () => {
  it('returns running when current run is present', () => {
    const run = makeRun(2)
    expect(resolveCompletionPhase(run, false)).toBe('running')
  })

  it('returns running even if prevRun was present', () => {
    const run = makeRun(2)
    expect(resolveCompletionPhase(run, true)).toBe('running')
  })

  it('returns completing when run gone but prevRun was present', () => {
    expect(resolveCompletionPhase(undefined, true)).toBe('completing')
  })

  it('returns hidden when no run and no prev run', () => {
    expect(resolveCompletionPhase(undefined, false)).toBe('hidden')
  })
})
