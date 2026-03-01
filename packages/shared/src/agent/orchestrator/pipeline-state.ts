/**
 * Pipeline State — Immutable Event-Sourced State
 *
 * Port of gamma's `Thread` dataclass to TypeScript. The orchestrator's
 * state container is immutable and append-only: every mutation returns
 * a new `PipelineState` instance while the original is unchanged.
 *
 * Design principles:
 * - TypeScript writes state — LLM never touches it
 * - Append-only event log — complete audit trail of pipeline execution
 * - Stage outputs stored as typed records — used by later stages for context
 * - JSON-serializable — checkpoint to disk after each stage for crash recovery
 * - Derived properties computed from event log (isComplete, isPaused, etc.)
 *
 * Persistence: `sessions/<id>/data/pipeline-state.json` after each stage.
 * Enables resume on crash/restart — load from disk, continue from last checkpoint.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { StageEvent, StageEventType, StageResult, TokenUsage, PipelineSummary, PipelineExitReason } from './types.ts';
import { ZERO_USAGE } from './types.ts';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Filename for pipeline state persistence within session data directory. */
const STATE_FILENAME = 'pipeline-state.json';

// ============================================================================
// SERIALIZATION TYPES — JSON-safe representation
// ============================================================================

/** JSON-serializable representation of PipelineState (Map → Record). */
interface PipelineStateSnapshot {
  readonly sessionId: string;
  /** Agent slug for self-describing state (G1 — detection without bridge state). Optional for backward compat with pre-Section 16 files. */
  readonly agentSlug?: string;
  /** Session ID of the previous session — enables follow-up context reload across resume boundaries (Section 20 F1/F4/F5). */
  readonly previousSessionId?: string;
  readonly events: readonly StageEvent[];
  readonly currentStage: number;
  /** Stage outputs as a plain object (Map serialized to Record). */
  readonly stageOutputs: Record<number, StageResult>;
  /** ISO timestamp of when this snapshot was created. */
  readonly savedAt: string;
}

// ============================================================================
// PIPELINE STATE
// ============================================================================

export class PipelineState {
  /** Session ID for state persistence and event correlation. */
  readonly sessionId: string;

  /** Agent slug for self-describing state — enables detection without bridge state (Section 16 G1). */
  readonly agentSlug: string;

  /** Session ID of the previous session — enables follow-up context reload across resume boundaries (Section 20 F1/F4/F5). */
  readonly previousSessionId?: string;

  /** Append-only event log — complete audit trail. */
  readonly events: readonly StageEvent[];

  /** Current stage index (0-based). Updated on stage_started events. */
  readonly currentStage: number;

  /**
   * Per-stage structured outputs.
   * Key = stage ID, Value = StageResult from that stage.
   * Used by later stages to build context (e.g., Stage 3 reads Stage 0's query plan).
   * Stored as ReadonlyMap for immutability.
   */
  readonly stageOutputs: ReadonlyMap<number, StageResult>;

  // ──────────────────────────────────────────────────────────────────────────
  // CONSTRUCTORS
  // ──────────────────────────────────────────────────────────────────────────

  private constructor(
    sessionId: string,
    events: readonly StageEvent[],
    currentStage: number,
    stageOutputs: ReadonlyMap<number, StageResult>,
    agentSlug: string = '',
    previousSessionId?: string,
  ) {
    this.sessionId = sessionId;
    this.agentSlug = agentSlug;
    this.previousSessionId = previousSessionId;
    this.events = events;
    this.currentStage = currentStage;
    this.stageOutputs = stageOutputs;
  }

