"""FlashRank-based reranker for search results.

Provides reranking as a post-processing step after RRF fusion.
Falls back gracefully if FlashRank is not installed.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger("isa_kb_mcp_server.rerank")

_reranker = None
_reranker_available = False


def _init_reranker() -> None:
    """Initialize FlashRank reranker (lazy, first-call)."""
    global _reranker, _reranker_available
    if _reranker is not None:
        return
    try:
        from flashrank import Ranker, RerankRequest
        _reranker = Ranker()
        _reranker_available = True
        logger.info("FlashRank reranker initialized")
    except Exception as exc:
        logger.warning("FlashRank not available, reranking disabled: %s", exc)
        _reranker_available = False


def rerank_results(
    query: str,
    results: list[dict[str, Any]],
    *,
    top_k: int = 20,
) -> list[dict[str, Any]]:
    """Rerank results using FlashRank.

    Args:
        query: The search query.
        results: List of result dicts (must have 'content' field).
        top_k: Number of top results to return.

    Returns:
        Reranked results with 'rerank_score' field added.
        If FlashRank is unavailable, returns results unchanged.
    """
    _init_reranker()

    if not _reranker_available or not _reranker or not results:
        return results[:top_k]

    try:
        from flashrank import RerankRequest

        passages = []
        for r in results:
            passages.append({"id": r.get("id", ""), "text": r.get("content", "")})

        request = RerankRequest(query=query, passages=passages)
        reranked = _reranker.rerank(request)

        # Map scores back to original results
        score_map = {}
        for item in reranked:
            score_map[item["id"]] = item["score"]

        for r in results:
            rid = r.get("id", "")
            if rid in score_map:
                r["rerank_score"] = round(float(score_map[rid]), 6)

        # Sort by rerank score descending
        results.sort(key=lambda x: -x.get("rerank_score", 0))
        return results[:top_k]

    except Exception as exc:
        logger.warning("Reranking failed, returning original order: %s", exc)
        return results[:top_k]
