/**
 * Output Renderer — Core rendering engine.
 *
 * Assembles a complete markdown research document from pipeline outputs.
 * All rendering is deterministic string processing — no LLM involvement.
 *
 * Assembly order:
 * 1. Title + metadata header
 * 2. Original question
 * 3. Confidence qualifier
 * 4. Synthesis body (with injected source blocks per section)
 * 5. Out-of-scope notes
 * 6. Verification summary table
 * 7. Citations used table
 * 8. External references (web)
 * 9. Prior research references
 * 10. Research decomposition appendix
 */

import type {
  FinalAnswer,
  RenderConfig,
  RenderResult,
  SourceLinker,
  VerificationScores,
  Citation,
  SubQuery,
  WebReference,
  PriorSection,
} from './types.ts';
import {
  markdownTable,
  blockquote,
  metadataHeader,
  separator,
  collapsible,
  escapeMd,
  formatSourceBlockSpacing,
} from './markdown-formatters.ts';

// ============================================================
// Main Renderer
// ============================================================

export function renderDocument(
  finalAnswer: FinalAnswer,
  config: RenderConfig,
  linker: SourceLinker,
): string {
  const parts: string[] = [];

  // 1. Title + metadata
  parts.push(buildTitle(finalAnswer, config));

  // 2. Original question
  parts.push(buildOriginalQuestion(finalAnswer.originalQuery));

  // 3. Confidence qualifier
  parts.push(buildConfidenceQualifier(finalAnswer.verificationScores, config));

  // 4. Synthesis body with source blocks
  parts.push(buildSynthesisBody(finalAnswer, config, linker));

  // 5. Out-of-scope notes
  if (finalAnswer.outOfScopeNotes) {
    parts.push(buildOutOfScopeNotes(finalAnswer.outOfScopeNotes));
  }

  // 6. Verification summary table
  parts.push(buildVerificationTable(finalAnswer.verificationScores, config));

  // 7. Citations used table
  parts.push(buildCitationsTable(finalAnswer.citations, linker, config));

  // 8. External references (web)
  if (finalAnswer.webReferences?.length) {
    parts.push(buildExternalReferences(finalAnswer.webReferences, config));
  }

  // 9. Prior research references (filtered to only referenced sections — Section 18, F6)
  if (finalAnswer.priorSections?.length) {
    const synthesisBody = buildSynthesisBody(finalAnswer, config, linker);
    parts.push(buildPriorResearchReferences(finalAnswer.priorSections, config, synthesisBody));
  }

  // 10. Research decomposition appendix
  parts.push(buildResearchDecomposition(finalAnswer.subQueries, config));

  return parts.filter(Boolean).join('\n\n');
}

// ============================================================
// Section Builders
// ============================================================

function buildTitle(finalAnswer: FinalAnswer, config: RenderConfig): string {
  let title = config.titleTemplate;

  if (finalAnswer.followupNumber && finalAnswer.followupNumber > 0 && config.followupTitleTemplate) {
    title = config.followupTitleTemplate.replace('{n}', String(finalAnswer.followupNumber));
  }

  const meta = metadataHeader([
    ['Depth Mode', finalAnswer.depthMode],
    ['Sub-queries', String(finalAnswer.subQueries.length)],
    ['Citations', String(finalAnswer.citations.length)],
  ]);

  return `# ${title}\n\n${meta}`;
}

function buildOriginalQuestion(query: string): string {
  return `## Original Question\n\n${blockquote(query)}`;
}

function buildConfidenceQualifier(
  scores: VerificationScores,
  config: RenderConfig,
): string {
  const avgScore = computeAverageScore(scores);
  const thresholds = config.confidence.qualifierThresholds;

  let qualifier: string;
  let icon: string;
  if (avgScore >= thresholds.high) {
    qualifier = 'High';
    icon = '[OK]';
  } else if (avgScore >= thresholds.medium) {
    qualifier = 'Medium';
    icon = '[WARN]';
  } else {
    qualifier = 'Low';
    icon = '[FAIL]';
  }

  return `**Overall Confidence:** ${icon} ${qualifier} (${(avgScore * 100).toFixed(0)}%)`;
}

