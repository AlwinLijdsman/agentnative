/**
 * Agent Types
 *
 * Type definitions for workspace agents.
 * Agents are stateful multi-stage workflows with deterministic control flow enforcement.
 */

// ============================================================
// Agent Metadata (from AGENT.md YAML frontmatter)
// ============================================================

/**
 * Source binding — declares which MCP source an agent requires
 */
export interface AgentSourceBinding {
  /** Source slug (must exist in workspace) */
  slug: string;
  /** Whether the agent cannot function without this source */
  required: boolean;
  /** Specific tools this agent uses from the source */
  tools?: string[];
}

/**
 * Agent metadata from AGENT.md YAML frontmatter.
 * Extends the skill metadata pattern with agent-specific fields.
 */
export interface AgentMetadata {
  /** Display name for the agent */
  name: string;
  /** Brief description shown in agent list */
  description: string;
  /** Agent type identifier (e.g. "deep-research") */
  type?: string;
  /** MCP sources this agent depends on */
  sources?: AgentSourceBinding[];
  /**
   * Optional icon - emoji or URL only.
   * - Emoji: rendered directly in UI (e.g., "🔍")
   * - URL: auto-downloaded to icon.{ext} file
   */
  icon?: string;
}

// ============================================================
// Agent Configuration (from config.json)
// ============================================================

/**
 * A single stage in the agent pipeline
 */
export interface StageDefinition {
  /** Sequential stage ID (starts at 0) */
  id: number;
  /** Machine-readable stage name */
  name: string;
  /** Human-readable description */
  description: string;
  /** Optional user-facing instruction used when this stage triggers a pause */
  pauseInstructions?: string;
}

/**
 * Repair unit — a pair of stages that can iterate to improve quality.
 * e.g., stages [2, 3] means synthesize + verify loop.
 */
export interface RepairUnitConfig {
  /** Pair of stage IDs that form the repair loop */
  stages: [number, number];
  /** Maximum iterations before forced exit */
  maxIterations: number;
  /** Field name in stage data that carries repair feedback */
  feedbackField: string;
}

/**
 * Web search configuration for query calibration
 */
export interface WebSearchConfig {
  /** Whether web search is enabled */
  enabled: boolean;
  /** Search provider */
  provider: 'brave';
  /** Maximum queries per invocation */
  maxQueries?: number;
  /** Preferred domains for relevance scoring */
  preferredDomains?: string[];
}

/**
 * Control flow configuration — determines pipeline execution behavior
 */
export interface AgentControlFlowConfig {
  /** Ordered stage definitions */
  stages: StageDefinition[];
  /** Repair unit definitions */
  repairUnits: RepairUnitConfig[];
  /** Stages that require human approval before proceeding */
  pauseAfterStages: number[];
  /** Whether to auto-advance through non-pause stages */
  autoAdvance: boolean;
  /** Web search configuration */
  webSearch?: WebSearchConfig;
}

/**
 * Depth mode preset — controls resource usage per research run
 */
export interface DepthModeConfig {
  maxSubQueries: number;
  maxParagraphsPerQuery: number;
  maxRepairIterations: number;
  contextTokenBudget: number;
  enableWebSearch: boolean;
}

/**
 * Verification threshold for a single axis
 */
export interface VerificationThreshold {
  threshold: number;
}

/**
 * Contradiction threshold
 */
export interface ContradictionThreshold {
  maxUnresolved: number;
}

/**
 * Verification configuration — thresholds for 4-axis verification
 */
export interface VerificationConfig {
  entityGrounding: VerificationThreshold;
  relationPreservation: VerificationThreshold;
  citationAccuracy: VerificationThreshold;
  contradictions: ContradictionThreshold;
}

/**
 * Logging configuration
 */
export interface AgentLoggingConfig {
  /** Log verbosity level */
  level: 'quiet' | 'normal' | 'verbose';
  /** Whether to persist per-stage intermediate files */
  persistIntermediates: boolean;
  /** Whether to track tool call costs */
  costTracking: boolean;
}

/**
 * Follow-up configuration
 */
export interface FollowUpConfig {
  /** Whether follow-up queries are enabled */
  enabled: boolean;
  /** Whether to use delta retrieval (only fetch new paragraphs) */
  deltaRetrieval: boolean;
  /** Maximum accumulated sections across follow-ups */
  maxAccumulatedSections: number;
}

/**
 * Output configuration
 */
export interface AgentOutputConfig {
  /** Whether to use progressive disclosure in output */
  progressiveDisclosure: boolean;
  /** Citation format template */
  citationFormat: string;
}

/**
 * Debug overrides — reduce scope for development/testing
 */
export interface DebugOverrides {
  /** Whether debug mode is active */
  enabled: boolean;
  /** Maximum paragraphs to retrieve */
  maxParagraphs?: number;
  /** Maximum tool calls allowed */
  maxToolCalls?: number;
  /** Whether to use fixture data instead of real sources */
  useFixtures?: boolean;
  /** Whether to skip verification stage */
  skipVerification?: boolean;
  /** Whether to skip web search */
  skipWebSearch?: boolean;
  /** Whether to force quick depth mode */
  forceQuickMode?: boolean;
}

/**
 * Full agent configuration (from config.json)
 */
