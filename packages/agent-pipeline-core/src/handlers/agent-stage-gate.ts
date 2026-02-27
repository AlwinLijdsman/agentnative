/**
 * Agent Stage Gate Handler
 *
 * Central control flow enforcer for multi-stage agent workflows.
 * Validates stage transitions, manages repair loops, enforces
 * pause gates, tracks tool calls, and appends structured events.
 *
 * Pause enforcement is model-driven plus state-locked:
 * when a completed stage is in `pauseAfterStages`, the handler calls
 * `ctx.callbacks.onAgentStagePause()` to lock pause state and notify UI,
 * while returning `allowed: false` so the model summarizes and stops.
 *
 * Types are defined inline because agent-pipeline-core has no dependency
 * on @craft-agent/shared. The agent config is loaded directly from disk.
 */

import { join } from 'node:path';
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';
import { injectSourceBlocks } from './agent-render-output/renderer.ts';

// ============================================================
// Types
// ============================================================

export interface AgentStageGateArgs {
  agentSlug: string;
  action:
    | 'start'
    | 'complete'
    | 'repair'
    | 'start_repair_unit'
    | 'end_repair_unit'
    | 'status'
    | 'reset'
    | 'resume';
  stage?: number;
  data?: Record<string, unknown>;
}

interface AgentStageGateResult {
  allowed: boolean;
  currentStage: number;
  completedStages: number[];
  repairIteration: number;
  maxRepairIterations: number;
  repairUnitActive: boolean;
  reason?: string;
  runId: string;
  pauseRequired?: boolean;
  /** Present when an existing run is stale (>300s since last event). Ask user: resume or reset? */
  staleRun?: { runId: string; lastEventAt: string; ageSeconds: number };
  /** Present when a non-stale active run blocks starting a new one. Use action=reset to clear. */
  activeRun?: { runId: string; lastEventAt: string; ageSeconds: number };
  /** Present when stage output failed schema validation (warnings, not errors). */
  validationWarnings?: string[];
  /** Present when resuming — indicates the next stage to start. */
  nextStage?: number;
  /** Present when resume-abort was called — pipeline is terminated. */
  aborted?: boolean;
  /** Present when resume-modify was called — modifications from user. */
  modifications?: Record<string, unknown>;
  /** Present when error-triggered pause occurs — the error category. */
  errorClassification?: Record<string, unknown>;
  /** Present in status when the pipeline is paused at a stage. */
  pausedAtStage?: number;
}

/**
 * Minimal subset of AgentConfig needed for stage gate logic.
 * Avoids a dependency on @craft-agent/shared.
 */
interface StageGateConfig {
  controlFlow: {
    stages: Array<{ id: number; name: string; description: string; pauseInstructions?: string }>;
    repairUnits: Array<{
      stages: [number, number];
      maxIterations: number;
      feedbackField: string;
    }>;
    pauseAfterStages: number[];
    autoAdvance: boolean;
    /** Optional JSON schemas for validating stage outputs. Key is stage ID as string. */
    stageOutputSchemas?: Record<string, StageOutputSchema>;
    /** Error categories that trigger automatic pause for human decision. */
    pauseOnErrors?: string[];
  };
}

// ============================================================
// Stage Output Schema Validation
// ============================================================

/**
 * Lightweight JSON schema for validating stage outputs.
 * Intentionally simple — no external deps, ~80 lines.
 *
 * Enforcement modes:
 * - "warn" (default): validation emits warnings but never blocks completion.
 * - "block": validation failures return allowed:false with a repair message,
 *   forcing the agent to fix the output before the stage can complete.
 */
interface StageOutputSchemaProperty {
  type?: 'string' | 'number' | 'boolean' | 'array' | 'object';
  enum?: unknown[];
  minItems?: number;
  required?: string[];
  properties?: Record<string, StageOutputSchemaProperty>;
}

interface StageOutputSchema {
  required?: string[];
  properties?: Record<string, StageOutputSchemaProperty>;
  /** When "block", validation failures prevent stage completion. Default: "warn". */
  enforcement?: 'warn' | 'block';
  /** Message returned to the agent when enforcement is "block" and validation fails. */
  blockMessage?: string;
}

interface ValidationResult {
  valid: boolean;
  warnings: string[];
}

function validateValue(
  value: unknown,
  schema: StageOutputSchemaProperty,
  path: string,
): string[] {
  const warnings: string[] = [];

  // Type check
  if (schema.type) {
    const actualType = Array.isArray(value) ? 'array' : typeof value;
    if (value !== undefined && value !== null && actualType !== schema.type) {
      warnings.push(`${path}: expected type '${schema.type}', got '${actualType}'`);
    }
  }

  // Enum check
  if (schema.enum && value !== undefined) {
    if (!schema.enum.includes(value)) {
      warnings.push(`${path}: value '${String(value)}' not in enum [${schema.enum.map(String).join(', ')}]`);
    }
  }

  // Array minItems check
  if (schema.minItems !== undefined && Array.isArray(value)) {
    if (value.length < schema.minItems) {
      warnings.push(`${path}: array has ${value.length} items, minimum is ${schema.minItems}`);
    }
  }

  // Nested object validation
  if (schema.properties && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;

    // Check required fields
    if (schema.required) {
      for (const req of schema.required) {
        if (!(req in obj)) {
          warnings.push(`${path}.${req}: required field missing`);
        }
      }
    }

    // Validate known properties
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (key in obj) {
        warnings.push(...validateValue(obj[key], propSchema, `${path}.${key}`));
      }
    }
  }

  return warnings;
}

function validateStageOutput(
  data: Record<string, unknown>,
  schema: StageOutputSchema,
): ValidationResult {
  const warnings: string[] = [];

  // Check top-level required fields
  if (schema.required) {
    for (const req of schema.required) {
      if (!(req in data)) {
        warnings.push(`${req}: required field missing`);
      }
    }
  }

  // Validate known properties
  if (schema.properties) {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (key in data) {
        warnings.push(...validateValue(data[key], propSchema, key));
      }
    }
  }

  return { valid: warnings.length === 0, warnings };
}

