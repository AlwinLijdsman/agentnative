/**
 * Error Classifier
 *
 * Deterministic regex-based error classification for agent workflows.
 * Ported from error_classification.py patterns.
 *
 * Classification order: status code → transient → auth → config → resource → unknown
 */

import type { ClassifiedError, ErrorCategory } from './types.ts';

// ============================================================
// Pattern Definitions
// ============================================================

const TRANSIENT_PATTERNS =
  /timeout|timed?\s*out|rate.?limit|too many requests|retry|503|overloaded|throttl|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|socket hang up/i;

const AUTH_PATTERNS =
  /unauthorized|forbidden|invalid.?key|expired.?token|auth|credential|api.?key|access.?denied|permission.?denied/i;

const CONFIG_PATTERNS =
  /invalid.?config|missing.?field|schema|validation|not.?found.?in.?config|invalid.?parameter|malformed|parse.?error/i;

const RESOURCE_PATTERNS =
  /not.?found|404|no.?such|does.?not.?exist|empty.?result|no.?data|no.?results|table.?not.?found|column.?not.?found/i;

// ============================================================
// Status Code Sets
// ============================================================

const TRANSIENT_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504, 529]);
const AUTH_STATUS_CODES = new Set([401, 403]);

// ============================================================
// Recovery Actions
// ============================================================

const RECOVERY_ACTIONS: Record<ErrorCategory, string[]> = {
  transient: ['Retry with exponential backoff', 'Check service status', 'Reduce request rate'],
  auth: ['Check API key configuration', 'Re-authenticate the source', 'Verify credentials are not expired'],
  config: ['Validate agent config.json', 'Check source configuration', 'Review AGENT.md frontmatter'],
  resource: ['Verify knowledge base is populated', 'Check paragraph ID exists', 'Reformulate search query'],
  unknown: ['Check application logs', 'Report the error for investigation'],
};

// ============================================================
// Classifier
// ============================================================

/**
 * Classify an error deterministically using status codes and regex patterns.
 *
 * Classification priority:
 * 1. HTTP status code (most reliable signal)
 * 2. Transient patterns (timeouts, rate limits)
 * 3. Auth patterns (unauthorized, forbidden)
 * 4. Config patterns (validation, schema)
 * 5. Resource patterns (not found, no data)
 * 6. Unknown (fallback)
 *
 * @param error - Error message string or Error object
 * @param statusCode - Optional HTTP status code
 * @returns Classified error with category, recoverability, and suggested actions
 */
export function classifyError(error: string | Error, statusCode?: number): ClassifiedError {
  const message = typeof error === 'string' ? error : error.message;

  // 1. Status code classification (highest priority)
  if (statusCode !== undefined) {
    if (TRANSIENT_STATUS_CODES.has(statusCode)) {
      return buildResult('transient', message, true, statusCode === 429 ? 30 : 5);
    }
    if (AUTH_STATUS_CODES.has(statusCode)) {
      return buildResult('auth', message, false);
    }
    if (statusCode === 404) {
      return buildResult('resource', message, false);
    }
  }

  // 2. Pattern matching (ordered by specificity)
  if (TRANSIENT_PATTERNS.test(message)) {
    return buildResult('transient', message, true, 5);
  }

  if (AUTH_PATTERNS.test(message)) {
    return buildResult('auth', message, false);
  }

  if (CONFIG_PATTERNS.test(message)) {
    return buildResult('config', message, false);
  }

  if (RESOURCE_PATTERNS.test(message)) {
    return buildResult('resource', message, false);
  }

  // 3. Fallback
  return buildResult('unknown', message, false);
}

/**
 * Build a ClassifiedError result
 */
function buildResult(
  category: ErrorCategory,
  message: string,
  isRecoverable: boolean,
  retryAfterSeconds?: number
): ClassifiedError {
  return {
    category,
    isRecoverable,
    suggestedActions: RECOVERY_ACTIONS[category],
    diagnostic: `[${category}] ${message}`,
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
  };
}
