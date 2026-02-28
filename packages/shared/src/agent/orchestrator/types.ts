/**
 * Orchestrator Types
 *
 * Core type definitions for the deterministic agent orchestrator pipeline.
 * The orchestrator replaces SDK-driven tool calling with a TypeScript for-loop
 * that controls stage execution, MCP tool calls, and output rendering.
 *
 * Design principles:
 * - TypeScript writes state — LLM never touches it
 * - Each stage = 1 focused LLM call with shaped context
 * - Immutable state with event sourcing
 * - Per-stage cost tracking and budget enforcement
 */

import type { z } from 'zod';

// ============================================================================
// STREAM EVENTS — Progress callbacks for UI
// ============================================================================

/** Events emitted during streaming for UI progress updates. */
export interface StreamEvent {
  type: 'text_delta' | 'thinking_delta';
  text?: string;
  thinking?: string;
}

// ============================================================================
// SUBSTEP EVENTS — Progress callback for orchestrator pipeline visibility
// ============================================================================

/**
 * Fine-grained progress events emitted by StageRunner during stage execution.
 * These flow: StageRunner → onProgress callback → orchestrator queue → OrchestratorEvent yield
 * → processOrchestratorEvents → AgentEvent yields → processEvent → renderer messages.
 */
export type SubstepEvent =
  | { type: 'mcp_start'; toolName: string; toolUseId: string; input: Record<string, unknown>; parentToolUseId?: string }
  | { type: 'mcp_result'; toolUseId: string; toolName: string; result: string; isError?: boolean; parentToolUseId?: string }
  | { type: 'llm_start'; stageId: number; stageName: string; toolUseId: string; parentToolUseId?: string }
  | { type: 'llm_complete'; text: string; toolUseId: string; isIntermediate: boolean; parentToolUseId?: string }
  | { type: 'status'; message: string };

/**
 * Callback type for StageRunner progress reporting.
 * Called synchronously during stage execution — the orchestrator both queues
 * events for post-hoc generator yield AND fires onSubstepEvent for real-time delivery.
 */
export type OnProgressCallback = (event: SubstepEvent) => void;

// ============================================================================
// LLM CLIENT TYPES
// ============================================================================

/** Options for a single LLM API call. */
export interface LlmCallOptions {
  /** System prompt for the LLM call. */
  systemPrompt: string;
  /** Full user message / context for this stage. */
  userMessage: string;
  /** Model to use. Default: 'claude-opus-4-6' */
  model?: string;
  /** Soft target for max output tokens — dynamically adjusted to fit context window. */
  desiredMaxTokens?: number;
  /** Reasoning effort level. Default: 'max' (Opus 4.6 only). Overridable per-stage. */
  effort?: 'max' | 'high' | 'medium' | 'low';
  /** Optional streaming progress callback for UI updates. */
  onStreamEvent?: (event: StreamEvent) => void;
}

/** Result from a single LLM API call. */
export interface LlmCallResult {
  /** Extracted text content from response. */
  text: string;
  /** Summarized adaptive thinking content (if thinking occurred). */
  thinkingSummary?: string;
  /** Number of redacted thinking blocks (Anthropic safety system). 0 if none. */
  redactedThinkingBlocks: number;
  /** Token usage from the API response. */
  usage: TokenUsage;
  /** Stop reason from the API response. */
  stopReason: string;
  /** Actual model used for the response. */
  model: string;
}

// ============================================================================
// TOKEN & COST TYPES
// ============================================================================

/** Token usage from a single API call. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Zero-value token usage constant. */
export const ZERO_USAGE: Readonly<TokenUsage> = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
});

/** Per-stage cost record. */
export interface StageCostRecord {
  stageId: number;
  usage: TokenUsage;
  costUsd: number;
}

// ============================================================================
// STAGE CONFIGURATION — From agent config.json
// ============================================================================

/** Configuration for a single pipeline stage (from agent config.json). */
export interface StageConfig {
  /** Unique stage identifier (0-based). */
  id: number;
  /** Stage name — determines dispatch handler. */
  name: string;
  /** Human-readable description for UI/logging. */
  description?: string;
}

/** Configuration for a repair unit — stages that re-run on verification failure. */
export interface RepairUnitConfig {
  /** Ordered stage IDs in this repair unit. Last stage is the verification stage. */
  stages: number[];
  /** Maximum repair iterations before proceeding with best-effort output. */
  maxIterations: number;
  /** Field name in verification output that contains repair feedback. */
  feedbackField: string;
}

