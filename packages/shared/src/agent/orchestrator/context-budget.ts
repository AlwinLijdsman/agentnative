/**
 * Context Budget Manager
 *
 * Manages the 200K context window budget for LLM API calls.
 * Dynamically calculates max_tokens to prevent context overflow,
 * and truncates retrieval context by relevance score when needed.
 *
 * Key behaviors:
 * - Calculates safe max_tokens: min(desired, contextWindow - estimatedInput)
 * - Throws ContextOverflowError when not even minOutput fits
 * - Truncates retrieval paragraphs by relevance score to fit token budget
 * - Uses conservative 4-chars-per-token estimation with 10% safety margin
 */

import type { RetrievalParagraph } from './types.ts';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default context window size (Claude Opus 4.6). */
const DEFAULT_CONTEXT_WINDOW = 200_000;

/** Default minimum output budget — ensures at least this many output tokens. */
const DEFAULT_MIN_OUTPUT = 4_096;

/** Safety margin multiplier for token estimation (10% over-estimate). */
const TOKEN_ESTIMATION_SAFETY_MARGIN = 1.1;

/** Approximate characters per token for estimation. */
const CHARS_PER_TOKEN = 4;

// ============================================================================
// ERRORS
// ============================================================================

/**
 * Thrown when estimated input + minimum output exceeds the context window.
 * The caller should reduce input (truncate retrieval context) or increase
 * the context window (use a larger model).
 */
export class ContextOverflowError extends Error {
  constructor(
    public readonly estimatedInput: number,
    public readonly desiredOutput: number,
    public readonly contextWindow: number,
  ) {
    super(
      `Context overflow: input ~${estimatedInput} + min output ${desiredOutput} = ` +
      `${estimatedInput + desiredOutput} > context window ${contextWindow}. ` +
      'Reduce input context or use a model with a larger context window.',
    );
    this.name = 'ContextOverflowError';
  }
}

// ============================================================================
// CONTEXT BUDGET MANAGER
// ============================================================================

export class ContextBudgetManager {
  private readonly contextWindow: number;
  private readonly minOutput: number;

  constructor(
    contextWindow = DEFAULT_CONTEXT_WINDOW,
    minOutput = DEFAULT_MIN_OUTPUT,
  ) {
    this.contextWindow = contextWindow;
    this.minOutput = minOutput;
  }

  /**
   * Calculate safe max_tokens for an API call.
   *
   * Returns min(desiredOutput, contextWindow - estimatedInput).
   * Throws ContextOverflowError if not even minOutput fits.
   *
   * @param estimatedInputTokens - Estimated input tokens (system + user message)
   * @param desiredOutputTokens - Desired output token budget
   * @returns Safe max_tokens value that fits within the context window
   */
  calculateMaxTokens(estimatedInputTokens: number, desiredOutputTokens: number): number {
    const available = this.contextWindow - estimatedInputTokens;

    if (available < this.minOutput) {
      throw new ContextOverflowError(
        estimatedInputTokens,
        this.minOutput,
        this.contextWindow,
      );
    }

    return Math.min(desiredOutputTokens, available);
  }

  /**
   * Truncate retrieval context to fit within a token budget.
   *
   * Keeps highest-relevance paragraphs first, drops lowest-ranked.
   * Uses conservative token estimation with safety margin.
   *
   * @param paragraphs - Retrieval paragraphs sorted or unsorted
   * @param maxTokens - Maximum token budget for the retrieval context
   * @returns Paragraphs that fit within the budget, sorted by relevance (highest first)
   */
  truncateRetrievalContext(
    paragraphs: readonly RetrievalParagraph[],
    maxTokens: number,
  ): RetrievalParagraph[] {
    // Sort by relevance score (highest first)
    const sorted = [...paragraphs].sort((a, b) => b.score - a.score);

    const result: RetrievalParagraph[] = [];
    let tokenCount = 0;

    for (const paragraph of sorted) {
      const paragraphTokens = estimateTokens(paragraph.text);
      if (tokenCount + paragraphTokens > maxTokens) break;
      result.push(paragraph);
      tokenCount += paragraphTokens;
    }

    return result;
  }

  /** Get the configured context window size. */
  getContextWindow(): number {
    return this.contextWindow;
  }

  /** Get the configured minimum output budget. */
  getMinOutput(): number {
    return this.minOutput;
  }
}

// ============================================================================
// TOKEN ESTIMATION
// ============================================================================

/**
 * Estimate token count from text length.
 *
 * Uses ~4 characters per token with a 10% safety margin (over-estimates).
 * For precise counting, use the Anthropic token counting API.
 *
 * @param text - Text to estimate tokens for
 * @returns Estimated token count (conservative — over-estimates by ~10%)
 */
export function estimateTokens(text: string): number {
  return Math.ceil((text.length / CHARS_PER_TOKEN) * TOKEN_ESTIMATION_SAFETY_MARGIN);
}