function buildSynthesisBody(
  finalAnswer: FinalAnswer,
  config: RenderConfig,
  linker: SourceLinker,
): string {
  const { synthesis, sourceTexts } = finalAnswer;

  // Pre-normalize: move orphaned WEB_REF/PRIOR_REF markers into Sources blocks (Section 19, Phase 5)
  const normalized = normalizeOrphanedMarkers(synthesis);

  // Process WEB_REF and PRIOR_REF markers before splitting into sections (Section 17, F4)
  let processed = injectWebAndPriorMarkers(
    normalized,
    finalAnswer.webReferences ?? [],
    finalAnswer.priorSections ?? [],
    config,
  );

  // Apply source block spacing to prevent blockquote wall (Section 17, F9)
  processed = formatSourceBlockSpacing(processed);

  // Split synthesis into sections by ## headings
  const sections = splitIntoSections(processed);

  const processedSections = sections.map((section) => {
    // If the section already has a > **Sources** block, leave it as-is
    if (section.includes('> **Sources**')) {
      return linkifyCitations(section, linker, config.citationRegex);
    }

    // Otherwise, inject source blocks for citations found in this section
    const injected = injectSourceBlocks(section, sourceTexts, config.citationRegex);
    // Apply source block spacing after injection (Section 17, F9)
    const spaced = formatSourceBlockSpacing(injected);
    return linkifyCitations(spaced, linker, config.citationRegex);
  });

  return processedSections.join(separator());
}

function buildOutOfScopeNotes(notes: string): string {
  return `## Out of Scope\n\n${notes}`;
}

function buildVerificationTable(
  scores: VerificationScores,
  _config: RenderConfig,
): string {
  const rows: string[][] = [];

  rows.push(verificationRow('Entity Grounding', scores.entity_grounding.score, scores.entity_grounding.passed));
  rows.push(verificationRow('Citation Accuracy', scores.citation_accuracy.score, scores.citation_accuracy.passed));
  rows.push(verificationRow('Relation Preservation', scores.relation_preservation.score, scores.relation_preservation.passed));
  rows.push(contradictionRow(scores.contradictions.count, scores.contradictions.passed));

  const table = markdownTable(
    ['Axis', 'Score', 'Status'],
    rows,
  );

  return `## Verification Summary\n\n${table}`;
}

function buildCitationsTable(
  citations: Citation[],
  linker: SourceLinker,
  _config: RenderConfig,
): string {
  if (!citations.length) {
    return '## Citations Used\n\n*No citations.*';
  }

  const rows = citations.map((c) => [
    linker.linkifyRef(c.sourceRef),
    c.verified ? '[OK]' : '[FAIL]',
    c.matchLevel ?? '-',
    truncate(c.claim, 60),
  ]);

  const table = markdownTable(
    ['Source', 'Verified', 'Match', 'Claim'],
    rows,
  );

  return `## Citations Used\n\n${table}`;
}

function buildExternalReferences(
  refs: WebReference[],
  config: RenderConfig,
): string {
  const refFormat = config.webReference?.refFormat ?? '[W{num}]';
  const linkToOriginal = config.webReference?.linkToOriginal ?? true;

  const items = refs.map((r, i) => {
    const label = refFormat.replace('{num}', String(i + 1));
    const title = escapeMd(r.title);
    const link = linkToOriginal ? `[${title}](${r.url})` : title;
    const sourceTag = r.sourceType ? ` *(${r.sourceType})*` : '';
    return `- **${label}** ${link}${sourceTag}\n  ${r.insight}`;
  });

  return `## ${config.sections.externalReferencesTitle}\n\n${items.join('\n\n')}`;
}

function buildPriorResearchReferences(
  sections: PriorSection[],
  config: RenderConfig,
  answerBody: string,
): string {
  const refFormat = config.priorResearch?.refFormat ?? '[P{num}]';
  const excerptLen = config.priorResearch?.excerptLength ?? 200;

  // Filter to only sections referenced in the answer body via [P1], [P2] etc. (Section 18, F6)
  const referencedNums = new Set(
    [...answerBody.matchAll(/\[P(\d+)\]/g)].map(m => parseInt(m[1] ?? '0', 10)),
  );
  const filtered = referencedNums.size > 0
    ? sections.filter(s => referencedNums.has(s.sectionNum))
    : sections; // If no inline references found, show all (graceful fallback)

  if (!filtered.length) return '';

  const items = filtered.map((s) => {
    const label = refFormat.replace('{num}', String(s.sectionNum));
    const excerpt = truncate(s.excerpt, excerptLen);
    const heading = escapeMd(s.heading);
    return `- **${label}** ${heading}\n  > *${excerpt}*`;
  });

  return `## ${config.sections.priorResearchTitle}\n\n${items.join('\n\n')}`;
}