/** Control flow configuration from agent config.json. */
export interface ControlFlowConfig {
  /** Ordered pipeline stages. */
  stages: StageConfig[];
  /** Stage IDs that pause for user approval before continuing. */
  pauseAfterStages?: number[];
  /** Repair units — stages that re-run on verification failure. */
  repairUnits?: RepairUnitConfig[];
}

/** Output configuration from agent config.json. */
export interface OutputConfig {
  /** Template for output title. */
  titleTemplate?: string;
  /** File paths for output artifacts. */
  files?: {
    answerFile?: string;
  };
  /** Citation format settings. */
  citationFormat?: string;
  /** Source linking strategy. */
  sourceLinking?: string;
}

/** Orchestrator-specific configuration from agent config.json. */
export interface OrchestratorConfig {
  /** Whether the orchestrator is enabled for this agent. */
  enabled: boolean;
  /** Model to use for LLM calls. Default: 'claude-opus-4-6'. */
  model?: string;
  /** Thinking configuration. */
  thinking?: { type: 'adaptive' | 'enabled' | 'disabled' };
  /** Reasoning effort level. */
  effort?: 'max' | 'high' | 'medium' | 'low';
  /** Effort levels per depth mode. */
  depthModeEffort?: Record<string, string>;
  /** Context window size in tokens. Default: 200_000. */
  contextWindow?: number;
  /** Minimum output budget in tokens. Default: 4_096. */
  minOutputBudget?: number;
  /** Total budget in USD (soft limit — monitoring for Claude Max). */
  budgetUsd?: number;
  /** Per-stage desired output token budgets. */
  perStageDesiredTokens?: Record<number, number>;
  /** Whether to use BAML for type-safe prompts. */
  useBAML?: boolean;
  /** Whether to fall back to Zod when BAML fails. */
  bamlFallbackToZod?: boolean;
}

/** Full agent configuration relevant to the orchestrator. */
export interface AgentConfig {
  /** Agent slug identifier. */
  slug: string;
  /** Agent display name. */
  name: string;
  /** Control flow configuration — stages, pauses, repair units. */
  controlFlow: ControlFlowConfig;
  /** Output configuration. */
  output: OutputConfig;
  /** Orchestrator-specific configuration. */
  orchestrator?: OrchestratorConfig;
  /**
   * Absolute path to the agent's per-stage prompt files directory.
   * When set, StageRunner loads system prompts from `{promptsDir}/stage-{id}-{name}.md`.
   * When unset, falls back to built-in placeholder prompts.
   */
  promptsDir?: string;
  /** Follow-up configuration (optional — gated by agent config). Section 18. */
  followUp?: {
    enabled?: boolean;
    deltaRetrieval?: boolean;
  };
}

// ============================================================================
// NORMALIZED DATA TYPES — For pause-formatter data normalization
// ============================================================================

/** Normalized sub-query — common shape across BAML and Zod paths. */
export interface NormalizedSubQuery {
  /** Sub-query text (from BAML `.text` or Zod `.query`). */
  text: string;
  /** Role of this sub-query (Zod provides this; BAML defaults to 'unknown'). */
  role?: string;
  /** Target ISA standards for this sub-query. */
  standards: string[];
  /** Search strategy hint (BAML path only). */
  searchStrategy?: string;
}

/** Normalized query plan — common shape for Stage 0 output from either BAML or Zod path. */
export interface NormalizedQueryPlan {
  /** Original user query. */
  originalQuery: string;
  /** Clarity score (0.0–1.0). */
  clarityScore: number;
  /** Recommended action ('proceed' or 'clarify'). */
  recommendedAction?: string;
  /** Assumptions the LLM made about the query. */
  assumptions: string[];
  /** Alternative ways to interpret the query. */
  alternativeInterpretations: string[];
  /** Clarifying questions for the user (when clarity < 0.7). */
  clarificationQuestions: string[];
  /** Primary ISA standards relevant to the query. */
  primaryStandards: string[];
  /** Decomposed sub-queries. */
  subQueries: NormalizedSubQuery[];
  /** Depth mode (e.g., 'deep', 'quick', 'standard'). */
  depth: string;
  /** Scope classification (e.g., 'cross-standard', 'single-standard'). */
  scope: string;
  /** Whether authority sources were identified. */
  authoritySourcesPresent: boolean;
  /** Refined version of the query (BAML path). */
  refinedQuery?: string;
}

