/**
 * MCP Bridge — Programmatic Tool Calls
 *
 * Wraps `CraftMcpClient.callTool()` for orchestrator-driven MCP tool calls.
 * Implements the McpBridge port interface from types.ts.
 *
 * The orchestrator calls MCP tools directly via this bridge, NOT via LLM tool_use.
 * This mirrors gamma's approach where Python calls KB tools programmatically.
 *
 * Key design decisions:
 * - parseMcpResult() unwraps CallToolResult → JSON.parse() → Zod validation (G16)
 * - Separate from SDK-managed connections — Safe Mode doesn't apply (G23)
 * - Each method maps to a specific MCP tool name on the ISA KB server
 * - Error handling: wraps MCP errors with tool name context
 */

import { z } from 'zod';
import type { CraftMcpClient } from '../../mcp/client.ts';
import type { McpBridge, RetrievalParagraph, WebSearchResult } from './types.ts';

// ============================================================================
// MCP RESULT PARSING (G16)
// ============================================================================

/**
 * MCP CallToolResult shape — raw response from CraftMcpClient.callTool().
 *
 * The MCP protocol returns: `{ content: [{ type: "text", text: "{...json...}" }] }`.
 * This type represents that structure for safe unwrapping.
 */
interface McpCallToolResult {
  content?: Array<{
    type: string;
    text?: string;
    [key: string]: unknown;
  }>;
  isError?: boolean;
  [key: string]: unknown;
}

/**
 * Unwrap raw MCP CallToolResult → extract text → JSON.parse → Zod validate (G16).
 *
 * CraftMcpClient.callTool() returns a raw CallToolResult object.
 * This function handles the full unwrapping chain:
 * 1. Extract the first text content block
 * 2. JSON.parse the text
 * 3. Validate against the provided Zod schema
 *
 * @param raw - Raw return value from CraftMcpClient.callTool()
 * @param schema - Zod schema to validate the parsed JSON against
 * @param toolName - Tool name for error messages
 * @returns Validated and typed result matching the schema
 * @throws Error if result is empty, has no text, or fails validation
 */
