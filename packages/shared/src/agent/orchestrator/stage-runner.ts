/**
 * Stage Runner — Per-Stage Execution Dispatch
 *
 * Dispatches stage execution based on stage name. Each stage handler
 * builds focused context, makes 1 LLM call (or MCP tool calls), and
 * returns a typed StageResult.
 *
 * Mirrors gamma's `_run_stage()` — `workflow.py` L974–996.
 *
 * Design principles:
 * - Each handler builds its own context from PipelineState
 * - 1 LLM call per handler maximum (some stages are MCP-only)
 * - McpBridge dependency injected — null until Phase 4
 * - Per-stage prompts loaded from agent directory (Phase 7)
 * - Output stage uses deterministic renderer from session-tools-core (Phase 8)
 */

import type { OrchestratorLlmClient } from './llm-client.ts';
import type { PipelineState } from './pipeline-state.ts';
import type {
  AgentConfig,
  FollowUpContext,
  McpBridge,
  OnProgressCallback,
  OrchestratorConfig,
  RetrievalParagraph,
  StageConfig,
  StageResult,
  StreamEvent,
  SubstepEvent,
  WebSearchExecutionTelemetry,
  WebSearchResult,
} from './types.ts';
import { ZERO_USAGE } from './types.ts';
import { buildStageContext, wrapXml } from './context-builder.ts';
import { extractRawJson } from './json-extractor.ts';
import { buildPriorContextHint } from './follow-up-context.ts';

// BAML adapter — feature-flagged, uses dynamic imports (Phase 10)
import { callBamlStage0, callBamlStage1, callBamlStage3 } from './baml-adapter.ts';

// Renderer imports for deterministic output stage (Phase 8)
import { renderDocument } from '@craft-agent/agent-pipeline-core/renderer';
import type { FinalAnswer, RenderConfig, Citation, VerificationScores, SubQuery, WebReference } from '@craft-agent/agent-pipeline-core/renderer-types';
import { mergeRenderConfig, extractOutputConfig } from '@craft-agent/agent-pipeline-core/renderer-config';
import { createSourceLinker } from '@craft-agent/agent-pipeline-core/renderer-linker';

// Synthesis post-processor — deterministic label injection safety net (Section 19)
import { postProcessSynthesis } from './synthesis-post-processor.ts';

const MAX_STAGE1_WEB_QUERIES = 5;

// ============================================================================
// STAGE RUNNER
// ============================================================================

export class StageRunner {
  private toolUseCounter = 0;
  private _onProgress?: OnProgressCallback;

  constructor(
    private readonly llmClient: OrchestratorLlmClient,
    private readonly mcpBridge: McpBridge | null,
    private readonly sessionPath: string,
    private readonly onStreamEvent?: (event: StreamEvent) => void,
    private readonly getAuthToken?: () => Promise<string>,
  ) {}

  /**
   * Set the progress callback. Called by the orchestrator before each pipeline run
   * so substep events can be queued and yielded via the OrchestratorEvent generator.
   */
  setOnProgress(callback: OnProgressCallback | undefined): void {
    this._onProgress = callback;
  }

  /** Emit a substep progress event (null-safe). */
  private emitProgress(event: SubstepEvent): void {
    this._onProgress?.(event);
  }

  /** Generate a synthetic tool use ID with orch- prefix to avoid SDK collisions. */
  private generateToolUseId(prefix: string): string {
    return `orch-${prefix}-${++this.toolUseCounter}`;
  }

