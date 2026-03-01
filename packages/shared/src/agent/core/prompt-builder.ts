/**
 * PromptBuilder - System Prompt and Context Building
 *
 * Provides utilities for building system prompts and context blocks that both
 * ClaudeAgent and CodexAgent can use. Handles workspace capabilities, recovery
 * context, and user preferences formatting.
 *
 * Key responsibilities:
 * - Build workspace capabilities context
 * - Format recovery context for session resume failures
 * - Build session state context blocks
 * - Format user preferences for prompt injection
 */

import { isLocalMcpEnabled } from '../../workspaces/storage.ts';
import { formatPreferencesForPrompt } from '../../config/preferences.ts';
import { formatSessionState } from '../mode-manager.ts';
import { getDateTimeContext, getWorkingDirectoryContext } from '../../prompts/system.ts';
import { getSessionPlansPath, getSessionDataPath, getSessionPath } from '../../sessions/storage.ts';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PipelineSummary, PipelineExitReason } from '../orchestrator/types.ts';
import { PipelineState } from '../orchestrator/pipeline-state.ts';
import { estimateTokens } from '../orchestrator/context-budget.ts';
import type {
  PromptBuilderConfig,
  ContextBlockOptions,
  RecoveryMessage,
} from './types.ts';

/**
 * Maximum token budget for injected pipeline context.
 * When the full context (all stage outputs) exceeds this limit, the builder
 * falls back to compact mode (summary-only) and signals the caller so a
 * one-time notification can be shown to the user.
 */
const CONTEXT_INJECTION_BUDGET = 30_000;

/** Return value from buildOrchestratorSummaryBlock — includes compaction flag. */
export interface OrchestratorContextResult {
  /** The formatted XML context block. */
  block: string;
  /** True if the full stage data exceeded the budget and was compacted. */
  wasCompacted: boolean;
}

/** Return value from buildContextParts — includes compaction flag. */
export interface ContextPartsResult {
  /** Array of context strings to prepend to the user message. */
  parts: string[];
  /** True if the orchestrator context was compacted due to budget. */
  contextWasCompacted: boolean;
}

/**
 * PromptBuilder provides utilities for building prompts and context blocks.
 *
 * Usage:
 * ```typescript
 * const promptBuilder = new PromptBuilder({
 *   workspace,
 *   session,
 *   debugMode: { enabled: true },
 * });
 *
 * // Build context blocks for a user message
 * const contextParts = promptBuilder.buildContextParts({
 *   permissionMode: 'explore',
 *   plansFolderPath: '/path/to/plans',
 * });
 * ```
 */
export class PromptBuilder {
  private config: PromptBuilderConfig;
  private workspaceRootPath: string;
  private pinnedPreferencesPrompt: string | null = null;

  constructor(config: PromptBuilderConfig) {
    this.config = config;
    this.workspaceRootPath = config.workspace?.rootPath ?? '';
  }

  // ============================================================
  // Context Building
  // ============================================================

  /**
   * Build all context parts for a user message.
   * Returns context strings and a flag indicating whether orchestrator context
   * was compacted (so the caller can notify the user once).
   *
   * @param options - Context building options
   * @param sourceStateBlock - Pre-formatted source state (from SourceManager)
   * @returns Context parts and compaction flag
   */
  buildContextParts(
    options: ContextBlockOptions,
    sourceStateBlock?: string
  ): ContextPartsResult {
    const parts: string[] = [];
    let contextWasCompacted = false;

    // Add date/time context first (enables prompt caching)
    parts.push(getDateTimeContext());

    // Add session state (permission mode, plans folder path, data folder path)
    const sessionId = this.config.session?.id ?? `temp-${Date.now()}`;
    const plansFolderPath = options.plansFolderPath ??
      getSessionPlansPath(this.workspaceRootPath, sessionId);
    const dataFolderPath = options.dataFolderPath ??
      getSessionDataPath(this.workspaceRootPath, sessionId);
    parts.push(formatSessionState(sessionId, { plansFolderPath, dataFolderPath }));

    // Add source state if provided
    if (sourceStateBlock) {
      parts.push(sourceStateBlock);
    }

    // Add orchestrator pipeline context if available
    // Tries full stage data first; falls back to compact summary if over budget
    if (options.sessionPath) {
      const result = this.buildOrchestratorSummaryBlock(options.sessionPath);
      if (result) {
        parts.push(result.block);
        contextWasCompacted = result.wasCompacted;
      }
    }

    // Add workspace capabilities
    parts.push(this.formatWorkspaceCapabilities());

    // Add working directory context
    const workingDirContext = this.getWorkingDirectoryContext();
    if (workingDirContext) {
      parts.push(workingDirContext);
    }

    return { parts, contextWasCompacted };
  }

