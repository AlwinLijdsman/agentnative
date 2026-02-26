/**
 * Synthesis Post-Processor — Deterministic Label Injection
 *
 * Safety net that runs AFTER Stage 3 LLM synthesis but BEFORE Stage 5 rendering.
 * Guarantees that WEB_REF markers and inline [W#] labels exist in the synthesis
 * text, even when the LLM fails to produce them (measured at 0% adherence for
 * inline labels across real pipeline runs).
 *
 * Also handles PRIOR_REF markers and [P#] inline labels for follow-up sessions.
 *
 * Algorithm:
 * 1. Check if WEB_REF markers exist → inject missing ones into best-matching sections
 * 2. Check if [W#] inline labels exist → inject at best-matching sentences
 * 3. Same for PRIOR_REF and [P#]
 *
 * Design principles:
 * - Pure deterministic string processing — NO LLM calls
 * - Never injects duplicates — checks before injecting
 * - Keyword-overlap scoring for section/sentence matching
 * - Graceful degradation — if no good match, inject into Executive Summary
 * - Sub-millisecond performance (pure string ops)
 *
 * Section 19 — Reliable inline web & prior reference labels.
 */

import type { WebReference, PriorSection } from '@craft-agent/session-tools-core/renderer-types';

// Re-export types for convenience
export type { WebReference, PriorSection };

// ============================================================================
// TYPES
// ============================================================================

/** PriorSection as passed from the context builder (may lack sectionNum). */
export interface PriorSectionInput {
  sectionId: string;
  heading: string;
  excerpt: string;
  sectionNum?: number;
}

export interface PostProcessResult {
  synthesis: string;
  webRefsInjected: number;
  webLabelsInjected: number;
  priorRefsInjected: number;
  priorLabelsInjected: number;
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Post-process synthesis text to ensure WEB_REF/PRIOR_REF markers and
 * inline [W#]/[P#] labels are present.
 *
 * This is the main entry point, called from stage-runner.ts after Stage 3.
 */
export function postProcessSynthesis(
  synthesis: string,
  webSources: WebReference[],
  priorSections: PriorSectionInput[],
): PostProcessResult {
  let result = synthesis;
  let webRefsInjected = 0;
  let webLabelsInjected = 0;
  let priorRefsInjected = 0;
  let priorLabelsInjected = 0;

  // ── Step 1: Ensure WEB_REF markers exist ──────────────────────────────
  if (webSources.length > 0) {
    const webResult = ensureWebRefMarkers(result, webSources);
    result = webResult.synthesis;
    webRefsInjected = webResult.injectedCount;
  }

  // ── Step 2: Ensure [W#] inline labels exist ───────────────────────────
  if (webSources.length > 0) {
    const labelResult = ensureWebInlineLabels(result, webSources);
    result = labelResult.synthesis;
    webLabelsInjected = labelResult.injectedCount;
  }

  // ── Step 3: Ensure PRIOR_REF markers exist ────────────────────────────
  if (priorSections.length > 0) {
    const priorResult = ensurePriorRefMarkers(result, priorSections);
    result = priorResult.synthesis;
    priorRefsInjected = priorResult.injectedCount;
  }

  // ── Step 4: Ensure [P#] inline labels exist ───────────────────────────
  if (priorSections.length > 0) {
    const priorLabelResult = ensurePriorInlineLabels(result, priorSections);
    result = priorLabelResult.synthesis;
    priorLabelsInjected = priorLabelResult.injectedCount;
  }

  if (webRefsInjected + webLabelsInjected + priorRefsInjected + priorLabelsInjected > 0) {
    console.info(
      `[SynthesisPostProcessor] Injected: ` +
      `${webRefsInjected} WEB_REF markers, ${webLabelsInjected} [W#] labels, ` +
      `${priorRefsInjected} PRIOR_REF markers, ${priorLabelsInjected} [P#] labels`,
    );
  }

  return {
    synthesis: result,
    webRefsInjected,
    webLabelsInjected,
    priorRefsInjected,
    priorLabelsInjected,
  };
}

// ============================================================================
// WEB_REF MARKER INJECTION
// ============================================================================

/**
 * Ensure each web source has a WEB_REF marker in at least one Sources blockquote.
 */
function ensureWebRefMarkers(
  synthesis: string,
  webSources: WebReference[],
): { synthesis: string; injectedCount: number } {
  let result = synthesis;
  let injectedCount = 0;

  for (const source of webSources) {
    // Check if a WEB_REF for this URL (or its domain) already exists
    if (hasWebRefForSource(result, source)) {
      continue;
    }

    // Find the best-matching section for this source's insight
    const sections = splitBySections(result);
    const bestIdx = findBestMatchingSection(sections, source.insight);
    const targetSection = sections[bestIdx];

    if (targetSection == null) continue;

    // Inject WEB_REF marker into the section's Sources blockquote
    const injected = injectWebRefIntoSection(targetSection, source);
    if (injected !== targetSection) {
      sections[bestIdx] = injected;
      result = sections.join('');
      injectedCount++;
    }
  }

  return { synthesis: result, injectedCount };
}

/**
 * Check if a WEB_REF marker for this source already exists.
 * Uses domain-based fuzzy matching (same as renderer).
 */
function hasWebRefForSource(synthesis: string, source: WebReference): boolean {
  // Exact URL match
  if (synthesis.includes(`WEB_REF|${source.url}`)) return true;

  // Domain-based fuzzy match
  try {
    const domain = new URL(source.url).hostname;
    const webRefRegex = /WEB_REF\|([^|]+)\|/g;
    let match: RegExpExecArray | null;
    while ((match = webRefRegex.exec(synthesis)) !== null) {
      try {
        const refDomain = new URL(match[1] ?? '').hostname;
        if (refDomain === domain) return true;
      } catch {
        // skip malformed URLs
      }
    }
  } catch {
    // skip malformed source URL
  }

  return false;
}

/**
 * Inject a WEB_REF marker into a section's Sources blockquote.
 * If no Sources blockquote exists, create one at the end of the section.
 */
function injectWebRefIntoSection(section: string, source: WebReference): string {
  const marker = `> WEB_REF|${source.url}|${source.insight.split('\n')[0] ?? source.title}`;

  // Find existing Sources blockquote
  const sourcesIdx = section.lastIndexOf('> **Sources**');
  if (sourcesIdx !== -1) {
    // Find the end of the Sources blockquote (first non-blockquote line after it)
    const afterSources = section.slice(sourcesIdx);
    const lines = afterSources.split('\n');
    let insertIdx = lines.length; // default: end of blockquote

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i] ?? '';
      // End of blockquote: non-empty line that doesn't start with >
      if (line.trim() !== '' && !line.startsWith('>')) {
        insertIdx = i;
        break;
      }
    }

    // Insert marker before the end of blockquote
    lines.splice(insertIdx, 0, '>', marker);
    return section.slice(0, sourcesIdx) + lines.join('\n');
  }

