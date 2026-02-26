"""ISA Knowledge Base MCP Server.

Provides tools for hybrid search, graph traversal, verification,
context formatting, and web search across ISA standards.

This is the MCP server entry point. The ingestion pipeline lives
in scripts/ and must be run separately before the server can serve queries.

Usage:
    python -m isa_kb_mcp_server

Tools registered:
    Phase 12 (Core Search & Retrieval):
        - isa_hybrid_search  — Keyword + vector + RRF fusion search
        - isa_hop_retrieve   — Multi-hop graph traversal from a paragraph
        - isa_list_standards — List all ISA standards with metadata
        - isa_get_paragraph  — Get specific paragraph by ID or reference

    Phase 12b (Guide Search & Multi-Tier):
        - isa_guide_search       — Hybrid search on guide documents
        - isa_guide_to_isa_hop   — Guide section → ISA paragraphs via graph
        - isa_list_guides        — List available guide documents
        - isa_multi_tier_search  — Unified cross-tier search (guides + ISA)

    Phase 13 (Verification, Context, Web Search):
        - isa_entity_verify      — Entity grounding verification
        - isa_citation_verify    — Citation accuracy verification
        - isa_relation_verify    — Relation preservation verification
        - isa_contradiction_check — Contradiction detection
        - isa_format_context     — XML context formatting with token budget
        - isa_web_search         — Brave Search for query calibration

    Phase 14 (Diagnostics):
        - isa_kb_status          — KB health status (table counts, connections)
        - isa_debug_hop_trace    — Multi-hop path tracing for graph debugging
        - isa_debug_search       — Search pipeline debugging (all intermediate scores)
"""

from __future__ import annotations

__version__ = "0.1.0"

import logging
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from mcp.server.fastmcp import FastMCP

logger = logging.getLogger("isa_kb_mcp_server")


# ---------------------------------------------------------------------------
# Lifespan context manager (startup + shutdown)
# ---------------------------------------------------------------------------


@asynccontextmanager
async def _lifespan(server: FastMCP) -> AsyncIterator[dict[str, bool]]:
    """Initialize data connections on startup, clean up on shutdown.

    Yields a status dict indicating which backends are available.
    Non-fatal failures are logged as warnings — the server starts
    even if the KB is not yet ingested.
    """
    from isa_kb_mcp_server.db import close_connection, get_connection
    from isa_kb_mcp_server.vectors import close_vectors, init_vectors, is_vector_search_available

    status: dict[str, bool] = {"duckdb": False, "lancedb": False, "voyage_ai": False}

    # Startup: initialize connections
    try:
        get_connection()
        status["duckdb"] = True
    except FileNotFoundError as exc:
        logger.warning("DuckDB not available: %s", exc)
    except Exception as exc:
        logger.error("DuckDB init failed: %s", exc)

    try:
        init_vectors()
        status["lancedb"] = True
        status["voyage_ai"] = is_vector_search_available()
    except Exception as exc:
        logger.warning("Vector init failed: %s", exc)

    available = [k for k, v in status.items() if v]
    unavailable = [k for k, v in status.items() if not v]
    if available:
        logger.info("ISA KB ready — available: %s", ", ".join(available))
    if unavailable:
        logger.warning("ISA KB — unavailable: %s", ", ".join(unavailable))

    try:
        yield status
    finally:
        # Shutdown: close connections
        close_connection()
        close_vectors()
        logger.info("ISA KB server shut down")


# ---------------------------------------------------------------------------
# Server factory
# ---------------------------------------------------------------------------