export function parseMcpResult<T>(raw: unknown, schema: z.ZodType<T>, toolName: string): T {
  const result = raw as McpCallToolResult;

  // Check for MCP-level errors
  if (result?.isError) {
    const errorText = result.content?.find((c) => c.type === 'text')?.text;
    throw new Error(
      `MCP tool '${toolName}' returned error: ${errorText ?? 'unknown error'}`,
    );
  }

  if (!result?.content?.length) {
    throw new Error(`MCP tool '${toolName}' returned empty result (no content blocks)`);
  }

  const textBlock = result.content.find((c) => c.type === 'text');
  if (!textBlock?.text) {
    throw new Error(
      `MCP tool '${toolName}' returned no text content ` +
      `(content types: ${result.content.map((c) => c.type).join(', ')})`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch (parseError) {
    throw new Error(
      `MCP tool '${toolName}' returned invalid JSON: ` +
      `${parseError instanceof Error ? parseError.message : 'parse error'}. ` +
      `Raw text (first 200 chars): ${textBlock.text.slice(0, 200)}`,
    );
  }

  try {
    return schema.parse(parsed);
  } catch (zodError) {
    throw new Error(
      `MCP tool '${toolName}' returned data that doesn't match schema: ` +
      `${zodError instanceof Error ? zodError.message : 'validation error'}`,
    );
  }
}

/**
 * Extract raw text from an MCP CallToolResult without JSON parsing.
 *
 * Used for tools that return plain text (e.g., isa_format_context).
 *
 * @param raw - Raw return value from CraftMcpClient.callTool()
 * @param toolName - Tool name for error messages
 * @returns Raw text content from the first text block
 */
export function extractMcpText(raw: unknown, toolName: string): string {
  const result = raw as McpCallToolResult;

  if (result?.isError) {
    const errorText = result.content?.find((c) => c.type === 'text')?.text;
    throw new Error(
      `MCP tool '${toolName}' returned error: ${errorText ?? 'unknown error'}`,
    );
  }

  if (!result?.content?.length) {
    throw new Error(`MCP tool '${toolName}' returned empty result`);
  }

  const textBlock = result.content.find((c) => c.type === 'text');
  return textBlock?.text ?? '';
}

// ============================================================================
// ZOD SCHEMAS — Validation for MCP tool responses
// ============================================================================

/**
 * Schema for a single KB search result item from the Python MCP server.
 *
 * Server returns: { id, content, confidence, isa_number, paragraph_ref,
 *   sub_paragraph, application_ref, page_number, source_doc?, retrieval_path }
 *
 * We validate required fields and use .passthrough() to preserve extras.
 * Field mapping to RetrievalParagraph (id, text, score, source) happens
 * in the bridge methods below.
 */
const KbSearchItemSchema = z.object({
  id: z.string(),
  content: z.string(),
  confidence: z.number(),
  isa_number: z.string(),
  paragraph_ref: z.string().optional(),
  source_doc: z.string().optional(),
}).passthrough();

/** Schema for KB search results — server returns { results: [...] }. */
const KbSearchResultSchema = z.object({
  results: z.array(KbSearchItemSchema),
  total_results: z.number().optional(),
  search_type_used: z.string().optional(),
  warnings: z.array(z.string()).optional(),
}).or(z.array(KbSearchItemSchema));

/**
 * Schema for hop_retrieve results — server returns
 * { seed_id, connected: [...], total_found, max_hops_used }.
 *
 * Connected items have hop_score (not confidence) and hop_depth.
 */
const HopRetrieveItemSchema = z.object({
  id: z.string(),
  content: z.string(),
  isa_number: z.string(),
  hop_score: z.number(),
  hop_depth: z.number(),
  paragraph_ref: z.string().optional(),
  source_doc: z.string().optional(),
}).passthrough();

const HopRetrieveResultSchema = z.object({
  seed_id: z.string(),
  connected: z.array(HopRetrieveItemSchema),
  total_found: z.number(),
  max_hops_used: z.number(),
}).passthrough();

/** Schema for web search results. */
const WebSearchResultSchema = z.object({
  query: z.string().optional(),
  results: z.array(z.object({
    title: z.string(),
    url: z.string(),
    snippet: z.string(),
  })),
  warnings: z.array(z.string()).optional(),
  queries_executed: z.number().optional(),
  analysis_hints: z.array(z.string()).optional(),
}).or(z.array(z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
})));

/** Schema for citation verification results. */
const VerificationResultSchema = z.object({
  verified: z.boolean().optional(),
  results: z.array(z.object({
    verified: z.boolean(),
    citation: z.record(z.string(), z.unknown()).optional(),
    reason: z.string().optional(),
  })).optional(),
}).passthrough();

// ============================================================================
// MCP TOOL NAMES — ISA KB MCP Server tools
// ============================================================================

/** Tool names on the ISA KB MCP server. */
const ISA_TOOLS = {
  hybridSearch: 'isa_hybrid_search',
  hopRetrieve: 'isa_hop_retrieve',
  formatContext: 'isa_format_context',
  citationVerify: 'isa_citation_verify',
  entityVerify: 'isa_entity_verify',
  webSearch: 'isa_web_search',
} as const;

// ============================================================================
// MCP BRIDGE IMPLEMENTATION
// ============================================================================

/**
 * Concrete McpBridge implementation wrapping CraftMcpClient.
 *
 * Implements the McpBridge port interface from types.ts.
 * Each method maps to a specific MCP tool on the ISA KB server.
 *
 * Usage:
 * ```typescript
 * const client = new CraftMcpClient({ transport: 'stdio', ... });
 * await client.connect();
 * const bridge = new OrchestratorMcpBridge(client);
 * const results = await bridge.kbSearch('ISA 315 risk assessment');
 * ```
 */
export class OrchestratorMcpBridge implements McpBridge {
  constructor(private readonly mcpClient: CraftMcpClient) {}

