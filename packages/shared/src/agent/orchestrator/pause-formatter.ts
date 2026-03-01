/**
 * Pause Formatter — Deterministic pause message builder
 *
 * Transforms raw JSON stage output into human-readable formatted messages
 * for orchestrator pause events (Stage 0 and Stage 1).
 *
 * Handles both BAML and Zod data paths:
 * - BAML: ISAQueryPlanOutput / WebsearchCalibrationOutput typed objects
 * - Zod: extractRawJson() output from prompt schema
 *
 * Design: Deterministic TypeScript template — no LLM call, no extra cost.
 * All logging via onDebug callback (gamma's get_logger pattern adapted to agentnative).
 *
 * @see types.ts for NormalizedQueryPlan, NormalizedCalibration interfaces
 */

import type {
  NormalizedCalibration,
  NormalizedQueryPlan,
  NormalizedSubQuery,
} from './types.ts';
import { extractRawJson } from './json-extractor.ts';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Clarity threshold — aligned with stage-0-analyze-query.md prompt and config.json. */
const CLARITY_THRESHOLD = 0.7;

// ============================================================================
// DATA NORMALIZERS
// ============================================================================

/**
 * Normalize Stage 0 data from either BAML or Zod path into a common shape.
 *
 * BAML path: data.query_plan is ISAQueryPlanOutput
 *   - sub_queries[].text, sub_queries[].isa_standards, sub_queries[].search_strategy
 *   - depth_recommendation, scope_classification, refined_query
 *
 * Zod path: data is extractRawJson() output (or data.query_plan)
 *   - sub_queries[].query, sub_queries[].target_standards, sub_queries[].role
 *   - depth_mode, scope, recommended_action, clarification_questions, alternative_interpretations
 *
 * @returns NormalizedQueryPlan or null if data is unparseable (missing clarity_score)
 */
export function normalizeStage0Data(
  data: Record<string, unknown>,
  onDebug?: (msg: string) => void,
): NormalizedQueryPlan | null {
  // Try data.query_plan as container (both BAML and Zod wrap under query_plan)
  let plan = data['query_plan'] as Record<string, unknown> | undefined;
  if (!plan || typeof plan !== 'object') {
    // Try data itself as the query plan object
    plan = data;
  }

  // Clarity score is required — return null if missing
  const clarityScore = typeof plan['clarity_score'] === 'number'
    ? plan['clarity_score']
    : typeof plan['clarity_score'] === 'string'
      ? parseFloat(plan['clarity_score'])
      : NaN;

  if (isNaN(clarityScore)) {
    onDebug?.('[pause-formatter] Stage 0: clarity_score missing or invalid — normalization returned null');
    return null;
  }

  // Detect normalization path
  const rawSubQueries = Array.isArray(plan['sub_queries']) ? plan['sub_queries'] : [];
  const hasBamlFields = rawSubQueries.length > 0 && typeof rawSubQueries[0]?.['text'] === 'string'
    && !rawSubQueries[0]?.['query'];
  const normalizationPath = hasBamlFields ? 'BAML' : 'Zod';
  onDebug?.(`[pause-formatter] Stage 0: using ${normalizationPath} normalization path`);

  // Normalize sub-queries
  const subQueries: NormalizedSubQuery[] = rawSubQueries.map((sq: Record<string, unknown>) => ({
    text: (typeof sq['query'] === 'string' ? sq['query'] : null)
      ?? (typeof sq['text'] === 'string' ? sq['text'] : 'Unknown query'),
    role: typeof sq['role'] === 'string' ? sq['role'] : undefined,
    standards: toStringArray(sq['target_standards'] ?? sq['isa_standards']),
    searchStrategy: typeof sq['search_strategy'] === 'string' ? sq['search_strategy'] : undefined,
  }));

  // Normalize top-level fields
  const depth = stringField(plan, 'depth_mode') ?? stringField(plan, 'depth_recommendation') ?? 'standard';
  const scope = stringField(plan, 'scope') ?? stringField(plan, 'scope_classification') ?? 'unknown';
  const recommendedAction = stringField(plan, 'recommended_action')
    ?? (clarityScore < CLARITY_THRESHOLD ? 'clarify' : 'proceed');

  const clarificationQuestions = toStringArray(plan['clarification_questions']);
  const alternativeInterpretations = toStringArray(plan['alternative_interpretations']);
  const assumptions = toStringArray(plan['assumptions']);

  // Primary standards — try dedicated field, then aggregate from sub-queries
  let primaryStandards = toStringArray(plan['primary_standards'] ?? plan['target_standards']);
  if (primaryStandards.length === 0) {
    const allStandards = new Set<string>();
    for (const sq of subQueries) {
      for (const s of sq.standards) {
        allStandards.add(s);
      }
    }
    primaryStandards = [...allStandards];
  }

  const authoritySourcesPresent = Array.isArray(plan['authority_sources'])
    && plan['authority_sources'].length > 0;

  const originalQuery = stringField(plan, 'original_query')
    ?? stringField(plan, 'user_query')
    ?? stringField(data, 'userMessage')
    ?? '';

  const refinedQuery = stringField(plan, 'refined_query') ?? undefined;

  const normalized: NormalizedQueryPlan = {
    originalQuery,
    clarityScore,
    recommendedAction,
    assumptions,
    alternativeInterpretations,
    clarificationQuestions,
    primaryStandards,
    subQueries,
    depth,
    scope,
    authoritySourcesPresent,
    refinedQuery,
  };

  onDebug?.(
    `[pause-formatter] Stage 0: normalized ${subQueries.length} sub-queries, clarity=${clarityScore}`,
  );
  return normalized;
}