  /**
   * Format workspace capabilities for prompt injection.
   * Informs the agent about what features are available in this workspace.
   */
  formatWorkspaceCapabilities(): string {
    const capabilities: string[] = [];

    // Check local MCP server capability
    const localMcpEnabled = isLocalMcpEnabled(this.workspaceRootPath);
    if (localMcpEnabled) {
      capabilities.push('local-mcp: enabled (stdio subprocess servers supported)');
    } else {
      capabilities.push('local-mcp: disabled (only HTTP/SSE servers)');
    }

    return `<workspace_capabilities>\n${capabilities.join('\n')}\n</workspace_capabilities>`;
  }

  /**
   * Get working directory context for prompt injection.
   */
  getWorkingDirectoryContext(): string | null {
    const sessionId = this.config.session?.id;
    const effectiveWorkingDir = this.config.session?.workingDirectory ??
      (sessionId ? getSessionPath(this.workspaceRootPath, sessionId) : undefined);
    const isSessionRoot = !this.config.session?.workingDirectory && !!sessionId;

    return getWorkingDirectoryContext(
      effectiveWorkingDir,
      isSessionRoot,
      this.config.session?.sdkCwd
    );
  }

  // ============================================================
  // Orchestrator Summary Context — Adaptive Full/Compact
  // ============================================================

  /**
   * Build an orchestrator context block with adaptive compaction.
   *
   * Strategy (two-tier):
   * 1. Try loading pipeline-state.json for full stage data (stages 0, 1, 3).
   *    If the full block fits within CONTEXT_INJECTION_BUDGET → return full mode.
   * 2. If full mode exceeds budget, OR pipeline-state.json is unavailable,
   *    fall back to compact mode using pipeline-summary.json (enriched with Stage 0 details).
   *
   * Stage priority (full mode):
   * - Stage 0 (query analysis): ALWAYS included — high value, 5–7K tokens
   * - Stage 1 (web calibration): included IF fits — medium value, 1.5–8K tokens
   * - Stage 3 (synthesis): included IF fits — high value, 25–29K tokens
   * - Stage 2 (KB retrieval): NEVER included — 48K tokens, raw data, low value
   * - Stage 4 (verification): shown as compact one-liner only
   * - Stage 5 (render): shown as output path only (full text already on disk)
   *
   * Called on every turn. Returns null if no pipeline data exists (normal session).
   *
   * @param sessionPath - Absolute path to the session directory
   * @returns Context block with compaction flag, or null if no pipeline data
   */
  buildOrchestratorSummaryBlock(sessionPath: string): OrchestratorContextResult | null {
    // ── Tier 1: Try full context from pipeline-state.json ──
    const state = PipelineState.loadFrom(sessionPath);
    if (state) {
      const completedStages = state.events
        .filter((e) => e.type === 'stage_completed')
        .map((e) => e.stage)
        .sort((a, b) => a - b);

      // Infer exit reason from events
      const hasBreakout = state.events.some((e) => e.type === 'breakout');
      const hasPause = state.events.some((e) => e.type === 'pause_requested');
      const hasError = state.events.some((e) => e.type === 'stage_failed');
      const exitReason: PipelineExitReason = hasBreakout ? 'breakout'
        : hasError ? 'error'
        : hasPause ? 'paused'
        : 'completed';

      const fullBlock = this.formatFullContext(state, completedStages, exitReason);
      const tokens = estimateTokens(fullBlock);

      if (tokens <= CONTEXT_INJECTION_BUDGET) {
        return { block: fullBlock, wasCompacted: false };
      }

      // Full didn't fit — try progressively dropping stages
      // Drop Stage 3 (largest at 25-29K), keep 0 and 1
      const reducedBlock = this.formatFullContext(state, completedStages, exitReason, /* skipStage3 */ true);
      const reducedTokens = estimateTokens(reducedBlock);

      if (reducedTokens <= CONTEXT_INJECTION_BUDGET) {
        return { block: reducedBlock, wasCompacted: true };
      }
    }

    // ── Tier 2: Compact mode from pipeline-summary.json ──
    const summaryPath = join(sessionPath, 'data', 'pipeline-summary.json');
    if (!existsSync(summaryPath)) {
      return null;
    }

    try {
      const raw = readFileSync(summaryPath, 'utf-8');
      const summary = JSON.parse(raw) as PipelineSummary;
      const compactBlock = this.formatCompactContext(summary);
      return { block: compactBlock, wasCompacted: true };
    } catch {
      return null;
    }
  }

