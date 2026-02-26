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
import type { StageEvent, StageEventType, StageResult, TokenUsage } from './types.ts';
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

  /** True if the last event is a 'pause_requested' with no subsequent 'resumed'. */
  get isPaused(): boolean {
    const pauseEvents = this.events.filter((e) => e.type === 'pause_requested');
    const resumeEvents = this.events.filter((e) => e.type === 'resumed');
    return pauseEvents.length > resumeEvents.length;
  }

  /** The stage at which the pipeline is paused, or -1 if not paused. */
  get pausedAtStage(): number {
    if (!this.isPaused) return -1;
    const lastPause = [...this.events]
      .reverse()
      .find((e) => e.type === 'pause_requested');
    return lastPause?.stage ?? -1;
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