/**
 * Normalize Stage 1 data from either BAML or Zod path into a common shape.
 *
 * BAML path: data.calibration (WebsearchCalibrationOutput)
 *   - queries[].action, calibration_summary
 *
 * Zod path: data.websearch_calibration
 *   - intent_changes.sub_queries_added/modified/demoted, web_research_context
 *
 * @returns NormalizedCalibration or null if neither key found
 */
export function normalizeStage1Data(
  data: Record<string, unknown>,
  onDebug?: (msg: string) => void,
): NormalizedCalibration | null {
  const execution = data['webSearchExecution'] as Record<string, unknown> | undefined;
  const executionStatus = executionStatusField(execution?.['status']);
  const executionWarnings = toStringArray(execution?.['warnings']);

  // ── Skipped-calibration path (Section 20 — Bug 4) ────────────────────
  // Handles both { websearch_calibration: { skipped: true } } and { skipped: true }
  const wsCal = data['websearch_calibration'] as Record<string, unknown> | undefined;
  if (
    (wsCal && typeof wsCal === 'object' && wsCal['skipped'] === true) ||
    data['skipped'] === true
  ) {
    onDebug?.('[pause-formatter] Stage 1: skipped calibration path');
    const summary = executionStatus === 'user_skipped'
      ? 'Web search was skipped by user choice — proceeding with the Stage 0 query plan.'
      : executionStatus === 'unavailable'
        ? 'Web search could not run because MCP bridge/tools were unavailable.'
        : executionStatus === 'no_results'
          ? 'Web search returned no usable results — proceeding with the Stage 0 query plan.'
          : 'Web search was skipped — proceeding with the Stage 0 query plan.';
    return {
      skipped: true,
      executionStatus,
      summary,
      queriesAdded: [],
      queriesModified: [],
      queriesDemoted: [],
      scopeChanged: false,
      webSourceCount: 0,
      warnings: executionWarnings,
      queryPlanRefined: false,
    };
  }

  // Try Zod path first (richer structure)
  const zodCal = data['websearch_calibration'] as Record<string, unknown> | undefined;
  if (zodCal && typeof zodCal === 'object') {
    onDebug?.('[pause-formatter] Stage 1: using Zod normalization path');

    const intentChanges = zodCal['intent_changes'] as Record<string, unknown> | undefined;
    const queriesAdded = toObjectArray(intentChanges?.['sub_queries_added']).map(sq => ({
      query: stringField(sq, 'query') ?? stringField(sq, 'text') ?? 'Unknown',
      role: stringField(sq, 'role') ?? 'research',
      reason: stringField(sq, 'reason') ?? stringField(sq, 'rationale') ?? '',
    }));
    const queriesModified = toObjectArray(intentChanges?.['sub_queries_modified']).map(sq => ({
      original: stringField(sq, 'original') ?? stringField(sq, 'original_query') ?? 'Unknown',
      modified: stringField(sq, 'modified') ?? stringField(sq, 'refined_query') ?? 'Unknown',
      reason: stringField(sq, 'reason') ?? stringField(sq, 'rationale') ?? '',
    }));
    const queriesDemoted = toObjectArray(intentChanges?.['sub_queries_demoted'] ?? intentChanges?.['sub_queries_removed']).map(sq => ({
      query: stringField(sq, 'query') ?? stringField(sq, 'text') ?? 'Unknown',
      reason: stringField(sq, 'reason') ?? stringField(sq, 'rationale') ?? '',
    }));

    const summary = stringField(zodCal, 'web_research_context')
      ?? stringField(zodCal, 'calibration_summary')
      ?? 'No summary available';

    const scopeChanged = zodCal['scope_changed'] === true
      || (intentChanges?.['scope_change'] != null && intentChanges['scope_change'] !== 'none');

    const webResults = data['webResults'] as unknown[] | undefined;
    const webSourceCount = Array.isArray(webResults) ? webResults.length : 0;

    const queryPlanRefined = queriesAdded.length > 0
      || queriesModified.length > 0
      || queriesDemoted.length > 0
      || scopeChanged;

    const normalized: NormalizedCalibration = {
      skipped: false,
      executionStatus,
      summary,
      queriesAdded,
      queriesModified,
      queriesDemoted,
      scopeChanged,
      webSourceCount,
      warnings: executionWarnings,
      queryPlanRefined,
    };

    onDebug?.(
      `[pause-formatter] Stage 1: normalized — ` +
      `added=${queriesAdded.length}, modified=${queriesModified.length}, demoted=${queriesDemoted.length}`,
    );
    return normalized;
  }

  // Try BAML path
  const bamlCal = data['calibration'] as Record<string, unknown> | undefined;
  if (bamlCal && typeof bamlCal === 'object') {
    onDebug?.('[pause-formatter] Stage 1: using BAML normalization path');

    const bamlQueries = toObjectArray(bamlCal['queries']);
    const queriesAdded: Array<{ query: string; role: string; reason: string }> = [];
    const queriesModified: Array<{ original: string; modified: string; reason: string }> = [];
    const queriesDemoted: Array<{ query: string; reason: string }> = [];

    for (const q of bamlQueries) {
      const action = stringField(q, 'action') ?? 'keep';
      const queryText = stringField(q, 'refined_text') ?? stringField(q, 'original_text') ?? 'Unknown';

      switch (action) {
        case 'added':
        case 'add':
          queriesAdded.push({
            query: queryText,
            role: stringField(q, 'role') ?? 'research',
            reason: stringField(q, 'reason') ?? '',
          });
          break;
        case 'modified':
        case 'modify':
        case 'refined':
          queriesModified.push({
            original: stringField(q, 'original_text') ?? 'Unknown',
            modified: stringField(q, 'refined_text') ?? queryText,
            reason: stringField(q, 'reason') ?? '',
          });
          break;
        case 'removed':
        case 'remove':
        case 'demoted':
        case 'demote':
          queriesDemoted.push({
            query: queryText,
            reason: stringField(q, 'reason') ?? '',
          });
          break;
        // 'keep' — no change, skip
      }
    }

    const summary = stringField(bamlCal, 'calibration_summary')
      ?? 'No summary available';

    const webResults = data['webResults'] as unknown[] | undefined;
    const webSourceCount = Array.isArray(webResults) ? webResults.length : 0;

    const queryPlanRefined = queriesAdded.length > 0
      || queriesModified.length > 0
      || queriesDemoted.length > 0;

    const normalized: NormalizedCalibration = {
      skipped: false,
      executionStatus,
      summary,
      queriesAdded,
      queriesModified,
      queriesDemoted,
      scopeChanged: false, // BAML path doesn't track scope changes separately
      webSourceCount,
      warnings: executionWarnings,
      queryPlanRefined,
    };

    onDebug?.(
      `[pause-formatter] Stage 1: normalized — ` +
      `added=${queriesAdded.length}, modified=${queriesModified.length}, demoted=${queriesDemoted.length}`,
    );
    return normalized;
  }

  // ── rawText recovery path (Section 20 — Bug 4) ────────────────────────
  // When extractRawJson failed in the stage runner, data = { rawText: ..., webResults }.
  // Attempt to recover JSON from the rawText and recursively normalize.
  const rawText = data['rawText'];
  if (typeof rawText === 'string' && rawText.length > 0) {
    onDebug?.('[pause-formatter] Stage 1: attempting rawText JSON recovery');
    const recovered = extractRawJson(rawText);
    if (recovered != null && typeof recovered === 'object') {
      const recoveredData = recovered as Record<string, unknown>;
      const result = normalizeStage1Data(recoveredData, onDebug);
      if (result) {
        onDebug?.('[pause-formatter] Stage 1: rawText recovery succeeded');
        return result;
      }
    }
    onDebug?.('[pause-formatter] Stage 1: rawText recovery failed');
  }

  onDebug?.('[pause-formatter] Stage 1: neither websearch_calibration nor calibration key found — normalization returned null');
  return null;
}

