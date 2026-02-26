/**
 * Follow-Up Context Loader
 *
 * Loads prior research answer data from a completed session and parses it
 * into structured context for follow-up queries.
 *
 * Mirrors gamma's `_parse_answer_sections()` and `_load_prior_context()`.
 *
 * Functions:
 * - `parseAnswerSections()` — Splits answer markdown into PriorSection structs
 * - `loadFollowUpContext()` — Reads answer.json from prior session, builds FollowUpContext
 * - `buildPriorContextHint()` — Builds hint string for Stage 0 decomposition awareness
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { FollowUpContext, FollowUpPriorSection } from './types.ts';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Maximum excerpt length in characters (truncated at word boundary). */
const MAX_EXCERPT_LENGTH = 500;

/** Maximum number of sub-queries included in the context hint. */
const MAX_HINT_SUBQUERIES = 5;

/** Headings to filter out when parsing answer sections — metadata, not content. */
const METADATA_HEADINGS = new Set([
  'original question',
  'verification summary',
  'citations used',
  'external good practice references',
  'external references',
  'prior research references',
  'appendix: research decomposition',
  'out-of-scope notes',
  'out of scope',
]);

/**
 * Validate answer.json has the required fields for follow-up context loading.
 * Returns a descriptive error string if invalid, or null if valid.
 *
 * Checks: version (if present) must be 1, answer must be non-empty string,
 * original_query must be string, followup_number (if present) must be number,
 * citations (if present) must be array, sub_queries (if present) must be array.
 */
