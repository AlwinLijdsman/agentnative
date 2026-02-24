/**
 * BAML Adapter — Feature-flagged bridge between stage-runner and BAML-generated clients
 *
 * Uses dynamic import() to load BAML-generated TypeScript clients at runtime.
 * If the baml_client/ directory doesn't exist (BAML not generated), the imports
 * fail gracefully and the caller falls back to the Zod extraction path.
 *
 * This adapter:
 * 1. Encapsulates the dynamic import (no compile-time dependency on baml_client/)
 * 2. Injects runtime auth (Claude Max OAuth token + beta header)
 * 3. Maps BAML-generated types to our canonical baml-types.ts interfaces
 * 4. Returns null on any failure — caller decides whether to throw or fall back
 *
 * Usage in stage-runner.ts:
 * ```typescript
 * const result = await callBamlStage0(query, authToken);
 * if (result) {
 *   // Use BAML-typed result
 * } else {
 *   // Fall back to LLM call + extractJson()
 * }
 * ```
 */

import type {
  ISAQueryPlanOutput,
  ISASynthesisOutput,
  WebsearchCalibrationOutput,
} from './baml-types.ts';

/** OAuth beta header required for Bearer token auth (Claude Max). */
const OAUTH_BETA_HEADER = 'oauth-2025-04-20';

/**
 * Build BAML client options for Anthropic provider with OAuth auth.
 * These options override the static client config from clients.baml.
 */
function buildClientOptions(authToken: string): Record<string, unknown> {
  return {
    clientOptions: {
      anthropic: {
        authToken,
        defaultHeaders: { 'anthropic-beta': OAUTH_BETA_HEADER },
      },
    },
  };
}

/**
 * Attempt to load the BAML-generated client module.
 * Returns null if baml_client/ does not exist or the module fails to load.
 */
async function loadBamlClient(): Promise<BamlClientModule | null> {
  try {
    // Dynamic import — no compile-time dependency on baml_client/
    // The path is relative to this file's location in the orchestrator directory
    // @ts-expect-error — baml_client/ is generated code; may not exist until `baml generate` runs
    const mod = await import('./baml_client/index.js') as BamlClientModule;
    if (mod?.b) return mod;
    return null;
  } catch {
    // Expected when BAML hasn't been generated — not an error
    return null;
  }
}

/**
 * Minimal type for the BAML-generated module.
 * The actual generated module exports a `b` object with typed function methods.
 * We use `unknown` for the function signatures here since the generated types
 * may not exactly match — the adapter layer handles the mapping.
 */
interface BamlClientModule {
  b: {
    ISAResearchStage0: (query: string, options?: Record<string, unknown>) => Promise<unknown>;
    ISAResearchStage1: (queryPlan: string, webResults: string, options?: Record<string, unknown>) => Promise<unknown>;
    ISAResearchStage3: (queryPlan: string, retrievalContext: string, repairFeedback?: string | null, options?: Record<string, unknown>) => Promise<unknown>;
  };
}

// ============================================================================
// PUBLIC API — Stage-specific BAML callers
// ============================================================================

/**
 * Call BAML Stage 0: Analyze Query
 *
 * @param query - User's research query
 * @param authToken - Fresh Claude Max OAuth token
 * @returns Typed query plan output, or null if BAML is unavailable/fails
 */
export async function callBamlStage0(
  query: string,
  authToken: string,
): Promise<ISAQueryPlanOutput | null> {
  const client = await loadBamlClient();
  if (!client) return null;

  try {
    const result = await client.b.ISAResearchStage0(
      query,
      buildClientOptions(authToken),
    );
    return result as ISAQueryPlanOutput;
  } catch (error) {
    console.warn(
      '[baml-adapter] Stage 0 BAML call failed:',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * Call BAML Stage 1: Websearch Calibration
 *
 * @param queryPlan - JSON string of the Stage 0 query plan
 * @param webResults - JSON string of web search results
 * @param authToken - Fresh Claude Max OAuth token
 * @returns Typed calibration output, or null if BAML is unavailable/fails
 */
export async function callBamlStage1(
  queryPlan: string,
  webResults: string,
  authToken: string,
): Promise<WebsearchCalibrationOutput | null> {
  const client = await loadBamlClient();
  if (!client) return null;

  try {
    const result = await client.b.ISAResearchStage1(
      queryPlan,
      webResults,
      buildClientOptions(authToken),
    );
    return result as WebsearchCalibrationOutput;
  } catch (error) {
    console.warn(
      '[baml-adapter] Stage 1 BAML call failed:',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * Call BAML Stage 3: Synthesize
 *
 * @param queryPlan - JSON string of the query plan
 * @param retrievalContext - Formatted retrieval context from Stage 2
 * @param authToken - Fresh Claude Max OAuth token
 * @param repairFeedback - Optional repair feedback from Stage 4 verification failure
 * @returns Typed synthesis output, or null if BAML is unavailable/fails
 */
export async function callBamlStage3(
  queryPlan: string,
  retrievalContext: string,
  authToken: string,
  repairFeedback?: string,
): Promise<ISASynthesisOutput | null> {
  const client = await loadBamlClient();
  if (!client) return null;

  try {
    const result = await client.b.ISAResearchStage3(
      queryPlan,
      retrievalContext,
      repairFeedback ?? null,
      buildClientOptions(authToken),
    );
    return result as ISASynthesisOutput;
  } catch (error) {
    console.warn(
      '[baml-adapter] Stage 3 BAML call failed:',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * Check if BAML clients are available (generated code exists).
 * Useful for diagnostics and health checks.
 */
export async function isBamlAvailable(): Promise<boolean> {
  const client = await loadBamlClient();
  return client !== null;
}