function buildResearchDecomposition(
  subQueries: SubQuery[],
  config: RenderConfig,
): string {
  if (!subQueries.length) {
    return '';
  }

  const rows = subQueries.map((sq) => [
    sq.role,
    sq.query,
    sq.standards.join(', '),
    sq.paragraphsFound !== undefined ? String(sq.paragraphsFound) : '-',
  ]);

  const table = markdownTable(
    ['Role', 'Query', 'Standards', 'Paragraphs'],
    rows,
  );

  const content = `## ${config.sections.researchDecompositionTitle}\n\n${table}`;
  return collapsible('Research Decomposition', content);
}

// ============================================================
// Source Block Injection
// ============================================================

/**
 * Parse citations from a section using the configured regex,
 * look up source texts, and append a > **Sources** blockquote.
 */
export function injectSourceBlocks(
  sectionText: string,
  sourceTexts: Record<string, string>,
  citationRegex: string,
): string {
  // Extract unique citation refs from the section
  const regex = new RegExp(citationRegex, 'g');
  const matches = sectionText.match(regex);
  if (!matches || matches.length === 0) {
    return sectionText;
  }

  // Strip parentheses from matched refs — "(ISA 540.13)" → "ISA 540.13"
  const uniqueRefs = [...new Set(matches.map((m) => m.replace(/^\(/, '').replace(/\)$/, '')))];

  // Build source entries from available source texts
  const sourceEntries: string[] = [];
  for (const ref of uniqueRefs) {
    const text = sourceTexts[ref];
    if (text) {
      sourceEntries.push(`> **${ref}:** *"${truncate(text, 300)}"*`);
    }
  }

  if (sourceEntries.length === 0) {
    return sectionText;
  }

  return sectionText + '\n\n> **Sources**\n>\n' + sourceEntries.join('\n>\n');
}

/**
 * Replace inline citation text with linked versions where possible.
 */
function linkifyCitations(
  text: string,
  linker: SourceLinker,
  citationRegex: string,
): string {
  const regex = new RegExp(citationRegex, 'g');
  return text.replace(regex, (match) => {
    const hadOuterParens = match.startsWith('(');
    const ref = match.replace(/^\(/, '').replace(/\)$/, '');
    const linked = linker.linkifyRef(ref);
    if (linked === ref) {
      return match; // No link available — keep original
    }
    // Preserve original parentheses style
    return hadOuterParens ? `(${linked})` : linked;
  });
}

// ============================================================
// Web & Prior Reference Marker Processing (Section 18, F3/F4/F5)
// ============================================================

/**
 * Process a single WEB_REF marker line into a formatted italic blockquote line.
 *
 * Input:  `WEB_REF|https://example.com|Key insight`
 * Output: `*[W1] [Page Title](url): "Key insight"*`
 *
 * Mirrors gamma's italic blockquote style for web references.
 *
 * @returns Object with formatted text and updated nextIdx
 */
export function processWebRefLine(
  line: string,
  webReferences: WebReference[],
  webLabelMap: Map<string, number>,
  nextIdx: number,
  config: RenderConfig,
): { text: string; nextIdx: number } {
  const refFormat = config.webReference?.refFormat ?? '[W{num}]';
  const linkToOriginal = config.webReference?.linkToOriginal ?? true;

  const parts = line.split('|');
  if (parts.length < 3) {
    return { text: line, nextIdx };
  }
  const url = (parts[1] ?? '').trim();
  const insight = parts.slice(2).join('|').trim();

  const ref = fuzzyUrlLookup(url, webReferences);

  // Assign sequential label
  let idx = webLabelMap.get(ref?.url ?? url);
  if (idx === undefined) {
    idx = nextIdx++;
    webLabelMap.set(ref?.url ?? url, idx);
  }

  const label = refFormat.replace('{num}', String(idx));
  const title = ref?.title ? escapeMd(ref.title) : extractDomain(url);

  if (linkToOriginal && (ref?.url ?? url)) {
    return {
      text: `*${label} [${title}](${ref?.url ?? url}): "${escapeMd(insight)}"*`,
      nextIdx,
    };
  }
  return {
    text: `*${label} ${title}: "${escapeMd(insight)}"*`,
    nextIdx,
  };
}

