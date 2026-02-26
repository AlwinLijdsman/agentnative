/**
 * BAML Output Types — TypeScript mirrors of BAML-defined output classes
 *
 * These types match the BAML output schemas defined in `baml_src/isa_research/`.
 * They serve as the contract between BAML-generated clients and stage-runner.ts.
 *
 * When BAML generates TypeScript clients, the generated types SHOULD match these.
 * If they drift, the adapter layer catches type mismatches at runtime.
 *
 * Stages covered by BAML:
 * - Stage 0: ISAQueryPlanOutput (analyze_query)
 * - Stage 1: WebsearchCalibrationOutput (websearch_calibration)
 * - Stage 3: ISASynthesisOutput (synthesize)
 *
 * Stages NOT covered (pure MCP/TypeScript):
 * - Stage 2: retrieve (MCP-only)
 * - Stage 4: verify (MCP-only)
 * - Stage 5: output (TypeScript renderer)
 */

// ============================================================================
// STAGE 0 — Analyze Query
// ============================================================================

export interface ISASubQuery {
  text: string;
  intent: string;
  isa_standards: string[];
  search_strategy: 'semantic' | 'keyword' | 'hybrid';
}

export interface ISAQueryPlanOutput {
  original_query: string;
  refined_query: string;
  scope_classification: 'single_standard' | 'cross_standard' | 'thematic' | 'procedural';
  clarity_score: number;
  sub_queries: ISASubQuery[];
  depth_recommendation: 'quick' | 'standard' | 'deep';
  primary_standards: string[];
  assumptions: string[];
}

// ============================================================================
// STAGE 1 — Websearch Calibration
// ============================================================================

export interface CalibratedQuery {
  original_text: string;
  refined_text: string;
  action: 'keep' | 'modify' | 'add' | 'remove';
  web_evidence: string;
  confidence_delta: number;
}

export interface WebsearchCalibrationOutput {
  queries: CalibratedQuery[];
  calibration_summary: string;
  new_standards_discovered: string[];
  recommended_depth: 'quick' | 'standard' | 'deep';
}

// ============================================================================
// STAGE 3 — Synthesize
// ============================================================================

export interface ISACitationBAML {
  source_ref: string;
  claim: string;
  quote: string;
  verified: boolean;
}

export interface ISASynthesisOutput {
  synthesis: string;
  citations: ISACitationBAML[];
  confidence: number;
  gaps: string[];
  out_of_scope_notes?: string;
  needs_repair: boolean;
}

// ============================================================================
// COMMON — Decision types
// ============================================================================

export interface BinaryDecision {
  decision: boolean;
  reasoning: string;
  confidence: number;
}

export interface ScoredDecision {
  score: number;
  reasoning: string;
  factors: string[];
}
