/**
 * E2E: ISA Guide Pipeline — Config Cross-Validation & Pipeline Integration
 *
 * Validates the guide reference and multi-tier search feature integration:
 * - AGENT.md frontmatter lists all guide tools
 * - loadWorkspaceAgents parses guide tools correctly
 * - AGENT.md body instructions include guide-first retrieval, attribution, gs_ IDs
 * - config.json structure supports guide-aware pipeline
 * - No regressions to original 10 tools
 *
 * No SDK calls, no cost. Uses real workspace data.
 *
 * Run: npx tsx --test apps/electron/src/__tests__/e2e-isa-guide-pipeline.test.ts
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { loadWorkspaceAgents } from '../../../../packages/shared/src/agents/storage.ts';
import type { AgentSourceBinding } from '../../../../packages/shared/src/agents/types.ts';

// ============================================================
// Workspace Root
// ============================================================

const WORKSPACE_ROOT = resolve(join(import.meta.dirname!, '..', '..', '..', '..'));

// ============================================================
// Constants
// ============================================================

const ORIGINAL_TOOLS = [
  'isa_hybrid_search',
  'isa_hop_retrieve',
  'isa_list_standards',
  'isa_get_paragraph',
  'isa_entity_verify',
  'isa_citation_verify',
  'isa_relation_verify',
  'isa_contradiction_check',
  'isa_format_context',
  'isa_web_search',
];

const GUIDE_TOOLS = [
  'isa_guide_search',
  'isa_guide_to_isa_hop',
  'isa_list_guides',
  'isa_multi_tier_search',
];

const DIAGNOSTIC_TOOLS = [
  'isa_kb_status',
  'isa_debug_hop_trace',
];

const ALL_TOOLS = [...ORIGINAL_TOOLS, ...GUIDE_TOOLS, ...DIAGNOSTIC_TOOLS];

// ============================================================
// Helpers
// ============================================================

function loadAgentMd(): string {
  const path = join(WORKSPACE_ROOT, 'agents', 'isa-deep-research', 'AGENT.md');
  return readFileSync(path, 'utf-8');
}

function loadAllAgentContent(): string {
  const agentDir = join(WORKSPACE_ROOT, 'agents', 'isa-deep-research');
  let content = readFileSync(join(agentDir, 'AGENT.md'), 'utf-8');
  const promptsDir = join(agentDir, 'prompts');
  if (existsSync(promptsDir)) {
    const promptFiles = readdirSync(promptsDir).filter(p => p.endsWith('.md')).sort();
    for (const f of promptFiles) {
      content += '\n' + readFileSync(join(promptsDir, f), 'utf-8');
    }
  }
  return content;
}

function parseFrontmatterTools(content: string): string[] {
  // Normalize line endings and strip BOM (U+FEFF)
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return [];

  const frontmatter = match[1]!;
  const tools: string[] = [];

  // Match lines like "      - isa_hybrid_search" in the tools list
  for (const line of frontmatter.split('\n')) {
    const toolMatch = line.match(/^\s+-\s+(isa_\w+)\s*$/);
    if (toolMatch) {
      tools.push(toolMatch[1]!);
    }
  }
  return tools;
}

function loadConfigJson(): Record<string, unknown> {
  const path = join(WORKSPACE_ROOT, 'agents', 'isa-deep-research', 'config.json');
  return JSON.parse(readFileSync(path, 'utf-8'));
}

// ============================================================
// Tests: Config Cross-Validation
// ============================================================

describe('E2E: ISA Guide Pipeline — Config Cross-Validation', () => {

  before(() => {
    assert.ok(existsSync(join(WORKSPACE_ROOT, 'agents', 'isa-deep-research', 'AGENT.md')),
      'AGENT.md must exist');
    assert.ok(existsSync(join(WORKSPACE_ROOT, 'agents', 'isa-deep-research', 'config.json')),
      'config.json must exist');
  });

  // ── C1: Frontmatter includes all guide tools ──

  it('AGENT.md frontmatter lists all 4 guide tools', () => {
    const tools = parseFrontmatterTools(loadAgentMd());

    for (const tool of GUIDE_TOOLS) {
      assert.ok(tools.includes(tool),
        `Guide tool '${tool}' missing from AGENT.md frontmatter. Found: ${tools.join(', ')}`);
    }
  });

  // ── C2: Frontmatter preserves all 10 original tools ──

  it('AGENT.md frontmatter preserves all 10 original tools', () => {
    const tools = parseFrontmatterTools(loadAgentMd());

    for (const tool of ORIGINAL_TOOLS) {
      assert.ok(tools.includes(tool),
        `Original tool '${tool}' missing from AGENT.md frontmatter`);
    }
  });

  // ── C3: Total tool count = 16 (10 original + 4 guide + 2 diagnostic) ──

  it('AGENT.md frontmatter has exactly 16 tools', () => {
    const tools = parseFrontmatterTools(loadAgentMd());
    assert.equal(tools.length, 16,
      `Expected 16 tools, got ${tools.length}: ${tools.join(', ')}`);
  });

  // ── C4: No duplicate tool entries ──

  it('AGENT.md frontmatter has no duplicate tools', () => {
    const tools = parseFrontmatterTools(loadAgentMd());
    const unique = new Set(tools);
    assert.equal(tools.length, unique.size,
      `Found ${tools.length - unique.size} duplicate tool entries`);
  });

  // ── C5: All tools use isa_ prefix ──

  it('all tools use isa_ prefix convention', () => {
    const tools = parseFrontmatterTools(loadAgentMd());
    for (const tool of tools) {
      assert.ok(tool.startsWith('isa_'),
        `Tool '${tool}' does not start with isa_ prefix`);
    }
  });

  // ── C6: loadWorkspaceAgents parses frontmatter tools correctly ──

  it('loadWorkspaceAgents parses all tools from AGENT.md frontmatter', () => {
    const agents = loadWorkspaceAgents(WORKSPACE_ROOT);
    const isa = agents.find(a => a.slug === 'isa-deep-research');
    assert.ok(isa, 'isa-deep-research agent should be loaded');
    assert.ok(isa.metadata.sources, 'agent should have sources');

    const kbBinding = isa.metadata.sources.find((s: AgentSourceBinding) => s.slug === 'isa-knowledge-base');
    assert.ok(kbBinding, 'should have isa-knowledge-base binding');
    assert.ok(Array.isArray(kbBinding.tools), 'tools should be an array');

    // Check all 16 tools are parsed
    for (const tool of ALL_TOOLS) {
      assert.ok(kbBinding.tools.includes(tool),
        `loadWorkspaceAgents missing tool '${tool}': ${kbBinding.tools.join(', ')}`);
    }
    assert.equal(kbBinding.tools.length, 16,
      `Expected 16 tools from loadWorkspaceAgents, got ${kbBinding.tools.length}`);
  });

  // ── C7: Frontmatter and loadWorkspaceAgents agree ──

  it('AGENT.md frontmatter tools match loadWorkspaceAgents output exactly', () => {
    const frontmatterTools = parseFrontmatterTools(loadAgentMd());

    const agents = loadWorkspaceAgents(WORKSPACE_ROOT);
    const isa = agents.find(a => a.slug === 'isa-deep-research');
    const kbBinding = isa!.metadata.sources!.find((s: AgentSourceBinding) => s.slug === 'isa-knowledge-base');

    const parsedTools = kbBinding!.tools as string[];

    // Same length
    assert.equal(frontmatterTools.length, parsedTools.length,
      'Tool count mismatch between frontmatter and loadWorkspaceAgents');

    // Same contents (order-independent)
    const sortedFm = [...frontmatterTools].sort();
    const sortedParsed = [...parsedTools].sort();
    assert.deepEqual(sortedFm, sortedParsed,
      'Tool sets should match between frontmatter and loadWorkspaceAgents');
  });
});

// ============================================================
// Tests: AGENT.md Body Instructions
// ============================================================

describe('E2E: ISA Guide Pipeline — AGENT.md Body Instructions', () => {

  // ── B1: Prerequisites section lists guide tools ──

  it('prerequisites section lists guide tools as required', () => {
    const body = loadAgentMd();

    for (const tool of GUIDE_TOOLS) {
      assert.ok(body.includes(tool),
        `AGENT.md prerequisites should list ${tool}`);
    }
  });

  // ── B2: Stage 2 guide-first retrieval path ──

  it('Stage 2 includes guide-first retrieval path instructions', () => {
    const body = loadAllAgentContent();

    assert.ok(body.includes('Guide-first'),
      'Stage 2 should describe Guide-first retrieval path');
    assert.ok(body.includes('isa_guide_search'),
      'Stage 2 should reference isa_guide_search tool');
    assert.ok(body.includes('isa_guide_to_isa_hop'),
      'Stage 2 should reference isa_guide_to_isa_hop tool');
  });

  // ── B3: isa_multi_tier_search is available as a tool ──

  it('isa_multi_tier_search is registered in agent definition', () => {
    const body = loadAllAgentContent();

    assert.ok(body.includes('isa_multi_tier_search'),
      'Agent definition should reference isa_multi_tier_search');
  });

  // ── B4: Stage 2 REQUIRED tools list includes guide tools ──

  it('Stage 2 REQUIRED tools list includes guide tools', () => {
    const body = loadAgentMd();

    // Stage 2 has a REQUIRED block that should mention guide tools
    assert.ok(body.includes('isa_guide_search') && body.includes('isa_guide_to_isa_hop'),
      'Stage 2 REQUIRED tools should include guide tools');
  });

  // ── B5: Stage 3 guide context attribution ──

  it('Stage 3 synthesis includes guide context attribution behavior', () => {
    const body = loadAllAgentContent();

    assert.ok(body.includes('guide context') || body.includes('guide-sourced'),
      'Stage 3 should mention guide context in attribution');
  });

  // ── B6: Stage 4 handles GuideSection and ISAParagraph types ──

  it('Stage 4 verification handles GuideSection and ISAParagraph types', () => {
    const body = loadAllAgentContent();

    // Entity verification references both content types
    assert.ok(body.includes('GuideSection'),
      'Stage 4 entity verification should mention GuideSection content');
    assert.ok(body.includes('ISAParagraph'),
      'Stage 4 entity verification should mention ISAParagraph content');
  });

  // ── B7: Stage 4 entity verification mentions citation accuracy ──

  it('Stage 4 entity verification mentions citation accuracy checks', () => {
    const body = loadAllAgentContent();

    assert.ok(body.includes('Citation Accuracy') || body.includes('citation_accuracy'),
      'Stage 4 should describe citation accuracy verification');
    assert.ok(body.includes('Entity Grounding') || body.includes('entity_grounding'),
      'Stage 4 should describe entity grounding verification');
  });

  // ── B8: Stage 2 references guide and format tools in retrieval strategy ──

  it('Stage 2 retrieval strategy references guide search and format context', () => {
    const body = loadAllAgentContent();

    assert.ok(body.includes('isa_guide_search'),
      'Stage 2 should reference isa_guide_search in retrieval strategy');
    assert.ok(body.includes('isa_format_context'),
      'Agent prompts should reference isa_format_context tool');
  });
});

// ============================================================
// Tests: Config.json Pipeline Structure
// ============================================================

describe('E2E: ISA Guide Pipeline — Config.json Pipeline Structure', () => {

  // ── P1: 6 stages (0-5) ──

  it('config.json defines 6 pipeline stages', () => {
    const config = loadConfigJson() as { controlFlow?: { stages?: unknown[] } };
    assert.ok(config.controlFlow?.stages, 'config should have controlFlow.stages');
    assert.equal(config.controlFlow!.stages!.length, 6, 'should have 6 stages');
  });

  // ── P2: Repair unit covers stages 3-4 ──

  it('config.json repair unit covers synthesis + verify (stages 3-4)', () => {
    const config = loadConfigJson() as {
      controlFlow?: { repairUnits?: Array<{ stages: number[] }> };
    };
    const repairUnits = config.controlFlow?.repairUnits;
    assert.ok(repairUnits && repairUnits.length > 0, 'should have repair units');

    const unit = repairUnits![0]!;
    assert.deepEqual(unit.stages, [3, 4],
      'repair unit should cover stages 3 and 4');
  });

  // ── P3: Depth modes have correct token budgets ──

  it('config.json depth modes have contextTokenBudget for guide-aware context', () => {
    const config = loadConfigJson() as {
      depthModes?: Record<string, { contextTokenBudget?: number }>;
    };
    assert.ok(config.depthModes, 'config should have depthModes');

    // Token budgets should be sufficient for mixed guide + ISA content
    assert.ok(config.depthModes!.quick!.contextTokenBudget! >= 4000,
      'quick mode budget should be >= 4000');
    assert.ok(config.depthModes!.standard!.contextTokenBudget! >= 8000,
      'standard mode budget should be >= 8000');
    assert.ok(config.depthModes!.deep!.contextTokenBudget! >= 16000,
      'deep mode budget should be >= 16000');
  });

  // ── P4: Verification thresholds for all 4 axes ──

  it('config.json verification thresholds cover all 4 axes', () => {
    const config = loadConfigJson() as {
      verification?: Record<string, unknown>;
    };
    assert.ok(config.verification, 'config should have verification');

    for (const axis of ['entityGrounding', 'citationAccuracy', 'relationPreservation', 'contradictions']) {
      assert.ok(axis in config.verification!,
        `missing verification threshold for ${axis}`);
    }
  });

  // ── P5: Stage output schemas cover all stages ──

  it('config.json stage output schemas cover stages 0-5', () => {
    const config = loadConfigJson() as {
      controlFlow?: { stageOutputSchemas?: Record<string, unknown> };
    };
    assert.ok(config.controlFlow?.stageOutputSchemas, 'should have stageOutputSchemas');

    for (const stage of ['0', '1', '2', '3', '4', '5']) {
      assert.ok(stage in config.controlFlow!.stageOutputSchemas!,
        `missing output schema for stage ${stage}`);
    }
  });

  // ── P6: Stage 5 output schema requires output_file_path ──

  it('config.json Stage 5 schema requires output_file_path field', () => {
    const config = loadConfigJson() as {
      controlFlow?: { stageOutputSchemas?: Record<string, { required?: string[] }> };
    };
    const stage5 = config.controlFlow?.stageOutputSchemas?.['5'];
    assert.ok(stage5, 'should have Stage 5 schema');
    assert.ok(stage5.required?.includes('output_file_path'),
      'Stage 5 schema should require output_file_path');
  });

  // ── P7: Pauses after stages 0 and 1 ──

  it('config.json pauses after stages 0 and 1', () => {
    const config = loadConfigJson() as {
      controlFlow?: { pauseAfterStages?: number[] };
    };
    assert.deepEqual(config.controlFlow?.pauseAfterStages, [0, 1],
      'should pause after stages 0 and 1');
  });
});
