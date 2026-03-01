/**
 * Tests for orchestrator turn detection used for gradient accent styling.
 *
 * The isOrchestratorTurn() helper checks if any activity in a turn uses
 * orchestrator pipeline tools (agent_stage_gate, orchestrator_*).
 */

import { describe, it, expect } from 'bun:test'
import { isOrchestratorTurn } from '../TurnCard'
import type { ActivityItem } from '../TurnCard'

// ============================================================================
// Test Helpers
// ============================================================================

let idCounter = 0

function makeActivity(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id: `act-${++idCounter}`,
    type: 'tool',
    status: 'completed',
    timestamp: Date.now(),
    ...overrides,
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('isOrchestratorTurn', () => {
  it('returns true when turn has agent_stage_gate tool', () => {
    const activities = [makeActivity({ toolName: 'agent_stage_gate' })]
    expect(isOrchestratorTurn(activities)).toBe(true)
  })

  it('returns true when turn has orchestrator_llm tool', () => {
    const activities = [makeActivity({ toolName: 'orchestrator_llm' })]
    expect(isOrchestratorTurn(activities)).toBe(true)
  })

  it('returns true when turn has orchestrator_web_search tool', () => {
    const activities = [makeActivity({ toolName: 'orchestrator_web_search' })]
    expect(isOrchestratorTurn(activities)).toBe(true)
  })

  it('returns false when turn has only regular tools', () => {
    const activities = [
      makeActivity({ toolName: 'Read' }),
      makeActivity({ toolName: 'Write' }),
      makeActivity({ toolName: 'Bash' }),
    ]
    expect(isOrchestratorTurn(activities)).toBe(false)
  })

  it('returns false when turn has no tools', () => {
    expect(isOrchestratorTurn([])).toBe(false)
  })

  it('returns false for non-tool activities', () => {
    const activities = [
      makeActivity({ type: 'thinking', toolName: undefined }),
      makeActivity({ type: 'intermediate', toolName: undefined }),
    ]
    expect(isOrchestratorTurn(activities)).toBe(false)
  })

  it('returns true when mixed tools include an orchestrator tool', () => {
    const activities = [
      makeActivity({ toolName: 'Read' }),
      makeActivity({ toolName: 'orchestrator_llm' }),
      makeActivity({ toolName: 'Write' }),
    ]
    expect(isOrchestratorTurn(activities)).toBe(true)
  })
})
