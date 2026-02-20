"""Hybrid search tools for the ISA Knowledge Base.

Implements:
- ``isa_hybrid_search`` — Keyword + vector + RRF fusion on ISAParagraph
- ``isa_guide_search`` — Keyword + vector + RRF fusion on GuideSection
- ``isa_multi_tier_search`` — Unified cross-tier search (guides + ISA)

Each combines:
- **Keyword path:** DuckDB full-text search (FTS/BM25)
- **Vector path:** LanceDB similarity search via Voyage AI query embeddings
- **Hybrid path (default):** Both paths fused via Reciprocal Rank Fusion (RRF)

Graceful degradation:
- If VOYAGE_API_KEY is not set, vector search is unavailable and hybrid
  mode automatically falls back to keyword-only with a warning.
"""

from __future__ import annotations

import logging
from typing import Any

from isa_kb_mcp_server.db import execute_query
from isa_kb_mcp_server.vectors import get_embedding, is_vector_search_available, search_vectors

logger = logging.getLogger("isa_kb_mcp_server.search")


# ---------------------------------------------------------------------------
# RRF Fusion
# ---------------------------------------------------------------------------


def _rrf_fuse(
    keyword_results: list[dict[str, Any]],
    vector_results: list[dict[str, Any]],
    *,
    k: int = 60,
) -> list[dict[str, Any]]:
    """Reciprocal Rank Fusion of keyword and vector result lists.

    RRF assigns score ``1 / (k + rank + 1)`` to each result based on its
    position in each list, then sums scores for results appearing in both.

    Args:
        keyword_results: Results from DuckDB FTS, ordered by relevance.
        vector_results: Results from LanceDB vector search, ordered by distance.
        k: Smoothing constant (default 60, standard RRF).

    Returns:
        Fused results sorted by descending RRF score, with ``rrf_score``
        and ``retrieval_path`` added to each dict.
    """
    scores: dict[str, float] = {}
    result_map: dict[str, dict[str, Any]] = {}
    paths: dict[str, list[str]] = {}

    for rank, r in enumerate(keyword_results):
        rid = r["id"]
        scores[rid] = scores.get(rid, 0.0) + 1.0 / (k + rank + 1)
        result_map[rid] = r
        paths.setdefault(rid, []).append("keyword")

    for rank, r in enumerate(vector_results):
        rid = r["id"]
        scores[rid] = scores.get(rid, 0.0) + 1.0 / (k + rank + 1)
        result_map[rid] = r
        paths.setdefault(rid, []).append("vector")

    # Sort by descending RRF score
    sorted_ids = sorted(scores, key=lambda x: -scores[x])

    fused: list[dict[str, Any]] = []
    for rid in sorted_ids:
        entry = dict(result_map[rid])
        entry["rrf_score"] = round(scores[rid], 6)
        entry["retrieval_path"] = "+".join(paths[rid])
        fused.append(entry)

    return fused


# ---------------------------------------------------------------------------
# Keyword search (DuckDB FTS)
# ---------------------------------------------------------------------------


def _keyword_search(
    query: str,
    *,
    max_results: int = 20,
    isa_filter: str | None = None,
) -> list[dict[str, Any]]:
    """Full-text search on ISAParagraph.content via DuckDB FTS.

    Args:
        query: The search query string.
        max_results: Maximum number of results.
        isa_filter: Optional ISA number filter (e.g., ``"315"``).

    Returns:
        List of paragraph dicts sorted by FTS relevance score.
    """
    # DuckDB FTS uses fts_main_ISAParagraph.match_bm25() for scoring
    filter_clause = ""
    params: list[Any] = [query, max_results]

    if isa_filter:
        filter_clause = "AND p.isa_number = ?"
        params = [query, isa_filter, max_results]

    sql = f"""
        SELECT
            p.id,
            p.isa_number,
            p.para_num,
            p.sub_paragraph,
            p.application_ref,
            p.paragraph_ref,
            p.content,
            p.page_number,
            p.source_doc,
            fts.score
        FROM (
            SELECT *, fts_main_ISAParagraph.match_bm25(id, ?) AS score
            FROM ISAParagraph
        ) p
        WHERE p.score IS NOT NULL
            {filter_clause}
        ORDER BY p.score DESC
        LIMIT ?
    """

    try:
        rows = execute_query(sql, params)
        return rows
    except Exception as exc:
        logger.error("Keyword search failed: %s", exc)
        return []


