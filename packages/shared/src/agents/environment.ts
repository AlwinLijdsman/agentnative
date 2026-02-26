/**
 * Agent Environment Resolution
 *
 * Pure function that resolves which sources need to be auto-enabled
 * when agents are @mentioned in a chat message.
 *
 * This function has no filesystem or IPC dependencies — all data
 * is passed in as arguments, making it independently testable.
 */

import { parseMentions } from '../mentions/index.ts';
import type { LoadedAgent } from './types.ts';
import type { LoadedSource } from '../sources/types.ts';
import { isSourceUsable } from '../sources/storage.ts';

// ============================================================
// Types
// ============================================================

/** Diagnostic entry for tracing auto-enable decisions */
export interface AutoEnableDiagnostic {
  step: string;
  detail: string;
}

/** Warning about a source that could not be auto-enabled */
export interface AutoEnableWarning {
  agentSlug: string;
  sourceSlug: string;
  reason: 'not_found' | 'not_usable';
  detail: string;
}

/** Result of resolving agent environment */
export interface AgentEnvironmentResolution {
  /** Source slugs that should be added to the session */
  slugsToAdd: string[];
  /** Warnings about sources that could not be enabled */
  warnings: AutoEnableWarning[];
  /** Diagnostic trace for debugging */
  diagnostics: AutoEnableDiagnostic[];
  /** Agent slugs that were matched from the message */
  matchedAgents: string[];
}

// ============================================================
// Pure Resolution Function
// ============================================================

/**
 * Resolve which sources need to be auto-enabled for agents mentioned in a message.
 *
 * @param message - The chat message text (may contain [agent:slug] mentions)
 * @param agents - All loaded workspace agents
 * @param availableSources - All sources available in the workspace
 * @param currentEnabledSlugs - Source slugs already enabled in the session
 * @returns Resolution result with slugs to add, warnings, and diagnostics
 */
export function resolveAgentEnvironment(
  message: string,
  agents: LoadedAgent[],
  availableSources: LoadedSource[],
  currentEnabledSlugs: string[],
): AgentEnvironmentResolution {
  const result: AgentEnvironmentResolution = {
    slugsToAdd: [],
    warnings: [],
    diagnostics: [],
    matchedAgents: [],
  };

  // Guard: fast-path check
  if (!message.includes('[agent:')) {
    result.diagnostics.push({ step: 'guard', detail: 'Message does not contain [agent: — skipping' });
    return result;
  }

  result.diagnostics.push({ step: 'guard', detail: 'Message contains [agent: — proceeding' });

  // Parse agent mentions
  const agentSlugs = agents.map(a => a.slug);
  const parsed = parseMentions(message, [], [], agentSlugs);
  result.matchedAgents = parsed.agents;

  result.diagnostics.push({
    step: 'parseMentions',
    detail: `input agentSlugs=[${agentSlugs.join(', ')}], matched=[${parsed.agents.join(', ')}]`,
  });

  if (parsed.agents.length === 0) {
    result.diagnostics.push({
      step: 'parseMentions',
      detail: 'Guard passed but 0 agents matched — message may contain [agent: text that is not a valid mention',
    });
    return result;
  }

  // Build lookup map for available sources
  const sourceBySlug = new Map<string, LoadedSource>();
  for (const source of availableSources) {
    sourceBySlug.set(source.config.slug, source);
  }

  const slugSet = new Set(currentEnabledSlugs);

  for (const agentSlug of parsed.agents) {
    const agent = agents.find(a => a.slug === agentSlug);
    if (!agent?.metadata.sources) {
      result.diagnostics.push({
        step: 'agent_iteration',
        detail: `Agent ${agentSlug}: no source bindings declared`,
      });
      continue;
    }

    result.diagnostics.push({
      step: 'agent_iteration',
      detail: `Agent ${agentSlug}: ${agent.metadata.sources.length} source binding(s): [${agent.metadata.sources.map(s => `${s.slug}(required=${s.required})`).join(', ')}]`,
    });

    for (const sourceBinding of agent.metadata.sources) {
      if (!sourceBinding.required) continue;

      if (slugSet.has(sourceBinding.slug)) {
        result.diagnostics.push({
          step: 'source_check',
          detail: `Source ${sourceBinding.slug}: already enabled, skipping`,
        });
        continue;
      }

      const source = sourceBySlug.get(sourceBinding.slug);
      if (!source) {
        result.warnings.push({
          agentSlug,
          sourceSlug: sourceBinding.slug,
          reason: 'not_found',
          detail: `Required source ${sourceBinding.slug} for agent ${agentSlug} not found in workspace. Available: [${Array.from(sourceBySlug.keys()).join(', ')}]`,
        });
        continue;
      }

      if (!isSourceUsable(source)) {
        result.warnings.push({
          agentSlug,
          sourceSlug: sourceBinding.slug,
          reason: 'not_usable',
          detail: `Required source ${sourceBinding.slug} for agent ${agentSlug} is not usable — enabled=${source.config.enabled}, type=${source.config.type}, authType=${source.config.api?.authType ?? 'none'}`,
        });
        continue;
      }

      slugSet.add(sourceBinding.slug);
      result.slugsToAdd.push(sourceBinding.slug);
      result.diagnostics.push({
        step: 'source_enabled',
        detail: `Auto-enabled required source ${sourceBinding.slug} for agent ${agentSlug}`,
      });
    }
  }

  result.diagnostics.push({
    step: 'result',
    detail: `slugsToAdd=[${result.slugsToAdd.join(', ')}], warnings=${result.warnings.length}, final enabledSlugs=[${Array.from(slugSet).join(', ')}]`,
  });

  return result;
}
