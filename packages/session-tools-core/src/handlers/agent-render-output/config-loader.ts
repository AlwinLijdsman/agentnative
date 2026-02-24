/**
 * Config Loader — Load and merge agent output config with defaults.
 *
 * Reads the `output` section from an agent's config.json and merges
 * with sensible defaults so the renderer always has complete config.
 */

import type { RenderConfig } from './types.ts';

/**
 * Default render config — used when agent config has no `output` section
 * or when specific fields are missing.
 */
const DEFAULT_RENDER_CONFIG: RenderConfig = {
  renderer: { type: 'research', version: '1.0' },
  titleTemplate: 'Research',
  followupTitleTemplate: 'Research Follow-Up #{n}',
  citationFormat: '{ref}',
  citationRegex: '\\([^)]+\\)',
  sourceDiscovery: {
    enabled: false,
    linkerType: 'noop',
  },
  sections: {
    externalReferencesTitle: 'External References',
    priorResearchTitle: 'Prior Research References',
    verificationSummaryTitle: 'Verification Summary',
    citationsUsedTitle: 'Citations Used',
    researchDecompositionTitle: 'Appendix: Research Decomposition',
  },
  priorResearch: {
    refFormat: '[P{num}]',
    excerptLength: 200,
  },
  confidence: {
    qualifierThresholds: { high: 0.85, medium: 0.70 },
  },
  files: {
    answerFile: 'research-output.md',
    followupTemplate: 'research-output-followup-{n}.md',
  },
};

/**
 * Load the `output` section from a raw agent config object.
 * Returns null if not present.
 */
export function extractOutputConfig(rawConfig: Record<string, unknown>): Partial<RenderConfig> | null {
  if (!rawConfig.output || typeof rawConfig.output !== 'object') {
    return null;
  }
  return rawConfig.output as Partial<RenderConfig>;
}

/**
 * Deep merge of render configs — runtime overrides take precedence
 * over agent config, which takes precedence over defaults.
 */
export function mergeRenderConfig(
  agentConfig: Partial<RenderConfig> | null,
  runtimeOverrides?: Partial<RenderConfig>,
): RenderConfig {
  // Start with defaults
  const merged = structuredClone(DEFAULT_RENDER_CONFIG);

  // Layer 1: agent config
  if (agentConfig) {
    applyPartial(merged as unknown as Record<string, unknown>, agentConfig as Record<string, unknown>);
  }

  // Layer 2: runtime overrides
  if (runtimeOverrides) {
    applyPartial(merged as unknown as Record<string, unknown>, runtimeOverrides as Record<string, unknown>);
  }

  return merged;
}

/**
 * Apply partial config onto a base config, preserving nested structure.
 */
function applyPartial(base: Record<string, unknown>, partial: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(partial)) {
    if (value === undefined) continue;

    if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      typeof base[key] === 'object' &&
      base[key] !== null &&
      !Array.isArray(base[key])
    ) {
      // Recurse into nested objects
      applyPartial(base[key] as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      base[key] = value;
    }
  }
}
