/**
 * SegmentedProgressBar — Floating pipeline progress overlay
 *
 * Shows a glassmorphism segmented bar at the top of the chat scroll area.
 * Each segment represents a pipeline stage. Fill animates smoothly via
 * requestAnimationFrame with easeOutCubic easing.
 *
 * Visual: T3 Label Weight Shift with V10-V3 recessed track base.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useAtomValue } from 'jotai'
import { motion, AnimatePresence } from 'motion/react'
import { X } from 'lucide-react'
import type { LoadedAgent } from '@craft-agent/shared/agents'
import { agentRunStateAtom } from '@/atoms/agents'
import {
  deriveProgressState,
  computeSubstepProgress,
  resolveCompletionPhase,
  type CompletionPhase,
  type StageState,
} from './segmented-progress-utils'

const STAGE_DURATION_ESTIMATE = 45000

interface SegmentedProgressBarProps {
  sessionId: string
  agents: LoadedAgent[]
  pausedAgent?: { agentSlug: string; stage: number; runId: string }
  compactMode?: boolean
  onInterrupt?: () => void
  onDismiss?: () => void
}

export function SegmentedProgressBar({
  sessionId,
  agents,
  pausedAgent,
  compactMode = false,
  onInterrupt,
  onDismiss,
}: SegmentedProgressBarProps) {
  const runState = useAtomValue(agentRunStateAtom)

  // Find active run for this session
  const run = Object.values(runState).find(r => r.sessionId === sessionId)

  // Look up stage config from agent
  const agentSlug = run?.agentSlug ?? pausedAgent?.agentSlug
  const agentConfig = agents.find(a => a.slug === agentSlug)
  const stages = agentConfig?.config?.controlFlow?.stages ?? []

  // Diagnostic — remove once progress bar is confirmed working
  if (run || pausedAgent) {
    console.debug('[ProgressBar]', {
      run: run ? { slug: run.agentSlug, stage: run.currentStage, running: run.isRunning } : null,
      agentSlug,
      agentsCount: agents.length,
      agentSlugs: agents.map(a => a.slug),
      matched: !!agentConfig,
      stagesCount: stages.length,
    })
  }

  // Substep animation state
  const [substepProgress, setSubstepProgress] = useState(0)
  const stageStartTimeRef = useRef(Date.now())
  const prevStageRef = useRef<number>(-1)
  const maxReachedStageRef = useRef<number>(-1)

  // Completion phase state machine
  const [phase, setPhase] = useState<CompletionPhase>('hidden')
  const prevRunRef = useRef(false)

  // Track stage changes — reset substep animation
  useEffect(() => {
    const currentStage = run?.currentStage ?? -1
    if (currentStage !== prevStageRef.current && currentStage >= 0) {
      stageStartTimeRef.current = Date.now()
      setSubstepProgress(0)
      // Update max reached
      if (currentStage > maxReachedStageRef.current) {
        maxReachedStageRef.current = currentStage
      }
    }
    prevStageRef.current = currentStage
  }, [run?.currentStage])

  // RAF loop for smooth substep fill
  useEffect(() => {
    if (!run?.isRunning) return

    let rafId: number
    const tick = () => {
      const progress = computeSubstepProgress(
        stageStartTimeRef.current,
        Date.now(),
        STAGE_DURATION_ESTIMATE,
      )
      setSubstepProgress(progress)
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [run?.isRunning, run?.currentStage])

  // Completion phase transitions
  useEffect(() => {
    const newPhase = resolveCompletionPhase(run, prevRunRef.current)
    prevRunRef.current = !!run

    if (newPhase === 'completing') {
      setPhase('completing')
      const timer = setTimeout(() => setPhase('done'), 600)
      return () => clearTimeout(timer)
    }
    if (newPhase === 'running') {
      setPhase('running')
      // Reset max reached when a new run starts
      if (run) {
        maxReachedStageRef.current = run.currentStage
      }
    }
    if (newPhase === 'hidden') {
      setPhase('hidden')
    }
  }, [run])

  // Reset to hidden after done so a new run can start fresh
  useEffect(() => {
    if (phase === 'done') {
      const timer = setTimeout(() => setPhase('hidden'), 100)
      return () => clearTimeout(timer)
    }
  }, [phase])

  // Determine if this is a completed or paused run (for dismiss vs interrupt behavior)
  const isCompleted = run && !run.isRunning && run.isCompleted
  const isPausedRun = run && !run.isRunning && run.isPaused
  const handleDismiss = isCompleted ? onDismiss : onInterrupt

  // Don't render conditions
  if (compactMode) return null
  if (stages.length === 0) return null
  if (phase === 'hidden' || phase === 'done') {
    // Check if there's a paused agent, completed run, or paused run to show
    if (!pausedAgent && !isCompleted && !isPausedRun) return null
  }

  const progressState = deriveProgressState(
    run,
    stages,
    pausedAgent,
    substepProgress,
    maxReachedStageRef.current,
  )

  if (!progressState.visible && phase !== 'completing') return null

  return (
    <div className="absolute top-0 left-0 right-0 z-[var(--z-panel)] pointer-events-none">
      <AnimatePresence>
        {(phase === 'running' || phase === 'completing' || progressState.visible) && (
          <motion.div
            key="pipeline-progress"
            initial={{ opacity: 0, y: -8 }}
            animate={phase === 'completing'
              ? { opacity: 0, y: -12 }
              : { opacity: 1, y: 0 }
            }
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: phase === 'completing' ? 0.5 : 0.3, ease: 'easeOut' }}
            className="pointer-events-auto"
          >
            {/* Glassmorphism strip */}
            <div
              className="relative bg-background/75 backdrop-blur-[20px] px-4 pt-2.5 pb-0"
              style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.3)' }}
            >
              {/* Bar row: segments + dismiss */}
              <div className="flex items-center gap-[3px]">
                {progressState.stages.map((stage, i) => (
                  <SegmentWrap key={i} index={i} stage={stage} />
                ))}
                {handleDismiss && (
                  <DismissButton onClick={handleDismiss} title={isCompleted ? 'Dismiss' : 'Stop pipeline'} />
                )}
              </div>

              {/* Labels row */}
              <div className="flex mt-1.5 gap-[3px] pb-2">
                {stages.map((stage, i) => (
                  <StageLabel
                    key={i}
                    name={stage.name}
                    state={progressState.stages[i]?.state ?? 'pending'}
                  />
                ))}
              </div>

              {/* Bottom gradient reflection line */}
              <div
                className="absolute bottom-0 left-4 right-4 h-px"
                style={{
                  background: 'linear-gradient(90deg, transparent 0%, rgba(37,99,235,0.3) 20%, rgba(147,51,234,0.4) 50%, rgba(219,39,119,0.3) 80%, transparent 100%)',
                }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SegmentWrap({ index, stage }: { index: number; stage: StageState }) {
  const hasFill = stage.state === 'done' || stage.state === 'active' || stage.state === 'paused'
  const isDone = stage.state === 'done'
  const isActive = stage.state === 'active'

  return (
    <div className="flex-1 relative">
      {/* Recessed track */}
      <div
        className="h-1.5 rounded-full overflow-hidden relative"
        style={{
          background: 'rgba(0,0,0,0.3)',
          boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.4)',
        }}
      >
        {/* Gradient fill */}
        <div
          className="absolute top-0 bottom-0 left-0 rounded-full overflow-hidden"
          style={{
            width: `${stage.fillPercent}%`,
            background: 'linear-gradient(90deg, #2563eb, #9333ea, #db2777)',
            backgroundSize: '600% 100%',
            backgroundPosition: `${index * 20}% 50%`,
            transition: 'width 0.3s ease-out',
            boxShadow: isDone
              ? '0 1px 4px rgba(147,51,234,0.25)'
              : '0 1px 2px rgba(147,51,234,0.15)',
            animation: isDone
              ? 'pipeline-glow-breathe 3s ease-in-out infinite'
              : isActive
                ? 'pipeline-glow-active 2s ease-in-out infinite, pipeline-gradient-shift 3s ease infinite'
                : 'none',
          }}
        >
          {/* Specular top-edge highlight */}
          <div
            className="absolute top-0 inset-x-0 rounded-t-full pointer-events-none"
            style={{
              height: '50%',
              background: 'linear-gradient(180deg, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0.05) 50%, transparent 100%)',
            }}
          />
          {/* Glass sweeps — only on filled segments */}
          {hasFill && (
            <>
              <span
                className="absolute pointer-events-none rounded-full"
                style={{
                  top: '-1px',
                  bottom: '-1px',
                  width: '70%',
                  background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0) 10%, rgba(255,255,255,0.14) 45%, rgba(255,255,255,0.22) 50%, rgba(255,255,255,0.14) 55%, rgba(255,255,255,0) 90%, transparent)',
                  animation: 'pipeline-specular-sweep 3.5s cubic-bezier(0.4,0,0.6,1) infinite',
                }}
              />
              <span
                className="absolute pointer-events-none rounded-full"
                style={{
                  top: '-1px',
                  bottom: '-1px',
                  width: '45%',
                  background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.03) 30%, rgba(255,255,255,0.09) 50%, rgba(255,255,255,0.03) 70%, transparent)',
                  animation: 'pipeline-specular-sweep 5s cubic-bezier(0.4,0,0.6,1) infinite',
                  animationDelay: '1.8s',
                }}
              />
            </>
          )}
        </div>
      </div>

      {/* Edge-lit glow beneath */}
      {hasFill && (
        <div
          className="absolute pointer-events-none rounded-sm"
          style={{
            bottom: '-3px',
            left: '8%',
            right: '8%',
            height: '3px',
            background: 'linear-gradient(90deg, #2563eb, #9333ea, #db2777)',
            filter: 'blur(2px)',
            opacity: isDone ? 0.55 : isActive ? 0.8 : 0.4,
            transition: 'opacity 0.5s',
          }}
        />
      )}

      {/* Ambient haze beneath */}
      {hasFill && (
        <div
          className="absolute pointer-events-none"
          style={{
            top: '6px',
            left: '5%',
            right: '5%',
            height: '8px',
            borderRadius: '50%',
            background: 'rgba(147,51,234,0.4)',
            filter: 'blur(4px)',
            opacity: isDone ? 0.25 : isActive ? 0.4 : 0.2,
            transition: 'opacity 0.6s',
          }}
        />
      )}
    </div>
  )
}