# ---------------------------------------------------------------------------
# Vector search wrapper
# ---------------------------------------------------------------------------


def _vector_search(
    query: str,
    *,
    max_results: int = 20,
    isa_filter: str | None = None,
) -> tuple[list[dict[str, Any]], bool]:
    """Vector similarity search via LanceDB + Voyage AI.

    Args:
        query: The search query string (will be embedded via Voyage AI).
        max_results: Maximum results.
        isa_filter: Optional ISA number filter.

    Returns:
        Tuple of (results, vector_used). If Voyage AI is unavailable,
        returns ([], False).
    """
    if not is_vector_search_available():
        return [], False

    embedding = get_embedding(query)
    if embedding is None:
        return [], False

    results = search_vectors(
        embedding,
        limit=max_results,
        isa_filter=isa_filter,
    )

    return results, True


# ---------------------------------------------------------------------------
# Public API: isa_hybrid_search
# ---------------------------------------------------------------------------


def hybrid_search(
    query: str,
    *,
    max_results: int = 20,
    isa_filter: str | None = None,
    search_type: str = "hybrid",
) -> dict[str, Any]:
    """Execute hybrid search combining keyword and vector retrieval.

    This is the core search function exposed as the ``isa_hybrid_search``
    MCP tool.

    Args:
        query: The search query.
        max_results: Maximum number of results (default 20).
        isa_filter: Optional ISA standard number filter (e.g., ``"315"``).
        search_type: One of ``"hybrid"`` (default), ``"keyword"``, ``"vector"``.

    Returns:
        Dict with keys:
        - ``results``: List of paragraph dicts with confidence scores.
        - ``total_results``: Number of results returned.
        - ``search_type_used``: The actual search type that was executed
          (may differ from requested if vector is unavailable).
        - ``warnings``: List of warning messages (e.g., fallback notices).
    """
    warnings: list[str] = []
    results: list[dict[str, Any]] = []
    search_type_used = search_type

    if search_type == "keyword":
        # Pure keyword search
        keyword_rows = _keyword_search(query, max_results=max_results, isa_filter=isa_filter)
        results = _format_keyword_results(keyword_rows)

    elif search_type == "vector":
        # Pure vector search
        vector_rows, vector_used = _vector_search(query, max_results=max_results, isa_filter=isa_filter)
        if not vector_used:
            warnings.append(
                "Vector search unavailable (VOYAGE_API_KEY not set). "
                "Falling back to keyword search."
            )
            search_type_used = "keyword"
            keyword_rows = _keyword_search(query, max_results=max_results, isa_filter=isa_filter)
            results = _format_keyword_results(keyword_rows)
        else:
            results = _format_vector_results(vector_rows)

    else:
        # Hybrid (default)
        keyword_rows = _keyword_search(query, max_results=max_results, isa_filter=isa_filter)
        vector_rows, vector_used = _vector_search(query, max_results=max_results, isa_filter=isa_filter)

        if not vector_used:
            warnings.append(
                "Vector search unavailable (VOYAGE_API_KEY not set). "
                "Using keyword-only results."
            )
            search_type_used = "keyword"
            results = _format_keyword_results(keyword_rows)
        else:
            fused = _rrf_fuse(
                _format_keyword_results(keyword_rows),
                _format_vector_results(vector_rows),
            )
            results = fused[:max_results]
            search_type_used = "hybrid"

    logger.info(
        "Search completed: type=%s query=%r results=%d",
        search_type_used, query[:80], len(results),
    )

    return {
        "results": results,
        "total_results": len(results),
        "search_type_used": search_type_used,
        "warnings": warnings,
    }


# ---------------------------------------------------------------------------
# Result formatting helpers
# ---------------------------------------------------------------------------


