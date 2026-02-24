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
  McpBridge,
  OrchestratorConfig,
  RetrievalParagraph,
  StageConfig,
  StageResult,
  StreamEvent,
  WebSearchResult,
} from './types.ts';
import { ZERO_USAGE } from './types.ts';
import { buildStageContext } from './context-builder.ts';
import { extractRawJson } from './json-extractor.ts';

// BAML adapter — feature-flagged, uses dynamic imports (Phase 10)
import { callBamlStage0, callBamlStage1, callBamlStage3 } from './baml-adapter.ts';

// Renderer imports for deterministic output stage (Phase 8)
import { renderDocument } from '@craft-agent/session-tools-core/renderer';
import type { FinalAnswer, RenderConfig, Citation, VerificationScores, SubQuery } from '@craft-agent/session-tools-core/renderer-types';
import { mergeRenderConfig, extractOutputConfig } from '@craft-agent/session-tools-core/renderer-config';
import { createSourceLinker } from '@craft-agent/session-tools-core/renderer-linker';

// ============================================================================
// STAGE RUNNER
// ============================================================================

export class StageRunner {
  constructor(
    private readonly llmClient: OrchestratorLlmClient,
    private readonly mcpBridge: McpBridge | null,
    private readonly sessionPath: string,
    private readonly onStreamEvent?: (event: StreamEvent) => void,
    private readonly getAuthToken?: () => Promise<string>,
  ) {}

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
  ): Promise<StageResult> {
    switch (stage.name) {
      case 'analyze_query':
        return this.runAnalyzeQuery(stage, state, userMessage, agentConfig);
      case 'websearch_calibration':
        return this.runWebsearchCalibration(stage, state, agentConfig);
      case 'retrieve':
        return this.runRetrieve(stage, state, agentConfig);
      case 'synthesize':
        return this.runSynthesize(stage, state, agentConfig);
      case 'verify':
        return this.runVerify(stage, state, agentConfig);
      case 'output':
        return this.runOutput(stage, state, agentConfig);
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

    const result = await this.llmClient.call({
      systemPrompt,
      userMessage,
      desiredMaxTokens: desiredTokens,
      effort: this.getStageEffort(orchestratorConfig),
      onStreamEvent: this.onStreamEvent,
    });

    // Parse structured output — extract JSON from LLM text
    const parsed = extractRawJson(result.text);
    const data = (parsed != null && typeof parsed === 'object')
      ? parsed as Record<string, unknown>
      : { rawText: result.text };

    const queryCount = Array.isArray(data['queries']) ? data['queries'].length : 0;

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
    if (!queryPlanStage?.data?.['queries']) {
      return {
        text: 'No queries to calibrate',
        summary: 'Skipped — no query plan from stage 0',
        usage: ZERO_USAGE,
        data: {},
      };
    }

    // 2. Run web searches via McpBridge for each query
    const webResults: WebSearchResult[] = [];
    if (this.mcpBridge) {
      const queries = queryPlanStage.data['queries'] as Array<{ text: string }>;
      for (const query of queries) {
        try {
          const searchResult = await this.mcpBridge.webSearch(query.text);
          webResults.push(searchResult);
        } catch (error) {
          console.warn(
            `[StageRunner] Web search failed for query "${query.text}":`,
            error instanceof Error ? error.message : error,
          );
          webResults.push({ query: query.text, results: [] });
        }
      }
    } else {
      console.warn('[StageRunner] No McpBridge available — skipping web searches');
    }

    const orchestratorConfig = agentConfig.orchestrator;
    const useBAML = orchestratorConfig?.useBAML === true;

    // ── BAML path (Phase 10) ──────────────────────────────────────────────
    if (useBAML && this.getAuthToken) {
      try {
        const authToken = await this.getAuthToken();
        const bamlResult = await callBamlStage1(
          JSON.stringify(queryPlanStage.data),
          JSON.stringify(webResults),
          authToken,
        );
        if (bamlResult) {
          return {
            text: JSON.stringify(bamlResult, null, 2),
            summary: `Calibrated ${bamlResult.queries.length} queries with ${webResults.length} web searches (BAML)`,
            usage: ZERO_USAGE, // TODO(baml-usage): BAML client doesn't expose token usage — cost tracking is blind to BAML stages
            data: {
              queries: bamlResult.queries.map(q => ({
                text: q.refined_text,
                intent: q.original_text,
                priority: 1,
              })),
              calibration: bamlResult,
              webResults,
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
      previousOutputs: { queryPlan: queryPlanStage.data },
      agentConfig,
    });

    // Append web results as additional context
    const webContext = webResults.length > 0
      ? `\n\n<WEB_SEARCH_RESULTS>\n${JSON.stringify(webResults, null, 2)}\n</WEB_SEARCH_RESULTS>`
      : '';

    const result = await this.llmClient.call({
      systemPrompt,
      userMessage: userContent + webContext,
      desiredMaxTokens: desiredTokens,
      effort: this.getStageEffort(orchestratorConfig),
      onStreamEvent: this.onStreamEvent,
    });

    // 4. Parse calibrated query plan
    const parsed = extractRawJson(result.text);
    const data = (parsed != null && typeof parsed === 'object')
      ? parsed as Record<string, unknown>
      : { rawText: result.text, webResults };

    const queryCount = Array.isArray(data['queries']) ? data['queries'].length : 'N/A';

    return {
      text: result.text,
      summary: `Calibrated ${queryCount} queries with ${webResults.length} web searches`,
      usage: result.usage,
      data: { ...data, webResults },
    };
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
    _agentConfig: AgentConfig,
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
    const querySource = calibration?.data?.['queries'] ?? queryPlan?.data?.['queries'];

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
      try {
        const paragraphs = await this.mcpBridge.kbSearch(query.text, { maxResults: 20 });
        for (const p of paragraphs) {
          if (!seenIds.has(p.id)) {
            seenIds.add(p.id);
            allParagraphs.push(p);
          }
        }
      } catch (error) {
        console.warn(
          `[StageRunner] KB search failed for query "${query.text}":`,
          error instanceof Error ? error.message : error,
        );
      }
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

    const useBAML = orchestratorConfig?.useBAML === true;

    // ── BAML path (Phase 10) ──────────────────────────────────────────────
    if (useBAML && this.getAuthToken) {
      try {
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
        });

        const bamlResult = await callBamlStage3(
          JSON.stringify(queryPlan ?? {}),
          retrievalContextStr,
          authToken,
          repairFeedback,
        );
        if (bamlResult) {
          return {
            text: bamlResult.synthesis,
            summary: `Synthesis complete: ${bamlResult.citations.length} citations (BAML)`,
            usage: ZERO_USAGE, // TODO(baml-usage): BAML client doesn't expose token usage — cost tracking is blind to BAML stages
            data: {
              synthesis: bamlResult.synthesis,
              citations: bamlResult.citations,
              confidence: bamlResult.confidence,
              gaps: bamlResult.gaps,
              out_of_scope_notes: bamlResult.out_of_scope_notes,
              needs_repair: bamlResult.needs_repair,
            },
          };
        }
      } catch (bamlError) {
        if (orchestratorConfig?.bamlFallbackToZod) {
          console.warn('[orchestrator] Stage 3 BAML failed, falling back to Zod:', bamlError);
        } else {
          throw bamlError;
        }
      }
    }

    // ── Zod fallback path ─────────────────────────────────────────────────
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
    });

    const result = await this.llmClient.call({
      systemPrompt,
      userMessage: userContent,
      desiredMaxTokens: desiredTokens,
      effort: this.getStageEffort(orchestratorConfig),
      onStreamEvent: this.onStreamEvent,
    });

    const parsed = extractRawJson(result.text);
    const data = (parsed != null && typeof parsed === 'object')
      ? parsed as Record<string, unknown>
      : { rawText: result.text };

    return {
      text: result.text,
      summary: 'Synthesis complete',
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
      try {
        const verifyResult = await this.mcpBridge.citationVerify(citation);
        verificationResults.push(verifyResult);
        if (verifyResult['verified'] === false) {
          failedCount++;
        }
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
  ): Promise<StageResult> {
    // 1. Gather data from previous stages
    const queryPlanOutput = state.getStageOutput(0);
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
