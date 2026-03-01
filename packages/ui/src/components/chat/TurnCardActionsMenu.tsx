import * as React from 'react'
import { MoreHorizontal, FileDiff, ArrowUpRight, Trash2, RotateCcw, GitBranch, Copy } from 'lucide-react'
import { SimpleDropdown, SimpleDropdownItem } from '../ui/SimpleDropdown'
import { cn } from '../../lib/utils'

export interface TurnCardActionsMenuProps {
  /** Callback to open turn details in a new window */
  onOpenDetails?: () => void
  /** Callback to open all edits/writes in multi-file diff view */
  onOpenMultiFileDiff?: () => void
  /** Whether this turn has any Edit or Write activities */
  hasEditOrWriteActivities?: boolean
  /** Additional className for the outer container */
  className?: string
  /** Callback to delete this turn */
  onDelete?: () => void
  /** Callback to restore checkpoint to end of this turn */
  onRestore?: () => void
  /** Callback to branch from this turn into a new conversation */
  onBranch?: () => void
  /** Callback to copy turn response content */
  onCopy?: () => void
  /** Whether the turn is complete (restore only available for complete turns) */
  isComplete?: boolean
}

/**
 * TurnCardActionsMenu - Inline icon button bar + overflow dropdown for TurnCard actions
 *
 * Inline icon buttons (conversation management):
 * - Restore (RotateCcw) — restore checkpoint
 * - Branch (GitBranch) — fork conversation
 * - Delete (Trash2) — delete this turn
 * - Copy (Copy) — copy response text
 *
 * Overflow dropdown (dev actions):
 * - View file changes
 * - View turn details
 */
export function TurnCardActionsMenu({
  onOpenDetails,
  onOpenMultiFileDiff,
  hasEditOrWriteActivities,
  className,
  onDelete,
  onRestore,
  onBranch,
  onCopy,
  isComplete,
}: TurnCardActionsMenuProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false)

  const hasConvActions = onDelete || onRestore || onBranch || onCopy
  const hasDevActions = onOpenDetails || (onOpenMultiFileDiff && hasEditOrWriteActivities)

  // Don't render if no actions available
  if (!hasConvActions && !hasDevActions) {
    return null
  }

  const buttonClass = cn(
    "w-6 h-6 flex items-center justify-center rounded-[6px] transition-colors",
    "text-muted-foreground/50 hover:text-foreground hover:bg-foreground/5",
    "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
  )

  return (
    <>
      <div
        className={cn(
          "flex items-center gap-0.5 rounded-lg px-1 py-0.5",
          "opacity-0 group-hover:opacity-100 transition-opacity",
          "bg-background shadow-minimal",
          className
        )}
        onClick={e => e.stopPropagation()}
      >
        {/* Inline icon buttons for conversation management */}
        {onCopy && (
          <button className={buttonClass} onClick={onCopy} title="Copy response">
            <Copy className="w-3.5 h-3.5" />
          </button>
        )}
        {onRestore && isComplete && (
          <button className={buttonClass} onClick={onRestore} title="Restore to here">
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        )}
        {onBranch && (
          <button className={buttonClass} onClick={onBranch} title="Branch from here">
            <GitBranch className="w-3.5 h-3.5" />
          </button>
        )}
        {onDelete && (
          <button
            className={cn(buttonClass, "hover:text-destructive")}
            onClick={() => setShowDeleteConfirm(true)}
            title="Delete turn"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Overflow dropdown for dev actions */}
        {hasDevActions && (
          <SimpleDropdown
            align="end"
            trigger={
              <div
                role="button"
                tabIndex={0}
                className={cn(
                  "w-6 h-6 flex items-center justify-center rounded-[6px] transition-colors",
                  "text-muted-foreground/50 hover:text-foreground hover:bg-foreground/5",
                  "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                )}
              >
                <MoreHorizontal className="w-3.5 h-3.5" />
              </div>
            }
          >
            {onOpenMultiFileDiff && hasEditOrWriteActivities && (
              <SimpleDropdownItem
                onClick={onOpenMultiFileDiff}
                icon={<FileDiff />}
              >
                View file changes
              </SimpleDropdownItem>
            )}
            {onOpenDetails && (
              <SimpleDropdownItem
                onClick={onOpenDetails}
                icon={<ArrowUpRight />}
              >
                View turn details
              </SimpleDropdownItem>
            )}
          </SimpleDropdown>
        )}
      </div>
      {showDeleteConfirm && onDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowDeleteConfirm(false)}>
          <div className="bg-background rounded-lg p-4 shadow-lg max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-medium mb-2">Delete this turn?</p>
            <p className="text-xs text-muted-foreground mb-4">This will remove this turn from the conversation. This cannot be undone.</p>
            <div className="flex justify-end gap-2">
              <button
                className="px-3 py-1.5 text-xs rounded-md bg-muted hover:bg-muted/80 transition-colors"
                onClick={() => setShowDeleteConfirm(false)}
              >
                Cancel
              </button>
              <button
                className="px-3 py-1.5 text-xs rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
                onClick={() => { onDelete(); setShowDeleteConfirm(false) }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