  /** Create a fresh pipeline state for a new session. */
  static create(sessionId: string, agentSlug: string = '', previousSessionId?: string): PipelineState {
    return new PipelineState(sessionId, [], -1, new Map(), agentSlug, previousSessionId);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // DERIVED PROPERTIES
  // ──────────────────────────────────────────────────────────────────────────

  /** True if the pipeline has a 'stage_completed' event for the last stage started. */
  get isComplete(): boolean {
    if (this.events.length === 0) return false;
    // Find the highest stage that was started
    const startedStages = this.events
      .filter((e) => e.type === 'stage_started')
      .map((e) => e.stage);
    if (startedStages.length === 0) return false;

    const lastStarted = Math.max(...startedStages);
    // Check that the last started stage has a completion event
    return this.events.some(
      (e) => e.type === 'stage_completed' && e.stage === lastStarted,
    );
  }

  /**
   * True if the pipeline is paused — a 'pause_requested' exists with no
   * subsequent resolving event ('resumed' or 'breakout').
   *
   * A 'breakout' event terminates the pipeline and resolves the pause,
   * preventing detectPausedOrchestrator() from re-entering a terminated pipeline.
   */
  get isPaused(): boolean {
    const pauseEvents = this.events.filter((e) => e.type === 'pause_requested');
    const resolveEvents = this.events.filter(
      (e) => e.type === 'resumed' || e.type === 'breakout',
    );
    return pauseEvents.length > resolveEvents.length;
  }

  /**
   * True if breakout intent was detected but not yet confirmed.
   *
   * A 'breakout_pending' event that hasn't been resolved by a subsequent
   * 'resumed' (user denied) or 'breakout' (user confirmed) event.
   * Survives app restarts — the confirmation window persists until resolved.
   */
  get isBreakoutPending(): boolean {
    // Find the index of the last breakout_pending event
    let lastPendingIdx = -1;
    for (let i = this.events.length - 1; i >= 0; i--) {
      if (this.events[i]!.type === 'breakout_pending') {
        lastPendingIdx = i;
        break;
      }
    }
    if (lastPendingIdx === -1) return false;
    // Check if any resolving event occurs after the last breakout_pending (by array order)
    for (let i = lastPendingIdx + 1; i < this.events.length; i++) {
      const t = this.events[i]!.type;
      if (t === 'breakout' || t === 'resumed') return false;
    }
    return true;
  }

  /** The stage at which the pipeline is paused, or -1 if not paused. */
  get pausedAtStage(): number {
    if (!this.isPaused) return -1;
    const lastPause = [...this.events]
      .reverse()
      .find((e) => e.type === 'pause_requested');
    return lastPause?.stage ?? -1;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // BREAKOUT RESUME DETECTION — Derived properties for resume-from-breakout
  // ──────────────────────────────────────────────────────────────────────────

  /** True if any 'breakout' event exists in the event log. */
  get hasBreakout(): boolean {
    return this.events.some((e) => e.type === 'breakout');
  }

  /**
   * The highest stage number with a 'stage_completed' event, or -1 if none.
   * Used to determine where to resume a broken-out pipeline.
   */
  get lastCompletedStageIndex(): number {
    let max = -1;
    for (const e of this.events) {
      if (e.type === 'stage_completed' && e.stage > max) {
        max = e.stage;
      }
    }
    return max;
  }

  /**
   * True if the pipeline was broken out of and can be resumed.
   *
   * Uses ordered-event scan (same pattern as isBreakoutPending) to correctly
   * handle multiple breakout/resume cycles:
   * 1. Find the last 'breakout' event
   * 2. Check that no 'resume_from_breakout' event exists after it
   * 3. Require: not pipeline_completed, at least one completed stage, not still paused
   */
  get isResumableAfterBreakout(): boolean {
    // Find the index of the last breakout event
    let lastBreakoutIdx = -1;
    for (let i = this.events.length - 1; i >= 0; i--) {
      if (this.events[i]!.type === 'breakout') {
        lastBreakoutIdx = i;
        break;
      }
    }
    if (lastBreakoutIdx === -1) return false;

    // Check that no resume_from_breakout event exists after the last breakout
    for (let i = lastBreakoutIdx + 1; i < this.events.length; i++) {
      if (this.events[i]!.type === 'resume_from_breakout') return false;
    }

    // Additional guards:
    // - Must have completed stages to resume from
    // - Not still paused (should use normal resume path, not breakout resume)
    // Note: We don't check isComplete here because isComplete only tracks whether
    // the last-started stage completed, not whether ALL pipeline stages are done.
    // The breakout event itself implies the pipeline was not fully finished.
    // If somehow breakout happens after all stages, resumeFromBreakout will
    // start past the last stage and complete immediately (handled by orchestrator).
    return this.lastCompletedStageIndex >= 0 && !this.isPaused;
  }

  /**
   * True if a breakout-resume confirmation was asked but not yet resolved.
   *
   * A 'breakout_resume_pending' event that hasn't been resolved by a subsequent
   * 'resume_from_breakout' or 'stage_started' event.
   * Mirrors isBreakoutPending pattern — survives app restarts.
   */
  get isBreakoutResumePending(): boolean {
    let lastPendingIdx = -1;
    for (let i = this.events.length - 1; i >= 0; i--) {
      if (this.events[i]!.type === 'breakout_resume_pending') {
        lastPendingIdx = i;
        break;
      }
    }
    if (lastPendingIdx === -1) return false;
    // Check if any resolving event occurs after the last breakout_resume_pending
    for (let i = lastPendingIdx + 1; i < this.events.length; i++) {
      const t = this.events[i]!.type;
      if (t === 'resume_from_breakout' || t === 'stage_started') return false;
    }
    return true;
  }

  /** Total input + output tokens across all LLM calls in the pipeline. */
  get totalUsage(): TokenUsage {
    let inputTokens = 0;
    let outputTokens = 0;
    for (const output of this.stageOutputs.values()) {
      inputTokens += output.usage.inputTokens;
      outputTokens += output.usage.outputTokens;
    }
    return { inputTokens, outputTokens };
  }

  /** Count of completed stages. */
  get completedStageCount(): number {
    return this.events.filter((e) => e.type === 'stage_completed').length;
  }

  /** Count of failed stages. */
  get failedStageCount(): number {
    return this.events.filter((e) => e.type === 'stage_failed').length;
  }

  /** Number of repair iterations recorded in the event log. */
  get repairIterationCount(): number {
    return this.events.filter(
      (e) => e.type === 'stage_started' && e.data['repairIteration'] !== undefined,
    ).length;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // IMMUTABLE MUTATIONS — Each returns a NEW PipelineState instance
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Append an event to the log. Returns a new PipelineState — the original is unchanged.
   *
   * Automatically stamps the event with the current timestamp.
   * If the event is 'stage_started', updates `currentStage` to the event's stage.
   */
  addEvent(event: Omit<StageEvent, 'timestamp'>): PipelineState {
    const stamped: StageEvent = {
      ...event,
      timestamp: Date.now(),
    };

    const newCurrentStage = event.type === 'stage_started'
      ? event.stage
      : this.currentStage;

    return new PipelineState(
      this.sessionId,
      [...this.events, stamped],
      newCurrentStage,
      this.stageOutputs,
      this.agentSlug,
      this.previousSessionId,
    );
  }

  /**
   * Store a stage's output. Returns a new PipelineState — the original is unchanged.
   *
   * Later stages use `getStageOutput(stageId)` to read previous stage outputs
   * for context building (e.g., Stage 3 reads Stage 0's query plan).
   */
  setStageOutput(stageId: number, output: StageResult): PipelineState {
    const newOutputs = new Map(this.stageOutputs);
    newOutputs.set(stageId, output);
    return new PipelineState(
      this.sessionId,
      this.events,
      this.currentStage,
      newOutputs,
      this.agentSlug,
      this.previousSessionId,
    );
  }

  /**
   * Get a stage's output, or undefined if the stage hasn't been completed.
   *
   * Used by the orchestrator to pass data between stages:
   * - Stage 3 reads Stage 0's query plan
   * - Stage 3 reads Stage 2's retrieval results
   * - Stage 5 reads Stage 3's synthesis and Stage 4's verification
   */
  getStageOutput(stageId: number): StageResult | undefined {
    return this.stageOutputs.get(stageId);
  }

  /**
   * Get events filtered by type. Useful for diagnostics and reporting.
   */
  getEventsByType(type: StageEventType): readonly StageEvent[] {
    return this.events.filter((e) => e.type === type);
  }

  /**
   * Get events for a specific stage. Useful for stage-level diagnostics.
   */
  getEventsForStage(stageId: number): readonly StageEvent[] {
    return this.events.filter((e) => e.stage === stageId);
  }

  /**
   * Extract the original research query from Stage 0 query plan output.
   *
   * Tries `query_plan.original_query` first, then `query_plan.user_query`,
   * then falls back to 'Unknown query'. This is the same extraction logic
   * used by `generateSummary()`, factored out for reuse by semantic
   * breakout classification.
   */
  get originalQuery(): string {
    const stage0 = this.getStageOutput(0);
    const queryPlan = stage0?.data?.['query_plan'] as Record<string, unknown> | undefined;
    return (queryPlan?.['original_query'] as string)
      ?? (queryPlan?.['user_query'] as string)
      ?? 'Unknown query';
  }

  /**
   * Extract sub-query texts from Stage 0 query plan output.
   * Returns an array of sub-query text strings (max first 5 for brevity).
   * Used by semantic breakout classification to provide research context.
   */
  get subQueryTexts(): readonly string[] {
    const stage0 = this.getStageOutput(0);
    const queryPlan = stage0?.data?.['query_plan'] as Record<string, unknown> | undefined;
    const subQueries = queryPlan?.['sub_queries'] as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(subQueries)) return [];
    return subQueries
      .slice(0, 5)
      .map(sq => (typeof sq['query'] === 'string' ? sq['query'] : typeof sq['text'] === 'string' ? sq['text'] : ''))
      .filter(t => t.length > 0);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SUMMARY GENERATION — Compact context for post-pipeline conversation
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Generate a compact summary from pipeline state for context injection.
   *
   * Extracts key data from stageOutputs to produce a ~500–1500 char summary
   * that survives SDK compaction. Works for both complete and partial pipelines:
   * - Stage 0 only → has query decomposition
   * - Stages 0–3 → has synthesis but no verification
   * - Stages 0–5 → full summary with output path
   *
   * @param totalStages - Total number of stages in the pipeline config
   * @param exitReason - Why the pipeline ended ('completed', 'paused', 'error', 'breakout')
   * @returns PipelineSummary object ready for JSON serialization
   */
  generateSummary(totalStages: number, exitReason: PipelineExitReason): PipelineSummary {
    // Extract original query via reusable getter
    const originalQuery = this.originalQuery;

    // Extract synthesis from Stage 3
    const stage3 = this.getStageOutput(3);
    const synthesisData = stage3?.data;
    let synthesis: string | null = null;
    if (synthesisData?.['synthesis']) {
      const rawSynthesis = synthesisData['synthesis'] as string;
      // Truncate to ~800 chars to keep summary compact
      synthesis = rawSynthesis.length > 800
        ? rawSynthesis.slice(0, 800) + '...[truncated]'
        : rawSynthesis;
    }

    // Citation count
    const rawCitations = (synthesisData?.['citations_used'] ?? synthesisData?.['citations'] ?? []) as unknown[];
    const citationCount = Array.isArray(rawCitations) ? rawCitations.length : 0;

    // Confidence
    const confidence = (synthesisData?.['confidence'] as string) ?? null;

    // Verification scores from Stage 4
    const stage4 = this.getStageOutput(4);
    const verificationScores = (stage4?.data?.['verification_scores'] as Record<string, unknown>) ?? null;
    const neededRepair = (stage4?.data?.['needsRepair'] as boolean) ?? false;

    // Output path from Stage 5
    const stage5 = this.getStageOutput(5);
    const outputPath = (stage5?.data?.['outputPath'] as string) ?? null;

    // Completed stages derived from events
    const completedStages = this.events
      .filter((e) => e.type === 'stage_completed')
      .map((e) => e.stage)
      .sort((a, b) => a - b);

    const wasPartial = exitReason !== 'completed' || completedStages.length < totalStages;

    // ── Stage 0 detail extraction (Phase 5 — enriched compact context) ──
    const stage0 = this.getStageOutput(0);
    const queryPlanData = stage0?.data?.['query_plan'] as Record<string, unknown> | undefined;

    // Sub-query texts (reuse existing getter logic, but include all for summary)
    const rawSubQueries = queryPlanData?.['sub_queries'] as Array<Record<string, unknown>> | undefined;
    const queryDecomposition = Array.isArray(rawSubQueries)
      ? rawSubQueries
          .map(sq => (typeof sq['query'] === 'string' ? sq['query'] : typeof sq['text'] === 'string' ? sq['text'] : ''))
          .filter(t => t.length > 0)
      : undefined;

    // Assumptions
    const rawAssumptions = queryPlanData?.['assumptions'] as string[] | undefined;
    const assumptions = Array.isArray(rawAssumptions) && rawAssumptions.length > 0
      ? rawAssumptions
      : undefined;

    // Primary standards
    const rawStandards = queryPlanData?.['primary_standards'] as string[] | undefined;
    const primaryStandards = Array.isArray(rawStandards) && rawStandards.length > 0
      ? rawStandards
      : undefined;

    // Clarity score
    const rawClarity = queryPlanData?.['clarity_score'];
    const clarityScore = typeof rawClarity === 'number' ? rawClarity : undefined;

    return {
      originalQuery,
      synthesis,
      citationCount,
      confidence,
      verificationScores,
      neededRepair,
      completedStages,
      totalStages,
      wasPartial,
      exitReason,
      outputPath,
      generatedAt: new Date().toISOString(),
      queryDecomposition,
      assumptions,
      primaryStandards,
      clarityScore,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PERSISTENCE — JSON serialization for crash recovery
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Serialize to a JSON-safe snapshot. Map → Record for JSON compatibility.
   */
  toSnapshot(): PipelineStateSnapshot {
    const stageOutputs: Record<number, StageResult> = {};
    for (const [key, value] of this.stageOutputs) {
      stageOutputs[key] = value;
    }
    return {
      sessionId: this.sessionId,
      ...(this.agentSlug ? { agentSlug: this.agentSlug } : {}),
      ...(this.previousSessionId ? { previousSessionId: this.previousSessionId } : {}),
      events: this.events,
      currentStage: this.currentStage,
      stageOutputs,
      savedAt: new Date().toISOString(),
    };
  }

  /**
   * Deserialize from a JSON snapshot. Record → Map for runtime use.
   */
  static fromSnapshot(snapshot: PipelineStateSnapshot): PipelineState {
    const stageOutputs = new Map<number, StageResult>();
    for (const [key, value] of Object.entries(snapshot.stageOutputs)) {
      stageOutputs.set(Number(key), value as StageResult);
    }
    return new PipelineState(
      snapshot.sessionId,
      snapshot.events,
      snapshot.currentStage,
      stageOutputs,
      snapshot.agentSlug ?? '',
      snapshot.previousSessionId,
    );
  }

  /**
   * Save state to disk as JSON. Creates directories if needed.
   *
   * File path: `{sessionPath}/data/pipeline-state.json`
   *
   * Called after each stage completes — enables crash recovery.
   * If the process crashes, the orchestrator can resume from the last checkpoint.
   *
   * @param sessionPath - Absolute path to the session directory (e.g., `sessions/260223-nimble-coast`)
   */
  saveTo(sessionPath: string): void {
    const filePath = join(sessionPath, 'data', STATE_FILENAME);
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const snapshot = this.toSnapshot();
    writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf-8');
  }

  /**
   * Load state from disk. Returns null if no saved state exists.
   *
   * Called when resuming a session — if a pipeline-state.json exists,
   * the orchestrator can continue from the last checkpoint instead of
   * starting over.
   *
   * @param sessionPath - Absolute path to the session directory
   * @returns Loaded PipelineState, or null if no saved state
   */
  static loadFrom(sessionPath: string): PipelineState | null {
    const filePath = join(sessionPath, 'data', STATE_FILENAME);
    if (!existsSync(filePath)) {
      return null;
    }
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const snapshot = JSON.parse(raw) as PipelineStateSnapshot;
      return PipelineState.fromSnapshot(snapshot);
    } catch (error) {
      console.error(
        `[PipelineState] Failed to load state from ${filePath}:`,
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  }
}
