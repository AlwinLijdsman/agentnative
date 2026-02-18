/**
 * Agent Validate Handler
 *
 * Validates an agent's AGENT.md and config.json for correct format,
 * required fields, and structural consistency. Also checks that
 * required sources exist in the workspace.
 */

import { join } from 'node:path';
import matter from 'gray-matter';
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import type { ValidationResult, ValidationIssue } from '../types.ts';
import {
  validateSlug,
  formatValidationResult,
  validResult,
  invalidResult,
  mergeResults,
} from '../validation.ts';
import { sourceExists } from '../source-helpers.ts';

// ============================================================
// Types
// ============================================================

export interface AgentValidateArgs {
  agentSlug: string;
}

// ============================================================
// Main Handler
// ============================================================

export async function handleAgentValidate(
  ctx: SessionToolContext,
  args: AgentValidateArgs,
): Promise<ToolResult> {
  const { agentSlug } = args;

  // 1. Validate slug format
  const slugResult = validateSlug(agentSlug);
  if (!slugResult.valid) {
    return {
      content: [{ type: 'text', text: formatValidationResult(slugResult) }],
      structuredContent: {},
      isError: true,
    };
  }

  // 2. Check AGENT.md exists and parses
  const agentDir = join(ctx.agentsPath, agentSlug);
  const agentMdPath = join(agentDir, 'AGENT.md');
  const configPath = join(agentDir, 'config.json');

  const results: ValidationResult[] = [];

  if (!ctx.fs.exists(agentDir)) {
    return {
      content: [{ type: 'text', text: formatValidationResult(
        invalidResult('agent', `Agent directory not found: agents/${agentSlug}/`),
      ) }],
      structuredContent: {},
      isError: true,
    };
  }

  // Validate AGENT.md and extract source bindings
  const agentMdResult = validateAgentMd(ctx, agentMdPath);
  results.push(agentMdResult.result);

  // Validate config.json
  results.push(validateAgentConfig(ctx, configPath));

  // Validate source bindings from AGENT.md frontmatter
  if (agentMdResult.sources && agentMdResult.sources.length > 0) {
    results.push(validateSourceBindings(ctx, agentMdResult.sources));
  }

  const merged = mergeResults(...results);
  return {
    content: [{ type: 'text', text: formatValidationResult(merged) }],
    structuredContent: {},
    isError: !merged.valid,
  };
}

// ============================================================
// AGENT.md Validation
// ============================================================

interface AgentMdValidateResult {
  result: ValidationResult;
  sources?: Array<{ slug: string; required: boolean }>;
}

function validateAgentMd(ctx: SessionToolContext, agentMdPath: string): AgentMdValidateResult {
  if (!ctx.fs.exists(agentMdPath)) {
    return {
      result: invalidResult('AGENT.md', 'AGENT.md not found. Create it with YAML frontmatter (name, description).'),
    };
  }

  let content: string;
  try {
    content = ctx.fs.readFile(agentMdPath);
  } catch {
    return { result: invalidResult('AGENT.md', 'Failed to read AGENT.md.') };
  }

  // Parse frontmatter
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(content);
  } catch {
    return { result: invalidResult('AGENT.md', 'Invalid YAML frontmatter in AGENT.md.') };
  }

  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // Required fields
  if (!parsed.data.name || typeof parsed.data.name !== 'string') {
    errors.push({ path: 'AGENT.md/name', message: 'Missing or invalid "name" field in frontmatter.' });
  }
  if (!parsed.data.description || typeof parsed.data.description !== 'string') {
    errors.push({ path: 'AGENT.md/description', message: 'Missing or invalid "description" field in frontmatter.' });
  }

  // Optional fields
  if (parsed.data.type !== undefined && typeof parsed.data.type !== 'string') {
    warnings.push({ path: 'AGENT.md/type', message: '"type" field should be a string.' });
  }

  // Body content
  if (!parsed.content.trim()) {
    warnings.push({ path: 'AGENT.md', message: 'AGENT.md body is empty. Add system prompt instructions.' });
  }

  // Extract source bindings
  let sources: Array<{ slug: string; required: boolean }> | undefined;
  if (Array.isArray(parsed.data.sources)) {
    sources = parsed.data.sources
      .filter((s: unknown) => s && typeof s === 'object' && 'slug' in (s as Record<string, unknown>))
      .map((s: unknown) => ({
        slug: String((s as Record<string, unknown>).slug),
        required: Boolean((s as Record<string, unknown>).required),
      }));
  }

  return {
    result: { valid: errors.length === 0, errors, warnings },
    sources,
  };
}

// ============================================================
// config.json Validation
// ============================================================

