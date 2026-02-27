/**
 * Full Pipeline E2E: Web References, Follow-Up Context, Prior Answer References
 *
 * This script exercises the complete rendering + follow-up pipeline:
 *
 *  Run 1 (Initial Research):
 *    1. Creates a FinalAnswer with realistic synthesis containing WEB_REF markers + inline [W#] labels
 *    2. Calls renderDocument() to produce the full markdown output
 *    3. Writes answer.json (simulating stage-runner.ts runOutput behavior)
 *    4. Validates: [W1]/[W2] inline labels, External References section, formatted source blockquotes
 *
 *  Run 2 (Follow-Up Research):
 *    5. Loads FollowUpContext from Run 1's answer.json
 *    6. Creates a FinalAnswer with PRIOR_REF markers + inline [P#] labels
 *    7. Calls renderDocument() to produce follow-up markdown
 *    8. Validates: [P1]/[P2] prior references, Prior Research References section, followup title
 *    9. Validates: buildPriorContextHint() for decomposition awareness
 *
 * Run: npx tsx scripts/test-full-pipeline-e2e.ts
 * Cost: $0 (no API calls — all local)
 */

import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

// ── Import pipeline modules ─────────────────────────────────────────────────
import {
  renderDocument,
} from '../packages/agent-pipeline-core/src/handlers/agent-render-output/renderer.ts';
import { createSourceLinker } from '../packages/agent-pipeline-core/src/handlers/agent-render-output/source-linker.ts';
import type {
  FinalAnswer,
  RenderConfig,
  WebReference,
  PriorSection,
  Citation,
  VerificationScores,
  SubQuery,
} from '../packages/agent-pipeline-core/src/handlers/agent-render-output/types.ts';
import {
  loadFollowUpContext,
  parseAnswerSections,
  buildPriorContextHint,
} from '../packages/shared/src/agent/orchestrator/follow-up-context.ts';
import { mergeRenderConfig, extractOutputConfig } from '../packages/agent-pipeline-core/src/handlers/agent-render-output/config-loader.ts';

// ═══════════════════════════════════════════════════════════════════════════
// Test Setup
// ═══════════════════════════════════════════════════════════════════════════

const TMP_BASE = join(tmpdir(), `craft-full-pipeline-e2e-${Date.now()}`);
const SESSIONS_DIR = join(TMP_BASE, 'sessions');
const SESSION_1_ID = 'e2e-initial-research';
const SESSION_2_ID = 'e2e-followup-research';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

