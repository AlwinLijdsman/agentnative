import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OrchestratorMcpBridge } from '../mcp-bridge.ts';

// ---------------------------------------------------------------------------
// Helpers — fake MCP client that returns canned responses
// ---------------------------------------------------------------------------

function fakeClient(response: unknown) {
  return {
    callTool: async (_name: string, _args: Record<string, unknown>) => ({
      content: [{ type: 'text', text: JSON.stringify(response) }],
    }),
  };
}

function fakeClientCapture(response: unknown) {
  let capturedName = '';
  let capturedArgs: Record<string, unknown> = {};
  const client = {
    callTool: async (name: string, args: Record<string, unknown>) => {
      capturedName = name;
      capturedArgs = args;
      return {
        content: [{ type: 'text', text: JSON.stringify(response) }],
      };
    },
    get name() { return capturedName; },
    get args() { return capturedArgs; },
  };
  return client;
}

// ---------------------------------------------------------------------------
// kbSearch
// ---------------------------------------------------------------------------

describe('OrchestratorMcpBridge.kbSearch', () => {
  it('parses actual Python MCP server response and maps fields correctly', async () => {
    const serverResponse = {
      results: [
        {
          id: 'ip_abc123',
          paragraph_ref: '540.12',
          content: 'The auditor shall evaluate the reasonableness of estimates.',
          isa_number: '540',
          sub_paragraph: '',
          application_ref: '',
          page_number: 42,
          source_doc: 'ISA_540_Auditing_Estimates.pdf',
          confidence: 0.8721,
          retrieval_path: 'hybrid',
        },
        {
          id: 'ip_def456',
          paragraph_ref: '315.11',
          content: 'Understanding the entity and its environment.',
          isa_number: '315',
          sub_paragraph: 'a',
          application_ref: 'A2',
          page_number: 18,
          source_doc: 'ISA_315_Identifying_Risks.pdf',
          confidence: 0.6543,
          retrieval_path: 'keyword',
        },
      ],
      total_results: 2,
      search_type_used: 'hybrid',
      warnings: [],
    };

    const bridge = new OrchestratorMcpBridge(fakeClient(serverResponse) as never);
    const paragraphs = await bridge.kbSearch('auditing estimates');

    assert.equal(paragraphs.length, 2);

    // First result — field mapping: content→text, confidence→score, isa_number→source
    assert.equal(paragraphs[0]!.id, 'ip_abc123');
    assert.equal(paragraphs[0]!.text, 'The auditor shall evaluate the reasonableness of estimates.');
    assert.equal(paragraphs[0]!.score, 0.8721);
    assert.equal(paragraphs[0]!.source, 'ISA 540');

    // Second result
    assert.equal(paragraphs[1]!.id, 'ip_def456');
    assert.equal(paragraphs[1]!.text, 'Understanding the entity and its environment.');
    assert.equal(paragraphs[1]!.score, 0.6543);
    assert.equal(paragraphs[1]!.source, 'ISA 315');
  });

  it('passes query and max_results to MCP tool', async () => {
    const client = fakeClientCapture({
      results: [],
      total_results: 0,
      search_type_used: 'hybrid',
      warnings: [],
    });

    const bridge = new OrchestratorMcpBridge(client as never);
    await bridge.kbSearch('risk assessment', { maxResults: 10 });

    assert.equal(client.name, 'isa_hybrid_search');
    assert.deepEqual(client.args, { query: 'risk assessment', max_results: 10 });
  });

  it('returns empty array for zero results', async () => {
    const serverResponse = {
      results: [],
      total_results: 0,
      search_type_used: 'hybrid',
      warnings: [],
    };

    const bridge = new OrchestratorMcpBridge(fakeClient(serverResponse) as never);
    const paragraphs = await bridge.kbSearch('nonsense query');

    assert.equal(paragraphs.length, 0);
  });

  it('supports bare-array fallback format', async () => {
    // The schema also accepts a plain array of items (legacy/fallback)
    const serverResponse = [
      {
        id: 'ip_bare1',
        content: 'Bare array paragraph.',
        confidence: 0.5,
        isa_number: '200',
      },
    ];

    const bridge = new OrchestratorMcpBridge(fakeClient(serverResponse) as never);
    const paragraphs = await bridge.kbSearch('bare');

    assert.equal(paragraphs.length, 1);
    assert.equal(paragraphs[0]!.id, 'ip_bare1');
    assert.equal(paragraphs[0]!.text, 'Bare array paragraph.');
    assert.equal(paragraphs[0]!.score, 0.5);
    assert.equal(paragraphs[0]!.source, 'ISA 200');
  });

  it('falls back to source_doc when isa_number is empty', async () => {
    const serverResponse = {
      results: [{
        id: 'ip_nosource',
        content: 'Some text.',
        confidence: 0.3,
        isa_number: '',
        source_doc: 'Custom_Guide.pdf',
      }],
      total_results: 1,
      search_type_used: 'keyword',
      warnings: [],
    };

    const bridge = new OrchestratorMcpBridge(fakeClient(serverResponse) as never);
    const paragraphs = await bridge.kbSearch('custom');

    assert.equal(paragraphs[0]!.source, 'Custom_Guide.pdf');
  });
});