/** Run state persisted in current-run-state.json */
interface RunState {
  runId: string;
  startedAt: string;
  lastEventAt: string;
  currentStage: number;
  completedStages: number[];
  stageOutputs: Record<number, unknown>;
  repairIteration: number;
  repairUnit: [number, number] | null;
  toolCallCount: number;
  toolCallDurations: Record<string, number>;
  depthMode: string;
  followupNumber: number;
  /** Set when a pause is triggered — tracks which stage is paused. */
  pausedAtStage?: number;
  /** Set when user resumes with 'modify' — holds modifications for the next stage. */
  pendingModifications?: Record<string, unknown>;
}

/** Event appended to agent-events.jsonl */
interface AgentEvent {
  type: string;
  timestamp: string;
  runId: string;
  data: Record<string, unknown>;
}

// ============================================================
// Constants
// ============================================================

/** Runs older than this are considered stale */
const STALE_RUN_THRESHOLD_SECONDS = 300;

// ============================================================
// Path Helpers
// ============================================================

function getAgentDataDir(ctx: SessionToolContext, agentSlug: string): string {
  return join(ctx.workspacePath, 'sessions', ctx.sessionId, 'data', 'agents', agentSlug);
}

function ensureDir(ctx: SessionToolContext, dirPath: string): void {
  ctx.fs.mkdir(dirPath, { recursive: true });
}

// ============================================================
// File I/O Utilities
// ============================================================

function readRunState(ctx: SessionToolContext, agentSlug: string): RunState | null {
  const stateFile = join(getAgentDataDir(ctx, agentSlug), 'current-run-state.json');
  if (!ctx.fs.exists(stateFile)) {
    return null;
  }
  try {
    return JSON.parse(ctx.fs.readFile(stateFile));
  } catch (err) {
    console.warn(`[agent-stage-gate] Failed to parse run state for '${agentSlug}':`, err);
    return null;
  }
}

/**
 * Atomic write: write to .tmp then rename, preventing partial reads.
 */
function writeRunState(ctx: SessionToolContext, agentSlug: string, state: RunState): void {
  const dataDir = getAgentDataDir(ctx, agentSlug);
  ensureDir(ctx, dataDir);
  const stateFile = join(dataDir, 'current-run-state.json');
  const tmpFile = stateFile + '.tmp';
  ctx.fs.writeFile(tmpFile, JSON.stringify(state, null, 2));
  ctx.fs.rename(tmpFile, stateFile);
}

function appendEvent(ctx: SessionToolContext, agentSlug: string, event: AgentEvent): void {
  const dataDir = getAgentDataDir(ctx, agentSlug);
  ensureDir(ctx, dataDir);
  const eventsFile = join(dataDir, 'agent-events.jsonl');
  ctx.fs.appendFile(eventsFile, JSON.stringify(event) + '\n');
}

/**
 * Scan runs/ directory and return the next zero-padded run ID.
 */
function nextRunId(ctx: SessionToolContext, agentSlug: string): string {
  const runsDir = join(getAgentDataDir(ctx, agentSlug), 'runs');
  ensureDir(ctx, runsDir);

  let maxNum = 0;
  try {
    const entries = ctx.fs.readdir(runsDir);
    for (const entry of entries) {
      const match = entry.match(/^run-(\d+)$/);
      if (match) {
        const num = parseInt(match[1]!, 10);
        if (num > maxNum) maxNum = num;
      }
    }
  } catch (err) {
    // Empty or non-existent — start at 1
    console.warn(`[agent-stage-gate] Could not read runs dir for '${agentSlug}':`, err);
  }

  return `run-${String(maxNum + 1).padStart(3, '0')}`;
}

/**
 * Load the control flow section of an agent's config.json from disk.
 */
function loadStageGateConfig(ctx: SessionToolContext, agentSlug: string): StageGateConfig | null {
  const configPath = join(ctx.agentsPath, agentSlug, 'config.json');
  if (!ctx.fs.exists(configPath)) {
    return null;
  }
  try {
    const raw = JSON.parse(ctx.fs.readFile(configPath));
    if (!raw.controlFlow) return null;
    return raw as StageGateConfig;
  } catch (err) {
    console.warn(`[agent-stage-gate] Failed to parse config for '${agentSlug}':`, err);
    return null;
  }
}

function nowISO(): string {
  return new Date().toISOString();
}

// ============================================================
// Result Builder
// ============================================================

function makeResult(
  state: RunState,
  config: StageGateConfig,
  overrides: Partial<AgentStageGateResult> = {},
): AgentStageGateResult {
  let maxRepairIterations = 0;
  if (state.repairUnit) {
    const ru = config.controlFlow.repairUnits.find(
      (r) => r.stages[0] === state.repairUnit![0] && r.stages[1] === state.repairUnit![1],
    );
    maxRepairIterations = ru?.maxIterations ?? 0;
  }

  return {
    allowed: true,
    currentStage: state.currentStage,
    completedStages: state.completedStages,
    repairIteration: state.repairIteration,
    maxRepairIterations,
    repairUnitActive: state.repairUnit !== null,
    runId: state.runId,
    ...(state.pausedAtStage !== undefined ? { pausedAtStage: state.pausedAtStage } : {}),
    ...overrides,
  };
}

/** Shorthand for "no run" error results */
function noRunResult(reason: string): AgentStageGateResult {
  return {
    allowed: false,
    currentStage: -1,
    completedStages: [],
    repairIteration: 0,
    maxRepairIterations: 0,
    repairUnitActive: false,
    reason,
    runId: '',
  };
}

// ============================================================
// Inline Error Classification
// ============================================================
// Duplicated from @craft-agent/shared/agents/error-classifier.ts
// because agent-pipeline-core cannot depend on @craft-agent/shared.

const TRANSIENT_PATTERNS =
  /timeout|timed?\s*out|rate.?limit|too many requests|retry|503|overloaded|throttl/i;
const AUTH_PATTERNS =
  /unauthorized|forbidden|invalid.?key|expired.?token|auth|credential|api.?key/i;
const CONFIG_PATTERNS =
  /invalid.?config|missing.?field|schema|validation|not.?found.?in.?config/i;
const RESOURCE_PATTERNS =
  /not.?found|404|no.?such|does.?not.?exist|empty.?result|no.?data/i;

