/**
 * Agent Render Research Output — Main Handler
 *
 * Generic session-scoped tool that programmatically assembles structured
 * research output documents. Domain-specific behavior (ISA PDF linking,
 * citation format) is injected via the agent's config.json `output` section.
 *
 * This handler:
 * 1. Loads the agent's config.json `output` section
 * 2. Merges with runtime overrides and defaults
 * 3. Creates the appropriate SourceLinker
 * 4. Renders the document using the OutputRenderer
 * 5. Writes the output file to disk
 * 6. Returns the rendered document and metadata
 */

import { join } from 'node:path';
import type { SessionToolContext } from '../../context.ts';
import type { ToolResult } from '../../types.ts';
import { successResponse, errorResponse } from '../../response.ts';
import type { AgentRenderOutputArgs, FinalAnswer, RenderConfig, RenderResult } from './types.ts';
import { extractOutputConfig, mergeRenderConfig } from './config-loader.ts';
import { createSourceLinker } from './source-linker.ts';
import { renderDocument } from './renderer.ts';

// ============================================================
// Main Handler
// ============================================================

export async function handleAgentRenderOutput(
  ctx: SessionToolContext,
  args: AgentRenderOutputArgs,
): Promise<ToolResult> {
  const { agentSlug, finalAnswer, renderConfig: runtimeOverrides, outputDir } = args;

  // 1. Load agent config from workspace
  const configPath = join(ctx.agentsPath, agentSlug, 'config.json');
  let agentOutputConfig: Partial<RenderConfig> | null = null;

  if (ctx.fs.exists(configPath)) {
    try {
      const rawConfig = JSON.parse(ctx.fs.readFile(configPath));
      agentOutputConfig = extractOutputConfig(rawConfig);
    } catch (err) {
      return errorResponse(
        `Failed to parse config.json for agent '${agentSlug}': ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 2. Merge config: defaults ← agent config ← runtime overrides
  const config = mergeRenderConfig(agentOutputConfig, runtimeOverrides);

  // 3. Create source linker
  let fileList: string[] = [];
  if (config.sourceDiscovery.enabled) {
    // Try to discover source files in the staging/pdf directory
    const linkBase = config.sourceDiscovery.linkBase ?? '../staging/pdf/';
    const pdfDir = outputDir
      ? join(outputDir, linkBase)
      : join(ctx.workspacePath, 'staging', 'pdf');

    if (ctx.fs.exists(pdfDir) && ctx.fs.isDirectory(pdfDir)) {
      try {
        fileList = ctx.fs.readdir(pdfDir).filter((f) => f.toLowerCase().endsWith('.pdf'));
      } catch {
        // Non-fatal — proceed without file discovery
      }
    }
  }

  const linker = createSourceLinker(
    config.sourceDiscovery.linkerType,
    {
      linkBase: config.sourceDiscovery.linkBase,
      fileList,
    },
  );

  // 4. Validate finalAnswer minimally
  const validationErrors = validateFinalAnswer(finalAnswer);
  if (validationErrors.length > 0) {
    return errorResponse(
      `Invalid finalAnswer: ${validationErrors.join('; ')}`,
    );
  }

  // 5. Render the document
  let document: string;
  try {
    document = renderDocument(finalAnswer, config, linker);
  } catch (err) {
    return errorResponse(
      `Rendering failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 6. Determine output path and write file
  const outputFileName = getOutputFileName(config, finalAnswer.followupNumber);
  const outputPath = outputDir
    ? join(outputDir, outputFileName)
    : join(ctx.plansFolderPath, outputFileName);

  try {
    ctx.fs.writeFile(outputPath, document);
  } catch (err) {
    return errorResponse(
      `Failed to write output file: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 7. Count sections for metadata
  const sectionsCount = (document.match(/^## /gm) ?? []).length;

  // 8. Build result
  const result: RenderResult = {
    success: true,
    document,
    outputPath,
    filesWritten: [outputPath],
    sectionsCount,
    totalCitations: finalAnswer.citations.length,
  };

  return successResponse(JSON.stringify(result, null, 2));
}

// ============================================================
// Helpers
// ============================================================

function getOutputFileName(config: RenderConfig, followupNumber?: number): string {
  if (followupNumber && followupNumber > 0 && config.files.followupTemplate) {
    return config.files.followupTemplate.replace('{n}', String(followupNumber));
  }
  return config.files.answerFile;
}

function validateFinalAnswer(fa: FinalAnswer): string[] {
  const errors: string[] = [];

  if (!fa.originalQuery || typeof fa.originalQuery !== 'string') {
    errors.push('originalQuery is required and must be a string');
  }
  if (!fa.synthesis || typeof fa.synthesis !== 'string') {
    errors.push('synthesis is required and must be a string');
  }
  if (!Array.isArray(fa.citations)) {
    errors.push('citations must be an array');
  }
  if (!fa.verificationScores || typeof fa.verificationScores !== 'object') {
    errors.push('verificationScores is required');
  }
  if (!fa.sourceTexts || typeof fa.sourceTexts !== 'object') {
    errors.push('sourceTexts is required');
  }
  if (!Array.isArray(fa.subQueries)) {
    errors.push('subQueries must be an array');
  }

  return errors;
}

// Re-export types for consumers
export type { AgentRenderOutputArgs, RenderResult } from './types.ts';