  /**
   * Dispatch stage execution based on stage name.
   *
   * Mirrors gamma's `_run_stage()` — determines which handler to call
   * based on the stage configuration from config.json.
   *
   * @param stage - Stage configuration (id + name)
   * @param state - Current pipeline state (read previous stage outputs)
   * @param userMessage - Original user query
   * @param agentConfig - Agent configuration
   * @returns Stage result with text, summary, usage, and structured data
   */
  async runStage(
    stage: StageConfig,
    state: PipelineState,
    userMessage: string,
    agentConfig: AgentConfig,
    followUpContext?: FollowUpContext | null,
  ): Promise<StageResult> {
    switch (stage.name) {
      case 'analyze_query':
        return this.runAnalyzeQuery(stage, state, userMessage, agentConfig, followUpContext);
      case 'websearch_calibration':
        return this.runWebsearchCalibration(stage, state, agentConfig);
      case 'retrieve':
        return this.runRetrieve(stage, state, agentConfig, followUpContext);
      case 'synthesize':
        return this.runSynthesize(stage, state, agentConfig, followUpContext);
      case 'verify':
        return this.runVerify(stage, state, agentConfig);
      case 'output':
        return this.runOutput(stage, state, agentConfig, followUpContext);
      default:
        throw new Error(
          `Unknown stage handler: '${stage.name}' (stage ${stage.id}). ` +
          `Known handlers: analyze_query, websearch_calibration, retrieve, synthesize, verify, output`,
        );
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STAGE HANDLERS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Stage: analyze_query
   *
   * Decomposes the user's question into structured search queries.
   * 1 LLM call — the first in the pipeline.
   *
   * Output data: { queries: Array<{ text, intent, priority }>, analysisNotes }
   */
  private async runAnalyzeQuery(
    stage: StageConfig,
    _state: PipelineState,
    userMessage: string,
    agentConfig: AgentConfig,
    followUpContext?: FollowUpContext | null,
  ): Promise<StageResult> {
    const orchestratorConfig = agentConfig.orchestrator;
    const useBAML = orchestratorConfig?.useBAML === true;

    // ── BAML path (Phase 10) ──────────────────────────────────────────────
    if (useBAML && this.getAuthToken) {
      try {
        const authToken = await this.getAuthToken();
        const bamlResult = await callBamlStage0(userMessage, authToken);
        if (bamlResult) {
          return {
            text: JSON.stringify(bamlResult, null, 2),
            summary: `Query plan: ${bamlResult.sub_queries.length} sub-queries (BAML)`,
            usage: ZERO_USAGE, // BAML doesn't expose usage yet
            data: {
              queries: bamlResult.sub_queries.map(sq => ({
                text: sq.text,
                intent: sq.intent,
                priority: 1,
              })),
              query_plan: bamlResult,
            },
          };
        }
        // bamlResult null → BAML client not available, fall through to Zod
      } catch (bamlError) {
        if (orchestratorConfig?.bamlFallbackToZod) {
          console.warn('[orchestrator] Stage 0 BAML failed, falling back to Zod:', bamlError);
        } else {
          throw bamlError;
        }
      }
    }

    // ── Zod fallback path (or primary when useBAML=false) ─────────────────
    const desiredTokens = this.getDesiredTokens(stage.id, orchestratorConfig, 16_000);

    const systemPrompt = getStageSystemPrompt(
      stage.id, stage.name, agentConfig, buildAnalyzeQueryPromptFallback,
    );

    // Enhance user message with prior context hint for follow-up awareness (Section 18, F11)
    let enhancedMessage = userMessage;
    if (followUpContext) {
      const hint = buildPriorContextHint(followUpContext);
      enhancedMessage += '\n\n' + wrapXml('PRIOR_RESEARCH_CONTEXT',
        'The user is asking a follow-up question. Use this context to avoid ' +
        'repeating previously explored topics and focus on new or deeper aspects:\n\n' +
        hint,
      );
    }

    const llmToolId = this.generateToolUseId('llm-analyze');
    this.emitProgress({ type: 'llm_start', stageId: stage.id, stageName: 'analyze_query', toolUseId: llmToolId });

    const result = await this.llmClient.call({
      systemPrompt,
      userMessage: enhancedMessage,
      desiredMaxTokens: desiredTokens,
      effort: this.getStageEffort(orchestratorConfig),
      onStreamEvent: this.onStreamEvent,
    });

    this.emitProgress({ type: 'llm_complete', text: result.text.slice(0, 200), toolUseId: llmToolId, isIntermediate: true });

    // Parse structured output — extract JSON from LLM text
    const parsed = extractRawJson(result.text);
    const data = (parsed != null && typeof parsed === 'object')
      ? parsed as Record<string, unknown>
      : { rawText: result.text };

    // ── Normalize: ensure top-level 'queries' key exists ──────────────
    // The LLM returns { query_plan: { sub_queries: [...] } } but downstream
    // stages (1, 2) expect data['queries']. The BAML path already normalizes
    // this; the Zod path must do the same.
    if (!Array.isArray(data['queries'])) {
      const plan = data['query_plan'] as Record<string, unknown> | undefined;
      const subQueries = plan?.['sub_queries'] ?? data['sub_queries'];
      if (Array.isArray(subQueries)) {
        data['queries'] = (subQueries as Array<Record<string, unknown>>).map(sq => ({
          text: (sq['query'] ?? sq['text'] ?? '') as string,
          intent: (sq['intent'] ?? sq['role'] ?? '') as string,
          priority: (sq['priority'] ?? 1) as number,
        }));
      }
    }

    const queryCount = Array.isArray(data['queries']) ? (data['queries'] as unknown[]).length : 0;

    // Diagnostic: detect overlap between new sub-queries and prior sub-queries (Section 21, F4)
    if (followUpContext?.priorSubQueries?.length && Array.isArray(data['queries'])) {
      const priorTexts = new Set(followUpContext.priorSubQueries.map(sq => sq.text.toLowerCase().trim()));
      const newQueries = data['queries'] as Array<Record<string, unknown>>;
      const overlapping = newQueries.filter(sq => {
        const text = ((sq['text'] ?? sq['query'] ?? '') as string).toLowerCase().trim();
        return priorTexts.has(text);
      });
      if (overlapping.length > 0) {
        console.info(
          `[stage0] Warning: ${overlapping.length}/${newQueries.length} new sub-queries overlap with prior: ` +
          overlapping.map(sq => (sq['text'] ?? sq['query'] ?? '') as string).join('; '),
        );
      }
    }

    return {
      text: result.text,
      summary: `Query analysis: ${queryCount} queries extracted`,
      usage: result.usage,
      data,
    };
  }

  /**
   * Stage: websearch_calibration (G21)
   *
   * Calibrates retrieval queries using web search results.
   * MCP web search + 1 LLM call to refine the query plan.
   *
   * Output data: { queries: Array<{ text, refined, webContext }>, calibrationNotes }
   */
  private async runWebsearchCalibration(
    stage: StageConfig,
    state: PipelineState,
    agentConfig: AgentConfig,
  ): Promise<StageResult> {
    // 1. Get query plan from previous stage (stage 0)
    const queryPlanStage = state.getStageOutput(0);
    const selectedQueries = this.selectWebSearchQueries(queryPlanStage?.data);

    const execution: WebSearchExecutionTelemetry = {
      mcpConnected: this.mcpBridge !== null,
      querySource: selectedQueries.source,
      queriesPlanned: selectedQueries.queries.length,
      queriesAttempted: 0,
      queriesSucceeded: 0,
      resultsCount: 0,
      warnings: [],
      status: 'no_results',
    };

    if (selectedQueries.queries.length === 0) {
      execution.status = 'no_results';
      return {
        text: 'No queries to calibrate',
        summary: 'Skipped — no query plan from stage 0',
        usage: ZERO_USAGE,
        data: {
          websearch_calibration: { skipped: true },
          queries: [],
          webResults: [],
          webSearchExecution: execution,
        },
      };
    }

    // 2. Run web searches via McpBridge for each query
    const webResults: WebSearchResult[] = [];
    if (this.mcpBridge) {
      if (!process.env['BRAVE_API_KEY']) {
        execution.warnings.push('BRAVE_API_KEY not configured. Web search results may be empty.');
      }

      for (const query of selectedQueries.queries) {
        execution.queriesAttempted += 1;
        const wsToolId = this.generateToolUseId('websearch');
        this.emitProgress({ type: 'mcp_start', toolName: 'orch_web_search', toolUseId: wsToolId, input: { query } });
        try {
          const searchResult = await this.mcpBridge.webSearch(query);
          execution.queriesSucceeded += 1;
          if (searchResult.warnings?.length) {
            execution.warnings.push(...searchResult.warnings);
          }
          const resultCount = searchResult.results.length;
          execution.resultsCount += resultCount;
          this.emitProgress({ type: 'mcp_result', toolUseId: wsToolId, toolName: 'orch_web_search', result: `${resultCount} results for "${query.slice(0, 80)}"` });
          if (resultCount > 0) {
            webResults.push(searchResult);
          }
        } catch (error) {
          console.warn(
            `[StageRunner] Web search failed for query "${query}":`,
            error instanceof Error ? error.message : error,
          );
          const message = error instanceof Error ? error.message : String(error);
          execution.warnings.push(`Query failed: ${query.slice(0, 80)} (${message})`);
          this.emitProgress({ type: 'mcp_result', toolUseId: wsToolId, toolName: 'orch_web_search', result: message, isError: true });
        }
      }
    } else {
      console.warn('[StageRunner] No McpBridge available — skipping web searches');
      execution.status = 'unavailable';
      execution.warnings.push('MCP bridge unavailable; Stage 1 web search could not run.');
    }

    execution.warnings = [...new Set(execution.warnings)];

    // ── Empty webResults guard (Section 20 — Bug 3, F8) ──────────────────
    // When no web search results exist, short-circuit with a skipped result.
    // This prevents the LLM from fabricating web sources and avoids
    // constructing a fake BAML type (F8).
    if (webResults.length === 0) {
      if (execution.status !== 'unavailable') {
        execution.status = 'no_results';
      }
      console.warn('[StageRunner] Stage 1: no web search results — returning skipped calibration');
      return {
        text: 'Web search calibration skipped — no web results available',
        summary: 'Skipped — no web search results',
        usage: ZERO_USAGE,
        data: {
          websearch_calibration: { skipped: true },
          queries: selectedQueries.queries.map(text => ({ text })),
          webResults: [],
          webSearchExecution: execution,
        },
      };
    }

    execution.status = 'calibrated';

    const orchestratorConfig = agentConfig.orchestrator;
    const useBAML = orchestratorConfig?.useBAML === true;

    // ── BAML path (Phase 10) ──────────────────────────────────────────────
    if (useBAML && this.getAuthToken) {
      try {
        const authToken = await this.getAuthToken();
        const bamlResult = await callBamlStage1(
          JSON.stringify(queryPlanStage?.data ?? {}),
          JSON.stringify(webResults),
          authToken,
        );
        if (bamlResult) {
          return {
            text: JSON.stringify(bamlResult, null, 2),
            summary: `Calibrated ${bamlResult.queries.length} queries with ${execution.resultsCount} web results (BAML)`,
            usage: ZERO_USAGE, // TODO(baml-usage): BAML client doesn't expose token usage — cost tracking is blind to BAML stages
            data: {
              queries: bamlResult.queries.map(q => ({
                text: q.refined_text,
                intent: q.original_text,
                priority: 1,
              })),
              calibration: bamlResult,
              webResults,
              webSearchExecution: execution,
            },
          };
        }
      } catch (bamlError) {
        if (orchestratorConfig?.bamlFallbackToZod) {
          console.warn('[orchestrator] Stage 1 BAML failed, falling back to Zod:', bamlError);
        } else {
          throw bamlError;
        }
      }
    }

    // ── Zod fallback path ─────────────────────────────────────────────────
    // 3. LLM analyzes web results → refines query plan
    const desiredTokens = this.getDesiredTokens(stage.id, orchestratorConfig, 16_000);

    const systemPrompt = getStageSystemPrompt(
      stage.id, stage.name, agentConfig, buildWebsearchCalibrationPromptFallback,
    );
    const userContent = buildStageContext({
      stageName: 'websearch_calibration',
      previousOutputs: { queryPlan: queryPlanStage?.data ?? {} },
      agentConfig,
    });

    // Append web results as additional context
    const webContext = webResults.length > 0
      ? `\n\n<WEB_SEARCH_RESULTS>\n${JSON.stringify(webResults, null, 2)}\n</WEB_SEARCH_RESULTS>`
      : '\n\n<WEB_SEARCH_RESULTS>\nNo web search results were available. Do NOT fabricate or hallucinate web sources. Set skipped: true and web_sources: [].\n</WEB_SEARCH_RESULTS>';

    const calibLlmToolId = this.generateToolUseId('llm-calibrate');
    this.emitProgress({ type: 'llm_start', stageId: stage.id, stageName: 'websearch_calibration', toolUseId: calibLlmToolId });

    const result = await this.llmClient.call({
      systemPrompt,
      userMessage: userContent + webContext,
      desiredMaxTokens: desiredTokens,
      effort: this.getStageEffort(orchestratorConfig),
      onStreamEvent: this.onStreamEvent,
    });

    this.emitProgress({ type: 'llm_complete', text: result.text.slice(0, 200), toolUseId: calibLlmToolId, isIntermediate: true });

    // 4. Parse calibrated query plan
    const parsed = extractRawJson(result.text);
    const data = (parsed != null && typeof parsed === 'object')
      ? parsed as Record<string, unknown>
      : { rawText: result.text, webResults };

    // Deterministic truthfulness guard: runtime telemetry is source of truth.
    const websearchCalibration = data['websearch_calibration'];
    if (websearchCalibration && typeof websearchCalibration === 'object') {
      (websearchCalibration as Record<string, unknown>)['web_queries_executed'] = execution.queriesAttempted;
      (websearchCalibration as Record<string, unknown>)['warnings'] = execution.warnings;
    }

    // Truncation diagnostic (Section 20 — Bug 2, F7)
    // If JSON parsing failed and output tokens are near the limit, the LLM likely truncated output.
    // Diagnostic-only — no repair attempt (F7: repair produces semantically incomplete results).
    if (parsed == null && result.usage.outputTokens >= desiredTokens * 0.95) {
      console.warn(
        `[StageRunner] Stage 1 likely truncated: outputTokens=${result.usage.outputTokens} >= 95% of desiredTokens=${desiredTokens}. ` +
        `JSON extraction failed. Consider increasing perStageDesiredTokens.1 in config.json.`,
      );
    }

    const queryCount = Array.isArray(data['queries']) ? data['queries'].length : 'N/A';

    return {
      text: result.text,
      summary: `Calibrated ${queryCount} queries with ${execution.resultsCount} web results`,
      usage: result.usage,
      data: { ...data, webResults, webSearchExecution: execution },
    };
  }

  private selectWebSearchQueries(
    stage0Data: Record<string, unknown> | undefined,
  ): { source: WebSearchExecutionTelemetry['querySource']; queries: string[] } {
    if (!stage0Data) {
      return { source: 'none', queries: [] };
    }

    const queryPlan = stage0Data['query_plan'] as Record<string, unknown> | undefined;
    const authoritySources = queryPlan?.['authority_sources'] as Record<string, unknown> | undefined;
    const authorityQueries = toStringArray(authoritySources?.['search_queries']);
    if (authorityQueries.length > 0) {
      return { source: 'authority_sources', queries: sanitizeQueries(authorityQueries) };
    }

    const normalizedQueries = toQueryObjects(stage0Data['queries']).map((item) => item.text);
    if (normalizedQueries.length > 0) {
      return { source: 'queries', queries: sanitizeQueries(normalizedQueries) };
    }

    const subQueries = toQueryObjects(queryPlan?.['sub_queries']).map((item) => item.text);
    if (subQueries.length > 0) {
      return { source: 'sub_queries', queries: sanitizeQueries(subQueries) };
    }

    return { source: 'none', queries: [] };
  }

  /**
   * Stage: retrieve
   *
   * Knowledge base retrieval via MCP tools. No LLM call.
   * Queries from the calibrated query plan are sent to the KB MCP server.
   * Deduplicates results by paragraph ID.
   *
   * Output data: { paragraphs: RetrievalParagraph[], totalResults }
   */
  private async runRetrieve(
    stage: StageConfig,
    state: PipelineState,
    agentConfig: AgentConfig,
    followUpContext?: FollowUpContext | null,
  ): Promise<StageResult> {
    if (!this.mcpBridge) {
      return {
        text: 'McpBridge not available — retrieval skipped',
        summary: 'Skipped — no MCP bridge (Phase 4)',
        usage: ZERO_USAGE,
        data: { paragraphs: [] },
      };
    }

    // Read calibrated queries (prefer websearch_calibration, fall back to analyze_query)
    const calibration = state.getStageOutput(stage.id - 1);
    const queryPlan = state.getStageOutput(0);
    // Defense-in-depth: also check query_plan.sub_queries (raw Zod path)
    const querySource = calibration?.data?.['queries']
      ?? queryPlan?.data?.['queries']
      ?? (queryPlan?.data?.['query_plan'] as Record<string, unknown> | undefined)?.['sub_queries'];

    if (!querySource || !Array.isArray(querySource)) {
      return {
        text: 'No queries available for retrieval',
        summary: 'Skipped — no query source',
        usage: ZERO_USAGE,
        data: { paragraphs: [] },
      };
    }

    // Run KB search for each query — deduplicate by paragraph ID
    const allParagraphs: RetrievalParagraph[] = [];
    const seenIds = new Set<string>();

    for (const query of querySource as Array<{ text: string }>) {
      const kbToolId = this.generateToolUseId('kbsearch');
      this.emitProgress({ type: 'mcp_start', toolName: 'orch_kb_search', toolUseId: kbToolId, input: { query: query.text } });
      try {
        const paragraphs = await this.mcpBridge.kbSearch(query.text, { maxResults: 20 });
        for (const p of paragraphs) {
          if (!seenIds.has(p.id)) {
            seenIds.add(p.id);
            allParagraphs.push(p);
          }
        }
        this.emitProgress({ type: 'mcp_result', toolUseId: kbToolId, toolName: 'orch_kb_search', result: `${paragraphs.length} paragraphs for "${query.text.slice(0, 80)}"` });
      } catch (error) {
        console.warn(
          `[StageRunner] KB search failed for query "${query.text}":`,
          error instanceof Error ? error.message : error,
        );
        this.emitProgress({ type: 'mcp_result', toolUseId: kbToolId, toolName: 'orch_kb_search', result: error instanceof Error ? error.message : String(error), isError: true });
      }
    }

    // Delta filtering: remove paragraphs already cited in prior research (Section 18, F10)
    if (followUpContext?.priorParagraphIds?.length && agentConfig.followUp?.deltaRetrieval !== false) {
      const priorSet = new Set(followUpContext.priorParagraphIds);
      const beforeCount = allParagraphs.length;
      const filtered = allParagraphs.filter(p => !priorSet.has(p.id));
      if (filtered.length < beforeCount) {
        console.info(
          `[StageRunner] Delta filtering: removed ${beforeCount - filtered.length} prior paragraphs, ` +
          `${filtered.length} remaining`,
        );
      }
      // Replace in-place (allParagraphs is let-accessible via splice)
      allParagraphs.splice(0, allParagraphs.length, ...filtered);
    }

    // Sort by relevance score (highest first)
    allParagraphs.sort((a, b) => b.score - a.score);

    return {
      text: `Retrieved ${allParagraphs.length} unique paragraphs from ${(querySource as unknown[]).length} queries`,
      summary: `${allParagraphs.length} paragraphs retrieved`,
      usage: ZERO_USAGE,
      data: { paragraphs: allParagraphs, totalResults: allParagraphs.length },
    };
  }

  /**
   * Stage: synthesize
   *
   * Core synthesis — 1 max-power LLM call with full context.
   * Reads query plan + retrieval results, produces the research answer.
   * In repair iterations, includes feedback from failed verification.
   *
   * Output data: parsed synthesis (answer sections, citations, confidence, etc.)
   */
  private async runSynthesize(
    stage: StageConfig,
    state: PipelineState,
    agentConfig: AgentConfig,
    followUpContext?: FollowUpContext | null,
  ): Promise<StageResult> {
    const orchestratorConfig = agentConfig.orchestrator;

    // Build context from all previous stages
    const queryPlan = state.getStageOutput(0)?.data;
    const calibration = state.getStageOutput(1)?.data;
    const retrieval = state.getStageOutput(2)?.data;
    const retrievalParagraphs = (retrieval?.['paragraphs'] ?? []) as RetrievalParagraph[];

    // Check for repair feedback (if this is a repair iteration — G15)
    const repairEvents = state.getEventsForStage(stage.id);
    const lastRepairEvent = [...repairEvents].reverse().find(
      (e) => e.type === 'stage_started' && e.data['repairIteration'] !== undefined,
    );
    const repairFeedback = lastRepairEvent?.data['feedback'] as string | undefined;

    // Extract web references and context from Stage 1 data (Section 17, F1/F2)
    const calibrationRecord = (calibration ?? {}) as Record<string, unknown>;
    const webSources = extractWebReferences(calibrationRecord);
    const webResearchContext = extractWebResearchContext(calibrationRecord);

    const useBAML = orchestratorConfig?.useBAML === true;

    const ctxToolId = this.generateToolUseId('synth-context');
    this.emitProgress({ type: 'mcp_start', toolName: 'orch_synthesis_step', toolUseId: ctxToolId, input: { step: 'context_build', paragraphs: retrievalParagraphs.length } });
    this.emitProgress({ type: 'mcp_result', toolUseId: ctxToolId, toolName: 'orch_synthesis_step', result: `Building synthesis context from ${retrievalParagraphs.length} retrieved paragraphs` });

    // ── BAML path (Phase 10) ──────────────────────────────────────────────
    if (useBAML && this.getAuthToken) {
      const bamlStepId = this.generateToolUseId('synth-baml');
      try {
        this.emitProgress({ type: 'mcp_start', toolName: 'orch_synthesis_step', toolUseId: bamlStepId, input: { step: 'baml_synthesis' } });
        const authToken = await this.getAuthToken();
        const retrievalContextStr = buildStageContext({
          stageName: 'synthesize',
          previousOutputs: {
            queryPlan: queryPlan ?? {},
            calibration: calibration ?? {},
          },
          retrievalContext: retrievalParagraphs,
          agentConfig,
          tokenBudget: 70_000,
          repairFeedback,
          webSources,
          webResearchContext,
          priorAnswerText: followUpContext?.priorAnswerText,
          priorSections: followUpContext?.priorSections?.map(ps => ({
            sectionId: ps.sectionId, heading: ps.heading, excerpt: ps.excerpt,
          })),
          followupNumber: followUpContext?.followupNumber,
        });

        const bamlResult = await callBamlStage3(
          JSON.stringify(queryPlan ?? {}),
          retrievalContextStr,
          authToken,
          repairFeedback,
        );
        if (bamlResult) {
          this.emitProgress({ type: 'mcp_result', toolUseId: bamlStepId, toolName: 'orch_synthesis_step', result: `BAML synthesis complete — ${bamlResult.citations.length} citations` });
          // Run deterministic post-processing to ensure inline labels exist (Section 19)
          const ppToolId = this.generateToolUseId('synth-postprocess');
          this.emitProgress({ type: 'mcp_start', toolName: 'orch_synthesis_step', toolUseId: ppToolId, input: { step: 'post_process', citations: bamlResult.citations.length } });
          const priorInputs = (followUpContext?.priorSections ?? []).map(ps => ({
            sectionId: ps.sectionId, heading: ps.heading, excerpt: ps.excerpt, sectionNum: ps.sectionNum,
          }));
          const ppResult = postProcessSynthesis(bamlResult.synthesis, webSources, priorInputs);
          this.emitProgress({ type: 'mcp_result', toolUseId: ppToolId, toolName: 'orch_synthesis_step', result: `Post-processing complete — ${bamlResult.citations.length} citations verified` });

          return {
            text: ppResult.synthesis,
            summary: `Synthesis complete: ${bamlResult.citations.length} citations (BAML)`,
            usage: ZERO_USAGE, // TODO(baml-usage): BAML client doesn't expose token usage — cost tracking is blind to BAML stages
            data: {
              synthesis: ppResult.synthesis,
              citations: bamlResult.citations,
              confidence: bamlResult.confidence,
              gaps: bamlResult.gaps,
              out_of_scope_notes: bamlResult.out_of_scope_notes,
              needs_repair: bamlResult.needs_repair,
            },
          };
        }
        // bamlResult null → BAML client not available, fall through to Zod
        this.emitProgress({ type: 'mcp_result', toolUseId: bamlStepId, toolName: 'orch_synthesis_step', result: 'BAML not available — falling back to Zod path' });
      } catch (bamlError) {
        if (orchestratorConfig?.bamlFallbackToZod) {
          this.emitProgress({ type: 'mcp_result', toolUseId: bamlStepId, toolName: 'orch_synthesis_step', result: 'BAML failed — falling back to Zod path', isError: true });
          console.warn('[orchestrator] Stage 3 BAML failed, falling back to Zod:', bamlError);
        } else {
          this.emitProgress({ type: 'mcp_result', toolUseId: bamlStepId, toolName: 'orch_synthesis_step', result: 'BAML synthesis failed', isError: true });
          throw bamlError;
        }
      }
    }

    // ── Zod fallback path ─────────────────────────────────────────────────
    const synthStepId = this.generateToolUseId('synth-prepare');
    this.emitProgress({ type: 'mcp_start', toolName: 'orch_synthesis_step', toolUseId: synthStepId, input: { step: 'prepare', paragraphs: retrievalParagraphs.length, hasRepairFeedback: !!repairFeedback } });
    this.emitProgress({ type: 'mcp_result', toolUseId: synthStepId, toolName: 'orch_synthesis_step', result: repairFeedback ? 'Re-synthesizing with verification feedback' : `Synthesizing answer from ${retrievalParagraphs.length} sources` });

    const desiredTokens = this.getDesiredTokens(stage.id, orchestratorConfig, 128_000);

    const systemPrompt = getStageSystemPrompt(
      stage.id, stage.name, agentConfig, buildSynthesisPromptFallback,
    );
    const userContent = buildStageContext({
      stageName: 'synthesize',
      previousOutputs: {
        queryPlan: queryPlan ?? {},
        calibration: calibration ?? {},
      },
      retrievalContext: retrievalParagraphs,
      agentConfig,
      tokenBudget: 70_000,
      repairFeedback,
      webSources,
      webResearchContext,
      priorAnswerText: followUpContext?.priorAnswerText,
      priorSections: followUpContext?.priorSections?.map(ps => ({
        sectionId: ps.sectionId, heading: ps.heading, excerpt: ps.excerpt,
      })),
      followupNumber: followUpContext?.followupNumber,
    });

    const synthLlmToolId = this.generateToolUseId('llm-synthesize');
    this.emitProgress({ type: 'llm_start', stageId: stage.id, stageName: 'synthesize', toolUseId: synthLlmToolId });

    const result = await this.llmClient.call({
      systemPrompt,
      userMessage: userContent,
      desiredMaxTokens: desiredTokens,
      effort: this.getStageEffort(orchestratorConfig),
      onStreamEvent: this.onStreamEvent,
    });

    this.emitProgress({ type: 'llm_complete', text: 'Synthesis complete', toolUseId: synthLlmToolId, isIntermediate: true });

    const extractToolId = this.generateToolUseId('synth-extract');
    this.emitProgress({ type: 'mcp_start', toolName: 'orch_synthesis_step', toolUseId: extractToolId, input: { step: 'extract_json' } });
    const parsed = extractRawJson(result.text);
    const data = (parsed != null && typeof parsed === 'object')
      ? parsed as Record<string, unknown>
      : { rawText: result.text };

    this.emitProgress({ type: 'mcp_result', toolUseId: extractToolId, toolName: 'orch_synthesis_step', result: parsed != null ? 'Structured data extracted successfully' : 'Raw text (no structured JSON found)' });

    // Run deterministic post-processing to ensure inline labels exist (Section 19)
    const ppStepId = this.generateToolUseId('synth-postprocess');
    this.emitProgress({ type: 'mcp_start', toolName: 'orch_synthesis_step', toolUseId: ppStepId, input: { step: 'post_process' } });
    const synthesisText = (typeof data['synthesis'] === 'string')
      ? data['synthesis']
      : result.text;

    const priorInputs = (followUpContext?.priorSections ?? []).map(ps => ({
      sectionId: ps.sectionId, heading: ps.heading, excerpt: ps.excerpt, sectionNum: ps.sectionNum,
    }));
    const ppResult = postProcessSynthesis(synthesisText, webSources, priorInputs);

    // Write back post-processed synthesis
    if (typeof data['synthesis'] === 'string') {
      data['synthesis'] = ppResult.synthesis;
    }

    const citationCount = Array.isArray(data['citations_used']) ? (data['citations_used'] as unknown[]).length : 0;
    this.emitProgress({ type: 'mcp_result', toolUseId: ppStepId, toolName: 'orch_synthesis_step', result: citationCount > 0 ? `Post-processing complete — ${citationCount} citations, source labels injected` : 'Post-processing complete — source labels injected' });

    const summaryMsg = citationCount > 0 ? `Synthesis complete — ${citationCount} citations` : 'Synthesis complete';

    return {
      text: result.text,
      summary: summaryMsg,
      usage: result.usage,
      data,
    };
  }

  /**
   * Stage: verify
   *
   * Verifies synthesis citations against source material via MCP tools.
   * Determines if repair is needed (needsRepair flag for G15 repair loop).
   * No LLM call — pure MCP tool verification.
   *
   * Output data: { needsRepair, feedback?, verificationResults, totalCitations, failedCount }
   */
  private async runVerify(
    stage: StageConfig,
    state: PipelineState,
    _agentConfig: AgentConfig,
  ): Promise<StageResult> {
    if (!this.mcpBridge) {
      return {
        text: 'McpBridge not available — verification skipped',
        summary: 'Skipped — no MCP bridge (Phase 4)',
        usage: ZERO_USAGE,
        data: { needsRepair: false },
      };
    }

    // Read synthesis output (immediately preceding stage)
    const synthesis = state.getStageOutput(stage.id - 1);
    if (!synthesis?.data) {
      return {
        text: 'No synthesis to verify',
        summary: 'Skipped — no synthesis output',
        usage: ZERO_USAGE,
        data: { needsRepair: false },
      };
    }

    // Extract citations from synthesis data
    const citations = (synthesis.data['citations'] ?? []) as Array<Record<string, unknown>>;
    const verificationResults: Array<Record<string, unknown>> = [];
    let failedCount = 0;

    for (const citation of citations) {
      const cvToolId = this.generateToolUseId('citation-verify');
      const citationRef = (citation['paragraph_ref'] ?? citation['sourceRef'] ?? citation['source'] ?? '') as string;
      this.emitProgress({ type: 'mcp_start', toolName: 'orch_citation_verify', toolUseId: cvToolId, input: { citation: citationRef } });
      try {
        const verifyResult = await this.mcpBridge.citationVerify(citation);
        verificationResults.push(verifyResult);
        const verified = verifyResult['verified'] !== false;
        if (!verified) {
          failedCount++;
        }
        this.emitProgress({ type: 'mcp_result', toolUseId: cvToolId, toolName: 'orch_citation_verify', result: verified ? `Verified: ${citationRef}` : `Failed: ${citationRef}`, isError: !verified });
      } catch (error) {
        console.warn(
          `[StageRunner] Citation verification failed:`,
          error instanceof Error ? error.message : error,
        );
        verificationResults.push({
          error: error instanceof Error ? error.message : 'unknown',
          verified: false,
        });
        failedCount++;
        this.emitProgress({ type: 'mcp_result', toolUseId: cvToolId, toolName: 'orch_citation_verify', result: error instanceof Error ? error.message : 'unknown error', isError: true });
      }
    }

    const needsRepair = failedCount > 0;
    const feedback = needsRepair
      ? `${failedCount} of ${citations.length} citations failed verification. ` +
        `Failed citations: ${JSON.stringify(verificationResults.filter((r) => r['verified'] === false))}`
      : undefined;

    return {
      text: `Verified ${citations.length} citations: ${failedCount} failed`,
      summary: needsRepair
        ? `${failedCount} citations failed — repair needed`
        : 'All citations verified',
      usage: ZERO_USAGE,
      data: {
        needsRepair,
        feedback,
        verificationResults,
        totalCitations: citations.length,
        failedCount,
      },
    };
  }

  /**
   * Stage: output
   *
   * Deterministic rendering — NO LLM call.
   * Assembles a FinalAnswer from pipeline state, calls renderDocument()
   * from session-tools-core, and writes the output file to disk.
   *
   * Phase 8: Citations, verification table, source blockquotes, and file
   * output are ALL produced by code — zero LLM bypass surface.
   *
   * Output data: { outputPath, totalCitations, sectionsCount }
   */
  private async runOutput(
    _stage: StageConfig,
    state: PipelineState,
    agentConfig: AgentConfig,
    followUpContext?: FollowUpContext | null,
  ): Promise<StageResult> {
    this.emitProgress({ type: 'status', message: 'Rendering output document...' });

    // 1. Gather data from previous stages
    const queryPlanOutput = state.getStageOutput(0);
    const calibrationOutput = state.getStageOutput(1);
    const synthesisOutput = state.getStageOutput(3);
    const verificationOutput = state.getStageOutput(4);

    if (!synthesisOutput?.data) {
      return {
        text: 'No synthesis output available — cannot render',
        summary: 'Skipped — no synthesis',
        usage: ZERO_USAGE,
        data: { rendered: false },
      };
    }

    // 2. Build FinalAnswer from pipeline state
    const synthesisData = synthesisOutput.data;
    const verificationData = verificationOutput?.data ?? {};
    const queryPlanData = queryPlanOutput?.data ?? {};

    const originalQuery = (queryPlanData['query_plan'] as Record<string, unknown> | undefined)?.['original_query'] as string
      ?? 'Unknown query';

    const depthMode = (queryPlanData['query_plan'] as Record<string, unknown> | undefined)?.['depth_mode'] as string
      ?? 'standard';

    // Build citations array from synthesis data
    const rawCitations = (synthesisData['citations_used'] ?? synthesisData['citations'] ?? []) as Array<Record<string, unknown>>;
    const citations: Citation[] = rawCitations.map(c => ({
      sourceRef: (c['paragraph_ref'] ?? c['sourceRef'] ?? c['source'] ?? '') as string,
      claim: (c['claim'] ?? '') as string,
      verified: (c['verified'] ?? true) as boolean,
      matchLevel: c['matchLevel'] as string | undefined,
    }));

    // Build verification scores (with safe defaults)
    const rawScores = verificationData['verification_scores'] as Record<string, Record<string, unknown>> | undefined;
    const verificationScores: VerificationScores = {
      entity_grounding: {
        score: (rawScores?.['entity_grounding']?.['score'] ?? 0) as number,
        passed: (rawScores?.['entity_grounding']?.['passed'] ?? true) as boolean,
      },
      citation_accuracy: {
        score: (rawScores?.['citation_accuracy']?.['score'] ?? 0) as number,
        passed: (rawScores?.['citation_accuracy']?.['passed'] ?? true) as boolean,
      },
      relation_preservation: {
        score: (rawScores?.['relation_preservation']?.['score'] ?? 0) as number,
        passed: (rawScores?.['relation_preservation']?.['passed'] ?? true) as boolean,
      },
      contradictions: {
        count: (rawScores?.['contradictions']?.['count'] ?? 0) as number,
        passed: (rawScores?.['contradictions']?.['passed'] ?? true) as boolean,
      },
    };

    // Build source texts map
    const sourceTexts = (verificationData['source_texts'] ?? {}) as Record<string, string>;

    // Build sub-queries from query plan
    const rawSubQueries = ((queryPlanData['query_plan'] as Record<string, unknown> | undefined)?.['sub_queries'] ?? []) as Array<Record<string, unknown>>;
    const subQueries: SubQuery[] = rawSubQueries.map(sq => ({
      query: (sq['query'] ?? sq['text'] ?? '') as string,
      role: (sq['role'] ?? 'primary') as string,
      standards: (sq['target_standards'] ?? sq['standards'] ?? []) as string[],
      paragraphsFound: sq['paragraphsFound'] as number | undefined,
    }));

    // Extract web references from Stage 1 calibration data (F3, F6)
    const calibrationData = calibrationOutput?.data ?? {};
    const webReferences = extractWebReferences(calibrationData);

    const finalAnswer: FinalAnswer = {
      originalQuery,
      synthesis: (synthesisData['synthesis'] ?? synthesisOutput.text) as string,
      citations,
      verificationScores,
      sourceTexts,
      subQueries,
      depthMode,
      outOfScopeNotes: synthesisData['out_of_scope_notes'] as string | undefined,
      confidencePerSection: synthesisData['confidence_per_section'] as Record<string, string> | undefined,
      webReferences: webReferences.length > 0 ? webReferences : undefined,
      // Follow-up context wiring (Section 18, F10/F12)
      priorSections: followUpContext?.priorSections?.map(ps => ({
        sectionNum: ps.sectionNum,
        sectionId: ps.sectionId,
        heading: ps.heading,
        excerpt: ps.excerpt,
      })),
      followupNumber: followUpContext?.followupNumber,
    };

    // 3. Load render config from agent's config.json (3-layer merge: defaults <- agent <- runtime)
    let agentOutputConfig: Partial<RenderConfig> | null = null;
    if (agentConfig.promptsDir) {
      const agentDir = dirname(agentConfig.promptsDir);
      const configPath = join(agentDir, 'config.json');
      if (existsSync(configPath)) {
        try {
          const rawConfig = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
          agentOutputConfig = extractOutputConfig(rawConfig);
        } catch {
          // Non-fatal — fall back to defaults
        }
      }
    }
    const renderConfig = mergeRenderConfig(agentOutputConfig);

    // 4. Create source linker (discovers PDF files for ISA references)
    const linker = createSourceLinker(
      renderConfig.sourceDiscovery.linkerType,
      { linkBase: renderConfig.sourceDiscovery.linkBase },
    );

    // 5. Render the document — CODE does this, not LLM
    const document = renderDocument(finalAnswer, renderConfig, linker);

    // 6. Write file — CODE writes it, not LLM
    const outputFileName = renderConfig.files.answerFile;
    const plansDir = join(this.sessionPath, 'plans');
    mkdirSync(plansDir, { recursive: true });
    const outputPath = join(plansDir, outputFileName);
    writeFileSync(outputPath, document, 'utf-8');

    // 6b. Save machine-readable answer.json for follow-up context loading (Section 18, F9)
    const answerJson = {
      version: 1,
      answer: finalAnswer.synthesis,
      original_query: finalAnswer.originalQuery,
      followup_number: finalAnswer.followupNumber ?? 0,
      depth_mode: finalAnswer.depthMode,
      citations: finalAnswer.citations.map(c => ({
        source_ref: c.sourceRef,
        claim: c.claim,
        paragraph_id: c.sourceRef,
      })),
      sub_queries: finalAnswer.subQueries.map(sq => ({
        text: sq.query,
        role: sq.role,
        standards: sq.standards,
      })),
      web_references: (finalAnswer.webReferences ?? []).map(wr => ({
        url: wr.url,
        title: wr.title,
        insight: wr.insight,
        sourceType: wr.sourceType,
      })),
    };
    const dataDir = join(this.sessionPath, 'data');
    mkdirSync(dataDir, { recursive: true });
    const answerJsonPath = join(dataDir, 'answer.json');
    writeFileSync(answerJsonPath, JSON.stringify(answerJson, null, 2), 'utf-8');

    // 7. Count sections for metadata
    const sectionsCount = (document.match(/^## /gm) ?? []).length;

    return {
      text: document,
      summary: `Output rendered: ${citations.length} citations, ${sectionsCount} sections, saved to ${outputFileName}`,
      usage: ZERO_USAGE, // No LLM call in this stage
      data: {
        rendered: true,
        outputPath,
        totalCitations: citations.length,
        sectionsCount,
        sourceTextsUsed: Object.keys(sourceTexts).length,
        // P0 fix: Include file content so sessions.ts auto-inject handler can
        // display the research output in chat (checks event.data.output_file_content)
        output_file_content: document,
        output_file_path: outputPath,
      },
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PER-STAGE CONFIGURATION HELPERS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Get desired output tokens for a stage.
   * Uses per-stage config if available, otherwise falls back to default.
   */
  private getDesiredTokens(
    stageId: number,
    orchestratorConfig: OrchestratorConfig | undefined,
    defaultTokens: number,
  ): number {
    return orchestratorConfig?.perStageDesiredTokens?.[stageId] ?? defaultTokens;
  }

  /**
   * Get effort level for a stage.
   * Uses orchestrator config default effort, or 'max' if not configured.
   */
  private getStageEffort(
    orchestratorConfig: OrchestratorConfig | undefined,
  ): 'max' | 'high' | 'medium' | 'low' {
    return (orchestratorConfig?.effort ?? 'max') as 'max' | 'high' | 'medium' | 'low';
  }
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function toQueryObjects(value: unknown): Array<{ text: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const text = record['text'] ?? record['query'];
      if (typeof text !== 'string') return null;
      return { text };
    })
    .filter((item): item is { text: string } => item != null);
}

function sanitizeQueries(queries: string[]): string[] {
  const normalized = queries
    .map((query) => query.trim())
    .filter((query) => query.length > 0);
  return [...new Set(normalized)].slice(0, MAX_STAGE1_WEB_QUERIES);
}

// ============================================================================
// WEB REFERENCE EXTRACTION — Extract web refs from Stage 1 data (F3, F6)
// ============================================================================

/**
 * Extract web references from Stage 1 (websearch_calibration) data.
 *
 * Handles both data shapes:
 * - Zod path: `stageData.websearch_calibration.web_sources` → array of {url, title, relevance_note, source_type, domain}
 * - BAML path: `stageData.webResults` → array of WebSearchResult ({title, url, snippet})
 *
 * Returns empty array if neither path has data (graceful degradation).
 * Pattern reference: `pause-formatter.ts` `normalizeStage1Data()` handles same branching.
 */
export function extractWebReferences(stageData: Record<string, unknown>): WebReference[] {
  // Zod path: stageData.websearch_calibration.web_sources
  const wsCalibration = stageData['websearch_calibration'] as Record<string, unknown> | undefined;
  if (wsCalibration && Array.isArray(wsCalibration['web_sources'])) {
    const webSources = wsCalibration['web_sources'] as Array<Record<string, unknown>>;
    const refs = webSources.map(s => ({
      url: (s['url'] ?? '') as string,
      title: (s['title'] ?? '') as string,
      insight: (s['relevance_note'] ?? '') as string,
      sourceType: (s['source_type'] ?? 'web') as string,
    }));
    console.info(`[StageRunner] extractWebReferences: found ${refs.length} web refs (path: zod)`);
    return refs;
  }

  // BAML path: stageData.webResults → WebSearchResult[]
  if (Array.isArray(stageData['webResults'])) {
    const webResults = stageData['webResults'] as Array<Record<string, unknown>>;
    const refs: WebReference[] = [];
    for (const wr of webResults) {
      const results = (wr['results'] ?? []) as Array<Record<string, unknown>>;
      for (const r of results) {
        refs.push({
          url: (r['url'] ?? '') as string,
          title: (r['title'] ?? '') as string,
          insight: (r['snippet'] ?? '') as string,
          sourceType: 'web',
        });
      }
    }
    console.info(`[StageRunner] extractWebReferences: found ${refs.length} web refs (path: baml)`);
    return refs;
  }

  console.info('[StageRunner] extractWebReferences: no web references found');
  return [];
}

/**
 * Extract web research context narrative from Stage 1 data.
 *
 * Handles both data shapes:
 * - Zod path: `stageData.websearch_calibration.web_research_context` (string)
 * - BAML path: `stageData.calibration.calibration_summary` (fallback)
 *
 * Returns empty string if missing.
 */
export function extractWebResearchContext(stageData: Record<string, unknown>): string {
  // Zod path
  const wsCalibration = stageData['websearch_calibration'] as Record<string, unknown> | undefined;
  if (wsCalibration && typeof wsCalibration['web_research_context'] === 'string') {
    const ctx = wsCalibration['web_research_context'] as string;
    console.info(`[StageRunner] extractWebResearchContext: ${ctx.length} chars (path: zod)`);
    return ctx;
  }

  // BAML path
  const calibration = stageData['calibration'] as Record<string, unknown> | undefined;
  if (calibration && typeof calibration['calibration_summary'] === 'string') {
    const ctx = calibration['calibration_summary'] as string;
    console.info(`[StageRunner] extractWebResearchContext: ${ctx.length} chars (path: baml)`);
    return ctx;
  }

  console.info('[StageRunner] extractWebResearchContext: no context found');
  return '';
}

// ============================================================================
// PROMPT LOADING — Per-stage prompts from agent directory or fallback
// ============================================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

/**
 * Cache of loaded prompt files to avoid re-reading from disk on every call.
 * Key: absolute file path, Value: prompt content with template variables resolved.
 */
const promptCache = new Map<string, string>();

/**
 * Load a per-stage system prompt for an LLM-calling stage.
 *
 * Resolution order:
 * 1. If `agentConfig.promptsDir` is set and a matching prompt file exists, load it.
 * 2. Otherwise, fall back to a built-in placeholder prompt.
 *
 * Prompt files follow the naming convention:
 *   `{promptsDir}/stage-{id}-{name}.md`
 *
 * Template variables (replaced at load time):
 * - `{{agentName}}` → `agentConfig.name`
 *
 * Results are cached per absolute path to avoid repeated fs reads.
 *
 * @param stageId - Stage number (0-5)
 * @param stageName - Stage name (e.g., 'analyze_query')
 * @param agentConfig - Agent configuration (provides promptsDir and name)
 * @returns System prompt string for the LLM call
 */
function loadStagePrompt(
  stageId: number,
  stageName: string,
  agentConfig: AgentConfig,
): string | null {
  if (!agentConfig.promptsDir) return null;

  const fileName = `stage-${stageId}-${stageName.replace(/_/g, '-')}.md`;
  const filePath = join(agentConfig.promptsDir, fileName);

  // Check cache first
  const cached = promptCache.get(filePath);
  if (cached !== undefined) return cached;

  // Try loading from disk
  if (!existsSync(filePath)) return null;

  try {
    let content = readFileSync(filePath, 'utf-8');

    // Resolve template variables
    content = content.replace(/\{\{agentName\}\}/g, agentConfig.name);

    promptCache.set(filePath, content);
    return content;
  } catch {
    // File read failed — fall back to placeholder
    return null;
  }
}

/**
 * Get the system prompt for an LLM-calling stage.
 * Tries to load from the agent's per-stage prompt file first,
 * falls back to the built-in placeholder if not found.
 */
function getStageSystemPrompt(
  stageId: number,
  stageName: string,
  agentConfig: AgentConfig,
  fallbackBuilder: (config: AgentConfig) => string,
): string {
  const loaded = loadStagePrompt(stageId, stageName, agentConfig);
  if (loaded !== null) return loaded;
  return fallbackBuilder(agentConfig);
}

// ============================================================================
// FALLBACK PROMPT BUILDERS — Used when per-stage prompt files are not found
// ============================================================================

/**
 * Fallback system prompt for the analyze_query stage.
 * Used when agents/{slug}/prompts/stage-0-analyze-query.md does not exist.
 */
function buildAnalyzeQueryPromptFallback(agentConfig: AgentConfig): string {
  return [
    `You are the query analysis stage of the ${agentConfig.name} research pipeline.`,
    '',
    'Analyze the user\'s question and decompose it into structured search queries.',
    'Return a JSON object with:',
    '- "queries": array of { "text": string, "intent": string, "priority": number }',
    '- "analysisNotes": string with your reasoning',
    '',
    'Focus on extracting key concepts, identifying specific standards or regulations',
    'referenced, and generating precise search queries for knowledge base retrieval.',
  ].join('\n');
}

/**
 * Fallback system prompt for the websearch_calibration stage.
 * Used when agents/{slug}/prompts/stage-1-websearch-calibration.md does not exist.
 */
function buildWebsearchCalibrationPromptFallback(agentConfig: AgentConfig): string {
  return [
    `You are the web search calibration stage of the ${agentConfig.name} research pipeline.`,
    '',
    'You have received the initial query analysis and web search results.',
    'Refine the search queries based on what the web results reveal about:',
    '- Correct terminology and standards references',
    '- Related concepts that should also be searched',
    '- Query reformulations that may yield better KB results',
    '',
    'Return a JSON object with:',
    '- "queries": array of refined { "text": string, "intent": string, "priority": number }',
    '- "calibrationNotes": string explaining what changed and why',
  ].join('\n');
}

/**
 * Fallback system prompt for the synthesize stage.
 * Used when agents/{slug}/prompts/stage-3-synthesize.md does not exist.
 */
function buildSynthesisPromptFallback(agentConfig: AgentConfig): string {
  return [
    `You are the synthesis stage of the ${agentConfig.name} research pipeline.`,
    '',
    'Synthesize a comprehensive research answer from the provided knowledge base context.',
    'Your answer must:',
    '- Directly address all aspects of the query plan',
    '- Cite specific paragraphs using their IDs',
    '- Be structured with clear sections',
    '- Include all relevant technical details from the sources',
    '',
    'Return a JSON object with:',
    '- "answer": the full research answer text with inline citations',
    '- "citations": array of { "paragraphId": string, "source": string, "quote": string }',
    '- "sections": array of { "title": string, "content": string }',
    '- "confidence": number 0-1 indicating answer completeness',
  ].join('\n');
}
