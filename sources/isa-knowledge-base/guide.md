# ISA Knowledge Base

MCP source providing hybrid search, graph traversal, verification, context formatting, and web search tools for International Standards on Auditing (ISA).

## Prerequisites

- Python 3.11+ with virtual environment at `isa-kb-mcp-server/.venv/`
- DuckDB + LanceDB populated via `scripts/setup_infra.py` + `scripts/ingest_isa.py`
- `VOYAGE_API_KEY` for vector search (optional — falls back to keyword-only without it)
- `BRAVE_API_KEY` for web search enrichment (optional — returns empty gracefully without it)

### Runtime environment note (Electron + MCP subprocess)

`isa_web_search` reads `BRAVE_API_KEY` from the process environment inherited by the MCP subprocess.

- Recommended: set `BRAVE_API_KEY` in your shell/user environment before launching Agentnative.
- Do **not** store `BRAVE_API_KEY` in `sources/*/config.json`.
- If missing, Stage 1 web search degrades safely to zero results with warnings.

## Tools

### Search & Retrieval (Phase 12)

1. **isa_hybrid_search** — Keyword + vector + RRF fusion search across ISA paragraphs.
   - `query` (str, required): Search query text.
   - `max_results` (int, default 20): Maximum results.
   - `isa_filter` (str, optional): Filter by ISA number (e.g., "315").
   - `search_type` (str, default "hybrid"): "hybrid", "keyword", or "vector".
   - Falls back to keyword-only when `VOYAGE_API_KEY` is not set.

2. **isa_hop_retrieve** — Multi-hop graph traversal from a seed paragraph using weighted citation edges.
   - `paragraph_id` (str, required): Starting paragraph ID.
   - `max_hops` (int, default 3): Maximum traversal depth.
   - `decay` (float, default 0.7): Score decay per hop.
   - `min_score` (float, default 0.01): Prune paths below this score.
   - `max_results` (int, default 30): Maximum connected paragraphs.

3. **isa_list_standards** — List all ISA standards with metadata (number, title, version, paragraph count). No parameters.

4. **isa_get_paragraph** — Get a specific paragraph by ID or paragraph reference.
   - `identifier` (str, required): Paragraph ID (e.g., "ip_a1b2c3d4") or reference (e.g., "315.12(a)", "ISA 315.A2").
   - Returns the paragraph, directly related paragraphs, and found status.

### Verification (Phase 13)

5. **isa_entity_verify** — Check that entities in synthesized output exist in source paragraphs (entity grounding score).
   - `entities` (list[str], required): Entity strings to verify.
   - `source_paragraph_ids` (list[str], required): Source paragraph IDs.
   - Returns: score (0-1), passed (bool, threshold 0.80), per-entity details.

6. **isa_citation_verify** — Verify cited paragraph IDs exist and content supports the claim (citation accuracy score).
   - `citations` (list[dict], required): Each with `paragraph_id` (or `paragraph_ref`) and `claim`.
   - Returns: score (0-1), passed (bool, threshold 0.75), per-citation details with term overlap.

7. **isa_relation_verify** — Check that relationships between standards are preserved (relation preservation score).
   - `relations` (list[dict], required): Each with `source_paragraph`, `target_paragraph`, `relation_type`.
   - Returns: score (0-1), passed (bool, threshold 0.70), per-relation details.

8. **isa_contradiction_check** — Detect contradictions between cited paragraphs.
   - `paragraph_ids` (list[str], required): Paragraph IDs used in synthesis.
   - `synthesis_claims` (list[str], optional): Claim strings for cross-check.
   - Returns: contradiction_count (0 is best), passed (bool, 0 contradictions = pass), details.

### Context & Web Search (Phase 13)

9. **isa_format_context** — Format retrieved paragraphs as structured XML for synthesis.
   - `paragraphs` (list[dict], required): Paragraph dicts from search/hop tools.
   - `query` (str, required): Original search query.
   - `max_tokens` (int, default 8000): Token budget (4 chars/token approximation).
   - `roles` (dict, optional): Mapping of paragraph ID → role ("primary", "supporting", "context").
   - Role caps: primary (uncapped), supporting (15), context (5). Always includes at least 1 result.

10. **isa_web_search** — Brave Search for query calibration and web enrichment.
    - `queries` (list[str], required): Search query strings (typically 3-5).
    - `max_results_per_query` (int, default 5): Max results per query.
    - Relevance scoring: term overlap (0-0.5) + domain preference (0-0.25) + snippet quality (0-0.25).
    - Preferred domains: ifac.org, iaasb.org, pcaobus.org, aicpa.org, accountancyeurope.eu.
    - Returns empty gracefully when `BRAVE_API_KEY` is not configured.

## Usage Pattern

```
1. isa_hybrid_search(query) → ranked paragraphs
2. isa_hop_retrieve(top_paragraph_id) → connected paragraphs
3. isa_format_context(all_paragraphs, query) → XML for synthesis
4. [After synthesis] isa_entity_verify + isa_citation_verify + isa_relation_verify + isa_contradiction_check
5. [Optional Stage 0] isa_web_search(calibration_queries) → analysis hints
```