  // No Sources blockquote found — create one at end of section
  return section.trimEnd() + '\n\n> **Sources**\n>\n' + marker + '\n';
}

// ============================================================================
// [W#] INLINE LABEL INJECTION
// ============================================================================

/**
 * Ensure each web source has at least one [W#] inline label in body text.
 */
function ensureWebInlineLabels(
  synthesis: string,
  webSources: WebReference[],
): { synthesis: string; injectedCount: number } {
  let result = synthesis;
  let injectedCount = 0;

  for (let i = 0; i < webSources.length; i++) {
    const label = `[W${i + 1}]`;
    const source = webSources[i];

    if (source == null) continue;

    // Check if this label already exists in body text (not in Sources blockquotes)
    if (hasInlineLabelInBody(result, label)) {
      continue;
    }

    // Find the best sentence to attach this label to
    const injected = injectInlineLabel(result, label, source.insight);
    if (injected !== result) {
      result = injected;
      injectedCount++;
    }
  }

  return { synthesis: result, injectedCount };
}

// ============================================================================
// PRIOR_REF MARKER INJECTION
// ============================================================================

/**
 * Ensure each prior section has a PRIOR_REF marker in at least one Sources blockquote.
 */
function ensurePriorRefMarkers(
  synthesis: string,
  priorSections: PriorSectionInput[],
): { synthesis: string; injectedCount: number } {
  let result = synthesis;
  let injectedCount = 0;

  for (const ps of priorSections) {
    // Check if PRIOR_REF for this section already exists
    if (result.includes(`PRIOR_REF|${ps.sectionId}|`)) {
      continue;
    }

    // Find best-matching section
    const sections = splitBySections(result);
    const bestIdx = findBestMatchingSection(sections, ps.excerpt);
    const targetSection = sections[bestIdx];

    if (targetSection == null) continue;

    const marker = `> PRIOR_REF|${ps.sectionId}|${ps.heading}|${truncateStr(ps.excerpt, 100)}`;

    // Inject into Sources blockquote
    const sourcesIdx = targetSection.lastIndexOf('> **Sources**');
    if (sourcesIdx !== -1) {
      // Find the position right after ISA sources but before WEB_REF markers
      const afterSources = targetSection.slice(sourcesIdx);
      const lines = afterSources.split('\n');
      let insertIdx = lines.length;

      for (let i = 1; i < lines.length; i++) {
        const line = (lines[i] ?? '').replace(/^> ?/, '');
        // Insert before WEB_REF markers or end of blockquote
        if (line.startsWith('WEB_REF|') || (line.trim() !== '' && !(lines[i] ?? '').startsWith('>'))) {
          insertIdx = i;
          break;
        }
      }

      lines.splice(insertIdx, 0, '>', marker);
      sections[bestIdx] = targetSection.slice(0, sourcesIdx) + lines.join('\n');
      result = sections.join('');
      injectedCount++;
    } else {
      // No Sources blockquote — create one
      sections[bestIdx] = targetSection.trimEnd() + '\n\n> **Sources**\n>\n' + marker + '\n';
      result = sections.join('');
      injectedCount++;
    }
  }

  return { synthesis: result, injectedCount };
}