/**
 * Process a single PRIOR_REF marker line into formatted blockquote lines.
 *
 * Input:  `PRIOR_REF|P1|Risk Assessment|The framework identifies...`
 * Output: `*From prior research — Risk Assessment [P1]*`
 *         `*The framework identifies...*`
 *
 * Mirrors gamma's blockquote excerpt style for prior references.
 *
 * @returns Object with array of formatted lines (each should be prefixed with `> ` by caller)
 */
export function processPriorRefLine(
  line: string,
  priorSections: PriorSection[],
  config: RenderConfig,
): { lines: string[] } {
  const priorRefFormat = config.priorResearch?.refFormat ?? '[P{num}]';
  const parts = line.split('|');

  if (parts.length < 4) {
    return { lines: [line] };
  }

  const sectionId = (parts[1] ?? '').trim();
  const heading = (parts[2] ?? '').trim();
  const excerpt = parts.slice(3).join('|').trim();

  // Try to match section by sectionId string or sectionNum
  const numMatch = sectionId.match(/\d+/);
  const sectionNum = numMatch ? parseInt(numMatch[0], 10) : 0;
  const section = priorSections.find(s =>
    s.sectionId === sectionId || s.sectionNum === sectionNum,
  );
  const num = section?.sectionNum ?? sectionNum;
  const label = priorRefFormat.replace('{num}', String(num));

  const result: string[] = [
    `*${label} From prior research — ${escapeMd(heading)}*`,
  ];
  if (excerpt) {
    result.push(`*${escapeMd(excerpt)}*`);
  }
  return { lines: result };
}

/**
 * Pre-normalization: Move orphaned WEB_REF and PRIOR_REF marker lines into the
 * nearest preceding `> **Sources**` blockquote.
 *
 * Real pipeline data (bright-rose session) showed the LLM placing WEB_REF markers
 * as standalone lines between sections, outside of any blockquote. This function
 * detects such orphaned markers and relocates them to the closest preceding Sources
 * blockquote. If no preceding Sources block exists, the marker is moved to the end
 * of the nearest following Sources block, or wrapped into a new Sources blockquote
 * appended to the preceding section.
 *
 * Section 19, Phase 5 — Blockquote normalization.
 */
export function normalizeOrphanedMarkers(body: string): string {
  const lines = body.split('\n');
  const output: string[] = [];
  const orphaned: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? '';
    const trimmedLine = rawLine.trimStart();

    // Check if this is an orphaned marker (not inside a blockquote)
    const isOrphanedWebRef = trimmedLine.startsWith('WEB_REF|') && !rawLine.startsWith('>');
    const isOrphanedPriorRef = trimmedLine.startsWith('PRIOR_REF|') && !rawLine.startsWith('>');

    if (isOrphanedWebRef || isOrphanedPriorRef) {
      orphaned.push(trimmedLine);
      continue;
    }

    // If we have accumulated orphaned markers and hit a non-orphan line,
    // try to flush them into the last Sources blockquote in output
    if (orphaned.length > 0) {
      flushOrphanedMarkers(output, orphaned);
      orphaned.length = 0;
    }

    output.push(rawLine);
  }

  // Flush any remaining orphaned markers at end of text
  if (orphaned.length > 0) {
    flushOrphanedMarkers(output, orphaned);
  }

  return output.join('\n');
}

/**
 * Flush accumulated orphaned markers into the last Sources blockquote in output,
 * or create a new one if none exists.
 */
function flushOrphanedMarkers(output: string[], orphaned: string[]): void {
  // Find the last Sources blockquote end position in output
  let lastSourcesEnd = -1;
  for (let i = output.length - 1; i >= 0; i--) {
    const line = output[i] ?? '';
    // A line that IS part of the last Sources blockquote
    if (line.startsWith('> ') && lastSourcesEnd === -1) {
      // Check if this is within a Sources block by scanning backward
      for (let j = i; j >= 0; j--) {
        if ((output[j] ?? '').includes('> **Sources**')) {
          lastSourcesEnd = i;
          break;
        }
        // If we hit a non-blockquote line before finding Sources header, not a Sources block
        if (!(output[j] ?? '').startsWith('>') && (output[j] ?? '').trim() !== '') {
          break;
        }
      }
    }
    if (lastSourcesEnd !== -1) break;
  }

  if (lastSourcesEnd !== -1) {
    // Insert after the last line of the Sources blockquote
    const insertLines = orphaned.map(m => `> ${m}`);
    output.splice(lastSourcesEnd + 1, 0, ...insertLines);
  } else {
    // No Sources blockquote found — create one at current position
    output.push('');
    output.push('> **Sources**');
    output.push('>');
    for (const marker of orphaned) {
      output.push(`> ${marker}`);
    }
  }
}

