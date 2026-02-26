import * as React from 'react'
import { X, Check, AlertTriangle, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SkillAvatar } from '@/components/ui/skill-avatar'
import { SourceAvatar } from '@/components/ui/source-avatar'
import type { LoadedSkill, LoadedSource } from '../../../shared/types'
import type { MentionItemType } from './mention-menu'

// ============================================================================
// Types
// ============================================================================

export interface MentionBadgeProps {
  type: MentionItemType
  label: string
  /** Skill data for skill mentions */
  skill?: LoadedSkill
  /** Source data for source mentions */
  source?: LoadedSource
  /** Workspace ID for skill avatar */
  workspaceId?: string
  /** Called when the remove button is clicked */
  onRemove?: () => void
  /** Additional className */
  className?: string
}

/** A resolved source binding for an agent - includes the source data if found */
export interface ResolvedAgentSource {
  slug: string
  required: boolean
  /** The actual source if found in the workspace */
  source?: LoadedSource
}

// ============================================================================
// MentionBadge Component
// ============================================================================

/**
 * MentionBadge - Inline badge for displaying active @mentions
 *
 * Used in the ActiveMentionBadges row above the input field to show
 * skills and sources that have been mentioned via @.
 */
export function MentionBadge({
  type,
  label,
  skill,
  source,
  workspaceId,
  onRemove,
  className,
}: MentionBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 h-6 pl-1 pr-1.5 rounded-[6px]',
        'bg-foreground/5 text-[12px] text-foreground',
        'transition-colors hover:bg-foreground/8',
        className
      )}
    >
      {/* Icon based on type */}
      {type === 'agent' && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" className="text-muted-foreground shrink-0">
          <circle cx="12" cy="12" r="8" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      )}
      {type === 'skill' && skill && (
        <SkillAvatar skill={skill} size="xs" workspaceId={workspaceId} />
      )}
      {type === 'source' && source && (
        <SourceAvatar source={source} size="xs" />
      )}

      {/* Label */}
      <span className="truncate max-w-[100px]">{label}</span>

      {/* Remove button */}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="shrink-0 h-4 w-4 rounded-[3px] flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-colors"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  )
}

// ============================================================================
// ActiveMentionBadges Component
// ============================================================================

export interface ParsedMention {
  id: string
  type: MentionItemType
  label: string
  skill?: LoadedSkill
  source?: LoadedSource
}

export interface ActiveMentionBadgesProps {
  /** Parsed mentions to display */
  mentions: ParsedMention[]
  /** Workspace ID for skill avatars */
  workspaceId?: string
  /** Called when a mention is removed */
  onRemove?: (id: string, type: MentionItemType) => void
  /** Additional className for the container */
  className?: string
}

/**
 * ActiveMentionBadges - Row of mention badges shown above the input
 *
 * Displays all active @mentions (skills and sources) as removable badges.
 * Hidden when there are no mentions.
 */
export function ActiveMentionBadges({
  mentions,
  workspaceId,
  onRemove,
  className,
}: ActiveMentionBadgesProps) {
  if (mentions.length === 0) return null

  return (
    <div className={cn('flex flex-wrap gap-1 px-4 pt-2', className)}>
      {mentions.map((mention) => (
        <MentionBadge
          key={`${mention.type}-${mention.id}`}
          type={mention.type}
          label={mention.label}
          skill={mention.skill}
          source={mention.source}
          workspaceId={workspaceId}
          onRemove={onRemove ? () => onRemove(mention.id, mention.type) : undefined}
        />
      ))}
    </div>
  )
}

// ============================================================================
// AgentSourceBadges Component
// ============================================================================

/**
 * Derive usability status from a source's connection state.
 * - 'usable': source exists and is connected/untested
 * - 'needs_auth': source exists but needs authentication
 * - 'missing': source not found in workspace
 */
function getSourceStatus(resolved: ResolvedAgentSource): 'usable' | 'needs_auth' | 'missing' {
  if (!resolved.source) return 'missing'
  const status = resolved.source.config.connectionStatus
  if (status === 'needs_auth') return 'needs_auth'
  if (status === 'failed') return 'needs_auth'
  return 'usable'
}

export interface AgentSourceBadgesProps {
  /** Resolved source bindings for the agent */
  resolvedSources: ResolvedAgentSource[]
  /** Additional className for the container */
  className?: string
}

/**
 * AgentSourceBadges - Read-only badges showing sources an agent requires.
 *
 * Displayed below the input when an agent is @mentioned, so the user
 * can see which sources will be auto-enabled.
 */
export function AgentSourceBadges({
  resolvedSources,
  className,
}: AgentSourceBadgesProps) {
  if (resolvedSources.length === 0) return null

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5 px-4 py-1.5', className)}>
      <span className="text-[11px] text-muted-foreground select-none">Sources:</span>
      {resolvedSources.map((resolved) => {
        const status = getSourceStatus(resolved)
        return (
          <span
            key={resolved.slug}
            className={cn(
              'inline-flex items-center gap-1 h-5 pl-1 pr-1.5 rounded-[5px]',
              'bg-foreground/5 text-[11px] text-foreground',
            )}
          >
            {/* Source icon or fallback */}
            {resolved.source ? (
              <SourceAvatar source={resolved.source} size="xs" />
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground shrink-0">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/>
                <path d="M2 12h20"/>
              </svg>
            )}

            {/* Source name */}
            <span className="truncate max-w-[120px]">
              {resolved.source?.config.name ?? resolved.slug}
            </span>

            {/* Status indicator */}
            {status === 'usable' && (
              <Check className="h-3 w-3 text-emerald-500 shrink-0" />
            )}
            {status === 'needs_auth' && (
              <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
            )}
            {status === 'missing' && (
              <XCircle className="h-3 w-3 text-destructive shrink-0" />
            )}
          </span>
        )
      })}
    </div>
  )
}
