"""Hybrid search tool for the ISA Knowledge Base.

Implements ``isa_hybrid_search`` which combines:
- **Keyword path:** DuckDB full-text search (FTS) on ISAParagraph.content
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