// ---------------------------------------------------------------------------
// hopRetrieve
// ---------------------------------------------------------------------------

describe('OrchestratorMcpBridge.hopRetrieve', () => {
  it('parses hop_retrieve response and maps connected items', async () => {
    const serverResponse = {
      seed_id: 'ip_seed1',
      seed_paragraph: {
        id: 'ip_seed1',
        paragraph_ref: '315.12',
        isa_number: '315',
      },
      connected: [
        {
          id: 'ip_hop1',
          paragraph_ref: '315.13',
          content: 'Connected paragraph via hop.',
          isa_number: '315',
          sub_paragraph: '',
          application_ref: '',
          page_number: 20,
          source_doc: 'ISA_315.pdf',
          hop_score: 0.7,
          hop_depth: 1,
          hop_path: ['ip_seed1'],
          hop_type: 'cross_reference',
        },
        {
          id: 'ip_hop2',
          paragraph_ref: '540.5',
          content: 'Second hop paragraph.',
          isa_number: '540',
          sub_paragraph: 'b',
          application_ref: 'A3',
          page_number: 55,
          source_doc: 'ISA_540.pdf',
          hop_score: 0.49,
          hop_depth: 2,
          hop_path: ['ip_seed1', 'ip_hop1'],
          hop_type: 'citation',
        },
      ],
      total_found: 2,
      max_hops_used: 3,
    };

    const bridge = new OrchestratorMcpBridge(fakeClient(serverResponse) as never);
    const paragraphs = await bridge.hopRetrieve('ip_seed1', 3);

    assert.equal(paragraphs.length, 2);

    // Field mapping: content→text, hop_score→score, isa_number→source
    assert.equal(paragraphs[0]!.id, 'ip_hop1');
    assert.equal(paragraphs[0]!.text, 'Connected paragraph via hop.');
    assert.equal(paragraphs[0]!.score, 0.7);
    assert.equal(paragraphs[0]!.source, 'ISA 315');

    assert.equal(paragraphs[1]!.id, 'ip_hop2');
    assert.equal(paragraphs[1]!.text, 'Second hop paragraph.');
    assert.equal(paragraphs[1]!.score, 0.49);
    assert.equal(paragraphs[1]!.source, 'ISA 540');
  });

  it('returns empty array when no connected paragraphs found', async () => {
    const serverResponse = {
      seed_id: 'ip_orphan',
      connected: [],
      total_found: 0,
      max_hops_used: 3,
    };

    const bridge = new OrchestratorMcpBridge(fakeClient(serverResponse) as never);
    const paragraphs = await bridge.hopRetrieve('ip_orphan', 3);

    assert.equal(paragraphs.length, 0);
  });

  it('passes paragraph_id and depth to MCP tool', async () => {
    const client = fakeClientCapture({
      seed_id: 'ip_x',
      connected: [],
      total_found: 0,
      max_hops_used: 2,
    });

    const bridge = new OrchestratorMcpBridge(client as never);
    await bridge.hopRetrieve('ip_x', 2);

    assert.equal(client.name, 'isa_hop_retrieve');
    assert.deepEqual(client.args, { paragraph_id: 'ip_x', depth: 2 });
  });
});