  /**
   * Format full pipeline context from PipelineState stage outputs.
   *
   * Includes raw stage data in structured XML with `mode="full"` attribute.
   * Stage priority: 0 always, 1 if available, 3 if available (unless skipStage3).
   * Stage 2 always skipped (raw retrieval, 48K). Stage 4 as one-liner. Stage 5 as path.
   */
  private formatFullContext(
    state: PipelineState,
    completedStages: number[],
    exitReason: PipelineExitReason,
    skipStage3 = false,
  ): string {
    const parts: string[] = [];
    parts.push(`<orchestrator_prior_research mode="full">`);
    parts.push(`  <status>${exitReason === 'completed' ? 'complete' : 'partial'} (${exitReason})</status>`);
    parts.push(`  <stages_completed>${completedStages.join(', ')}</stages_completed>`);

    // Stage 0 — Query Analysis (ALWAYS included)
    const stage0 = state.getStageOutput(0);
    if (stage0) {
      parts.push(`  <stage_0_query_analysis>`);
      parts.push(`    <query>${this.escapeXml(state.originalQuery)}</query>`);
      const queryPlan = stage0.data?.['query_plan'] as Record<string, unknown> | undefined;
      if (queryPlan) {
        // Sub-queries with full detail
        const subQueries = queryPlan['sub_queries'] as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(subQueries) && subQueries.length > 0) {
          parts.push(`    <sub_queries>`);
          for (const sq of subQueries) {
            const query = (typeof sq['query'] === 'string' ? sq['query'] : typeof sq['text'] === 'string' ? sq['text'] : '') as string;
            const priority = sq['priority'] ?? '';
            const standard = sq['standard'] ?? '';
            if (query) {
              const attrs: string[] = [];
              if (priority) attrs.push(`priority="${this.escapeXml(String(priority))}"`);
              if (standard) attrs.push(`standard="${this.escapeXml(String(standard))}"`);
              parts.push(`      <sub_query${attrs.length > 0 ? ' ' + attrs.join(' ') : ''}>${this.escapeXml(query)}</sub_query>`);
            }
          }
          parts.push(`    </sub_queries>`);
        }
        // Assumptions
        const assumptions = queryPlan['assumptions'] as string[] | undefined;
        if (Array.isArray(assumptions) && assumptions.length > 0) {
          parts.push(`    <assumptions>`);
          for (const a of assumptions) {
            parts.push(`      <assumption>${this.escapeXml(a)}</assumption>`);
          }
          parts.push(`    </assumptions>`);
        }
        // Primary standards
        const standards = queryPlan['primary_standards'] as string[] | undefined;
        if (Array.isArray(standards) && standards.length > 0) {
          parts.push(`    <primary_standards>${standards.map(s => this.escapeXml(s)).join(', ')}</primary_standards>`);
        }
        // Clarity score
        const clarity = queryPlan['clarity_score'];
        if (typeof clarity === 'number') {
          parts.push(`    <clarity_score>${clarity}</clarity_score>`);
        }
        // Scope
        const scope = queryPlan['scope'] as string | undefined;
        if (typeof scope === 'string' && scope.length > 0) {
          parts.push(`    <scope>${this.escapeXml(scope)}</scope>`);
        }
      }
      parts.push(`  </stage_0_query_analysis>`);
    }