export interface AgentConfig {
  /** Control flow pipeline definition */
  controlFlow: AgentControlFlowConfig;
  /** Depth mode presets */
  depthModes: Record<string, DepthModeConfig>;
  /** Verification thresholds */
  verification: VerificationConfig;
  /** Logging configuration */
  logging: AgentLoggingConfig;
  /** Follow-up query configuration */
  followUp: FollowUpConfig;
  /** Output formatting configuration */
  output: AgentOutputConfig;
  /** Debug overrides (optional) */
  debug?: DebugOverrides;
}

// ============================================================
// Loaded Agent
// ============================================================

/** Source of a loaded agent */
export type AgentSource = 'global' | 'workspace' | 'project';

/**
 * A loaded agent with parsed content and configuration
 */
export interface LoadedAgent {
  /** Directory name (slug) */
  slug: string;
  /** Parsed metadata from YAML frontmatter */
  metadata: AgentMetadata;
  /** Full AGENT.md content (without frontmatter) */
  content: string;
  /** Parsed configuration from config.json */
  config: AgentConfig;
  /** Absolute path to icon file if exists */
  iconPath?: string;
  /** Absolute path to agent directory */
  path: string;
  /** Where this agent was loaded from */
  source: AgentSource;
}

// ============================================================
// Agent Run State
// ============================================================

/**
 * State of an active agent run — tracks pipeline progress
 */
export interface AgentRunState {
  /** Unique run identifier */
  runId: string;
  /** ISO timestamp of run start */
  startedAt: string;
  /** ISO timestamp of last event (for staleness detection) */
  lastEventAt: string;
  /** Currently executing stage ID */
  currentStage: number;
  /** Completed stage IDs */
  completedStages: number[];
  /** Data returned by each completed stage */
  stageOutputs: Record<number, unknown>;
  /** Current repair iteration (0 = first attempt) */
  repairIteration: number;
  /** Active repair unit stage pair, or null if not in repair loop */
  repairUnit: [number, number] | null;
  /** Total tool calls made in this run */
  toolCallCount: number;
  /** Cumulative tool call duration per tool name (ms) */
  toolCallDurations: Record<string, number>;
  /** Selected depth mode for this run */
  depthMode: string;
  /** Follow-up number (0 = initial query) */
  followupNumber: number;
}

/**
 * Accumulated state across runs — persisted in state.json.
 * Uses replace-all semantics: `Object.assign(currentState, data)` replaces
 * top-level keys rather than deep merging, because Record<string, unknown>
 * cannot reliably deep merge (nested arrays vs objects are ambiguous).
 */
export type AgentAccumulatedState = Record<string, unknown>;

// ============================================================
// Agent Events
// ============================================================

/**
 * Discriminated union of all agent event types
 */
export type AgentEventType =
  | 'agent_run_started'
  | 'stage_started'
  | 'stage_completed'
  | 'repair_iteration'
  | 'repair_unit_started'
  | 'repair_unit_completed'
  | 'verification_result'
  | 'tool_call'
  | 'tool_result'
  | 'error'
  | 'cost_update'
  | 'agent_run_completed'
  | 'followup_context_loaded'
  | 'stage_gate_pause'
  | 'web_search_result';

/**
 * An agent event — appended to agent-events.jsonl
 */
export interface AgentEvent {
  /** Event type discriminator */
  type: AgentEventType;
  /** ISO timestamp */
  timestamp: string;
  /** Run this event belongs to */
  runId: string;
  /** Event-specific data */
  data: Record<string, unknown>;
}

// ============================================================
// Error Classification
// ============================================================

/**
 * Error category determined by deterministic regex matching
 */
export type ErrorCategory = 'transient' | 'auth' | 'resource' | 'config' | 'unknown';

/**
 * Result of classifying an error — includes recovery guidance
 */
export interface ClassifiedError {
  /** Determined error category */
  category: ErrorCategory;
  /** Whether the error is potentially recoverable */
  isRecoverable: boolean;
  /** Suggested recovery actions */
  suggestedActions: string[];
  /** Diagnostic message */
  diagnostic: string;
  /** Seconds to wait before retrying (for transient errors) */
  retryAfterSeconds?: number;
}

// ============================================================
// Agent Run Summary & Detail (for UI)
// ============================================================

/** Verification status across all axes */
export type VerificationStatus = 'pass' | 'partial' | 'fail' | 'pending';

/**
 * Lightweight run summary for list views
 */
export interface AgentRunSummary {
  /** Unique run identifier */
  runId: string;
  /** Original user query */
  query: string;
  /** ISO timestamp of run start */
  startedAt: string;
  /** ISO timestamp of completion (if finished) */
  completedAt?: string;
  /** Depth mode used */
  depthMode: string;
  /** Overall verification status */
  verificationStatus: VerificationStatus;
  /** Total tool calls made */
  toolCallCount: number;
}

/**
 * Full run detail for the run detail page
 */
export interface AgentRunDetail extends AgentRunSummary {
  /** Stage-by-stage progress */
  stages: Array<{
    id: number;
    name: string;
    status: 'completed' | 'running' | 'pending' | 'skipped';
    startedAt?: string;
    completedAt?: string;
    data?: Record<string, unknown>;
  }>;
  /** Full event log */
  events: AgentEvent[];
  /** Run metadata (costs, timing, scores) */
  metadata: Record<string, unknown>;
  /** Evidence artifacts */
  evidence: {
    citations?: Record<string, unknown>;
    verification?: Record<string, unknown>;
    queryPlan?: Record<string, unknown>;
    researchTrail?: Record<string, unknown>;
    intermediates?: Record<string, Record<string, unknown>>;
  };
}