/** Normalized calibration — common shape for Stage 1 output from either BAML or Zod path. */
export interface NormalizedCalibration {
  /** Whether calibration was skipped (no web search results). */
  skipped: boolean;
  /** Execution status for Stage 1 web search behavior. */
  executionStatus?: 'user_skipped' | 'unavailable' | 'no_results' | 'calibrated';
  /** Calibration summary text. */
  summary: string;
  /** Sub-queries added during calibration. */
  queriesAdded: Array<{ query: string; role: string; reason: string }>;
  /** Sub-queries modified during calibration. */
  queriesModified: Array<{ original: string; modified: string; reason: string }>;
  /** Sub-queries demoted/removed during calibration. */
  queriesDemoted: Array<{ query: string; reason: string }>;
  /** Whether the scope was changed by calibration. */
  scopeChanged: boolean;
  /** Number of web sources used in calibration. */
  webSourceCount: number;
  /** Warnings from web search execution (e.g., missing BRAVE_API_KEY). */
  warnings?: string[];
  /** Whether the query plan was refined by calibration. */
  queryPlanRefined: boolean;
}

/** Deterministic telemetry for Stage 1 web search execution. */
export interface WebSearchExecutionTelemetry {
  /** Whether MCP bridge was available for Stage 1 calls. */
  mcpConnected: boolean;
  /** Query source used for Stage 1 search query extraction. */
  querySource: 'authority_sources' | 'queries' | 'sub_queries' | 'none';
  /** Number of candidate queries prepared from Stage 0 output. */
  queriesPlanned: number;
  /** Number of MCP calls attempted. */
  queriesAttempted: number;
  /** Number of MCP calls that succeeded (even if empty results). */
  queriesSucceeded: number;
  /** Number of web result items returned across all successful calls. */
  resultsCount: number;
  /** Aggregate warnings from execution and tool responses. */
  warnings: string[];
  /** High-level status for deterministic pause rendering and diagnostics. */
  status: 'user_skipped' | 'unavailable' | 'no_results' | 'calibrated';
}

// ============================================================================
// STAGE EXECUTION TYPES
// ============================================================================

/** Result from executing a single pipeline stage. */
export interface StageResult {
  /** Raw text output from the stage (LLM response or rendered output). */
  text: string;
  /** Short summary of what happened (for logging/UI). */
  summary: string;
  /** Token usage for this stage (zero for non-LLM stages). */
  usage: TokenUsage;
  /** Structured data output — stored in PipelineState for later stages. */
  data: Record<string, unknown>;
}

// ============================================================================
// PIPELINE STATE EVENTS — Immutable event log
// ============================================================================

/** Types of events recorded in the pipeline event log. */
export type StageEventType =
  | 'stage_started'
  | 'stage_completed'
  | 'stage_failed'
  | 'llm_call'
  | 'pause_requested'
  | 'pause_formatted'
  | 'resumed';

/** A single event in the pipeline event log. */
export interface StageEvent {
  /** Event type. */
  type: StageEventType;
  /** Stage this event relates to. */
  stage: number;
  /** Unix timestamp (ms) when this event occurred. */
  timestamp: number;
  /** Event-specific data. */
  data: Record<string, unknown>;
}

// ============================================================================
// ORCHESTRATOR EVENTS — Yielded to UI via AsyncGenerator
// ============================================================================

/** Exit reason from processOrchestratorEvents — signals why the generator ended (Section 16 G3). */
export type OrchestratorExitReason = 'paused' | 'completed' | 'error';

/** Events yielded by the orchestrator to the UI layer. */
export type OrchestratorEvent =
  | { type: 'orchestrator_stage_start'; stage: number; name: string }
  | { type: 'orchestrator_stage_complete'; stage: number; name: string; stageOutput?: Record<string, unknown> }
  | { type: 'orchestrator_substep'; stageId: number; substep: SubstepEvent }
  | { type: 'orchestrator_pause'; stage: number; message: string }
  | { type: 'orchestrator_repair_start'; iteration: number; maxIterations: number; scores?: Record<string, number> }
  | { type: 'orchestrator_budget_exceeded'; totalCost: number }
  | { type: 'orchestrator_complete'; totalCostUsd: number; stageCount: number }
  | { type: 'orchestrator_error'; stage: number; error: string }
  | { type: 'text'; text: string };

// ============================================================================
// ORCHESTRATOR OPTIONS
// ============================================================================