function validateAgentConfig(ctx: SessionToolContext, configPath: string): ValidationResult {
  if (!ctx.fs.exists(configPath)) {
    return invalidResult('config.json', 'config.json not found.');
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(ctx.fs.readFile(configPath));
  } catch {
    return invalidResult('config.json', 'Failed to parse config.json as JSON.');
  }

  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // controlFlow is required
  if (!raw.controlFlow || typeof raw.controlFlow !== 'object') {
    errors.push({ path: 'config.json/controlFlow', message: 'Missing "controlFlow" section.' });
    return { valid: false, errors, warnings };
  }

  const cf = raw.controlFlow as Record<string, unknown>;

  // Validate stages
  if (!Array.isArray(cf.stages) || cf.stages.length === 0) {
    errors.push({ path: 'config.json/controlFlow/stages', message: 'stages must be a non-empty array.' });
  } else {
    const stageIds = new Set<number>();
    for (let i = 0; i < cf.stages.length; i++) {
      const stage = cf.stages[i] as Record<string, unknown>;
      if (typeof stage.id !== 'number') {
        errors.push({ path: `config.json/controlFlow/stages[${i}]`, message: `Stage missing numeric "id".` });
      } else {
        if (stage.id !== i) {
          errors.push({
            path: `config.json/controlFlow/stages[${i}]`,
            message: `Stage ID ${stage.id} does not match array index ${i}. IDs must be sequential starting at 0 (stage gate requires stage N-1 completed before starting N).`,
          });
        }
        stageIds.add(stage.id);
      }
      if (!stage.name || typeof stage.name !== 'string') {
        errors.push({ path: `config.json/controlFlow/stages[${i}]`, message: `Stage missing "name" string.` });
      }
      if (
        stage.pauseInstructions !== undefined &&
        (typeof stage.pauseInstructions !== 'string' || stage.pauseInstructions.trim().length === 0)
      ) {
        errors.push({
          path: `config.json/controlFlow/stages[${i}].pauseInstructions`,
          message: 'pauseInstructions must be a non-empty string when provided.',
        });
      }
    }

    // Validate repairUnits reference valid stage pairs
    if (Array.isArray(cf.repairUnits)) {
      for (let i = 0; i < cf.repairUnits.length; i++) {
        const ru = cf.repairUnits[i] as Record<string, unknown>;
        if (!Array.isArray(ru.stages) || ru.stages.length !== 2) {
          errors.push({
            path: `config.json/controlFlow/repairUnits[${i}]`,
            message: 'repairUnit.stages must be a [number, number] pair.',
          });
        } else {
          const [s0, s1] = ru.stages as [number, number];
          if (!stageIds.has(s0)) {
            errors.push({
              path: `config.json/controlFlow/repairUnits[${i}].stages[0]`,
              message: `Stage ${s0} not found in stages array.`,
            });
          }
          if (!stageIds.has(s1)) {
            errors.push({
              path: `config.json/controlFlow/repairUnits[${i}].stages[1]`,
              message: `Stage ${s1} not found in stages array.`,
            });
          }
        }
        if (typeof ru.maxIterations !== 'number' || ru.maxIterations < 1) {
          errors.push({
            path: `config.json/controlFlow/repairUnits[${i}].maxIterations`,
            message: 'maxIterations must be a positive number.',
          });
        }
      }
    }

    // Validate pauseAfterStages reference valid stage IDs
    if (Array.isArray(cf.pauseAfterStages)) {
      for (const sid of cf.pauseAfterStages) {
        if (typeof sid !== 'number' || !stageIds.has(sid)) {
          errors.push({
            path: 'config.json/controlFlow/pauseAfterStages',
            message: `Stage ID ${sid} not found in stages array.`,
          });
        }
      }
    }
  }

  // Validate verification thresholds (if present)
  if (raw.verification && typeof raw.verification === 'object') {
    const v = raw.verification as Record<string, unknown>;
    for (const axis of ['entityGrounding', 'relationPreservation', 'citationAccuracy']) {
      if (v[axis] && typeof v[axis] === 'object') {
        const t = (v[axis] as Record<string, unknown>).threshold;
        if (typeof t === 'number' && (t < 0 || t > 1)) {
          errors.push({
            path: `config.json/verification/${axis}/threshold`,
            message: `Threshold must be between 0 and 1, got ${t}.`,
          });
        }
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ============================================================
// Source Binding Validation
// ============================================================

function validateSourceBindings(
  ctx: SessionToolContext,
  sources: Array<{ slug: string; required: boolean }>,
): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  for (const source of sources) {
    const exists = sourceExists(ctx.workspacePath, source.slug);
    if (!exists && source.required) {
      errors.push({
        path: `sources/${source.slug}`,
        message: `Required source '${source.slug}' not found in workspace.`,
        suggestion: `Create the source at ${ctx.workspacePath}/sources/${source.slug}/config.json`,
      });
    } else if (!exists) {
      warnings.push({
        path: `sources/${source.slug}`,
        message: `Optional source '${source.slug}' not found in workspace.`,
      });
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