/**
 * Process WEB_REF and PRIOR_REF markers in synthesis text using line-by-line processing.
 *
 * Uses line-by-line approach (not regex `.replace()`) to properly handle
 * markers appearing inside `> ` blockquote prefixes. Strips the `> ` prefix
 * before matching, then re-emits markers as formatted blockquote lines.
 *
 * Inline [W1], [P1] labels in body text are left untouched — they were placed
 * by the LLM and should remain in prose.
 *
 * Mirrors gamma's `_inject_inline_excerpts()` pattern.
 */
export function injectWebAndPriorMarkers(
  body: string,
  webReferences: WebReference[],
  priorSections: PriorSection[],
  config: RenderConfig,
): string {
  const lines = body.split('\n');
  const output: string[] = [];
  const webLabelMap = new Map<string, number>();
  let nextWebIdx = 1;

  for (const rawLine of lines) {
    // Strip blockquote prefix for matching
    const inBlockquote = rawLine.startsWith('> ');
    const line = inBlockquote ? rawLine.slice(2) : rawLine;

    if (line.startsWith('WEB_REF|')) {
      // Process WEB_REF marker → formatted italic blockquote line
      const processed = processWebRefLine(
        line, webReferences, webLabelMap, nextWebIdx, config,
      );
      nextWebIdx = processed.nextIdx;
      output.push(`> ${processed.text}`);
    } else if (line.startsWith('PRIOR_REF|')) {
      // Process PRIOR_REF marker → blockquote with heading + excerpt
      const processed = processPriorRefLine(line, priorSections, config);
      output.push(...processed.lines.map(l => `> ${l}`));
    } else {
      // Leave non-marker lines unchanged (incl. inline [W1] labels in prose)
      output.push(rawLine);
    }
  }

  return output.join('\n');
}

/**
 * Extract domain from a URL for display as fallback title.
 */
function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Look up a web reference by URL, with domain-based fuzzy fallback.
 * Mirrors gamma's `_fuzzy_url_lookup` pattern.
 *
 * 1. Exact URL match
 * 2. Domain-based fallback (matches if domain is the same)
 */
export function fuzzyUrlLookup(
  url: string,
  refs: WebReference[],
): WebReference | undefined {
  // 1. Exact match
  const exact = refs.find(r => r.url === url);
  if (exact) return exact;

  // 2. Domain-based fallback
  try {
    const targetDomain = new URL(url).hostname;
    return refs.find(r => {
      try {
        return new URL(r.url).hostname === targetDomain;
      } catch {
        return false;
      }
    });
  } catch {
    return undefined;
  }
}

// ============================================================
// Helpers
// ============================================================

function splitIntoSections(synthesis: string): string[] {
  // Split on ## headings, keeping the heading with its content
  const parts = synthesis.split(/(?=^## )/m);
  return parts.filter((p) => p.trim().length > 0);
}

function computeAverageScore(scores: VerificationScores): number {
  const numericScores = [
    scores.entity_grounding.score,
    scores.citation_accuracy.score,
    scores.relation_preservation.score,
    // Contradictions: 0 = perfect (1.0), any count reduces score
    scores.contradictions.count === 0 ? 1.0 : Math.max(0, 1.0 - scores.contradictions.count * 0.2),
  ];
  return numericScores.reduce((a, b) => a + b, 0) / numericScores.length;
}

function verificationRow(name: string, score: number, passed: boolean): string[] {
  const pct = `${(score * 100).toFixed(0)}%`;
  const status = passed ? '[OK]' : score >= 0.5 ? '[WARN]' : '[FAIL]';
  return [name, pct, status];
}

function contradictionRow(count: number, passed: boolean): string[] {
  const status = passed ? '[OK]' : '[FAIL]';
  return ['Contradictions', String(count), status];
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}
