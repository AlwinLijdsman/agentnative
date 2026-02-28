/**
 * AgentRunDetailPage
 *
 * Displays detailed information about a specific agent run, including:
 * - Live pipeline visualization with stage progress
 * - Cost/metrics summary
 * - Event timeline
 * - Evidence intermediates viewer
 *
 * Subscribes to agentRunStateAtom for real-time updates during active runs.
 */

import * as React from 'react'
import { useEffect, useState, useCallback } from 'react'
import { useAtomValue } from 'jotai'
import { ArrowLeft, CheckCircle2, Circle, Loader2, RotateCw } from 'lucide-react'
import { agentRunStateAtom } from '@/atoms/agents'
import { routes, navigate } from '@/lib/navigate'
import {
  Info_Page,
  Info_Section,
  Info_Table,
  Info_Badge,
} from '@/components/info'
import type { BadgeColor } from '@/components/info'
import { cn } from '@/lib/utils'

interface AgentRunDetailPageProps {
  agentSlug: string
  runId: string
  workspaceId: string
  sessionId?: string
}

/** Locally-typed run detail shape matching what IPC returns */
interface RunDetail {
  runId: string
  startedAt: string
  depthMode: string
  toolCallCount: number
  completedStages: number[]
  currentStage: number
  events: Array<{
    type: string
    timestamp: string
    runId: string
    data: Record<string, unknown>
  }>
  evidence: {
    intermediates?: Record<string, Record<string, unknown>>
  }
}

