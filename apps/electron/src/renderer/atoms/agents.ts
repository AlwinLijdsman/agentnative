/**
 * Agents Atom
 *
 * Simple atom for storing workspace agents.
 * Used by NavigationContext for auto-selection when navigating to agents view.
 */

import { atom } from 'jotai'
import type { LoadedAgent } from '@craft-agent/shared/agents'

/**
 * Atom to store the current workspace's agents.
 * AppShell populates this when agents are loaded.
 * NavigationContext reads from it for auto-selection.
 */
export const agentsAtom = atom<LoadedAgent[]>([])

/**
 * Live run state for real-time updates (populated by event processor).
 * Keyed by agentSlug — only one active run per agent at a time.
 * When a run completes, the entry is deleted from this map.
 */
export const agentRunStateAtom = atom<Record<string, {
  agentSlug: string
  runId: string
  currentStage: number
  stageName: string
  isRunning: boolean
}>>({})