function StageLabel({ name, state }: { name: string; state: StageState['state'] }) {
  if (state === 'done') {
    return (
      <div
        className="flex-1 text-center font-semibold select-none"
        style={{
          fontSize: '8px',
          background: 'linear-gradient(90deg, #2563eb, #9333ea, #db2777)',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }}
      >
        {name}
      </div>
    )
  }
  if (state === 'active') {
    return (
      <div
        className="flex-1 text-center text-white font-bold select-none"
        style={{
          fontSize: '9px',
          textShadow: '0 0 8px rgba(147,51,234,0.4)',
        }}
      >
        {name}
      </div>
    )
  }
  if (state === 'paused') {
    return (
      <div
        className="flex-1 text-center font-semibold select-none"
        style={{
          fontSize: '8px',
          background: 'linear-gradient(90deg, #2563eb, #9333ea, #db2777)',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }}
      >
        {name}
      </div>
    )
  }
  // pending
  return (
    <div
      className="flex-1 text-center text-foreground/15 select-none transition-colors duration-300 hover:text-foreground/60"
      style={{ fontSize: '8px' }}
    >
      {name}
    </div>
  )
}

function DismissButton({ onClick, title = 'Stop pipeline' }: { onClick: () => void; title?: string }) {
  return (
    <button
      onClick={onClick}
      className="ml-2 w-5 h-5 rounded-full flex items-center justify-center shrink-0 border transition-all duration-200
        bg-foreground/[0.06] border-foreground/[0.08] text-foreground/35
        hover:bg-destructive/15 hover:border-destructive/30 hover:text-destructive"
      title={title}
    >
      <X className="w-2.5 h-2.5" />
    </button>
  )
}
