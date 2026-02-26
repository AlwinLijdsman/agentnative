/**
 * Integration tests for follow-up auto-detection and context wiring (Section 21).
 *
 * Verifies:
 * - loadFollowUpContext() round-trip from answer.json
 * - validateAnswerJson() schema enforcement
 * - buildPriorContextHint() includes dedup guidance
 * - buildStageContext() injects PRIOR_ANSWER_CONTEXT and SYNTHESIS_INSTRUCTIONS conditionally
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  loadFollowUpContext,
  parseAnswerSections,
  buildPriorContextHint,
  validateAnswerJson,
} from '../follow-up-context.ts';
import { buildStageContext } from '../context-builder.ts';

// ============================================================================
// TEST FIXTURES
// ============================================================================

const VALID_ANSWER_JSON = {
  version: 1,
  answer: [
    '## Risk Assessment Framework',
    'The risk assessment framework involves identifying...',
    '',
    '## Internal Control Evaluation',
    'Internal controls should be evaluated in the context of...',
    '',
    '## Verification Summary',
    'All citations verified.',
  ].join('\n'),
  original_query: 'How does ISA 315 define risk assessment?',
  followup_number: 0,
  citations: [
    { source_ref: 'ISA-315.4', claim: 'Risk assessment definition', paragraph_id: 'ISA-315.4' },
    { source_ref: 'ISA-315.12', claim: 'Component understanding', paragraph_id: 'ISA-315.12' },
  ],
  sub_queries: [
    { text: 'What is the risk assessment framework?', role: 'primary', standards: ['ISA 315'] },
    { text: 'How are internal controls evaluated?', role: 'supporting', standards: ['ISA 315', 'ISA 265'] },
  ],
  depth_mode: 'standard',
  web_references: [],
};

// ============================================================================
// HELPERS
// ============================================================================

let testDir: string;

function setupTestSession(sessionId: string, answerData?: unknown): string {
  const sessionsDir = join(testDir, 'sessions');
  const dataDir = join(sessionsDir, sessionId, 'data');
  mkdirSync(dataDir, { recursive: true });

  if (answerData !== undefined) {
    const answerPath = join(dataDir, 'answer.json');
    if (typeof answerData === 'string') {
      // Write raw string (for malformed JSON tests)
      writeFileSync(answerPath, answerData, 'utf-8');
    } else {
      writeFileSync(answerPath, JSON.stringify(answerData, null, 2), 'utf-8');
    }
  }

  return sessionsDir;
}

// ============================================================================
// TESTS: validateAnswerJson
// ============================================================================

describe('validateAnswerJson', () => {
  it('accepts valid answer.json', () => {
    const result = validateAnswerJson(VALID_ANSWER_JSON as unknown as Record<string, unknown>);
    assert.equal(result, null);
  });

  it('rejects unknown version', () => {
    const result = validateAnswerJson({ ...VALID_ANSWER_JSON, version: 99 } as unknown as Record<string, unknown>);
    assert.ok(result?.includes('unknown version'));
  });

  it('rejects missing answer field', () => {
    const data = { ...VALID_ANSWER_JSON } as Record<string, unknown>;
    delete data['answer'];
    const result = validateAnswerJson(data);
    assert.ok(result?.includes('missing or empty "answer"'));
  });

  it('rejects empty answer field', () => {
    const result = validateAnswerJson({ ...VALID_ANSWER_JSON, answer: '   ' } as unknown as Record<string, unknown>);
    assert.ok(result?.includes('missing or empty "answer"'));
  });

  it('rejects non-string original_query', () => {
    const result = validateAnswerJson({ ...VALID_ANSWER_JSON, original_query: 42 } as unknown as Record<string, unknown>);
    assert.ok(result?.includes('"original_query" is not a string'));
  });

  it('rejects non-number followup_number', () => {
    const result = validateAnswerJson({ ...VALID_ANSWER_JSON, followup_number: 'two' } as unknown as Record<string, unknown>);
    assert.ok(result?.includes('"followup_number" is not a number'));
  });

  it('rejects non-array citations', () => {
    const result = validateAnswerJson({ ...VALID_ANSWER_JSON, citations: 'not-array' } as unknown as Record<string, unknown>);
    assert.ok(result?.includes('"citations" is not an array'));
  });

  it('rejects non-array sub_queries', () => {
    const result = validateAnswerJson({ ...VALID_ANSWER_JSON, sub_queries: {} } as unknown as Record<string, unknown>);
    assert.ok(result?.includes('"sub_queries" is not an array'));
  });

  it('accepts minimal valid answer (only required fields)', () => {
    const result = validateAnswerJson({ answer: 'Some answer text' });
    assert.equal(result, null);
  });

  it('accepts version 1 explicitly', () => {
    const result = validateAnswerJson({ version: 1, answer: 'text' });
    assert.equal(result, null);
  });
});

// ============================================================================
// TESTS: loadFollowUpContext
// ============================================================================

describe('loadFollowUpContext', () => {
  beforeEach(() => {
    testDir = join(tmpdir(), `follow-up-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  });

  it('loads valid answer.json and returns FollowUpContext', () => {
    const sessionsDir = setupTestSession('session-001', VALID_ANSWER_JSON);
    const ctx = loadFollowUpContext(sessionsDir, 'session-001');

    assert.ok(ctx, 'Expected non-null context');
    assert.equal(ctx.followupNumber, 1); // 0 + 1
    assert.equal(ctx.priorQuery, 'How does ISA 315 define risk assessment?');
    assert.ok(ctx.priorAnswerText.includes('Risk Assessment Framework'));
    assert.equal(ctx.priorParagraphIds.length, 2);
    assert.ok(ctx.priorParagraphIds.includes('ISA-315.4'));
    assert.ok(ctx.priorParagraphIds.includes('ISA-315.12'));
    assert.equal(ctx.priorSubQueries.length, 2);
    assert.equal(ctx.priorSubQueries[0]?.text, 'What is the risk assessment framework?');
  });

  it('increments followupNumber correctly', () => {
    const data = { ...VALID_ANSWER_JSON, followup_number: 3 };
    const sessionsDir = setupTestSession('session-002', data);
    const ctx = loadFollowUpContext(sessionsDir, 'session-002');

    assert.ok(ctx);
    assert.equal(ctx.followupNumber, 4); // 3 + 1
  });

  it('parses answer sections and filters metadata headings', () => {
    const sessionsDir = setupTestSession('session-003', VALID_ANSWER_JSON);
    const ctx = loadFollowUpContext(sessionsDir, 'session-003');

    assert.ok(ctx);
    // "Risk Assessment Framework" and "Internal Control Evaluation" are content sections
    // "Verification Summary" is metadata — should be filtered out
    assert.equal(ctx.priorSections.length, 2);
    assert.equal(ctx.priorSections[0]?.sectionId, 'P1');
    assert.equal(ctx.priorSections[0]?.heading, 'Risk Assessment Framework');
    assert.equal(ctx.priorSections[1]?.sectionId, 'P2');
    assert.equal(ctx.priorSections[1]?.heading, 'Internal Control Evaluation');
  });

  it('returns null when answer.json does not exist', () => {
    const sessionsDir = setupTestSession('session-004');  // No answer data
    const ctx = loadFollowUpContext(sessionsDir, 'session-004');
    assert.equal(ctx, null);
  });

  it('returns null for malformed JSON', () => {
    const sessionsDir = setupTestSession('session-005', '{broken json');
    const ctx = loadFollowUpContext(sessionsDir, 'session-005');
    assert.equal(ctx, null);
  });

  it('returns null for empty answer field', () => {
    const sessionsDir = setupTestSession('session-006', { answer: '', original_query: 'test' });
    const ctx = loadFollowUpContext(sessionsDir, 'session-006');
    assert.equal(ctx, null);
  });

  it('returns null for empty object (no answer field)', () => {
    const sessionsDir = setupTestSession('session-007', {});
    const ctx = loadFollowUpContext(sessionsDir, 'session-007');
    assert.equal(ctx, null);
  });

  it('returns null when session directory does not exist', () => {
    const sessionsDir = join(testDir, 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    const ctx = loadFollowUpContext(sessionsDir, 'nonexistent-session');
    assert.equal(ctx, null);
  });
});

// ============================================================================
// TESTS: parseAnswerSections
// ============================================================================

describe('parseAnswerSections', () => {
  it('parses multiple sections from markdown', () => {
    const markdown = [
      '## Section One',
      'Content for section one.',
      '',
      '## Section Two',
      'Content for section two.',
      '',
      '## Section Three',
      'Content for section three.',
    ].join('\n');

    const sections = parseAnswerSections(markdown);
    assert.equal(sections.length, 3);
    assert.equal(sections[0]?.sectionId, 'P1');
    assert.equal(sections[0]?.heading, 'Section One');
    assert.equal(sections[1]?.sectionId, 'P2');
    assert.equal(sections[2]?.sectionId, 'P3');
  });

  it('filters out metadata headings', () => {
    const markdown = [
      '## Risk Assessment',
      'Content...',
      '',
      '## Verification Summary',
      'All ok.',
      '',
      '## Citations Used',
      '...',
      '',
      '## Internal Controls',
      'More content...',
    ].join('\n');

    const sections = parseAnswerSections(markdown);
    assert.equal(sections.length, 2);
    assert.equal(sections[0]?.heading, 'Risk Assessment');
    assert.equal(sections[1]?.heading, 'Internal Controls');
    // Sequential numbering after filtering
    assert.equal(sections[0]?.sectionId, 'P1');
    assert.equal(sections[1]?.sectionId, 'P2');
  });

  it('returns empty array for empty input', () => {
    assert.deepEqual(parseAnswerSections(''), []);
    assert.deepEqual(parseAnswerSections('   '), []);
  });

  it('truncates excerpts to max length', () => {
    const longContent = 'A'.repeat(600);
    const markdown = `## Long Section\n${longContent}`;
    const sections = parseAnswerSections(markdown);
    assert.equal(sections.length, 1);
    assert.ok(sections[0]!.excerpt.length <= 503); // 500 + "..."
  });
});

// ============================================================================
// TESTS: buildPriorContextHint (including dedup guidance)
// ============================================================================

describe('buildPriorContextHint', () => {
  it('includes follow-up number and prior query', () => {
    const hint = buildPriorContextHint({
      followupNumber: 2,
      priorQuery: 'What is ISA 540?',
      priorAnswerText: '',
      priorSubQueries: [],
      priorParagraphIds: [],
      priorSections: [],
    });

    assert.ok(hint.includes('Follow-up #2'));
    assert.ok(hint.includes('What is ISA 540?'));
  });

  it('includes prior sub-queries (max 5)', () => {
    const subQueries = Array.from({ length: 7 }, (_, i) => ({
      text: `Query ${i + 1}`,
      role: 'primary',
      standards: ['ISA 315'],
    }));

    const hint = buildPriorContextHint({
      followupNumber: 1,
      priorQuery: 'test',
      priorAnswerText: '',
      priorSubQueries: subQueries,
      priorParagraphIds: [],
      priorSections: [],
    });

    assert.ok(hint.includes('Query 1'));
    assert.ok(hint.includes('Query 5'));
    assert.ok(hint.includes('and 2 more'));
  });

  it('includes dedup guidance when prior sub-queries exist', () => {
    const hint = buildPriorContextHint({
      followupNumber: 1,
      priorQuery: 'test',
      priorAnswerText: '',
      priorSubQueries: [{ text: 'Some query', role: 'primary', standards: [] }],
      priorParagraphIds: [],
      priorSections: [],
    });

    assert.ok(hint.includes('Do NOT generate sub-queries that duplicate'));
    assert.ok(hint.includes('NEW aspects'));
  });

  it('omits dedup guidance when no prior sub-queries', () => {
    const hint = buildPriorContextHint({
      followupNumber: 1,
      priorQuery: 'test',
      priorAnswerText: '',
      priorSubQueries: [],
      priorParagraphIds: [],
      priorSections: [],
    });

    assert.ok(!hint.includes('Do NOT generate sub-queries'));
  });

  it('includes prior section headings', () => {
    const hint = buildPriorContextHint({
      followupNumber: 1,
      priorQuery: 'test',
      priorAnswerText: '',
      priorSubQueries: [],
      priorParagraphIds: [],
      priorSections: [
        { sectionNum: 1, sectionId: 'P1', heading: 'Risk Framework', excerpt: '...' },
        { sectionNum: 2, sectionId: 'P2', heading: 'Control Testing', excerpt: '...' },
      ],
    });

    assert.ok(hint.includes('[P1] Risk Framework'));
    assert.ok(hint.includes('[P2] Control Testing'));
    assert.ok(hint.includes('2 sections'));
  });
});

// ============================================================================
// TESTS: buildStageContext — conditional prior sections injection
// ============================================================================

describe('buildStageContext conditional injection', () => {
  const BASE_AGENT_CONFIG = {
    slug: 'test-agent',
    name: 'Test Agent',
    controlFlow: { stages: [], pauseAfterStages: [] },
    output: {},
  };

  it('injects PRIOR_ANSWER_CONTEXT when priorAnswerText provided', () => {
    const context = buildStageContext({
      stageName: 'synthesize',
      previousOutputs: {},
      agentConfig: BASE_AGENT_CONFIG,
      priorAnswerText: '## Section One\nSome prior content.',
      priorSections: [
        { sectionId: 'P1', heading: 'Section One', excerpt: 'Some prior content.' },
      ],
      followupNumber: 1,
    });

    assert.ok(context.includes('<PRIOR_ANSWER_CONTEXT>'));
    assert.ok(context.includes('follow-up question'));
    assert.ok(context.includes('[P1] Section One'));
    assert.ok(context.includes('Some prior content.'));
  });

  it('injects SYNTHESIS_INSTRUCTIONS with PRIOR_REF when priorSections provided', () => {
    const context = buildStageContext({
      stageName: 'synthesize',
      previousOutputs: {},
      agentConfig: BASE_AGENT_CONFIG,
      priorAnswerText: '## Test\nContent.',
      priorSections: [
        { sectionId: 'P1', heading: 'Test', excerpt: 'Content.' },
      ],
    });

    assert.ok(context.includes('<SYNTHESIS_INSTRUCTIONS>'));
    assert.ok(context.includes('PRIOR_REF'));
    assert.ok(context.includes('[P1]'));
  });

  it('omits PRIOR_ANSWER_CONTEXT when no prior context', () => {
    const context = buildStageContext({
      stageName: 'synthesize',
      previousOutputs: {},
      agentConfig: BASE_AGENT_CONFIG,
    });

    assert.ok(!context.includes('<PRIOR_ANSWER_CONTEXT>'));
    assert.ok(!context.includes('PRIOR_REF'));
  });

  it('omits PRIOR_REF from SYNTHESIS_INSTRUCTIONS when no priorSections', () => {
    const context = buildStageContext({
      stageName: 'synthesize',
      previousOutputs: {},
      agentConfig: BASE_AGENT_CONFIG,
      webSources: [{ url: 'https://example.com', title: 'Example', insight: 'Some insight' }],
    });

    // Should have WEB source instructions but NOT PRIOR_REF
    assert.ok(context.includes('<SYNTHESIS_INSTRUCTIONS>'));
    assert.ok(!context.includes('PRIOR_REF'));
  });

  it('injects PRIOR_RESEARCH_CONTEXT when priorContextHint provided', () => {
    const context = buildStageContext({
      stageName: 'analyze_query',
      previousOutputs: {},
      agentConfig: BASE_AGENT_CONFIG,
      priorContextHint: 'Follow-up #1\nPrior query: "What is ISA 540?"',
    });

    assert.ok(context.includes('<PRIOR_RESEARCH_CONTEXT>'));
    assert.ok(context.includes('follow-up question'));
    assert.ok(context.includes('What is ISA 540?'));
  });
});
