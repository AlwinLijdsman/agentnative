/**
 * Agent Orchestrator — Deterministic Stage Pipeline
 *
 * Replaces SDK-driven tool calling with a TypeScript for-loop that controls
 * stage execution, MCP tool calls, and output rendering. Each stage = 1 focused
 * LLM call with shaped context (per-stage context windows).
 *
 * Mirrors gamma's ISAResearchWorkflow.run() + _run_repair_stages().
 *
 * Design principles:
 * - TypeScript writes state — LLM never touches it
 * - Deterministic: for-loop over stages from config.json
 * - Each stage = 1 focused LLM call with shaped context
 * - Repair loop: verify → re-synthesize on citation failure (G15)
 * - Pause/resume: generator yields pause events, resumes via state reload
 * - Cost tracking: per-stage token accounting, budget enforcement
 *
 * Usage:
 * ```typescript
 * const orchestrator = AgentOrchestrator.create(options);
 * for await (const event of orchestrator.run(userMessage, agentConfig)) {
 *   switch (event.type) {
 *     case 'orchestrator_stage_start': // UI shows progress
 *     case 'orchestrator_pause':       // UI shows pause message, waits for user
 *     case 'orchestrator_complete':    // Pipeline done
 *   }
 * }
 * ```
 */

import { dirname } from 'path';
import { clearBreakoutScope, validateStageOutput } from '@craft-agent/agent-pipeline-core';
import { loadFollowUpContext } from './follow-up-context.ts';
import { OrchestratorLlmClient } from './llm-client.ts';
import { PipelineState } from './pipeline-state.ts';
import { formatPauseMessage } from './pause-formatter.ts';
import { StageRunner } from './stage-runner.ts';
import type {
  AgentConfig,
  CostTrackerPort,
  FollowUpContext,
  McpBridge,
  OrchestratorConfig,
  OrchestratorEvent,
  OrchestratorOptions,
  ResumeAction,
  StageConfig,
  StreamEvent,
  SubstepEvent,
} from './types.ts';
import { createNullCostTracker } from './types.ts';
import { ZERO_USAGE } from './types.ts';

// ============================================================================
// RE-EXPORTS — Convenience imports for consumers
// ============================================================================

export { PipelineState } from './pipeline-state.ts';
export { StageRunner } from './stage-runner.ts';
export { OrchestratorLlmClient } from './llm-client.ts';
export { ContextBudgetManager, ContextOverflowError, estimateTokens } from './context-budget.ts';
export { extractJson, extractRawJson, JsonExtractionError } from './json-extractor.ts';
export { buildStageContext, wrapXml, truncateByTokenBudget } from './context-builder.ts';
export { OrchestratorMcpBridge, parseMcpResult, extractMcpText } from './mcp-bridge.ts';
export { McpLifecycleManager, extractTransportConfig } from './mcp-lifecycle.ts';
export { CostTracker } from './cost-tracker.ts';
export type { CostTrackerConfig, CostReport } from './cost-tracker.ts';
export { formatPauseMessage } from './pause-formatter.ts';
export type { FormatPauseOptions, FormatPauseResult } from './pause-formatter.ts';
export type { McpSourceTransportConfig } from './mcp-lifecycle.ts';

// Follow-up context (Section 18)
export { loadFollowUpContext, parseAnswerSections, buildPriorContextHint } from './follow-up-context.ts';
export type { FollowUpContext, FollowUpPriorSection } from './types.ts';

// BAML integration — Phase 10
export { callBamlStage0, callBamlStage1, callBamlStage3, isBamlAvailable } from './baml-adapter.ts';
export type {
  ISAQueryPlanOutput,
  ISASynthesisOutput,
  WebsearchCalibrationOutput,
  ISACitationBAML,
  ISASubQuery,
} from './baml-types.ts';

export type {
  AgentConfig,
  CostTrackerPort,
  McpBridge,
  NormalizedCalibration,
  NormalizedQueryPlan,
  NormalizedSubQuery,
  OrchestratorConfig,
  OrchestratorEvent,
  OrchestratorOptions,
  PipelineExitReason,
  ResumeAction,
  StageMode,
} from './types.ts';

// ============================================================================
// RESUME INTENT PARSING (Section 20 — F2, F3, F6)
// ============================================================================

/** Result of parsing the user's resume response for skip intent. */
export interface ResumeIntent {
  /** Whether the next stage should be skipped (e.g., "No web search"). */
  skipNextStage: boolean;
}

/**
 * Parse the user's resume response to detect stage-skip intent.
 *
 * Only active at the Stage 0→websearch_calibration boundary.
 * Conservative matching with default-to-run fallback (F6).
 *
 * The `nextStageName` parameter gates skip detection to ISA agents
 * (whose Stage 1 is `websearch_calibration`). Non-ISA agents like
 * dev-loop have different Stage 1 names (e.g., `plan`) and are
 * never affected by skip patterns.
 *
 * Recognized skip patterns:
 * - "B" or "b." (option B from Stage 0 prompt)
 * - "no web search" / "no websearch"
 * - "proceed directly"
 * - "skip web"
 * - "no, proceed" / "no. proceed"
 *
 * @param userResponse - The user's text response to the pause prompt
 * @param pausedAtStage - The stage number the pipeline was paused at
 * @param nextStageName - Name of the next stage (skip only applies when 'websearch_calibration')
 * @returns ResumeIntent with skipNextStage flag
 */
