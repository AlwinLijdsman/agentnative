/**
 * Context Builder
 *
 * Assembles XML-formatted context for single LLM calls in the orchestrator pipeline.
 * Mirrors gamma's ContextBuilder — shapes context per micro-agent (per-stage).
 *
 * Each section is wrapped in XML tags for Claude to parse structurally.
 * Retrieval paragraphs are sorted by relevance and truncated to fit a token budget.
 *
 * Design principles:
 * - TypeScript assembles all context — LLM receives pre-shaped input
 * - XML tags provide structure Claude can reference by name
 * - Token-budgeted truncation prevents context overflow
 * - Stage-specific context selection (each stage only sees what it needs)
 */

import { estimateTokens } from './context-budget.ts';
import type { AgentConfig, RetrievalParagraph } from './types.ts';

// ============================================================================
// TYPES
// ============================================================================

/** Options for building stage context. */
export interface BuildStageContextOptions {
  /** Current stage name — determines context selection. */
  stageName: string;
  /** Outputs from previous stages — key is the output name, value is the data. */
  previousOutputs: Record<string, unknown>;
  /** Retrieved paragraphs from knowledge base (scored). */
  retrievalContext?: readonly RetrievalParagraph[];
  /** Agent configuration for stage-specific formatting. */
  agentConfig: AgentConfig;
  /** Maximum tokens for retrieval context — truncates by relevance. */
  tokenBudget?: number;
  /** Feedback from a failed verification — included in repair iterations (G15). */
  repairFeedback?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default token budget for retrieval context when not specified. */
const DEFAULT_RETRIEVAL_TOKEN_BUDGET = 60_000;

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Assemble XML-formatted context for a single LLM call.
 *
 * Mirrors gamma's ContextBuilder — shapes context per micro-agent.
 * Each section wrapped in XML tags for Claude to parse structurally.
 *
 * Sections included (in order):
 * 1. QUERY_PLAN — always included when available (foundational context)
 * 2. STAGE_OUTPUT_* — previous stage outputs (handoff context)
 * 3. ISA_CONTEXT — retrieval paragraphs sorted by relevance, token-budgeted
 * 4. REPAIR_FEEDBACK — feedback from failed verification (repair iterations only)
 *
 * @param options - Context building options
 * @returns Assembled context string with XML-wrapped sections
 */
export function buildStageContext(options: BuildStageContextOptions): string {
  const sections: string[] = [];

  // 1. Query plan (always included when available — foundational context)
  const queryPlan = options.previousOutputs['queryPlan'];
  if (queryPlan != null) {
    sections.push(wrapXml('QUERY_PLAN', JSON.stringify(queryPlan, null, 2)));
  }

  // 2. Previous stage summaries (handoff context — each stage sees prior outputs)
  for (const [key, value] of Object.entries(options.previousOutputs)) {
    if (key !== 'queryPlan' && value != null) {
      sections.push(
        wrapXml(`STAGE_OUTPUT_${key.toUpperCase()}`, JSON.stringify(value, null, 2)),
      );
    }
  }

  // 3. Retrieval context — sorted by relevance, token-budgeted (G19)
  if (options.retrievalContext && options.retrievalContext.length > 0) {
    const sorted = [...options.retrievalContext].sort((a, b) => b.score - a.score);
    const budget = options.tokenBudget ?? DEFAULT_RETRIEVAL_TOKEN_BUDGET;
    const truncated = truncateByTokenBudget(sorted, budget);
    const formatted = truncated
      .map(
        (p) =>
          `<PARAGRAPH id="${escapeXmlAttr(p.id)}" score="${p.score}" source="${escapeXmlAttr(p.source)}">\n${p.text}\n</PARAGRAPH>`,
      )
      .join('\n');
    sections.push(wrapXml('ISA_CONTEXT', formatted));
  }

  // 4. Repair feedback (if in repair iteration — G15)
  if (options.repairFeedback) {
    sections.push(wrapXml('REPAIR_FEEDBACK', options.repairFeedback));
  }

  return sections.join('\n\n');
}

// ============================================================================
// XML HELPERS
// ============================================================================

/**
 * Wrap content in an XML tag pair.
 *
 * @param tag - XML tag name (e.g., 'QUERY_PLAN', 'ISA_CONTEXT')
 * @param content - Content to wrap
 * @returns XML-wrapped content string
 */
export function wrapXml(tag: string, content: string): string {
  return `<${tag}>\n${content}\n</${tag}>`;
}

/**
 * Escape special characters in XML attribute values.
 * Prevents injection via paragraph IDs or source names that contain XML-reserved chars.
 */
function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ============================================================================
// TOKEN BUDGET TRUNCATION
// ============================================================================

/**
 * Truncate a list of paragraphs to fit within a token budget.
 *
 * Paragraphs are processed in order (caller should pre-sort by relevance).
 * Stops adding paragraphs when the next one would exceed the budget.
 *
 * @param paragraphs - Ordered paragraphs to truncate
 * @param budget - Maximum token budget
 * @returns Paragraphs that fit within the budget
 */
export function truncateByTokenBudget(
  paragraphs: readonly RetrievalParagraph[],
  budget: number,
): RetrievalParagraph[] {
  let tokenCount = 0;
  const result: RetrievalParagraph[] = [];

  for (const p of paragraphs) {
    const estimated = estimateTokens(p.text);
    if (tokenCount + estimated > budget) break;
    tokenCount += estimated;
    result.push(p);
  }

  return result;
}
