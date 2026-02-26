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
  /** Narrative web research context from Stage 1 calibration (Section 17, F1). */
  webResearchContext?: string;
  /** Structured web sources from Stage 1 calibration (Section 17, F2). */
  webSources?: Array<{ url: string; title: string; insight: string; sourceType?: string }>;
  /** Prior answer text for follow-up synthesis (Section 18, F7). */
  priorAnswerText?: string;
  /** Parsed prior answer sections with P1/P2 IDs (Section 18, F13). */
  priorSections?: Array<{ sectionId: string; heading: string; excerpt: string }>;
  /** Follow-up number (1 = first follow-up, 2 = second, etc.) (Section 18). */
  followupNumber?: number;
  /** Prior research context hint for decomposition awareness (Section 18, F11). */
  priorContextHint?: string;
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

  // 4. Web research context — enumerated sources + narrative (Section 17, F1/F2)
  if (options.webSources?.length || options.webResearchContext) {
    const sourceList = (options.webSources ?? [])
      .map((s, i) => `[W${i + 1}] ${s.title} — ${s.url}\n    Insight: ${s.insight}`)
      .join('\n');
    const narrative = options.webResearchContext ?? '';
    const contextParts = [
      sourceList ? `Web Sources (labels assigned in order below):\n${sourceList}` : '',
      sourceList
        ? '\nIMPORTANT: You MUST write these [W1], [W2], etc. labels inline in your body text ' +
          'wherever a claim is informed or shaped by the corresponding web source. ' +
          'Example: "...the inherent risk framework [W1] drives all subsequent procedures..."\n' +
          'Each inline [W#] label MUST have a matching WEB_REF| marker in that section\'s Sources blockquote.'
        : '',
      narrative ? `\nContext:\n${narrative}` : '',
    ].filter(Boolean).join('\n\n');
    sections.push(wrapXml('WEB_RESEARCH_CONTEXT', contextParts));
    console.info(
      `[ContextBuilder] WEB_RESEARCH_CONTEXT section: ${(options.webSources ?? []).length} sources, ${narrative.length} chars context`,
    );
  }

  // 5. Prior answer context — for follow-up synthesis (Section 18, F7/F13)
  if (options.priorAnswerText) {
    const sectionIndex = (options.priorSections ?? [])
      .map(ps => `- **[${ps.sectionId}] ${ps.heading}**: ${ps.excerpt}`)
      .join('\n');
    const parts = [
      'The user asked a follow-up question. Build on this prior answer,',
      'avoid repeating the same content, and focus on new aspects.',
      sectionIndex ? `\n### Prior Answer Section Index\n${sectionIndex}` : '',
      `\n### Prior Answer\n${options.priorAnswerText}`,
    ].filter(Boolean);
    sections.push(wrapXml('PRIOR_ANSWER_CONTEXT', parts.join('\n')));
    console.info(
      `[ContextBuilder] PRIOR_ANSWER_CONTEXT section: ${(options.priorSections ?? []).length} sections, ` +
      `${options.priorAnswerText.length} chars answer, followup #${options.followupNumber ?? '?'}`,
    );
  }

  // 6. Prior research context hint — for Stage 0 decomposition awareness (Section 18, F11)
  if (options.priorContextHint) {
    sections.push(wrapXml('PRIOR_RESEARCH_CONTEXT',
      'The user is asking a follow-up question. Use this context to avoid ' +
      'repeating previously explored topics and focus on new or deeper aspects:\n\n' +
      options.priorContextHint,
    ));
  }

  // 7. Synthesis instructions — conditional instructions injected at runtime (Section 18, F2)
  if (options.stageName === 'synthesize') {
    const conditionalInstructions: string[] = [];

    if (options.webSources?.length || options.webResearchContext) {
      conditionalInstructions.push(
        'REQUIRED — WEB SOURCE LABELLING:\n' +
        'You MUST include [W1], [W2], etc. inline in your body text wherever a claim ' +
        'is informed by a web source from <WEB_RESEARCH_CONTEXT>. This is mandatory — ' +
        'the renderer depends on finding these labels to link references.\n\n' +
        'For each [W#] label you write in the body text, you MUST also emit a matching ' +
        'WEB_REF marker on its own line inside the > **Sources** blockquote of that section:\n' +
        '> WEB_REF|<url>|<one-line insight>\n\n' +
        'Example body text: "...the inherent risk framework [W1] drives all subsequent procedures..."\n' +
        'Example Sources block entry:\n' +
        '> WEB_REF|https://iaasb.org/isa-540|Inherent risk framework drives procedures\n\n' +
        'Across the full answer, you should reference at least 2 distinct web sources ' +
        'inline if 2 or more are available. Do not cluster all web labels in one section.',
      );
    }

    if (options.priorSections?.length) {
      conditionalInstructions.push(
        'REQUIRED — PRIOR RESEARCH LABELLING:\n' +
        'You MUST include [P1], [P2], etc. inline in your body text wherever a claim ' +
        'builds on prior research from <PRIOR_ANSWER_CONTEXT>. Labels correspond to ' +
        'section IDs in the Prior Answer Section Index.\n\n' +
        'For each [P#] label you write in the body text, you MUST also emit a matching ' +
        'PRIOR_REF marker on its own line inside the > **Sources** blockquote:\n' +
        '> PRIOR_REF|<section_id>|<heading>|<1-3 sentence excerpt of the specific prior finding being referenced>\n\n' +
        'The excerpt MUST be a substantive summary (1-3 sentences) of the specific prior research ' +
        'finding being referenced — enough for a reader to understand what prior work is being ' +
        'built upon without needing to read the full prior answer. Include the key conclusion or ' +
        'finding, not just a fragment.\n\n' +
        'Place PRIOR_REF markers AFTER ISA sources but BEFORE WEB_REF markers.\n' +
        'Example body text: "...building on the risk framework identified in earlier research [P1]..."\n' +
        'Example Sources block entry:\n' +
        '> PRIOR_REF|P1|Risk Assessment|ISA 540 (Revised) establishes a rigorous framework requiring auditors to evaluate three fundamental elements — methods, significant assumptions, and data inputs — when testing how management made an accounting estimate.',
      );
    }

    if (conditionalInstructions.length) {
      sections.push(wrapXml('SYNTHESIS_INSTRUCTIONS',
        conditionalInstructions.join('\n\n'),
      ));
      console.info(
        `[ContextBuilder] SYNTHESIS_INSTRUCTIONS section: ${conditionalInstructions.length} instruction(s)`,
      );
    }
  }

  // 8. Repair feedback (if in repair iteration — G15)
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