// ============================================================================
// [P#] INLINE LABEL INJECTION
// ============================================================================

/**
 * Ensure each prior section has at least one [P#] inline label in body text.
 */
function ensurePriorInlineLabels(
  synthesis: string,
  priorSections: PriorSectionInput[],
): { synthesis: string; injectedCount: number } {
  let result = synthesis;
  let injectedCount = 0;

  for (const ps of priorSections) {
    const num = ps.sectionNum ?? extractNumFromId(ps.sectionId);
    const label = `[P${num}]`;

    // Check if this label already exists in body text
    if (hasInlineLabelInBody(result, label)) {
      continue;
    }

    // Find the best sentence to attach this label to
    const injected = injectInlineLabel(result, label, ps.excerpt);
    if (injected !== result) {
      result = injected;
      injectedCount++;
    }
  }

  return { synthesis: result, injectedCount };
}

// ============================================================================
// SHARED HELPERS
// ============================================================================

/**
 * Check if an inline label (e.g., "[W1]", "[P2]") exists in body text
 * (outside of Sources blockquotes and markers).
 */
function hasInlineLabelInBody(synthesis: string, label: string): boolean {
  const lines = synthesis.split('\n');
  for (const line of lines) {
    // Skip blockquote lines and marker lines
    if (line.startsWith('>')) continue;
    if (line.startsWith('WEB_REF|')) continue;
    if (line.startsWith('PRIOR_REF|')) continue;
    if (line.includes(label)) return true;
  }
  return false;
}

/**
 * Inject an inline label at the end of the best-matching sentence in body text.
 * Returns the modified synthesis, or the original if no good match found.
 */
function injectInlineLabel(
  synthesis: string,
  label: string,
  insightText: string,
): string {
  const sections = splitBySections(synthesis);
  const bestSectionIdx = findBestMatchingSection(sections, insightText);
  const section = sections[bestSectionIdx];

  if (section == null) return synthesis;

  // Extract body lines (non-blockquote, non-heading, non-empty)
  const lines = section.split('\n');
  let bestLineIdx = -1;
  let bestScore = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    // Skip blockquote, heading, empty, and marker lines
    if (line.startsWith('>')) continue;
    if (line.startsWith('#')) continue;
    if (line.startsWith('WEB_REF|')) continue;
    if (line.startsWith('PRIOR_REF|')) continue;
    if (line.trim().length < 20) continue;

    const score = keywordOverlapScore(line, insightText);
    if (score > bestScore) {
      bestScore = score;
      bestLineIdx = i;
    }
  }

  // Require minimum relevance threshold
  if (bestLineIdx === -1 || bestScore < 0.05) {
    // Fallback: find the first substantial prose line in the section
    bestLineIdx = findFirstProseLine(lines);
    if (bestLineIdx === -1) return synthesis;
  }

  // Inject label at the end of the sentence (before the period or at line end)
  const targetLine = lines[bestLineIdx] ?? '';
  lines[bestLineIdx] = appendLabelToLine(targetLine, label);

  sections[bestSectionIdx] = lines.join('\n');
  return sections.join('');
}

