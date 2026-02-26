import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OrchestratorMcpBridge } from '../mcp-bridge.ts';

describe('OrchestratorMcpBridge.webSearch', () => {
  it('sends queries[] payload and parses canonical response fields', async () => {
    let capturedArgs: Record<string, unknown> | null = null;

    const fakeClient = {
      callTool: async (_name: string, args: Record<string, unknown>) => {
        capturedArgs = args;
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              results: [
                {
                  title: 'IAASB',
                  url: 'https://iaasb.org/x',
                  snippet: 'snippet',
                },
              ],
              warnings: ['BRAVE_API_KEY not configured. Web search is disabled.'],
              queries_executed: 1,
            }),
          }],
        };
      },
    };

    const bridge = new OrchestratorMcpBridge(fakeClient as never);
    const result = await bridge.webSearch('isa 540');

    assert.deepEqual(capturedArgs, { queries: ['isa 540'] });
    assert.equal(result.query, 'isa 540');
    assert.equal(result.results.length, 1);
    assert.equal(result.queriesExecuted, 1);
    assert.deepEqual(result.warnings, ['BRAVE_API_KEY not configured. Web search is disabled.']);
  });

  it('supports legacy bare-array result format', async () => {
    const fakeClient = {
      callTool: async () => ({
        content: [{
          type: 'text',
          text: JSON.stringify([
            { title: 'A', url: 'https://a', snippet: 's' },
          ]),
        }],
      }),
    };

    const bridge = new OrchestratorMcpBridge(fakeClient as never);
    const result = await bridge.webSearch('q');

    assert.equal(result.query, 'q');
    assert.equal(result.results.length, 1);
  });
});