// ============================================================================
// FORMATTERS
// ============================================================================

/**
 * Format Stage 0 pause message from normalized query plan.
 *
 * Sections:
 * 1. Header — clarity score with threshold comparison
 * 2. Assumptions — bullet list (if non-empty)
 * 3. Planned Research Queries — count + bulleted list with roles/standards
 * 4. Primary Standards — comma-separated
 * 5. Clarifying Questions — numbered list (when clarity < 0.7 or questions present)
 * 6. Alternative Interpretations — bullet list (when clarity < 0.7, if non-empty)
 * 7. Web Search Prompt — unless depth is 'quick'
 * 8. Collapsible Raw JSON — <details> block
 * 9. Cost Footer — optional
 */
export function formatStage0PauseMessage(
  plan: NormalizedQueryPlan,
  rawJson: string,
  costInfo?: { inputTokens: number; outputTokens: number; costUsd: number },
): string {
  const lines: string[] = [];
  const clarityPct = Math.round(plan.clarityScore * 100);
  const aboveBelow = plan.clarityScore >= CLARITY_THRESHOLD ? 'above' : 'below';

  // 1. Header
  lines.push(`**Query Analysis Complete** — Clarity: ${clarityPct}% (${aboveBelow} ${Math.round(CLARITY_THRESHOLD * 100)}% threshold)`);
  lines.push('');

  // 2. Assumptions
  if (plan.assumptions.length > 0) {
    lines.push('**Assumptions**');
    lines.push('');
    for (const assumption of plan.assumptions) {
      lines.push(`- ${assumption}`);
    }
    lines.push('');
  }

  // 3. Planned Research Queries
  if (plan.subQueries.length > 0) {
    lines.push(`**Planned Research Queries** — ${plan.subQueries.length} queries planned (${plan.depth} mode, ${plan.scope} scope)`);
    lines.push('');
    for (const sq of plan.subQueries) {
      const role = sq.role ? `[${sq.role}]` : '';
      const standards = sq.standards.length > 0 ? ` — ${sq.standards.join(', ')}` : '';
      const prefix = role ? `${role} ` : '';
      lines.push(`- ${prefix}${sq.text}${standards}`);
    }
    lines.push('');
  }

  // 4. Primary Standards
  if (plan.primaryStandards.length > 0) {
    lines.push(`**Primary Standards**: ${plan.primaryStandards.join(', ')}`);
    lines.push('');
  }

  // 5. Clarifying Questions
  if (plan.clarificationQuestions.length > 0) {
    if (plan.clarityScore < CLARITY_THRESHOLD) {
      lines.push(`Clarity is at ${clarityPct}%, so I have some clarifying questions before proceeding:`);
    } else {
      lines.push('**Clarifying Questions**');
    }
    lines.push('');
    for (let i = 0; i < plan.clarificationQuestions.length; i++) {
      lines.push(`${i + 1}. ${plan.clarificationQuestions[i]}`);
    }
    lines.push('');
  }

  // 6. Alternative Interpretations
  if (plan.alternativeInterpretations.length > 0 && plan.clarityScore < CLARITY_THRESHOLD) {
    lines.push('**Alternative Interpretations**');
    lines.push('');
    for (const interp of plan.alternativeInterpretations) {
      lines.push(`- ${interp}`);
    }
    lines.push('');
  }

  // 7. Web Search Prompt
  if (plan.depth !== 'quick') {
    lines.push('Would you like me to run a web search to refine my understanding before starting research?');
    lines.push('A. Yes — search authoritative ISA sources');
    lines.push('B. No — proceed directly');
    lines.push('');
  }

  // 8. Collapsible Raw JSON — blank lines around fenced code block for rehype-raw
  lines.push('<details>');
  lines.push('<summary>[DATA] Full Query Plan (JSON)</summary>');
  lines.push('');
  lines.push('```json');
  lines.push(rawJson);
  lines.push('```');
  lines.push('');
  lines.push('</details>');
  lines.push('');

  // 9. Cost Footer
  if (costInfo) {
    lines.push('---');
    lines.push(`*Stage 0 used ${costInfo.inputTokens} input + ${costInfo.outputTokens} output tokens (~$${costInfo.costUsd.toFixed(4)} equivalent)*`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format Stage 1 pause message from normalized calibration data.
 *
 * Sections:
 * 1. Header — CALIBRATED or CONFIRMED
 * 2. Summary — calibration summary text
 * 3. Changes Made — Added, Modified, Demoted (non-empty sections only)
 * 4. Proceed Prompt
 * 5. Collapsible Raw JSON
 * 6. Cost Footer — optional
 */
export function formatStage1PauseMessage(
  cal: NormalizedCalibration,
  rawJson: string,
  costInfo?: { inputTokens: number; outputTokens: number; costUsd: number },
): string {
  const lines: string[] = [];

  // ── Skipped path (Section 20 — Bug 4) ────────────────────────────────
  if (cal.skipped) {
    const stateLabel = cal.executionStatus === 'user_skipped'
      ? 'SKIPPED (USER CHOICE)'
      : cal.executionStatus === 'unavailable'
        ? 'UNAVAILABLE'
        : 'NO RESULTS';
    lines.push(`**Web Search Calibration — ${stateLabel}**`);
    lines.push('');
    lines.push(cal.summary || 'Web search was skipped — proceeding with the Stage 0 query plan.');
    lines.push('');
    if (cal.warnings && cal.warnings.length > 0) {
      lines.push('**Warnings**');
      lines.push('');
      for (const warning of cal.warnings) {
        lines.push(`- ${warning}`);
      }
      lines.push('');
    }
    lines.push('Shall I proceed?');
    lines.push('1. Yes — start retrieval with the original plan');
    lines.push('2. Modify — I\'d like to adjust something');
    lines.push('3. Exit — abandon this research and switch to normal chat');
    lines.push('');

    if (costInfo) {
      lines.push('---');
      lines.push(`*Stage 1 used ${costInfo.inputTokens} input + ${costInfo.outputTokens} output tokens (~$${costInfo.costUsd.toFixed(4)} equivalent)*`);
      lines.push('');
    }

    return lines.join('\n');
  }

  const status = cal.queryPlanRefined ? 'CALIBRATED' : 'CONFIRMED';

  // 1. Header
  lines.push(`**Web Search Calibration** — ${status}`);
  lines.push('');

  // 2. Summary
  if (cal.summary) {
    lines.push(cal.summary);
    lines.push('');
  }

  if (cal.warnings && cal.warnings.length > 0) {
    lines.push('**Warnings**');
    lines.push('');
    for (const warning of cal.warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push('');
  }

  // 3. Changes Made
  if (cal.queryPlanRefined) {
    if (cal.queriesAdded.length > 0) {
      lines.push('**Queries Added**');
      lines.push('');
      for (const q of cal.queriesAdded) {
        const reason = q.reason ? ` — ${q.reason}` : '';
        lines.push(`- [${q.role}] ${q.query}${reason}`);
      }
      lines.push('');
    }

    if (cal.queriesModified.length > 0) {
      lines.push('**Queries Modified**');
      lines.push('');
      for (const q of cal.queriesModified) {
        const reason = q.reason ? ` — ${q.reason}` : '';
        lines.push(`- ${q.original} → ${q.modified}${reason}`);
      }
      lines.push('');
    }

    if (cal.queriesDemoted.length > 0) {
      lines.push('**Queries Demoted**');
      lines.push('');
      for (const q of cal.queriesDemoted) {
        const reason = q.reason ? ` — ${q.reason}` : '';
        lines.push(`- ${q.query}${reason}`);
      }
      lines.push('');
    }

    if (cal.scopeChanged) {
      lines.push('*Scope was adjusted based on web search findings.*');
      lines.push('');
    }
  }

  // 4. Proceed Prompt
  lines.push('Shall I proceed?');
  lines.push('1. Yes — start retrieval with the refined plan');
  lines.push('2. Modify — I\'d like to adjust something');
  lines.push('3. Exit — abandon this research and switch to normal chat');
  lines.push('');

  // 5. Collapsible Raw JSON — blank lines around fenced code block for rehype-raw
  lines.push('<details>');
  lines.push('<summary>[DATA] Calibration Details (JSON)</summary>');
  lines.push('');
  lines.push('```json');
  lines.push(rawJson);
  lines.push('```');
  lines.push('');
  lines.push('</details>');
  lines.push('');

  // 6. Cost Footer
  if (costInfo) {
    lines.push('---');
    lines.push(`*Stage 1 used ${costInfo.inputTokens} input + ${costInfo.outputTokens} output tokens (~$${costInfo.costUsd.toFixed(4)} equivalent)*`);
    lines.push('');
  }

  return lines.join('\n');
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

/** Options for formatPauseMessage. */
export interface FormatPauseOptions {
  /** Diagnostic logging callback (threads ClaudeAgent.onDebug). */
  onDebug?: (msg: string) => void;
  /** Cost information for the stage (optional footer). */
  costInfo?: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
}

/** Result from formatPauseMessage — message + audit trail data. */
export interface FormatPauseResult {
  /** Formatted markdown message for UI display. */
  message: string;
  /** Which normalization path was used (for pause_formatted event audit). */
  normalizationPath: 'baml' | 'zod' | 'fallback';
}

/**
 * Top-level pause message formatter.
 *
 * Dispatches to stage-specific normalizer + formatter based on stageId.
 * Falls back to a wrapped raw output when normalization fails.
 *
 * @param stageId - Stage number (0-based)
 * @param stageName - Human-readable stage name
 * @param data - Structured data from StageResult.data
 * @param rawText - Raw LLM text from StageResult.text
 * @param options - Debug callback and cost info
 * @returns Formatted message + normalization path for audit
 */
export function formatPauseMessage(
  stageId: number,
  stageName: string,
  data: Record<string, unknown>,
  rawText: string,
  options?: FormatPauseOptions,
): FormatPauseResult {
  const onDebug = options?.onDebug;
  const costInfo = options?.costInfo;

  // Derive raw JSON for the collapsible block
  let rawJson: string;
  try {
    rawJson = JSON.stringify(data, null, 2);
  } catch {
    rawJson = rawText;
  }

  // Stage 0: analyze_query
  if (stageId === 0) {
    const normalized = normalizeStage0Data(data, onDebug);
    if (normalized) {
      // Detect path: if BAML fields are present (sub_queries[].text without .query)
      const rawSubQueries = extractSubQueries(data);
      const isBaml = rawSubQueries.length > 0
        && typeof rawSubQueries[0]?.['text'] === 'string'
        && !rawSubQueries[0]?.['query'];

      return {
        message: formatStage0PauseMessage(normalized, rawJson, costInfo),
        normalizationPath: isBaml ? 'baml' : 'zod',
      };
    }
    onDebug?.(`[pause-formatter] Stage ${stageId}: falling back to wrapped raw output`);
    return {
      message: buildFallbackMessage(stageId, stageName, rawJson, rawText, costInfo),
      normalizationPath: 'fallback',
    };
  }

  // Stage 1: websearch_calibration
  if (stageId === 1) {
    const normalized = normalizeStage1Data(data, onDebug);
    if (normalized) {
      const isBaml = data['calibration'] != null && data['websearch_calibration'] == null;
      return {
        message: formatStage1PauseMessage(normalized, rawJson, costInfo),
        normalizationPath: isBaml ? 'baml' : 'zod',
      };
    }
    onDebug?.(`[pause-formatter] Stage ${stageId}: falling back to wrapped raw output`);
    return {
      message: buildFallbackMessage(stageId, stageName, rawJson, rawText, costInfo),
      normalizationPath: 'fallback',
    };
  }

  // Unknown stages — fallback
  onDebug?.(`[pause-formatter] Stage ${stageId} (${stageName}): no specific formatter — using fallback`);
  return {
    message: buildFallbackMessage(stageId, stageName, rawJson, rawText, costInfo),
    normalizationPath: 'fallback',
  };
}

// ============================================================================
// FALLBACK FORMATTER
// ============================================================================

/**
 * Build a fallback message when normalization fails or stage is unknown.
 *
 * Wraps raw data in a collapsible block with a user-friendly explanation.
 * This is NOT the original bug (bare raw JSON) — it explains the situation.
 */
function buildFallbackMessage(
  stageId: number,
  stageName: string,
  rawJson: string,
  rawText: string,
  costInfo?: { inputTokens: number; outputTokens: number; costUsd: number },
): string {
  const lines: string[] = [];

  lines.push(`**Stage ${stageId} (${stageName}) Complete**`);
  lines.push('');
  lines.push('The analysis produced structured data but it could not be formatted into a readable summary.');
  lines.push('');

  // Use JSON if available, else raw text
  const content = rawJson !== rawText ? rawJson : rawText;
  const lang = rawJson !== rawText ? 'json' : '';

  lines.push('<details>');
  lines.push('<summary>[DATA] Raw Output</summary>');
  lines.push('');
  lines.push(`\`\`\`${lang}`);
  lines.push(content);
  lines.push('```');
  lines.push('');
  lines.push('</details>');
  lines.push('');
  lines.push('Please review the data above and respond to continue.');
  lines.push('');

  if (costInfo) {
    lines.push('---');
    lines.push(`*Stage ${stageId} used ${costInfo.inputTokens} input + ${costInfo.outputTokens} output tokens (~$${costInfo.costUsd.toFixed(4)} equivalent)*`);
    lines.push('');
  }

  return lines.join('\n');
}

// ============================================================================
// UTILITY HELPERS
// ============================================================================

/** Safely extract a string field from an object. */
function stringField(obj: Record<string, unknown>, key: string): string | null {
  const val = obj[key];
  return typeof val === 'string' ? val : null;
}

/** Convert unknown value to string array (handles arrays of strings, arrays of objects with text). */
function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object' && typeof (item as Record<string, unknown>)['text'] === 'string') {
        return (item as Record<string, unknown>)['text'] as string;
      }
      return null;
    })
    .filter((item): item is string => item !== null);
}

/** Convert unknown value to array of objects. */
function toObjectArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, unknown> => item != null && typeof item === 'object',
  );
}

/** Extract sub_queries array from nested data structure. */
function extractSubQueries(data: Record<string, unknown>): Array<Record<string, unknown>> {
  const plan = data['query_plan'] as Record<string, unknown> | undefined;
  const container = (plan && typeof plan === 'object') ? plan : data;
  return toObjectArray(container['sub_queries']);
}

function executionStatusField(value: unknown): NormalizedCalibration['executionStatus'] {
  if (value === 'user_skipped' || value === 'unavailable' || value === 'no_results' || value === 'calibrated') {
    return value;
  }
  return undefined;
}
