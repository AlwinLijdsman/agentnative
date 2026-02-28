import { query, createSdkMcpServer, tool, AbortError, type Query, type SDKMessage, type SDKUserMessage, type SDKAssistantMessageError, type Options } from '@anthropic-ai/claude-agent-sdk';
import { getDefaultOptions, resetClaudeConfigCheck } from './options.ts';
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources';
import { z } from 'zod';
import { getSystemPrompt } from '../prompts/system.ts';
import { BaseAgent, type MiniAgentConfig, MINI_AGENT_TOOLS, MINI_AGENT_MCP_KEYS } from './base-agent.ts';
import type { BackendConfig, PermissionRequestType } from './backend/types.ts';
// Plan types are used by UI components; not needed in craft-agent.ts since Safe Mode is user-controlled
import { parseError, type AgentError } from './errors.ts';
import { runErrorDiagnostics } from './diagnostics.ts';
import { loadStoredConfig, loadConfigDefaults, type Workspace, type AuthType, getDefaultLlmConnection, getLlmConnection } from '../config/storage.ts';
import { isLocalMcpEnabled } from '../workspaces/storage.ts';
import { loadPlanFromPath, type SessionConfig as Session } from '../sessions/storage.ts';
import { DEFAULT_MODEL, isClaudeModel, getDefaultSummarizationModel } from '../config/models.ts';
import { getCredentialManager } from '../credentials/index.ts';
import { updatePreferences, loadPreferences, formatPreferencesForPrompt, type UserPreferences } from '../config/preferences.ts';
import type { FileAttachment } from '../utils/files.ts';
import { debug } from '../utils/debug.ts';
import {
  getSessionPlansDir,
  getLastPlanFilePath,
  clearPlanFileState,
  registerSessionScopedToolCallbacks,
  unregisterSessionScopedToolCallbacks,
  getSessionScopedTools,
  cleanupSessionScopedTools,
  type AuthRequest,
} from './session-scoped-tools.ts';
import { type HookSystem, type SdkHookCallbackMatcher } from '../hooks-simple/index.ts';
import {
  getPermissionMode,
  setPermissionMode,
  cyclePermissionMode,
  initializeModeState,
  cleanupModeState,
  shouldAllowToolInMode,
  blockWithReason,
  isApiEndpointAllowed,
  type PermissionMode,
  PERMISSION_MODE_CONFIG,
  SAFE_MODE_CONFIG,
} from './mode-manager.ts';
import { type PermissionsContext, permissionsConfigCache } from './permissions-config.ts';
import { getSessionPlansPath, getSessionPath } from '../sessions/storage.ts';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'node:os';
import { join } from 'path';
import { isResumableTranscript } from './sdk-transcript-validator.ts';
import { expandPath } from '../utils/paths.ts';
import { extractWorkspaceSlug } from '../utils/workspace.ts';
import {
  ConfigWatcher,
  createConfigWatcher,
  type ConfigWatcherCallbacks,
} from '../config/watcher.ts';
import type { ValidationIssue } from '../config/validators.ts';
import { detectConfigFileType, detectAppConfigFileType, validateConfigFileContent, formatValidationResult } from '../config/validators.ts';
// Shared PreToolUse utilities
import {
  expandToolPaths,
  qualifySkillName,
  stripToolMetadata,
  validateConfigWrite,
  BUILT_IN_TOOLS,
} from './core/pre-tool-use.ts';
import { type ThinkingLevel, getThinkingTokens, DEFAULT_THINKING_LEVEL } from './thinking-levels.ts';
import type { LoadedSource } from '../sources/types.ts';
import { sourceNeedsAuthentication } from '../sources/credential-manager.ts';
import type {
  AgentBackend,
  ChatOptions,
  PermissionCallback,
  PlanCallback,
  AuthCallback,
  SourceChangeCallback,
  SourceActivationCallback,
} from './backend/types.ts';

// Re-export permission mode functions for application usage
export {
  // Permission mode API
  getPermissionMode,
  setPermissionMode,
  cyclePermissionMode,
  subscribeModeChanges,
  type PermissionMode,
  PERMISSION_MODE_ORDER,
  PERMISSION_MODE_CONFIG,
} from './mode-manager.ts';
// Documentation is served via local files at ~/.craft-agent/docs/

// Import and re-export AgentEvent from core (single source of truth)
import type { AgentEvent } from '@craft-agent/core/types';
export type { AgentEvent };

// Stateless tool matching — pure functions for SDK message → AgentEvent conversion
import { ToolIndex, extractToolStarts, extractToolResults, type ContentBlock } from './tool-matching.ts';

// Re-export types for UI components
export type { LoadedSource } from '../sources/types.ts';

// Import and re-export AbortReason and RecoveryMessage from core module (single source of truth)
// Re-exported for backwards compatibility with existing imports from claude-agent.ts
import { AbortReason, type RecoveryMessage } from './core/index.ts';
export { AbortReason, type RecoveryMessage };

// Orchestrator — deterministic stage pipeline (Phase 6 integration)
import { AgentOrchestrator, CostTracker, McpLifecycleManager, OrchestratorLlmClient, OrchestratorMcpBridge, PipelineState, extractTransportConfig } from './orchestrator/index.ts';
import type {
  AgentConfig as OrchestratorAgentConfig,
  BreakoutClassification,
  McpBridge as OrchestratorMcpBridge_T,
  OrchestratorExitReason,
  PipelineExitReason,
} from './orchestrator/types.ts';
import { loadSourceConfig } from '../sources/storage.ts';
import { loadAgent, loadWorkspaceAgents } from '../agents/storage.ts';
import type { LoadedAgent } from '../agents/types.ts';
import { parseMentions } from '../mentions/index.ts';

export interface ClaudeAgentConfig {
  workspace: Workspace;
  session?: Session;           // Current session (primary isolation boundary)
  mcpToken?: string;           // Override token (for testing)
  model?: string;
  thinkingLevel?: ThinkingLevel; // Initial thinking level (defaults to 'think')
  onSdkSessionIdUpdate?: (sdkSessionId: string) => void;  // Callback when SDK session ID is captured
  onSdkSessionIdCleared?: () => void;  // Callback when SDK session ID is cleared (e.g., after failed resume)
  /**
   * Callback to get recent messages for recovery context.
   * Called when SDK resume fails and we need to inject previous conversation context into retry.
   * Returns last N user/assistant message pairs for context injection.
   */
  getRecoveryMessages?: () => RecoveryMessage[];
  isHeadless?: boolean;        // Running in headless mode (disables interactive tools)
  debugMode?: {                // Debug mode configuration (when running in dev)
    enabled: boolean;          // Whether debug mode is active
    logFilePath?: string;      // Path to the log file for querying
  };
  /** System prompt preset for mini agents ('default' | 'mini' or custom string) */
  systemPromptPreset?: 'default' | 'mini' | string;
  /** Workspace-level HookSystem instance (shared across all agents in the workspace) */
  hookSystem?: HookSystem;
}

// Permission request tracking
interface PendingPermission {
  resolve: (allowed: boolean, alwaysAllow?: boolean) => void;
  toolName: string;
  command: string;
  baseCommand: string;
  type?: 'bash' | 'safe_mode';  // Type of permission request
}

// Dangerous commands that should always require permission (never auto-allow)
const DANGEROUS_COMMANDS = new Set([
  'rm', 'rmdir', 'sudo', 'su', 'chmod', 'chown', 'chgrp',
  'mv', 'cp', 'dd', 'mkfs', 'fdisk', 'parted',
  'kill', 'killall', 'pkill',
  'reboot', 'shutdown', 'halt', 'poweroff',
  'curl', 'wget', 'ssh', 'scp', 'rsync',
  'git push', 'git reset', 'git rebase', 'git checkout',
]);

// ============================================================
// Global Tool Permission System
// Used by both bash commands (via agent instance) and MCP tools (via global functions)
// ============================================================

interface GlobalPendingPermission {
  resolve: (allowed: boolean) => void;
  toolName: string;
  command: string;
}

const globalPendingPermissions = new Map<string, GlobalPendingPermission>();

// Handler set by application to receive permission requests
let globalPermissionHandler: ((request: { requestId: string; toolName: string; command: string; description: string }) => void) | null = null;

/**
 * Set the global permission request handler (called by application)
 */
export function setGlobalPermissionHandler(
  handler: ((request: { requestId: string; toolName: string; command: string; description: string }) => void) | null
): void {
  globalPermissionHandler = handler;
}

/**
 * Request permission for a tool operation (used by MCP tools)
 * Returns a promise that resolves to true if allowed, false if denied
 */
export function requestToolPermission(
  toolName: string,
  command: string,
  description: string
): Promise<boolean> {
  return new Promise((resolve) => {
    const requestId = `perm-${toolName}-${Date.now()}`;

    globalPendingPermissions.set(requestId, {
      resolve,
      toolName,
      command,
    });

    if (globalPermissionHandler) {
      globalPermissionHandler({ requestId, toolName, command, description });
    } else {
      // No handler - deny by default
      globalPendingPermissions.delete(requestId);
      resolve(false);
    }
  });
}

/**
 * Resolve a pending global permission request (called by application)
 */
export function resolveGlobalPermission(requestId: string, allowed: boolean): void {
  const pending = globalPendingPermissions.get(requestId);
  if (pending) {
    pending.resolve(allowed);
    globalPendingPermissions.delete(requestId);
  }
}

/**
 * Clear all pending global permissions (called on workspace switch)
 */
export function clearGlobalPermissions(): void {
  globalPendingPermissions.clear();
}

// ============================================================
// Orchestrator Breakout Detection
// ============================================================

/**
 * Breakout keyword patterns — case-insensitive substrings that signal
 * the user wants to exit a paused orchestrator pipeline.
 *
 * Two tiers:
 * 1. Explicit pipeline commands: "exit pipeline", "cancel agent", etc.
 * 2. Natural language intent signals: "something else", "never mind", etc.
 *
 * Messages not matching any pattern fall through to the existing resume
 * path where the orchestrator handles them as feedback.
 */
const BREAKOUT_PATTERNS: readonly string[] = [
  // Tier 1: Explicit pipeline commands
  'break out',
  'breakout',
  'exit pipeline',
  'exit agent',
  'stop pipeline',
  'stop agent',
  'cancel pipeline',
  'cancel agent',
  'forget the pipeline',
  'skip pipeline',
  'leave pipeline',
  'abandon pipeline',
  'quit pipeline',
  // Tier 2: Natural language breakout signals
  // NOTE: Aggressive patterns removed ("want to ask", "want to do",
  // "instead can you", "instead tell me", "instead just") — these match
  // too many resume-intent messages. The confirmation gate reduces the
  // cost of remaining false positives to an extra prompt.
  'something else',
  'something different',
  'different question',
  'different topic',
  'change topic',
  'change the topic',
  'new question',
  'new topic',
  'never mind',
  'nevermind',
  'forget it',
  'changed my mind',
];

/**
 * Detect whether a user message signals intent to break out of a paused
 * orchestrator pipeline. Uses keyword-based detection (no LLM call).
 *
 * @param userMessage - The user's message text
 * @returns true if breakout intent detected
 */
export function isBreakoutIntent(userMessage: string): boolean {
  const lower = userMessage.toLowerCase().trim();
  // Exact match for pause message option "3. Exit" (F9)
  if (lower === '3' || lower === '3.') return true;
  return BREAKOUT_PATTERNS.some(pattern => lower.includes(pattern));
}

/** Words that confirm breakout intent ("yes, quit the pipeline"). */
const BREAKOUT_CONFIRM_PATTERNS: readonly string[] = [
  'yes', 'yeah', 'yep', 'yup', 'sure', 'confirm', 'quit', 'leave', 'exit',
  'terminate', 'stop', 'abort', 'end it', 'kill it', 'close it',
  'cancel',  // "cancel the pipeline" = confirm exit (F4)
];

/** Words that deny breakout intent ("no, continue the pipeline"). */
const BREAKOUT_DENY_PATTERNS: readonly string[] = [
  'no', 'nah', 'nope', 'stay', 'keep going', 'continue',
  'proceed', 'resume', 'go back', 'go on', 'carry on', 'never mind',
  'forget i said that', 'back to',
];

/**
 * Classify a user's response to a breakout confirmation question.
 *
 * IMPORTANT — Semantic inversion vs. pipeline resume vocabulary:
 * During confirmation, "yes" means "quit pipeline" and "continue" means
 * "stay in pipeline". This is inverted relative to normal pause-resume
 * where "yes/continue" means "proceed with next stage". The inversion
 * is correct because the question is "Do you want to EXIT?", not
 * "Do you want to CONTINUE?".
 *
 * Denial is checked first — if a user says "no, continue", we want
 * to match denial rather than letting "continue" slip into ambiguity.
 *
 * @returns 'confirm' (quit), 'deny' (stay), or 'implicit_confirm' (neither — user moved on)
 */
export function classifyBreakoutResponse(
  userMessage: string,
): 'confirm' | 'deny' | 'implicit_confirm' {
  const lower = userMessage.toLowerCase().trim();

  // Exact numeric option match — confirmation question shows "1. Yes" / "2. No" (F3)
  // Must be checked before substring scan to avoid "1" matching inside longer text.
  if (lower === '1' || lower === '1.') return 'confirm';
  if (lower === '2' || lower === '2.') return 'deny';

  // Check denial first — "no" / "continue" / "proceed" means keep the pipeline
  if (BREAKOUT_DENY_PATTERNS.some(p => lower.includes(p))) return 'deny';

  // Check confirmation — "yes" / "quit" / "exit" means terminate
  if (BREAKOUT_CONFIRM_PATTERNS.some(p => lower.includes(p))) return 'confirm';

  // Neither — implicit confirmation (user is clearly moving on to something else)
  return 'implicit_confirm';
}

// ============================================================================
// BREAKOUT RESUME CLASSIFICATION — Resume-from-breakout intent detection
// ============================================================================

/** Patterns that signal intent to resume a broken-out pipeline. */
const BREAKOUT_RESUME_PATTERNS: readonly string[] = [
  'resume', 'continue', 'pick up', 'carry on', 'go ahead',
  'proceed', 'go back', 'where we left off', 'where i left off',
  'yes', 'yeah', 'yep', 'yup', 'sure',
];

/** Patterns that signal intent to start a fresh pipeline instead of resuming. */
const BREAKOUT_FRESH_PATTERNS: readonly string[] = [
  'start fresh', 'start over', 'start new', 'from scratch',
  'new pipeline', 'new research', 'fresh start', 'brand new',
  'no', 'nah', 'nope',
];

/** Regex patterns for resume intent in free-form agent re-invocation messages. */
const RESUME_INTENT_REGEXPS: readonly RegExp[] = [
  /\b(continue|resume|pick up|carry on|proceed|go back)\b/i,
  /\bwhere\b.+\bleft off\b/i,
  /\bstage\s+\d+/i,
];

/** Regex patterns for fresh-start intent in agent re-invocation messages. */
const FRESH_INTENT_REGEXPS: readonly RegExp[] = [
  /\bstart\s+(fresh|over|new)\b/i,
  /\bfrom\s+scratch\b/i,
  /\bnew\s+(pipeline|research|query)\b/i,
  /\bforget\b.+\bprevious\b/i,
  /\bbrand\s+new\b/i,
];

/**
 * Classify a user's response to the breakout-resume confirmation prompt.
 *
 * IMPORTANT — Distinct from classifyBreakoutResponse():
 * The breakout confirmation asks "Do you want to EXIT?" (1=exit, 2=stay).
 * The resume confirmation asks "Do you want to RESUME?" (1=resume, 2=fresh).
 * Semantics are inverted: "yes" here means resume, not exit.
 *
 * @returns 'resume' (continue pipeline), 'fresh_start' (start over), or 'unclear'
 */
export function classifyBreakoutResumeResponse(
  userMessage: string,
): 'resume' | 'fresh_start' | 'unclear' {
  const lower = userMessage.toLowerCase().trim();

  // Exact numeric match — prompt shows "1. Resume" / "2. Start fresh"
  if (lower === '1' || lower === '1.') return 'resume';
  if (lower === '2' || lower === '2.') return 'fresh_start';

  // Check fresh-start first — "no" / "start fresh" means new pipeline
  if (BREAKOUT_FRESH_PATTERNS.some(p => lower.includes(p))) return 'fresh_start';

  // Check resume — "yes" / "resume" / "continue" means continue pipeline
  if (BREAKOUT_RESUME_PATTERNS.some(p => lower.includes(p))) return 'resume';

  return 'unclear';
}

/**
 * Classify resume intent from a free-form agent re-invocation message.
 *
 * Used when the user sends "[agent:slug] - continue with stage 2" without
 * a prior confirmation prompt. Detects whether the message signals
 * resume intent, fresh-start intent, or is ambiguous.
 *
 * @returns 'resume', 'fresh_start', or 'unclear' (triggers confirmation prompt)
 */
export function classifyResumeIntent(
  userMessage: string,
): 'resume' | 'fresh_start' | 'unclear' {
  const text = userMessage.trim();

  // Check fresh-start patterns first (more specific)
  if (FRESH_INTENT_REGEXPS.some(p => p.test(text))) return 'fresh_start';

  // Check resume patterns
  if (RESUME_INTENT_REGEXPS.some(p => p.test(text))) return 'resume';

  return 'unclear';
}

// Handle preferences update (extracted for use in MCP tool)
function handleUpdatePreferences(input: Record<string, unknown>): string {
  const updates: Partial<UserPreferences> = {};

  if (input.name && typeof input.name === 'string') {
    updates.name = input.name;
  }
  if (input.timezone && typeof input.timezone === 'string') {
    updates.timezone = input.timezone;
  }
  if (input.language && typeof input.language === 'string') {
    updates.language = input.language;
  }

  // Handle location fields
  if (input.city || input.region || input.country) {
    updates.location = {};
    if (input.city && typeof input.city === 'string') {
      updates.location.city = input.city;
    }
    if (input.region && typeof input.region === 'string') {
      updates.location.region = input.region;
    }
    if (input.country && typeof input.country === 'string') {
      updates.location.country = input.country;
    }
  }

  // Handle notes (replace)
  if (input.notes && typeof input.notes === 'string') {
    updates.notes = input.notes;
  }

  // Check if anything was actually updated
  const fields = Object.keys(updates).filter(k => k !== 'location');
  if (updates.location) {
    fields.push(...Object.keys(updates.location).map(k => `location.${k}`));
  }

  if (fields.length === 0) {
    return 'No preferences were updated (no valid fields provided)';
  }

  updatePreferences(updates);
  return `Updated user preferences: ${fields.join(', ')}`;
}


// Base tool: update_user_preferences (always available)
const updateUserPreferencesTool = tool(
  'update_user_preferences',
  `Update stored user preferences. Use this when you learn information about the user that would be helpful to remember for future conversations. This includes their name, timezone, location, preferred language, or any other relevant notes. Only update fields you have confirmed information about - don't guess.`,
  {
    name: z.string().optional().describe("The user's preferred name or how they'd like to be addressed"),
    timezone: z.string().optional().describe("The user's timezone in IANA format (e.g., 'America/New_York', 'Europe/London')"),
    city: z.string().optional().describe("The user's city"),
    region: z.string().optional().describe("The user's state/region/province"),
    country: z.string().optional().describe("The user's country"),
    language: z.string().optional().describe("The user's preferred language for responses"),
    notes: z.string().optional().describe('Additional notes about the user that would be helpful to remember (preferences, context, etc.). Replaces any existing notes.'),
  },
  async (args) => {
    try {
      const result = handleUpdatePreferences(args);
      return {
        content: [{ type: 'text', text: result }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{ type: 'text', text: `Failed to update preferences: ${message}` }],
        isError: true,
      };
    }
  }
);

// Cached MCP server for preferences
let cachedPrefToolsServer: ReturnType<typeof createSdkMcpServer> | null = null;

// Preferences MCP server - user preferences tool
function getPreferencesServer(_unused?: boolean): ReturnType<typeof createSdkMcpServer> {
  if (!cachedPrefToolsServer) {
    cachedPrefToolsServer = createSdkMcpServer({
      name: 'preferences',
      version: '1.0.0',
      tools: [updateUserPreferencesTool],
    });
  }
  return cachedPrefToolsServer;
}

/**
 * SDK-compatible MCP server configuration.
 * Supports HTTP/SSE (remote) and stdio (local subprocess) transports.
 */
export type SdkMcpServerConfig =
  | { type: 'http' | 'sse'; url: string; headers?: Record<string, string> }
  | { type: 'stdio'; command: string; args?: string[]; env?: Record<string, string>; cwd?: string };

/**
 * Detect the Windows ENOENT .claude/skills directory error from the Claude Code SDK.
 * The SDK scans C:\ProgramData\ClaudeCode\.claude\skills for managed/enterprise skills
 * but crashes if the directory doesn't exist. This is an upstream SDK bug.
 * See: https://github.com/anthropics/claude-code/issues/20571
 *
 * Returns a typed_error event with user-friendly instructions, or null if not this error.
 */
function buildWindowsSkillsDirError(errorText: string): { type: 'typed_error'; error: AgentError } | null {
  if (!errorText.includes('ENOENT') || !errorText.includes('skills')) {
    return null;
  }

  const pathMatch = errorText.match(/scandir\s+'([^']+)'/);
  const missingPath = pathMatch?.[1] || 'C:\\ProgramData\\ClaudeCode\\.claude\\skills';

  return {
    type: 'typed_error',
    error: {
      code: 'unknown_error',
      title: 'Windows Setup Required',
      message: `The SDK requires a directory that doesn't exist: ${missingPath} — Create this folder in File Explorer, then restart the app.`,
      details: [
        `PowerShell (run as Administrator):`,
        `New-Item -ItemType Directory -Force -Path "${missingPath}"`,
      ],
      actions: [],
      canRetry: true,
      originalError: errorText,
    },
  };
}

/**
 * Detect whether an error message indicates a server-side session expiry.
 * Used by both the event-loop recovery path (result errors) and the catch-block
 * recovery path (thrown errors / stderr) to apply a single retry with fresh session.
 *
 * Case-insensitive match covers:
 *   - "No conversation found with session ID: <uuid>" (API / stderr)
 *   - "no conversation found with session id" (lowercased catch-path)
 */
function isSessionExpiredError(text: string | undefined | null): boolean {
  if (!text) return false;
  return text.toLowerCase().includes('no conversation found with session id');
}

// Re-export for unit testing — the function is also used internally by chat() recovery paths
export { isSessionExpiredError };

