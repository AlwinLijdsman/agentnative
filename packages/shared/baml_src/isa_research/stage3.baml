// Stage 3: Synthesize — Core research answer generation
//
// Mirrors gamma's stage2.baml (our stage numbering differs).
// This is the most token-intensive stage — uses ClaudeMax with full context.
// Produces the structured research answer with inline citations.
//
// In repair iterations, receives verification feedback for self-correction.

class ISACitationBAML {
  source_ref string @description("ISA paragraph reference, e.g. 'ISA 315.12' or 'ISA 540.A20'")
  claim string @description("The specific claim this citation supports")
  quote string @description("Verbatim text from the source material")
  verified bool @description("Whether this citation has been pre-verified (false for first pass)")
}

class ISASynthesisOutput {
  synthesis string @description("Full markdown answer with inline ISA citations in (ISA X.Y) format")
  citations ISACitationBAML[] @description("All citations used in the synthesis")
  confidence float @description("0.0-1.0 overall confidence in answer completeness")
  gaps string[] @description("Areas where source material was insufficient")
  out_of_scope_notes string? @description("Topics raised but outside query scope")
  needs_repair bool @description("Whether verification is likely to find issues requiring repair")
}

function ISAResearchStage3(
  query_plan: string,
  retrieval_context: string,
  repair_feedback: string?
) -> ISASynthesisOutput {
  client ClaudeMax
  prompt #"
    {{ _.role("system") }}
    {{ ISAPreamble() }}

    You are synthesizing an authoritative ISA research answer from knowledge base sources.

    CRITICAL INSTRUCTIONS:
    1. Every factual claim MUST cite a specific ISA paragraph: (ISA {number}.{paragraph})
    2. Use ONLY information from the provided ISA context — never fabricate
    3. Structure the answer with clear markdown headings
    4. Distinguish requirements ("shall") from application material (A-paragraphs)
    5. Cross-reference related standards where relevant
    6. If source material is insufficient, explicitly identify gaps
    7. Aim for comprehensive coverage — do NOT truncate prematurely

    {{ #if repair_feedback }}
    REPAIR MODE: Previous synthesis failed verification. The following feedback
    describes what needs fixing. Correct the issues while preserving correct content:

    <REPAIR_FEEDBACK>
    {{ repair_feedback }}
    </REPAIR_FEEDBACK>
    {{ /if }}

    {{ _.role("user") }}
    <QUERY_PLAN>
    {{ query_plan }}
    </QUERY_PLAN>

    <ISA_CONTEXT>
    {{ retrieval_context }}
    </ISA_CONTEXT>

    Synthesize a comprehensive research answer addressing all aspects of the query plan.
    Use the ISA context exclusively — cite every claim.
  "#
}
