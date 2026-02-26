// Stage 1: Websearch Calibration — Refine queries with web context
//
// Calibrates the query plan from Stage 0 using web search results.
// Adjusts sub-queries based on authoritative web sources.
//
// Lightweight stage (ClaudeMaxLight) — the web results do the heavy lifting.

class CalibratedQuery {
  original_text string @description("Original sub-query text from Stage 0")
  refined_text string @description("Refined text after web calibration")
  action "keep" | "modify" | "add" | "remove" @description("What changed")
  web_evidence string @description("Key findings from web search supporting the change")
  confidence_delta float @description("Change in confidence after calibration (-1.0 to 1.0)")
}

class WebsearchCalibrationOutput {
  queries CalibratedQuery[] @description("Calibrated queries with change tracking")
  calibration_summary string @description("Brief summary of what calibration found")
  new_standards_discovered string[] @description("ISA standards not in original plan but found via web")
  recommended_depth "quick" | "standard" | "deep" @description("Updated depth recommendation")
}

function ISAResearchStage1(
  query_plan: string,
  web_results: string
) -> WebsearchCalibrationOutput {
  client ClaudeMaxLight
  prompt #"
    {{ _.role("system") }}
    {{ ISAPreamble() }}

    You are calibrating ISA research queries using web search results.

    Your task: Review the query plan and web search results, then refine sub-queries.

    Rules:
    - Promote queries where web results confirm relevance
    - Demote or remove queries that web results suggest are off-target
    - Add new queries if web results reveal important angles not in the plan
    - Expand standard coverage if web results reference standards not in the plan
    - Track confidence changes for each query

    Be conservative — don't discard queries unless web evidence is strong.

    {{ _.role("user") }}
    <QUERY_PLAN>
    {{ query_plan }}
    </QUERY_PLAN>

    <WEB_RESULTS>
    {{ web_results }}
    </WEB_RESULTS>
  "#
}