export function parseResumeIntent(
  userResponse: string,
  pausedAtStage: number,
  nextStageName?: string,
): ResumeIntent {
  // Only apply skip detection at Stage 0→websearch_calibration boundary.
  // Non-ISA agents (e.g., dev-loop) have different Stage 1 names and are never affected.
  if (pausedAtStage !== 0 || nextStageName !== 'websearch_calibration') {
    return { skipNextStage: false };
  }

  const text = userResponse.trim();

  // Conservative patterns — default-to-run (F6)
  const skipPatterns = [
    /^b\.?\s*$/i,                          // "B", "b.", "b"
    /^b\b[.,]?\s/i,                        // "B. No — proceed" etc.
    /\bno\b.*\bweb\s*search/i,             // "no web search" / "no websearch"
    /\bproceed\s+directly/i,               // "proceed directly"
    /\bskip\b.*\bweb/i,                    // "skip web", "skip the web search"
    /^no[,.]?\s*proceed/i,                 // "no, proceed" / "no. proceed"
  ];

  const skipNextStage = skipPatterns.some(p => p.test(text));
  return { skipNextStage };
}

/**
 * Parse the user's resume response to detect amend/cancel/proceed intent.
 *
 * Only active when the paused stage has `pauseChoices` configured — ISA agents
 * have no pauseChoices and are never affected (F5 guard).
 *
 * Matching priority:
 * 1. Numeric choice index ("1" → proceed, "2" → amend, "3" → cancel)
 * 2. Keyword matching (case-insensitive)
 * 3. Default: 'proceed' (conservative — don't block on ambiguous input)
 *
 * @param userResponse - The user's text response to the pause prompt
 * @param pauseChoices - Choice labels from stage config (undefined for ISA agents)
 * @returns ResumeAction ('proceed' | 'amend' | 'cancel')
 */
export function parseGenericResumeAction(
  userResponse: string,
  pauseChoices?: string[],
): ResumeAction {
  // F5 guard: no pauseChoices → always proceed (ISA agents never affected)
  if (!pauseChoices || pauseChoices.length === 0) {
    return 'proceed';
  }

  const text = userResponse.trim();

  // Match numeric choice index
  if (/^1\.?\s*$/.test(text)) return 'proceed';
  if (/^2\.?\s*$/.test(text)) return 'amend';
  if (/^3\.?\s*$/.test(text)) return 'cancel';

  const lower = text.toLowerCase();

  // Match cancel keywords first (more specific)
  if (/\b(cancel|abort|stop|quit|abandon)\b/.test(lower)) return 'cancel';

  // Match amend keywords
  if (/\b(amend|adjust|change|modify|revise|update)\b/.test(lower)) return 'amend';

  // Match proceed keywords
  if (/\b(proceed|approve|go|looks\s+good|confirm|yes|ok|lgtm|accept)\b/.test(lower)) return 'proceed';

  // Default: proceed (conservative — don't block on ambiguous input)
  return 'proceed';
}

// ============================================================================
// AGENT ORCHESTRATOR
// ============================================================================

export class AgentOrchestrator {
  private readonly sessionId: string;
  private readonly sessionPath: string;
  private readonly stageRunner: StageRunner;
  private readonly costTracker: CostTrackerPort;
  private readonly onStreamEvent?: (event: StreamEvent) => void;
  private readonly onDebug?: (message: string) => void;
  private readonly previousSessionId?: string;

  /**
   * Shared substep event queue — StageRunner pushes events via onProgress callback,
   * the pipeline generator drains them after each runStage() call completes.
   * Used by both executePipeline() and executeRepairLoop().
   */
  private readonly substepQueue: SubstepEvent[] = [];

  /** Real-time substep callback — fires immediately, bypassing generator queue. */
  private readonly onSubstepEvent?: (event: SubstepEvent, stageId: number) => void;

  /** Current stage ID — set at top of stage loop, used by onProgress callback. */
  private currentStageId = 0;

  private constructor(
    options: OrchestratorOptions,
    stageRunner: StageRunner,
    costTracker: CostTrackerPort,
  ) {
    this.sessionId = options.sessionId;
    this.sessionPath = options.sessionPath;
    this.onStreamEvent = options.onStreamEvent;
    this.onDebug = options.onDebug;
    this.previousSessionId = options.previousSessionId;
    this.onSubstepEvent = options.onSubstepEvent;
    this.stageRunner = stageRunner;
    this.costTracker = costTracker;

    // Wire onProgress callback — pushes substep events to shared queue
    // AND fires real-time callback for immediate UI delivery
    this.stageRunner.setOnProgress((event: SubstepEvent) => {
      this.substepQueue.push(event);
      // Real-time delivery — bypasses generator queue so UI shows substeps during execution
      this.onSubstepEvent?.(event, this.currentStageId);
    });
  }

