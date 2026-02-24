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

import { OrchestratorLlmClient } from './llm-client.ts';
import { PipelineState } from './pipeline-state.ts';
import { StageRunner } from './stage-runner.ts';
import type {
  AgentConfig,
  CostTrackerPort,
  McpBridge,
  OrchestratorConfig,
  OrchestratorEvent,
  OrchestratorOptions,
  StreamEvent,
} from './types.ts';
import { createNullCostTracker } from './types.ts';

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
export type { McpSourceTransportConfig } from './mcp-lifecycle.ts';

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
  OrchestratorConfig,
  OrchestratorEvent,
  OrchestratorOptions,
} from './types.ts';

// ============================================================================
// AGENT ORCHESTRATOR
// ============================================================================

export class AgentOrchestrator {
  private readonly sessionId: string;
  private readonly sessionPath: string;
  private readonly stageRunner: StageRunner;
  private readonly costTracker: CostTrackerPort;
  private readonly onStreamEvent?: (event: StreamEvent) => void;

  private constructor(
    options: OrchestratorOptions,
    stageRunner: StageRunner,
    costTracker: CostTrackerPort,
  ) {
    this.sessionId = options.sessionId;
    this.sessionPath = options.sessionPath;
    this.onStreamEvent = options.onStreamEvent;
    this.stageRunner = stageRunner;
    this.costTracker = costTracker;
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
    const state = PipelineState.create(this.sessionId);
    yield* this.executePipeline(state, userMessage, agentConfig, 0);
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

    // Continue from the stage AFTER the paused one
    const resumeFromStage = pausedStage + 1;
    yield* this.executePipeline(resumedState, userResponse, agentConfig, resumeFromStage);
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
   */
  private async *executePipeline(
    initialState: PipelineState,
    userMessage: string,
    agentConfig: AgentConfig,
    startStageIndex: number,
  ): AsyncGenerator<OrchestratorEvent> {
    const stages = agentConfig.controlFlow.stages;
    const repairUnits = agentConfig.controlFlow.repairUnits ?? [];
    let state = initialState;

    for (let i = startStageIndex; i < stages.length; i++) {
      const stage = stages[i];
      if (!stage) continue;

      // ── 1. Emit stage start event (UI shows progress) ────────────────
      state = state.addEvent({ type: 'stage_started', stage: stage.id, data: {} });
      yield { type: 'orchestrator_stage_start', stage: stage.id, name: stage.name };

      // ── 2. Check if this is a pause-after stage ──────────────────────
      if (agentConfig.controlFlow.pauseAfterStages?.includes(stage.id)) {
        try {
          // Run the stage to generate the pause message
          const pauseResult = await this.stageRunner.runStage(
            stage, state, userMessage, agentConfig,
          );
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

          // Yield pause event — UI shows message, waits for user
          yield { type: 'orchestrator_pause', stage: stage.id, message: pauseResult.text };

          // Exit generator — resumed via resume() call
          return;
        } catch (error) {
          yield* this.handleStageError(stage.id, error, state);
          return;
        }
      }

      // ── 3. Run the stage ─────────────────────────────────────────────
      try {
        const stageResult = await this.stageRunner.runStage(
          stage, state, userMessage, agentConfig,
        );

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
          stage.id, stages, repairUnits, state, userMessage, agentConfig,
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

        const feedback = currentVerifyOutput?.data?.[repairUnit.feedbackField] as string | undefined;
        state = state.addEvent({
          type: 'stage_started',
          stage: repairStageId,
          data: { repairIteration, feedback },
        });

        yield { type: 'orchestrator_stage_start', stage: repairStageId, name: repairStage.name };

        const repairResult = await this.stageRunner.runStage(
          repairStage, state, userMessage, agentConfig,
        );

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
