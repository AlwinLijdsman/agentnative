import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StageRunner } from '../stage-runner.ts';
import { PipelineState } from '../pipeline-state.ts';
import type { AgentConfig, StageConfig, TokenUsage, WebSearchResult } from '../types.ts';

const stageConfig: StageConfig = { id: 1, name: 'websearch_calibration' };

const baseAgentConfig: AgentConfig = {
  slug: 'isa-deep-research',
  name: 'ISA Deep Research',
  controlFlow: {
    stages: [
      { id: 0, name: 'analyze_query' },
      { id: 1, name: 'websearch_calibration' },
    ],
  },
  output: {},
};

function makeStateWithStage0(data: Record<string, unknown>): PipelineState {
  return PipelineState
    .create('test-session', 'isa-deep-research')
    .setStageOutput(0, {
      text: 'stage0',
      summary: 'ok',
      usage: { inputTokens: 0, outputTokens: 0 },
      data,
    });
}

function mockLlm(usage: TokenUsage = { inputTokens: 10, outputTokens: 10 }) {
  return {
    call: async () => ({
      text: JSON.stringify({
        websearch_calibration: {
          skipped: false,
          web_research_context: 'calibrated',
          intent_changes: {
            sub_queries_added: [],
            sub_queries_modified: [],
            sub_queries_demoted: [],
          },
        },
        queries: [],
      }),
      usage,
      stopReason: 'end_turn',
      model: 'test-model',
      redactedThinkingBlocks: 0,
    }),
  };
}

describe('Stage 1 web search telemetry', () => {
  it('uses authority_sources.search_queries with highest precedence', async () => {
    const calledQueries: string[] = [];
    const mcpBridge = {
      webSearch: async (query: string): Promise<WebSearchResult> => {
        calledQueries.push(query);
        return {
          query,
          results: [{ title: 'A', url: 'https://a', snippet: 's' }],
          queriesExecuted: 1,
        };
      },
      kbSearch: async () => [],
      citationVerify: async () => ({}),
    };

    const stage0Data = {
      query_plan: {
        authority_sources: {
          search_queries: ['authority 1', 'authority 2'],
        },
        sub_queries: [{ query: 'sub query' }],
      },
      queries: [{ text: 'normalized query' }],
    };

    const runner = new StageRunner(mockLlm() as never, mcpBridge, 'session-path');
    const result = await runner.runStage(
      stageConfig,
      makeStateWithStage0(stage0Data),
      'user message',
      baseAgentConfig,
    );

    assert.deepEqual(calledQueries, ['authority 1', 'authority 2']);
    const telemetry = result.data['webSearchExecution'] as Record<string, unknown>;
    assert.equal(telemetry['querySource'], 'authority_sources');
    assert.equal(telemetry['status'], 'calibrated');
    assert.equal(telemetry['queriesAttempted'], 2);
  });

  it('returns deterministic unavailable status when MCP bridge is missing', async () => {
    const stage0Data = {
      query_plan: {
        sub_queries: [{ query: 'sub query' }],
      },
    };

    const runner = new StageRunner(mockLlm() as never, null, 'session-path');
    const result = await runner.runStage(
      stageConfig,
      makeStateWithStage0(stage0Data),
      'user message',
      baseAgentConfig,
    );

    assert.equal(result.summary, 'Skipped — no web search results');
    const telemetry = result.data['webSearchExecution'] as Record<string, unknown>;
    assert.equal(telemetry['status'], 'unavailable');
    assert.equal(telemetry['queriesAttempted'], 0);
  });
});
