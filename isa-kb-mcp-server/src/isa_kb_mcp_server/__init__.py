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

    Phase 13 (Verification, Context, Web Search):
        - isa_entity_verify      — Entity grounding verification
        - isa_citation_verify    — Citation accuracy verification
        - isa_relation_verify    — Relation preservation verification
        - isa_contradiction_check — Contradiction detection
        - isa_format_context     — XML context formatting with token budget
        - isa_web_search         — Brave Search for query calibration
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

    from isa_kb_mcp_server.graph import hop_retrieve
    from isa_kb_mcp_server.paragraphs import get_paragraph, list_standards
    from isa_kb_mcp_server.search import hybrid_search

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
    ) -> dict:
        """Format retrieved paragraphs into structured XML for synthesis.

        Groups paragraphs by role (primary/supporting/context), enforces a
        token budget, and produces XML with ranked results, source attribution,
        and cross-reference metadata. This is the input format for the
        synthesis stage.

        Args:
            paragraphs: List of paragraph dicts (from isa_hybrid_search or
                isa_hop_retrieve).
            query: The original search query.
            max_tokens: Token budget for output (default 8000).
            roles: Optional mapping of paragraph ID to role
                ("primary", "supporting", "context").

        Returns:
            Dict with xml string, included/excluded counts, and token estimate.
        """
        return format_context(
            paragraphs,
            query,
            max_tokens=max_tokens,
            roles=roles,
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
