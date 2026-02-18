/**
 * Agent State Handler
 *
 * Manages accumulated agent state persisted across runs in state.json.
 * Uses replace-all semantics for updates: Object.assign(currentState, data)
 * overwrites top-level keys rather than deep merging, because
 * Record<string, unknown> cannot reliably deep merge (nested arrays vs
 * objects are ambiguous).
 *
 * State path: {workspacePath}/sessions/{sessionId}/data/agents/{slug}/state.json
 */

import { join } from 'node:path';
import { mkdirSync, renameSync } from 'node:fs';
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

// ============================================================
// Types
// ============================================================

export interface AgentStateArgs {
  agentSlug: string;
  action: 'read' | 'update' | 'init';
  data?: Record<string, unknown>;
}

// ============================================================
// Helpers
// ============================================================

function getAgentDataDir(ctx: SessionToolContext, agentSlug: string): string {
  return join(ctx.workspacePath, 'sessions', ctx.sessionId, 'data', 'agents', agentSlug);
}

function getStatePath(ctx: SessionToolContext, agentSlug: string): string {
  return join(getAgentDataDir(ctx, agentSlug), 'state.json');
}

// ============================================================
// Main Handler
// ============================================================

export async function handleAgentState(
  ctx: SessionToolContext,
  args: AgentStateArgs,
): Promise<ToolResult> {
  const { agentSlug, action } = args;
  const dataDir = getAgentDataDir(ctx, agentSlug);
  const statePath = getStatePath(ctx, agentSlug);

  switch (action) {
    case 'init': {
      // Create state.json with empty object (agent defines its own schema)
      mkdirSync(dataDir, { recursive: true });
      if (ctx.fs.exists(statePath)) {
        return errorResponse(
          `State already exists for agent '${agentSlug}'. Use action=read to inspect or action=update to modify.`,
        );
      }
      ctx.fs.writeFile(statePath, JSON.stringify({}, null, 2));
      return successResponse(JSON.stringify({ initialized: true, state: {} }, null, 2));
    }

    case 'read': {
      if (!ctx.fs.exists(statePath)) {
        return successResponse(
          JSON.stringify({ initialized: false, state: null }, null, 2),
        );
      }
      try {
        const state = JSON.parse(ctx.fs.readFile(statePath));
        return successResponse(JSON.stringify({ initialized: true, state }, null, 2));
      } catch {
        return errorResponse(`Failed to parse state.json for agent '${agentSlug}'.`);
      }
    }

    case 'update': {
      if (!args.data) {
        return errorResponse('data is required for update action.');
      }

      mkdirSync(dataDir, { recursive: true });

      // Read current state (or start from empty)
      let currentState: Record<string, unknown> = {};
      if (ctx.fs.exists(statePath)) {
        try {
          currentState = JSON.parse(ctx.fs.readFile(statePath));
        } catch (err) {
          // Corrupted state — start fresh but log diagnostic
          console.warn(`[agent-state] Corrupted state.json for '${agentSlug}', starting fresh:`, err);
          currentState = {};
        }
      }

      // Replace-all semantics: Object.assign overwrites top-level keys
      const updatedState = Object.assign(currentState, args.data);

      // Atomic write
      const tmpPath = statePath + '.tmp';
      ctx.fs.writeFile(tmpPath, JSON.stringify(updatedState, null, 2));
      renameSync(tmpPath, statePath);

      return successResponse(JSON.stringify({ initialized: true, state: updatedState }, null, 2));
    }

    default:
      return errorResponse(
        `Unknown action: ${action}. Valid: init, read, update.`,
      );
  }
}