/** Options passed to AgentOrchestrator.run(). */
export interface OrchestratorOptions {
  /** Session ID for state persistence and event correlation. */
  sessionId: string;
  /** Path to session directory for state file persistence. */
  sessionPath: string;
  /** Auth token provider — called before each LLM API call. */
  getAuthToken: () => Promise<string>;
  /** Optional callback for streaming progress to UI. */
  onStreamEvent?: (event: StreamEvent) => void;
  /** Optional callback for structured diagnostic logging (threads ClaudeAgent.onDebug into orchestrator). */
  onDebug?: (message: string) => void;
  /** Session ID of a prior completed research run for follow-up context (Section 18, F12). */
  previousSessionId?: string;
  /**
   * Real-time substep callback — fires immediately when StageRunner emits progress,
   * bypassing the generator queue for instant UI delivery. The post-hoc generator
   * yield still runs for JSONL persistence; deduplication by toolUseId prevents doubles.
   */
  onSubstepEvent?: (event: SubstepEvent, stageId: number) => void;
}

// ============================================================================
// RETRIEVAL TYPES — Used by context builder and MCP bridge
// ============================================================================

/** A paragraph retrieved from the knowledge base. */
export interface RetrievalParagraph {
  /** Unique paragraph identifier. */
  id: string;
  /** Full text content of the paragraph. */
  text: string;
  /** Relevance score (0.0–1.0, higher is more relevant). */
  score: number;
  /** Source identifier (e.g., 'ISA 315', 'ISA 540'). */
  source: string;
}

/** Result from a web search call. */
export interface WebSearchResult {
  /** Search query used. */
  query: string;
  /** Search results. */
  results: Array<{
    title: string;
    url: string;
    snippet: string;
  }>;
  /** Optional warnings from MCP tool (e.g., missing BRAVE_API_KEY). */
  warnings?: string[];
  /** Number of queries actually executed by MCP tool (if provided). */
  queriesExecuted?: number;
}

// ============================================================================
// PORT INTERFACES — Implemented in later phases
// ============================================================================

/**
 * Port interface for MCP tool calls — implemented in Phase 4.
 * Provides programmatic access to MCP servers (KB search, web search, citation verify).
 * The orchestrator calls MCP tools directly via this interface, NOT via LLM tool_use.
 */
export interface McpBridge {
  /** Run a web search query via the web search MCP server. */
  webSearch(query: string): Promise<WebSearchResult>;
  /** Search the knowledge base via the ISA KB MCP server. */
  kbSearch(query: string, options?: { maxResults?: number }): Promise<RetrievalParagraph[]>;
  /** Verify a citation against source material via the ISA KB MCP server. */
  citationVerify(params: Record<string, unknown>): Promise<Record<string, unknown>>;
}

/**
 * Port interface for cost tracking — implemented in Phase 5.
 * Records per-stage token usage and enforces budget limits.
 * For Claude Max subscriptions, budget is informational (no per-token cost).
 */
export interface CostTrackerPort {
  /** Record token usage for a completed stage. */
  recordStage(stageId: number, usage: TokenUsage): void;
  /** Check if the pipeline is still within budget. */
  withinBudget(): boolean;
  /** Total estimated cost in USD so far. */
  readonly totalCostUsd: number;
}

/**
 * No-op cost tracker — always within budget.
 * Used before Phase 5 CostTracker is implemented.
 * Claude Max subscription means no per-token cost, so this is safe as default.
 */
export function createNullCostTracker(): CostTrackerPort {
  return {
    recordStage: () => { /* no-op — Claude Max has no per-token cost */ },
    withinBudget: () => true,
    get totalCostUsd() { return 0; },
  };
}

// ============================================================================
// FOLLOW-UP CONTEXT — Prior research data for follow-up queries (Section 18)
// ============================================================================

/** Prior section from a previous research answer, parsed for follow-up context. */
export interface FollowUpPriorSection {
  sectionNum: number;
  sectionId: string;       // e.g. "P1", "P2"
  heading: string;
  excerpt: string;          // Truncated to ~500 chars
}

/** Context loaded from a prior research session for follow-up queries. */
export interface FollowUpContext {
  /** Follow-up number (1 = first follow-up, 2 = second, etc.). */
  followupNumber: number;
  /** Full answer text from the prior session. */
  priorAnswerText: string;
  /** Original query from the prior session. */
  priorQuery: string;
  /** Sub-queries from the prior session (max 5 for context hint). */
  priorSubQueries: Array<{ text: string; role: string; standards: string[] }>;
  /** Paragraph IDs from prior citations — used for retrieval delta filtering. */
  priorParagraphIds: string[];
  /** Parsed sections from the prior answer with P1/P2 IDs. */
  priorSections: FollowUpPriorSection[];
}