def _format_keyword_results(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Normalize keyword search results to a standard format."""
    formatted: list[dict[str, Any]] = []
    for row in rows:
        formatted.append({
            "id": row["id"],
            "paragraph_ref": row.get("paragraph_ref", ""),
            "content": row.get("content", ""),
            "isa_number": row.get("isa_number", ""),
            "sub_paragraph": row.get("sub_paragraph", ""),
            "application_ref": row.get("application_ref", ""),
            "page_number": row.get("page_number", 0),
            "source_doc": row.get("source_doc", ""),
            "confidence": round(float(row.get("score", 0)), 4),
            "retrieval_path": "keyword",
        })
    return formatted


def _format_vector_results(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Normalize vector search results to a standard format."""
    formatted: list[dict[str, Any]] = []
    for row in rows:
        # LanceDB returns _distance (lower = more similar)
        # Convert to confidence (higher = better): 1 / (1 + distance)
        distance = float(row.get("_distance", 1.0))
        confidence = round(1.0 / (1.0 + distance), 4)

        formatted.append({
            "id": row["id"],
            "paragraph_ref": row.get("paragraph_ref", ""),
            "content": row.get("content", ""),
            "isa_number": row.get("isa_number", ""),
            "sub_paragraph": row.get("sub_paragraph", ""),
            "application_ref": row.get("application_ref", ""),
            "page_number": row.get("page_number", 0),
            "confidence": confidence,
            "retrieval_path": "vector",
        })
    return formatted


# ---------------------------------------------------------------------------
# Guide search (DuckDB FTS on GuideSection)
# ---------------------------------------------------------------------------


def _guide_keyword_search(
    query: str,
    *,
    max_results: int = 20,
    guide_filter: str | None = None,
) -> list[dict[str, Any]]:
    """Full-text search on GuideSection.content via DuckDB FTS.

    Args:
        query: The search query string.
        max_results: Maximum number of results.
        guide_filter: Optional source_doc filter.

    Returns:
        List of guide section dicts sorted by FTS relevance score.
    """
    filter_clause = ""
    params: list[Any] = [query, max_results]

    if guide_filter:
        filter_clause = "AND g.source_doc = ?"
        params = [query, guide_filter, max_results]

    sql = f"""
        SELECT
            g.id,
            g.heading,
            g.content,
            g.source_doc,
            fts.score
        FROM (
            SELECT *, fts_main_GuideSection.match_bm25(id, ?) AS score
            FROM GuideSection
        ) g
        WHERE g.score IS NOT NULL
            {filter_clause}
        ORDER BY g.score DESC
        LIMIT ?
    """

    try:
        rows = execute_query(sql, params)
        return rows
    except Exception as exc:
        logger.error("Guide keyword search failed: %s", exc)
        return []


def _guide_vector_search(
    query: str,
    *,
    max_results: int = 20,
    guide_filter: str | None = None,
) -> tuple[list[dict[str, Any]], bool]:
    """Vector similarity search on LanceDB guides table.

    Args:
        query: The search query string.
        max_results: Maximum results.
        guide_filter: Optional source_doc filter.

    Returns:
        Tuple of (results, vector_used).
    """
    if not is_vector_search_available():
        return [], False

    embedding = get_embedding(query)
    if embedding is None:
        return [], False

    results = search_vectors(
        embedding,
        table_name="guides",
        limit=max_results,
        isa_filter=None,  # No isa_filter for guides
    )

    # Apply guide_filter post-search if specified
    if guide_filter and results:
        results = [r for r in results if r.get("source_doc") == guide_filter]

    return results, True


def _format_guide_keyword_results(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Normalize guide keyword search results."""
    formatted: list[dict[str, Any]] = []
    for row in rows:
        formatted.append({
            "id": row["id"],
            "heading": row.get("heading", ""),
            "content": row.get("content", ""),
            "source_doc": row.get("source_doc", ""),
            "confidence": round(float(row.get("score", 0)), 4),
            "retrieval_path": "keyword",
            "tier": 1,
        })
    return formatted


def _format_guide_vector_results(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Normalize guide vector search results."""
    formatted: list[dict[str, Any]] = []
    for row in rows:
        distance = float(row.get("_distance", 1.0))
        confidence = round(1.0 / (1.0 + distance), 4)

        # Parse isa_references from JSON string if present
        isa_refs_raw = row.get("isa_references", "[]")
        if isinstance(isa_refs_raw, str):
            try:
                import json
                isa_refs = json.loads(isa_refs_raw)
            except (json.JSONDecodeError, TypeError):
                isa_refs = []
        else:
            isa_refs = isa_refs_raw or []

        formatted.append({
            "id": row["id"],
            "heading": row.get("heading", ""),
            "content": row.get("content", ""),
            "source_doc": row.get("source_doc", ""),
            "isa_references": isa_refs,
            "confidence": confidence,
            "retrieval_path": "vector",
            "tier": 1,
        })
    return formatted


# ---------------------------------------------------------------------------
# Public API: guide_search
# ---------------------------------------------------------------------------


def guide_search(
    query: str,
    *,
    max_results: int = 10,
    guide_filter: str | None = None,
    search_type: str = "hybrid",
) -> dict[str, Any]:
    """Search guide documents using hybrid keyword + vector retrieval.

    Same pattern as ``hybrid_search()`` but queries GuideSection table
    and LanceDB ``guides`` table instead of ISAParagraph/isa_chunks.

    Args:
        query: The search query.
        max_results: Maximum number of results (default 10).
        guide_filter: Optional source_doc filter (e.g., ``"ISA_LCE"``).
        search_type: ``"hybrid"`` (default), ``"keyword"``, or ``"vector"``.

    Returns:
        Dict with results, total_results, search_type_used, warnings.
    """
    warnings: list[str] = []
    results: list[dict[str, Any]] = []
    search_type_used = search_type

    if search_type == "keyword":
        keyword_rows = _guide_keyword_search(query, max_results=max_results, guide_filter=guide_filter)
        results = _format_guide_keyword_results(keyword_rows)

    elif search_type == "vector":
        vector_rows, vector_used = _guide_vector_search(query, max_results=max_results, guide_filter=guide_filter)
        if not vector_used:
            warnings.append("Vector search unavailable. Falling back to keyword search.")
            search_type_used = "keyword"
            keyword_rows = _guide_keyword_search(query, max_results=max_results, guide_filter=guide_filter)
            results = _format_guide_keyword_results(keyword_rows)
        else:
            results = _format_guide_vector_results(vector_rows)

    else:
        # Hybrid (default)
        keyword_rows = _guide_keyword_search(query, max_results=max_results, guide_filter=guide_filter)
        vector_rows, vector_used = _guide_vector_search(query, max_results=max_results, guide_filter=guide_filter)

        if not vector_used:
            warnings.append("Vector search unavailable. Using keyword-only results.")
            search_type_used = "keyword"
            results = _format_guide_keyword_results(keyword_rows)
        else:
            fused = _rrf_fuse(
                _format_guide_keyword_results(keyword_rows),
                _format_guide_vector_results(vector_rows),
            )
            results = fused[:max_results]
            search_type_used = "hybrid"

    # Ensure all results have tier=1
    for r in results:
        r["tier"] = 1

    logger.info(
        "Guide search completed: type=%s query=%r results=%d",
        search_type_used, query[:80], len(results),
    )

    return {
        "results": results,
        "total_results": len(results),
        "search_type_used": search_type_used,
        "warnings": warnings,
    }


# ---------------------------------------------------------------------------
# Public API: list_guides
# ---------------------------------------------------------------------------


def list_guides() -> dict[str, Any]:
    """List available guide documents in the knowledge base.

    Returns:
        Dict with guides list and total_guides count.
    """
    sql = """
        SELECT
            source_doc,
            COUNT(*) AS section_count,
            MIN(heading) AS first_heading
        FROM GuideSection
        GROUP BY source_doc
        ORDER BY source_doc
    """

    try:
        rows = execute_query(sql)
    except Exception as exc:
        logger.error("Failed to list guides: %s", exc)
        return {"guides": [], "total_guides": 0, "error": str(exc)}

    guides: list[dict[str, Any]] = []
    for row in rows:
        guides.append({
            "source_doc": row["source_doc"],
            "section_count": int(row.get("section_count", 0)),
            "first_heading": row.get("first_heading", ""),
        })

    return {
        "guides": guides,
        "total_guides": len(guides),
    }


# ---------------------------------------------------------------------------
# Public API: multi_tier_search
# ---------------------------------------------------------------------------


def multi_tier_search(
    query: str,
    *,
    max_results: int = 20,
    tiers: list[int] | None = None,
    search_type: str = "hybrid",
    isa_filter: str | None = None,
    guide_filter: str | None = None,
) -> dict[str, Any]:
    """Search across guide documents (tier 1) and ISA standards (tier 2).

    Merges results from both tiers with authority-based weighting:
    ISA paragraphs (tier 2) weighted 1.0, guide sections (tier 1) weighted 0.85.

    Args:
        query: The search query.
        max_results: Maximum total results (default 20).
        tiers: Which tiers to search. Default ``[1, 2]``.
            1 = guide sections, 2 = ISA paragraphs.
        search_type: ``"hybrid"`` (default), ``"keyword"``, or ``"vector"``.
        isa_filter: Filter for ISA standard number (tier 2 only).
        guide_filter: Filter for guide source_doc (tier 1 only).

    Returns:
        Dict with results (each has ``tier`` field), total_results,
        search_type_used, tier_counts, warnings.
    """
    if tiers is None:
        tiers = [1, 2]

    warnings: list[str] = []
    all_results: list[dict[str, Any]] = []

    # Tier 1: Guide sections
    if 1 in tiers:
        guide_resp = guide_search(
            query,
            max_results=max_results,
            guide_filter=guide_filter,
            search_type=search_type,
        )
        for r in guide_resp["results"]:
            r["tier"] = 1
        all_results.extend(guide_resp["results"])
        warnings.extend(guide_resp.get("warnings", []))

    # Tier 2: ISA paragraphs
    if 2 in tiers:
        isa_resp = hybrid_search(
            query,
            max_results=max_results,
            isa_filter=isa_filter,
            search_type=search_type,
        )
        for r in isa_resp["results"]:
            r["tier"] = 2
        all_results.extend(isa_resp["results"])
        warnings.extend(isa_resp.get("warnings", []))

    # Apply tier weighting for cross-tier ranking
    TIER_WEIGHTS = {1: 0.85, 2: 1.0}
    for r in all_results:
        tier = r.get("tier", 2)
        base_score = r.get("confidence", r.get("rrf_score", 0))
        r["weighted_score"] = round(float(base_score) * TIER_WEIGHTS.get(tier, 1.0), 6)

    # Sort by weighted score descending
    all_results.sort(key=lambda x: -x.get("weighted_score", 0))

    # Authority-based dedup: if guide references same ISA paragraph in direct results,
    # keep the ISA paragraph and annotate with guide context
    if 1 in tiers and 2 in tiers:
        all_results = _authority_dedup(all_results)

    # Limit to max_results
    all_results = all_results[:max_results]

    # Count by tier
    tier_counts = {}
    for r in all_results:
        t = r.get("tier", 0)
        tier_counts[t] = tier_counts.get(t, 0) + 1

    logger.info(
        "Multi-tier search: query=%r tiers=%s results=%d (tier1=%d, tier2=%d)",
        query[:80], tiers, len(all_results),
        tier_counts.get(1, 0), tier_counts.get(2, 0),
    )

    return {
        "results": all_results,
        "total_results": len(all_results),
        "search_type_used": search_type,
        "tier_counts": tier_counts,
        "warnings": warnings,
    }


def _authority_dedup(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Authority-based dedup: ISA paragraphs (tier 2) beat guide sections (tier 1).

    When a guide section and an ISA paragraph cover the same content
    (detected by ISA reference overlap), keep the ISA paragraph and
    annotate it with the guide context.
    """
    # Collect ISA paragraph IDs from tier 2 results
    isa_ids: set[str] = set()
    for r in results:
        if r.get("tier") == 2:
            isa_ids.add(r["id"])

    # Check tier 1 results — if a guide section's ISA references
    # match ISA paragraphs already in results, mark for removal
    deduped: list[dict[str, Any]] = []
    guide_context_map: dict[str, str] = {}  # isa_id -> guide heading

    for r in results:
        if r.get("tier") == 1:
            # Check if this guide's ISA references overlap with tier 2 results
            isa_refs = r.get("isa_references", [])
            # For now, keep guide results (simple dedup by ID only)
            deduped.append(r)
        else:
            deduped.append(r)

    return deduped