def create_server() -> FastMCP:
    """Create and configure the ISA KB MCP server with all tools.

    Returns:
        Configured FastMCP server instance ready to run.
    """
    mcp = FastMCP(
        "ISA Knowledge Base",
        json_response=True,
        lifespan=_lifespan,
    )

    # ------------------------------------------------------------------
    # Phase 12: Core Search & Retrieval Tools
    # ------------------------------------------------------------------

    from isa_kb_mcp_server.graph import guide_to_isa_hop, hop_retrieve
    from isa_kb_mcp_server.paragraphs import get_paragraph, list_standards
    from isa_kb_mcp_server.search import guide_search, hybrid_search, list_guides, multi_tier_search

    @mcp.tool()
    def isa_hybrid_search(
        query: str,
        max_results: int = 20,
        isa_filter: str = "",
        search_type: str = "hybrid",
    ) -> dict:
        """Search the ISA knowledge base using hybrid keyword + vector retrieval with RRF fusion.

        Combines DuckDB full-text search (BM25) with LanceDB vector similarity
        search (Voyage AI voyage-law-2 embeddings), fused via Reciprocal Rank
        Fusion (RRF). Falls back to keyword-only if VOYAGE_API_KEY is not set.

        Args:
            query: The search query text.
            max_results: Maximum number of results to return (default 20).
            isa_filter: Optional ISA standard number to filter by (e.g., "315").
                Leave empty for no filter.
            search_type: Search mode — "hybrid" (default), "keyword", or "vector".

        Returns:
            Dict with results, total_results, search_type_used, and warnings.
        """
        return hybrid_search(
            query,
            max_results=max_results,
            isa_filter=isa_filter if isa_filter else None,
            search_type=search_type,
        )

    @mcp.tool()
    def isa_hop_retrieve(
        paragraph_id: str,
        max_hops: int = 3,
        decay: float = 0.7,
        min_score: float = 0.01,
        max_results: int = 30,
    ) -> dict:
        """Retrieve connected ISA paragraphs via multi-hop graph traversal.

        Starting from a seed paragraph, recursively follows citation and
        cross-reference edges in the knowledge graph. Each hop applies a
        decay factor to the accumulated score, pruning low-relevance paths.

        Useful for discovering related requirements, application material,
        and cross-standard connections that a simple search might miss.

        Args:
            paragraph_id: The starting paragraph ID (e.g., "ip_a1b2c3d4").
            max_hops: Maximum traversal depth (default 3). Higher values
                find more distant connections but may include noise.
            decay: Score decay per hop (default 0.7). Lower = favor closer.
            min_score: Minimum score threshold for path pruning (default 0.01).
            max_results: Maximum connected paragraphs to return (default 30).

        Returns:
            Dict with seed_id, connected paragraphs (with hop_score,
            hop_depth, hop_path), and total_found.
        """
        return hop_retrieve(
            paragraph_id,
            max_hops=max_hops,
            decay=decay,
            min_score=min_score,
            max_results=max_results,
        )

    @mcp.tool()
    def isa_list_standards() -> dict:
        """List all ISA standards in the knowledge base with metadata.

        Returns each standard's ISA number, title, version, effective date,
        and the count of paragraphs indexed for that standard.

        Returns:
            Dict with standards list and total_standards count.
        """
        return list_standards()

    @mcp.tool()
    def isa_get_paragraph(identifier: str) -> dict:
        """Get a specific ISA paragraph by ID or paragraph reference.

        Supports multiple lookup formats:
        - Direct ID: "ip_a1b2c3d4"
        - Full reference: "315.12(a).A2"
        - Standard + paragraph: "315.12"
        - With sub-paragraph: "315.12(a)"
        - Application material: "315.A2"
        - With ISA prefix: "ISA 315.12(a)"

        Also returns directly related paragraphs (citations, parent standard).

        Args:
            identifier: Paragraph ID or reference string.

        Returns:
            Dict with paragraph (or None), related paragraphs, and found flag.
        """
        return get_paragraph(identifier)

    # ------------------------------------------------------------------
    # Phase 12b: Guide Search & Multi-Tier Tools
    # ------------------------------------------------------------------

    @mcp.tool()
    def isa_guide_search(
        query: str,
        max_results: int = 10,
        guide_filter: str = "",
        search_type: str = "hybrid",
    ) -> dict:
        """Search guide documents using hybrid keyword + vector retrieval with RRF fusion.

        Searches guide sections (e.g., ISA for LCE chapters) rather than
        ISA paragraphs. Use this to find guide-level context that references
        specific ISA requirements.

        Args:
            query: The search query text.
            max_results: Maximum number of results to return (default 10).
            guide_filter: Optional source document name to filter by (e.g., "ISA_LCE").
                Leave empty for no filter.
            search_type: Search mode — "hybrid" (default), "keyword", or "vector".

        Returns:
            Dict with results, total_results, search_type_used, and warnings.
        """
        return guide_search(
            query,
            max_results=max_results,
            guide_filter=guide_filter if guide_filter else None,
            search_type=search_type,
        )

    @mcp.tool()
    def isa_guide_to_isa_hop(
        guide_section_id: str,
        max_hops: int = 2,
    ) -> dict:
        """From a guide section, find connected ISA paragraphs via graph traversal.

        First follows maps_to edges from the guide section to directly
        referenced ISA paragraphs. Then continues via hop_edge for further
        ISA-to-ISA connections.

        This gives a "guide-first" retrieval path:
        Guide Section → maps_to → ISA Paragraphs → hop_edge → Related ISA

        Args:
            guide_section_id: The guide section ID (e.g., "gs_a1b2c3d4").
            max_hops: Maximum additional hops beyond maps_to (default 2).

        Returns:
            Dict with guide_section info, direct_references, connected paragraphs,
            and total_found.
        """
        return guide_to_isa_hop(
            guide_section_id,
            max_hops=max_hops,
        )

    @mcp.tool()
    def isa_list_guides() -> dict:
        """List all guide documents in the knowledge base.

        Returns each guide's source document name, section count, and
        first heading. Use this to discover what guide content is available
        before searching.

        Returns:
            Dict with guides list and total_guides count.
        """
        return list_guides()

    @mcp.tool()
    def isa_multi_tier_search(
        query: str,
        max_results: int = 20,
        tiers: list[int] | None = None,
        search_type: str = "hybrid",
    ) -> dict:
        """Search across both guide documents (tier 1) and ISA standards (tier 2).

        Results are ranked across tiers with authority-based weighting.
        ISA paragraphs (authoritative) are weighted 1.0, guide sections
        (supplementary) are weighted 0.85.

        Args:
            query: The search query text.
            max_results: Maximum total results to return (default 20).
            tiers: Which tiers to search — [1] guides only, [2] ISA only,
                [1, 2] both (default). Tier 1 = guides, Tier 2 = ISA standards.
            search_type: Search mode — "hybrid" (default), "keyword", or "vector".

        Returns:
            Dict with results (each with tier field), total_results,
            search_type_used, tier_counts, and warnings.
        """
        return multi_tier_search(
            query,
            max_results=max_results,
            tiers=tiers if tiers else [1, 2],
            search_type=search_type,
        )

    # ------------------------------------------------------------------
    # Phase 13: Verification, Context Formatter, Web Search
    # ------------------------------------------------------------------

    from isa_kb_mcp_server.context import format_context
    from isa_kb_mcp_server.verify import (
        citation_verify,
        contradiction_check,
        entity_verify,
        relation_verify,
    )
    from isa_kb_mcp_server.web_search import web_search
    from isa_kb_mcp_server.diagnostics import debug_hop_trace, kb_status

    @mcp.tool()
    def isa_entity_verify(
        entities: list[str],
        source_paragraph_ids: list[str],
    ) -> dict:
        """Check that entities in a synthesis exist in source paragraphs (entity grounding).

        Verifies that ISA-specific terms, standard numbers, and defined concepts
        referenced in the synthesis are actually grounded in the source material.

        Args:
            entities: List of entity strings to verify (e.g.,
                ["ISA 315", "risk assessment procedures", "315.12(a)"]).
            source_paragraph_ids: List of paragraph IDs used as sources.

        Returns:
            Dict with score (0-1), passed (bool), and per-entity details.
        """
        return entity_verify(entities, source_paragraph_ids)

    @mcp.tool()
    def isa_citation_verify(
        citations: list[dict],
    ) -> dict:
        """Verify cited paragraph IDs exist and content supports claims (citation accuracy).

        Checks each citation in the synthesis: does the paragraph exist in the
        knowledge base, and does its content actually support the claim made?

        Args:
            citations: List of citation dicts, each with:
                - paragraph_id or paragraph_ref: The cited source.
                - claim: The text the synthesis attributes to this source.

        Returns:
            Dict with score (0-1), passed (bool), and per-citation details.
        """
        return citation_verify(citations)

    @mcp.tool()
    def isa_relation_verify(
        relations: list[dict],
    ) -> dict:
        """Check that relationships between standards are preserved (relation preservation).

        Verifies that cross-references and relationships claimed in the synthesis
        actually exist in the knowledge graph edge tables (cites, hop_edge).

        Args:
            relations: List of relation dicts, each with:
                - source_paragraph: Source paragraph ID or ref.
                - target_paragraph: Target paragraph ID or ref.
                - relation_type: Type (e.g., "cites", "cross_references").

        Returns:
            Dict with score (0-1), passed (bool), and per-relation details.
        """
        return relation_verify(relations)

    @mcp.tool()
    def isa_contradiction_check(
        paragraph_ids: list[str],
        synthesis_claims: list[str] | None = None,
    ) -> dict:
        """Detect contradictions between cited paragraphs.

        Uses heuristic pattern matching to find opposing requirements
        (e.g., "shall" vs "shall not") between paragraphs from the same
        ISA standard that are cited together in the synthesis.

        Args:
            paragraph_ids: List of paragraph IDs used in the synthesis.
            synthesis_claims: Optional list of claim strings for cross-check.

        Returns:
            Dict with contradiction_count (0 is best), passed (bool), and details.
        """
        return contradiction_check(paragraph_ids, synthesis_claims)

    @mcp.tool()
    def isa_format_context(
        paragraphs: list[dict],
        query: str,
        max_tokens: int = 8000,
        roles: dict | None = None,
        group_by_role: bool = True,
    ) -> dict:
        """Format retrieved paragraphs into structured XML for synthesis.

        Groups paragraphs by role (primary/supporting/context), enforces a
        token budget, and produces XML with ranked results, source attribution,
        and cross-reference metadata. This is the input format for the
        synthesis stage.

        When group_by_role is True (default), the output XML is structured
        into <primary_isa>, <supporting_isa>, and <context_isa> sections
        with the token budget split 60/30/10 across roles.

        Args:
            paragraphs: List of paragraph dicts (from isa_hybrid_search or
                isa_hop_retrieve).
            query: The original search query.
            max_tokens: Token budget for output (default 8000).
            roles: Optional mapping of paragraph ID to role
                ("primary", "supporting", "context").
            group_by_role: When True, produce role-grouped XML with
                <primary_isa>, <supporting_isa>, <context_isa> wrapper
                elements and 60/30/10 budget split. When False, flat XML.

        Returns:
            Dict with xml string, included/excluded counts, token estimate,
            and role_counts.
        """
        return format_context(
            paragraphs,
            query,
            max_tokens=max_tokens,
            roles=roles,
            group_by_role=group_by_role,
        )

    @mcp.tool()
    def isa_web_search(
        queries: list[str],
        max_results_per_query: int = 5,
    ) -> dict:
        """Search the web via Brave Search for ISA-related context and calibration.

        Used in Stage 0 for "Second Calibration" — web insights inform what to
        FOCUS on during retrieval. Scores results by term overlap, domain
        preference (IFAC, IAASB, PCAOB, AICPA), and snippet quality.

        Returns empty results gracefully if BRAVE_API_KEY is not configured.

        Args:
            queries: List of search query strings (typically 3-5 targeted queries).
            max_results_per_query: Max results per query (default 5).

        Returns:
            Dict with results, analysis_hints, queries_executed, and warnings.
        """
        return web_search(queries, max_results_per_query=max_results_per_query)

    # ------------------------------------------------------------------
    # Phase 14: Diagnostic Tools
    # ------------------------------------------------------------------

    @mcp.tool()
    def isa_kb_status() -> dict:
        """Return KB health status including table counts, vector collection sizes, and connection state.

        Provides a comprehensive health check of the ISA Knowledge Base,
        including DuckDB table row counts, LanceDB vector counts,
        and API availability.

        Returns:
            Dict with duckdb, lancedb, and voyage_ai status.
        """
        return kb_status()

    @mcp.tool()
    def isa_debug_hop_trace(
        start_id: str,
        max_hops: int = 3,
    ) -> dict:
        """Trace the full multi-hop path from a node, showing every edge traversed.

        Useful for debugging graph connectivity and understanding how
        guide sections connect to ISA paragraphs through the knowledge graph.

        Args:
            start_id: Starting node ID (gs_ prefix for guide sections,
                ip_ prefix for ISA paragraphs).
            max_hops: Maximum traversal depth (default 3).

        Returns:
            Dict with start_node info, hop trace, total nodes discovered,
            and maximum depth reached.
        """
        return debug_hop_trace(start_id, max_hops=max_hops)

    @mcp.tool()
    def isa_debug_search(
        query: str,
        max_results: int = 10,
    ) -> dict:
        """Run hybrid search with full intermediate scoring visible for debugging.

        Shows every pipeline stage: query expansion, raw BM25 keyword scores,
        raw vector distances, RRF fusion scores, and reranker scores.
        Useful for diagnosing why a query returns unexpected results.

        Args:
            query: The search query to debug.
            max_results: Maximum results per stage (default 10).

        Returns:
            Dict with query, expanded_query, keyword_results, vector_results,
            rrf_fused, reranked, final, and warnings.
        """
        from isa_kb_mcp_server.diagnostics import debug_search

        return debug_search(query, max_results=max_results)

    return mcp


# ---------------------------------------------------------------------------
# Module-level server instance (for python -m isa_kb_mcp_server)
# ---------------------------------------------------------------------------

mcp = create_server()


def main() -> None:
    """Run the MCP server via stdio transport."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
        stream=sys.stderr,
    )
    mcp.run(transport="stdio")