export class ClaudeAgent extends BaseAgent {
  // Note: ClaudeAgentConfig is compatible with BackendConfig, so we use the inherited this.config
  private currentQuery: Query | null = null;
  private currentQueryAbortController: AbortController | null = null;
  private lastAbortReason: AbortReason | null = null;
  private sessionId: string | null = null;
  private isHeadless: boolean = false;
  private pendingPermissions: Map<string, PendingPermission> = new Map();
  // Permission whitelists are now managed by this.permissionManager (inherited from BaseAgent)
  // Pre-built source server configs (user-defined sources, separate from agent)
  // Supports both HTTP/SSE and stdio transports
  private sourceMcpServers: Record<string, SdkMcpServerConfig> = {};
  // In-process MCP servers for source API integrations
  private sourceApiServers: Record<string, ReturnType<typeof createSdkMcpServer>> = {};
  // Source state tracking is now managed by this.sourceManager (inherited from BaseAgent)
  // Safe mode state - user-controlled read-only exploration mode
  private safeMode: boolean = false;
  // SDK tools list (captured from init message)
  private sdkTools: string[] = [];
  // Thinking level and ultrathink override are now managed by BaseAgent
  // Pinned system prompt components (captured on first chat, used for consistency after compaction)
  private pinnedPreferencesPrompt: string | null = null;
  // Track if preference drift notification has been shown this session
  private preferencesDriftNotified: boolean = false;
  // Track if context compaction notification has been shown this session
  private contextCompactionNotified: boolean = false;
  // Last context compaction state — set by buildTextPrompt/buildSDKUserMessage, read by chat()
  private _lastContextWasCompacted: boolean = false;
  // Captured stderr from SDK subprocess (for error diagnostics when process exits with code 1)
  private lastStderrOutput: string[] = [];
  // Last assistant message usage (for accurate context window display)
  // result.modelUsage is cumulative across the session (for billing), but we need per-message usage
  // See: https://github.com/anthropics/claude-agent-sdk-typescript/issues/66
  private lastAssistantUsage: {
    input_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  } | null = null;
  // Cached context window size from modelUsage (for real-time usage_update events)
  // This is captured from the first result message and reused for subsequent usage updates
  private cachedContextWindow?: number;

  /**
   * Get the session ID for mode operations.
   * Returns a temp ID if no session is configured (shouldn't happen in practice).
   */
  private get modeSessionId(): string {
    return this.config.session?.id || `temp-${Date.now()}`;
  }

  /**
   * Get the workspace root path for workspace-scoped operations.
   */
  private get workspaceRootPath(): string {
    return this.config.workspace.rootPath;
  }

  // Callback for permission requests - set by application to receive permission prompts
  public onPermissionRequest: ((request: { requestId: string; toolName: string; command?: string; description: string; type?: PermissionRequestType }) => void) | null = null;

  // Debug callback for status messages
  public onDebug: ((message: string) => void) | null = null;

  /** Callback when permission mode changes */
  public onPermissionModeChange: ((mode: PermissionMode) => void) | null = null;

  // Callback when a plan is submitted - set by application to display plan message
  public onPlanSubmitted: ((planPath: string) => void) | null = null;

  // Callback when authentication is requested (unified auth flow)
  // This follows the submit_plan pattern:
  // 1. Tool calls onAuthRequest
  // 2. Session manager creates auth-request message and calls forceAbort
  // 3. User completes auth in UI
  // 4. Auth result is sent as a "faked user message"
  // 5. Agent resumes and processes the result
  public onAuthRequest: ((request: AuthRequest) => void) | null = null;

  // Callback when a source config changes (hot-reload from file watcher)
  public onSourceChange: ((slug: string, source: LoadedSource | null) => void) | null = null;

  // onSourcesListChange, onConfigValidationError, onSourceActivationRequest,
  // onAgentStagePause, and isPauseLocked are inherited from BaseAgent

  // Callback when token usage is updated (for context window display).
  // Note: Full UsageTracker integration is planned for Phase 4 refactoring.
  public onUsageUpdate: ((update: { inputTokens: number; contextWindow?: number; cacheHitRate?: number }) => void) | null = null;

  constructor(config: ClaudeAgentConfig) {
    // Resolve model: prioritize session model > config model (caller must provide via connection)
    const model = config.session?.model ?? config.model!;

    // Build BackendConfig for BaseAgent
    // Context window for Anthropic models is 200k tokens
    const CLAUDE_CONTEXT_WINDOW = 200_000;
    const backendConfig: BackendConfig = {
      provider: 'anthropic',
      workspace: config.workspace,
      session: config.session,
      model,
      thinkingLevel: config.thinkingLevel,
      mcpToken: config.mcpToken,
      isHeadless: config.isHeadless,
      debugMode: config.debugMode,
      systemPromptPreset: config.systemPromptPreset,
      onSdkSessionIdUpdate: config.onSdkSessionIdUpdate,
      onSdkSessionIdCleared: config.onSdkSessionIdCleared,
      getRecoveryMessages: config.getRecoveryMessages,
    };

    // Call BaseAgent constructor - initializes model, thinkingLevel, permissionManager, sourceManager, etc.
    // The inherited this.config is set by super() and compatible with ClaudeAgentConfig
    super(backendConfig, DEFAULT_MODEL, CLAUDE_CONTEXT_WINDOW);

    this.isHeadless = config.isHeadless ?? false;

    // Log which model is being used (helpful for debugging custom models)
    this.debug(`Using model: ${model}`);

    // Initialize sessionId from session config for conversation resumption
    if (config.session?.sdkSessionId) {
      this.sessionId = config.session.sdkSessionId;
    }

    // Initialize permission mode state with callbacks
    const sessionId = this.modeSessionId;
    // Get initial mode: from session, or from global default
    const globalDefaults = loadConfigDefaults();
    const initialMode: PermissionMode = config.session?.permissionMode ?? globalDefaults.workspaceDefaults.permissionMode;

    initializeModeState(sessionId, initialMode, {
      onStateChange: (state) => {
        // Sync permission mode state with agent
        this.safeMode = state.permissionMode === 'safe';
        // Notify UI of permission mode changes
        this.onPermissionModeChange?.(state.permissionMode);
      },
    });

    // Register session-scoped tool callbacks
    registerSessionScopedToolCallbacks(sessionId, {
      onPlanSubmitted: (planPath) => {
        this.onDebug?.(`[ClaudeAgent] onPlanSubmitted received: ${planPath}`);
        this.onPlanSubmitted?.(planPath);
      },
      onAuthRequest: (request) => {
        this.onDebug?.(`[ClaudeAgent] onAuthRequest received: ${request.sourceSlug} (type: ${request.type})`);
        this.onAuthRequest?.(request);
      },
      onAgentStagePause: (args) => {
        this.onDebug?.(`[ClaudeAgent] onAgentStagePause: agent=${args.agentSlug} stage=${args.stage} run=${args.runId}`);
        this.onAgentStagePause?.(args);
      },
      onAgentEvent: (event) => {
        this.onDebug?.(`[ClaudeAgent] onAgentEvent: type=${event.type} agent=${event.agentSlug} run=${event.runId}`);
        this.onAgentEvent?.(event);
      },
      isPauseLocked: () => this.isPauseLocked?.() ?? false,
    });

    // Start config watcher for hot-reloading source changes
    // Only start in non-headless mode to avoid overhead in batch/script scenarios
    if (!this.isHeadless) {
      this.startConfigWatcher();
    }
  }

  // Config watcher methods (startConfigWatcher, stopConfigWatcher) are now inherited from BaseAgent
  // Thinking level methods (setThinkingLevel, getThinkingLevel, setUltrathinkOverride) are now inherited from BaseAgent

  // Permission command utilities (getBaseCommand, isDangerousCommand, extractDomainFromNetworkCommand)
  // are now available via this.permissionManager

  /**
   * Respond to a pending permission request.
   * Uses permissionManager for whitelisting.
   */
  respondToPermission(requestId: string, allowed: boolean, alwaysAllow: boolean = false): void {
    this.debug(`respondToPermission: ${requestId}, allowed=${allowed}, alwaysAllow=${alwaysAllow}, pending=${this.pendingPermissions.has(requestId)}`);
    const pending = this.pendingPermissions.get(requestId);
    if (pending) {
      this.debug(`Resolving permission promise for ${requestId}`);

      // If "always allow" was selected, remember it (with special handling for curl/wget)
      if (alwaysAllow && allowed) {
        if (['curl', 'wget'].includes(pending.baseCommand)) {
          // For curl/wget, whitelist the domain instead of the command
          const domain = this.permissionManager.extractDomainFromNetworkCommand(pending.command);
          if (domain) {
            this.permissionManager.whitelistDomain(domain);
            this.debug(`Added domain "${domain}" to always-allowed domains`);
          }
        } else if (!this.permissionManager.isDangerousCommand(pending.baseCommand)) {
          this.permissionManager.whitelistCommand(pending.baseCommand);
          this.debug(`Added "${pending.baseCommand}" to always-allowed commands`);
        }
      }

      pending.resolve(allowed);
      this.pendingPermissions.delete(requestId);
    } else {
      this.debug(`No pending permission found for ${requestId}`);
    }
  }

  // isInSafeMode() is now inherited from BaseAgent

  /**
   * Check if a tool requires permission and handle it
   * Returns true if allowed, false if denied
   */
  private async checkToolPermission(
    toolName: string,
    input: Record<string, unknown>,
    toolUseId: string
  ): Promise<{ allowed: boolean; updatedInput: Record<string, unknown> }> {
    // Bash commands require permission
    if (toolName === 'Bash') {
      const command = typeof input.command === 'string' ? input.command : JSON.stringify(input);
      const baseCommand = command.trim().split(/\s+/)[0] || command;
      const requestId = `perm-${toolUseId}`;

      // Create a promise that will be resolved when user responds
      const permissionPromise = new Promise<boolean>((resolve) => {
        this.pendingPermissions.set(requestId, {
          resolve,
          toolName,
          command,
          baseCommand,
        });
      });

      // Notify application of permission request via callback (not event yield)
      if (this.onPermissionRequest) {
        this.onPermissionRequest({
          requestId,
          toolName,
          command,
          description: `Execute bash command: ${command}`,
        });
      } else {
        // No permission handler - deny by default for safety
        this.pendingPermissions.delete(requestId);
        return { allowed: false, updatedInput: input };
      }

      // Wait for user response
      const allowed = await permissionPromise;
      return { allowed, updatedInput: input };
    }

    // All other tools are auto-approved
    return { allowed: true, updatedInput: input };
  }

  private async getToken(): Promise<string | null> {
    // Only return token if explicitly provided via config
    // Sources handle their own authentication
    return this.config.mcpToken ?? null;
  }

