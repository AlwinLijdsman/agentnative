/**
 * Orchestrator LLM Client
 *
 * Thin streaming wrapper around the Anthropic SDK for orchestrator pipeline calls.
 * Uses Claude Max OAuth (`authToken` + `oauth-2025-04-20` beta header) —
 * NOT apiKey. Adaptive thinking always enabled. Effort defaults to `max`
 * (Opus 4.6 only), overridable per-stage via LlmCallOptions.effort.
 *
 * Key design decisions:
 * - Fresh auth token fetched EVERY call (handles refresh/expiry)
 * - `apiKey` explicitly null to prevent env var pickup
 * - Streaming REQUIRED for max_tokens > 21,333 (API constraint)
 * - No `temperature` parameter (incompatible with adaptive thinking)
 * - No tools (orchestrator calls MCP tools programmatically, not via LLM)
 * - Dynamic `max_tokens` via ContextBudgetManager (fits within 200K window)
 */

import Anthropic from '@anthropic-ai/sdk';
import type { LlmCallOptions, LlmCallResult, StreamEvent } from './types.ts';
import { ContextBudgetManager, estimateTokens } from './context-budget.ts';

// ============================================================================
// CONSTANTS
// ============================================================================

/** OAuth beta header required for Bearer token auth (Claude Max). */
const OAUTH_BETA_HEADER = 'oauth-2025-04-20';

/** Default model for orchestrator calls. */
const DEFAULT_MODEL = 'claude-opus-4-6';

/** Default desired output tokens when not specified. */
const DEFAULT_DESIRED_MAX_TOKENS = 128_000;

/** Default Anthropic API base URL. */
const DEFAULT_BASE_URL = 'https://api.anthropic.com';

/**
 * Default reasoning effort level — maximum thinking power.
 * 'max' is Opus 4.6 only. Claude Max subscription = no per-token cost penalty.
 * Override per-stage via LlmCallOptions.effort.
 */
const DEFAULT_EFFORT = 'max';

// ============================================================================
// ORCHESTRATOR LLM CLIENT
// ============================================================================

export class OrchestratorLlmClient {
  private readonly baseURL: string;
  private readonly budgetManager: ContextBudgetManager;

  /**
   * @param getAuthToken - Injected async function that returns a fresh OAuth token.
   *   Called before every API call to handle token refresh/expiry.
   * @param baseURL - Custom API base URL (defaults to Anthropic's API or ANTHROPIC_BASE_URL env var).
   * @param contextWindow - Context window size in tokens (default: 200,000).
   * @param minOutputBudget - Minimum output token budget (default: 4,096).
   */
  constructor(
    private readonly getAuthToken: () => Promise<string>,
    baseURL?: string,
    contextWindow?: number,
    minOutputBudget?: number,
  ) {
    this.baseURL = baseURL || process.env['ANTHROPIC_BASE_URL'] || DEFAULT_BASE_URL;
    this.budgetManager = new ContextBudgetManager(contextWindow, minOutputBudget);
  }

  /**
   * Make a single streaming LLM call with adaptive thinking at maximum effort.
   *
   * Creates a fresh Anthropic client per call (ensures token freshness).
   * Uses `messages.stream()` + `finalMessage()` for all calls (streaming
   * is required when max_tokens > 21,333).
   *
   * @param options - Call options (system prompt, user message, model, etc.)
   * @returns Complete result with text, thinking summary, usage, and stop reason
   */
  async call(options: LlmCallOptions): Promise<LlmCallResult> {
    // Get fresh token EVERY call (handles refresh/expiry)
    const authToken = await this.getAuthToken();

    const client = new Anthropic({
      authToken,             // Bearer auth — Claude Max OAuth (NOT apiKey)
      apiKey: null,          // Explicitly null — prevent env var pickup
      baseURL: this.baseURL,
      defaultHeaders: {
        'anthropic-beta': OAUTH_BETA_HEADER,
      },
    });

    const model = options.model || DEFAULT_MODEL;

    // Dynamic max_tokens — MUST fit within context window
    const estimatedInput = estimateTokens(options.systemPrompt + options.userMessage);
    const maxTokens = this.budgetManager.calculateMaxTokens(
      estimatedInput,
      options.desiredMaxTokens || DEFAULT_DESIRED_MAX_TOKENS,
    );

    // Resolve effort level — default 'max' (Opus 4.6), overridable per-stage
    const effort = options.effort || DEFAULT_EFFORT;

    // Build stream parameters
    // SDK v0.71.2 type gaps (all supported by API at runtime):
    //   - 'adaptive' thinking not in ThinkingConfigParam (only 'enabled'|'disabled') → cast via unknown
    //   - output_config not in stable MessageCreateParams (beta-only) → extra property, no cast needed
    //   - effort 'max' not in BetaOutputConfig union (only 'low'|'medium'|'high') → string at runtime
    // Remove casts when SDK types catch up.
    const streamParams = {
      model,
      max_tokens: maxTokens,
      system: options.systemPrompt,
      messages: [{ role: 'user' as const, content: options.userMessage }],

      // Adaptive thinking — let Claude decide when and how much to think (G13).
      // Double cast: SDK lacks 'adaptive' type, no overlap with 'enabled'|'disabled' union (G17).
      thinking: { type: 'adaptive' } as unknown as Anthropic.ThinkingConfigParam,

      // Effort level — controls reasoning depth. 'max' = absolute maximum (Opus 4.6 only).
      // Not in stable SDK types (beta-only). Extra property on variable — passes TS checks
      // because streamParams is an object literal, not constrained to a strict interface.
      // If SDK adds an incompatible output_config type in the future, this will need a cast.
      output_config: { effort },

      // NO temperature — incompatible with adaptive thinking (API returns 400) (G11)
      // NO tools — orchestrator calls MCP tools programmatically (G12)
    };

    // STREAMING is REQUIRED for max_tokens > 21,333
    // Use .stream() + .finalMessage() for all calls
    const stream = client.messages.stream(streamParams);

    // Emit progress events for UI if callback provided
    if (options.onStreamEvent) {
      const callback = options.onStreamEvent;
      stream.on('text', (textDelta: string) => {
        callback({ type: 'text_delta', text: textDelta });
      });
      stream.on('thinking', (thinkingDelta: string) => {
        callback({ type: 'thinking_delta', thinking: thinkingDelta });
      });
    }

    // Get complete message — blocks until stream finishes
    const response = await stream.finalMessage();

    // Extract text, thinking, and redacted thinking from response content blocks
    let text = '';
    let thinkingSummary: string | undefined;
    let redactedThinkingBlocks = 0;

    for (const block of response.content) {
      if (block.type === 'text') {
        text += block.text;
      } else if (block.type === 'thinking' && 'thinking' in block) {
        thinkingSummary = (thinkingSummary || '') + (block as { thinking: string }).thinking;
      } else if (block.type === 'redacted_thinking') {
        // Anthropic safety system encrypts some thinking blocks.
        // Count for diagnostics — content is not accessible.
        redactedThinkingBlocks++;
      }
    }

    return {
      text,
      thinkingSummary,
      redactedThinkingBlocks,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      stopReason: response.stop_reason || 'unknown',
      model: response.model,
    };
  }

  /** Get the underlying context budget manager for external use. */
  getBudgetManager(): ContextBudgetManager {
    return this.budgetManager;
  }
}
