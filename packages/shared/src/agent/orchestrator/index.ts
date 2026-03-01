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
 * Only active at the Stage 0→1 boundary (pausedAtStage === 0).
 * Conservative matching with default-to-run fallback (F6).
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
 * @returns ResumeIntent with skipNextStage flag
 */
export function parseResumeIntent(userResponse: string, pausedAtStage: number): ResumeIntent {
  // Only apply skip detection at Stage 0→1 boundary
  if (pausedAtStage !== 0) {
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

    const state = PipelineState.create(this.sessionId, agentConfig.slug, this.previousSessionId);
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
    const resumedState = state.addEvent({
      type: 'resumed',
      stage: pausedStage,
      data: { userResponse },
    });

    // Parse skip intent (Section 20 — F2, F3, F6)
    const intent = parseResumeIntent(userResponse, pausedStage);
    const resumeFromStage = pausedStage + 1;
    const skipStages = intent.skipNextStage
      ? new Set<number>([resumeFromStage])
      : new Set<number>();

    this.onDebug?.(
      `[orchestrator] Resume from stage ${pausedStage}: skipNextStage=${intent.skipNextStage}`,
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
   * @yields OrchestratorEvent items for the remaining stages
   */
  async *resumeFromBreakout(
    userMessage: string,
    agentConfig: AgentConfig,
    fromStage: number,
  ): AsyncGenerator<OrchestratorEvent> {
    // Load state from disk
    const state = PipelineState.loadFrom(this.sessionPath);
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

        // Produce synthetic skipped result with pass-through Stage 0 queries
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

      // ── 2. Check if this is a pause-after stage ──────────────────────
      if (agentConfig.controlFlow.pauseAfterStages?.includes(stage.id)) {
        try {
          // Clear substep queue for this stage
          this.substepQueue.length = 0;

          // Run the stage to generate the pause message
          const pauseResult = await this.stageRunner.runStage(
            stage, state, userMessage, agentConfig, followUpContext,
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

          // Cost tracking even for pause stages
          this.costTracker.recordStage(stage.id, pauseResult.usage);

          // Checkpoint before pausing
          state.saveTo(this.sessionPath);

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
    stages: readonly { id: number; name: string; description?: string }[],
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