function classifyErrorInline(error: string): Record<string, unknown> {
  if (TRANSIENT_PATTERNS.test(error)) {
    return {
      category: 'transient',
      isRecoverable: true,
      diagnostic: 'Transient error — may resolve on retry.',
      suggestedActions: ['Wait and retry'],
      retryAfterSeconds: 5,
    };
  }
  if (AUTH_PATTERNS.test(error)) {
    return {
      category: 'auth',
      isRecoverable: false,
      diagnostic: 'Authentication error.',
      suggestedActions: ['Check API keys', 'Refresh credentials'],
    };
  }
  if (CONFIG_PATTERNS.test(error)) {
    return {
      category: 'config',
      isRecoverable: false,
      diagnostic: 'Configuration error.',
      suggestedActions: ['Check agent config'],
    };
  }
  if (RESOURCE_PATTERNS.test(error)) {
    return {
      category: 'resource',
      isRecoverable: false,
      diagnostic: 'Resource not found.',
      suggestedActions: ['Verify resource exists'],
    };
  }
  return {
    category: 'unknown',
    isRecoverable: false,
    diagnostic: 'Unknown error.',
    suggestedActions: ['Investigate error'],
  };
}

// ============================================================
// Action Handlers
// ============================================================

function handleStart(
  ctx: SessionToolContext,
  args: AgentStageGateArgs,
  config: StageGateConfig,
): AgentStageGateResult {
  const stage = args.stage ?? 0;

  if (stage === 0) {
    // Starting a new run — check for paused or stale existing run
    const existing = readRunState(ctx, args.agentSlug);
    if (existing) {
      // Paused runs are NEVER overwritten — must resume(abort) or reset(force) first
      if (existing.pausedAtStage !== undefined) {
        return makeResult(existing, config, {
          allowed: false,
          reason:
            `Active run ${existing.runId} is paused at stage ${existing.pausedAtStage}. ` +
            `Resume (proceed/abort) or reset with force:true before starting a new run.`,
        });
      }

      const ageSeconds = (Date.now() - new Date(existing.lastEventAt).getTime()) / 1000;
      if (ageSeconds < STALE_RUN_THRESHOLD_SECONDS) {
        // Non-stale active run — block new run creation
        return makeResult(existing, config, {
          allowed: false,
          reason:
            `Active run ${existing.runId} exists (${Math.round(ageSeconds)}s old). ` +
            `Use action=reset to clear, or wait ${STALE_RUN_THRESHOLD_SECONDS}s.`,
          activeRun: {
            runId: existing.runId,
            lastEventAt: existing.lastEventAt,
            ageSeconds: Math.round(ageSeconds),
          },
        });
      }
    }

    // Create new run
    const runId = nextRunId(ctx, args.agentSlug);
    const runDir = join(getAgentDataDir(ctx, args.agentSlug), 'runs', runId);
    ensureDir(ctx, runDir);

    const now = nowISO();
    const state: RunState = {
      runId,
      startedAt: now,
      lastEventAt: now,
      currentStage: 0,
      completedStages: [],
      stageOutputs: {},
      repairIteration: 0,
      repairUnit: null,
      toolCallCount: 0,
      toolCallDurations: {},
      depthMode: (args.data?.depthMode as string) ?? 'standard',
      followupNumber: (args.data?.followupNumber as number) ?? 0,
    };

    writeRunState(ctx, args.agentSlug, state);
    appendEvent(ctx, args.agentSlug, {
      type: 'agent_run_started',
      timestamp: now,
      runId,
      data: {
        stage: 0,
        depthMode: state.depthMode,
        followupNumber: state.followupNumber,
      },
    });

    // Emit real-time event for renderer
    ctx.callbacks.onAgentEvent?.({
      type: 'agent_stage_started',
      agentSlug: args.agentSlug,
      runId,
      data: { stage: 0, stageName: config.controlFlow.stages[0]?.name ?? 'init' },
    });

    const result = makeResult(state, config);

    // Include stale run warning if we superseded one
    if (existing) {
      const ageSeconds = (Date.now() - new Date(existing.lastEventAt).getTime()) / 1000;
      result.staleRun = {
        runId: existing.runId,
        lastEventAt: existing.lastEventAt,
        ageSeconds: Math.round(ageSeconds),
      };
    }

    return result;
  }

  // Starting stage N > 0
  const state = readRunState(ctx, args.agentSlug);
  if (!state) {
    return noRunResult('No active run. Call action=start with stage=0 first.');
  }

  // Block starting any stage while pipeline is paused
  if (state.pausedAtStage !== undefined) {
    return makeResult(state, config, {
      allowed: false,
      reason: `Pipeline is paused at stage ${state.pausedAtStage}. Cannot start stage ${stage} until resumed.`,
    });
  }

  // Validate stage exists in config
  const stageDef = config.controlFlow.stages.find((s) => s.id === stage);
  if (!stageDef) {
    return makeResult(state, config, {
      allowed: false,
      reason:
        `Stage ${stage} not found in agent config. ` +
        `Valid stages: ${config.controlFlow.stages.map((s) => s.id).join(', ')}.`,
    });
  }

  // Validate prerequisite: stage N-1 must be completed
  // Exception: inside a repair unit, the first stage of the unit can restart
  if (stage > 0 && !state.completedStages.includes(stage - 1)) {
    const isRepairRestart =
      state.repairUnit !== null && state.repairUnit[0] === stage;
    if (!isRepairRestart) {
      return makeResult(state, config, {
        allowed: false,
        reason: `Stage ${stage - 1} must be completed before starting stage ${stage}.`,
      });
    }
  }

  state.currentStage = stage;
  state.lastEventAt = nowISO();

  // Consume pending modifications (set by resume-modify) and include in result
  const pendingMods = state.pendingModifications;
  if (pendingMods) {
    state.pendingModifications = undefined;
  }

  writeRunState(ctx, args.agentSlug, state);

  appendEvent(ctx, args.agentSlug, {
    type: 'stage_started',
    timestamp: state.lastEventAt,
    runId: state.runId,
    data: { stage, name: stageDef.name },
  });

  // Emit real-time event for renderer
  ctx.callbacks.onAgentEvent?.({
    type: 'agent_stage_started',
    agentSlug: args.agentSlug,
    runId: state.runId,
    data: { stage, stageName: stageDef.name },
  });

  return makeResult(state, config, {
    ...(pendingMods ? { modifications: pendingMods } : {}),
  });
}

