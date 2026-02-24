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
  | 'mcp_tool_call'
  | 'pause_requested'
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

/** Events yielded by the orchestrator to the UI layer. */
export type OrchestratorEvent =
  | { type: 'orchestrator_stage_start'; stage: number; name: string }
  | { type: 'orchestrator_stage_complete'; stage: number; name: string; stageOutput?: Record<string, unknown> }
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