  /**
   * Run a web search query via the ISA web search MCP tool.
   *
   * @param query - Search query text
   * @returns Web search results with titles, URLs, and snippets
   */
  async webSearch(query: string): Promise<WebSearchResult> {
    const raw = await this.mcpClient.callTool(ISA_TOOLS.webSearch, { queries: [query] });
    const parsed = parseMcpResult(raw, WebSearchResultSchema, ISA_TOOLS.webSearch);

    // Normalize: schema accepts both wrapped and unwrapped array forms
    if (Array.isArray(parsed)) {
      return { query, results: parsed };
    }
    return {
      query: parsed.query ?? query,
      results: parsed.results,
      warnings: parsed.warnings,
      queriesExecuted: parsed.queries_executed,
    };
  }

  /**
   * Search the knowledge base via the ISA hybrid search MCP tool.
   * Combines vector search + keyword search for best recall.
   *
   * @param query - Search query text
   * @param options - Optional search parameters
   * @returns Array of retrieval paragraphs sorted by relevance
   */
  async kbSearch(
    query: string,
    options?: { maxResults?: number },
  ): Promise<RetrievalParagraph[]> {
    const args: Record<string, unknown> = { query };
    if (options?.maxResults != null) {
      args['max_results'] = options.maxResults;
    }

    const raw = await this.mcpClient.callTool(ISA_TOOLS.hybridSearch, args);
    const parsed = parseMcpResult(raw, KbSearchResultSchema, ISA_TOOLS.hybridSearch);

    // Normalize: schema accepts both { results: [...] } and bare [...]
    const items = Array.isArray(parsed) ? parsed : parsed.results;

    // Map server field names → RetrievalParagraph interface
    return items.map((item) => ({
      id: item.id,
      text: item.content,
      score: item.confidence,
      source: item.isa_number ? `ISA ${item.isa_number}` : (item.source_doc ?? 'unknown'),
    }));
  }

  /**
   * Verify citations against source material via the ISA KB MCP tool.
   *
   * @param params - Citation verification parameters
   * @returns Verification results with per-citation pass/fail
   */
  async citationVerify(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const raw = await this.mcpClient.callTool(ISA_TOOLS.citationVerify, params);
    const parsed = parseMcpResult(raw, VerificationResultSchema, ISA_TOOLS.citationVerify);
    return parsed as Record<string, unknown>;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ADDITIONAL MCP TOOLS — Used by specific stages
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Graph-hop retrieval — follow references from a paragraph.
   * Used to expand context around highly relevant paragraphs.
   *
   * @param paragraphId - Source paragraph ID to hop from
   * @param depth - Number of hops to follow (1 = direct references only)
   * @returns Related paragraphs discovered via graph traversal
   */
  async hopRetrieve(paragraphId: string, depth: number): Promise<RetrievalParagraph[]> {
    const raw = await this.mcpClient.callTool(ISA_TOOLS.hopRetrieve, {
      paragraph_id: paragraphId,
      depth,
    });
    const parsed = parseMcpResult(raw, HopRetrieveResultSchema, ISA_TOOLS.hopRetrieve);

    // Map server field names → RetrievalParagraph interface
    return parsed.connected.map((item) => ({
      id: item.id,
      text: item.content,
      score: item.hop_score,
      source: item.isa_number ? `ISA ${item.isa_number}` : (item.source_doc ?? 'unknown'),
    }));
  }

  /**
   * Format context from paragraph IDs — returns pre-formatted text.
   * Used when the orchestrator needs formatted source text for output.
   *
   * @param paragraphIds - Array of paragraph IDs to format
   * @returns Formatted context text
   */
  async formatContext(paragraphIds: string[]): Promise<string> {
    const raw = await this.mcpClient.callTool(ISA_TOOLS.formatContext, {
      paragraph_ids: paragraphIds,
    });
    return extractMcpText(raw, ISA_TOOLS.formatContext);
  }

  /**
   * Verify entities mentioned in the synthesis against the KB.
   *
   * @param params - Entity verification parameters
   * @returns Verification results
   */
  async entityVerify(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const raw = await this.mcpClient.callTool(ISA_TOOLS.entityVerify, params);
    const parsed = parseMcpResult(raw, VerificationResultSchema, ISA_TOOLS.entityVerify);
    return parsed as Record<string, unknown>;
  }
}
