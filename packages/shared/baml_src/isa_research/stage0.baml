// Stage 0: Analyze Query — Query decomposition and planning
//
// Mirrors gamma's stage0.baml. Decomposes a user query into structured
// sub-queries with ISA standard targeting and search strategy hints.
//
// This is the first LLM call in the pipeline — lightweight (ClaudeMaxLight).

class ISASubQuery {
  text string @description("The specific sub-query to search for")
  intent string @description("What this sub-query aims to find")
  isa_standards string[] @description("Expected relevant ISA standards, e.g. ['ISA 315', 'ISA 540']")
  search_strategy "semantic" | "keyword" | "hybrid" @description("Preferred search method")
}

class ISAQueryPlanOutput {
  original_query string @description("The user's original question, preserved verbatim")
  refined_query string @description("Improved version of the query for search")
  scope_classification "single_standard" | "cross_standard" | "thematic" | "procedural"
  clarity_score float @description("0.0-1.0 confidence in query understanding")
  sub_queries ISASubQuery[] @description("Decomposed search queries (3-8 recommended)")
  depth_recommendation "quick" | "standard" | "deep" @description("Recommended research depth")
  primary_standards string[] @description("Main ISA standards expected to be relevant")
  assumptions string[] @description("Assumptions made about the query intent")
}

function ISAResearchStage0(query: string) -> ISAQueryPlanOutput {
  client ClaudeMaxLight
  prompt #"
    {{ _.role("system") }}
    {{ ISAPreamble() }}

    You are analyzing a research query about International Standards on Auditing.

    Your task: Decompose the query into a structured research plan.

    Step 1: Understand the query scope — single standard, cross-standard, thematic, or procedural
    Step 2: Identify the primary ISA standards likely to contain the answer
    Step 3: Break down into 3-8 focused sub-queries with search strategies
    Step 4: Assess confidence in your understanding (0.0-1.0)
    Step 5: Recommend research depth (quick/standard/deep)

    If the query is ambiguous, make reasonable assumptions and document them.
    Prefer over-decomposition — more sub-queries are better than too few.

    {{ _.role("user") }}
    Analyze this research query and produce a structured query plan:

    {{ query }}
  "#
}
