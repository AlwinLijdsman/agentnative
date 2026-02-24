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

  // 9. Prior research references
  if (finalAnswer.priorSections?.length) {
    parts.push(buildPriorResearchReferences(finalAnswer.priorSections, config));
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

  // Split synthesis into sections by ## headings
  const sections = splitIntoSections(synthesis);

  const processedSections = sections.map((section) => {
    // If the section already has a > **Sources** block, leave it as-is
    if (section.includes('> **Sources**')) {
      return linkifyCitations(section, linker, config.citationRegex);
    }

    // Otherwise, inject source blocks for citations found in this section
    const injected = injectSourceBlocks(section, sourceTexts, config.citationRegex);
    return linkifyCitations(injected, linker, config.citationRegex);
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
  const items = refs.map((r) =>
    `- [${r.title}](${r.url})${r.sourceType ? ` *(${r.sourceType})*` : ''}\n  ${r.insight}`,
  );

  return `## ${config.sections.externalReferencesTitle}\n\n${items.join('\n\n')}`;
}

function buildPriorResearchReferences(
  sections: PriorSection[],
  config: RenderConfig,
): string {
  const refFormat = config.priorResearch?.refFormat ?? '[P{num}]';
  const excerptLen = config.priorResearch?.excerptLength ?? 200;

  const items = sections.map((s) => {
    const label = refFormat.replace('{num}', String(s.sectionNum));
    const excerpt = truncate(s.excerpt, excerptLen);
    return `- **${label}** ${s.heading}\n  > *${excerpt}*`;
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