export default function AgentRunDetailPage({
  agentSlug,
  runId,
  workspaceId,
  sessionId,
}: AgentRunDetailPageProps) {
  const [detail, setDetail] = useState<RunDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedEvents, setExpandedEvents] = useState<Set<number>>(new Set())

  // Subscribe to live run state for real-time updates
  const runStates = useAtomValue(agentRunStateAtom)
  const liveRunState = runStates[agentSlug]

  // Load run detail
  useEffect(() => {
    if (!sessionId) {
      setError('No active session')
      setLoading(false)
      return
    }

    let isMounted = true
    setLoading(true)
    setError(null)

    const loadDetail = async () => {
      try {
        const result = await window.electronAPI.getAgentRunDetail(sessionId, agentSlug, runId)
        if (!isMounted) return
        // Map the IPC result to our local type
        setDetail({
          runId: result.runId,
          startedAt: result.startedAt,
          depthMode: result.depthMode,
          toolCallCount: result.toolCallCount,
          completedStages: (result as unknown as Record<string, unknown>).completedStages as number[] ?? [],
          currentStage: (result as unknown as Record<string, unknown>).currentStage as number ?? -1,
          events: result.events as RunDetail['events'],
          evidence: result.evidence,
        })
      } catch (err) {
        if (!isMounted) return
        setError(err instanceof Error ? err.message : 'Failed to load run detail')
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    loadDetail()

    return () => {
      isMounted = false
    }
  }, [sessionId, agentSlug, runId])

  // Navigate back to agent info
  const handleBack = useCallback(() => {
    navigate(routes.view.agents(agentSlug))
  }, [agentSlug])

  // Toggle event expansion
  const toggleEvent = useCallback((index: number) => {
    setExpandedEvents(prev => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }, [])

  // Determine stage status (only use liveRunState if it matches this run's ID)
  const isLiveRun = liveRunState?.runId === runId
  const getStageStatus = (stageId: number): 'completed' | 'running' | 'pending' => {
    if (detail?.completedStages.includes(stageId)) return 'completed'
    if (isLiveRun && liveRunState?.isRunning && liveRunState.currentStage === stageId) return 'running'
    if (detail?.currentStage === stageId) return 'running'
    return 'pending'
  }

  // Format timestamp for display
  const formatTime = (iso: string) => {
    if (!iso) return '—'
    try {
      const d = new Date(iso)
      return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    } catch {
      return iso
    }
  }

  // Get badge color for event type
  const getEventBadgeColor = (type: string): BadgeColor => {
    if (type.includes('completed') || type.includes('pass')) return 'success'
    if (type.includes('started') || type.includes('running')) return 'default'
    if (type.includes('error') || type.includes('fail')) return 'destructive'
    if (type.includes('repair') || type.includes('iteration')) return 'warning'
    return 'muted'
  }

  // Title string for the header
  const titleText = `Run ${runId}`

  return (
    <Info_Page
      loading={loading}
      error={error ?? undefined}
      empty={!detail && !loading && !error ? 'Run not found' : undefined}
    >
      <Info_Page.Header title={titleText} />

      {detail && (
        <Info_Page.Content>
          {/* Back button + Run Summary */}
          <Info_Section title="Summary">
            <div className="px-4 pt-2 pb-1">
              <button
                onClick={handleBack}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to agent
              </button>
            </div>
            <Info_Table>
              <Info_Table.Row label="Run ID" value={detail.runId} />
              <Info_Table.Row label="Started">
                {formatTime(detail.startedAt)}
              </Info_Table.Row>
              <Info_Table.Row label="Depth Mode">
                <Info_Badge color="default">{detail.depthMode}</Info_Badge>
              </Info_Table.Row>
              <Info_Table.Row label="Tool Calls">
                {detail.toolCallCount}
              </Info_Table.Row>
              <Info_Table.Row label="Status">
                {isLiveRun && liveRunState?.isRunning ? (
                  <Info_Badge color="default">Running</Info_Badge>
                ) : (
                  <Info_Badge color="success">Completed</Info_Badge>
                )}
              </Info_Table.Row>
            </Info_Table>
          </Info_Section>

          {/* Pipeline Visualization */}
          <Info_Section title="Pipeline">
            <div className="px-4 py-3 space-y-1">
              {detail.completedStages.length === 0 && detail.currentStage < 0 ? (
                <div className="text-sm text-muted-foreground">No stage data available</div>
              ) : (
                /* Render stages as sequential blocks */
                Array.from({ length: Math.max(
                  ...detail.completedStages,
                  detail.currentStage,
                  isLiveRun ? (liveRunState?.currentStage ?? -1) : -1,
                  0
                ) + 1 }, (_, i) => i).map((stageId) => {
                  const status = getStageStatus(stageId)
                  const stageName = detail.events.find(
                    e => (e.type === 'stage_started' || e.type === 'stage_completed') &&
                      (e.data as Record<string, unknown>).stage === stageId
                  )?.data?.stageName as string | undefined

                  return (
                    <React.Fragment key={stageId}>
                    <div
                      className={cn(
                        "flex items-center gap-3 py-2 px-3 rounded-[8px] text-sm",
                        status === 'completed' && "bg-emerald-500/5 border border-emerald-500/20",
                        status === 'running' && "bg-blue-500/5 border border-blue-500/20",
                        status === 'pending' && "bg-foreground/[0.02] border border-border/30",
                      )}
                    >
                      {status === 'completed' && <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />}
                      {status === 'running' && <Loader2 className="h-4 w-4 text-blue-500 shrink-0 animate-spin" />}
                      {status === 'pending' && <Circle className="h-4 w-4 text-muted-foreground/40 shrink-0" />}

                      <span className="font-mono text-xs text-muted-foreground w-4 shrink-0">{stageId}</span>
                      <span className="font-medium">{stageName ?? `Stage ${stageId}`}</span>
                    </div>
                  </React.Fragment>
                  )
                })
              )}

              {/* Repair iterations indicator */}
              {detail.events.filter(e => e.type === 'repair_iteration').length > 0 && (
                <div className="flex items-center gap-2 pt-2 text-sm text-muted-foreground">
                  <RotateCw className="h-3.5 w-3.5" />
                  <span>
                    {detail.events.filter(e => e.type === 'repair_iteration').length} repair iteration(s)
                  </span>
                </div>
              )}
            </div>
          </Info_Section>

          {/* Event Timeline */}
          <Info_Section title="Event Log">
            <div className="px-4 py-3 space-y-1">
              {detail.events.length === 0 ? (
                <div className="text-sm text-muted-foreground">No events recorded</div>
              ) : (
                detail.events.map((event, index) => (
                  <div key={index} className="text-sm">
                    <button
                      onClick={() => toggleEvent(index)}
                      className="flex items-center gap-2 w-full py-1.5 text-left hover:bg-foreground/[0.02] rounded px-2 -mx-2"
                    >
                      <span className="text-xs text-muted-foreground font-mono shrink-0 w-[72px]">
                        {formatTime(event.timestamp)}
                      </span>
                      <Info_Badge color={getEventBadgeColor(event.type)}>
                        {event.type}
                      </Info_Badge>
                    </button>
                    {expandedEvents.has(index) && (
                      <div className="ml-[80px] mb-2 p-2 rounded bg-foreground/[0.02] border border-border/30 overflow-x-auto">
                        <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap">
                          {JSON.stringify(event.data, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </Info_Section>

          {/* Evidence Intermediates */}
          {detail.evidence.intermediates && Object.keys(detail.evidence.intermediates).length > 0 && (
            <Info_Section title="Evidence Intermediates">
              <div className="px-4 py-3 space-y-2">
                {Object.entries(detail.evidence.intermediates).map(([filename, data]) => (
                  <details key={filename} className="text-sm">
                    <summary className="cursor-pointer font-medium py-1 hover:text-foreground/80">
                      {filename}
                    </summary>
                    <div className="mt-1 p-2 rounded bg-foreground/[0.02] border border-border/30 overflow-x-auto">
                      <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap">
                        {JSON.stringify(data, null, 2)}
                      </pre>
                    </div>
                  </details>
                ))}
              </div>
            </Info_Section>
          )}

        </Info_Page.Content>
      )}
    </Info_Page>
  )
}
