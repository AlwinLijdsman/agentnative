import * as React from 'react'
import { Pencil, Trash2, GitBranch, Copy, RotateCcw } from 'lucide-react'
import { cn } from '../../lib/utils'

export interface UserMessageActionsMenuProps {
  /** Callback to enter edit mode for this message */
  onEdit?: () => void
  /** Callback to delete this single message */
  onDelete?: () => void
  /** Callback to branch from this message into a new conversation */
  onBranch?: () => void
  /** Callback to copy message content to clipboard */
  onCopy?: () => void
  /** Callback to restore checkpoint at this message */
  onRestore?: () => void
  /** Additional className for the outer container */
  className?: string
}

/**
 * UserMessageActionsMenu - Inline icon button bar for user message hover actions
 *
 * Shows a horizontal bar of icon-only buttons that appears on hover:
 * - Edit (Pencil) — triggers edit mode
 * - Branch (GitBranch) — forks to new conversation
 * - Delete (Trash2) — deletes this single message
 * - Copy (Copy) — copies message content
 * - Restore (RotateCcw) — restores checkpoint at this message
 */
export function UserMessageActionsMenu({
  onEdit,
  onDelete,
  onBranch,
  onCopy,
  onRestore,
  className,
}: UserMessageActionsMenuProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false)

  // Don't render if no actions available
  if (!onEdit && !onDelete && !onBranch && !onCopy && !onRestore) {
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
      >
        {onEdit && (
          <button className={buttonClass} onClick={onEdit} title="Edit message">
            <Pencil className="w-3.5 h-3.5" />
          </button>
        )}
        {onCopy && (
          <button className={buttonClass} onClick={onCopy} title="Copy message">
            <Copy className="w-3.5 h-3.5" />
          </button>
        )}
        {onBranch && (
          <button className={buttonClass} onClick={onBranch} title="Branch from here">
            <GitBranch className="w-3.5 h-3.5" />
          </button>
        )}
        {onRestore && (
          <button className={buttonClass} onClick={onRestore} title="Restore checkpoint">
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        )}
        {onDelete && (
          <button
            className={cn(buttonClass, "hover:text-destructive")}
            onClick={() => setShowDeleteConfirm(true)}
            title="Delete message"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {showDeleteConfirm && onDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowDeleteConfirm(false)}>
          <div className="bg-background rounded-lg p-4 shadow-lg max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-medium mb-2">Delete this message?</p>
            <p className="text-xs text-muted-foreground mb-4">This will remove this message from the conversation. This cannot be undone.</p>
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