function handleComplete(
  ctx: SessionToolContext,
  args: AgentStageGateArgs,
  config: StageGateConfig,
): AgentStageGateResult {
  const stage = args.stage;
  if (stage === undefined) {
    return noRunResult('stage is required for complete action.');
  }

  const state = readRunState(ctx, args.agentSlug);
  if (!state) {
    return noRunResult('No active run.');
  }

  // Block completing any stage while pipeline is paused
  if (state.pausedAtStage !== undefined) {
    return makeResult(state, config, {
      allowed: false,
      reason: `Pipeline is paused at stage ${state.pausedAtStage}. Cannot complete stage ${stage} until resumed.`,
    });
  }

  if (state.currentStage !== stage) {
    return makeResult(state, config, {
      allowed: false,
      reason: `Cannot complete stage ${stage} — current stage is ${state.currentStage}.`,
    });
  }

  const now = nowISO();

  // Mark stage as completed
  if (!state.completedStages.includes(stage)) {
    state.completedStages.push(stage);
  }

  // Store stage output
  if (args.data) {
    state.stageOutputs[stage] = args.data;
  }

  // Track tool calls
  if (args.data?.toolCalls && Array.isArray(args.data.toolCalls)) {
    for (const tc of args.data.toolCalls as Array<{
      tool: string;
      durationMs: number;
    }>) {
      state.toolCallCount++;
      state.toolCallDurations[tc.tool] =
        (state.toolCallDurations[tc.tool] ?? 0) + tc.durationMs;
    }
  }

  state.lastEventAt = now;

  // Stage output schema validation
  // Enforcement modes: "warn" (default) logs warnings; "block" rejects completion.
  let validationWarnings: string[] | undefined;
  if (args.data && config.controlFlow.stageOutputSchemas) {
    const schema = config.controlFlow.stageOutputSchemas[String(stage)];
    if (schema) {
      const validation = validateStageOutput(args.data, schema);
      if (!validation.valid) {
        validationWarnings = validation.warnings;
        const enforcement = schema.enforcement ?? 'warn';

        appendEvent(ctx, args.agentSlug, {
          type: enforcement === 'block' ? 'stage_output_validation_blocked' : 'stage_output_validation_warning',
          timestamp: now,
          runId: state.runId,
          data: { stage, warnings: validation.warnings, enforcement },
        });

        // Block completion when enforcement is "block"
        if (enforcement === 'block') {
          // Undo the stage completion — remove from completedStages
          state.completedStages = state.completedStages.filter((s) => s !== stage);
          state.lastEventAt = now;
          writeRunState(ctx, args.agentSlug, state);

          const repairMessage = schema.blockMessage
            ?? `Stage ${stage} output validation failed. Fix the following issues and re-complete the stage: ${validation.warnings.join('; ')}`;

          return makeResult(state, config, {
            allowed: false,
            reason: repairMessage,
            validationWarnings,
          });
        }
      }
    }
  }

  // Post-validation: verify Stage 5 output file actually exists on disk.
  // Schema validation only checks field presence/type — this ensures the agent
  // actually wrote the file before claiming answer_delivered: true.
  if (stage === 5 && args.data?.output_file_path && typeof args.data.output_file_path === 'string') {
    const rawPath = args.data.output_file_path as string;
    // Strip leading ./ for consistent path resolution
    const fileName = rawPath.replace(/^\.\//, '');
    // Detect absolute paths: Windows drive letter (C:\) or Unix root (/)
    const isAbsolute = /^[a-zA-Z]:[\\/]/.test(rawPath) || rawPath.startsWith('/');

    // Build candidate paths based on whether the path is absolute or relative.
    // Absolute paths are checked directly first (agent in safe mode writes to plans
    // folder and may provide the full path). Relative paths are resolved against
    // common write targets.
    const candidatePaths: string[] = [];
    if (isAbsolute) {
      // Absolute path — check it directly first
      candidatePaths.push(rawPath);
    }
    // Always check plans folder, session root, and process CWD with the basename
    const baseName = rawPath.replace(/^.*[\\/]/, ''); // Extract filename from any path
    candidatePaths.push(
      join(ctx.plansFolderPath, baseName),
      join(ctx.workspacePath, 'sessions', ctx.sessionId, baseName),
      join(process.cwd(), baseName),
    );
    // For relative paths (not absolute, not starting with ./), also try the raw path
    if (!isAbsolute && fileName !== baseName) {
      candidatePaths.push(join(ctx.plansFolderPath, fileName));
    }

    const foundPath = candidatePaths.find((p) => ctx.fs.exists(p));

    if (!foundPath) {
      // File doesn't exist — block completion
      state.completedStages = state.completedStages.filter((s) => s !== stage);
      state.lastEventAt = now;
      writeRunState(ctx, args.agentSlug, state);

      appendEvent(ctx, args.agentSlug, {
        type: 'stage_output_file_missing',
        timestamp: now,
        runId: state.runId,
        data: { stage, output_file_path: rawPath, checked_paths: candidatePaths },
      });

      return makeResult(state, config, {
        allowed: false,
        reason: `Stage 5 BLOCKED: output file "${rawPath}" not found on disk. You MUST produce the research output file BEFORE completing Stage 5. Preferred: call agent_render_research_output. Alternative: use the Write tool to save to ./isa-research-output.md. Then re-complete Stage 5 with answer_delivered: true.`,
        validationWarnings: [`output_file_path: file "${rawPath}" does not exist`],
      });
    }

    // File exists — read content for auto-injection into chat and log verification event
    let outputFileContent: string | undefined;
    try {
      outputFileContent = ctx.fs.readFile(foundPath);
    } catch {
      // Non-fatal: file exists but can't be read — proceed without content
    }

    appendEvent(ctx, args.agentSlug, {
      type: 'stage_output_file_verified',
      timestamp: now,
      runId: state.runId,
      data: {
        stage,
        output_file_path: rawPath,
        verified_path: foundPath,
        ...(outputFileContent ? { output_file_content: outputFileContent } : {}),
      },
    });

    // Post-process: inject > **Sources** blockquotes if missing.
    // The LLM almost never calls agent_render_research_output (uses Write directly),
    // so we deterministically inject source blocks here using Stage 4's source_texts.
    if (outputFileContent && !outputFileContent.includes('> **Sources**')) {
      const sourceTexts = extractSourceTextsFromState(state, ctx, args.agentSlug);
      if (Object.keys(sourceTexts).length > 0) {
        const citRegex = loadCitationRegexFromConfig(ctx, args.agentSlug);
        if (citRegex) {
          const injected = injectSourceBlocksIntoContent(outputFileContent, sourceTexts, citRegex);
          if (injected !== outputFileContent) {
            outputFileContent = injected;
            // Write the enhanced content back to disk
            try {
              ctx.fs.writeFile(foundPath, outputFileContent);
              appendEvent(ctx, args.agentSlug, {
                type: 'source_blocks_injected',
                timestamp: now,
                runId: state.runId,
                data: {
                  stage,
                  sourceTextsCount: Object.keys(sourceTexts).length,
                  path: foundPath,
                },
              });
            } catch {
              // Non-fatal: proceed with the injected content in memory
            }
          }
        }
      }
    }

    // Store output file content on args.data so it flows through to agent_stage_completed event
    if (outputFileContent) {
      (args.data as Record<string, unknown>).output_file_content = outputFileContent;
    }
  }

  // Write intermediates file to evidence/intermediates/ subdirectory
  // Iteration-aware naming for repair loops: stage2_synthesize_iter0.json
  const runDir = join(getAgentDataDir(ctx, args.agentSlug), 'runs', state.runId);
  const intermediatesDir = join(runDir, 'evidence', 'intermediates');
  ensureDir(ctx, intermediatesDir);
  const stageDef = config.controlFlow.stages.find((s) => s.id === stage);
  // Sanitize stage name to prevent path traversal in filenames
  const safeStageName = (stageDef?.name ?? 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
  // Append iteration suffix when inside a repair unit (enables per-iteration tracking)
  const iterSuffix = state.repairUnit !== null ? `_iter${state.repairIteration}` : '';
  const intermediatesFile = join(
    intermediatesDir,
    `stage${stage}_${safeStageName}${iterSuffix}.json`,
  );
  ctx.fs.writeFile(
    intermediatesFile,
    JSON.stringify(
      {
        stage,
        name: stageDef?.name,
        completedAt: now,
        repairIteration: state.repairUnit !== null ? state.repairIteration : undefined,
        data: args.data ?? {},
      },
      null,
      2,
    ),
  );

  // Error classification (when data.error is present)
  let errorClassification: Record<string, unknown> | undefined;
  if (args.data?.error) {
    errorClassification = classifyErrorInline(String(args.data.error));
  }

  // Determine pause requirement BEFORE writing state, so pausedAtStage is
  // included in a single atomic write (eliminates the previous double-write
  // race condition where the second write could be lost).
  let pauseRequired = config.controlFlow.pauseAfterStages.includes(stage);

  // Error-triggered pause: if error matches a pauseOnErrors category, auto-pause
  let errorPause = false;
  if (
    errorClassification &&
    config.controlFlow.pauseOnErrors?.length &&
    config.controlFlow.pauseOnErrors.includes(errorClassification.category as string)
  ) {
    pauseRequired = true;
    errorPause = true;
  }

  // Set pausedAtStage on the state BEFORE writing to disk
  if (pauseRequired) {
    state.pausedAtStage = stage;
  }

  // Append stage_completed event
  appendEvent(ctx, args.agentSlug, {
    type: 'stage_completed',
    timestamp: now,
    runId: state.runId,
    data: {
      stage,
      name: stageDef?.name,
      ...(errorClassification ? { errorClassification } : {}),
      ...(args.data ?? {}),
    },
  });

  // Emit real-time event for renderer
  ctx.callbacks.onAgentEvent?.({
    type: 'agent_stage_completed',
    agentSlug: args.agentSlug,
    runId: state.runId,
    data: { stage, stageName: stageDef?.name ?? 'unknown', ...(args.data ?? {}) },
  });

  // Domain-level events: emit separate events for verification results and web search
  if (args.data?.verification_scores) {
    appendEvent(ctx, args.agentSlug, {
      type: 'verification_result',
      timestamp: now,
      runId: state.runId,
      data: {
        stage,
        scores: args.data.verification_scores,
        all_passed: args.data.all_passed ?? false,
      },
    });
  }
  if (args.data?.web_search_result) {
    appendEvent(ctx, args.agentSlug, {
      type: 'web_search_result',
      timestamp: now,
      runId: state.runId,
      data: args.data.web_search_result as Record<string, unknown>,
    });
  }

  // Check if all stages are completed
  const allStageIds = config.controlFlow.stages.map((s) => s.id);
  const allCompleted = allStageIds.every((id) => state.completedStages.includes(id));
  if (allCompleted) {
    appendEvent(ctx, args.agentSlug, {
      type: 'agent_run_completed',
      timestamp: now,
      runId: state.runId,
      data: {
        completedStages: state.completedStages,
        toolCallCount: state.toolCallCount,
      },
    });

    // Write metadata.json for the completed run
    const metadataFile = join(runDir, 'metadata.json');
    ctx.fs.writeFile(
      metadataFile,
      JSON.stringify(
        {
          runId: state.runId,
          startedAt: state.startedAt,
          completedAt: now,
          depthMode: state.depthMode,
          followupNumber: state.followupNumber,
          toolCallCount: state.toolCallCount,
          toolCallDurations: state.toolCallDurations,
          completedStages: state.completedStages,
          repairIterations: state.repairIteration,
          verificationScores: (args.data?.verification_scores as Record<string, unknown>) ?? null,
          debugModeActive: (args.data?.debugModeActive as boolean) ?? false,
          webSearchUsed: (args.data?.webSearchUsed as boolean) ?? false,
          webSearchQueryCount: (args.data?.webSearchQueryCount as number) ?? 0,
          classifiedErrors: (args.data?.classifiedErrors as unknown[]) ?? [],
        },
        null,
        2,
      ),
    );

    // Emit real-time event for renderer
    ctx.callbacks.onAgentEvent?.({
      type: 'agent_run_completed',
      agentSlug: args.agentSlug,
      runId: state.runId,
      data: {
        verificationStatus: (args.data?.verificationStatus as string) ?? 'pending',
        completedStages: state.completedStages,
        toolCallCount: state.toolCallCount,
      },
    });
  }

  // Single atomic write — includes pausedAtStage when pause is required
  writeRunState(ctx, args.agentSlug, state);

  // Emit error escalation event (after state is persisted)
  if (errorPause) {
    appendEvent(ctx, args.agentSlug, {
      type: 'agent_error_escalation',
      timestamp: now,
      runId: state.runId,
      data: {
        stage,
        errorClassification,
        suggestedActions: errorClassification!.suggestedActions,
      },
    });
  }

  if (pauseRequired && ctx.callbacks.onAgentStagePause) {
    appendEvent(ctx, args.agentSlug, {
      type: 'stage_gate_pause',
      timestamp: now,
      runId: state.runId,
      data: { stage, agentSlug: args.agentSlug, ...(errorPause ? { errorTriggered: true } : {}) },
    });

    ctx.callbacks.onAgentStagePause({
      agentSlug: args.agentSlug,
      stage,
      runId: state.runId,
      data: { ...(args.data ?? {}), ...(errorPause ? { errorClassification } : {}) },
    });
  }

  // When a pause is required, return allowed: false so the LLM stops tool-calling
  // in this turn after presenting a user-facing pause message.
  // onAgentStagePause sets pause lock in session state; the model should then wait
  // for explicit user input in a new turn before calling resume/start.
  if (pauseRequired) {
    const nextStage = stage + 1;
    const stagePauseInstructions = stageDef?.pauseInstructions?.trim();
    const pauseNarrative = stagePauseInstructions?.length
      ? stagePauseInstructions
      : `Present a clear, concise summary of stage ${stage} results to the user (2-3 sentences max). ` +
          `Do NOT produce tables, sub-query lists, scope analysis, or verbose output. ` +
          `Execution is paused for user review. After presenting the summary, stop and wait.`;

    return makeResult(state, config, {
      allowed: false,
      pauseRequired: true,
      reason: `PAUSED — Stage ${stage} complete. ` +
        `${pauseNarrative} ` +
        `Do NOT call any more tools. Do NOT call resume or start in this turn. ` +
        `The user will tell you to proceed, modify, or abort in a new message. ` +
        `Only after receiving that user input, call agent_stage_gate resume then start stage ${nextStage}.`,
      ...(errorClassification
        ? {
            errorClassification: errorPause ? errorClassification : undefined,
          }
        : {}),
      ...(validationWarnings ? { validationWarnings } : {}),
    });
  }

  return makeResult(state, config, {
    pauseRequired: false,
    ...(errorClassification
      ? {
          reason: (errorClassification as { diagnostic: string }).diagnostic,
          errorClassification: errorPause ? errorClassification : undefined,
        }
      : {}),
    ...(validationWarnings ? { validationWarnings } : {}),
  });
}

function handleRepair(
  ctx: SessionToolContext,
  args: AgentStageGateArgs,
  config: StageGateConfig,
): AgentStageGateResult {
  const state = readRunState(ctx, args.agentSlug);
  if (!state) {
    return noRunResult('No active run.');
  }

  // Block repair while pipeline is paused
  if (state.pausedAtStage !== undefined) {
    return makeResult(state, config, {
      allowed: false,
      reason: `Pipeline paused at stage ${state.pausedAtStage}. Cannot repair until resumed.`,
    });
  }

  if (!state.repairUnit) {
    return makeResult(state, config, {
      allowed: false,
      reason: 'No active repair unit. Call start_repair_unit first.',
    });
  }

  // Find repair unit config for max iterations
  const ru = config.controlFlow.repairUnits.find(
    (r) => r.stages[0] === state.repairUnit![0] && r.stages[1] === state.repairUnit![1],
  );
  const maxIterations = ru?.maxIterations ?? 3;

  state.repairIteration++;

  if (state.repairIteration >= maxIterations) {
    state.lastEventAt = nowISO();
    writeRunState(ctx, args.agentSlug, state);

    appendEvent(ctx, args.agentSlug, {
      type: 'repair_iteration',
      timestamp: state.lastEventAt,
      runId: state.runId,
      data: {
        iteration: state.repairIteration,
        maxIterations,
        allowed: false,
        reason: 'Max repair iterations reached.',
      },
    });

    return makeResult(state, config, {
      allowed: false,
      reason: `Max repair iterations (${maxIterations}) reached. Call end_repair_unit to proceed.`,
    });
  }

  // Remove repair unit stages from completedStages so they can be re-run
  const [startStage, endStage] = state.repairUnit;
  state.completedStages = state.completedStages.filter(
    (s) => s < startStage || s > endStage,
  );
  state.currentStage = startStage;
  state.lastEventAt = nowISO();
  writeRunState(ctx, args.agentSlug, state);

  appendEvent(ctx, args.agentSlug, {
    type: 'repair_iteration',
    timestamp: state.lastEventAt,
    runId: state.runId,
    data: {
      iteration: state.repairIteration,
      maxIterations,
      stages: state.repairUnit,
      feedback: args.data?.[ru?.feedbackField ?? 'feedback'],
    },
  });

  // Emit real-time event for renderer
  ctx.callbacks.onAgentEvent?.({
    type: 'agent_repair_iteration',
    agentSlug: args.agentSlug,
    runId: state.runId,
    data: {
      iteration: state.repairIteration,
      maxIterations,
      scores: args.data?.scores as Record<string, number> | undefined,
    },
  });

  return makeResult(state, config);
}

function handleStartRepairUnit(
  ctx: SessionToolContext,
  args: AgentStageGateArgs,
  config: StageGateConfig,
): AgentStageGateResult {
  const state = readRunState(ctx, args.agentSlug);
  if (!state) {
    return noRunResult('No active run.');
  }

  // Block starting repair unit while pipeline is paused
  if (state.pausedAtStage !== undefined) {
    return makeResult(state, config, {
      allowed: false,
      reason: `Pipeline paused at stage ${state.pausedAtStage}. Cannot start repair unit until resumed.`,
    });
  }

  if (state.repairUnit) {
    return makeResult(state, config, {
      allowed: false,
      reason: `Repair unit [${state.repairUnit.join(', ')}] already active. Call end_repair_unit first.`,
    });
  }

  // Find which repair unit to activate based on current stage
  const ru = config.controlFlow.repairUnits.find(
    (r) => r.stages[0] === state.currentStage || r.stages[1] === state.currentStage,
  );
  if (!ru) {
    return makeResult(state, config, {
      allowed: false,
      reason:
        `No repair unit defined for current stage ${state.currentStage}. ` +
        `Available: ${config.controlFlow.repairUnits.map((r) => `[${r.stages.join(',')}]`).join(', ')}.`,
    });
  }

  state.repairUnit = ru.stages;
  state.repairIteration = 0;
  state.lastEventAt = nowISO();
  writeRunState(ctx, args.agentSlug, state);

  appendEvent(ctx, args.agentSlug, {
    type: 'repair_unit_started',
    timestamp: state.lastEventAt,
    runId: state.runId,
    data: { stages: ru.stages, maxIterations: ru.maxIterations },
  });

  return makeResult(state, config);
}

function handleEndRepairUnit(
  ctx: SessionToolContext,
  args: AgentStageGateArgs,
  config: StageGateConfig,
): AgentStageGateResult {
  const state = readRunState(ctx, args.agentSlug);
  if (!state) {
    return noRunResult('No active run.');
  }

  // Block ending repair unit while pipeline is paused
  if (state.pausedAtStage !== undefined) {
    return makeResult(state, config, {
      allowed: false,
      reason: `Pipeline paused at stage ${state.pausedAtStage}. Cannot end repair unit until resumed.`,
    });
  }

  if (!state.repairUnit) {
    return makeResult(state, config, {
      allowed: false,
      reason: 'No active repair unit to end.',
    });
  }

  const endedUnit = state.repairUnit;
  state.repairUnit = null;
  state.repairIteration = 0;
  state.lastEventAt = nowISO();
  writeRunState(ctx, args.agentSlug, state);

  appendEvent(ctx, args.agentSlug, {
    type: 'repair_unit_completed',
    timestamp: state.lastEventAt,
    runId: state.runId,
    data: { stages: endedUnit },
  });

  return makeResult(state, config);
}

function handleStatus(
  ctx: SessionToolContext,
  args: AgentStageGateArgs,
  config: StageGateConfig,
): AgentStageGateResult {
  const state = readRunState(ctx, args.agentSlug);
  if (!state) {
    return noRunResult('No active run.');
  }

  const result = makeResult(state, config);

  // Check for staleness
  const ageSeconds = (Date.now() - new Date(state.lastEventAt).getTime()) / 1000;
  if (ageSeconds > STALE_RUN_THRESHOLD_SECONDS) {
    result.staleRun = {
      runId: state.runId,
      lastEventAt: state.lastEventAt,
      ageSeconds: Math.round(ageSeconds),
    };
  }

  return result;
}

function handleReset(
  ctx: SessionToolContext,
  args: AgentStageGateArgs,
  config: StageGateConfig,
): AgentStageGateResult {
  const state = readRunState(ctx, args.agentSlug);

  // Block reset of paused pipeline unless explicitly forced
  if (state?.pausedAtStage !== undefined && args.data?.force !== true) {
    return makeResult(state, config, {
      allowed: false,
      reason:
        `Cannot reset a paused pipeline (paused at stage ${state.pausedAtStage}). ` +
        `Use data: { force: true } to override, or resume with abort first.`,
    });
  }

  if (state) {
    appendEvent(ctx, args.agentSlug, {
      type: 'error',
      timestamp: nowISO(),
      runId: state.runId,
      data: {
        action: 'reset',
        reason: (args.data?.reason as string) ?? 'Manual reset',
        previousStage: state.currentStage,
      },
    });
  }

  // Remove current run state file
  const stateFile = join(getAgentDataDir(ctx, args.agentSlug), 'current-run-state.json');
  if (ctx.fs.exists(stateFile)) {
    ctx.fs.unlink(stateFile);
  }

  return {
    allowed: true,
    currentStage: -1,
    completedStages: [],
    repairIteration: 0,
    maxRepairIterations: 0,
    repairUnitActive: false,
    reason: 'Run state reset.',
    runId: state?.runId ?? '',
  };
}

function handleResume(
  ctx: SessionToolContext,
  args: AgentStageGateArgs,
  config: StageGateConfig,
): AgentStageGateResult {
  const state = readRunState(ctx, args.agentSlug);
  if (!state) {
    return noRunResult('No active run.');
  }

  // Block LLM self-resume in the same response batch as the pause.
  // The isPauseLocked callback is set by sessions.ts onAgentStagePause
  // and cleared in onProcessingStopped when the turn ends.
  if (ctx.callbacks.isPauseLocked?.()) {
    return makeResult(state, config, {
      allowed: false,
      reason: 'Pipeline was just paused in this turn. Resume is only available after the user provides input in a new message.',
    });
  }

  if (state.pausedAtStage === undefined) {
    return makeResult(state, config, {
      allowed: false,
      reason: 'Cannot resume — no stage is currently paused.',
    });
  }

  const decision = args.data?.decision as string | undefined;
  if (!decision || !['proceed', 'modify', 'abort'].includes(decision)) {
    return makeResult(state, config, {
      allowed: false,
      reason: `Invalid decision: '${decision ?? 'undefined'}'. Must be 'proceed', 'modify', or 'abort'.`,
    });
  }

  const now = nowISO();
  const pausedStage = state.pausedAtStage;

  if (decision === 'abort') {
    appendEvent(ctx, args.agentSlug, {
      type: 'agent_run_aborted',
      timestamp: now,
      runId: state.runId,
      data: {
        stage: pausedStage,
        reason: (args.data?.reason as string) ?? 'User aborted',
      },
    });

    // Clear run state
    const stateFile = join(getAgentDataDir(ctx, args.agentSlug), 'current-run-state.json');
    if (ctx.fs.exists(stateFile)) {
      ctx.fs.unlink(stateFile);
    }

    return {
      allowed: true,
      currentStage: pausedStage,
      completedStages: state.completedStages,
      repairIteration: 0,
      maxRepairIterations: 0,
      repairUnitActive: false,
      runId: state.runId,
      aborted: true,
      reason: 'Pipeline aborted by user.',
    };
  }

  // proceed or modify
  state.pausedAtStage = undefined;

  if (decision === 'modify' && args.data?.modifications) {
    state.pendingModifications = args.data.modifications as Record<string, unknown>;
  }

  state.lastEventAt = now;
  writeRunState(ctx, args.agentSlug, state);

  appendEvent(ctx, args.agentSlug, {
    type: 'stage_gate_resumed',
    timestamp: now,
    runId: state.runId,
    data: {
      stage: pausedStage,
      decision,
      ...(decision === 'modify' ? { modifications: args.data?.modifications } : {}),
    },
  });

  const nextStage = pausedStage + 1;
  return makeResult(state, config, {
    nextStage,
    ...(decision === 'modify' && state.pendingModifications
      ? { modifications: state.pendingModifications }
      : {}),
  });
}

// ============================================================
// Source Block Post-Processing Helpers
// ============================================================

/**
 * Extract source_texts from Stage 4's stageOutputs.
 * Falls back to reading the Stage 4 intermediates file if stageOutputs is empty.
 */
function extractSourceTextsFromState(
  state: RunState,
  ctx: SessionToolContext,
  agentSlug: string,
): Record<string, string> {
  // Try stageOutputs first (stored when Stage 4 completed)
  const stage4Output = state.stageOutputs[4] as Record<string, unknown> | undefined;
  if (stage4Output?.source_texts && typeof stage4Output.source_texts === 'object') {
    const texts = stage4Output.source_texts as Record<string, unknown>;
    // Filter to only string values
    const result: Record<string, string> = {};
    for (const [key, val] of Object.entries(texts)) {
      if (typeof val === 'string' && val.length > 0) {
        result[key] = val;
      }
    }
    if (Object.keys(result).length > 0) return result;
  }

  // Fallback: try reading Stage 4 intermediates file
  const runDir = join(getAgentDataDir(ctx, agentSlug), 'runs', state.runId);
  const intermediatesDir = join(runDir, 'evidence', 'intermediates');

  // Try common naming patterns for Stage 4
  for (const name of ['stage4_verify.json', 'stage4_verify_iter0.json']) {
    const filePath = join(intermediatesDir, name);
    if (ctx.fs.exists(filePath)) {
      try {
        const raw = JSON.parse(ctx.fs.readFile(filePath));
        const data = raw?.data as Record<string, unknown> | undefined;
        if (data?.source_texts && typeof data.source_texts === 'object') {
          const texts = data.source_texts as Record<string, unknown>;
          const result: Record<string, string> = {};
          for (const [key, val] of Object.entries(texts)) {
            if (typeof val === 'string' && val.length > 0) {
              result[key] = val;
            }
          }
          if (Object.keys(result).length > 0) return result;
        }
      } catch {
        // Non-fatal
      }
    }
  }

  return {};
}

/**
 * Load citationRegex from the agent's config.json output section.
 */
function loadCitationRegexFromConfig(ctx: SessionToolContext, agentSlug: string): string | null {
  const configPath = join(ctx.agentsPath, agentSlug, 'config.json');
  if (!ctx.fs.exists(configPath)) return null;
  try {
    const raw = JSON.parse(ctx.fs.readFile(configPath));
    const regex = raw?.output?.citationRegex;
    return typeof regex === 'string' ? regex : null;
  } catch {
    return null;
  }
}

/**
 * Split content into sections by ## headings and inject source blocks into each.
 * Uses the same injectSourceBlocks() from the renderer for consistency.
 */
function injectSourceBlocksIntoContent(
  content: string,
  sourceTexts: Record<string, string>,
  citationRegex: string,
): string {
  // Split on ## headings, keeping the heading with its content
  const sections = content.split(/(?=^## )/m).filter((s) => s.trim().length > 0);

  const processed = sections.map((section) => {
    // Skip if section already has source blocks
    if (section.includes('> **Sources**')) return section;
    return injectSourceBlocks(section, sourceTexts, citationRegex);
  });

  return processed.join('\n\n');
}

// ============================================================
// Main Handler
// ============================================================

/**
 * Handle the agent_stage_gate tool call.
 *
 * Routes to action-specific handlers after loading the agent config
 * from disk. Returns a structured JSON result with pipeline state.
 */
export async function handleAgentStageGate(
  ctx: SessionToolContext,
  args: AgentStageGateArgs,
): Promise<ToolResult> {
  const { agentSlug, action } = args;

  // Load agent config from workspace
  const config = loadStageGateConfig(ctx, agentSlug);
  if (!config) {
    return errorResponse(
      `Agent '${agentSlug}' not found or has invalid config.json. ` +
        `Expected at: ${join(ctx.agentsPath, agentSlug, 'config.json')}`,
    );
  }

  let result: AgentStageGateResult;

  switch (action) {
    case 'start':
      result = handleStart(ctx, args, config);
      break;
    case 'complete':
      result = handleComplete(ctx, args, config);
      break;
    case 'repair':
      result = handleRepair(ctx, args, config);
      break;
    case 'start_repair_unit':
      result = handleStartRepairUnit(ctx, args, config);
      break;
    case 'end_repair_unit':
      result = handleEndRepairUnit(ctx, args, config);
      break;
    case 'status':
      result = handleStatus(ctx, args, config);
      break;
    case 'reset':
      result = handleReset(ctx, args, config);
      break;
    case 'resume':
      result = handleResume(ctx, args, config);
      break;
    default:
      return errorResponse(
        `Unknown action: ${action}. ` +
          `Valid: start, complete, repair, start_repair_unit, end_repair_unit, status, reset, resume.`,
      );
  }

  return successResponse(JSON.stringify(result, null, 2));
}
