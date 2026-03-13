/**
 * JSONPreviewOverlay - Interactive JSON tree viewer overlay
 *
 * Uses @uiw/react-json-view for expand/collapse tree navigation.
 * Wraps PreviewOverlay for consistent presentation with other overlays.
 *
 * Size-aware rendering:
 * - Payloads > 100 KB skip deepParseJson (expensive recursive parsing)
 * - Payloads > 100 KB auto-collapse to depth 2
 * - Arrays > 50 items are truncated with a sentinel marker
 */

import * as React from 'react'
import { useMemo } from 'react'
import JsonView from '@uiw/react-json-view'
import { vscodeTheme } from '@uiw/react-json-view/vscode'
import { githubLightTheme } from '@uiw/react-json-view/githubLight'
import { Braces, Copy, Check } from 'lucide-react'
import { ContentFrame } from './ContentFrame'
import { PreviewOverlay } from './PreviewOverlay'

// ── Size thresholds ──────────────────────────────────────────────────────

/** Skip deepParseJson and auto-collapse above this size */
const SIZE_THRESHOLD_BYTES = 100_000

/** Cap arrays at this many entries */
const ARRAY_TRUNCATE_LIMIT = 50

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Recursively parse stringified JSON within JSON values.
 * Handles nested patterns like {"result": "{\"nested\": \"value\"}"}
 * so they display as expandable tree nodes instead of plain strings.
 */
function deepParseJson(value: unknown): unknown {
  if (value === null || value === undefined) return value

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        return deepParseJson(JSON.parse(trimmed))
      } catch {
        return value
      }
    }
    return value
  }

  if (Array.isArray(value)) {
    return value.map(deepParseJson)
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      result[key] = deepParseJson(val)
    }
    return result
  }

  return value
}

/**
 * Walk the JSON tree and cap arrays longer than `limit`.
 * Appends a string sentinel so the user sees truncation in the tree.
 * Returns the processed data and the number of arrays that were truncated.
 */
function truncateLargeArrays(
  value: unknown,
  limit: number,
): { data: unknown; truncatedCount: number } {
  let truncatedCount = 0

  function walk(v: unknown): unknown {
    if (v === null || v === undefined || typeof v !== 'object') return v

    if (Array.isArray(v)) {
      if (v.length > limit) {
        truncatedCount++
        const sliced = v.slice(0, limit).map(walk)
        sliced.push(`... and ${v.length - limit} more items`)
        return sliced
      }
      return v.map(walk)
    }

    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(v)) {
      result[key] = walk(val)
    }
    return result
  }

  const data = walk(value)
  return { data, truncatedCount }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(0)} KB`
}

// ── Types ────────────────────────────────────────────────────────────────

export interface JSONPreviewOverlayProps {
  /** Whether the overlay is visible */
  isOpen: boolean
  /** Callback when the overlay should close */
  onClose: () => void
  /** Parsed JSON data to display */
  data: unknown
  /** File path — shows dual-trigger menu badge with "Open" + "Reveal in Finder" */
  filePath?: string
  /** Title to display in header (fallback when no filePath) */
  title?: string
  /** Theme mode */
  theme?: 'light' | 'dark'
  /** Optional error message */
  error?: string
  /** Approximate byte size of the raw JSON — enables size-aware rendering */
  sizeBytes?: number
  /** Render inline without dialog (for playground) */
  embedded?: boolean
}

// ── Themes ───────────────────────────────────────────────────────────────

const craftAgentDarkTheme = {
  ...vscodeTheme,
  '--w-rjv-font-family': 'var(--font-mono, ui-monospace, monospace)',
  '--w-rjv-background-color': 'transparent',
}

const craftAgentLightTheme = {
  ...githubLightTheme,
  '--w-rjv-font-family': 'var(--font-mono, ui-monospace, monospace)',
  '--w-rjv-background-color': 'transparent',
}

// ── Component ────────────────────────────────────────────────────────────

export function JSONPreviewOverlay({
  isOpen,
  onClose,
  data,
  filePath,
  title = 'JSON',
  theme = 'dark',
  error,
  sizeBytes,
  embedded,
}: JSONPreviewOverlayProps) {
  const jsonTheme = useMemo(() => {
    return theme === 'dark' ? craftAgentDarkTheme : craftAgentLightTheme
  }, [theme])

  const isLargePayload = (sizeBytes ?? 0) > SIZE_THRESHOLD_BYTES

  // Process data: deep-parse nested JSON strings (skip for large payloads),
  // then truncate oversized arrays.
  const { processedData, truncatedCount } = useMemo(() => {
    const parsed = isLargePayload ? data : deepParseJson(data)
    const { data: truncated, truncatedCount } = truncateLargeArrays(parsed, ARRAY_TRUNCATE_LIMIT)
    return { processedData: truncated as object, truncatedCount }
  }, [data, isLargePayload])

  // Build subtitle for size-aware info
  const subtitle = useMemo(() => {
    const parts: string[] = []
    if (isLargePayload && sizeBytes) {
      parts.push(`Large payload (${formatBytes(sizeBytes)}) — collapsed to depth 2`)
    }
    if (truncatedCount > 0) {
      parts.push(
        `${truncatedCount} array${truncatedCount > 1 ? 's' : ''} capped at ${ARRAY_TRUNCATE_LIMIT} items`
      )
    }
    return parts.length > 0 ? parts.join(', ') : undefined
  }, [isLargePayload, sizeBytes, truncatedCount])

  return (
    <PreviewOverlay
      isOpen={isOpen}
      onClose={onClose}
      typeBadge={{
        icon: Braces,
        label: 'JSON',
        variant: 'blue',
      }}
      filePath={filePath}
      title={title}
      subtitle={subtitle}
      theme={theme}
      error={error ? { label: 'Parse Error', message: error } : undefined}
      embedded={embedded}
      className="bg-foreground-3"
    >
      <ContentFrame title="JSON">
        <div className="flex-1 overflow-y-auto min-h-0 p-4">
          <div className="p-4">
            <JsonView
              value={processedData}
              style={jsonTheme}
              collapsed={isLargePayload ? 2 : false}
              enableClipboard={true}
              displayDataTypes={false}
              shortenTextAfterLength={100}
            >
              {/* Custom copy icon using lucide-react */}
              <JsonView.Copied
                render={(props) => {
                  const isCopied = (props as Record<string, unknown>)['data-copied']
                  return isCopied ? (
                    <Check
                      className="ml-1.5 inline-flex cursor-pointer text-green-500"
                      size={10}
                      onClick={props.onClick}
                    />
                  ) : (
                    <Copy
                      className="ml-1.5 inline-flex cursor-pointer text-muted-foreground hover:text-foreground"
                      size={10}
                      onClick={props.onClick}
                    />
                  )
                }}
              />
            </JsonView>
          </div>
        </div>
      </ContentFrame>
    </PreviewOverlay>
  )
}