  /**
   * Factory method — creates an orchestrator with all dependencies wired.
   *
   * Creates OrchestratorLlmClient internally (fresh auth token per API call).
   * Accepts optional McpBridge (Phase 4) and CostTracker (Phase 5) via dependency injection.
   * Falls back to no-op implementations when not provided.
   *
   * @param options - Session-level options (auth, paths, callbacks)
   * @param mcpBridge - MCP tool call bridge (null until Phase 4 implements it)
   * @param costTracker - Cost tracking implementation (null uses no-op tracker)
   * @param orchestratorConfig - Orchestrator-specific config (model, effort, context window)
   */
  static create(
    options: OrchestratorOptions,
    mcpBridge?: McpBridge | null,
    costTracker?: CostTrackerPort | null,
    orchestratorConfig?: OrchestratorConfig,
  ): AgentOrchestrator {
    const llmClient = new OrchestratorLlmClient(
      options.getAuthToken,
      undefined, // baseURL — uses ANTHROPIC_BASE_URL env var or default
      orchestratorConfig?.contextWindow,
      orchestratorConfig?.minOutputBudget,
    );

    const stageRunner = new StageRunner(
      llmClient,
      mcpBridge ?? null,
      options.sessionPath,
      options.onStreamEvent,
      options.getAuthToken,
    );

    return new AgentOrchestrator(
      options,
      stageRunner,
      costTracker ?? createNullCostTracker(),
    );
  }