    // Stage 1 — Web Calibration (if available)
    const stage1 = state.getStageOutput(1);
    if (stage1) {
      parts.push(`  <stage_1_web_calibration>`);
      // Web sources from data
      const webSources = stage1.data?.['web_sources'] as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(webSources) && webSources.length > 0) {
        parts.push(`    <web_sources>`);
        for (const src of webSources) {
          const title = src['title'] ?? '';
          const url = src['url'] ?? '';
          const relevance = src['relevance'] ?? '';
          parts.push(`      <source title="${this.escapeXml(String(title))}" url="${this.escapeXml(String(url))}" relevance="${this.escapeXml(String(relevance))}" />`);
        }
        parts.push(`    </web_sources>`);
      } else if (stage1.text) {
        // Fallback: include raw text (typically short)
        parts.push(`    <text>${this.escapeXml(stage1.text)}</text>`);
      }
      parts.push(`  </stage_1_web_calibration>`);
    }

    // Stage 2 — KB Retrieval: ALWAYS SKIPPED (48K tokens, raw retrieval, low value)

    // Stage 3 — Synthesis (if available and not explicitly skipped)
    const stage3 = state.getStageOutput(3);
    if (stage3 && !skipStage3) {
      parts.push(`  <stage_3_synthesis>`);
      if (stage3.text) {
        parts.push(`    <text>${this.escapeXml(stage3.text)}</text>`);
      }
      const citations = stage3.data?.['citations_used'] ?? stage3.data?.['citations'];
      if (Array.isArray(citations) && citations.length > 0) {
        parts.push(`    <citations count="${citations.length}" />`);
      }
      const confidence = stage3.data?.['confidence'] as string | undefined;
      if (confidence) {
        parts.push(`    <confidence>${this.escapeXml(confidence)}</confidence>`);
      }
      parts.push(`  </stage_3_synthesis>`);
    }

    // Stage 4 — Verification (compact one-liner if available)
    const stage4 = state.getStageOutput(4);
    if (stage4?.data?.['verification_scores']) {
      const scores = stage4.data['verification_scores'] as Record<string, Record<string, unknown>>;
      const scoreEntries: string[] = [];
      for (const [key, value] of Object.entries(scores)) {
        if (value && ('score' in value || 'count' in value)) {
          const scoreVal = value['score'] ?? value['count'] ?? '?';
          const passed = value['passed'] ? 'pass' : 'fail';
          scoreEntries.push(`${key}: ${scoreVal} (${passed})`);
        }
      }
      if (scoreEntries.length > 0) {
        parts.push(`  <verification>${scoreEntries.join(', ')}</verification>`);
      }
      if (stage4.data['needsRepair']) {
        parts.push(`  <repair>yes — citations were repaired after verification</repair>`);
      }
    }

    // Stage 5 — Render (output path only — full text already on disk)
    const stage5 = state.getStageOutput(5);
    const outputPath = stage5?.data?.['outputPath'] as string | undefined;
    if (outputPath) {
      parts.push(`  <output_file>${this.escapeXml(outputPath)}</output_file>`);
    }

    parts.push(`</orchestrator_prior_research>`);
    return parts.join('\n');
  }

  /**
   * Format compact context from PipelineSummary (enriched with Stage 0 details).
   *
   * Used when full context exceeds the budget or pipeline-state.json is unavailable.
   * Includes a compacted_notice so the LLM (and user) knows data was reduced.
   */
  private formatCompactContext(summary: PipelineSummary): string {
    const parts: string[] = [];
    parts.push(`<orchestrator_prior_research mode="compact">`);
    parts.push(`  <compacted_notice>Full pipeline data exceeded context budget and was compacted. Key details preserved below.</compacted_notice>`);
    parts.push(`  <query>${this.escapeXml(summary.originalQuery)}</query>`);
    parts.push(`  <status>${summary.wasPartial ? 'partial' : 'complete'} (${summary.exitReason})</status>`);
    parts.push(`  <stages_completed>${summary.completedStages.join(', ')} of ${summary.totalStages} total</stages_completed>`);

    // Stage 0 enrichment fields (from Phase 5A generateSummary)
    if (summary.queryDecomposition && summary.queryDecomposition.length > 0) {
      parts.push(`  <sub_queries>`);
      for (const sq of summary.queryDecomposition) {
        parts.push(`    <sub_query>${this.escapeXml(sq)}</sub_query>`);
      }
      parts.push(`  </sub_queries>`);
    }

    if (summary.assumptions && summary.assumptions.length > 0) {
      parts.push(`  <assumptions>${summary.assumptions.map(a => this.escapeXml(a)).join('; ')}</assumptions>`);
    }

    if (summary.primaryStandards && summary.primaryStandards.length > 0) {
      parts.push(`  <primary_standards>${summary.primaryStandards.map(s => this.escapeXml(s)).join(', ')}</primary_standards>`);
    }

    if (summary.clarityScore !== undefined) {
      parts.push(`  <clarity_score>${summary.clarityScore}</clarity_score>`);
    }

    if (summary.synthesis) {
      parts.push(`  <synthesis>${this.escapeXml(summary.synthesis)}</synthesis>`);
    }

    if (summary.citationCount > 0) {
      parts.push(`  <citations>${summary.citationCount} citations</citations>`);
    }

    if (summary.confidence) {
      parts.push(`  <confidence>${summary.confidence}</confidence>`);
    }

    if (summary.verificationScores) {
      const scores = summary.verificationScores;
      const scoreEntries: string[] = [];
      for (const [key, value] of Object.entries(scores)) {
        const scoreObj = value as Record<string, unknown> | undefined;
        if (scoreObj && ('score' in scoreObj || 'count' in scoreObj)) {
          const scoreVal = scoreObj['score'] ?? scoreObj['count'] ?? '?';
          const passed = scoreObj['passed'] ? 'pass' : 'fail';
          scoreEntries.push(`${key}: ${scoreVal} (${passed})`);
        }
      }
      if (scoreEntries.length > 0) {
        parts.push(`  <verification>${scoreEntries.join(', ')}</verification>`);
      }
    }

    if (summary.neededRepair) {
      parts.push(`  <repair>yes — citations were repaired after verification</repair>`);
    }

    if (summary.outputPath) {
      parts.push(`  <output_file>${this.escapeXml(summary.outputPath)}</output_file>`);
    }

    parts.push(`</orchestrator_prior_research>`);
    return parts.join('\n');
  }

  /**
   * Escape special XML characters in element text content.
   *
   * Note: Only escapes `&`, `<`, `>`. Does NOT escape `"` or `'` — safe for
   * element content but NOT for use in XML attribute values.
   */
  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // ============================================================
  // Recovery Context
  // ============================================================

  /**
   * Build recovery context from previous messages when SDK resume fails.
   * Called when we detect an empty response during resume.
   *
   * @param messages - Previous messages to include in recovery context
   * @returns Formatted recovery context string, or null if no messages
   */
  buildRecoveryContext(messages?: RecoveryMessage[]): string | null {
    if (!messages || messages.length === 0) {
      return null;
    }

    // Format messages as a conversation block
    const formattedMessages = messages.map((m) => {
      const role = m.type === 'user' ? 'User' : 'Assistant';
      // Truncate very long messages to avoid bloating context
      const content = m.content.length > 1000
        ? m.content.slice(0, 1000) + '...[truncated]'
        : m.content;
      return `[${role}]: ${content}`;
    }).join('\n\n');

    return `<conversation_recovery>
This session was interrupted and is being restored. Here is the recent conversation context:

${formattedMessages}

Please continue the conversation naturally from where we left off.
</conversation_recovery>

`;
  }

  // ============================================================
  // User Preferences
  // ============================================================

  /**
   * Format user preferences for prompt injection.
   * Preferences are pinned on first call to ensure consistency within a session.
   *
   * @param forceRefresh - Force refresh of cached preferences
   * @returns Formatted preferences string
   */
  formatPreferences(forceRefresh = false): string {
    // Return pinned preferences if available (ensures session consistency)
    if (this.pinnedPreferencesPrompt && !forceRefresh) {
      return this.pinnedPreferencesPrompt;
    }

    // Load and format preferences (function loads internally)
    this.pinnedPreferencesPrompt = formatPreferencesForPrompt();
    return this.pinnedPreferencesPrompt;
  }

  /**
   * Clear pinned preferences (called on session clear).
   */
  clearPinnedPreferences(): void {
    this.pinnedPreferencesPrompt = null;
  }

  // ============================================================
  // Configuration Accessors
  // ============================================================

  /**
   * Update the workspace configuration.
   */
  setWorkspace(workspace: PromptBuilderConfig['workspace']): void {
    this.config.workspace = workspace;
    this.workspaceRootPath = workspace?.rootPath ?? '';
  }

  /**
   * Update the session configuration.
   */
  setSession(session: PromptBuilderConfig['session']): void {
    this.config.session = session;
  }

  /**
   * Get the workspace root path.
   */
  getWorkspaceRootPath(): string {
    return this.workspaceRootPath;
  }

  /**
   * Check if debug mode is enabled.
   */
  isDebugMode(): boolean {
    return this.config.debugMode?.enabled ?? false;
  }

  /**
   * Get the system prompt preset.
   */
  getSystemPromptPreset(): string {
    return this.config.systemPromptPreset ?? 'default';
  }
}
