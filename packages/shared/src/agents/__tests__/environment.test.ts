/**
 * Tests for resolveAgentEnvironment() pure function
 *
 * Covers: happy path, deduplication, warnings, guard paths,
 * already-enabled filtering, Windows path handling, and edge cases.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAgentEnvironment } from '../environment.ts';
import type { LoadedAgent, AgentMetadata, AgentConfig, AgentSourceBinding } from '../types.ts';
import type { LoadedSource, FolderSourceConfig } from '../../sources/types.ts';

// ============================================================================
// Mock Factories
// ============================================================================

function makeAgent(slug: string, sources?: AgentSourceBinding[]): LoadedAgent {
  return {
    slug,
    metadata: {
      name: slug,
      description: `Test agent ${slug}`,
      sources,
    } as AgentMetadata,
    content: '',
    config: {} as AgentConfig,
    path: `/agents/${slug}`,
    source: 'workspace',
  };
}

function makeSource(
  slug: string,
  opts: {
    enabled?: boolean;
    authType?: 'oauth' | 'bearer' | 'none';
    isAuthenticated?: boolean;
    type?: 'mcp' | 'api' | 'local';
  } = {},
): LoadedSource {
  const {
    enabled = true,
    authType,
    isAuthenticated,
    type = 'mcp',
  } = opts;

  const config: FolderSourceConfig = {
    id: `${slug}_abc123`,
    name: slug,
    slug,
    enabled,
    provider: slug,
    type,
  };

  // Add auth-related config based on source type
  if (type === 'mcp' && authType !== undefined) {
    config.mcp = { authType };
  } else if (type === 'api' && authType !== undefined) {
    config.api = { baseUrl: 'https://example.com', authType };
  }

  if (isAuthenticated !== undefined) {
    config.isAuthenticated = isAuthenticated;
  }

  return {
    config,
    guide: null,
    folderPath: `/sources/${slug}`,
    workspaceRootPath: '/workspace',
    workspaceId: 'test-workspace',
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('resolveAgentEnvironment', () => {
  // -----------------------------------------------------------------------
  // 1. Happy path: 1 agent, 1 required source, source usable
  // -----------------------------------------------------------------------
  it('returns slug when agent has one required usable source', () => {
    const agents = [makeAgent('research', [{ slug: 'brave', required: true }])];
    const sources = [makeSource('brave')];

    const result = resolveAgentEnvironment(
      'Please [agent:research] this topic',
      agents,
      sources,
      [],
    );

    assert.deepStrictEqual(result.slugsToAdd, ['brave']);
    assert.deepStrictEqual(result.matchedAgents, ['research']);
    assert.equal(result.warnings.length, 0);
  });

  // -----------------------------------------------------------------------
  // 2. Multiple agents sharing 1 source -> deduplicated slug
  // -----------------------------------------------------------------------
  it('deduplicates slugs when multiple agents need the same source', () => {
    const agents = [
      makeAgent('agent-a', [{ slug: 'shared-src', required: true }]),
      makeAgent('agent-b', [{ slug: 'shared-src', required: true }]),
    ];
    const sources = [makeSource('shared-src')];

    const result = resolveAgentEnvironment(
      '[agent:agent-a] and [agent:agent-b] both need it',
      agents,
      sources,
      [],
    );

    assert.deepStrictEqual(result.slugsToAdd, ['shared-src']);
    assert.equal(result.warnings.length, 0);
  });

  // -----------------------------------------------------------------------
  // 3. Source not found -> warning with reason 'not_found'
  // -----------------------------------------------------------------------
  it('warns not_found when required source is missing from available sources', () => {
    const agents = [makeAgent('research', [{ slug: 'missing-src', required: true }])];
    const sources: LoadedSource[] = [];

    const result = resolveAgentEnvironment(
      '[agent:research]',
      agents,
      sources,
      [],
    );

    assert.equal(result.slugsToAdd.length, 0);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0]!.reason, 'not_found');
    assert.equal(result.warnings[0]!.sourceSlug, 'missing-src');
    assert.equal(result.warnings[0]!.agentSlug, 'research');
  });

  // -----------------------------------------------------------------------
  // 4. Source not usable (disabled) -> warning with reason 'not_usable'
  // -----------------------------------------------------------------------
  it('warns not_usable when required source is disabled', () => {
    const agents = [makeAgent('research', [{ slug: 'disabled-src', required: true }])];
    const sources = [makeSource('disabled-src', { enabled: false })];

    const result = resolveAgentEnvironment(
      '[agent:research]',
      agents,
      sources,
      [],
    );

    assert.equal(result.slugsToAdd.length, 0);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0]!.reason, 'not_usable');
    assert.equal(result.warnings[0]!.sourceSlug, 'disabled-src');
  });

  // -----------------------------------------------------------------------
  // 5. Source not usable (needs auth) -> warning with reason 'not_usable'
  // -----------------------------------------------------------------------
  it('warns not_usable when required source needs auth but is not authenticated', () => {
    const agents = [makeAgent('research', [{ slug: 'oauth-src', required: true }])];
    const sources = [
      makeSource('oauth-src', {
        enabled: true,
        authType: 'oauth',
        isAuthenticated: false,
      }),
    ];

    const result = resolveAgentEnvironment(
      '[agent:research]',
      agents,
      sources,
      [],
    );

    assert.equal(result.slugsToAdd.length, 0);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0]!.reason, 'not_usable');
  });

  // -----------------------------------------------------------------------
  // 6. No agent mentions -> empty result with guard diagnostic
  // -----------------------------------------------------------------------
  it('returns empty result with guard diagnostic when no [agent: in message', () => {
    const agents = [makeAgent('research', [{ slug: 'brave', required: true }])];
    const sources = [makeSource('brave')];

    const result = resolveAgentEnvironment(
      'Just a normal message with no mentions',
      agents,
      sources,
      [],
    );

    assert.equal(result.slugsToAdd.length, 0);
    assert.equal(result.matchedAgents.length, 0);
    assert.equal(result.warnings.length, 0);
    assert.ok(result.diagnostics.some(d => d.step === 'guard' && d.detail.includes('skipping')));
  });

  // -----------------------------------------------------------------------
  // 7. Agent has no required sources -> empty slugsToAdd
  // -----------------------------------------------------------------------
  it('returns empty slugsToAdd when agent has no source bindings', () => {
    const agents = [makeAgent('simple-agent')]; // no sources
    const sources = [makeSource('brave')];

    const result = resolveAgentEnvironment(
      '[agent:simple-agent]',
      agents,
      sources,
      [],
    );

    assert.equal(result.slugsToAdd.length, 0);
    assert.deepStrictEqual(result.matchedAgents, ['simple-agent']);
    assert.equal(result.warnings.length, 0);
    assert.ok(result.diagnostics.some(d => d.detail.includes('no source bindings')));
  });

  // -----------------------------------------------------------------------
  // 8. Mix of required/optional -> only required returned
  // -----------------------------------------------------------------------
  it('only adds required sources, skips optional ones', () => {
    const agents = [
      makeAgent('mixed', [
        { slug: 'required-src', required: true },
        { slug: 'optional-src', required: false },
      ]),
    ];
    const sources = [
      makeSource('required-src'),
      makeSource('optional-src'),
    ];

    const result = resolveAgentEnvironment(
      '[agent:mixed]',
      agents,
      sources,
      [],
    );

    assert.deepStrictEqual(result.slugsToAdd, ['required-src']);
  });

  // -----------------------------------------------------------------------
  // 9. All required already enabled -> empty slugsToAdd
  // -----------------------------------------------------------------------
  it('returns empty slugsToAdd when all required sources are already enabled', () => {
    const agents = [makeAgent('research', [{ slug: 'brave', required: true }])];
    const sources = [makeSource('brave')];

    const result = resolveAgentEnvironment(
      '[agent:research]',
      agents,
      sources,
      ['brave'], // already enabled
    );

    assert.equal(result.slugsToAdd.length, 0);
    assert.deepStrictEqual(result.matchedAgents, ['research']);
    assert.equal(result.warnings.length, 0);
    assert.ok(result.diagnostics.some(d => d.detail.includes('already enabled')));
  });

  // -----------------------------------------------------------------------
  // 10. Windows path workspace ID -> [agent:C:\path:slug] handled correctly
  // -----------------------------------------------------------------------
  it('handles Windows path workspace ID in agent mention', () => {
    const agents = [makeAgent('deep-research', [{ slug: 'brave', required: true }])];
    const sources = [makeSource('brave')];

    // parseMentions uses /\[agent:(?:[^\]]*:)?([\w-]+)\]/ which captures last slug segment
    const result = resolveAgentEnvironment(
      '[agent:C:\\Users\\test\\workspace:deep-research]',
      agents,
      sources,
      [],
    );

    assert.deepStrictEqual(result.matchedAgents, ['deep-research']);
    assert.deepStrictEqual(result.slugsToAdd, ['brave']);
  });

  // -----------------------------------------------------------------------
  // 11. Guard passes but 0 agents match -> diagnostic about invalid mention
  // -----------------------------------------------------------------------
  it('produces diagnostic when guard passes but no agents match', () => {
    const agents = [makeAgent('research', [{ slug: 'brave', required: true }])];
    const sources = [makeSource('brave')];

    // Message contains [agent: but not a valid slug
    const result = resolveAgentEnvironment(
      'Check [agent:nonexistent] please',
      agents,
      sources,
      [],
    );

    assert.equal(result.matchedAgents.length, 0);
    assert.equal(result.slugsToAdd.length, 0);
    assert.ok(result.diagnostics.some(d =>
      d.step === 'parseMentions' && d.detail.includes('Guard passed but 0 agents matched'),
    ));
  });

  // -----------------------------------------------------------------------
  // 12. Zero available agents -> returns empty
  // -----------------------------------------------------------------------
  it('returns empty result when no agents are available', () => {
    const agents: LoadedAgent[] = [];
    const sources = [makeSource('brave')];

    const result = resolveAgentEnvironment(
      '[agent:research]',
      agents,
      sources,
      [],
    );

    assert.equal(result.matchedAgents.length, 0);
    assert.equal(result.slugsToAdd.length, 0);
  });

  // -----------------------------------------------------------------------
  // 13. Multiple agents, each with different required sources -> all added
  // -----------------------------------------------------------------------
  it('adds all required sources from multiple different agents', () => {
    const agents = [
      makeAgent('agent-a', [{ slug: 'source-a', required: true }]),
      makeAgent('agent-b', [{ slug: 'source-b', required: true }]),
    ];
    const sources = [
      makeSource('source-a'),
      makeSource('source-b'),
    ];

    const result = resolveAgentEnvironment(
      '[agent:agent-a] [agent:agent-b]',
      agents,
      sources,
      [],
    );

    assert.deepStrictEqual(result.slugsToAdd, ['source-a', 'source-b']);
    assert.deepStrictEqual(result.matchedAgents, ['agent-a', 'agent-b']);
    assert.equal(result.warnings.length, 0);
  });

  // -----------------------------------------------------------------------
  // 14. Authenticated OAuth source is usable
  // -----------------------------------------------------------------------
  it('enables authenticated OAuth source successfully', () => {
    const agents = [makeAgent('research', [{ slug: 'google', required: true }])];
    const sources = [
      makeSource('google', {
        enabled: true,
        authType: 'oauth',
        isAuthenticated: true,
      }),
    ];

    const result = resolveAgentEnvironment(
      '[agent:research]',
      agents,
      sources,
      [],
    );

    assert.deepStrictEqual(result.slugsToAdd, ['google']);
    assert.equal(result.warnings.length, 0);
  });

  // -----------------------------------------------------------------------
  // 15. Agent with multiple required sources, one missing and one usable
  // -----------------------------------------------------------------------
  it('handles partial source availability (one found, one missing)', () => {
    const agents = [
      makeAgent('research', [
        { slug: 'found-src', required: true },
        { slug: 'missing-src', required: true },
      ]),
    ];
    const sources = [makeSource('found-src')];

    const result = resolveAgentEnvironment(
      '[agent:research]',
      agents,
      sources,
      [],
    );

    assert.deepStrictEqual(result.slugsToAdd, ['found-src']);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0]!.reason, 'not_found');
    assert.equal(result.warnings[0]!.sourceSlug, 'missing-src');
  });

  // -----------------------------------------------------------------------
  // 16. No-auth source (authType undefined) is usable when enabled
  // -----------------------------------------------------------------------
  it('treats source with no auth requirement as usable when enabled', () => {
    const agents = [makeAgent('research', [{ slug: 'local-src', required: true }])];
    // No authType set at all -> isSourceUsable returns true when enabled
    const sources = [makeSource('local-src', { enabled: true, type: 'local' })];

    const result = resolveAgentEnvironment(
      '[agent:research]',
      agents,
      sources,
      [],
    );

    assert.deepStrictEqual(result.slugsToAdd, ['local-src']);
    assert.equal(result.warnings.length, 0);
  });

  // -----------------------------------------------------------------------
  // 17. Result diagnostic includes final summary
  // -----------------------------------------------------------------------
  it('includes result summary diagnostic with slugsToAdd and warnings count', () => {
    const agents = [makeAgent('research', [{ slug: 'brave', required: true }])];
    const sources = [makeSource('brave')];

    const result = resolveAgentEnvironment(
      '[agent:research]',
      agents,
      sources,
      [],
    );

    const resultDiag = result.diagnostics.find(d => d.step === 'result');
    assert.ok(resultDiag, 'should have a result diagnostic');
    assert.ok(resultDiag.detail.includes('brave'));
    assert.ok(resultDiag.detail.includes('warnings=0'));
  });
});