  async *chat(
    userMessage: string,
    attachments?: FileAttachment[],
    options?: ChatOptions
  ): AsyncGenerator<AgentEvent> {
    // Extract options (ChatOptions interface from AgentBackend)
    const _isRetry = options?.isRetry ?? false;

    try {
      const sessionId = this.config.session?.id || `temp-${Date.now()}`;

      // Pin system prompt components on first chat() call for consistency after compaction
      // The SDK's resume mechanism expects system prompt consistency within a session
      const currentPreferencesPrompt = formatPreferencesForPrompt();

      if (this.pinnedPreferencesPrompt === null) {
        // First chat in this session - pin current values
        this.pinnedPreferencesPrompt = currentPreferencesPrompt;
        debug('[chat] Pinned system prompt components for session consistency');
      } else {
        // Detect drift: warn user if context has changed since session started
        const preferencesDrifted = currentPreferencesPrompt !== this.pinnedPreferencesPrompt;

        if (preferencesDrifted && !this.preferencesDriftNotified) {
          yield {
            type: 'info',
            message: `Note: Your preferences changed since this session started. Start a new session to apply changes.`,
          };
          this.preferencesDriftNotified = true;
          debug(`[chat] Detected drift in: preferences`);
        }
      }

      // Check if we have binary attachments that need the AsyncIterable interface
      const hasBinaryAttachments = attachments?.some(a => a.type === 'image' || a.type === 'pdf');

      // Validate we have something to send
      if (!userMessage.trim() && (!attachments || attachments.length === 0)) {
        yield { type: 'error', message: 'Cannot send empty message' };
        yield { type: 'complete' };
        return;
      }

      // ── BREAKOUT RESUME PENDING DETECTION ──────────────────────────
      // G1/G2 fix: Check if a breakout_resume_pending confirmation is awaiting
      // a response. This runs BEFORE detectPausedOrchestrator because the
      // pipeline is NOT paused after breakout (isPaused=false), so the
      // existing paused-orchestrator path would miss it entirely.
      //
      // Flow: User broke out → later re-invoked [agent:] → we asked
      //   "1. Resume / 2. Start fresh" → recorded breakout_resume_pending →
      //   now user responds with "1" or "2" (or free text).
      if (!_isRetry) {
        const breakoutResumePending = this.detectBreakoutResumePending(sessionId);
        if (breakoutResumePending) {
          const decision = classifyBreakoutResumeResponse(userMessage);
          debug(`[chat] Breakout-resume confirmation response: decision=${decision} agent=${breakoutResumePending.slug}`);

          if (decision === 'resume') {
            // Resume pipeline from the stage after the last completed one
            debug(`[chat] Resuming from breakout: agent=${breakoutResumePending.slug} fromStage=${breakoutResumePending.resumeFromStage}`);
            yield* this.resumeFromBreakoutOrchestrator(userMessage, breakoutResumePending);
            return;
          } else if (decision === 'fresh_start') {
            // G4 fix: Clean up stale pipeline artifacts before fresh start
            const sessionPath = getSessionPath(this.workspaceRootPath, sessionId);
            this.cleanupStaleBreakoutArtifacts(sessionPath);
            debug(`[chat] Fresh start after breakout: agent=${breakoutResumePending.slug} — cleaned artifacts, falling through`);
            yield {
              type: 'info',
              message: 'Starting a fresh pipeline. Previous research context has been cleared.',
            };
            // Fall through to normal detectOrchestratableAgent / SDK path
          } else {
            // unclear → default to resume (non-destructive, like breakout classification defaults)
            debug(`[chat] Breakout-resume unclear response, defaulting to resume: agent=${breakoutResumePending.slug}`);
            yield* this.resumeFromBreakoutOrchestrator(userMessage, breakoutResumePending);
            return;
          }
        }
      }

      // ── ORCHESTRATOR RESUME / BREAKOUT DETECTION ──────────────────
      // Check if a paused orchestrator pipeline exists for this session.
      // If so, route through a decision tree:
      //   A. breakoutPending + deny       → clear pending, resume pipeline
      //   B. breakoutPending + confirm    → terminate, retrieve original msg, fall through to SDK
      //   C. breakoutPending + implicit   → terminate, fall through to SDK (current msg)
      //   D. no pending + keyword match   → set pending, ask confirmation (fast path)
      //   D'. no pending + LLM breakout   → set pending, ask confirmation (semantic path)
      //   E. no pending + no intent       → normal resume
      if (!_isRetry) {
        const pausedOrch = this.detectPausedOrchestrator(sessionId);
        if (pausedOrch) {
          const sessionPath = getSessionPath(this.workspaceRootPath, sessionId);

          if (pausedOrch.breakoutPending) {
            // ── CONFIRMATION TURN — user previously expressed breakout intent ──
            const decision = classifyBreakoutResponse(userMessage);
            debug(`[chat] Breakout confirmation for agent=${pausedOrch.slug}: decision=${decision}`);

            if (decision === 'deny') {
              // ── Case A: User wants to STAY — clear pending, resume pipeline ──
              try {
                const pipelineState = PipelineState.loadFrom(sessionPath);
                if (pipelineState) {
                  // Record 'resumed' event to cancel the breakout_pending
                  const updatedState = pipelineState.addEvent({
                    type: 'resumed',
                    stage: pipelineState.currentStage,
                    data: { breakoutDenied: true },
                  });
                  updatedState.saveTo(sessionPath);
                }
              } catch (denyError) {
                debug(`[chat] Breakout denial cleanup error: ${denyError instanceof Error ? denyError.message : String(denyError)}`);
              }
              yield { type: 'info', message: 'Continuing with the research pipeline.' };
              yield* this.resumeOrchestrator(userMessage, pausedOrch.agent);
              return;
            } else {
              // ── Case B/C: confirm or implicit_confirm — TERMINATE pipeline ──
              try {
                const pipelineState = PipelineState.loadFrom(sessionPath);
                if (pipelineState) {
                  const updatedState = pipelineState.addEvent({
                    type: 'breakout',
                    stage: pipelineState.currentStage,
                    data: { userMessage: userMessage.slice(0, 500), decision },
                  });
                  updatedState.saveTo(sessionPath);

                  const agentConfig = this.toOrchestratorAgentConfig(pausedOrch.agent);
                  const totalStages = agentConfig.controlFlow.stages.length;
                  this.writePipelineSummary(sessionPath, totalStages, 'breakout', updatedState);
                }

                this.clearOrchestratorBridgeState(sessionPath, pausedOrch.slug);

                this.onAgentEvent?.({
                  type: 'agent_run_completed',
                  agentSlug: pausedOrch.slug,
                  runId: `breakout-${Date.now()}`,
                  data: { verificationStatus: 'breakout' },
                });
              } catch (breakoutError) {
                debug(`[chat] Breakout cleanup error: ${breakoutError instanceof Error ? breakoutError.message : String(breakoutError)}`);
              }

              if (decision === 'confirm') {
                // ── Case B: Explicit confirm — retrieve original question, fall through to SDK ──
                // The original breakout message is stored in the breakout_pending event.
                // Retrieve it so the SDK can answer the user's original question (F1/F8).
                try {
                  const confirmState = PipelineState.loadFrom(sessionPath);
                  if (confirmState) {
                    const pendingEvents = confirmState.events.filter(
                      (e) => e.type === 'breakout_pending',
                    );
                    const lastPending = pendingEvents[pendingEvents.length - 1];
                    const storedMessage = lastPending?.data?.['userMessage'] as string | undefined;
                    if (storedMessage && storedMessage.length > 0) {
                      userMessage = storedMessage;
                    }
                  }
                } catch (retrieveError) {
                  debug(`[chat] Original message retrieval error: ${retrieveError instanceof Error ? retrieveError.message : String(retrieveError)}`);
                }
              }

              // ── Case B/C unified: both yield info + fall through to SDK ──
              yield {
                type: 'info',
                message: 'Pipeline terminated. Your research context has been preserved.',
              };
              // DO NOT return — fall through to normal SDK chat() path
            }
          } else if (isBreakoutIntent(userMessage)) {
            // ── Case D (keyword fast path): Explicit breakout signal — ask for confirmation ──
            debug(`[chat] Breakout intent detected (keyword) for agent=${pausedOrch.slug} — asking confirmation`);
            yield* this.emitBreakoutConfirmation(userMessage, sessionPath, 'keyword');
            return;
          } else {
            // ── Semantic classification: is this a pipeline response or unrelated? ──
            // Keyword detection missed — use LLM to classify semantic intent.
            // This catches cases like "what's the weather in zurich?" which are
            // clearly unrelated to an audit research pipeline but contain no keywords.
            const pipelineState = PipelineState.loadFrom(sessionPath);
            if (pipelineState && pipelineState.originalQuery !== 'Unknown query') {
              const classification = await this.classifyBreakoutIntent(
                userMessage, pipelineState, pipelineState.pausedAtStage ?? -1,
              );
              debug(`[chat] Semantic breakout classification for agent=${pausedOrch.slug}: ${classification}`);

              if (classification === 'breakout') {
                // ── Case D (semantic path): LLM detected off-topic — ask for confirmation ──
                debug(`[chat] Semantic breakout detected for agent=${pausedOrch.slug} — asking confirmation`);
                yield* this.emitBreakoutConfirmation(userMessage, sessionPath, 'semantic');
                return;
              }
              // classification === 'pipeline_response' or 'unclear' → fall through to Case E
            }

            // ── Case E: Normal resume path — orchestrator handles the message ──
            debug(`[chat] Detected paused orchestrator for agent=${pausedOrch.slug} — resuming`);
            yield* this.resumeOrchestrator(userMessage, pausedOrch.agent);
            return;
          }
        }
      }

      // ── ORCHESTRATOR DETECTION (with breakout resume check) ─────────
      // FIRST: Check if the mentioned agent has a resumable broken-out pipeline.
      // If so, offer to resume instead of blindly starting fresh.
      // SECOND: If not resumable, start a fresh orchestrator pipeline.
      if (!_isRetry) {
        const orchestratableAgent = this.detectOrchestratableAgent(userMessage);
        if (orchestratableAgent) {
          // Check for resumable breakout state before starting fresh
          const resumable = this.detectResumableBreakout(sessionId, orchestratableAgent.slug);
          if (resumable) {
            // Classify resume intent from the free-form message
            const intent = classifyResumeIntent(userMessage);
            debug(`[chat] Resumable breakout detected for agent=${orchestratableAgent.slug}: intent=${intent} lastCompleted=${resumable.lastCompletedStage}`);

            if (intent === 'resume') {
              // Explicit resume intent — skip confirmation, resume directly
              yield* this.resumeFromBreakoutOrchestrator(userMessage, {
                slug: orchestratableAgent.slug,
                agent: orchestratableAgent,
                resumeFromStage: resumable.lastCompletedStage + 1,
              });
              return;
            } else if (intent === 'fresh_start') {
              // Explicit fresh start — clean artifacts and start fresh
              const sessionPath = getSessionPath(this.workspaceRootPath, sessionId);
              this.cleanupStaleBreakoutArtifacts(sessionPath);
              debug(`[chat] Fresh start (explicit): agent=${orchestratableAgent.slug}`);
              // Fall through to runOrchestrator below
            } else {
              // Ambiguous — ask confirmation (emit breakout_resume_pending)
              debug(`[chat] Ambiguous resume intent for agent=${orchestratableAgent.slug} — asking confirmation`);
              yield* this.emitBreakoutResumeConfirmation({
                slug: orchestratableAgent.slug,
                agent: orchestratableAgent,
                resumeFromStage: resumable.lastCompletedStage + 1,
              });
              return;
            }
          }

          debug(`[chat] Detected orchestratable agent: ${orchestratableAgent.slug} — delegating to orchestrator`);
          yield* this.runOrchestrator(userMessage, orchestratableAgent);
          return;
        }
      }

      // Get centralized mini agent configuration (from BaseAgent)
      // This ensures Claude and Codex agents use the same detection and constants
      const miniConfig = this.getMiniAgentConfig();

      // Block SDK tools that require UI we don't have:
      // - EnterPlanMode/ExitPlanMode: We use safe mode instead (user-controlled via UI)
      // - AskUserQuestion: Requires interactive UI to show question options to user
      // Note: Mini agents use a minimal tool list directly, so no additional blocking needed
      const disallowedTools: string[] = ['EnterPlanMode', 'ExitPlanMode', 'AskUserQuestion'];

      // Build MCP servers config
      // Mini agents: only session tools (config_validate) to minimize token usage
      // Regular agents: full set including preferences, docs, and user sources
      const sourceMcpResult = this.getSourceMcpServersFiltered();

      debug('[chat] sourceMcpServers:', sourceMcpResult.servers);
      debug('[chat] sourceApiServers:', this.sourceApiServers);

      // Build full MCP servers set first, then filter for mini agents
      const fullMcpServers: Options['mcpServers'] = {
        preferences: getPreferencesServer(false),
        // Session-scoped tools (submit_plan, source_test, etc.)
        session: getSessionScopedTools(sessionId, this.workspaceRootPath),
        // Craft Agents documentation - always available for searching setup guides
        // This is a public Mintlify MCP server, no auth needed
        'craft-agents-docs': {
          type: 'http',
          url: 'https://agents.craft.do/docs/mcp',
        },
        // Add user-defined source servers (MCP and API, filtered by local MCP setting)
        // Note: Craft MCP server is now added via sources system
        ...sourceMcpResult.servers,
        ...this.sourceApiServers,
      };

      // Mini agents: filter to minimal set using centralized keys
      // Regular agents: use full set including preferences, docs, and user sources
      const mcpServers: Options['mcpServers'] = miniConfig.enabled
        ? this.filterMcpServersForMiniAgent(fullMcpServers, miniConfig.mcpServerKeys)
        : fullMcpServers;
      
      // Configure SDK options
      // Model is always set by caller via connection config
      const model = this._model;

      // Log provider context for diagnostics (custom base URL = third-party provider)
      const defaultConnSlug = getDefaultLlmConnection();
      const defaultConn = defaultConnSlug ? getLlmConnection(defaultConnSlug) : null;
      const activeBaseUrl = defaultConn?.baseUrl;
      if (activeBaseUrl) {
        debug(`[chat] Custom provider: baseUrl=${activeBaseUrl}, model=${model}, hasApiKey=${!!process.env.ANTHROPIC_API_KEY}`);
      }

      // Determine effective thinking level: ultrathink override boosts to max for this message
      // Uses inherited protected fields from BaseAgent
      const effectiveThinkingLevel: ThinkingLevel = this._ultrathinkOverride ? 'max' : this._thinkingLevel;
      const thinkingTokens = getThinkingTokens(effectiveThinkingLevel, model);
      debug(`[chat] Thinking: level=${this._thinkingLevel}, override=${this._ultrathinkOverride}, effective=${effectiveThinkingLevel}, tokens=${thinkingTokens}`);

      // NOTE: Parent-child tracking for subagents is documented below (search for
      // "PARENT-CHILD TOOL TRACKING"). The SDK's parent_tool_use_id is authoritative.

      // Clear stderr buffer at start of each query
      this.lastStderrOutput = [];

      // Detect if resolved model is Claude — non-Claude models (via OpenRouter/Ollama) don't
      // support Anthropic-specific betas or extended thinking parameters
      const isClaude = isClaudeModel(model);

      // Log mini agent mode details (using centralized config)
      if (miniConfig.enabled) {
        debug('[ClaudeAgent] 🤖 MINI AGENT mode - optimized for quick config edits');
        debug('[ClaudeAgent] Mini agent optimizations:', {
          model,
          tools: miniConfig.tools,
          mcpServers: miniConfig.mcpServerKeys,
          thinking: 'disabled',
          systemPrompt: 'lean (no Claude Code preset)',
        });
      }

      const options: Options = {
        ...getDefaultOptions(),
        model,
        // Capture stderr from SDK subprocess for error diagnostics
        // This helps identify why sessions fail with "process exited with code 1"
        stderr: (data: string) => {
          // Log to both debug file AND console for visibility
          debug('[SDK stderr]', data);
          console.error('[SDK stderr]', data);
          // Keep last 20 lines to avoid unbounded memory growth
          this.lastStderrOutput.push(data);
          if (this.lastStderrOutput.length > 20) {
            this.lastStderrOutput.shift();
          }
        },
        // Extended thinking: tokens based on effective thinking level (session level + ultrathink override)
        // Non-Claude models don't support extended thinking, so pass 0 to disable
        // Mini agents also disable thinking for efficiency (quick config edits don't need deep reasoning)
        maxThinkingTokens: miniConfig.minimizeThinking ? 0 : (isClaude ? thinkingTokens : 0),
        // System prompt configuration:
        // - Mini agents: Use custom (lean) system prompt without Claude Code preset
        // - Normal agents: Append to Claude Code's system prompt (recommended by docs)
        systemPrompt: miniConfig.enabled
          ? this.getMiniSystemPrompt()
          : {
              type: 'preset' as const,
              preset: 'claude_code' as const,
              // Working directory included for monorepo context file discovery
              append: getSystemPrompt(
                this.pinnedPreferencesPrompt ?? undefined,
                this.config.debugMode,
                this.workspaceRootPath,
                this.config.session?.workingDirectory
              ),
            },
        // Use sdkCwd for SDK session storage - this is set once at session creation and never changes.
        // This ensures SDK can always find session transcripts regardless of workingDirectory changes.
        // Note: workingDirectory is still used for context injection and shown to the agent.
        cwd: this.config.session?.sdkCwd ??
          (sessionId ? getSessionPath(this.workspaceRootPath, sessionId) : this.workspaceRootPath),
        includePartialMessages: true,
        // Tools configuration:
        // - Mini agents: minimal set for quick config edits (reduces token count ~70%)
        // - Regular agents: full Claude Code toolset
        tools: (() => {
          const toolsValue = miniConfig.enabled
            ? [...miniConfig.tools]  // Use centralized tool list
            : { type: 'preset' as const, preset: 'claude_code' as const };
          debug('[ClaudeAgent] 🔧 Tools configuration:', JSON.stringify(toolsValue));
          return toolsValue;
        })(),
        // Bypass SDK's built-in permission system - we handle all permissions via PreToolUse hook
        // This allows Safe Mode to properly allow read-only bash commands without SDK interference
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        // User hooks from hooks.json are merged with internal hooks
        hooks: (() => {
          // Build user-defined hooks from hooks.json using the workspace-level HookSystem
          const userHooks = this.config.hookSystem?.buildSdkHooks() ?? {};
          if (Object.keys(userHooks).length > 0) {
            debug('[CraftAgent] User SDK hooks loaded:', Object.keys(userHooks).join(', '));
          }

          // Internal hooks for permission handling and logging
          const internalHooks: Record<string, SdkHookCallbackMatcher[]> = {
          PreToolUse: [{
            hooks: [async (_hookInput) => {
              // Only handle PreToolUse events
              if (_hookInput.hook_event_name !== 'PreToolUse') {
                return { continue: true };
              }
              // Validate the fields we depend on are actually present
              if (!_hookInput.tool_name || !_hookInput.tool_use_id) {
                return { continue: true };
              }
              const input = _hookInput as Required<Pick<typeof _hookInput, 'tool_name' | 'tool_use_id'>> & typeof _hookInput;

              // Get current permission mode (single source of truth)
              const permissionMode = getPermissionMode(sessionId);
              this.onDebug?.(`PreToolUse hook: ${input.tool_name} (permissionMode=${permissionMode})`);

              // ============================================================
              // PERMISSION MODE HANDLING
              // - 'safe': Block writes entirely (read-only mode)
              // - 'ask': Prompt for dangerous operations
              // - 'allow-all': Everything allowed, no prompts
              // ============================================================

              // Build permissions context for loading custom permissions.json files
              const permissionsContext: PermissionsContext = {
                workspaceRootPath: this.workspaceRootPath,
                activeSourceSlugs: Array.from(this.sourceManager.getActiveSlugs()),
              };

              // In 'allow-all' mode, still check for explicitly blocked tools
              if (permissionMode === 'allow-all') {
                const plansFolderPath = sessionId ? getSessionPlansPath(this.workspaceRootPath, sessionId) : undefined;
                const result = shouldAllowToolInMode(
                  input.tool_name,
                  input.tool_input,
                  'allow-all',
                  { plansFolderPath, permissionsContext }
                );

                if (!result.allowed) {
                  // Tool is explicitly blocked in permissions.json
                  this.onDebug?.(`Allow-all mode: blocking explicitly blocked tool ${input.tool_name}`);
                  return blockWithReason(result.reason);
                }

                this.onDebug?.(`Allow-all mode: allowing ${input.tool_name}`);
                // Fall through to source blocking and other checks below
              }

              // In 'ask' mode, still check for explicitly blocked tools
              if (permissionMode === 'ask') {
                const plansFolderPath = sessionId ? getSessionPlansPath(this.workspaceRootPath, sessionId) : undefined;
                const result = shouldAllowToolInMode(
                  input.tool_name,
                  input.tool_input,
                  'ask',
                  { plansFolderPath, permissionsContext }
                );

                if (!result.allowed) {
                  // Tool is explicitly blocked in permissions.json
                  this.onDebug?.(`Ask mode: blocking explicitly blocked tool ${input.tool_name}`);
                  return blockWithReason(result.reason);
                }
                // Don't return here - fall through to other checks (like prompting for permission)
              }

              // In 'safe' mode, check against read-only allowlist
              if (permissionMode === 'safe') {
                const plansFolderPath = sessionId ? getSessionPlansPath(this.workspaceRootPath, sessionId) : undefined;
                const result = shouldAllowToolInMode(
                  input.tool_name,
                  input.tool_input,
                  'safe',
                  { plansFolderPath, permissionsContext }
                );

                if (!result.allowed) {
                  // In safe mode, always block without prompting
                  this.onDebug?.(`Safe mode: blocking ${input.tool_name}`);
                  return blockWithReason(result.reason);
                }

                this.onDebug?.(`Allowed in safe mode: ${input.tool_name}`);
                // Fall through to source blocking and other checks below
              }

              // ============================================================
              // SOURCE BLOCKING & AUTO-ENABLE: Handle tools from sources
              // Sources can be disabled mid-conversation, so we check
              // against the current active source set on each tool call.
              // If a source exists but isn't enabled, try to auto-enable it.
              // ============================================================
              if (input.tool_name.startsWith('mcp__')) {
                // Extract server name from tool name (mcp__<server>__<tool>)
                const parts = input.tool_name.split('__');
                const serverName = parts[1];
                if (parts.length >= 3 && serverName) {
                  // Built-in MCP servers that are always available (not user sources)
                  // - preferences: user preferences storage
                  // - session: session-scoped tools (submit_plan, source_test, etc.)
                  // - craft-agents-docs: always-available documentation search
                  const builtInMcpServers = new Set(['preferences', 'session', 'craft-agents-docs']);

                  // Check if this is a source server (not built-in)
                  if (!builtInMcpServers.has(serverName)) {
                    // Check if source server is active
                    const isActive = this.sourceManager.isSourceActive(serverName);
                    if (!isActive) {
                      // Check if this source exists in workspace (just not enabled in session)
                      const sourceExists = this.sourceManager.getAllSources().some(s => s.config.slug === serverName);

                      if (sourceExists && this.onSourceActivationRequest) {
                        // Try to auto-enable the source
                        this.onDebug?.(`Source "${serverName}" not active, attempting auto-enable...`);
                        try {
                          const activated = await this.onSourceActivationRequest(serverName);
                          if (activated) {
                            this.onDebug?.(`Source "${serverName}" auto-enabled successfully, tools available next turn`);
                            // Source was activated but the SDK was started with old server list.
                            // The tools will only be available on the NEXT chat() call.
                            // Return an imperative message to make the model stop and respond.
                            return {
                              continue: false,
                              decision: 'block' as const,
                              reason: `STOP. Source "${serverName}" has been activated successfully. The tools will be available on the next turn. Do NOT try other tool names or approaches. Respond to the user now: tell them the source is now active and ask them to send their request again.`,
                            };
                          } else {
                            // Activation failed (e.g., needs auth)
                            this.onDebug?.(`Source "${serverName}" auto-enable failed (may need authentication)`);
                            return {
                              continue: false,
                              decision: 'block' as const,
                              reason: `Source "${serverName}" could not be activated. It may require authentication. Please check the source status and authenticate if needed.`,
                            };
                          }
                        } catch (error) {
                          this.onDebug?.(`Source "${serverName}" auto-enable error: ${error}`);
                          return {
                            continue: false,
                            decision: 'block' as const,
                            reason: `Failed to activate source "${serverName}": ${error instanceof Error ? error.message : 'Unknown error'}`,
                          };
                        }
                      } else if (sourceExists) {
                        // Source exists but no activation handler - just inform
                        this.onDebug?.(`BLOCKED source tool: ${input.tool_name} (source "${serverName}" exists but is not enabled)`);
                        return {
                          continue: false,
                          decision: 'block' as const,
                          reason: `Source "${serverName}" is available but not enabled for this session. Please enable it in the sources panel.`,
                        };
                      } else {
                        // Source doesn't exist or can't be connected
                        this.onDebug?.(`BLOCKED source tool: ${input.tool_name} (source "${serverName}" does not exist)`);
                        return {
                          continue: false,
                          decision: 'block' as const,
                          reason: `Source "${serverName}" could not be connected. It may need re-authentication, or the server may be unreachable. Check the source in the sidebar for details.`,
                        };
                      }
                    }
                  }
                }
              }

              // ============================================================
              // SHARED PRETOOLUSE CHECKS
              // Uses shared utilities from core/pre-tool-use.ts for consistency
              // with CodexAgent implementation
              // ============================================================

              const toolInput = input.tool_input as Record<string, unknown>;
              let modifiedInput: Record<string, unknown> | null = null;

              // PATH EXPANSION: Expand ~ in file paths for SDK file tools
              const pathResult = expandToolPaths(
                input.tool_name,
                toolInput,
                (msg) => this.onDebug?.(msg)
              );
              if (pathResult.modified) {
                modifiedInput = pathResult.input;
              }

              // CONFIG FILE VALIDATION: Validate config writes before they happen
              const configResult = validateConfigWrite(
                input.tool_name,
                modifiedInput || toolInput,
                this.workspaceRootPath,
                (msg) => this.onDebug?.(msg)
              );
              if (!configResult.valid) {
                return {
                  continue: false,
                  decision: 'block' as const,
                  reason: configResult.error!,
                };
              }

              // SKILL QUALIFICATION: Ensure skill names are fully-qualified
              // SDK expects "workspaceSlug:skillSlug" format, NOT UUID
              if (input.tool_name === 'Skill') {
                const workspaceSlug = extractWorkspaceSlug(this.workspaceRootPath, this.config.workspace.id);
                const skillResult = qualifySkillName(
                  modifiedInput || toolInput,
                  workspaceSlug,
                  (msg) => this.onDebug?.(msg)
                );
                if (skillResult.modified) {
                  modifiedInput = skillResult.input;
                }
              }

              // TOOL METADATA STRIPPING: Remove _intent/_displayName from ALL tools
              // (extracted for UI in tool-matching.ts, stripped here before SDK execution)
              const metadataResult = stripToolMetadata(
                input.tool_name,
                modifiedInput || toolInput,
                (msg) => this.onDebug?.(msg)
              );
              if (metadataResult.modified) {
                modifiedInput = metadataResult.input;
              }

              // If any modifications were made, return with updated input
              if (modifiedInput) {
                return {
                  continue: true,
                  hookSpecificOutput: {
                    hookEventName: 'PreToolUse' as const,
                    updatedInput: modifiedInput,
                  },
                };
              }

              // ============================================================
              // ASK MODE: Prompt for permission on dangerous operations
              // In 'safe' mode, these are blocked by shouldAllowToolInMode above
              // In 'allow-all' mode, permission checks are skipped entirely
              // ============================================================

              // Helper to request permission and wait for response
              const requestPermission = async (
                toolUseId: string,
                toolName: string,
                command: string,
                baseCommand: string,
                description: string
              ): Promise<{ allowed: boolean }> => {
                const requestId = `perm-${toolUseId}`;
                debug(`[PreToolUse] Requesting permission for ${toolName}: ${command}`);

                const permissionPromise = new Promise<boolean>((resolve) => {
                  this.pendingPermissions.set(requestId, {
                    resolve,
                    toolName,
                    command,
                    baseCommand,
                  });
                });

                if (this.onPermissionRequest) {
                  this.onPermissionRequest({
                    requestId,
                    toolName,
                    command,
                    description,
                  });
                } else {
                  this.pendingPermissions.delete(requestId);
                  return { allowed: false };
                }

                const allowed = await permissionPromise;
                return { allowed };
              };

              // For file write operations in 'ask' mode, prompt for permission
              const fileWriteTools = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
              if (fileWriteTools.has(input.tool_name) && permissionMode === 'ask') {
                const toolInput = input.tool_input as Record<string, unknown>;
                const filePath = (toolInput.file_path as string) || (toolInput.notebook_path as string) || 'unknown';

                // Check if this tool type is already allowed for this session
                if (this.permissionManager.isCommandWhitelisted(input.tool_name)) {
                  this.onDebug?.(`Auto-allowing "${input.tool_name}" (previously approved)`);
                  return { continue: true };
                }

                const result = await requestPermission(
                  input.tool_use_id,
                  input.tool_name,
                  filePath,
                  input.tool_name,
                  `${input.tool_name}: ${filePath}`
                );

                if (!result.allowed) {
                  return {
                    continue: false,
                    decision: 'block' as const,
                    reason: 'User denied permission',
                  };
                }
              }

              // For MCP mutation tools in 'ask' mode, prompt for permission
              if (input.tool_name.startsWith('mcp__') && permissionMode === 'ask') {
                // Check if this is a mutation tool by testing against safe mode's read-only patterns
                const plansFolderPath = sessionId ? getSessionPlansPath(this.workspaceRootPath, sessionId) : undefined;
                const safeModeResult = shouldAllowToolInMode(
                  input.tool_name,
                  input.tool_input,
                  'safe',
                  { plansFolderPath }
                );

                // If it would be blocked in safe mode, it's a mutation and needs permission
                if (!safeModeResult.allowed) {
                  const serverAndTool = input.tool_name.replace('mcp__', '').replace(/__/g, '/');

                  // Check if this tool is already allowed for this session
                  if (this.permissionManager.isCommandWhitelisted(input.tool_name)) {
                    this.onDebug?.(`Auto-allowing "${input.tool_name}" (previously approved)`);
                    return { continue: true };
                  }

                  const result = await requestPermission(
                    input.tool_use_id,
                    'MCP Tool',
                    serverAndTool,
                    input.tool_name,
                    `MCP: ${serverAndTool}`
                  );

                  if (!result.allowed) {
                    return {
                      continue: false,
                      decision: 'block' as const,
                      reason: 'User denied permission',
                    };
                  }
                }
              }

              // For API mutation calls in 'ask' mode, prompt for permission
              if (input.tool_name.startsWith('api_') && permissionMode === 'ask') {
                const toolInput = input.tool_input as Record<string, unknown>;
                const method = ((toolInput?.method as string) || 'GET').toUpperCase();
                const path = toolInput?.path as string | undefined;

                // Only prompt for mutation methods (not GET)
                if (method !== 'GET') {
                  const apiDescription = `${method} ${path || ''}`;

                  // Check if this API endpoint is whitelisted in permissions.json
                  if (isApiEndpointAllowed(method, path, permissionsContext)) {
                    this.onDebug?.(`Auto-allowing API "${apiDescription}" (whitelisted in permissions.json)`);
                    return { continue: true };
                  }

                  // Check if this API pattern is already allowed (session whitelist)
                  if (this.permissionManager.isCommandWhitelisted(apiDescription)) {
                    this.onDebug?.(`Auto-allowing API "${apiDescription}" (previously approved)`);
                    return { continue: true };
                  }

                  const result = await requestPermission(
                    input.tool_use_id,
                    'API Call',
                    apiDescription,
                    apiDescription,
                    `API: ${apiDescription}`
                  );

                  if (!result.allowed) {
                    return {
                      continue: false,
                      decision: 'block' as const,
                      reason: 'User denied permission',
                    };
                  }
                }
              }

              // For Bash in 'ask' mode, check if we need permission
              if (input.tool_name === 'Bash' && permissionMode === 'ask') {
                // Extract command and base command
                const command = typeof input.tool_input === 'object' && input.tool_input !== null
                  ? (input.tool_input as Record<string, unknown>).command
                  : JSON.stringify(input.tool_input);
                const commandStr = String(command);
                const baseCommand = this.permissionManager.getBaseCommand(commandStr);

                // Auto-allow read-only commands (same ones allowed in Explore mode)
                // Use merged config to get actual patterns from default.json (SAFE_MODE_CONFIG has empty arrays)
                const mergedConfig = permissionsConfigCache.getMergedConfig(permissionsContext);
                const isReadOnly = mergedConfig.readOnlyBashPatterns.some(pattern => pattern.regex.test(commandStr.trim()));
                if (isReadOnly) {
                  this.onDebug?.(`Auto-allowing read-only command: ${baseCommand}`);
                  return { continue: true };
                }

                // Check if this base command is already allowed (and not dangerous)
                if (this.permissionManager.isCommandWhitelisted(baseCommand) && !this.permissionManager.isDangerousCommand(baseCommand)) {
                  this.onDebug?.(`Auto-allowing "${baseCommand}" (previously approved)`);
                  return { continue: true };
                }

                // For curl/wget, check if the domain is whitelisted
                if (['curl', 'wget'].includes(baseCommand)) {
                  const domain = this.permissionManager.extractDomainFromNetworkCommand(commandStr);
                  if (domain && this.permissionManager.isDomainWhitelisted(domain)) {
                    this.onDebug?.(`Auto-allowing ${baseCommand} to "${domain}" (domain whitelisted)`);
                    return { continue: true };
                  }
                }

                // Ask for permission
                const requestId = `perm-${input.tool_use_id}`;
                debug(`[PreToolUse] Requesting permission for Bash command: ${commandStr}`);

                const permissionPromise = new Promise<boolean>((resolve) => {
                  this.pendingPermissions.set(requestId, {
                    resolve,
                    toolName: input.tool_name,
                    command: commandStr,
                    baseCommand,
                  });
                });

                if (this.onPermissionRequest) {
                  this.onPermissionRequest({
                    requestId,
                    toolName: input.tool_name,
                    command: commandStr,
                    description: `Execute: ${commandStr}`,
                  });
                } else {
                  this.pendingPermissions.delete(requestId);
                  return {
                    continue: false,
                    decision: 'block' as const,
                    reason: 'No permission handler available',
                  };
                }

                const allowed = await permissionPromise;
                if (!allowed) {
                  return {
                    continue: false,
                    decision: 'block' as const,
                    reason: 'User denied permission',
                  };
                }
              }

              return { continue: true };
            }],
          }],
          // NOTE: PostToolUse hook was removed because updatedMCPToolOutput is not a valid SDK output field.
          // For API tools (api_*), summarization happens in api-tools.ts.
          // For external MCP servers (stdio/HTTP), we cannot modify their output - they're responsible
          // for their own size management via pagination or filtering.

          // ═══════════════════════════════════════════════════════════════════════════
          // SUBAGENT HOOKS: Logging only - parent tracking uses SDK's parent_tool_use_id
          // ═══════════════════════════════════════════════════════════════════════════
          SubagentStart: [{
            hooks: [async (input, _hookToolUseID) => {
              const typedInput = input as { agent_id?: string; agent_type?: string };
              debug(`[ClaudeAgent] SubagentStart: agent_id=${typedInput.agent_id}, type=${typedInput.agent_type}`);
              return { continue: true };
            }],
          }],
          SubagentStop: [{
            hooks: [async (input, _toolUseID) => {
              const typedInput = input as { agent_id?: string; agent_type?: string };
              debug(`[ClaudeAgent] SubagentStop: agent_id=${typedInput.agent_id}, type=${typedInput.agent_type ?? 'unknown'}`);
              // Warn on potential silent failure — if the SDK returns a subagent stop
              // but the subagent produced no usable output, downstream tool_result
              // will be empty. This helps diagnose 0-byte output crashes (see bold-fjord session).
              if (!typedInput.agent_id) {
                debug(`[ClaudeAgent] WARNING: SubagentStop with no agent_id — possible silent subagent failure`);
              }
              return { continue: true };
            }],
          }],
          };

          // Merge internal hooks with user hooks from hooks.json
          // Internal hooks run first (permissions), then user hooks
          const mergedHooks: Record<string, SdkHookCallbackMatcher[]> = { ...internalHooks };
          for (const [event, matchers] of Object.entries(userHooks) as [string, SdkHookCallbackMatcher[]][]) {
            if (mergedHooks[event]) {
              // Append user hooks after internal hooks
              mergedHooks[event] = [...mergedHooks[event]!, ...matchers];
            } else {
              // Add new event hooks
              mergedHooks[event] = matchers;
            }
          }

          return mergedHooks;
        })(),
        // Continue from previous session if we have one (enables conversation history & auto compaction)
        // Skip resume on retry (after session expiry) to start fresh
        // Pre-resume validation: check transcript is actually resumable before attempting.
        // Dequeue-only transcripts (≈139 bytes) from the first turn cause "No conversation found"
        // errors and trigger unnecessary SESSION_RECOVERY with "Restoring conversation context...".
        ...(() => {
          if (_isRetry || !this.sessionId) return {};
          const sdkCwd = this.config.session?.sdkCwd
            ?? (sessionId ? getSessionPath(this.workspaceRootPath, sessionId) : this.workspaceRootPath);
          if (isResumableTranscript(sdkCwd, this.sessionId)) {
            return { resume: this.sessionId };
          }
          // Transcript is not resumable — clear the stale session ID and start fresh
          debug('[SESSION_RECOVERY] Pre-resume: transcript not resumable for %s, clearing session ID', this.sessionId);
          console.error(`[ClaudeAgent] Pre-resume: transcript not resumable for ${this.sessionId}, starting fresh`);
          this.sessionId = null;
          this.config.onSdkSessionIdCleared?.();
          return {};
        })(),
        mcpServers,
        // NOTE: This callback is NOT called by the SDK because we set `permissionMode: 'bypassPermissions'` above.
        // All permission logic is handled via the PreToolUse hook instead (see hooks.PreToolUse above).
        // Skill qualification and Bash permission logic are in PreToolUse where they actually execute.
        canUseTool: async (_toolName, input) => {
          return { behavior: 'allow' as const, updatedInput: input as Record<string, unknown> };
        },
        // Selectively disable tools - file tools are disabled (use MCP), web/code controlled by settings
        disallowedTools,
        // Load workspace as SDK plugin (enables skills, commands, agents from workspace)
        plugins: [{ type: 'local' as const, path: this.workspaceRootPath }],
      };

      // Track whether we're trying to resume a session (for error handling)
      const wasResuming = !_isRetry && !!this.sessionId;

      // Log resume attempt for debugging session failures
      if (wasResuming) {
        console.error(`[ClaudeAgent] Attempting to resume SDK session: ${this.sessionId}`);
        debug(`[ClaudeAgent] Attempting to resume SDK session: ${this.sessionId}`);
      } else {
        console.error(`[ClaudeAgent] Starting fresh SDK session (no resume)`);
        debug(`[ClaudeAgent] Starting fresh SDK session (no resume)`);
      }

      // Create AbortController for this query - allows force-stopping via forceAbort()
      this.currentQueryAbortController = new AbortController();
      const optionsWithAbort = {
        ...options,
        abortController: this.currentQueryAbortController,
      };

      // Known SDK slash commands that bypass context wrapping.
      // These are sent directly to the SDK without date/session/source context.
      // Currently only 'compact' is supported - add more here as needed.
      const SDK_SLASH_COMMANDS = ['compact'] as const;

      // Detect SDK slash commands - must be sent directly without context wrapping.
      // Pattern: /command or /command <instructions>
      const trimmedMessage = userMessage.trim();
      const commandMatch = trimmedMessage.match(/^\/([a-z]+)(\s|$)/i);
      const commandName = commandMatch?.[1]?.toLowerCase();
      const isSlashCommand = commandName &&
        SDK_SLASH_COMMANDS.includes(commandName as typeof SDK_SLASH_COMMANDS[number]) &&
        !attachments?.length;

      // Create the query - handle slash commands, binary attachments, or regular messages
      if (isSlashCommand) {
        // Send slash commands directly to SDK without context wrapping.
        // The SDK processes these as internal commands (e.g., /compact triggers compaction).
        debug(`[chat] Detected SDK slash command: ${trimmedMessage}`);
        this.currentQuery = query({ prompt: trimmedMessage, options: optionsWithAbort });
      } else if (hasBinaryAttachments) {
        const sdkMessage = this.buildSDKUserMessage(userMessage, attachments);
        async function* singleMessage(): AsyncIterable<SDKUserMessage> {
          yield sdkMessage;
        }
        this.currentQuery = query({ prompt: singleMessage(), options: optionsWithAbort });
      } else {
        // Simple string prompt for text-only messages (may include text file contents)
        const prompt = this.buildTextPrompt(userMessage, attachments);
        this.currentQuery = query({ prompt, options: optionsWithAbort });
      }

      // ── Pipeline context compaction notification (one-time per session) ──
      if (this._lastContextWasCompacted && !this.contextCompactionNotified) {
        yield {
          type: 'info',
          message: `Note: Prior research pipeline data was compacted to fit the context budget. Some stage details were summarized.`,
        };
        this.contextCompactionNotified = true;
        debug('[chat] Pipeline context was compacted — notified user');
      }

      // ═══════════════════════════════════════════════════════════════════════════
      // STATELESS TOOL MATCHING (see tool-matching.ts for details)
      // ═══════════════════════════════════════════════════════════════════════════
      //
      // Tool matching uses direct ID-based lookup instead of FIFO queues.
      // The SDK provides:
      // - parent_tool_use_id on every message → identifies subagent context
      // - tool_use_id on tool_result content blocks → directly identifies which tool
      //
      // This eliminates order-dependent matching. Same messages → same output.
      //
      // Three data structures are needed:
      // - toolIndex: append-only map of toolUseId → {name, input} (order-independent)
      // - emittedToolStarts: append-only set for stream/assistant dedup (order-independent)
      // - activeParentTools: tracks running Task tool IDs for fallback parent assignment
      //   (used when SDK's parent_tool_use_id is null but a Task is active)
      // ═══════════════════════════════════════════════════════════════════════════
      const toolIndex = new ToolIndex();
      const emittedToolStarts = new Set<string>();
      const activeParentTools = new Set<string>();
      // Session directory for reading tool metadata — prevents race condition when
      // concurrent sessions clobber the singleton _sessionDir in toolMetadataStore.
      const metadataSessionDir = getSessionPath(this.workspaceRootPath, sessionId);

      // Process SDK messages and convert to AgentEvents
      let receivedComplete = false;
      // Track text waiting for stop_reason from message_delta
      let pendingTextForStopReason: string | null = null;
      // Track current turn ID from message_start (correlation ID for grouping events)
      let currentTurnId: string | null = null;
      // Track whether we received any assistant content (for empty response detection)
      // When SDK returns empty response (e.g., failed resume), we need to detect and recover
      let receivedAssistantContent = false;
      try {
        for await (const message of this.currentQuery) {
          // Track if we got any text content from assistant
          if ('type' in message && message.type === 'assistant' && 'message' in message) {
            const assistantMsg = message.message as { content?: unknown[] };
            if (assistantMsg.content && Array.isArray(assistantMsg.content) && assistantMsg.content.length > 0) {
              receivedAssistantContent = true;
            }
          }
          // Also track text_delta events as assistant content (nested in stream_event)
          if ('type' in message && message.type === 'stream_event' && 'event' in message) {
            const event = (message as { event: { type: string } }).event;
            if (event.type === 'content_block_delta' || event.type === 'message_start') {
              receivedAssistantContent = true;
            }
          }

          // Capture session ID for conversation continuity.
          // IMPORTANT: Only trust the canonical system:init message.
          // Other SDK messages may carry session_id fields that are not safe to
          // persist for resume, which can cause next-turn resume failures.
          if (
            'type' in message &&
            message.type === 'system' &&
            'subtype' in message &&
            message.subtype === 'init' &&
            'session_id' in message &&
            message.session_id &&
            message.session_id !== this.sessionId
          ) {
            this.sessionId = message.session_id;
            // Notify caller of new SDK session ID (for immediate persistence)
            this.config.onSdkSessionIdUpdate?.(message.session_id);
          }

          const events = await this.convertSDKMessage(
            message,
            toolIndex,
            emittedToolStarts,
            activeParentTools,
            pendingTextForStopReason,
            (text) => { pendingTextForStopReason = text; },
            currentTurnId,
            (id) => { currentTurnId = id; },
            metadataSessionDir,
          );
          for (const event of events) {
            // Check for tool-not-found errors on inactive sources and attempt auto-activation
            const inactiveSourceError = this.detectInactiveSourceToolError(event, toolIndex);

            if (inactiveSourceError && this.onSourceActivationRequest) {
              const { sourceSlug, toolName } = inactiveSourceError;

              this.onDebug?.(`Detected tool call to inactive source "${sourceSlug}", attempting activation...`);

              try {
                const activated = await this.onSourceActivationRequest(sourceSlug);

                if (activated) {
                  this.onDebug?.(`Source "${sourceSlug}" activated successfully, interrupting turn for auto-retry`);

                  // Yield source_activated event immediately for auto-retry
                  yield {
                    type: 'source_activated' as const,
                    sourceSlug,
                    originalMessage: userMessage,
                  };

                  // Interrupt the turn - no point letting the model continue without the tools
                  // The abort will cause the loop to exit and emit 'complete'
                  this.forceAbort(AbortReason.SourceActivated);
                  return; // Exit the generator
                } else {
                  this.onDebug?.(`Source "${sourceSlug}" activation failed (may need auth)`);
                  // Let the original error through, but with more context
                  const toolResultEvent = event as Extract<AgentEvent, { type: 'tool_result' }>;
                  yield {
                    type: 'tool_result' as const,
                    toolUseId: toolResultEvent.toolUseId,
                    toolName: toolResultEvent.toolName,
                    result: `Source "${sourceSlug}" could not be activated. It may require authentication. Please check the source status in the sources panel.`,
                    isError: true,
                    input: toolResultEvent.input,
                    turnId: toolResultEvent.turnId,
                    parentToolUseId: toolResultEvent.parentToolUseId,
                  };
                  continue;
                }
              } catch (error) {
                this.onDebug?.(`Source "${sourceSlug}" activation error: ${error}`);
                // Let original error through
              }
            }

            // ── Session-expiry recovery (result-error channel) ──────────────
            // The SDK can deliver "No conversation found with session ID" as a
            // result-error event rather than throwing.  Intercept BEFORE yielding
            // so the user never sees the raw error.  One retry with a fresh
            // session is attempted; if the retry also fails the catch block
            // surfaces the error normally.
            if (
              event.type === 'error' &&
              wasResuming &&
              !_isRetry &&
              isSessionExpiredError(event.message)
            ) {
              console.error('[ClaudeAgent] Session expired (result-error channel), clearing and retrying fresh');
              debug('[SESSION_RECOVERY] result-error channel: detected session expiry, retrying fresh');
              this.sessionId = null;
              this.config.onSdkSessionIdCleared?.();
              this.pinnedPreferencesPrompt = null;
              this.preferencesDriftNotified = false;
              this.contextCompactionNotified = false;
              yield { type: 'info', message: 'Session expired, restoring context...' };
              yield* this.chat(userMessage, attachments, { isRetry: true });
              return;
            }

            if (event.type === 'complete') {
              receivedComplete = true;
            }
            yield event;
          }
        }

        // Detect empty response when resuming - SDK silently fails resume if session is invalid
        // In this case, we got a new session ID but no assistant content
        debug('[SESSION_DEBUG] Post-loop check: wasResuming=', wasResuming, 'receivedAssistantContent=', receivedAssistantContent, '_isRetry=', _isRetry);
        if (wasResuming && !receivedAssistantContent && !_isRetry) {
          debug('[SESSION_DEBUG] >>> DETECTED EMPTY RESPONSE - triggering recovery');
          // SDK resume failed silently - clear session and retry with context
          this.sessionId = null;
          // Notify that we're clearing the session ID (for persistence)
          this.config.onSdkSessionIdCleared?.();
          // Clear pinned state for fresh start
          this.pinnedPreferencesPrompt = null;
          this.preferencesDriftNotified = false;
          this.contextCompactionNotified = false;

          // Build recovery context from previous messages to inject into retry
          const recoveryContext = this.buildRecoveryContext();
          const messageWithContext = recoveryContext
            ? recoveryContext + userMessage
            : userMessage;

          yield { type: 'info', message: 'Restoring conversation context...' };
          // Retry with fresh session, injecting conversation history into the message
          yield* this.chat(messageWithContext, attachments, { isRetry: true });
          return;
        }

        // Defensive: flush any pending text that wasn't emitted
        // This can happen if the SDK sends an assistant message with text but skips the
        // message_delta event that normally triggers text_complete (e.g., in some ultrathink scenarios)
        if (pendingTextForStopReason) {
          yield { type: 'text_complete', text: pendingTextForStopReason, isIntermediate: false, turnId: currentTurnId || undefined };
          pendingTextForStopReason = null;
        }

        // Defensive: emit complete if SDK didn't send result message
        if (!receivedComplete) {
          yield { type: 'complete' };
        }
      } catch (sdkError) {
        // Debug: log inner catch trigger (stderr to avoid SDK JSON pollution)
        console.error(`[ClaudeAgent] INNER CATCH triggered: ${sdkError instanceof Error ? sdkError.message : String(sdkError)}`);

        // Handle user interruption
        if (sdkError instanceof AbortError) {
          const reason = this.lastAbortReason;
          this.lastAbortReason = null;  // Clear for next time

          // If interrupted before receiving any assistant content AND this was the first message,
          // clear session ID to prevent broken resume state where SDK session file is empty/invalid.
          // For later messages (messageCount > 0), keep the session ID to preserve conversation history.
          // The SDK session file should have valid previous turns we can resume from.
          if (!receivedAssistantContent && this.sessionId) {
            // Check if there are previous messages (completed turns) in this session
            // If yes, keep the session ID to preserve history on resume
            const hasCompletedTurns = this.config.getRecoveryMessages && this.config.getRecoveryMessages().length > 0;

            if (!hasCompletedTurns) {
              // First message was interrupted before any response - SDK session is empty/corrupt
              debug('[SESSION_DEBUG] First message interrupted before assistant content - clearing sdkSessionId:', this.sessionId);
              this.sessionId = null;
              this.config.onSdkSessionIdCleared?.();
            } else {
              // Later message interrupted - SDK session has valid history, keep it for resume
              debug('[SESSION_DEBUG] Later message interrupted - keeping sdkSessionId for history preservation:', this.sessionId);
            }
          }

          // Only emit "Interrupted" status for user-initiated stops
          // Plan submissions and redirects should be silent
          if (reason === AbortReason.UserStop) {
            yield { type: 'status', message: 'Interrupted' };
          }
          yield { type: 'complete' };
          return;
        }

        // Get error message regardless of error type
        // Note: SDK text errors like "API Error: 402..." are primarily handled in useAgent.ts
        // via text_complete event. This is a fallback for errors that don't emit text first.
        // parseError() will detect status codes (402, 401, etc.) in the raw message.
        const rawErrorMsg = sdkError instanceof Error ? sdkError.message : String(sdkError);
        const errorMsg = rawErrorMsg.toLowerCase();

        // Debug logging - always log the actual error and context
        this.onDebug?.(`Error in chat: ${rawErrorMsg}`);
        this.onDebug?.(`Context: wasResuming=${wasResuming}, isRetry=${_isRetry}`);

        // Check for auth errors - these won't be fixed by clearing session
        const isAuthError =
          errorMsg.includes('unauthorized') ||
          errorMsg.includes('401') ||
          errorMsg.includes('authentication failed') ||
          errorMsg.includes('invalid api key') ||
          errorMsg.includes('invalid x-api-key');

        if (isAuthError) {
          // Auth errors surface immediately - session manager handles retry by recreating agent
          const typedError = parseError(new Error(rawErrorMsg));
          yield { type: 'typed_error', error: typedError };
          yield { type: 'complete' };
          return;
        }

        // Rate limit errors - don't retry immediately, surface to user
        const isRateLimitError =
          errorMsg.includes('429') ||
          errorMsg.includes('rate limit') ||
          errorMsg.includes('too many requests');

        if (isRateLimitError) {
          // Parse to typed error using the captured/processed error message
          const typedError = parseError(new Error(rawErrorMsg));
          yield { type: 'typed_error', error: typedError };
          yield { type: 'complete' };
          return;
        }

        // Check for billing/payment errors (402) - don't retry these
        const isBillingError =
          errorMsg.includes('402') ||
          errorMsg.includes('payment required') ||
          errorMsg.includes('billing');

        if (isBillingError) {
          // Parse to typed error using the captured/processed error message, not the original SDK error
          // This ensures parseError sees "402 Payment required" instead of "process exited with code 1"
          const typedError = parseError(new Error(rawErrorMsg));
          yield { type: 'typed_error', error: typedError };
          yield { type: 'complete' };
          return;
        }

        // Check for .claude.json corruption — the SDK subprocess crashes if this file
        // is empty, BOM-encoded, or contains invalid JSON. Two error patterns:
        //   1. "CLI output was not valid JSON" — CLI wrote plain-text error to stdout
        //   2. "process exited with code 1" with stderr mentioning config corruption
        // See: claude-code#14442 (BOM), #2593 (empty file), #18998 (race condition)
        const stderrForConfigCheck = this.lastStderrOutput.join('\n').toLowerCase();
        const isConfigCorruption =
          (errorMsg.includes('not valid json') && (errorMsg.includes('claude') || errorMsg.includes('configuration'))) ||
          (errorMsg.includes('process exited with code') && (
            stderrForConfigCheck.includes('claude.json') ||
            stderrForConfigCheck.includes('configuration file') ||
            stderrForConfigCheck.includes('corrupted')
          ));

        if (isConfigCorruption && !_isRetry) {
          debug('[ClaudeAgent] Detected .claude.json corruption, repairing and retrying...');
          // Reset the once-per-process guard so ensureClaudeConfig() runs again
          // on the retry — it will repair the file before the next subprocess spawn
          resetClaudeConfigCheck();
          yield { type: 'info', message: 'Repairing configuration file...' };
          yield* this.chat(userMessage, attachments, { isRetry: true });
          return;
        }

        // Check for SDK process errors - these often wrap underlying billing/auth issues
        // The SDK's internal Claude Code process exits with code 1 for various API errors
        const isProcessError = errorMsg.includes('process exited with code');

        // [SESSION_DEBUG] Comprehensive logging for session recovery investigation
        debug('[SESSION_DEBUG] === ERROR HANDLER ENTRY ===');
        debug('[SESSION_DEBUG] errorMsg:', errorMsg);
        debug('[SESSION_DEBUG] rawErrorMsg:', rawErrorMsg);
        debug('[SESSION_DEBUG] isProcessError:', isProcessError);
        debug('[SESSION_DEBUG] wasResuming:', wasResuming);
        debug('[SESSION_DEBUG] _isRetry:', _isRetry);
        debug('[SESSION_DEBUG] this.sessionId:', this.sessionId);
        debug('[SESSION_DEBUG] lastStderrOutput length:', this.lastStderrOutput.length);
        debug('[SESSION_DEBUG] lastStderrOutput:', this.lastStderrOutput.join('\n'));

        // ── Session-expiry recovery (catch-path) ─────────────────────────────
        // Check both stderr and the main error message for session-expiry
        // indicators.  This is hoisted ABOVE the isProcessError gate so that
        // errors surfaced directly (not wrapped in "process exited with code")
        // are also caught.  Only one retry is allowed (guarded by _isRetry).
        const stderrContext = this.lastStderrOutput.length > 0
          ? this.lastStderrOutput.join('\n')
          : undefined;

        const sessionExpiredInCatch =
          isSessionExpiredError(stderrContext) ||
          isSessionExpiredError(rawErrorMsg);

        if (sessionExpiredInCatch && wasResuming && !_isRetry) {
          debug('[SESSION_RECOVERY] catch-path: detected session expiry, retrying fresh');
          console.error('[ClaudeAgent] SDK session expired (catch-path), clearing and retrying fresh');
          this.sessionId = null;
          this.config.onSdkSessionIdCleared?.();
          this.pinnedPreferencesPrompt = null;
          this.preferencesDriftNotified = false;
          this.contextCompactionNotified = false;
          yield { type: 'info', message: 'Session expired, restoring context...' };
          yield* this.chat(userMessage, attachments, { isRetry: true });
          return;
        }

        if (isProcessError) {
          if (stderrContext) {
            debug('[SDK process error] Captured stderr:', stderrContext);
          }

          // Check for Windows SDK setup error (missing .claude/skills directory)
          const windowsSkillsError = buildWindowsSkillsDirError(stderrContext || rawErrorMsg);
          if (windowsSkillsError) {
            yield windowsSkillsError;
            yield { type: 'complete' };
            return;
          }

          debug('[SESSION_DEBUG] >>> TAKING PATH: Run diagnostics (not session expired)');

          // Run diagnostics to identify specific cause (2s timeout)
          // Derive authType from the default LLM connection
          const { getDefaultLlmConnection, getLlmConnection } = await import('../config/storage.ts');
          const defaultConnSlug = getDefaultLlmConnection();
          const connection = defaultConnSlug ? getLlmConnection(defaultConnSlug) : null;
          // Map connection authType to legacy AuthType format for diagnostics
          let diagnosticAuthType: AuthType | undefined;
          if (connection) {
            if (connection.authType === 'api_key' || connection.authType === 'api_key_with_endpoint' || connection.authType === 'bearer_token') {
              diagnosticAuthType = 'api_key';
            } else if (connection.authType === 'oauth') {
              diagnosticAuthType = 'oauth_token';
            }
          }
          const diagnostics = await runErrorDiagnostics({
            authType: diagnosticAuthType,
            workspaceId: this.config.workspace?.id,
            rawError: stderrContext || rawErrorMsg,
          });

          debug('[SESSION_DEBUG] diagnostics.code:', diagnostics.code);
          debug('[SESSION_DEBUG] diagnostics.title:', diagnostics.title);
          debug('[SESSION_DEBUG] diagnostics.message:', diagnostics.message);

          // Get recovery actions based on diagnostic code
          const actions = diagnostics.code === 'token_expired' || diagnostics.code === 'mcp_unreachable'
            ? [
                { key: 'w', label: 'Open workspace menu', command: '/workspace' },
                { key: 'r', label: 'Retry', action: 'retry' as const },
              ]
            : diagnostics.code === 'invalid_credentials' || diagnostics.code === 'billing_error'
            ? [
                { key: 's', label: 'Update credentials', command: '/settings', action: 'settings' as const },
              ]
            : [
                { key: 'r', label: 'Retry', action: 'retry' as const },
                { key: 's', label: 'Check settings', command: '/settings', action: 'settings' as const },
              ];

          yield {
            type: 'typed_error',
            error: {
              code: diagnostics.code,
              title: diagnostics.title,
              message: diagnostics.message,
              // Include stderr in details if we captured any useful output
              details: stderrContext
                ? [...(diagnostics.details || []), `SDK stderr: ${stderrContext}`]
                : diagnostics.details,
              actions,
              canRetry: diagnostics.code !== 'billing_error' && diagnostics.code !== 'invalid_credentials',
              retryDelayMs: 1000,
              originalError: stderrContext || rawErrorMsg,
            },
          };
          yield { type: 'complete' };
          return;
        }

        // Session-related retry: only if we were resuming and haven't retried yet
        debug('[SESSION_DEBUG] isProcessError=false, checking wasResuming fallback');
        if (wasResuming && !_isRetry) {
          debug('[SESSION_RECOVERY] wasResuming fallback retry');
          this.sessionId = null;
          this.config.onSdkSessionIdCleared?.();
          // Clear pinned state so retry captures fresh values
          this.pinnedPreferencesPrompt = null;
          this.preferencesDriftNotified = false;
          this.contextCompactionNotified = false;

          // Provide context-aware message (conservative: only match explicit session/resume terms)
          const isSessionError =
            errorMsg.includes('session') ||
            errorMsg.includes('resume');

          debug('[SESSION_DEBUG] isSessionError (for message):', isSessionError);

          const statusMessage = isSessionError
            ? 'Conversation sync failed, starting fresh...'
            : 'Request failed, retrying without history...';

          // Use 'info' instead of 'status' to show message without spinner
          yield { type: 'info', message: statusMessage };
          // Recursively call with isRetry=true (yield* delegates all events)
          yield* this.chat(userMessage, attachments, { isRetry: true });
          return;
        }

        debug('[SESSION_DEBUG] >>> TAKING PATH: Final fallback (show generic error)');
        // Retry also failed, or wasn't resuming - show generic error
        // (Auth, billing, and rate limit errors are handled above)
        const rawMessage = sdkError instanceof Error ? sdkError.message : String(sdkError);

        yield { type: 'error', message: rawMessage };
        yield { type: 'complete' };
        return;
      }

    } catch (error) {
      // Debug: log outer catch trigger (stderr to avoid SDK JSON pollution)
      console.error(`[ClaudeAgent] OUTER CATCH triggered: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`[ClaudeAgent] Error stack: ${error instanceof Error ? error.stack : 'no stack'}`);

      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check if this is a recognizable error type
      const typedError = parseError(error);
      if (typedError.code !== 'unknown_error') {
        // Known error type - show user-friendly message with recovery actions
        yield { type: 'typed_error', error: typedError };
      } else {
        // Unknown error - show raw message
        yield { type: 'error', message: errorMessage };
      }
      // emit complete even on error so application knows we're done
      yield { type: 'complete' };
    } finally {
      // Cleanup safety net for normal completion (no forceAbort called).
      // When forceAbort() WAS called: this.currentQuery is already null (forceAbort nulled it
      // and scheduled a delayed close), so queryRef is null and close() is not called again.
      // When forceAbort() was NOT called: close the query to prevent orphaned CLI subprocesses.
      const queryRef = this.currentQuery;
      this.currentQuery = null;
      if (queryRef) {
        try {
          queryRef.close();
        } catch {
          // Query may already be cleaned up — safe to ignore
        }
      }
      // Reset ultrathink override after query completes (single-shot per-message boost)
      // Note: thinkingLevel is NOT reset - it's sticky for the session
      this._ultrathinkOverride = false;
    }
  }

  // formatSourceState() and getAuthToolName() are now delegated to this.sourceManager

  // buildRecoveryContext() is now inherited from BaseAgent
  // formatWorkspaceCapabilities() is now in PromptBuilder

  /**
   * Build a simple text prompt with embedded text file contents (for text-only messages)
   * Prepends date/time context for prompt caching optimization (keeps system prompt static)
   * Injects session state (including mode state) for every message
   */
  private buildTextPrompt(text: string, attachments?: FileAttachment[]): string {
    const parts: string[] = [];

    // Add context parts using centralized PromptBuilder
    // This includes: date/time, session state (with plansFolderPath),
    // orchestrator summary (if available), workspace capabilities, and working directory context
    const sessionId = this.config.session?.id ?? `temp-${Date.now()}`;
    const sessionPath = getSessionPath(this.workspaceRootPath, sessionId);
    const { parts: contextParts, contextWasCompacted } = this.promptBuilder.buildContextParts(
      {
        plansFolderPath: getSessionPlansPath(this.workspaceRootPath, this.modeSessionId),
        sessionPath,
      },
      this.sourceManager.formatSourceState()
    );

    // Track compaction state for downstream notification in chat()
    this._lastContextWasCompacted = contextWasCompacted;

    parts.push(...contextParts);

    // Add file attachments with stored path info (agent uses Read tool to access content)
    // Text files are NOT embedded inline to prevent context overflow from large files
    if (attachments) {
      for (const attachment of attachments) {
        if (attachment.storedPath) {
          let pathInfo = `[Attached file: ${attachment.name}]`;
          pathInfo += `\n[Stored at: ${attachment.storedPath}]`;
          if (attachment.markdownPath) {
            pathInfo += `\n[Markdown version: ${attachment.markdownPath}]`;
          }
          parts.push(pathInfo);
        }
      }
    }

    // Add user's message
    if (text) {
      parts.push(text);
    }

    return parts.join('\n\n');
  }

  /**
   * Build an SDK user message with proper content blocks for binary attachments
   * Prepends date/time context for prompt caching optimization (keeps system prompt static)
   * Injects session state (including mode state) for every message
   */
  private buildSDKUserMessage(text: string, attachments?: FileAttachment[]): SDKUserMessage {
    const contentBlocks: ContentBlockParam[] = [];

    // Add context parts using centralized PromptBuilder
    // This includes: date/time, session state (with plansFolderPath),
    // orchestrator summary (if available), workspace capabilities, and working directory context
    const sdkSessionId = this.config.session?.id ?? `temp-${Date.now()}`;
    const sdkSessionPath = getSessionPath(this.workspaceRootPath, sdkSessionId);
    const { parts: contextParts, contextWasCompacted } = this.promptBuilder.buildContextParts(
      {
        plansFolderPath: getSessionPlansPath(this.workspaceRootPath, this.modeSessionId),
        sessionPath: sdkSessionPath,
      },
      this.sourceManager.formatSourceState()
    );

    // Track compaction state for downstream notification in chat()
    this._lastContextWasCompacted = contextWasCompacted;

    for (const part of contextParts) {
      contentBlocks.push({ type: 'text', text: part });
    }

    // Add attachments - images/PDFs are uploaded inline, text files are path-only
    // Text files are NOT embedded to prevent context overflow; agent uses Read tool
    if (attachments) {
      for (const attachment of attachments) {
        // Add path info text block so the agent knows where the file is stored
        // This enables the agent to use the Read tool to access text/office files
        if (attachment.storedPath) {
          let pathInfo = `[Attached file: ${attachment.name}]\n[Stored at: ${attachment.storedPath}]`;
          if (attachment.markdownPath) {
            pathInfo += `\n[Markdown version: ${attachment.markdownPath}]`;
          }
          contentBlocks.push({
            type: 'text',
            text: pathInfo,
          });
        }

        // Only images and PDFs are uploaded inline (agent cannot read these with Read tool)
        if (attachment.type === 'image' && attachment.base64) {
          const mediaType = this.mapImageMediaType(attachment.mimeType);
          if (mediaType) {
            contentBlocks.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: attachment.base64,
              },
            });
          }
        } else if (attachment.type === 'pdf' && attachment.base64) {
          contentBlocks.push({
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: attachment.base64,
            },
          });
        }
        // Text files: path info already added above, agent uses Read tool to access content
      }
    }

    // Add user's text message
    if (text.trim()) {
      contentBlocks.push({ type: 'text', text });
    }

    return {
      type: 'user',
      message: {
        role: 'user',
        content: contentBlocks,
      },
      parent_tool_use_id: null,
      // Session resumption is handled by options.resume, not here
      // Setting session_id here with resume option causes SDK to return empty response
      session_id: '',
    } as SDKUserMessage;
  }

  /**
   * Map file MIME types to SDK-supported image types
   */
  private mapImageMediaType(mimeType?: string): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | null {
    if (!mimeType) return null;
    const supported: Record<string, 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'> = {
      'image/jpeg': 'image/jpeg',
      'image/png': 'image/png',
      'image/gif': 'image/gif',
      'image/webp': 'image/webp',
    };
    return supported[mimeType] || null;
  }

  /**
   * Parse actual API error from SDK debug log file.
   * The SDK logs errors like: [ERROR] Error in non-streaming fallback: 400 {"type":"error","error":{"type":"invalid_request_error","message":"Could not process image"},"request_id":"req_..."}
   * These go to ~/.claude/debug/{sessionId}.txt, NOT to stderr.
   *
   * Uses async retries with non-blocking delays to handle race condition where
   * SDK may still be writing to the debug file when the error event is received.
   */
  private async parseApiErrorFromDebugLog(): Promise<{ errorType: string; message: string; requestId?: string } | null> {
    if (!this.sessionId) return null;

    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const debugFilePath = path.join(os.homedir(), '.claude', 'debug', `${this.sessionId}.txt`);

    // Helper for non-blocking delay
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    // Retry up to 3 times with 50ms delays to handle race condition
    // where SDK emits error event before finishing debug file write
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (!fs.existsSync(debugFilePath)) {
          // File doesn't exist yet, wait and retry
          if (attempt < 2) {
            await delay(50);
            continue;
          }
          return null;
        }

        // Read the file and get last 50 lines to find recent errors
        const content = fs.readFileSync(debugFilePath, 'utf-8');
        const lines = content.split('\n').slice(-50);

        // Search backwards for the most recent [ERROR] line with JSON
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i];
          // Match [ERROR] lines containing JSON with error details
          const errorMatch = line.match(/\[ERROR\].*?(\{.*\})/);
          if (errorMatch && errorMatch[1]) {
            try {
              const parsed = JSON.parse(errorMatch[1]);
              if (parsed?.error?.message) {
                return {
                  errorType: parsed.error.type || 'error',
                  message: parsed.error.message,
                  requestId: parsed.request_id,
                };
              }
            } catch {
              // Not valid JSON, continue searching
            }
          }
        }

        // File exists but no error found yet, wait and retry
        if (attempt < 2) {
          await delay(50);
        }
      } catch {
        // File read error, wait and retry
        if (attempt < 2) {
          await delay(50);
        }
      }
    }
    return null;
  }

  /**
   * Map SDK assistant message error codes to typed error events with user-friendly messages.
   * Reads from SDK debug log file to extract actual API error details.
   */
  private async mapSDKErrorToTypedError(
    errorCode: SDKAssistantMessageError
  ): Promise<{ type: 'typed_error'; error: AgentError }> {
    // Try to extract actual error message from SDK debug log file
    const actualError = await this.parseApiErrorFromDebugLog();
    const errorMap: Record<SDKAssistantMessageError, AgentError> = {
      'authentication_failed': {
        code: 'invalid_api_key',
        title: 'Authentication Failed',
        message: 'Unable to authenticate with Anthropic. Your API key may be invalid or expired.',
        details: ['Check your API key in settings', 'Ensure your API key has not been revoked'],
        actions: [
          { key: 's', label: 'Settings', action: 'settings' },
          { key: 'r', label: 'Retry', action: 'retry' },
        ],
        canRetry: true,
        retryDelayMs: 1000,
      },
      'billing_error': {
        code: 'billing_error',
        title: 'Billing Error',
        message: 'Your account has a billing issue.',
        details: ['Check your Anthropic account billing status'],
        actions: [
          { key: 's', label: 'Update credentials', action: 'settings' },
        ],
        canRetry: false,
      },
      'rate_limit': {
        code: 'rate_limited',
        title: 'Rate Limit Exceeded',
        message: 'Too many requests. Please wait a moment before trying again.',
        details: ['Rate limits reset after a short period', 'Consider upgrading your plan for higher limits'],
        actions: [
          { key: 'r', label: 'Retry', action: 'retry' },
        ],
        canRetry: true,
        retryDelayMs: 5000,
      },
      'invalid_request': {
        code: 'invalid_request',
        title: 'Invalid Request',
        message: 'The API rejected this request.',
        details: [
          ...(actualError ? [
            `Error: ${actualError.message}`,
            `Type: ${actualError.errorType}`,
            ...(actualError.requestId ? [`Request ID: ${actualError.requestId}`] : []),
          ] : []),
          'Try removing any attachments and resending',
          'Check if images are in a supported format (PNG, JPEG, GIF, WebP)',
        ],
        actions: [
          { key: 'r', label: 'Retry', action: 'retry' },
        ],
        canRetry: true,
        retryDelayMs: 1000,
      },
      'server_error': {
        code: 'network_error',
        title: 'Connection Error',
        message: 'Unable to connect to the API server. Check your internet connection.',
        details: [
          'Verify your network connection is active',
          'Check if the API endpoint is accessible',
          'Firewall or VPN may be blocking the connection',
        ],
        actions: [
          { key: 'r', label: 'Retry', action: 'retry' },
        ],
        canRetry: true,
        retryDelayMs: 2000,
      },
      'max_output_tokens': {
        code: 'invalid_request',
        title: 'Output Limit Reached',
        message: 'The response exceeded the maximum output token limit.',
        details: [
          'The model generated more output than allowed',
          'Try breaking your request into smaller parts',
        ],
        actions: [
          { key: 'r', label: 'Retry', action: 'retry' },
        ],
        canRetry: true,
        retryDelayMs: 1000,
      },
      'unknown': {
        code: 'unknown_error',
        title: 'Unknown Error',
        message: 'An unexpected error occurred.',
        details: [
          ...(actualError ? [
            `Error: ${actualError.message}`,
            `Type: ${actualError.errorType}`,
            ...(actualError.requestId ? [`Request ID: ${actualError.requestId}`] : []),
          ] : []),
          'This may be a temporary issue',
          'Check your network connection',
        ],
        actions: [
          { key: 'r', label: 'Retry', action: 'retry' },
        ],
        canRetry: true,
        retryDelayMs: 2000,
      },
    };

    const error = errorMap[errorCode];
    return {
      type: 'typed_error',
      error,
    };
  }

  private async convertSDKMessage(
    message: SDKMessage,
    toolIndex: ToolIndex,
    emittedToolStarts: Set<string>,
    activeParentTools: Set<string>,
    pendingText: string | null,
    setPendingText: (text: string | null) => void,
    turnId: string | null,
    setTurnId: (id: string | null) => void,
    sessionDir?: string,
  ): Promise<AgentEvent[]> {
    const events: AgentEvent[] = [];

    // Debug: log all SDK message types to understand MCP tool result flow
    if (this.onDebug) {
      const msgInfo = message.type === 'user' && 'tool_use_result' in message
        ? `user (tool_result for ${(message as any).parent_tool_use_id})`
        : message.type;
      this.onDebug(`SDK message: ${msgInfo}`);
    }

    switch (message.type) {
      case 'assistant': {
        // Check for SDK-level errors FIRST (auth, network, rate limits, etc.)
        // These errors are set by the SDK when API calls fail
        if ('error' in message && message.error) {
          // Extract actual API error from SDK debug log for better error details
          // Uses async to allow retry with delays for race condition handling
          const errorEvent = await this.mapSDKErrorToTypedError(message.error);
          events.push(errorEvent);
          // Don't process content blocks when there's an error
          break;
        }

        // Skip replayed messages when resuming a session - they're historical
        if ('isReplay' in message && message.isReplay) {
          break;
        }

        // Track usage from non-sidechain assistant messages for accurate context window display
        // Skip sidechain messages (from subagents) - only main chain affects primary context
        const isSidechain = message.parent_tool_use_id !== null;
        if (!isSidechain && message.message.usage) {
          this.lastAssistantUsage = {
            input_tokens: message.message.usage.input_tokens,
            cache_read_input_tokens: message.message.usage.cache_read_input_tokens ?? 0,
            cache_creation_input_tokens: message.message.usage.cache_creation_input_tokens ?? 0,
          };

          // Emit real-time usage update for context display
          // inputTokens = context size actually sent to API (includes cache tokens)
          const currentInputTokens =
            this.lastAssistantUsage.input_tokens +
            this.lastAssistantUsage.cache_read_input_tokens +
            this.lastAssistantUsage.cache_creation_input_tokens;

          events.push({
            type: 'usage_update',
            usage: {
              inputTokens: currentInputTokens,
              // contextWindow comes from modelUsage in result - use cached value if available
              contextWindow: this.cachedContextWindow,
            },
          });
        }

        // Full assistant message with content blocks
        const content = message.message.content;

        // Extract text from content blocks
        let textContent = '';
        for (const block of content) {
          if (block.type === 'text') {
            textContent += block.text;
          }
        }

        // Stateless tool start extraction — uses SDK's parent_tool_use_id directly.
        // Falls back to activeParentTools when SDK doesn't provide parent info.
        const sdkParentId = message.parent_tool_use_id;
        const toolStartEvents = extractToolStarts(
          content as ContentBlock[],
          sdkParentId,
          toolIndex,
          emittedToolStarts,
          turnId || undefined,
          activeParentTools,
          sessionDir,
        );

        // Track active Task tools for fallback parent assignment.
        // When a Task tool starts, add it to the active set.
        // This enables fallback parent assignment for child tools when SDK's
        // parent_tool_use_id is null.
        for (const event of toolStartEvents) {
          if (event.type === 'tool_start' && event.toolName === 'Task') {
            activeParentTools.add(event.toolUseId);
          }
        }

        events.push(...toolStartEvents);

        if (textContent) {
          // Don't emit text_complete yet - wait for message_delta to get actual stop_reason
          // The assistant message arrives with stop_reason: null during streaming
          // The actual stop_reason comes in the message_delta event
          setPendingText(textContent);
        }
        break;
      }

      case 'stream_event': {
        // Streaming partial message
        const event = message.event;
        // Debug: log all stream events to understand tool result flow
        if (this.onDebug && event.type !== 'content_block_delta') {
          this.onDebug(`stream_event: ${event.type}, content_type=${(event as any).content_block?.type || (event as any).delta?.type || 'n/a'}`);
        }
        // Capture turn ID from message_start (arrives before any content events)
        // This ID correlates all events in an assistant turn
        if (event.type === 'message_start') {
          const messageId = (event as any).message?.id;
          if (messageId) {
            setTurnId(messageId);
          }
        }
        // message_delta contains the actual stop_reason - emit pending text now
        if (event.type === 'message_delta') {
          const stopReason = (event as any).delta?.stop_reason;
          if (pendingText) {
            const isIntermediate = stopReason === 'tool_use';
            // SDK's parent_tool_use_id identifies the subagent context for this text
            // (null = main agent, Task ID = inside subagent)
            events.push({ type: 'text_complete', text: pendingText, isIntermediate, turnId: turnId || undefined, parentToolUseId: message.parent_tool_use_id || undefined });
            setPendingText(null);
          }
        }
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          events.push({ type: 'text_delta', text: event.delta.text, turnId: turnId || undefined, parentToolUseId: message.parent_tool_use_id || undefined });
        } else if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
          // Stateless tool start extraction from stream events.
          // SDK's parent_tool_use_id is authoritative for parent assignment.
          // Falls back to activeParentTools when SDK doesn't provide parent info.
          // Stream events arrive with empty input — the full input comes later
          // in the assistant message (extractToolStarts handles dedup + re-emit).
          const toolBlock = event.content_block;
          const sdkParentId = message.parent_tool_use_id;
          const streamBlocks: ContentBlock[] = [{
            type: 'tool_use' as const,
            id: toolBlock.id,
            name: toolBlock.name,
            input: (toolBlock.input ?? {}) as Record<string, unknown>,
          }];
          const streamEvents = extractToolStarts(
            streamBlocks,
            sdkParentId,
            toolIndex,
            emittedToolStarts,
            turnId || undefined,
            activeParentTools,
            sessionDir,
          );

          // Track active Task tools for fallback parent assignment
          for (const evt of streamEvents) {
            if (evt.type === 'tool_start' && evt.toolName === 'Task') {
              activeParentTools.add(evt.toolUseId);
            }
          }

          events.push(...streamEvents);
        }
        break;
      }

      case 'user': {
        // Skip replayed messages when resuming a session - they're historical
        if ('isReplay' in message && message.isReplay) {
          break;
        }

        // ─────────────────────────────────────────────────────────────────────────
        // STATELESS TOOL RESULT MATCHING
        // ─────────────────────────────────────────────────────────────────────────
        // Uses extractToolResults() which matches results by explicit tool_use_id
        // from content blocks — no FIFO queues, no parent stacks needed.
        // Falls back to convenience field tool_use_result when content blocks
        // are unavailable (e.g., some in-process MCP tools).
        // ─────────────────────────────────────────────────────────────────────────
        if (message.tool_use_result !== undefined || ('message' in message && message.message)) {
          // Extract content blocks from the SDK message
          const msgContent = ('message' in message && message.message)
            ? ((message.message as { content?: unknown[] }).content ?? [])
            : [];
          const contentBlocks = (Array.isArray(msgContent) ? msgContent : []) as ContentBlock[];

          const sdkParentId = message.parent_tool_use_id;
          const toolUseResultValue = message.tool_use_result;

          const resultEvents = extractToolResults(
            contentBlocks,
            sdkParentId,
            toolUseResultValue,
            toolIndex,
            turnId || undefined,
          );

          // Remove completed Task tools from activeParentTools.
          // When a Task tool result arrives, we no longer need to track it
          // as an active parent for fallback assignment.
          for (const event of resultEvents) {
            if (event.type === 'tool_result' && event.toolName === 'Task') {
              activeParentTools.delete(event.toolUseId);
            }
          }

          events.push(...resultEvents);
        }
        break;
      }

      case 'tool_progress': {
        // tool_progress events are emitted for subagent child tools.
        // Uses SDK's parent_tool_use_id as authoritative parent assignment.
        const progress = message as {
          tool_use_id: string;
          tool_name: string;
          parent_tool_use_id: string | null;
          elapsed_time_seconds?: number;
        };

        // Forward elapsed time to UI for live progress updates
        // Use parent_tool_use_id if this is a child tool, so progress updates the parent Task
        if (progress.elapsed_time_seconds !== undefined) {
          events.push({
            type: 'task_progress',
            toolUseId: progress.parent_tool_use_id || progress.tool_use_id,
            elapsedSeconds: progress.elapsed_time_seconds,
            turnId: turnId || undefined,
          });
        }

        // If we haven't seen this tool yet, emit a tool_start via extractToolStarts.
        // This handles child tools discovered through progress events before
        // stream_event or assistant message arrives.
        if (!emittedToolStarts.has(progress.tool_use_id)) {
          const progressBlocks: ContentBlock[] = [{
            type: 'tool_use' as const,
            id: progress.tool_use_id,
            name: progress.tool_name,
            input: {},
          }];
          const progressEvents = extractToolStarts(
            progressBlocks,
            progress.parent_tool_use_id,
            toolIndex,
            emittedToolStarts,
            turnId || undefined,
            activeParentTools,
            sessionDir,
          );

          // Track active Task tools discovered via progress events
          for (const evt of progressEvents) {
            if (evt.type === 'tool_start' && evt.toolName === 'Task') {
              activeParentTools.add(evt.toolUseId);
            }
          }

          events.push(...progressEvents);
        }
        break;
      }

      case 'result': {
        // Debug: log result message details (stderr to avoid SDK JSON pollution)
        console.error(`[ClaudeAgent] result message: subtype=${message.subtype}, errors=${'errors' in message ? JSON.stringify((message as any).errors) : 'none'}`);

        // Get contextWindow from modelUsage (this is correct - it's the model's context window size)
        const modelUsageEntries = Object.values(message.modelUsage || {});
        const primaryModelUsage = modelUsageEntries[0];

        // Cache contextWindow for real-time usage_update events in subsequent turns
        if (primaryModelUsage?.contextWindow) {
          this.cachedContextWindow = primaryModelUsage.contextWindow;
        }

        // Use lastAssistantUsage for context window display (per-message, not cumulative)
        // result.modelUsage is cumulative across the entire session (for billing)
        // but we need the actual current context size from the last assistant message
        // See: https://github.com/anthropics/claude-agent-sdk-typescript/issues/66
        let inputTokens: number;
        let cacheRead: number;
        let cacheCreation: number;

        if (this.lastAssistantUsage) {
          // Use tracked per-message usage (correct for context display)
          inputTokens = this.lastAssistantUsage.input_tokens +
                        this.lastAssistantUsage.cache_read_input_tokens +
                        this.lastAssistantUsage.cache_creation_input_tokens;
          cacheRead = this.lastAssistantUsage.cache_read_input_tokens;
          cacheCreation = this.lastAssistantUsage.cache_creation_input_tokens;
        } else {
          // Fallback to result.usage if no assistant message was tracked
          cacheRead = message.usage.cache_read_input_tokens ?? 0;
          cacheCreation = message.usage.cache_creation_input_tokens ?? 0;
          inputTokens = message.usage.input_tokens + cacheRead + cacheCreation;
        }

        const usage = {
          inputTokens,
          outputTokens: message.usage.output_tokens,
          cacheReadTokens: cacheRead,
          cacheCreationTokens: cacheCreation,
          costUsd: message.total_cost_usd,
          contextWindow: primaryModelUsage?.contextWindow,
        };

        if (message.subtype === 'success') {
          events.push({ type: 'complete', usage });
        } else {
          // Error result - emit error then complete with whatever usage we have
          const errorMsg = 'errors' in message ? message.errors.join(', ') : 'Query failed';

          // Check for Windows SDK setup error (missing .claude/skills directory)
          const windowsError = buildWindowsSkillsDirError(errorMsg);
          if (windowsError) {
            events.push(windowsError);
          } else {
            events.push({ type: 'error', message: errorMsg });
          }
          events.push({ type: 'complete', usage });
        }
        break;
      }

      case 'system': {
        // System messages (init, compaction, status)
        if (message.subtype === 'init') {
          // Capture tools list from SDK init message
          if ('tools' in message && Array.isArray(message.tools)) {
            this.sdkTools = message.tools;
            this.onDebug?.(`SDK init: captured ${this.sdkTools.length} tools`);
          }
        } else if (message.subtype === 'compact_boundary') {
          events.push({
            type: 'info',
            message: 'Compacted Conversation',
          });
        } else if (message.subtype === 'status' && message.status === 'compacting') {
          events.push({ type: 'status', message: 'Compacting conversation...' });
        }
        break;
      }

      case 'auth_status': {
        if (message.error) {
          events.push({ type: 'error', message: `Auth error: ${message.error}. Try running /auth to re-authenticate.` });
        }
        break;
      }

      default: {
        // Log unhandled message types for debugging
        if (this.onDebug) {
          this.onDebug(`Unhandled SDK message type: ${(message as any).type}`);
        }
        break;
      }
    }

    return events;
  }

  /**
   * Check if a tool result error indicates a "tool not found" for an inactive source.
   * This is used to detect when Claude tries to call a tool from a source that exists
   * but isn't currently active, so we can auto-activate and retry.
   *
   * @returns The source slug, tool name, and input if this is an inactive source error, null otherwise
   */
  private detectInactiveSourceToolError(
    event: AgentEvent,
    toolIndex: ToolIndex
  ): { sourceSlug: string; toolName: string; input: unknown } | null {
    if (event.type !== 'tool_result' || !event.isError) return null;

    const resultStr = typeof event.result === 'string' ? event.result : '';

    // Try to extract tool name from error message patterns:
    // - "No such tool available: mcp__slack__api_slack"
    // - "Error: Tool 'mcp__slack__api_slack' not found"
    let toolName: string | null = null;

    // Pattern 1: "No such tool available: {toolName}" or "No tool available: {toolName}"
    // Note: SDK wraps in XML tags like "</tool_use_error>", so we stop at '<' to avoid capturing the tag
    const noSuchToolMatch = resultStr.match(/No (?:such )?tool available:\s*([^\s<]+)/i);
    if (noSuchToolMatch?.[1]) {
      toolName = noSuchToolMatch[1];
    }

    // Pattern 2: "Tool '{toolName}' not found" or "Tool `{toolName}` not found"
    if (!toolName) {
      const toolNotFoundMatch = resultStr.match(/Tool\s+['"`]([^'"`]+)['"`]\s+not found/i);
      if (toolNotFoundMatch?.[1]) {
        toolName = toolNotFoundMatch[1];
      }
    }

    // Fallback: try toolIndex if we couldn't extract from error
    if (!toolName) {
      const name = toolIndex.getName(event.toolUseId);
      if (name) {
        toolName = name;
      }
    }

    if (!toolName) return null;

    // Check if it's an MCP tool (mcp__{slug}__{toolname})
    if (!toolName.startsWith('mcp__')) return null;

    const parts = toolName.split('__');
    if (parts.length < 3) return null;

    // parts[1] is guaranteed to exist since we checked parts.length >= 3
    const sourceSlug = parts[1]!;

    // Check if source exists but is inactive
    const sourceExists = this.sourceManager.getAllSources().some((s) => s.config.slug === sourceSlug);
    const isActive = this.sourceManager.isSourceActive(sourceSlug);

    if (sourceExists && !isActive) {
      // Get input from toolIndex
      const input = toolIndex.getInput(event.toolUseId);
      return { sourceSlug, toolName, input: input ?? {} };
    }

    return null;
  }

  clearHistory(): void {
    // Clear session to start fresh conversation
    this.sessionId = null;
    // Clear pinned state so next chat() will capture fresh values
    this.pinnedPreferencesPrompt = null;
    this.preferencesDriftNotified = false;
    this.contextCompactionNotified = false;
  }

  /**
   * Force-abort the current query using the SDK's AbortController.
   *
   * Two-phase termination:
   * 1. abort(reason) — sends SIGTERM to CLI subprocess, sets abort signal so the
   *    `for await` loop in chat() throws AbortError on next iteration. This preserves
   *    the existing error handling path (session ID cleanup, reason tracking, etc.).
   * 2. Delayed close() (2s) — if SIGTERM failed (e.g., subprocess blocked on an API call
   *    with extended thinking), close() sends SIGTERM again + SIGKILL after 5s, and cleans
   *    up pending MCP requests/transports. The 2s delay gives SIGTERM time to produce
   *    AbortError first, and allows the MCP tool handler to send its response.
   *
   * @param reason - Why the abort is happening (affects UI feedback)
   */
  forceAbort(reason: AbortReason = AbortReason.UserStop): void {
    debug('[ClaudeAgent] forceAbort: reason=%s, hasQuery=%s, hasAbortController=%s', reason, !!this.currentQuery, !!this.currentQueryAbortController);
    this.lastAbortReason = reason;

    // Phase 1: SIGTERM via abort signal — triggers AbortError in the for-await loop
    if (this.currentQueryAbortController) {
      this.currentQueryAbortController.abort(reason);
      this.currentQueryAbortController = null;
    }

    // Phase 2: Delayed close() — SIGKILL fallback if SIGTERM didn't kill the process.
    // Must be delayed to preserve the AbortError catch path (immediate close() calls
    // inputStream.done() which ends the iterator normally, bypassing AbortError).
    // Also avoids closing the MCP transport before the tool handler sends its response.
    const queryRef = this.currentQuery;
    if (queryRef) {
      debug('[ClaudeAgent] forceAbort: scheduled delayed close() in 2s for SIGKILL fallback');
      setTimeout(() => {
        try {
          queryRef.close();
        } catch {
          // Query may already be cleaned up — safe to ignore
        }
      }, 2000);
    }

    this.currentQuery = null;
  }

  getModel(): string {
    return this._model;
  }

  /**
   * Get the list of SDK tools (captured from init message)
   */
  getSdkTools(): string[] {
    return this.sdkTools;
  }

  setModel(model: string): void {
    this.config.model = model;
    // Note: Model change takes effect on the next query
  }

  // ============================================================
  // Mini Agent Mode (uses centralized constants from BaseAgent)
  // ============================================================

  /**
   * Check if running in mini agent mode.
   * Uses centralized detection for consistency with CodexAgent.
   */
  isMiniAgent(): boolean {
    return this.config.systemPromptPreset === 'mini';
  }

  /**
   * Get mini agent configuration for provider-specific application.
   * Returns centralized config from BaseAgent constants.
   */
  getMiniAgentConfig(): MiniAgentConfig {
    const enabled = this.isMiniAgent();
    return {
      enabled,
      tools: enabled ? MINI_AGENT_TOOLS : [],
      mcpServerKeys: enabled ? MINI_AGENT_MCP_KEYS : [],
      minimizeThinking: enabled,
    };
  }

  // getMiniSystemPrompt() and filterMcpServersForMiniAgent() are inherited from BaseAgent

  getWorkspace(): Workspace {
    return this.config.workspace;
  }

  setWorkspace(workspace: Workspace): void {
    this.config.workspace = workspace;
    // Clear session when switching workspaces - caller should set session separately if needed
    this.sessionId = null;
    // Note: MCP proxy needs to be reinitialized by the caller (useAgent hook)
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  setSessionId(sessionId: string | null): void {
    this.sessionId = sessionId;
  }

  /**
   * Update the working directory for this agent's session.
   * Called when user changes the working directory in the UI.
   */
  updateWorkingDirectory(path: string): void {
    if (this.config.session) {
      this.config.session.workingDirectory = path;
    }
  }

  /**
   * Set source servers (user-defined sources)
   * These are MCP servers and API tools added via the source selector UI
   * @param mcpServers Pre-built MCP server configs with auth headers
   * @param apiServers In-process MCP servers for REST APIs
   * @param intendedSlugs Optional list of source slugs that should be considered active
   *                      (what the UI shows as active, even if build failed)
   */
  setSourceServers(
    mcpServers: Record<string, SdkMcpServerConfig>,
    apiServers: Record<string, unknown>,
    intendedSlugs?: string[]
  ): void {
    // Store server configs for SDK options building
    this.sourceMcpServers = mcpServers;
    this.sourceApiServers = apiServers as Record<string, ReturnType<typeof createSdkMcpServer>>;

    // Delegate state tracking to sourceManager (inherited from BaseAgent)
    this.sourceManager.updateActiveState(
      Object.keys(mcpServers),
      Object.keys(apiServers),
      intendedSlugs
    );
  }

  // isSourceServerActive, getActiveSourceServerNames, setAllSources, getAllSources, markSourceUnseen
  // are now inherited from BaseAgent and delegate to this.sourceManager

  // setTemporaryClarifications is now inherited from BaseAgent

  /**
   * Get filtered source MCP servers based on local MCP setting
   * @returns Object with filtered servers and names of any skipped stdio servers
   */
  private getSourceMcpServersFiltered(): { servers: Record<string, SdkMcpServerConfig>; skipped: string[] } {
    return this.filterMcpServersByLocalEnabled(this.sourceMcpServers);
  }

  /**
   * Filter MCP servers based on whether local (stdio) MCP is enabled for this workspace.
   * When local MCP is disabled, stdio servers are filtered out.
   *
   * @returns Object with filtered servers and names of any skipped stdio servers
   */
  private filterMcpServersByLocalEnabled(
    servers: Record<string, SdkMcpServerConfig>
  ): { servers: Record<string, SdkMcpServerConfig>; skipped: string[] } {
    const localEnabled = isLocalMcpEnabled(this.workspaceRootPath);

    if (localEnabled) {
      // Local MCP is enabled, return all servers
      return { servers, skipped: [] };
    }

    // Local MCP is disabled, filter out stdio servers
    const filtered: Record<string, SdkMcpServerConfig> = {};
    const skipped: string[] = [];
    for (const [name, config] of Object.entries(servers)) {
      if (config.type !== 'stdio') {
        filtered[name] = config;
      } else {
        debug(`[filterMcpServers] Filtering out stdio server "${name}" (local MCP disabled)`);
        skipped.push(name);
      }
    }
    return { servers: filtered, skipped };
  }

  async close(): Promise<void> {
    this.forceAbort();
  }

  // ============================================================
  // AgentBackend Interface Methods
  // ============================================================

  /**
   * Abort current query (async interface for AgentBackend compatibility).
   * Wraps forceAbort() in a Promise.
   */
  async abort(reason?: string): Promise<void> {
    this.forceAbort();
  }

  /**
   * Destroy the agent and clean up resources.
   * Calls super.destroy() for base cleanup, then Claude-specific cleanup.
   */
  destroy(): void {
    // Claude-specific cleanup first
    this.currentQueryAbortController?.abort();
    this.pendingPermissions.clear();

    // Clear pinned system prompt state
    this.pinnedPreferencesPrompt = null;
    this.preferencesDriftNotified = false;
    this.contextCompactionNotified = false;

    // Clear Claude-specific callbacks (not handled by BaseAgent)
    this.onSourcesListChange = null;
    this.onConfigValidationError = null;
    this.onUsageUpdate = null;

    // Clean up session-specific state
    const configSessionId = this.config.session?.id;
    if (configSessionId) {
      clearPlanFileState(configSessionId);
      unregisterSessionScopedToolCallbacks(configSessionId);
      cleanupSessionScopedTools(configSessionId);
      cleanupModeState(configSessionId);
    }

    // Clear session
    this.sessionId = null;

    // Base cleanup (stops config watcher, clears whitelists, resets source trackers)
    super.destroy();
  }

  /**
   * Check if currently processing a query.
   */
  isProcessing(): boolean {
    return this.currentQuery !== null;
  }

  /**
   * Get current permission mode.
   */
  getPermissionMode(): PermissionMode {
    return getPermissionMode(this.modeSessionId);
  }

  /**
   * Set permission mode.
   */
  setPermissionMode(mode: PermissionMode): void {
    setPermissionMode(this.modeSessionId, mode);
  }

  /**
   * Cycle to next permission mode.
   */
  cyclePermissionMode(): PermissionMode {
    return cyclePermissionMode(this.modeSessionId);
  }

  // getActiveSourceSlugs() is now inherited from BaseAgent

  // ============================================================
  // Mini Completion (for title generation and other quick tasks)
  // ============================================================

  /**
   * Run a simple text completion using Claude SDK.
   * No tools, empty system prompt - just text in → text out.
   * Uses the same auth infrastructure as the main agent.
   *
   * IMPORTANT: Uses `cwd: tmpdir()` to isolate SDK transcript storage from the
   * main chat's project directory. Without this, concurrent calls (e.g. title
   * generation firing alongside the first chat response) write transcripts to
   * the same `~/.claude/projects/<hash>/` directory, corrupting the main chat's
   * session transcript and causing "No conversation found with session ID"
   * errors on the next message resume.
   */
  async runMiniCompletion(prompt: string): Promise<string | null> {
    try {
      const model = this.config.miniModel ?? getDefaultSummarizationModel();

      const options = {
        ...getDefaultOptions(),
        model,
        maxTurns: 1,
        systemPrompt: 'Reply with ONLY the requested text. No explanation.', // Minimal - no Claude Code preset
        // Isolate from main chat's SDK project directory to prevent transcript
        // collision when running concurrently (title gen, summarization, etc.)
        cwd: tmpdir(),
        // Don't persist ephemeral transcripts for one-shot completions
        persistSession: false,
      };

      let result = '';
      for await (const msg of query({ prompt, options })) {
        if (msg.type === 'assistant') {
          for (const block of msg.message.content) {
            if (block.type === 'text') {
              result += block.text;
            }
          }
        }
      }

      return result.trim() || null;
    } catch (error) {
      this.debug(`[runMiniCompletion] Failed: ${error}`);
      return null;
    }
  }

  // ============================================================
  // Orchestrator — Deterministic Pipeline (Phase 6)
  // ============================================================

  /**
   * Detect if the user message mentions an agent with orchestratable stages.
   *
   * Returns the first matched LoadedAgent that has controlFlow.stages defined,
   * or null if the message doesn't mention an orchestrable agent.
   *
   * Detection logic:
   * 1. Parse [agent:slug] mentions from the message
   * 2. Load each mentioned agent's config.json
   * 3. Return first agent with controlFlow.stages.length > 0
   */
  private detectOrchestratableAgent(userMessage: string): LoadedAgent | null {
    if (!userMessage.includes('[agent:')) return null;

    // Parse agent mentions — we only need agent slugs
    const allAgentSlugs = this.getAllAgentSlugs();
    const parsed = parseMentions(userMessage, [], [], allAgentSlugs);

    if (parsed.agents.length === 0) return null;

    // Find the first agent that has orchestratable stages
    for (const slug of parsed.agents) {
      const agent = loadAgent(this.workspaceRootPath, slug);
      if (agent && agent.config?.controlFlow?.stages?.length > 0) {
        return agent;
      }
    }

    return null;
  }

  /**
   * Get all available agent slugs in the workspace.
   * Uses loadWorkspaceAgents to extract slugs for mention parsing.
   */
  private getAllAgentSlugs(): string[] {
    try {
      return loadWorkspaceAgents(this.workspaceRootPath).map(a => a.slug);
    } catch {
      return [];
    }
  }

  /**
   * Handle breakout pending — record breakout_pending event and yield
   * confirmation question to the user.
   *
   * Extracted as a helper to share between keyword-based (fast path)
   * and semantic-based (LLM path) breakout detection in chat().
   *
   * @param userMessage - The user's message that triggered breakout detection
   * @param sessionPath - Session directory path
   * @param source - 'keyword' or 'semantic' for debug logging
   */
  private async *emitBreakoutConfirmation(
    userMessage: string,
    sessionPath: string,
    source: 'keyword' | 'semantic',
  ): AsyncGenerator<AgentEvent> {
    try {
      const pipelineState = PipelineState.loadFrom(sessionPath);
      if (pipelineState) {
        const updatedState = pipelineState.addEvent({
          type: 'breakout_pending',
          stage: pipelineState.currentStage,
          data: { userMessage: userMessage.slice(0, 500), detectionSource: source },
        });
        updatedState.saveTo(sessionPath);
      }
    } catch (pendingError) {
      this.onDebug?.(
        `[chat] Breakout pending error: ${pendingError instanceof Error ? pendingError.message : String(pendingError)}`,
      );
    }

    // Bridge state is NOT modified — keeps queue drain hold active (F1).
    // Yield confirmation question as a text_complete (like orchestrator pause messages)
    const pausedStage = PipelineState.loadFrom(sessionPath)?.pausedAtStage ?? -1;
    const confirmationMessage =
      `It looks like you want to exit the current research pipeline (paused at stage ${pausedStage}).\n\n` +
      `If I proceed, the pipeline will be terminated and your research progress so far will be saved as context.\n\n` +
      `Do you want to exit the pipeline?\n` +
      `1. Yes — exit and switch to normal chat\n` +
      `2. No — continue with the research pipeline`;

    yield {
      type: 'text_complete',
      text: confirmationMessage,
      isIntermediate: false,
      turnId: `breakout-confirm-ask-${Date.now()}`,
    };
    yield { type: 'complete' };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SEMANTIC BREAKOUT CLASSIFICATION
  // ──────────────────────────────────────────────────────────────────────────

  /** System prompt for semantic breakout classification. */
  private static readonly BREAKOUT_CLASSIFICATION_SYSTEM_PROMPT =
    `You are a message classifier for a research assistant application.\n\n` +
    `A multi-stage research pipeline is currently paused and waiting for the user's response. ` +
    `The pipeline asked the user questions or presented options about the research topic.\n\n` +
    `Given the research topic and the user's new message, determine if the user is:\n` +
    `(a) "pipeline_response" — responding to the research pipeline: answering its questions, ` +
    `choosing an option (A/B), providing clarification, or giving feedback about the research, OR\n` +
    `(b) "breakout" — asking about something completely unrelated to the research topic, ` +
    `changing the subject, or requesting to do something different.\n\n` +
    `Respond ONLY with a JSON object, no other text:\n` +
    `{"classification": "pipeline_response" | "breakout", "confidence": <0.0 to 1.0>}`;

  /**
   * Classify whether a user message is a response to the paused pipeline
   * or a breakout (unrelated request) using a lightweight Opus LLM call.
   *
   * Called when keyword-based `isBreakoutIntent()` doesn't match but we
   * need to check for semantic breakout (e.g., "what's the weather in zurich?"
   * is clearly unrelated to an audit research pipeline).
   *
   * Uses Opus with `effort: 'low'` and `desiredMaxTokens: 200` for fast
   * classification (~500-800ms). On any error, returns 'unclear' which
   * defaults to resuming the pipeline (non-destructive fallback).
   *
   * @param userMessage - The user's new message
   * @param pipelineState - Current pipeline state (for original query + sub-queries)
   * @param pausedAtStage - Stage number where the pipeline is paused
   * @returns BreakoutClassification: 'pipeline_response' | 'breakout' | 'unclear'
   */
  private async classifyBreakoutIntent(
    userMessage: string,
    pipelineState: PipelineState,
    pausedAtStage: number,
  ): Promise<BreakoutClassification> {
    const startTime = Date.now();
    try {
      // Build user prompt with research context
      const originalQuery = pipelineState.originalQuery;
      const subQueries = pipelineState.subQueryTexts;
      const subQuerySection = subQueries.length > 0
        ? `\nResearch sub-queries:\n${subQueries.map((sq, i) => `  ${i + 1}. ${sq}`).join('\n')}`
        : '';

      const classificationPrompt =
        `Research topic: "${originalQuery}"${subQuerySection}\n` +
        `Pipeline paused at stage: ${pausedAtStage}\n\n` +
        `User's message: "${userMessage}"\n\n` +
        `Classify this message.`;

      // Create temporary LLM client — short-lived, GC'd after call
      const llmClient = new OrchestratorLlmClient(
        () => this.getOrchestratorAuthToken(),
      );

      const result = await llmClient.call({
        systemPrompt: ClaudeAgent.BREAKOUT_CLASSIFICATION_SYSTEM_PROMPT,
        userMessage: classificationPrompt,
        effort: 'low',
        desiredMaxTokens: 200,
      });

      const elapsed = Date.now() - startTime;
      this.onDebug?.(
        `[chat] Semantic breakout classification completed in ${elapsed}ms, ` +
        `tokens: ${result.usage.inputTokens}in/${result.usage.outputTokens}out`,
      );

      // Parse JSON response
      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        this.onDebug?.('[chat] Semantic breakout: failed to extract JSON from response');
        return 'unclear';
      }

      const parsed = JSON.parse(jsonMatch[0]) as { classification?: string; confidence?: number };
      const classification = parsed.classification;
      const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;

      this.onDebug?.(`[chat] Semantic breakout result: classification=${classification}, confidence=${confidence}`);

      // Confidence threshold — below 0.7, treat as unclear (resume is safer)
      if (confidence < 0.7) {
        this.onDebug?.(`[chat] Semantic breakout: confidence ${confidence} below threshold 0.7 — treating as unclear`);
        return 'unclear';
      }

      if (classification === 'breakout') return 'breakout';
      if (classification === 'pipeline_response') return 'pipeline_response';

      // Unknown classification value
      this.onDebug?.(`[chat] Semantic breakout: unknown classification value "${classification}"`);
      return 'unclear';
    } catch (error) {
      const elapsed = Date.now() - startTime;
      this.onDebug?.(
        `[chat] Semantic breakout classification error (${elapsed}ms): ` +
        `${error instanceof Error ? error.message : String(error)}`,
      );
      // On any error, return 'unclear' — resume pipeline (non-destructive)
      return 'unclear';
    }
  }

  /**
   * Detect if an orchestrator pipeline is paused for this session.
   *
   * Reads pipeline-state.json from the session's data directory.
   * If the pipeline is paused, loads the agent and returns it.
   * Used by chat() to route resume messages to orchestrator.resume()
   * instead of SDK query().
   *
   * @param sessionId - Current session ID
   * @returns Agent info if a paused orchestrator pipeline exists, null otherwise
   */
  private detectPausedOrchestrator(sessionId: string): { slug: string; agent: LoadedAgent; breakoutPending: boolean } | null {
    try {
      const sessionPath = getSessionPath(this.workspaceRootPath, sessionId);
      const state = PipelineState.loadFrom(sessionPath);
      if (!state || !state.isPaused) return null;

      // Section 16 (G2): Primary path — use agentSlug from pipeline-state.json directly
      if (state.agentSlug) {
        const agent = loadAgent(this.workspaceRootPath, state.agentSlug);
        if (agent) {
          this.onDebug?.(`[orchestrator] detectPausedOrchestrator: found via pipeline-state.json agentSlug=${state.agentSlug} breakoutPending=${state.isBreakoutPending}`);
          return { slug: state.agentSlug, agent, breakoutPending: state.isBreakoutPending };
        }
      }

      // Fallback: scan bridge state files (backward compat for old pipeline-state.json without agentSlug)
      const agentsDir = join(sessionPath, 'data', 'agents');
      if (!existsSync(agentsDir)) return null;

      const { readdirSync } = require('fs') as typeof import('fs');
      const slugs = readdirSync(agentsDir, { withFileTypes: true })
        .filter((d: { isDirectory: () => boolean }) => d.isDirectory())
        .map((d: { name: string }) => d.name);

      for (const slug of slugs) {
        const bridgePath = join(agentsDir, slug, 'current-run-state.json');
        if (!existsSync(bridgePath)) continue;

        try {
          const bridgeState = JSON.parse(readFileSync(bridgePath, 'utf-8'));
          if (bridgeState.orchestratorMode && bridgeState.pausedAtStage !== undefined) {
            const agent = loadAgent(this.workspaceRootPath, slug);
            if (agent) {
              this.onDebug?.(`[orchestrator] detectPausedOrchestrator: found via bridge state slug=${slug}`);
              return { slug, agent, breakoutPending: false };
            }
          }
        } catch {
          // Corrupted bridge state — skip
        }
      }

      this.onDebug?.(`[orchestrator] detectPausedOrchestrator: pipeline isPaused but no agent found`);
    } catch {
      // Cannot read session state — not paused
    }
    return null;
  }

  /**
   * Write a bridge state file so the session layer (sessions.ts) can detect
   * that an orchestrator pipeline is paused.
   *
   * The session layer reads `{sessionPath}/data/agents/{slug}/current-run-state.json`
   * to detect paused pipelines (for queue drain hold and UI state).
   * The `orchestratorMode: true` flag distinguishes orchestrator from SDK pipelines.
   */
  private writeOrchestratorBridgeState(
    sessionPath: string, agentSlug: string, stage: number, runId: string,
  ): void {
    const agentDataDir = join(sessionPath, 'data', 'agents', agentSlug);
    mkdirSync(agentDataDir, { recursive: true });
    const statePath = join(agentDataDir, 'current-run-state.json');
    writeFileSync(statePath, JSON.stringify({
      runId,
      pausedAtStage: stage,
      orchestratorMode: true,
      currentStage: stage,
      completedStages: Array.from({ length: stage + 1 }, (_, i) => i),
      startedAt: new Date().toISOString(),
      lastEventAt: new Date().toISOString(),
    }, null, 2), 'utf-8');
    this.onDebug?.(`[orchestrator] writeOrchestratorBridgeState: agent=${agentSlug} stage=${stage} runId=${runId} path=${statePath}`);
  }

  /**
   * Clear the bridge state file after orchestrator completes, errors, or resumes.
   * Prevents stale paused-pipeline detection on subsequent messages.
   */
  private clearOrchestratorBridgeState(sessionPath: string, agentSlug: string): void {
    try {
      const statePath = join(sessionPath, 'data', 'agents', agentSlug, 'current-run-state.json');
      const existed = existsSync(statePath);
      if (existed) unlinkSync(statePath);
      this.onDebug?.(`[orchestrator] clearOrchestratorBridgeState: agent=${agentSlug} existed=${existed}`);
    } catch {
      // Best-effort cleanup — non-fatal
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // BREAKOUT RESUME DETECTION + CONFIRMATION
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Detect if a breakout_resume_pending confirmation is awaiting a response.
   *
   * This is the SECOND TURN detector — after we've already asked the user
   * "1. Resume / 2. Start fresh" and recorded a breakout_resume_pending event.
   * The response does NOT need an [agent:] mention (G2 fix).
   *
   * @returns Resume info if pending, null otherwise
   */
  private detectBreakoutResumePending(
    sessionId: string,
  ): { slug: string; agent: LoadedAgent; resumeFromStage: number } | null {
    try {
      const sessionPath = getSessionPath(this.workspaceRootPath, sessionId);
      const state = PipelineState.loadFrom(sessionPath);
      if (!state || !state.isBreakoutResumePending) return null;

      // Resolve agent slug — either from state metadata or from the pending event data
      const agentSlug = state.agentSlug;
      if (!agentSlug) {
        this.onDebug?.('[orchestrator] detectBreakoutResumePending: no agentSlug in pipeline state');
        return null;
      }

      const agent = loadAgent(this.workspaceRootPath, agentSlug);
      if (!agent) {
        this.onDebug?.(`[orchestrator] detectBreakoutResumePending: agent ${agentSlug} not found`);
        return null;
      }

      const resumeFromStage = state.lastCompletedStageIndex + 1;
      this.onDebug?.(
        `[orchestrator] detectBreakoutResumePending: agent=${agentSlug} resumeFromStage=${resumeFromStage}`,
      );
      return { slug: agentSlug, agent, resumeFromStage };
    } catch {
      return null;
    }
  }

  /**
   * Detect if an agent has a resumable broken-out pipeline in this session.
   *
   * This is the FIRST TURN detector — when the user re-invokes [agent:slug]
   * and we check if a prior breakout exists that can be resumed.
   *
   * Phase 6 hardening: Includes a 24-hour staleness guard — pipelines
   * broken out more than 24 hours ago are not considered resumable.
   *
   * @param sessionId - Current session ID
   * @param agentSlug - Agent slug to check for resumable state
   * @returns Resume info if resumable, null otherwise
   */
  private detectResumableBreakout(
    sessionId: string,
    agentSlug: string,
  ): { lastCompletedStage: number } | null {
    try {
      const sessionPath = getSessionPath(this.workspaceRootPath, sessionId);
      const state = PipelineState.loadFrom(sessionPath);
      if (!state) return null;

      // Must be the same agent
      if (state.agentSlug && state.agentSlug !== agentSlug) return null;

      if (!state.isResumableAfterBreakout) return null;

      // Phase 6 staleness guard: Skip if the breakout happened more than 24h ago
      const lastBreakoutEvent = [...state.events].reverse().find(e => e.type === 'breakout');
      if (lastBreakoutEvent?.timestamp) {
        const breakoutAge = Date.now() - new Date(lastBreakoutEvent.timestamp).getTime();
        const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
        if (breakoutAge > STALE_THRESHOLD_MS) {
          this.onDebug?.(
            `[orchestrator] detectResumableBreakout: breakout is stale ` +
            `(age=${Math.round(breakoutAge / 3600000)}h > 24h) — skipping resume offer`,
          );
          return null;
        }
      }

      const lastCompletedStage = state.lastCompletedStageIndex;
      this.onDebug?.(
        `[orchestrator] detectResumableBreakout: agent=${agentSlug} ` +
        `lastCompletedStage=${lastCompletedStage} isResumable=true`,
      );
      return { lastCompletedStage };
    } catch {
      return null;
    }
  }

  /**
   * Emit the breakout-resume confirmation prompt.
   *
   * Records breakout_resume_pending event and yields a text_complete with
   * "1. Resume from stage N / 2. Start fresh" prompt.
   *
   * This mirrors the pattern of emitBreakoutConfirmation() but with
   * inverted semantics — "1" means resume (not exit).
   *
   * @param resumableInfo - Agent and stage info for resume
   */
  private async *emitBreakoutResumeConfirmation(
    resumableInfo: { slug: string; agent: LoadedAgent; resumeFromStage: number },
  ): AsyncGenerator<AgentEvent> {
    const sessionId = this.config.session?.id ?? '';
    const sessionPath = getSessionPath(this.workspaceRootPath, sessionId);

    try {
      const state = PipelineState.loadFrom(sessionPath);
      if (state) {
        const updatedState = state.addEvent({
          type: 'breakout_resume_pending',
          stage: resumableInfo.resumeFromStage,
          data: { agentSlug: resumableInfo.slug },
        });
        updatedState.saveTo(sessionPath);
      }
    } catch (pendingError) {
      this.onDebug?.(
        `[chat] Breakout-resume pending event error: ` +
        `${pendingError instanceof Error ? pendingError.message : String(pendingError)}`,
      );
    }

    // Load agent config to get stage names for the confirmation message
    let stageNames: string[] = [];
    try {
      const agentConfig = this.toOrchestratorAgentConfig(resumableInfo.agent);
      stageNames = agentConfig.controlFlow.stages.map(s => s.name);
    } catch {
      // Non-fatal — confirmation message will omit stage names
    }

    const resumeStage = resumableInfo.resumeFromStage;
    const resumeStageName = stageNames[resumeStage] ?? `Stage ${resumeStage}`;
    const completedCount = resumeStage;
    const totalCount = stageNames.length || '?';

    const confirmationMessage =
      `I found a previous research pipeline for this agent that was interrupted.\n\n` +
      `**Progress:** ${completedCount}/${totalCount} stages completed\n` +
      `**Resume point:** ${resumeStageName}\n\n` +
      `Would you like to:\n` +
      `1. **Resume** — continue from ${resumeStageName}\n` +
      `2. **Start fresh** — begin a new research pipeline from scratch`;

    yield {
      type: 'text_complete',
      text: confirmationMessage,
      isIntermediate: false,
      turnId: `breakout-resume-confirm-${Date.now()}`,
    };
    yield { type: 'complete' };
  }

  /**
   * Clean up stale pipeline artifacts when user chooses "Start fresh" after breakout.
   *
   * G4 fix: Prevents resolveFollowUpSessionId from contaminating the new pipeline
   * with stale context. Deletes pipeline-state.json and pipeline-summary.json
   * so the fresh pipeline starts clean.
   *
   * Does NOT delete answer.json — that's legitimate follow-up context if the
   * previous pipeline completed successfully before the breakout.
   *
   * @param sessionPath - Session directory path
   */
  private cleanupStaleBreakoutArtifacts(sessionPath: string): void {
    const filesToClean = [
      join(sessionPath, 'data', 'pipeline-state.json'),
      join(sessionPath, 'data', 'pipeline-summary.json'),
    ];

    for (const filePath of filesToClean) {
      try {
        if (existsSync(filePath)) {
          unlinkSync(filePath);
          this.onDebug?.(`[orchestrator] cleanupStaleBreakoutArtifacts: deleted ${filePath}`);
        }
      } catch (cleanupError) {
        this.onDebug?.(
          `[orchestrator] cleanupStaleBreakoutArtifacts: failed to delete ${filePath}: ` +
          `${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
        );
      }
    }
  }

  /**
   * Resume a pipeline from a breakout state.
   *
   * Mirrors resumeOrchestrator() structure — MCP bridge wiring, cost tracker,
   * orchestrator creation — but calls orchestrator.resumeFromBreakout() instead
   * of orchestrator.resume().
   *
   * G6 note: pipeline-summary.json is overwritten in the finally block when
   * the resumed pipeline completes/pauses/errors. This is intentional — the
   * summary should reflect the latest pipeline state after resumption.
   */
  private async *resumeFromBreakoutOrchestrator(
    userMessage: string,
    resumableInfo: { slug: string; agent: LoadedAgent; resumeFromStage: number },
  ): AsyncGenerator<AgentEvent> {
    const sessionId = this.config.session?.id ?? `orch-${Date.now()}`;
    const sessionPath = getSessionPath(this.workspaceRootPath, sessionId);
    const agentConfig = this.toOrchestratorAgentConfig(resumableInfo.agent);
    const runId = `orch-resume-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const agentSlug = resumableInfo.slug;
    const fromStage = resumableInfo.resumeFromStage;

    this.onDebug?.(
      `[orchestrator] Resuming from breakout: agent=${agentSlug} ` +
      `fromStage=${fromStage} runId=${runId}`,
    );

    let exitReason: OrchestratorExitReason = 'completed';

    // Re-create cost tracker (costs from earlier stages are in pipeline-state.json)
    const budgetUsd = agentConfig.orchestrator?.budgetUsd ?? 50;
    const costTracker = new CostTracker({ budgetUsd });

    // ── MCP Bridge wiring (same as runOrchestrator / resumeOrchestrator) ──
    let mcpBridge: OrchestratorMcpBridge_T | null = null;
    const mcpLifecycle = new McpLifecycleManager();

    try {
      const mcpSourceSlug = resumableInfo.agent.metadata.sources
        ?.find(s => s.required)?.slug;

      if (mcpSourceSlug) {
        try {
          const sourceConfig = loadSourceConfig(this.workspaceRootPath, mcpSourceSlug);
          if (sourceConfig?.mcp) {
            const transportConfig = extractTransportConfig(
              sourceConfig.mcp as unknown as Record<string, unknown>,
              this.workspaceRootPath,
            );
            this.onDebug?.(
              `[orchestrator] MCP bridge connect attempt (resumeFromBreakout): source=${mcpSourceSlug} ` +
              `transport=${transportConfig.transport}`,
            );
            const mcpClient = await mcpLifecycle.connect(transportConfig);
            mcpBridge = new OrchestratorMcpBridge(mcpClient);
            this.onDebug?.(`[orchestrator] MCP bridge connected for resumeFromBreakout: ${mcpSourceSlug}`);
          }
        } catch (mcpError) {
          this.onDebug?.(
            `[orchestrator] MCP bridge connection failed on resumeFromBreakout (non-fatal): ` +
            `${mcpError instanceof Error ? mcpError.message : String(mcpError)}`,
          );
        }
      }

      // Create orchestrator instance for resume-from-breakout
      const orchTurnId = `orch-${runId}`;
      const orchestrator = AgentOrchestrator.create(
        {
          sessionId,
          sessionPath,
          getAuthToken: () => this.getOrchestratorAuthToken(),
          onStreamEvent: (event) => {
            if (event.type === 'text_delta' && event.text) {
              this.onDebug?.(`[orchestrator] resumeFromBreakout stream: ${event.text.slice(0, 50)}...`);
            }
          },
          onDebug: this.onDebug ? (msg: string) => this.onDebug?.(msg) : undefined,
          onSubstepEvent: (substep, stageId) => {
            switch (substep.type) {
              case 'mcp_start':
                this.onAgentEvent?.({
                  type: 'agent_substep_start',
                  agentSlug,
                  runId,
                  data: {
                    stageId,
                    toolName: substep.toolName,
                    toolUseId: substep.toolUseId,
                    input: substep.input,
                    turnId: orchTurnId,
                    parentToolUseId: substep.parentToolUseId,
                  },
                });
                break;
              case 'mcp_result':
                this.onAgentEvent?.({
                  type: 'agent_substep_result',
                  agentSlug,
                  runId,
                  data: {
                    stageId,
                    toolUseId: substep.toolUseId,
                    toolName: substep.toolName,
                    result: substep.result,
                    isError: substep.isError ?? false,
                    turnId: orchTurnId,
                    parentToolUseId: substep.parentToolUseId,
                  },
                });
                break;
              case 'llm_start':
                this.onAgentEvent?.({
                  type: 'agent_substep_start',
                  agentSlug,
                  runId,
                  data: {
                    stageId,
                    toolName: 'orchestrator_llm',
                    toolUseId: substep.toolUseId,
                    input: { stage: substep.stageName, stageId: substep.stageId },
                    turnId: orchTurnId,
                    intent: `Analyzing: ${substep.stageName}`,
                    parentToolUseId: substep.parentToolUseId,
                  },
                });
                break;
              case 'llm_complete':
                this.onAgentEvent?.({
                  type: 'agent_substep_result',
                  agentSlug,
                  runId,
                  data: {
                    stageId,
                    toolUseId: substep.toolUseId,
                    toolName: 'orchestrator_llm',
                    result: substep.text,
                    isError: false,
                    turnId: orchTurnId,
                    parentToolUseId: substep.parentToolUseId,
                  },
                });
                break;
              case 'status':
                break;
            }
          },
        },
        mcpBridge,
        costTracker,
        agentConfig.orchestrator ?? undefined,
      );

      // ── Resume pipeline from breakout state ────────────────────────
      exitReason = yield* this.processOrchestratorEvents(
        orchestrator.resumeFromBreakout(userMessage, agentConfig, fromStage),
        agentSlug, runId, sessionPath,
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.onDebug?.(`[orchestrator] ResumeFromBreakout error: ${errorMessage}`);
      yield { type: 'error', message: `Orchestrator resume-from-breakout error: ${errorMessage}` };
      this.onAgentEvent?.({
        type: 'agent_run_completed',
        agentSlug,
        runId,
        data: { verificationStatus: 'error', error: errorMessage },
      });
      exitReason = 'error';
    }

    // G6: pipeline-summary.json is overwritten here — intentional.
    // The summary should reflect the latest state after resumption.
    try {
      yield { type: 'complete' };
    } finally {
      this.onDebug?.(`[orchestrator] ResumeFromBreakout cleanup: exitReason=${exitReason}`);
      this.writePipelineSummary(sessionPath, agentConfig.controlFlow.stages.length, exitReason);
      if (exitReason !== 'paused') {
        this.clearOrchestratorBridgeState(sessionPath, agentSlug);
      }
      try {
        await mcpLifecycle.close();
      } catch {
        // Best-effort MCP cleanup
      }
    }
  }

  /**
   * Write a compact pipeline summary to disk after orchestrator completion.
   *
   * Called from the finally blocks of runOrchestrator() and resumeOrchestrator().
   * The summary file is read by PromptBuilder.buildOrchestratorSummaryBlock()
   * on every subsequent turn to inject research context that survives SDK compaction.
   *
   * Handles partial pipelines gracefully — whatever stageOutputs exist get summarized.
   *
   * @param sessionPath - Absolute path to the session directory
   * @param totalStages - Total number of stages in the pipeline config
   * @param exitReason - Why the pipeline ended
   * @param preloadedState - Optional pre-loaded PipelineState to avoid redundant disk read
   */
  private writePipelineSummary(
    sessionPath: string,
    totalStages: number,
    exitReason: PipelineExitReason,
    preloadedState?: PipelineState,
  ): void {
    try {
      const state = preloadedState ?? PipelineState.loadFrom(sessionPath);
      if (!state) {
        this.onDebug?.('[orchestrator] writePipelineSummary: no pipeline state found — skipping');
        return;
      }

      const summary = state.generateSummary(totalStages, exitReason);
      const summaryPath = join(sessionPath, 'data', 'pipeline-summary.json');
      const dir = join(sessionPath, 'data');
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
      this.onDebug?.(`[orchestrator] writePipelineSummary: written to ${summaryPath}`);
    } catch (error) {
      // Non-fatal — best-effort summary writing
      this.onDebug?.(
        `[orchestrator] writePipelineSummary error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Detect if the current session has a completed prior orchestrator run.
   * Returns the session ID to use as previousSessionId, or undefined.
   *
   * Strategy: Check if `{sessionPath}/data/answer.json` exists.
   * If it does AND the agent has followUp.enabled, this is a follow-up.
   * The previousSessionId is the CURRENT session ID (same-session follow-up).
   *
   * Only activates when the agent's config has `followUp.enabled: true`.
   * Cross-session follow-ups are out of scope — future enhancement via explicit UI.
   */
  private resolveFollowUpSessionId(
    sessionPath: string,
    sessionId: string,
    agentConfig: OrchestratorAgentConfig,
  ): string | undefined {
    if (!agentConfig.followUp?.enabled) return undefined;

    const answerJsonPath = join(sessionPath, 'data', 'answer.json');
    if (!existsSync(answerJsonPath)) return undefined;

    this.onDebug?.(
      `[orchestrator] Follow-up auto-detected: answer.json exists at ${answerJsonPath}`,
    );
    return sessionId;
  }

  /**
   * Convert a LoadedAgent's config to the orchestrator's AgentConfig type.
   * Maps from the richer agents/types.ts AgentConfig to the simpler orchestrator/types.ts AgentConfig.
   */
  private toOrchestratorAgentConfig(agent: LoadedAgent): OrchestratorAgentConfig {
    const cfg = agent.config;
    return {
      slug: agent.slug,
      name: agent.metadata.name,
      controlFlow: {
        stages: cfg.controlFlow.stages.map(s => ({
          id: s.id,
          name: s.name,
          description: s.description,
        })),
        pauseAfterStages: cfg.controlFlow.pauseAfterStages,
        repairUnits: cfg.controlFlow.repairUnits?.map(ru => ({
          stages: Array.isArray(ru.stages) ? [...ru.stages] : [],
          maxIterations: ru.maxIterations,
          feedbackField: ru.feedbackField,
        })),
      },
      output: {
        titleTemplate: (cfg.output as unknown as Record<string, unknown>)?.['titleTemplate'] as string | undefined,
        citationFormat: cfg.output?.citationFormat,
      },
      // Pass through orchestrator config from config.json (F1 fix)
      // Maps from agents/types.ts inline type to orchestrator/types.ts OrchestratorConfig
      orchestrator: cfg.orchestrator?.enabled
        ? {
            enabled: true,
            model: cfg.orchestrator.model,
            thinking: cfg.orchestrator.thinking as { type: 'adaptive' | 'enabled' | 'disabled' } | undefined,
            effort: cfg.orchestrator.effort as 'max' | 'high' | 'medium' | 'low' | undefined,
            depthModeEffort: cfg.orchestrator.depthModeEffort,
            contextWindow: cfg.orchestrator.contextWindow,
            minOutputBudget: cfg.orchestrator.minOutputBudget,
            budgetUsd: cfg.orchestrator.budgetUsd,
            perStageDesiredTokens: cfg.orchestrator.perStageDesiredTokens
              ? Object.fromEntries(
                  Object.entries(cfg.orchestrator.perStageDesiredTokens)
                    .map(([k, v]) => [Number(k), v]),
                ) as Record<number, number>
              : undefined,
            useBAML: cfg.orchestrator.useBAML,
            bamlFallbackToZod: cfg.orchestrator.bamlFallbackToZod,
          }
        : undefined,
      // Resolve per-stage prompt files from agent directory (Phase 7)
      promptsDir: agent.path ? join(agent.path, 'prompts') : undefined,
      // Follow-up configuration for delta retrieval gating (Section 18)
      followUp: cfg.followUp ? {
        enabled: cfg.followUp.enabled,
        deltaRetrieval: cfg.followUp.deltaRetrieval,
      } : undefined,
    };
  }

  /**
   * Get an auth token for the orchestrator's LLM client.
   * Reads from the same env vars that sessions.ts sets before creating the agent.
   * OAuth token is preferred; falls back to API key.
   */
  private async getOrchestratorAuthToken(): Promise<string> {
    const oauthToken = process.env['CLAUDE_CODE_OAUTH_TOKEN'];
    if (oauthToken) return oauthToken;

    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (apiKey) return apiKey;

    throw new Error('No auth token available for orchestrator. Set CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY.');
  }

  /**
   * Run the deterministic orchestrator pipeline instead of SDK query().
   *
   * Maps OrchestratorEvent → onAgentEvent callback (for stage/pipeline events)
   * and yields AgentEvent (for text/complete events that flow through chat()).
   *
   * Event architecture:
   * - Stage events (started, completed, repair, pause, run_completed) →
   *   emitted via this.onAgentEvent callback → sessions.ts → renderer
   * - Text content → yielded as AgentEvent { type: 'text_delta' / 'text_complete' }
   * - Completion → yielded as AgentEvent { type: 'complete' }
   *
   * This matches the existing event flow pattern used by session-scoped tools
   * (agent_stage_gate), ensuring the renderer's event processor and agentRunStateAtom
   * work identically for both SDK-driven and orchestrator-driven pipelines.
   */
  private async *runOrchestrator(
    userMessage: string,
    loadedAgent: LoadedAgent,
  ): AsyncGenerator<AgentEvent> {
    const sessionId = this.config.session?.id ?? `orch-${Date.now()}`;
    const sessionPath = getSessionPath(this.workspaceRootPath, sessionId);
    const agentConfig = this.toOrchestratorAgentConfig(loadedAgent);
    const runId = `orch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const agentSlug = loadedAgent.slug;

    this.onDebug?.(`[orchestrator] Starting pipeline for agent=${agentSlug} runId=${runId}`);

    // Section 16 (G3): Track exit reason to conditionally clear bridge state
    let exitReason: OrchestratorExitReason = 'completed';

    // Create cost tracker with budget from agent config or default
    const budgetUsd = agentConfig.orchestrator?.budgetUsd ?? 50;
    const costTracker = new CostTracker({ budgetUsd });

    // ── MCP Bridge wiring ──────────────────────────────────────────────
    // Connect to the agent's required MCP source for programmatic tool calls.
    // The lifecycle manager ensures cleanup on completion or error.
    let mcpBridge: OrchestratorMcpBridge_T | null = null;
    const mcpLifecycle = new McpLifecycleManager();

    try {
      // Find first required MCP source from agent metadata
      const mcpSourceSlug = loadedAgent.metadata.sources
        ?.find(s => s.required)?.slug;

      if (mcpSourceSlug) {
        try {
          const sourceConfig = loadSourceConfig(this.workspaceRootPath, mcpSourceSlug);
          if (sourceConfig?.mcp) {
            const hasWebsearchStage = agentConfig.controlFlow.stages.some(s => s.name === 'websearch_calibration');
            if (hasWebsearchStage && !process.env['BRAVE_API_KEY']) {
              this.onDebug?.(
                '[orchestrator] Warning: BRAVE_API_KEY is not set. ' +
                'Stage 1 web search may return zero results; calibration will be skipped deterministically.',
              );
            }
            const transportConfig = extractTransportConfig(
              sourceConfig.mcp as unknown as Record<string, unknown>,
              this.workspaceRootPath,
            );
            this.onDebug?.(
              `[orchestrator] MCP bridge connect attempt: source=${mcpSourceSlug} ` +
              `transport=${transportConfig.transport} command=${transportConfig.command ?? '<none>'} ` +
              `cwd=${transportConfig.cwd ?? '<none>'}`,
            );
            const mcpClient = await mcpLifecycle.connect(transportConfig);
            mcpBridge = new OrchestratorMcpBridge(mcpClient);
            this.onDebug?.(`[orchestrator] MCP bridge connected: ${mcpSourceSlug}`);
          } else {
            this.onDebug?.(`[orchestrator] Source '${mcpSourceSlug}' has no MCP config — bridge skipped`);
          }
        } catch (mcpError) {
          // MCP connection failure is non-fatal — stages 2/4 have null-bridge guards
          this.onDebug?.(
            `[orchestrator] MCP bridge connection failed (non-fatal): ` +
            `${mcpError instanceof Error ? mcpError.message : String(mcpError)}`,
          );
        }
      }

      // ── Follow-up auto-detection (Section 21) ─────────────────────
      // Check if a prior completed orchestrator run exists in the same session.
      // If so, pass its session ID so follow-up context is loaded at pipeline start.
      const previousSessionId = this.resolveFollowUpSessionId(sessionPath, sessionId, agentConfig);
      if (previousSessionId) {
        this.onDebug?.(
          `[orchestrator] Follow-up mode: previousSessionId=${previousSessionId} (same-session auto-detect)`,
        );
      }

      // ── Create orchestrator instance ───────────────────────────────
      // Inside try block so create() failures are caught and yield 'complete' (F7 fix)
      // Compute orchTurnId so the real-time callback and generator use the same turnId
      const orchTurnId = `orch-${runId}`;
      const orchestrator = AgentOrchestrator.create(
        {
          sessionId,
          sessionPath,
          getAuthToken: () => this.getOrchestratorAuthToken(),
          onStreamEvent: (event) => {
            // Forward text/thinking deltas for debug logging.
            if (event.type === 'text_delta' && event.text) {
              this.onDebug?.(`[orchestrator] stream: ${event.text.slice(0, 50)}...`);
            }
          },
          onDebug: this.onDebug ? (msg: string) => this.onDebug?.(msg) : undefined,
          previousSessionId, // Section 21: auto-detected from prior answer.json
          // Real-time substep delivery — fires immediately during stage execution,
          // bypassing the generator queue so the UI shows progress in real-time.
          onSubstepEvent: (substep, stageId) => {
            switch (substep.type) {
              case 'mcp_start':
                this.onAgentEvent?.({
                  type: 'agent_substep_start',
                  agentSlug,
                  runId,
                  data: {
                    stageId,
                    toolName: substep.toolName,
                    toolUseId: substep.toolUseId,
                    input: substep.input,
                    turnId: orchTurnId,
                    parentToolUseId: substep.parentToolUseId,
                  },
                });
                break;
              case 'mcp_result':
                this.onAgentEvent?.({
                  type: 'agent_substep_result',
                  agentSlug,
                  runId,
                  data: {
                    stageId,
                    toolUseId: substep.toolUseId,
                    toolName: substep.toolName,
                    result: substep.result,
                    isError: substep.isError ?? false,
                    turnId: orchTurnId,
                    parentToolUseId: substep.parentToolUseId,
                  },
                });
                break;
              case 'llm_start':
                this.onAgentEvent?.({
                  type: 'agent_substep_start',
                  agentSlug,
                  runId,
                  data: {
                    stageId,
                    toolName: 'orchestrator_llm',
                    toolUseId: substep.toolUseId,
                    input: { stage: substep.stageName, stageId: substep.stageId },
                    turnId: orchTurnId,
                    intent: `Analyzing: ${substep.stageName}`,
                    parentToolUseId: substep.parentToolUseId,
                  },
                });
                break;
              case 'llm_complete':
                this.onAgentEvent?.({
                  type: 'agent_substep_result',
                  agentSlug,
                  runId,
                  data: {
                    stageId,
                    toolUseId: substep.toolUseId,
                    toolName: 'orchestrator_llm',
                    result: substep.text,
                    isError: false,
                    turnId: orchTurnId,
                    parentToolUseId: substep.parentToolUseId,
                  },
                });
                break;
              case 'status':
                // Status events are transient — no real-time delivery needed
                break;
            }
          },
        },
        mcpBridge,
        costTracker,
        agentConfig.orchestrator ?? undefined,
      );

      // ── Pipeline event loop ────────────────────────────────────────
      exitReason = yield* this.processOrchestratorEvents(
        orchestrator.run(userMessage, agentConfig),
        agentSlug, runId, sessionPath,
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.onDebug?.(`[orchestrator] Pipeline error: ${errorMessage}`);
      yield { type: 'error', message: `Orchestrator error: ${errorMessage}` };
      this.onAgentEvent?.({
        type: 'agent_run_completed',
        agentSlug,
        runId,
        data: { verificationStatus: 'error', error: errorMessage },
      });
      exitReason = 'error';
    }

    // Always yield complete at the end (F7 fix — now reachable even if create() throws)
    // Section 16: Wrap in try/finally so MCP cleanup runs even when
    // sessions.ts returns from the for-await loop on 'complete' (which
    // calls generator.return(), making post-yield code unreachable).
    // Bridge state is only cleared on 'completed' exit — preserved on 'paused' for resume detection.
    try {
      yield { type: 'complete' };
    } finally {
      this.onDebug?.(`[orchestrator] Cleanup: exitReason=${exitReason}`);
      // Write pipeline summary for context injection on subsequent turns
      this.writePipelineSummary(sessionPath, agentConfig.controlFlow.stages.length, exitReason);
      // Only clear bridge state when pipeline is done — preserve on pause for resume detection (G4)
      if (exitReason !== 'paused') {
        this.clearOrchestratorBridgeState(sessionPath, agentSlug);
      }
      // Ensure MCP client is closed — guaranteed by finally block (all exit paths)
      try {
        await mcpLifecycle.close();
      } catch {
        // Best-effort MCP cleanup
      }
    }
  }

  /**
   * Resume a paused orchestrator pipeline.
   *
   * Called when the user sends a follow-up message and a paused orchestrator
   * pipeline is detected for the session. Routes to orchestrator.resume()
   * instead of orchestrator.run().
   */
  private async *resumeOrchestrator(
    userMessage: string,
    loadedAgent: LoadedAgent,
  ): AsyncGenerator<AgentEvent> {
    const sessionId = this.config.session?.id ?? `orch-${Date.now()}`;
    const sessionPath = getSessionPath(this.workspaceRootPath, sessionId);
    const agentConfig = this.toOrchestratorAgentConfig(loadedAgent);
    const runId = `orch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const agentSlug = loadedAgent.slug;

    this.onDebug?.(`[orchestrator] Resuming pipeline for agent=${agentSlug} runId=${runId}`);

    // Section 16 (G3): Track exit reason to conditionally clear bridge state
    let exitReason: OrchestratorExitReason = 'completed';

    // Section 16 (G7): Do NOT clear bridge state before pipeline starts.
    // If MCP connect fails or resume throws, bridge state must survive for retry.
    // Conditional clear in the finally block handles all exits.

    // Re-create cost tracker (costs from earlier stages are in pipeline-state.json, not tracked here)
    const budgetUsd = agentConfig.orchestrator?.budgetUsd ?? 50;
    const costTracker = new CostTracker({ budgetUsd });

    // ── MCP Bridge wiring (same as runOrchestrator) ────────────────
    let mcpBridge: OrchestratorMcpBridge_T | null = null;
    const mcpLifecycle = new McpLifecycleManager();

    try {
      const mcpSourceSlug = loadedAgent.metadata.sources
        ?.find(s => s.required)?.slug;

      if (mcpSourceSlug) {
        try {
          const sourceConfig = loadSourceConfig(this.workspaceRootPath, mcpSourceSlug);
          if (sourceConfig?.mcp) {
            const hasWebsearchStage = agentConfig.controlFlow.stages.some(s => s.name === 'websearch_calibration');
            if (hasWebsearchStage && !process.env['BRAVE_API_KEY']) {
              this.onDebug?.(
                '[orchestrator] Warning: BRAVE_API_KEY is not set. ' +
                'Stage 1 web search may return zero results; calibration will be skipped deterministically.',
              );
            }
            const transportConfig = extractTransportConfig(
              sourceConfig.mcp as unknown as Record<string, unknown>,
              this.workspaceRootPath,
            );
            this.onDebug?.(
              `[orchestrator] MCP bridge connect attempt (resume): source=${mcpSourceSlug} ` +
              `transport=${transportConfig.transport} command=${transportConfig.command ?? '<none>'} ` +
              `cwd=${transportConfig.cwd ?? '<none>'}`,
            );
            const mcpClient = await mcpLifecycle.connect(transportConfig);
            mcpBridge = new OrchestratorMcpBridge(mcpClient);
            this.onDebug?.(`[orchestrator] MCP bridge connected for resume: ${mcpSourceSlug}`);
          }
        } catch (mcpError) {
          this.onDebug?.(
            `[orchestrator] MCP bridge connection failed on resume (non-fatal): ` +
            `${mcpError instanceof Error ? mcpError.message : String(mcpError)}`,
          );
        }
      }

      // Create orchestrator instance for resume
      // Compute orchTurnId so the real-time callback and generator use the same turnId
      const orchTurnId = `orch-${runId}`;
      const orchestrator = AgentOrchestrator.create(
        {
          sessionId,
          sessionPath,
          getAuthToken: () => this.getOrchestratorAuthToken(),
          onStreamEvent: (event) => {
            if (event.type === 'text_delta' && event.text) {
              this.onDebug?.(`[orchestrator] resume stream: ${event.text.slice(0, 50)}...`);
            }
          },
          onDebug: this.onDebug ? (msg: string) => this.onDebug?.(msg) : undefined,
          // Real-time substep delivery — same callback as runOrchestrator
          onSubstepEvent: (substep, stageId) => {
            switch (substep.type) {
              case 'mcp_start':
                this.onAgentEvent?.({
                  type: 'agent_substep_start',
                  agentSlug,
                  runId,
                  data: {
                    stageId,
                    toolName: substep.toolName,
                    toolUseId: substep.toolUseId,
                    input: substep.input,
                    turnId: orchTurnId,
                    parentToolUseId: substep.parentToolUseId,
                  },
                });
                break;
              case 'mcp_result':
                this.onAgentEvent?.({
                  type: 'agent_substep_result',
                  agentSlug,
                  runId,
                  data: {
                    stageId,
                    toolUseId: substep.toolUseId,
                    toolName: substep.toolName,
                    result: substep.result,
                    isError: substep.isError ?? false,
                    turnId: orchTurnId,
                    parentToolUseId: substep.parentToolUseId,
                  },
                });
                break;
              case 'llm_start':
                this.onAgentEvent?.({
                  type: 'agent_substep_start',
                  agentSlug,
                  runId,
                  data: {
                    stageId,
                    toolName: 'orchestrator_llm',
                    toolUseId: substep.toolUseId,
                    input: { stage: substep.stageName, stageId: substep.stageId },
                    turnId: orchTurnId,
                    intent: `Analyzing: ${substep.stageName}`,
                    parentToolUseId: substep.parentToolUseId,
                  },
                });
                break;
              case 'llm_complete':
                this.onAgentEvent?.({
                  type: 'agent_substep_result',
                  agentSlug,
                  runId,
                  data: {
                    stageId,
                    toolUseId: substep.toolUseId,
                    toolName: 'orchestrator_llm',
                    result: substep.text,
                    isError: false,
                    turnId: orchTurnId,
                    parentToolUseId: substep.parentToolUseId,
                  },
                });
                break;
              case 'status':
                break;
            }
          },
        },
        mcpBridge,
        costTracker,
        agentConfig.orchestrator ?? undefined,
      );

      // ── Resume pipeline from paused state ──────────────────────────
      exitReason = yield* this.processOrchestratorEvents(
        orchestrator.resume(userMessage, agentConfig),
        agentSlug, runId, sessionPath,
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.onDebug?.(`[orchestrator] Resume error: ${errorMessage}`);
      yield { type: 'error', message: `Orchestrator resume error: ${errorMessage}` };
      this.onAgentEvent?.({
        type: 'agent_run_completed',
        agentSlug,
        runId,
        data: { verificationStatus: 'error', error: errorMessage },
      });
      exitReason = 'error';
    }

    // Section 16: Wrap in try/finally so MCP cleanup runs even when
    // sessions.ts returns from the for-await loop on 'complete' (which
    // calls generator.return(), making post-yield code unreachable).
    // Bridge state is only cleared on 'completed' exit — preserved on 'paused' for resume detection.
    try {
      yield { type: 'complete' };
    } finally {
      this.onDebug?.(`[orchestrator] Resume cleanup: exitReason=${exitReason}`);
      // Write pipeline summary for context injection on subsequent turns
      this.writePipelineSummary(sessionPath, agentConfig.controlFlow.stages.length, exitReason);
      // Only clear bridge state when pipeline is done — preserve on pause for resume detection (G4)
      if (exitReason !== 'paused') {
        this.clearOrchestratorBridgeState(sessionPath, agentSlug);
      }
      // Ensure MCP client is closed — guaranteed by finally block (all exit paths)
      try {
        await mcpLifecycle.close();
      } catch {
        // Best-effort MCP cleanup
      }
    }
  }

  /**
   * Process orchestrator events — shared between run() and resume().
   *
   * Maps OrchestratorEvent → AgentEvent yields + onAgentEvent callbacks.
   * Extracts the common event loop to avoid code duplication between
   * runOrchestrator() and resumeOrchestrator().
   */
  private async *processOrchestratorEvents(
    events: AsyncGenerator<import('./orchestrator/types.ts').OrchestratorEvent>,
    agentSlug: string,
    runId: string,
    sessionPath: string,
  ): AsyncGenerator<AgentEvent, OrchestratorExitReason> {
    // Section 16 (G3): Track exit reason as generator return value
    let exitReason: OrchestratorExitReason = 'completed';

    // Stable orchestrator turn ID — groups all substep tool activities under one turn
    const orchTurnId = `orch-${runId}`;
    // Unique counter for text_complete yields — each gets its own turnId so
    // handleTextComplete never overwrites a previous stage's assistant message (F1 fix)
    let orchTextCounter = 0;

    for await (const event of events) {
      switch (event.type) {
        case 'orchestrator_stage_start':
          this.onAgentEvent?.({
            type: 'agent_stage_started',
            agentSlug,
            runId,
            data: {
              stage: event.stage,
              stageName: event.name,
            },
          });
          break;

        case 'orchestrator_stage_complete':
          this.onAgentEvent?.({
            type: 'agent_stage_completed',
            agentSlug,
            runId,
            data: {
              stage: event.stage,
              stageName: event.name,
              ...(event.stageOutput ?? {}),
            },
          });
          // F5: Yield intermediate text so UI shows stage progress between LLM calls
          // Each text_complete gets a unique turnId (F1 fix — prevents message overwriting)
          yield {
            type: 'text_complete',
            text: `**Stage ${event.stage} (${event.name})** completed.`,
            isIntermediate: true,
            turnId: `${orchTurnId}-text-${orchTextCounter++}`,
          };
          break;

        case 'orchestrator_substep': {
          const substep = event.substep;
          switch (substep.type) {
            case 'mcp_start':
              yield {
                type: 'tool_start',
                toolName: substep.toolName,
                toolUseId: substep.toolUseId,
                input: substep.input,
                turnId: orchTurnId,
                parentToolUseId: substep.parentToolUseId,
              };
              break;
            case 'mcp_result':
              yield {
                type: 'tool_result',
                toolUseId: substep.toolUseId,
                toolName: substep.toolName,
                result: substep.result,
                isError: substep.isError ?? false,
                turnId: orchTurnId,
                parentToolUseId: substep.parentToolUseId,
              };
              break;
            case 'llm_start':
              yield {
                type: 'tool_start',
                toolName: 'orchestrator_llm',
                toolUseId: substep.toolUseId,
                input: { stage: substep.stageName, stageId: substep.stageId },
                turnId: orchTurnId,
                intent: `Analyzing: ${substep.stageName}`,
                parentToolUseId: substep.parentToolUseId,
              };
              break;
            case 'llm_complete':
              yield {
                type: 'tool_result',
                toolUseId: substep.toolUseId,
                toolName: 'orchestrator_llm',
                result: substep.text,
                isError: false,
                turnId: orchTurnId,
                parentToolUseId: substep.parentToolUseId,
              };
              break;
            case 'status':
              yield { type: 'status', message: substep.message };
              break;
          }
          break;
        }

        case 'orchestrator_repair_start':
          this.onAgentEvent?.({
            type: 'agent_repair_iteration',
            agentSlug,
            runId,
            data: {
              iteration: event.iteration,
              scores: event.scores,
            },
          });
          break;

        case 'orchestrator_pause':
          // Section 16 (G8): Write bridge state BEFORE yield to prevent generator.return() cancellation
          this.writeOrchestratorBridgeState(sessionPath, agentSlug, event.stage, runId);

          // Yield pause message as assistant text so user sees the analysis
          // Unique turnId per text_complete (F1 fix — prevents message overwriting)
          yield { type: 'text_complete', text: event.message, isIntermediate: false, turnId: `${orchTurnId}-text-${orchTextCounter++}` };

          // Emit stage gate pause for renderer's agentRunStateAtom
          this.onAgentStagePause?.({
            agentSlug,
            stage: event.stage,
            runId,
            data: { message: event.message, orchestratorMode: true },
          });
          exitReason = 'paused';
          break;

        case 'orchestrator_complete':
          this.onAgentEvent?.({
            type: 'agent_run_completed',
            agentSlug,
            runId,
            data: {
              verificationStatus: 'completed',
              totalCostUsd: event.totalCostUsd,
              stageCount: event.stageCount,
            },
          });
          exitReason = 'completed';
          break;

        case 'orchestrator_budget_exceeded':
          yield { type: 'error', message: `Budget exceeded: $${event.totalCost.toFixed(2)}` };
          this.onAgentEvent?.({
            type: 'agent_run_completed',
            agentSlug,
            runId,
            data: { verificationStatus: 'budget_exceeded' },
          });
          exitReason = 'error';
          break;

        case 'text':
          // Unique turnId per text_complete (F1 fix — prevents message overwriting)
          yield { type: 'text_complete', text: event.text, isIntermediate: false, turnId: `${orchTurnId}-text-${orchTextCounter++}` };
          break;

        case 'orchestrator_error':
          yield { type: 'error', message: `Stage ${event.stage} error: ${event.error}` };
          this.onAgentEvent?.({
            type: 'agent_run_completed',
            agentSlug,
            runId,
            data: { verificationStatus: 'error', error: event.error },
          });
          exitReason = 'error';
          break;
      }
    }

    this.onDebug?.(`[orchestrator] processOrchestratorEvents exiting: exitReason=${exitReason}`);
    return exitReason;
  }

  // ============================================================
}

// ============================================================
// Backward Compatibility Exports
// ============================================================
// These aliases allow gradual migration from CraftAgent to ClaudeAgent.
// Once all consumers are updated, these can be removed.

/** @deprecated Use ClaudeAgent instead */
export { ClaudeAgent as CraftAgent };

/** @deprecated Use ClaudeAgentConfig instead */
export type { ClaudeAgentConfig as CraftAgentConfig };