export function validateAnswerJson(data: Record<string, unknown>): string | null {
  // Version check (future-proofing)
  const version = data['version'];
  if (version !== undefined && version !== 1) {
    return `unknown version: ${String(version)} (expected 1)`;
  }

  // Required: answer must be non-empty string
  const answer = data['answer'];
  if (typeof answer !== 'string' || !answer.trim()) {
    return 'missing or empty "answer" field';
  }

  // Required: original_query must be string
  const originalQuery = data['original_query'];
  if (originalQuery !== undefined && typeof originalQuery !== 'string') {
    return `"original_query" is not a string: ${typeof originalQuery}`;
  }

  // Optional: followup_number must be number if present
  const followupNumber = data['followup_number'];
  if (followupNumber !== undefined && typeof followupNumber !== 'number') {
    return `"followup_number" is not a number: ${typeof followupNumber}`;
  }

  // Optional: citations must be array if present
  const citations = data['citations'];
  if (citations !== undefined && !Array.isArray(citations)) {
    return '"citations" is not an array';
  }

  // Optional: sub_queries must be array if present
  const subQueries = data['sub_queries'];
  if (subQueries !== undefined && !Array.isArray(subQueries)) {
    return '"sub_queries" is not an array';
  }

  return null;
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Parse a research answer's markdown into structured PriorSection entries.
 *
 * Splits on `## ` headings (not `###` or `#`), filters out metadata headings,
 * and assigns sequential section numbers with string IDs ("P1", "P2", ...).
 *
 * Mirrors gamma's `_parse_answer_sections()` — workflow.py L123–178.
 *
 * @param answerText - Full answer markdown text
 * @returns Array of parsed prior sections with IDs
 */
export function parseAnswerSections(answerText: string): FollowUpPriorSection[] {
  if (!answerText.trim()) return [];

  // Split on ## headings, keeping the heading with its content
  const parts = answerText.split(/(?=^## )/m);
  const sections: FollowUpPriorSection[] = [];
  let sectionNum = 0;

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // Extract heading from "## Heading Text\n..."
    const headingMatch = trimmed.match(/^## (.+?)(?:\n|$)/);
    if (!headingMatch) continue;

    const heading = (headingMatch[1] ?? '').trim();

    // Skip metadata headings
    if (METADATA_HEADINGS.has(heading.toLowerCase())) continue;

    sectionNum++;
    const sectionId = `P${sectionNum}`;

    // Extract body text (after heading line) for excerpt
    const bodyStart = trimmed.indexOf('\n');
    const body = bodyStart >= 0 ? trimmed.slice(bodyStart + 1).trim() : '';

    // Truncate excerpt at word boundary
    const excerpt = truncateAtWordBoundary(body, MAX_EXCERPT_LENGTH);

    sections.push({
      sectionNum,
      sectionId,
      heading,
      excerpt,
    });
  }

  return sections;
}

/**
 * Load follow-up context from a prior completed research session.
 *
 * Reads `sessions/<previousSessionId>/data/answer.json`, parses the prior
 * answer into sections, and builds a FollowUpContext with follow-up number
 * incremented by 1.
 *
 * Returns null if the prior session doesn't exist, has no answer.json,
 * or the JSON is malformed (graceful degradation).
 *
 * Mirrors gamma's `_load_prior_context()` — workflow.py L312–492.
 *
 * @param sessionsDir - Absolute path to the sessions directory
 * @param previousSessionId - Session ID of the prior completed run
 * @returns FollowUpContext or null if prior context not available
 */
export function loadFollowUpContext(
  sessionsDir: string,
  previousSessionId: string,
): FollowUpContext | null {
  const answerJsonPath = join(sessionsDir, previousSessionId, 'data', 'answer.json');

  if (!existsSync(answerJsonPath)) {
    console.info(`[FollowUpContext] No answer.json at ${answerJsonPath}`);
    return null;
  }

  try {
    const raw = readFileSync(answerJsonPath, 'utf-8');
    const data = JSON.parse(raw) as Record<string, unknown>;

    // Comprehensive schema validation (Section 21, F3)
    const validationError = validateAnswerJson(data);
    if (validationError) {
      console.warn(`[FollowUpContext] Invalid answer.json: ${validationError}`);
      return null;
    }

    // Fields guaranteed valid after validation
    const answerText = data['answer'] as string;

    const priorQuery = (data['original_query'] ?? '') as string;
    const prevFollowupNumber = (data['followup_number'] ?? 0) as number;

    // Parse citations for paragraph IDs
    const rawCitations = (data['citations'] ?? []) as Array<Record<string, unknown>>;
    const priorParagraphIds = rawCitations
      .map(c => (c['paragraph_id'] ?? c['source_ref'] ?? '') as string)
      .filter(Boolean);

    // Parse sub-queries
    const rawSubQueries = (data['sub_queries'] ?? []) as Array<Record<string, unknown>>;
    const priorSubQueries = rawSubQueries.map(sq => ({
      text: (sq['text'] ?? '') as string,
      role: (sq['role'] ?? 'primary') as string,
      standards: (sq['standards'] ?? []) as string[],
    }));

    // Parse answer into sections
    const priorSections = parseAnswerSections(answerText);

    const ctx: FollowUpContext = {
      followupNumber: prevFollowupNumber + 1,
      priorAnswerText: answerText,
      priorQuery,
      priorSubQueries,
      priorParagraphIds,
      priorSections,
    };

    console.info(
      `[FollowUpContext] Loaded: followup #${ctx.followupNumber}, ` +
      `${priorSections.length} sections, ${priorParagraphIds.length} paragraph IDs`,
    );

    return ctx;
  } catch (error) {
    console.warn(
      '[FollowUpContext] Failed to parse answer.json:',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * Build a context hint string for Stage 0 decomposition awareness.
 *
 * Summarizes the prior research session: follow-up number, prior query,
 * and prior sub-queries (max 5). Used by Stage 0 to avoid repeating
 * previously explored topics.
 *
 * @param ctx - Follow-up context from prior session
 * @returns Hint string for `<PRIOR_RESEARCH_CONTEXT>` XML section
 */
export function buildPriorContextHint(ctx: FollowUpContext): string {
  const parts: string[] = [
    `Follow-up #${ctx.followupNumber}`,
    `Prior query: "${ctx.priorQuery}"`,
  ];

  const subQueries = ctx.priorSubQueries.slice(0, MAX_HINT_SUBQUERIES);
  if (subQueries.length > 0) {
    parts.push('Prior sub-queries explored:');
    for (const sq of subQueries) {
      parts.push(`  - [${sq.role}] ${sq.text} (standards: ${sq.standards.join(', ') || 'general'})`);
    }
    if (ctx.priorSubQueries.length > MAX_HINT_SUBQUERIES) {
      parts.push(`  ... and ${ctx.priorSubQueries.length - MAX_HINT_SUBQUERIES} more`);
    }
  }

  if (ctx.priorSections.length > 0) {
    parts.push(`Prior answer covered ${ctx.priorSections.length} sections:`);
    for (const s of ctx.priorSections) {
      parts.push(`  - [${s.sectionId}] ${s.heading}`);
    }
  }

  // Explicit dedup guidance (Section 21, F4)
  if (ctx.priorSubQueries.length > 0) {
    parts.push(
      '\nIMPORTANT: Do NOT generate sub-queries that duplicate the prior sub-queries listed above. ' +
      'Focus on NEW aspects, DEEPER investigation of gaps, or DIFFERENT angles not already covered.',
    );
  }

  return parts.join('\n');
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Truncate text at a word boundary, ensuring max length.
 */
function truncateAtWordBoundary(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;

  // Find the last space before maxLen
  const truncated = text.slice(0, maxLen);
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > maxLen * 0.5) {
    return truncated.slice(0, lastSpace) + '...';
  }
  return truncated + '...';
}