/**
 * Append a label to the end of a line, before the final period if present.
 * "...must evaluate estimation uncertainty." → "...must evaluate estimation uncertainty [W1]."
 * "...for insurance reserves" → "...for insurance reserves [W1]"
 */
function appendLabelToLine(line: string, label: string): string {
  // Don't double-inject
  if (line.includes(label)) return line;

  const trimmed = line.trimEnd();

  // If line ends with a period, insert before it
  if (trimmed.endsWith('.')) {
    return trimmed.slice(0, -1) + ' ' + label + '.';
  }

  // If line ends with period + asterisk/bold (markdown formatting)
  if (trimmed.endsWith('.**')) {
    return trimmed.slice(0, -3) + ' ' + label + '.**';
  }

  // Otherwise append at end
  return trimmed + ' ' + label;
}

/**
 * Split synthesis into sections by ## headings.
 * Each section includes its heading line and all content until the next ## heading.
 * Text before the first ## heading is the first element.
 */
function splitBySections(synthesis: string): string[] {
  // Split keeping the delimiter (## heading)
  const parts = synthesis.split(/(?=^## )/m);
  return parts.length > 0 ? parts : [synthesis];
}

/**
 * Find the section index whose body text best matches the given insight.
 * Uses keyword overlap scoring.
 * Falls back to section 0 (Executive Summary) if no good match.
 */
function findBestMatchingSection(sections: string[], insight: string): number {
  let bestIdx = 0;
  let bestScore = 0;

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i] ?? '';
    // Only score body text (skip blockquotes)
    const bodyText = section.split('\n')
      .filter(l => !l.startsWith('>') && !l.startsWith('WEB_REF|') && !l.startsWith('PRIOR_REF|'))
      .join(' ');
    const score = keywordOverlapScore(bodyText, insight);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  return bestIdx;
}

/**
 * Compute keyword overlap score between two texts.
 * Returns a value between 0 and 1 representing the fraction of insight
 * keywords found in the target text.
 */
export function keywordOverlapScore(target: string, insight: string): number {
  const targetWords = extractKeywords(target);
  const insightWords = extractKeywords(insight);

  if (insightWords.size === 0) return 0;

  let matchCount = 0;
  for (const word of insightWords) {
    if (targetWords.has(word)) matchCount++;
  }

  return matchCount / insightWords.size;
}

/**
 * Extract meaningful keywords from text (lowercased, stopwords removed).
 */
function extractKeywords(text: string): Set<string> {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
  return new Set(words.filter(w => w.length > 3 && !STOP_WORDS.has(w)));
}

/**
 * Find the first substantial prose line in a section (not heading/blockquote/empty).
 */
function findFirstProseLine(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.startsWith('>')) continue;
    if (line.startsWith('#')) continue;
    if (line.startsWith('WEB_REF|')) continue;
    if (line.startsWith('PRIOR_REF|')) continue;
    if (line.trim().length < 20) continue;
    return i;
  }
  return -1;
}

/**
 * Extract the numeric part from a section ID like "P1" → 1, "P2" → 2.
 */
function extractNumFromId(sectionId: string): number {
  const match = sectionId.match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}

/**
 * Truncate a string to max length.
 */
function truncateStr(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}

// ============================================================================
// STOP WORDS (filtered from keyword matching)
// ============================================================================

const STOP_WORDS = new Set([
  'the', 'that', 'this', 'with', 'from', 'have', 'been', 'were', 'will',
  'would', 'could', 'should', 'shall', 'must', 'also', 'such', 'than',
  'into', 'when', 'where', 'which', 'what', 'each', 'every', 'both',
  'more', 'most', 'some', 'other', 'their', 'them', 'they', 'there',
  'these', 'those', 'about', 'between', 'through', 'during', 'before',
  'after', 'above', 'below', 'under', 'over', 'does', 'done', 'doing',
  'having', 'being', 'very', 'just', 'only', 'like', 'make', 'made',
  'well', 'back', 'even', 'still', 'also', 'then', 'here', 'many',
  'much', 'same', 'need', 'take', 'come', 'give', 'keep', 'help',
  'show', 'turn', 'part', 'include', 'including', 'including',
]);
