/**
 * Types for the Generic Output Renderer.
 *
 * These types define the contract between agents and the renderer tool.
 * They are intentionally decoupled from any specific domain (ISA, COSO, etc.)
 * — domain specifics are injected via RenderConfig.
 */

// ============================================================
// Source Linker Interface
// ============================================================

/**
 * Abstract interface for domain-specific source linking.
 * Implementations convert raw source references into clickable links.
 */
export interface SourceLinker {
  /** Convert a source reference to a markdown link, e.g. "ISA 540.6(a)" → "[ISA 540.6(a)](path/to/pdf)" */
  linkifyRef(sourceRef: string): string;

  /** Return a map of identifier → file path for all known source files */
  getSourceFileMap(): Record<string, string>;

  /** Extract the base identifier from a source reference, e.g. "ISA 540.6(a)" → "540" */
  extractIdentifier(sourceRef: string): string | null;
}

// ============================================================
// Render Config (from agent config.json `output` section)
// ============================================================

export interface RenderConfig {
  renderer: {
    type: string;   // e.g. "research"
    version: string; // e.g. "1.0"
  };

  titleTemplate: string;           // e.g. "ISA Research"
  followupTitleTemplate?: string;  // e.g. "ISA Research Follow-Up #{n}"
  citationFormat: string;          // e.g. "ISA {number}.{paragraph}"
  citationRegex: string;           // e.g. "\\(ISA \\d{3}..."

  sourceDiscovery: {
    enabled: boolean;
    linkerType: string;    // "isa-pdf" | "noop" | custom
    linkBase?: string;     // e.g. "../staging/pdf/"
  };

  sections: {
    externalReferencesTitle: string;
    priorResearchTitle: string;
    verificationSummaryTitle: string;
    citationsUsedTitle: string;
    researchDecompositionTitle: string;
  };

  priorResearch?: {
    refFormat: string;      // e.g. "[P{num}]"
    excerptLength: number;
  };

  webReference?: {
    refFormat: string;        // e.g. "[W{num}]"
    linkToOriginal: boolean;  // whether to hyperlink to source URL
  };

  confidence: {
    qualifierThresholds: {
      high: number;     // e.g. 0.85
      medium: number;   // e.g. 0.70
    };
  };

  files: {
    answerFile: string;             // e.g. "isa-research-output.md"
    followupTemplate?: string;      // e.g. "isa-research-output-followup-{n}.md"
  };
}

// ============================================================
// FinalAnswer — Input to the renderer from the agent pipeline
// ============================================================

export interface Citation {
  sourceRef: string;        // e.g. "ISA 540.13"
  claim: string;
  verified: boolean;
  matchLevel?: string;      // "exact" | "partial" | "content_mismatch" | "not_found"
  errorCategory?: string;   // "WRONG_REF" | "SUB_PARA_NOT_FOUND" | "NOT_FOUND" | "CONTENT_MISMATCH"
}

export interface VerificationScores {
  entity_grounding: { score: number; passed: boolean };
  citation_accuracy: { score: number; passed: boolean };
  relation_preservation: { score: number; passed: boolean };
  contradictions: { count: number; passed: boolean };
}

export interface SubQuery {
  query: string;
  role: string;          // "primary" | "supporting" | "context"
  standards: string[];
  paragraphsFound?: number;
}

export interface WebReference {
  url: string;
  title: string;
  insight: string;
  sourceType?: string;
}

export interface PriorSection {
  sectionNum: number;
  /** String section ID, e.g. "P1", "P2". Optional for backward compat. */
  sectionId?: string;
  heading: string;
  excerpt: string;
}

export interface FinalAnswer {
  originalQuery: string;
  synthesis: string;                              // Raw synthesis from Stage 3
  citations: Citation[];
  verificationScores: VerificationScores;
  sourceTexts: Record<string, string>;            // sourceRef → verbatim text
  subQueries: SubQuery[];
  depthMode: string;                              // "quick" | "standard" | "deep"

  // Optional fields
  webReferences?: WebReference[];
  priorSections?: PriorSection[];
  followupNumber?: number;
  outOfScopeNotes?: string;
  confidencePerSection?: Record<string, string>;
}

// ============================================================
// Renderer Output
// ============================================================

export interface RenderResult {
  success: boolean;
  document: string;            // Complete rendered markdown
  outputPath: string;          // Path where file was written
  filesWritten: string[];      // List of files written
  sectionsCount: number;       // Number of ## sections
  totalCitations: number;      // Total citations in citations table
  errors?: string[];
}

// ============================================================
// Handler Args (tool input schema)
// ============================================================

export interface AgentRenderOutputArgs {
  agentSlug: string;
  finalAnswer: FinalAnswer;
  renderConfig?: Partial<RenderConfig>;  // Runtime overrides
  outputDir?: string;                    // Output directory path
}
