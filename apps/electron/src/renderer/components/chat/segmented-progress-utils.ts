/**
 * Segmented Progress Bar — Pure utility functions
 *
 * Extracted for testability. No React dependencies.
 */

export interface StageState {
  state: 'done' | 'active' | 'pending' | 'paused'
  fillPercent: number
}

export interface ProgressState {
  visible: boolean
  stages: StageState[]
  activeIndex: number
  isPaused: boolean
}

interface RunState {
  agentSlug: string
  runId: string
  currentStage: number
  stageName: string
  isRunning: boolean
  isCompleted?: boolean
  isPaused?: boolean
  sessionId: string
}

interface PausedAgent {
  agentSlug: string
  stage: number
  runId: string
}

interface StageConfig {
  id: number
  name: string
}

/**
 * Derive the visual state of each stage segment from run state.
 */
export function deriveProgressState(
  run: RunState | undefined,
  stages: StageConfig[],
  pausedAgent: PausedAgent | undefined,
  substepProgress: number,
  maxReachedStage: number,
): ProgressState {
  if (stages.length === 0) {
    return { visible: false, stages: [], activeIndex: -1, isPaused: false }
  }

  // Completed pipeline — show all stages as done
  if (run?.isCompleted) {
    return {
      visible: true,
      stages: stages.map(() => ({ state: 'done' as const, fillPercent: 100 })),
      activeIndex: -1,
      isPaused: false,
    }
  }

  // Paused pipeline — show paused stage in amber, prior stages as done
  if (run?.isPaused) {
    const stageStates: StageState[] = stages.map((s) => {
      if (s.id < run.currentStage) return { state: 'done' as const, fillPercent: 100 }
      if (s.id === run.currentStage) return { state: 'paused' as const, fillPercent: 100 }
      if (s.id <= maxReachedStage) return { state: 'done' as const, fillPercent: 100 }
      return { state: 'pending' as const, fillPercent: 0 }
    })
    return {
      visible: true,
      stages: stageStates,
      activeIndex: stages.findIndex(s => s.id === run.currentStage),
      isPaused: true,
    }
  }

  // Use paused agent as fallback when no active run
  const activeStage = run ? run.currentStage : pausedAgent?.stage
  const isPaused = !run && !!pausedAgent

  if (activeStage === undefined) {
    return { visible: false, stages: [], activeIndex: -1, isPaused: false }
  }

  const stageStates: StageState[] = stages.map((s) => {
    if (s.id < activeStage || (s.id <= maxReachedStage && s.id !== activeStage)) {
      return { state: 'done', fillPercent: 100 }
    }
    if (s.id === activeStage) {
      if (isPaused) {
        return { state: 'paused', fillPercent: 100 }
      }
      return { state: 'active', fillPercent: Math.max(substepProgress * 100, 2) }
    }
    return { state: 'pending', fillPercent: 0 }
  })

  return {
    visible: true,
    stages: stageStates,
    activeIndex: stages.findIndex(s => s.id === activeStage),
    isPaused,
  }
}

/**
 * Compute smooth substep progress using easeOutCubic.
 * Returns 0..0.95 — never reaches 1.0 (that's reserved for actual completion).
 */
export function computeSubstepProgress(
  startTime: number,
  now: number,
  estimatedDuration: number = 45000,
): number {
  const elapsed = now - startTime
  if (elapsed <= 0) return 0
  const t = Math.min(elapsed / estimatedDuration, 1)
  const eased = 1 - Math.pow(1 - t, 3) // easeOutCubic
  return Math.min(eased * 0.95, 0.95)
}

/**
 * Resolve the completion phase for the progress bar visibility state machine.
 *
 * 'hidden'     → no bar visible
 * 'running'    → bar is active
 * 'completing' → bar is fading out (run just ended)
 * 'done'       → bar fully hidden after fade
 */
export type CompletionPhase = 'hidden' | 'running' | 'completing' | 'done'

export function resolveCompletionPhase(
  currentRun: RunState | undefined,
  prevRunPresent: boolean,
): CompletionPhase {
  if (currentRun) return 'running'
  if (prevRunPresent) return 'completing'
  return 'hidden'
}