  /**
   * Run the orchestrator pipeline from the beginning.
   *
   * Yields OrchestratorEvent items for UI consumption.
   * The caller iterates with `for await (const event of orchestrator.run(...))`.
   *
   * Generator pauses on `orchestrator_pause` events — the caller should
   * stop iterating and call `resume()` when the user responds.
   *
   * @param userMessage - The user's original query
   * @param agentConfig - Agent configuration (stages, control flow, etc.)
   * @yields OrchestratorEvent items (stage start/complete, pause, repair, etc.)
   */
  async *run(
    userMessage: string,
    agentConfig: AgentConfig,
  ): AsyncGenerator<OrchestratorEvent> {
    // Load follow-up context if previousSessionId is set (Section 18, F12)
    let followUpContext: FollowUpContext | null = null;
    if (this.previousSessionId) {
      const sessionsDir = dirname(this.sessionPath);
      followUpContext = loadFollowUpContext(sessionsDir, this.previousSessionId);
      this.onDebug?.(
        `[orchestrator] Follow-up context: ${
          followUpContext
            ? `loaded (followup #${followUpContext.followupNumber})`
            : 'not found'
        }`,
      );
    }

    const state = PipelineState.create(this.sessionId, agentConfig.slug, this.previousSessionId, userMessage);
    yield* this.executePipeline(state, userMessage, agentConfig, 0, followUpContext);
  }

  /**
   * Resume the orchestrator pipeline after a pause.
   *
   * Loads state from disk, records the resume event, and continues
   * from the stage after the paused one.
   *
   * @param userResponse - The user's response to the pause prompt
   * @param agentConfig - Agent configuration (must match the original run)
   * @yields OrchestratorEvent items for the remaining stages
   */
  async *resume(
    userResponse: string,
    agentConfig: AgentConfig,
  ): AsyncGenerator<OrchestratorEvent> {
    // Load state from disk
    const state = PipelineState.loadFrom(this.sessionPath);
    if (!state) {
      yield {
        type: 'orchestrator_error',
        stage: -1,
        error: `No saved pipeline state found at ${this.sessionPath}. Cannot resume.`,
      };
      return;
    }

    if (!state.isPaused) {
      yield {
        type: 'orchestrator_error',
        stage: -1,
        error: 'Pipeline is not in a paused state. Cannot resume.',
      };
      return;
    }

    // Record resume event with the user's response
    const pausedStage = state.pausedAtStage;
    let resumedState = state.addEvent({
      type: 'resumed',
      stage: pausedStage,
      data: { userResponse },
    });

    // ── Generic resume action parsing (Phase 4 — amend/cancel) ────────
    // Only active when the paused stage has pauseChoices configured (F5 guard).
    const stages = agentConfig.controlFlow.stages;
    const pausedStageConfig = stages[pausedStage];
    const action = parseGenericResumeAction(userResponse, pausedStageConfig?.pauseChoices);

    this.onDebug?.(
      `[orchestrator] Resume from stage ${pausedStage}: action=${action}`,
    );

    // ── Cancel path ───────────────────────────────────────────────────
    if (action === 'cancel') {
      resumedState = resumedState.addEvent({
        type: 'cancelled',
        stage: pausedStage,
        data: { userResponse },
      });
      resumedState.saveTo(this.sessionPath);
      yield { type: 'orchestrator_complete', totalCostUsd: 0, stageCount: pausedStage + 1 };
      return;
    }

    // ── Amend path — re-run current stage with original context + amendment ──
    if (action === 'amend') {
      resumedState = resumedState.addEvent({
        type: 'amended',
        stage: pausedStage,
        data: { amendment: userResponse },
      });
      resumedState.saveTo(this.sessionPath);

      // Build re-run message with original context + amendment
      const rerunMessage = resumedState.originalUserMessage
        ? resumedState.originalUserMessage + '\n\n[User amendment]: ' + userResponse
        : userResponse;

      this.onDebug?.(
        `[orchestrator] Amend re-run: stage=${pausedStage} hasOriginalMessage=${!!resumedState.originalUserMessage}`,
      );

      // Reload follow-up context for amend re-run
      let followUpContext: FollowUpContext | null = null;
      if (resumedState.previousSessionId) {
        const sessionsDir = dirname(this.sessionPath);
        followUpContext = loadFollowUpContext(sessionsDir, resumedState.previousSessionId);
      }

      // Re-run from the paused stage (not pausedStage + 1)
      yield* this.executePipeline(resumedState, rerunMessage, agentConfig, pausedStage, followUpContext);
      return;
    }

    // ── Proceed path (default) ────────────────────────────────────────
    // Parse ISA skip intent (Section 20 — F2, F3, F6)
    const nextStage = stages[pausedStage + 1];
    const intent = parseResumeIntent(userResponse, pausedStage, nextStage?.name);
    const resumeFromStage = pausedStage + 1;
    const skipStages = intent.skipNextStage
      ? new Set<number>([resumeFromStage])
      : new Set<number>();

    this.onDebug?.(
      `[orchestrator] Proceed: skipNextStage=${intent.skipNextStage}`,
    );

    // Reload follow-up context from PipelineState.previousSessionId (Section 20 — F1, F4)
    // Every resume() call reloads followUpContext so it survives across double-resume
    // (Stage 0→1→2). The previousSessionId is persisted in the pipeline state.
    let followUpContext: FollowUpContext | null = null;
    if (resumedState.previousSessionId) {
      const sessionsDir = dirname(this.sessionPath);
      followUpContext = loadFollowUpContext(sessionsDir, resumedState.previousSessionId);
      this.onDebug?.(
        `[orchestrator] Resume follow-up context: ${
          followUpContext
            ? `loaded (followup #${followUpContext.followupNumber})`
            : 'not found'
        } (previousSessionId=${resumedState.previousSessionId})`,
      );
    }

    // Continue from the stage AFTER the paused one
    yield* this.executePipeline(resumedState, userResponse, agentConfig, resumeFromStage, followUpContext, skipStages);
  }

  /**
   * Resume the orchestrator pipeline after a breakout.
   *
   * Unlike resume() which requires isPaused, this method works on pipelines
   * that were terminated via breakout. It loads state from disk, records a
   * resume_from_breakout event, and continues from the specified stage.
   *
   * @param userMessage - The user's message (may include resume intent)
   * @param agentConfig - Agent configuration (must match the original run)
   * @param fromStage - Stage index to resume from (typically lastCompletedStageIndex + 1)
   * @param breakoutStageResult - Optional result from the SDK breakout stage that just completed.
   *   When provided, the breakout stage's output is recorded in PipelineState before continuing.
   * @yields OrchestratorEvent items for the remaining stages
   */
  async *resumeFromBreakout(
    userMessage: string,
    agentConfig: AgentConfig,
    fromStage: number,
    breakoutStageResult?: { stageId: number; data: Record<string, unknown> },
  ): AsyncGenerator<OrchestratorEvent> {
    // Clear breakout scope FIRST — allows stage gate handler to accept
    // stage transitions for the remaining pipeline stages. Must happen
    // before any state loading or event recording. (F9 confirmed: sequential
    // execution means no race between clear and handler check.)
    clearBreakoutScope(this.sessionPath, agentConfig.slug);

    // Load state from disk
    let state = PipelineState.loadFrom(this.sessionPath);
    if (!state) {
      yield {
        type: 'orchestrator_error',
        stage: -1,
        error: `No saved pipeline state found at ${this.sessionPath}. Cannot resume from breakout.`,
      };
      return;
    }

    if (!state.isResumableAfterBreakout) {
      yield {
        type: 'orchestrator_error',
        stage: -1,
        error: 'Pipeline is not in a resumable-after-breakout state. Cannot resume.',
      };
      return;
    }

    // If the SDK breakout stage produced a result, record it in PipelineState
    if (breakoutStageResult) {
      this.onDebug?.(
        `[orchestrator] Recording breakout stage ${breakoutStageResult.stageId} result before resuming`,
      );
      state = state.setStageOutput(breakoutStageResult.stageId, {
        text: '',
        summary: 'SDK breakout stage completed',
        usage: ZERO_USAGE,
        data: breakoutStageResult.data,
      });
      state.saveTo(this.sessionPath);
    }

    // Record resume_from_breakout event
    const resumedState = state.addEvent({
      type: 'resume_from_breakout',
      stage: fromStage,
      data: { userMessage: userMessage.slice(0, 500), fromStage },
    });

    this.onDebug?.(
      `[orchestrator] Resume from breakout: fromStage=${fromStage} lastCompleted=${state.lastCompletedStageIndex}`,
    );

    // Reload follow-up context from PipelineState.previousSessionId
    let followUpContext: FollowUpContext | null = null;
    if (resumedState.previousSessionId) {
      const sessionsDir = dirname(this.sessionPath);
      followUpContext = loadFollowUpContext(sessionsDir, resumedState.previousSessionId);
      this.onDebug?.(
        `[orchestrator] Resume-from-breakout follow-up context: ${
          followUpContext
            ? `loaded (followup #${followUpContext.followupNumber})`
            : 'not found'
        } (previousSessionId=${resumedState.previousSessionId})`,
      );
    }

    // Continue from the specified stage
    yield* this.executePipeline(resumedState, userMessage, agentConfig, fromStage, followUpContext);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // CORE PIPELINE LOOP
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Execute pipeline stages starting from a given index.
   *
   * This is the deterministic for-loop at the heart of the orchestrator.
   * Each iteration: run stage → record output → check repair → checkpoint.
   *
   * Mirrors gamma's ISAResearchWorkflow.run() — workflow.py L790–860.
   *
   * @param initialState - Pipeline state to start from
   * @param userMessage - User message (original query or resume response)
   * @param agentConfig - Agent configuration
   * @param startStageIndex - Index into agentConfig.controlFlow.stages to start from
   * @param followUpContext - Follow-up context from previous session (optional)
   * @param skipStages - Set of stage IDs to skip (Section 20 — skip intercept)
   */
  private async *executePipeline(
    initialState: PipelineState,
    userMessage: string,
    agentConfig: AgentConfig,
    startStageIndex: number,
    followUpContext?: FollowUpContext | null,
    skipStages?: ReadonlySet<number>,
  ): AsyncGenerator<OrchestratorEvent> {
    const stages = agentConfig.controlFlow.stages;
    const repairUnits = agentConfig.controlFlow.repairUnits ?? [];
    const skips = skipStages ?? new Set<number>();
    let state = initialState;

    // Set agent slug for debug context file writing (Phase 6)
    this.stageRunner.setAgentSlug(agentConfig.slug);

    for (let i = startStageIndex; i < stages.length; i++) {
      const stage = stages[i];
      if (!stage) continue;

      // Track current stage for real-time substep callback
      this.currentStageId = stage.id;

      // ── 0. Skip intercept (Section 20 — F2) ─────────────────────────
      // Placed BEFORE both pause-after and normal-run branches so that
      // skipped stages never call runStage().
      if (skips.has(stage.id)) {
        this.onDebug?.(`[orchestrator] Stage ${stage.id} (${stage.name}) SKIPPED by resume intent`);

        // Produce synthetic skipped result with pass-through Stage 0 queries.
        // NOTE: This data shape is ISA-specific (websearch_calibration fields).
        // This is acceptable because skip is gated to nextStageName === 'websearch_calibration'
        // in parseResumeIntent(), so only ISA agents can reach this code path.
        const stage0Output = state.getStageOutput(0);
        const stage0Queries = stage0Output?.data?.['queries'] ?? [];
        const skippedResult = {
          text: 'Stage skipped by user request',
          summary: `Skipped — user chose to skip ${stage.name}`,
          usage: ZERO_USAGE,
          data: {
            websearch_calibration: { skipped: true },
            queries: stage0Queries,
            webResults: [],
            webSearchExecution: {
              mcpConnected: false,
              querySource: 'none',
              queriesPlanned: 0,
              queriesAttempted: 0,
              queriesSucceeded: 0,
              resultsCount: 0,
              warnings: [],
              status: 'user_skipped',
            },
          } as Record<string, unknown>,
        };

        state = state.addEvent({ type: 'stage_started', stage: stage.id, data: { skipped: true } });
        state = state.setStageOutput(stage.id, skippedResult);
        state = state.addEvent({
          type: 'stage_completed',
          stage: stage.id,
          data: { summary: skippedResult.summary, usage: skippedResult.usage, skipped: true },
        });
        state.saveTo(this.sessionPath);

        yield { type: 'orchestrator_stage_start', stage: stage.id, name: stage.name };
        yield {
          type: 'orchestrator_stage_complete',
          stage: stage.id,
          name: stage.name,
          stageOutput: skippedResult.data,
        };
        continue;
      }

      // ── 1. Emit stage start event (UI shows progress) ────────────────
      state = state.addEvent({ type: 'stage_started', stage: stage.id, data: {} });
      yield { type: 'orchestrator_stage_start', stage: stage.id, name: stage.name };

      // ── 1b. SDK BREAKOUT — yield control to SDK conversation ────────
      // Stages with mode: 'sdk_breakout' cannot be executed via direct LLM call.
      // Instead, we yield a breakout event with the stage prompt and prior outputs,
      // then exit the generator. The SDK conversation runs with full tool access,
      // calls stage_gate(complete) to persist results, and the pipeline resumes
      // via resumeFromBreakout().
      if (stage.mode === 'sdk_breakout') {
        // Load stage prompt via StageRunner
        const prompt = this.stageRunner.getStagePrompt(stage.id, stage.name, agentConfig);

        // Gather prior stage outputs for SDK context injection
        const priorOutputs: Record<string, unknown> = {};
        for (const [stageId, output] of state.stageOutputs) {
          if (output != null) {
            priorOutputs[`stage_${stageId}_${stages[stageId]?.name ?? 'unknown'}`] = output.data;
          }
        }

        // Record breakout event so isResumableAfterBreakout detects this state
        state = state.addEvent({
          type: 'breakout',
          stage: stage.id,
          data: { reason: 'sdk_breakout', stageName: stage.name },
        });

        // NOTE: Breakout scope (breakoutStage field in current-run-state.json) is set
        // by writeOrchestratorBridgeState(breakout: true) in processOrchestratorEvents
        // (claude-agent.ts), which runs AFTER this yield. The clearBreakoutScope() in
        // resumeFromBreakout() clears it when the orchestrator resumes.

        // Checkpoint state before yielding breakout
        state.saveTo(this.sessionPath);

        this.onDebug?.(
          `[orchestrator] SDK breakout: stage ${stage.id} (${stage.name}) — yielding to SDK conversation`,
        );

        // Yield breakout event — claude-agent.ts catches this and enters SDK query()
        yield {
          type: 'orchestrator_sdk_breakout',
          stage: stage.id,
          name: stage.name,
          prompt,
          priorOutputs,
        };

        // Exit generator — same pattern as pause (line 571)
        // Pipeline continues via resumeFromBreakout() after SDK completes
        return;
      }

      // ── 2. Check if this is a pause-after stage ──────────────────────
      if (agentConfig.controlFlow.pauseAfterStages?.includes(stage.id)) {
        try {
          // Clear substep queue for this stage
          this.substepQueue.length = 0;

          // Detect amend re-run: if there's an 'amended' event for this stage, force workspace metadata (F2)
          const isAmendRerun = state.events.some(
            e => e.type === 'amended' && e.stage === stage.id,
          );

          // Run the stage to generate the pause message
          const pauseResult = await this.stageRunner.runStage(
            stage, state, userMessage, agentConfig, followUpContext,
            isAmendRerun ? { forceWorkspaceMetadata: true } : undefined,
          );

          // Drain substep events collected during stage execution
          for (const substep of this.substepQueue) {
            yield { type: 'orchestrator_substep', stageId: stage.id, substep };
          }
          this.substepQueue.length = 0;

          state = state.setStageOutput(stage.id, pauseResult);
          state = state.addEvent({
            type: 'stage_completed',
            stage: stage.id,
            data: { summary: pauseResult.summary, usage: pauseResult.usage },
          });

          // ── Schema validation for orchestrator-driven pause stages ──
          // Runs AFTER setStageOutput so state is consistent, but BEFORE
          // checkpoint so a block enforcement can halt the pipeline.
          const pauseSchemas = agentConfig.controlFlow.stageOutputSchemas;
          const pauseStageSchema = pauseSchemas?.[String(stage.id)];
          if (pauseStageSchema && pauseResult.data) {
            const validation = validateStageOutput(
              pauseResult.data as Record<string, unknown>,
              pauseStageSchema,
            );
            if (!validation.valid) {
              const enforcement = pauseStageSchema.enforcement ?? 'warn';
              if (enforcement === 'block') {
                this.onDebug?.(
                  `[orchestrator] Schema BLOCK for pause stage ${stage.id}: ${validation.warnings.join(', ')}`,
                );
                yield {
                  type: 'orchestrator_error',
                  stage: stage.id,
                  error: pauseStageSchema.blockMessage
                    ?? `Stage ${stage.id} schema validation failed: ${validation.warnings.join(', ')}`,
                };
                return;
              }
              this.onDebug?.(
                `[orchestrator] Schema warnings for pause stage ${stage.id}: ${validation.warnings.join(', ')}`,
              );
            }
          }

          // Cost tracking even for pause stages
          this.costTracker.recordStage(stage.id, pauseResult.usage);

          // Checkpoint state (shared by both auto-advance and pause paths)
          state.saveTo(this.sessionPath);

          // ── BRANCH POINT (F2: after stage_completed, before pause_requested) ──
          // Auto-advance: stages with pauseChoices ALWAYS pause (F1: preserves Amend/Cancel).
          // Stages without pauseChoices auto-advance when autoAdvance is enabled.
          const shouldAutoAdvance = agentConfig.controlFlow.autoAdvance === true
            && !stage.pauseChoices?.length;

          if (shouldAutoAdvance) {
            // Format the stage output as informational text (reuse same formatter)
            const { message: formattedMessage } = formatPauseMessage(
              stage.id, stage.name, pauseResult.data, pauseResult.text,
              {
                onDebug: this.onDebug,
                costInfo: {
                  inputTokens: pauseResult.usage.inputTokens,
                  outputTokens: pauseResult.usage.outputTokens,
                  costUsd: this.costTracker.totalCostUsd,
                },
                pauseInstructions: stage.pauseInstructions,
                pauseDisplayFields: stage.pauseDisplayFields,
              },
            );

            this.onDebug?.(
              `[orchestrator] Auto-advancing past stage ${stage.id} (${stage.name}) — no pauseChoices`,
            );

            // Yield stage output as informational text (not a pause event)
            // F6: onAgentStagePause is correctly NOT called — no pause state exists
            yield { type: 'text', text: formattedMessage };
            yield {
              type: 'orchestrator_stage_complete',
              stage: stage.id,
              name: stage.name,
              stageOutput: pauseResult.data,
            };

            // F2: do NOT record pause_requested — prevents isPaused corruption
            // F5: do NOT write bridge state — nothing to resume from
            // Continue to next stage (no return)
            continue;
          }

          // ── Normal pause path (pauseChoices present or autoAdvance disabled) ──

          // Record pause event
          state = state.addEvent({ type: 'pause_requested', stage: stage.id, data: {} });
          state.saveTo(this.sessionPath);

          // Format the pause message for human-readable display
          const { message: formattedMessage, normalizationPath } = formatPauseMessage(
            stage.id, stage.name, pauseResult.data, pauseResult.text,
            {
              onDebug: this.onDebug,
              costInfo: {
                inputTokens: pauseResult.usage.inputTokens,
                outputTokens: pauseResult.usage.outputTokens,
                costUsd: this.costTracker.totalCostUsd,
              },
              pauseInstructions: stage.pauseInstructions,
              pauseDisplayFields: stage.pauseDisplayFields,
            },
          );

          // Record which formatting path was used (gamma: all derived state from events)
          const webSearchExecution = (pauseResult.data?.['webSearchExecution'] as Record<string, unknown> | undefined);
          state = state.addEvent({
            type: 'pause_formatted',
            stage: stage.id,
            data: {
              normalizationPath,
              formattedLength: formattedMessage.length,
              ...(stage.id === 1 && webSearchExecution
                ? {
                  webSearchExecutionStatus: webSearchExecution['status'],
                  webSearchResultsCount: webSearchExecution['resultsCount'],
                  webSearchQueriesAttempted: webSearchExecution['queriesAttempted'],
                  webSearchQueriesSucceeded: webSearchExecution['queriesSucceeded'],
                }
                : {}),
            },
          });
          state.saveTo(this.sessionPath);

          // Yield pause event — UI shows formatted message, waits for user
          yield { type: 'orchestrator_pause', stage: stage.id, message: formattedMessage };

          // Exit generator — resumed via resume() call
          return;
        } catch (error) {
          yield* this.handleStageError(stage.id, error, state);
          return;
        }
      }

      // ── 3. Run the stage ─────────────────────────────────────────────
      try {
        // Clear substep queue for this stage
        this.substepQueue.length = 0;

        const stageResult = await this.stageRunner.runStage(
          stage, state, userMessage, agentConfig, followUpContext,
        );

        // Drain substep events collected during stage execution
        for (const substep of this.substepQueue) {
          yield { type: 'orchestrator_substep', stageId: stage.id, substep };
        }
        this.substepQueue.length = 0;

        // ── 4. Record output in state (TypeScript writes state — not LLM)
        state = state.setStageOutput(stage.id, stageResult);
        state = state.addEvent({
          type: 'stage_completed',
          stage: stage.id,
          data: { summary: stageResult.summary, usage: stageResult.usage },
        });

        // ── 4.5 Schema validation for orchestrator-driven stages ───────
        // Validates LLM output against stageOutputSchemas from config.json.
        // This is the orchestrator equivalent of the SDK path's validation
        // in handleComplete() (agent-stage-gate.ts).
        const runSchemas = agentConfig.controlFlow.stageOutputSchemas;
        const runStageSchema = runSchemas?.[String(stage.id)];
        if (runStageSchema && stageResult.data) {
          const validation = validateStageOutput(
            stageResult.data as Record<string, unknown>,
            runStageSchema,
          );
          if (!validation.valid) {
            const enforcement = runStageSchema.enforcement ?? 'warn';
            if (enforcement === 'block') {
              this.onDebug?.(
                `[orchestrator] Schema BLOCK for stage ${stage.id}: ${validation.warnings.join(', ')}`,
              );
              state.saveTo(this.sessionPath);
              yield {
                type: 'orchestrator_error',
                stage: stage.id,
                error: runStageSchema.blockMessage
                  ?? `Stage ${stage.id} schema validation failed: ${validation.warnings.join(', ')}`,
              };
              return;
            }
            this.onDebug?.(
              `[orchestrator] Schema warnings for stage ${stage.id}: ${validation.warnings.join(', ')}`,
            );
          }
        }

        // ── 5. Cost tracking ───────────────────────────────────────────
        this.costTracker.recordStage(stage.id, stageResult.usage);
        if (!this.costTracker.withinBudget()) {
          state.saveTo(this.sessionPath);
          yield { type: 'orchestrator_budget_exceeded', totalCost: this.costTracker.totalCostUsd };
          return;
        }

        // ── 6. Checkpoint state to disk ────────────────────────────────
        state.saveTo(this.sessionPath);

        // ── 7. Emit stage complete (UI updates) ────────────────────────
        yield {
          type: 'orchestrator_stage_complete',
          stage: stage.id,
          name: stage.name,
          stageOutput: stageResult.data,
        };

        // ── 8. REPAIR LOOP (G15) ──────────────────────────────────────
        state = yield* this.executeRepairLoop(
          stage.id, stages, repairUnits, state, userMessage, agentConfig, followUpContext,
        );
      } catch (error) {
        state = yield* this.handleStageError(stage.id, error, state);
        return;
      }
    }

    // ── All stages done — pipeline complete ──────────────────────────────
    yield {
      type: 'orchestrator_complete',
      totalCostUsd: this.costTracker.totalCostUsd,
      stageCount: stages.length,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // REPAIR LOOP (G15)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Execute repair loop if the completed stage is the last in a repair unit.
   *
   * Mirrors gamma's `_run_repair_stages()` — workflow.py L1174.
   * If verification failed (needsRepair === true), re-runs all stages in
   * the repair unit with feedback, up to maxIterations times.
   *
   * @param completedStageId - The stage that just completed
   * @param stages - All pipeline stages
   * @param repairUnits - Repair unit configurations
   * @param currentState - Current pipeline state
   * @param userMessage - Original user message
   * @param agentConfig - Agent configuration
   * @returns Updated pipeline state after repair (or unchanged if no repair needed)
   */
  private async *executeRepairLoop(
    completedStageId: number,
    stages: readonly StageConfig[],
    repairUnits: readonly { stages: number[]; maxIterations: number; feedbackField: string }[],
    currentState: PipelineState,
    userMessage: string,
    agentConfig: AgentConfig,
    followUpContext?: FollowUpContext | null,
  ): AsyncGenerator<OrchestratorEvent, PipelineState> {
    let state = currentState;

    // Check if the completed stage is the LAST stage in a repair unit
    const repairUnit = repairUnits.find(
      (ru) => ru.stages[ru.stages.length - 1] === completedStageId,
    );
    if (!repairUnit) return state;

    // Check if repair is needed
    let currentVerifyOutput = state.getStageOutput(completedStageId);
    let repairIteration = 0;

    while (
      repairIteration < repairUnit.maxIterations &&
      currentVerifyOutput?.data?.['needsRepair'] === true
    ) {
      repairIteration++;
      yield {
        type: 'orchestrator_repair_start',
        iteration: repairIteration,
        maxIterations: repairUnit.maxIterations,
      };

      // Re-run all stages in the repair unit with feedback
      for (const repairStageId of repairUnit.stages) {
        const repairStage = stages.find((s) => s.id === repairStageId);
        if (!repairStage) continue;

        // Track current stage for real-time substep callback
        this.currentStageId = repairStageId;

        const feedback = currentVerifyOutput?.data?.[repairUnit.feedbackField] as string | undefined;
        state = state.addEvent({
          type: 'stage_started',
          stage: repairStageId,
          data: { repairIteration, feedback },
        });

        yield { type: 'orchestrator_stage_start', stage: repairStageId, name: repairStage.name };

        // ── SDK breakout for repair stages ──────────────────────────────
        // If a repair stage uses sdk_breakout mode, yield breakout event
        // and return current state. The pipeline will resume via
        // resumeFromBreakout() after the SDK completes the repair stage.
        if (repairStage.mode === 'sdk_breakout') {
          const prompt = this.stageRunner.getStagePrompt(repairStageId, repairStage.name, agentConfig);
          const priorOutputs: Record<string, unknown> = {};
          for (const [stageId, output] of state.stageOutputs) {
            if (output != null) {
              priorOutputs[`stage_${stageId}_${stages[stageId]?.name ?? 'unknown'}`] = output.data;
            }
          }
          // Include repair feedback in prior outputs so SDK has context
          if (feedback) {
            priorOutputs['repair_feedback'] = feedback;
            priorOutputs['repair_iteration'] = repairIteration;
          }

          // Record breakout event so isResumableAfterBreakout detects this state
          state = state.addEvent({
            type: 'breakout',
            stage: repairStageId,
            data: { reason: 'sdk_breakout', stageName: repairStage.name, repairIteration },
          });

          // NOTE: Breakout scope is set by writeOrchestratorBridgeState(breakout: true)
          // in processOrchestratorEvents (claude-agent.ts), called after this yield.

          state.saveTo(this.sessionPath);

          this.onDebug?.(
            `[orchestrator] SDK breakout in repair loop: stage ${repairStageId} (${repairStage.name}), iteration ${repairIteration}`,
          );

          yield {
            type: 'orchestrator_sdk_breakout',
            stage: repairStageId,
            name: repairStage.name,
            prompt,
            priorOutputs,
          };

          // Exit — pipeline continues via resumeFromBreakout()
          return state;
        }

        // Clear substep queue for repair stage
        this.substepQueue.length = 0;

        const repairResult = await this.stageRunner.runStage(
          repairStage, state, userMessage, agentConfig, followUpContext,
        );

        // Drain substep events collected during repair stage execution
        for (const substep of this.substepQueue) {
          yield { type: 'orchestrator_substep', stageId: repairStageId, substep };
        }
        this.substepQueue.length = 0;

        state = state.setStageOutput(repairStageId, repairResult);
        state = state.addEvent({
          type: 'stage_completed',
          stage: repairStageId,
          data: { repairIteration, usage: repairResult.usage },
        });

        this.costTracker.recordStage(repairStageId, repairResult.usage);
        state.saveTo(this.sessionPath);

        yield {
          type: 'orchestrator_stage_complete',
          stage: repairStageId,
          name: repairStage.name,
          stageOutput: repairResult.data,
        };

        // Check budget after each repair stage
        if (!this.costTracker.withinBudget()) {
          yield { type: 'orchestrator_budget_exceeded', totalCost: this.costTracker.totalCostUsd };
          return state;
        }
      }

      // Re-check the last stage's output for another repair round
      currentVerifyOutput = state.getStageOutput(completedStageId);
    }

    return state;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ERROR HANDLING
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Handle a stage error — records the failure, saves state, yields error event.
   *
   * @returns Updated pipeline state with the failure recorded
   */
  private async *handleStageError(
    stageId: number,
    error: unknown,
    currentState: PipelineState,
  ): AsyncGenerator<OrchestratorEvent, PipelineState> {
    const errorMessage = error instanceof Error ? error.message : String(error);

    yield {
      type: 'orchestrator_error',
      stage: stageId,
      error: errorMessage,
    };

    const updatedState = currentState.addEvent({
      type: 'stage_failed',
      stage: stageId,
      data: { error: errorMessage },
    });

    updatedState.saveTo(this.sessionPath);
    return updatedState;
  }
}
