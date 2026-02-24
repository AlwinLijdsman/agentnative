/**
 * JSON Extractor
 *
 * Robust JSON extraction from LLM text responses with Zod schema validation.
 * The orchestrator uses this to parse structured output from LLM calls
 * (stages that return JSON-in-text rather than using tool_use).
 *
 * Extraction strategies (tried in order):
 * 1. Parse full text as JSON
 * 2. Extract ```json ... ``` fenced code blocks
 * 3. Extract first root-level { ... } object
 * 4. Extract first root-level [ ... ] array
 *
 * All candidates are validated against the provided Zod schema.
 */

import { type ZodSchema, type ZodError } from 'zod';

// ============================================================================
// ERRORS
// ============================================================================

/**
 * Thrown when no valid JSON matching the schema can be extracted from LLM text.
 * Contains the raw text for debugging and the Zod validation errors from the
 * last candidate that was closest to parsing.
 */
export class JsonExtractionError extends Error {
  constructor(
    message: string,
    public readonly rawText: string,
    public readonly lastZodError?: ZodError,
  ) {
    super(message);
    this.name = 'JsonExtractionError';
  }
}

// ============================================================================
// JSON EXTRACTION
// ============================================================================

/**
 * Extract and validate JSON from LLM text response.
 *
 * Tries multiple extraction strategies in order of specificity.
 * Each candidate is parsed as JSON and validated against the Zod schema.
 *
 * @param text - Raw LLM text response that may contain JSON
 * @param schema - Zod schema to validate the extracted JSON against
 * @returns Validated and typed data matching the schema
 * @throws JsonExtractionError if no valid JSON can be extracted
 *
 * @example
 * ```typescript
 * const result = extractJson(llmResponse, z.object({
 *   queries: z.array(z.object({ text: z.string() })),
 *   confidence: z.number(),
 * }));
 * // result is fully typed: { queries: { text: string }[], confidence: number }
 * ```
 */
export function extractJson<T>(text: string, schema: ZodSchema<T>): T {
  const candidates = collectCandidates(text);
  let lastZodError: ZodError | undefined;

  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      const result = schema.parse(parsed);
      return result;
    } catch (error) {
      // Track the last Zod error for debugging (most informative for schema mismatches)
      if (error && typeof error === 'object' && 'issues' in error) {
        lastZodError = error as ZodError;
      }
      continue;
    }
  }

  throw new JsonExtractionError(
    `Failed to extract valid JSON from LLM response (${text.length} chars, ` +
    `${candidates.length} candidates tried)`,
    text,
    lastZodError,
  );
}

/**
 * Try to extract JSON without schema validation.
 * Useful when you just need to parse any JSON from the response.
 *
 * @param text - Raw LLM text response
 * @returns Parsed JSON value, or null if no valid JSON found
 */
export function extractRawJson(text: string): unknown | null {
  const candidates = collectCandidates(text);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      continue;
    }
  }

  return null;
}

// ============================================================================
// INTERNAL — Candidate collection
// ============================================================================

/**
 * Collect JSON candidates from text using multiple extraction strategies.
 * Returns candidates in order of specificity (most likely to be correct first).
 */
function collectCandidates(text: string): string[] {
  const candidates: string[] = [];
  const trimmed = text.trim();

  // Strategy 1: Full text as JSON
  candidates.push(trimmed);

  // Strategy 2: Fenced JSON code blocks (```json ... ``` or ``` ... ```)
  const fencedPattern = /```(?:json)?\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = fencedPattern.exec(text)) !== null) {
    const blockContent = match[1];
    if (blockContent) {
      candidates.push(blockContent.trim());
    }
  }

  // Strategy 3: First root-level { ... } object (greedy — outermost braces)
  const braceMatch = trimmed.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    candidates.push(braceMatch[0]);
  }

  // Strategy 4: First root-level [ ... ] array (greedy — outermost brackets)
  const bracketMatch = trimmed.match(/\[[\s\S]*\]/);
  if (bracketMatch) {
    candidates.push(bracketMatch[0]);
  }

  return candidates;
}
