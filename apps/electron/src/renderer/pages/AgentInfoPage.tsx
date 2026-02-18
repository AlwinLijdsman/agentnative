/**
 * AgentInfoPage
 *
 * Displays comprehensive agent details including metadata,
 * required sources, control flow stages, configuration, and session runs.
 * Uses the Info_ component system for consistent styling with SkillInfoPage.
 */

import * as React from 'react'
import { useEffect, useState, useCallback } from 'react'
import { useAtomValue } from 'jotai'
import { toast } from 'sonner'
import { AgentMenu } from '@/components/app-shell/AgentMenu'
import { AgentAvatar } from '@/components/ui/agent-avatar'
import { routes, navigate } from '@/lib/navigate'
import { activeSessionIdAtom } from '@/atoms/sessions'
import {
  Info_Page,
  Info_Section,
  Info_Table,
  Info_Badge,
  Info_Markdown,
} from '@/components/info'
import type { LoadedAgent } from '@craft-agent/shared/agents'

interface AgentInfoPageProps {
  agentSlug: string
  workspaceId: string
}

export default function AgentInfoPage({ agentSlug, workspaceId }: AgentInfoPageProps) {
  const [agent, setAgent] = useState<LoadedAgent | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [runs, setRuns] = useState<Array<{
    runId: string
    startedAt: string
    depthMode: string
    toolCallCount: number
  }>>([])
  const activeSessionId = useAtomValue(activeSessionIdAtom)

  // Load agent data
  useEffect(() => {
    let isMounted = true
    setLoading(true)
    setError(null)

    const loadAgent = async () => {
      try {
        const agents = await window.electronAPI.getAgents(workspaceId)

        if (!isMounted) return

        const found = agents.find((a) => a.slug === agentSlug)
        if (found) {
          setAgent(found)
        } else {
          setError('Agent not found')
        }
      } catch (err) {
        if (!isMounted) return
        setError(err instanceof Error ? err.message : 'Failed to load agent')
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    loadAgent()

    // Subscribe to agent changes
    const unsubscribe = window.electronAPI.onAgentsChanged?.((agents) => {
      const updated = agents.find((a) => a.slug === agentSlug)
      if (updated) {
        setAgent(updated)
      }
    })

    return () => {
      isMounted = false
      unsubscribe?.()
    }
  }, [workspaceId, agentSlug])

  // Load session runs for this agent (requires an active session)
  useEffect(() => {
    if (!activeSessionId || !agent) {
      setRuns([])
      return
    }

    let isMounted = true

    const loadRuns = async () => {
      try {
        const runData = await window.electronAPI.getAgentRuns(activeSessionId, agentSlug)
        if (isMounted) setRuns(runData)
      } catch (err) {
        console.error('Failed to load agent runs:', err)
        if (isMounted) setRuns([])
      }
    }

    loadRuns()

    return () => { isMounted = false }
  }, [activeSessionId, agent, agentSlug])

  // Handle open in finder
  const handleOpenInFinder = useCallback(async () => {
    if (!agent) return
    try {
      await window.electronAPI.openAgentInFinder(workspaceId, agentSlug)
    } catch (err) {
      console.error('Failed to open agent in finder:', err)
    }
  }, [agent, workspaceId, agentSlug])

  // Handle delete
  const handleDelete = useCallback(async () => {
    if (!agent) return
    try {
      await window.electronAPI.deleteAgent(workspaceId, agentSlug)
      toast.success(`Deleted agent: ${agent.metadata.name}`)
      navigate(routes.view.agents())
    } catch (err) {
      toast.error('Failed to delete agent', {
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }, [agent, workspaceId, agentSlug])

  // Handle opening in new window
  const handleOpenInNewWindow = useCallback(() => {
    window.electronAPI.openUrl(`craftagents://agents/agent/${agentSlug}?window=focused`)
  }, [agentSlug])

  // Get agent name for header
  const agentName = agent?.metadata.name || agentSlug

  // Format path to show just the agent-relative portion
  const formatPath = (path: string) => {
    const agentsIndex = path.indexOf('/agents/')
    if (agentsIndex !== -1) {
      return path.slice(agentsIndex + 1)
    }
    // Also handle Windows paths
    const agentsWinIndex = path.indexOf('\\agents\\')
    if (agentsWinIndex !== -1) {
      return path.slice(agentsWinIndex + 1)
    }
    return path
  }

  // Open the agent folder in Finder
  const handleLocationClick = () => {
    if (!agent) return
    window.electronAPI.showInFolder(`${agent.path}/AGENT.md`)
  }

  // Toggle debug mode
  const handleToggleDebug = useCallback(async () => {
    if (!agent) return
    const currentEnabled = agent.config.debug?.enabled ?? false
    try {
      await window.electronAPI.updateAgentConfig(workspaceId, agentSlug, {
        debug: { ...agent.config.debug, enabled: !currentEnabled },
      })
      toast.success(`Debug mode ${!currentEnabled ? 'enabled' : 'disabled'}`)
    } catch (err) {
      toast.error('Failed to update debug config')
    }
  }, [agent, workspaceId, agentSlug])

  return (
    <Info_Page
      loading={loading}
      error={error ?? undefined}
      empty={!agent && !loading && !error ? 'Agent not found' : undefined}
    >
      <Info_Page.Header
        title={agentName}
        titleMenu={
          <AgentMenu
            agentSlug={agentSlug}
            agentName={agentName}
            onOpenInNewWindow={handleOpenInNewWindow}
            onShowInFinder={handleOpenInFinder}
            onDelete={handleDelete}
          />
        }
      />

      {agent && (
        <Info_Page.Content>
          {/* Hero: Avatar, title, and description */}
          <Info_Page.Hero
            avatar={<AgentAvatar agent={agent} fluid workspaceId={workspaceId} />}
            title={agent.metadata.name}
            tagline={agent.metadata.description}
          />

          {/* Metadata */}
          <Info_Section title="Metadata">
            <Info_Table>
              <Info_Table.Row label="Slug" value={agent.slug} />
              <Info_Table.Row label="Name">{agent.metadata.name}</Info_Table.Row>
              <Info_Table.Row label="Description">
                {agent.metadata.description}
              </Info_Table.Row>
              {agent.metadata.type && (
                <Info_Table.Row label="Type">
                  <Info_Badge color="default">{agent.metadata.type}</Info_Badge>
                </Info_Table.Row>
              )}
              <Info_Table.Row label="Location">
                <button
                  onClick={handleLocationClick}
                  className="hover:underline cursor-pointer text-left"
                >
                  {formatPath(agent.path)}
                </button>
              </Info_Table.Row>
            </Info_Table>
          </Info_Section>

          {/* Required Sources */}
          {agent.metadata.sources && agent.metadata.sources.length > 0 && (
            <Info_Section title="Required Sources">
              <div className="space-y-1 px-4 py-3">
                {agent.metadata.sources.map((source) => (
                  <div
                    key={source.slug}
                    className="flex items-center gap-2 text-sm py-1"
                  >
                    <span className="font-medium">{source.slug}</span>
                    {source.required && (
                      <Info_Badge color="warning">required</Info_Badge>
                    )}
                    {source.tools && source.tools.length > 0 && (
                      <span className="text-xs text-muted-foreground">
                        ({source.tools.length} tools)
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </Info_Section>
          )}

          {/* Control Flow */}
          <Info_Section title="Control Flow">
            <div className="px-4 py-3 space-y-3">
              {/* Stages */}
              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground mb-2">Stages</div>
                {agent.config.controlFlow.stages.map((stage) => (
                  <div
                    key={stage.id}
                    className="flex items-center gap-3 py-1.5 text-sm"
                  >
                    <span className="font-mono text-xs text-muted-foreground w-6 text-right shrink-0">
                      {stage.id}
                    </span>
                    <span className="font-medium">{stage.name}</span>
                    <span className="text-muted-foreground text-xs truncate">
                      {stage.description}
                    </span>
                    {agent.config.controlFlow.pauseAfterStages.includes(stage.id) && (
                      <Info_Badge color="warning">pause</Info_Badge>
                    )}
                  </div>
                ))}
              </div>

              {/* Repair Units */}
              {agent.config.controlFlow.repairUnits.length > 0 && (
                <div className="space-y-1 pt-2 border-t border-border/30">
                  <div className="text-xs font-medium text-muted-foreground mb-2">Repair Units</div>
                  {agent.config.controlFlow.repairUnits.map((unit, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm py-1">
                      <span className="font-mono text-xs">
                        stages [{unit.stages[0]}→{unit.stages[1]}]
                      </span>
                      <span className="text-muted-foreground text-xs">
                        max {unit.maxIterations} iterations
                      </span>
                      <span className="text-muted-foreground text-xs">
                        feedback: {unit.feedbackField}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Info_Section>

          {/* Verification Thresholds */}
          <Info_Section title="Verification">
            <Info_Table>
              <Info_Table.Row label="Entity Grounding">
                ≥ {agent.config.verification.entityGrounding.threshold}
              </Info_Table.Row>
              <Info_Table.Row label="Relation Preservation">
                ≥ {agent.config.verification.relationPreservation.threshold}
              </Info_Table.Row>
              <Info_Table.Row label="Citation Accuracy">
                ≥ {agent.config.verification.citationAccuracy.threshold}
              </Info_Table.Row>
              <Info_Table.Row label="Contradictions">
                max {agent.config.verification.contradictions.maxUnresolved} unresolved
              </Info_Table.Row>
            </Info_Table>
          </Info_Section>

          {/* Depth Modes */}
          <Info_Section title="Depth Modes">
            <div className="px-4 py-3 space-y-2">
              {Object.entries(agent.config.depthModes).map(([modeName, mode]) => (
                <div key={modeName} className="flex items-start gap-3 py-1 text-sm">
                  <Info_Badge color="default">{modeName}</Info_Badge>
                  <span className="text-xs text-muted-foreground">
                    {mode.maxSubQueries} sub-queries, {mode.maxParagraphsPerQuery} paragraphs, {mode.maxRepairIterations} repair iterations
                    {mode.enableWebSearch && ', web search'}
                  </span>
                </div>
              ))}
            </div>
          </Info_Section>

          {/* Configuration */}
          <Info_Section title="Configuration">
            <Info_Table>
              <Info_Table.Row label="Auto-advance">
                {agent.config.controlFlow.autoAdvance ? 'Yes' : 'No'}
              </Info_Table.Row>
              <Info_Table.Row label="Logging">
                {agent.config.logging.level}
                {agent.config.logging.persistIntermediates && ', persist intermediates'}
                {agent.config.logging.costTracking && ', cost tracking'}
              </Info_Table.Row>
              <Info_Table.Row label="Follow-up">
                {agent.config.followUp.enabled ? 'Enabled' : 'Disabled'}
                {agent.config.followUp.enabled && ` (max ${agent.config.followUp.maxAccumulatedSections} sections)`}
              </Info_Table.Row>
              <Info_Table.Row label="Output">
                {agent.config.output.progressiveDisclosure ? 'Progressive disclosure' : 'Full output'}
              </Info_Table.Row>
              <Info_Table.Row label="Debug">
                <button
                  onClick={handleToggleDebug}
                  className="hover:underline cursor-pointer"
                >
                  {agent.config.debug?.enabled ? (
                    <Info_Badge color="warning">enabled</Info_Badge>
                  ) : (
                    <span className="text-muted-foreground">disabled</span>
                  )}
                </button>
              </Info_Table.Row>
            </Info_Table>
          </Info_Section>

          {/* Session Runs */}
          {runs.length > 0 && (
            <Info_Section title="Session Runs">
              <div className="px-4 py-3 space-y-1">
                {runs.map((run) => (
                  <button
                    key={run.runId}
                    onClick={() => navigate(routes.view.agentRun(agentSlug, run.runId))}
                    className="flex items-center gap-3 py-2 px-2 text-sm w-full text-left rounded hover:bg-muted/50 transition-colors cursor-pointer"
                  >
                    <span className="font-mono text-xs text-muted-foreground shrink-0">
                      {run.runId}
                    </span>
                    <Info_Badge color="default">{run.depthMode}</Info_Badge>
                    {run.toolCallCount > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {run.toolCallCount} tool calls
                      </span>
                    )}
                    {run.startedAt && (
                      <span className="text-xs text-muted-foreground ml-auto">
                        {new Date(run.startedAt).toLocaleString()}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </Info_Section>
          )}

          {/* Agent Instructions (AGENT.md body) */}
          <Info_Section title="Instructions">
            <Info_Markdown maxHeight={540} fullscreen>
              {agent.content || '*No instructions provided.*'}
            </Info_Markdown>
          </Info_Section>

        </Info_Page.Content>
      )}
    </Info_Page>
  )
}