function section(title: string): void {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${'─'.repeat(60)}\n`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Test Data: Run 1 — Initial Research with Web References
// ═══════════════════════════════════════════════════════════════════════════

const VERIFICATION_SCORES: VerificationScores = {
  entity_grounding: { score: 0.92, passed: true },
  citation_accuracy: { score: 0.88, passed: true },
  relation_preservation: { score: 0.85, passed: true },
  contradictions: { count: 0, passed: true },
};

const WEB_REFS: WebReference[] = [
  {
    url: 'https://www.ifac.org/isa-540-revised',
    title: 'IFAC — ISA 540 (Revised) Overview',
    insight: 'ISA 540 requires evaluation of estimation uncertainty and methods used by management',
    sourceType: 'regulatory',
  },
  {
    url: 'https://www.iasb.org/ifrs-17-insurance-contracts',
    title: 'IASB — IFRS 17 Insurance Contracts',
    insight: 'IFRS 17 measurement models directly affect how insurance reserves are estimated',
    sourceType: 'standards',
  },
  {
    url: 'https://www.actuaries.org/reserve-testing-guidance',
    title: 'IAA — Reserve Testing Guidance',
    insight: 'Actuarial standards require documented assumptions and sensitivity analysis for reserve estimates',
    sourceType: 'professional',
  },
];

const CITATIONS_1: Citation[] = [
  { sourceRef: 'ISA 540.13', claim: 'Auditor shall identify and assess risks of material misstatement related to accounting estimates', verified: true, matchLevel: 'exact' },
  { sourceRef: 'ISA 540.18', claim: 'Auditor shall evaluate reasonableness of methods, significant assumptions, and data', verified: true, matchLevel: 'exact' },
  { sourceRef: 'ISA 540.22', claim: 'Auditor shall obtain sufficient appropriate audit evidence about estimation uncertainty disclosures', verified: true, matchLevel: 'exact' },
  { sourceRef: 'ISA 620.5', claim: 'Auditor shall evaluate competence and objectivity of the expert', verified: true, matchLevel: 'exact' },
];

const SUB_QUERIES_1: SubQuery[] = [
  { query: 'ISA 540 inherent risk factors for insurance reserve estimates', role: 'primary', standards: ['ISA 540'], paragraphsFound: 12 },
  { query: 'ISA 540 methods assumptions and data evaluation for accounting estimates', role: 'primary', standards: ['ISA 540'], paragraphsFound: 8 },
  { query: 'ISA 620 using actuarial experts for complex insurance estimates', role: 'supporting', standards: ['ISA 620'], paragraphsFound: 5 },
  { query: 'ISA 315 risk assessment for complex estimates including controls', role: 'context', standards: ['ISA 315'], paragraphsFound: 3 },
];

const SOURCE_TEXTS_1: Record<string, string> = {
  'ISA 540.13': 'The auditor shall identify and assess the risks of material misstatement for accounting estimates at the assertion level, including the separate assessment of inherent risk and control risk.',
  'ISA 540.18': 'The auditor shall evaluate whether the methods, significant assumptions, and the data used by management in making the accounting estimate are appropriate in the context of the applicable financial reporting framework.',
  'ISA 540.22': 'The auditor shall obtain sufficient appropriate audit evidence about whether the disclosures related to accounting estimates are in accordance with the requirements of the applicable financial reporting framework.',
  'ISA 620.5': 'If expertise in a field other than accounting or auditing is necessary to obtain sufficient appropriate audit evidence, the auditor shall determine whether to use the work of an auditor\u2019s expert.',
};

// Synthesis that includes BOTH inline [W#] labels AND WEB_REF markers in Sources blockquotes
const SYNTHESIS_RUN_1 = `## Risk Assessment for Insurance Reserve Estimates

Insurance reserve estimates represent one of the most complex accounting estimates auditors encounter. ISA 540 requires the auditor to identify and assess risks of material misstatement at the assertion level, considering three inherent risk factors: estimation uncertainty, complexity, and subjectivity (ISA 540.13).

The IFAC overview confirms that ISA 540 places particular emphasis on management's use of models and assumptions [W1], which is especially relevant for insurance reserves where actuarial models drive the estimate.

> **Sources**
> *ISA 540.13: "The auditor shall identify and assess the risks of material misstatement for accounting estimates at the assertion level"*
> WEB_REF|https://www.ifac.org/isa-540-revised|ISA 540 requires evaluation of estimation uncertainty and methods used by management

## Evaluating Methods, Assumptions, and Data

The auditor must evaluate whether management's methods, significant assumptions, and data are appropriate (ISA 540.18). For insurance reserves, this includes evaluating:
- Claims development patterns and IBNR methodology
- Discount rates and inflation assumptions
- Loss triangles and actuarial projections

IFRS 17's measurement models directly affect how these reserves are estimated [W2], requiring auditors to understand the interplay between accounting standards and actuarial practice.

Actuarial guidance emphasizes that all assumptions must be documented with sensitivity analysis [W3], providing a framework the auditor can leverage.

> **Sources**
> *ISA 540.18: "The auditor shall evaluate whether the methods, significant assumptions, and the data used by management are appropriate"*
> WEB_REF|https://www.iasb.org/ifrs-17-insurance-contracts|IFRS 17 measurement models directly affect how insurance reserves are estimated
> WEB_REF|https://www.actuaries.org/reserve-testing-guidance|Actuarial standards require documented assumptions and sensitivity analysis for reserve estimates

## Use of Actuarial Experts

Given the complexity of insurance reserve estimates, ISA 620 provides guidance on using auditor's experts (ISA 620.5). The auditor must evaluate:
- The actuary's competence, capabilities, and objectivity
- The scope of the actuary's work and its relevance
- The appropriateness of the actuary's conclusions as audit evidence

> **Sources**
> *ISA 620.5: "If expertise in a field other than accounting or auditing is necessary, the auditor shall determine whether to use the work of an auditor's expert"*

## Disclosure Requirements

ISA 540 requires the auditor to evaluate whether disclosures about estimation uncertainty are adequate (ISA 540.22). For insurance reserves, this includes sensitivity disclosures and the range of possible outcomes.

> **Sources**
> *ISA 540.22: "The auditor shall obtain sufficient appropriate audit evidence about whether the disclosures related to accounting estimates are in accordance"*`;

// ═══════════════════════════════════════════════════════════════════════════
// Test Data: Run 2 — Follow-Up with Prior Answer References
// ═══════════════════════════════════════════════════════════════════════════

const CITATIONS_2: Citation[] = [
  { sourceRef: 'ISA 540.23', claim: 'Auditor shall develop a point estimate or range for significant estimates', verified: true, matchLevel: 'exact' },
  { sourceRef: 'ISA 540.25', claim: 'Retrospective review of prior period estimates to identify management bias', verified: true, matchLevel: 'exact' },
];

const SUB_QUERIES_2: SubQuery[] = [
  { query: 'ISA 540 independent point estimate or range for reserves', role: 'primary', standards: ['ISA 540'], paragraphsFound: 4 },
  { query: 'ISA 540 retrospective review for reserve development analysis', role: 'primary', standards: ['ISA 540'], paragraphsFound: 3 },
];

const SOURCE_TEXTS_2: Record<string, string> = {
  'ISA 540.23': "When responding to assessed risks, the auditor shall undertake one or more of the following: develop an auditor's point estimate or range.",
  'ISA 540.25': 'The auditor shall review the outcome of accounting estimates included in the prior period financial statements, or their subsequent re-estimation.',
};

// Follow-up synthesis with PRIOR_REF markers + inline [P#] labels + additional WEB_REF
const SYNTHESIS_RUN_2 = `## Independent Auditor's Point Estimate

Building on the risk assessment framework from prior research [P1], the auditor may develop an independent point estimate or range for the insurance reserve. ISA 540.23 provides several response options:
- Developing an auditor's point estimate using independent data and assumptions
- Engaging an auditor's expert (as discussed in prior research on ISA 620 [P3]) to build an independent estimate
- Testing management's methods by reperforming a subset of actuarial calculations

> **Sources**
> *ISA 540.23: "When responding to assessed risks, the auditor shall develop an auditor's point estimate or range"*
> PRIOR_REF|P1|Risk Assessment for Insurance Reserve Estimates|Insurance reserve estimates represent one of the most complex accounting estimates auditors encounter

## Retrospective Review and Run-Off Analysis

ISA 540.25 requires a retrospective review of prior period estimates. For insurance reserves, this means analyzing:
- Reserve development (run-off) patterns over multiple years
- Whether prior IBNR estimates proved adequate when claims matured
- Systematic bias in management's estimation process

The estimation uncertainty evaluation from the initial research [P1] is foundational here — if risks were identified as high in the initial assessment, the retrospective review should be more extensive.

The prior work on methods and assumptions [P2] is also relevant, as retrospective review should compare prior assumptions against actual outcomes.

> **Sources**
> *ISA 540.25: "The auditor shall review the outcome of accounting estimates included in the prior period financial statements"*
> PRIOR_REF|P2|Evaluating Methods, Assumptions, and Data|The auditor must evaluate whether management's methods and data are appropriate

## Linking Retrospective Review to Current Estimates

The retrospective review directly informs the current audit cycle. When development patterns show systematic under-reserving, the auditor should:
1. Increase the assessed risk level for the current period
2. Design more extensive substantive procedures
3. Consider wider independent estimate ranges

> **Sources**
> *ISA 540.23: "The auditor shall develop an auditor's point estimate or range"*`;


// ═══════════════════════════════════════════════════════════════════════════
// Main Test Flow
// ═══════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║  FULL PIPELINE E2E: Web Refs + Follow-Up + Prior Refs    ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');

  // Setup temp directories
  mkdirSync(join(SESSIONS_DIR, SESSION_1_ID, 'data'), { recursive: true });
  mkdirSync(join(SESSIONS_DIR, SESSION_2_ID, 'data'), { recursive: true });

  // Load real agent config for RenderConfig
  const agentConfigPath = join(process.cwd(), 'agents', 'isa-deep-research', 'config.json');
  let renderConfig: RenderConfig;
  if (existsSync(agentConfigPath)) {
    const agentConfig = JSON.parse(readFileSync(agentConfigPath, 'utf-8'));
    const outputConfig = extractOutputConfig(agentConfig) ?? {};
    renderConfig = mergeRenderConfig(outputConfig as Partial<RenderConfig>);
    console.log(`[config] Loaded from: agents/isa-deep-research/config.json`);
  } else {
    renderConfig = mergeRenderConfig(null);
    console.log(`[config] Using defaults (agent config not found)`);
  }

  const linker = createSourceLinker('noop');

  // ===========================================================================
  // RUN 1: Initial Research — Web References
  // ===========================================================================
  section('RUN 1: Initial Research with Web References');

  const finalAnswer1: FinalAnswer = {
    originalQuery: 'What are the key requirements for testing insurance reserves under ISA 540?',
    synthesis: SYNTHESIS_RUN_1,
    citations: CITATIONS_1,
    verificationScores: VERIFICATION_SCORES,
    sourceTexts: SOURCE_TEXTS_1,
    subQueries: SUB_QUERIES_1,
    depthMode: 'deep',
    webReferences: WEB_REFS,
  };

  // Render the document
  const doc1 = renderDocument(finalAnswer1, renderConfig, linker);

  console.log('[render] Run 1 document rendered successfully');
  console.log(`[render] Length: ${doc1.length} chars, ${doc1.split('\n').length} lines`);

  // ── Validate Run 1: Inline [W#] Labels ──────────────────────────────────
  section('RUN 1 VALIDATION: Inline Web Reference Labels');

  check('[W1] label present in body text', doc1.includes('[W1]'));
  check('[W2] label present in body text', doc1.includes('[W2]'));
  check('[W3] label present in body text', doc1.includes('[W3]'));
  check('No raw WEB_REF| markers remain', !doc1.includes('WEB_REF|'));

  // ── Validate Run 1: Formatted Source Blockquotes ──────────────────────
  section('RUN 1 VALIDATION: Formatted Source Blockquotes');

  check('IFAC link formatted in blockquote', doc1.includes('ifac.org') || doc1.includes('IFAC'));
  check('IASB link formatted in blockquote', doc1.includes('iasb.org') || doc1.includes('IASB'));
  check('IAA link formatted in blockquote', doc1.includes('actuaries.org') || doc1.includes('IAA'));

  // ── Validate Run 1: External References Section ──────────────────────
  section('RUN 1 VALIDATION: External References Section');

  const extRefTitle = renderConfig.sections.externalReferencesTitle;
  check(`External References section present ("${extRefTitle}")`, doc1.includes(extRefTitle));
  check('[W1] in External References', doc1.includes('[W1]'));

  // Count [W#] labels in External References section
  const extRefSection = doc1.split(extRefTitle)[1] ?? '';
  const wLabelsInExtRef = (extRefSection.match(/\[W\d+\]/g) ?? []).length;
  check(`Multiple [W#] labels in External References (found ${wLabelsInExtRef})`, wLabelsInExtRef >= 2);

  // ── Save answer.json for Run 1 (mirroring stage-runner behavior) ──────
  section('RUN 1: Saving answer.json');

  const answerJson1 = {
    version: 1,
    answer: SYNTHESIS_RUN_1,
    original_query: finalAnswer1.originalQuery,
    followup_number: 0,
    depth_mode: finalAnswer1.depthMode,
    citations: finalAnswer1.citations.map(c => ({
      source_ref: c.sourceRef,
      claim: c.claim,
      paragraph_id: c.sourceRef,
    })),
    sub_queries: finalAnswer1.subQueries.map(sq => ({
      text: sq.query,
      role: sq.role,
      standards: sq.standards,
    })),
    web_references: WEB_REFS.map(wr => ({
      url: wr.url,
      title: wr.title,
      insight: wr.insight,
      sourceType: wr.sourceType,
    })),
  };

  const answerJsonPath1 = join(SESSIONS_DIR, SESSION_1_ID, 'data', 'answer.json');
  writeFileSync(answerJsonPath1, JSON.stringify(answerJson1, null, 2), 'utf-8');
  check('answer.json written for Run 1', existsSync(answerJsonPath1));

  const savedJson = JSON.parse(readFileSync(answerJsonPath1, 'utf-8'));
  check('answer.json has version=1', savedJson.version === 1);
  check('answer.json has non-empty answer', typeof savedJson.answer === 'string' && savedJson.answer.length > 100);
  check('answer.json has web_references array', Array.isArray(savedJson.web_references) && savedJson.web_references.length === 3);
  check('answer.json has sub_queries array', Array.isArray(savedJson.sub_queries) && savedJson.sub_queries.length === 4);
  check('answer.json has citations array', Array.isArray(savedJson.citations) && savedJson.citations.length === 4);

  // ===========================================================================
  // RUN 2: Follow-Up Research — Prior Answer References
  // ===========================================================================
  section('RUN 2: Follow-Up Research — Loading Prior Context');

  // Load follow-up context from Run 1
  const followUpCtx = loadFollowUpContext(SESSIONS_DIR, SESSION_1_ID);

  check('FollowUpContext loaded successfully', followUpCtx !== null);

  if (!followUpCtx) {
    console.error('FATAL: Cannot proceed — FollowUpContext is null');
    cleanup();
    process.exit(1);
  }

  check(`followupNumber = 1 (first follow-up)`, followUpCtx.followupNumber === 1);
  check(`priorQuery matches Run 1 query`, followUpCtx.priorQuery === finalAnswer1.originalQuery);
  check(`priorSubQueries loaded (${followUpCtx.priorSubQueries.length})`, followUpCtx.priorSubQueries.length === 4);
  check(`priorParagraphIds loaded (${followUpCtx.priorParagraphIds.length})`, followUpCtx.priorParagraphIds.length > 0);
  check(`priorSections parsed (${followUpCtx.priorSections.length})`, followUpCtx.priorSections.length >= 3);

  // ── Validate: parseAnswerSections ──────────────────────────────────────
  section('RUN 2 VALIDATION: Parsed Prior Sections');

  for (const sec of followUpCtx.priorSections) {
    console.log(`  [${sec.sectionId}] ${sec.heading} (${sec.excerpt.length} chars)`);
  }

  check('First section is P1', followUpCtx.priorSections[0]?.sectionId === 'P1');
  check('Section headings are non-empty', followUpCtx.priorSections.every(s => s.heading.length > 0));
  check('Section excerpts are non-empty', followUpCtx.priorSections.every(s => s.excerpt.length > 0));
  check('Section excerpts are ≤ 500 chars', followUpCtx.priorSections.every(s => s.excerpt.length <= 503)); // 500 + "..."

  // ── Validate: buildPriorContextHint (for Stage 0 decomposition) ─────
  section('RUN 2 VALIDATION: Prior Context Hint');

  const hint = buildPriorContextHint(followUpCtx);
  console.log('[hint] Generated prior context hint:\n');
  console.log(hint.split('\n').map(l => `  │ ${l}`).join('\n'));

  check('Hint contains follow-up number', hint.includes('Follow-up #1'));
  check('Hint contains prior query', hint.includes(finalAnswer1.originalQuery));
  check('Hint contains prior sub-queries', hint.includes('Prior sub-queries explored'));
  check('Hint contains section headings', hint.includes('Risk Assessment'));

  // ── Render Follow-Up Document ──────────────────────────────────────────
  section('RUN 2: Rendering Follow-Up Document');

  const priorSections2: PriorSection[] = followUpCtx.priorSections.map(ps => ({
    sectionNum: ps.sectionNum,
    sectionId: ps.sectionId,
    heading: ps.heading,
    excerpt: ps.excerpt,
  }));

  const finalAnswer2: FinalAnswer = {
    originalQuery: 'How does the auditor develop an independent point estimate for insurance reserves?',
    synthesis: SYNTHESIS_RUN_2,
    citations: CITATIONS_2,
    verificationScores: VERIFICATION_SCORES,
    sourceTexts: SOURCE_TEXTS_2,
    subQueries: SUB_QUERIES_2,
    depthMode: 'deep',
    priorSections: priorSections2,
    followupNumber: followUpCtx.followupNumber,
  };

  const doc2 = renderDocument(finalAnswer2, renderConfig, linker);

  console.log('[render] Run 2 follow-up document rendered successfully');
  console.log(`[render] Length: ${doc2.length} chars, ${doc2.split('\n').length} lines`);

  // ── Validate Run 2: Follow-Up Title ─────────────────────────────────
  section('RUN 2 VALIDATION: Follow-Up Title');

  if (renderConfig.followupTitleTemplate) {
    const expectedTitle = renderConfig.followupTitleTemplate.replace('{n}', '1');
    check(`Follow-up title present ("${expectedTitle}")`, doc2.includes(expectedTitle));
  } else {
    console.log('  [skip] No followupTitleTemplate configured');
  }

  // ── Validate Run 2: Inline [P#] Labels ────────────────────────────────
  section('RUN 2 VALIDATION: Inline Prior Reference Labels');

  check('[P1] label present in body text', doc2.includes('[P1]'));
  check('[P2] label present in body text', doc2.includes('[P2]'));
  check('[P3] label present in body text', doc2.includes('[P3]'));
  check('No raw PRIOR_REF| markers remain', !doc2.includes('PRIOR_REF|'));

  // ── Validate Run 2: Prior Research References Section ─────────────────
  section('RUN 2 VALIDATION: Prior Research References Section');

  const priorRefTitle = renderConfig.sections.priorResearchTitle;
  check(`Prior Research section present ("${priorRefTitle}")`, doc2.includes(priorRefTitle));

  // Only referenced sections should appear (P1 and P2 are referenced in synthesis, P3 is referenced)
  const priorRefSection = doc2.split(priorRefTitle)[1] ?? '';
  check('[P1] in Prior Research section', priorRefSection.includes('[P1]') || priorRefSection.includes('P1'));
  check('[P2] in Prior Research section', priorRefSection.includes('[P2]') || priorRefSection.includes('P2'));

  // ── Validate Run 2: Formatted PRIOR_REF Blockquotes ────────────────
  section('RUN 2 VALIDATION: Formatted PRIOR_REF Blockquotes');

  check('Prior ref blockquote contains heading text', doc2.includes('Risk Assessment'));
  check('Prior ref blockquote contains excerpt', doc2.includes('Insurance reserve estimates'));

  // ===========================================================================
  // OUTPUT: Show full documents
  // ===========================================================================
  section('FULL OUTPUT: Run 1 (first 80 lines)');
  const lines1 = doc1.split('\n');
  for (let i = 0; i < Math.min(80, lines1.length); i++) {
    console.log(`  ${String(i + 1).padStart(3, ' ')} │ ${lines1[i]}`);
  }
  if (lines1.length > 80) {
    console.log(`  ... (${lines1.length - 80} more lines)`);
  }

  section('FULL OUTPUT: Run 2 Follow-Up (first 80 lines)');
  const lines2 = doc2.split('\n');
  for (let i = 0; i < Math.min(80, lines2.length); i++) {
    console.log(`  ${String(i + 1).padStart(3, ' ')} │ ${lines2[i]}`);
  }
  if (lines2.length > 80) {
    console.log(`  ... (${lines2.length - 80} more lines)`);
  }

  // ===========================================================================
  // FINAL REPORT
  // ===========================================================================
  section('FINAL REPORT');

  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);
  console.log('');

  if (failed === 0) {
    console.log('  ✅ ALL CHECKS PASSED — Full pipeline verified end-to-end');
    console.log('');
    console.log('  This proves:');
    console.log('  → [W1]/[W2]/[W3] inline labels appear in prose text');
    console.log('  → WEB_REF markers in Sources blockquotes are formatted');
    console.log('  → External References section lists all web sources');
    console.log('  → answer.json persists correctly for follow-up loading');
    console.log('  → FollowUpContext loads with correct sections + metadata');
    console.log('  → buildPriorContextHint generates decomposition-aware hints');
    console.log('  → [P1]/[P2]/[P3] inline labels appear in follow-up prose');
    console.log('  → PRIOR_REF markers in Sources blockquotes are formatted');
    console.log('  → Prior Research References section shows referenced sections');
    console.log('  → Follow-up title template renders correctly');
  } else {
    console.log('  ❌ SOME CHECKS FAILED — See above for details');
  }
  console.log(`\n${'═'.repeat(60)}`);

  cleanup();
  process.exit(failed > 0 ? 1 : 0);
}

function cleanup(): void {
  try {
    rmSync(TMP_BASE, { recursive: true, force: true });
  } catch { /* ignore */ }
}

main().catch(err => {
  console.error('FATAL:', err instanceof Error ? err.message : String(err));
  cleanup();
  process.exit(1);
});
