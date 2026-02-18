"""Brave Search integration for ISA Deep Research query calibration.

Implements ``isa_web_search`` — calls the Brave Search API to gather
web context for refining research queries (Stage 0 "Second Calibration").

Graceful degradation: returns empty results if ``BRAVE_API_KEY`` is not
configured. The feature degrades, never fails.
"""

from __future__ import annotations

import logging
import os
import re
from typing import Any

import httpx

logger = logging.getLogger("isa_kb_mcp_server.web_search")

BRAVE_API_URL = "https://api.search.brave.com/res/v1/web/search"

# Preferred domains for ISA/auditing content (higher relevance score)
PREFERRED_DOMAINS = [
    "ifac.org",
    "iaasb.org",
    "pcaobus.org",
    "aicpa.org",
    "accountancyeurope.eu",
]


def web_search(
    queries: list[str],
    *,
    max_results_per_query: int = 5,
) -> dict[str, Any]:
    """Search the web via Brave Search for ISA-related context.

    Used in Stage 0 of the ISA Deep Research agent for "Second Calibration" —
    web insights inform what to FOCUS on during retrieval, not what the
    answer says directly.

    Args:
        queries: List of search query strings (typically 3-5 targeted
            queries derived from the user's question).
        max_results_per_query: Maximum results per query (default 5).

    Returns:
        Dict with:
        - ``results``: List of result dicts with title, url, snippet,
          relevance_score.
        - ``analysis_hints``: List of high-level observations from the
          web results (e.g., "ISA 315 frequently mentioned alongside
          risk assessment").
        - ``queries_executed``: Number of queries that were executed.
        - ``warnings``: List of warning strings.
    """
    api_key = os.environ.get("BRAVE_API_KEY", "")

    if not api_key:
        logger.info("BRAVE_API_KEY not set, returning empty web search results")
        return {
            "results": [],
            "analysis_hints": [],
            "queries_executed": 0,
            "warnings": ["BRAVE_API_KEY not configured. Web search is disabled."],
        }

    if not queries:
        return {
            "results": [],
            "analysis_hints": [],
            "queries_executed": 0,
            "warnings": [],
        }

    all_results: list[dict[str, Any]] = []
    warnings: list[str] = []

    headers = {
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": api_key,
    }

    for query in queries:
        try:
            results = _execute_brave_query(
                query,
                headers=headers,
                max_results=max_results_per_query,
            )
            all_results.extend(results)
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 401:
                warnings.append(f"Brave API authentication failed for query: {query[:50]}")
                break  # All subsequent queries will also fail
            elif exc.response.status_code == 429:
                warnings.append("Brave API rate limit reached. Stopping web search.")
                break
            else:
                warnings.append(f"Brave API error ({exc.response.status_code}) for: {query[:50]}")
        except httpx.TimeoutException:
            warnings.append(f"Brave API timeout for: {query[:50]}")
        except Exception as exc:
            logger.warning("Web search error for query '%s': %s", query[:50], exc)
            warnings.append(f"Web search error: {exc}")

    # Deduplicate by URL
    seen_urls: set[str] = set()
    unique_results: list[dict[str, Any]] = []
    for r in all_results:
        if r["url"] not in seen_urls:
            seen_urls.add(r["url"])
            unique_results.append(r)

    # Sort by relevance score descending
    unique_results.sort(key=lambda x: -x.get("relevance_score", 0))

    # Generate analysis hints
    hints = _generate_analysis_hints(unique_results, queries)

    logger.info(
        "Web search: %d queries, %d unique results, %d hints",
        len(queries), len(unique_results), len(hints),
    )

    return {
        "results": unique_results,
        "analysis_hints": hints,
        "queries_executed": len(queries),
        "warnings": warnings,
    }


def _execute_brave_query(
    query: str,
    *,
    headers: dict[str, str],
    max_results: int = 5,
) -> list[dict[str, Any]]:
    """Execute a single Brave Search query.

    Args:
        query: Search query string.
        headers: HTTP headers including API key.
        max_results: Maximum results.

    Returns:
        List of scored result dicts.

    Raises:
        httpx.HTTPStatusError: On API errors.
        httpx.TimeoutException: On timeout.
    """
    params = {
        "q": query,
        "count": str(max_results),
    }

    with httpx.Client(timeout=15.0) as client:
        response = client.get(BRAVE_API_URL, headers=headers, params=params)
        response.raise_for_status()

    data = response.json()
    web_results = data.get("web", {}).get("results", [])

    results: list[dict[str, Any]] = []
    for item in web_results[:max_results]:
        title = item.get("title", "")
        url = item.get("url", "")
        snippet = item.get("description", "")

        relevance = _score_relevance(query, title, snippet, url)

        results.append({
            "title": title,
            "url": url,
            "snippet": snippet[:500],
            "relevance_score": round(relevance, 4),
            "query": query,
        })

    return results


def _score_relevance(
    query: str,
    title: str,
    snippet: str,
    url: str,
) -> float:
    """Score the relevance of a web result.

    Scoring:
    - Term overlap (0-0.5): Fraction of query terms found in title+snippet.
    - Domain preference (0-0.25): Bonus for preferred auditing domains.
    - Snippet quality (0-0.25): Length and specificity indicators.
    """
    score = 0.0

    # Term overlap (0-0.5)
    query_terms = set(re.findall(r"\b\w{3,}\b", query.lower()))
    combined = (title + " " + snippet).lower()
    if query_terms:
        matching = sum(1 for t in query_terms if t in combined)
        score += 0.5 * (matching / len(query_terms))

    # Domain preference (0-0.25)
    url_lower = url.lower()
    for domain in PREFERRED_DOMAINS:
        if domain in url_lower:
            score += 0.25
            break

    # Snippet quality (0-0.25)
    if len(snippet) > 100:
        score += 0.10
    if len(snippet) > 200:
        score += 0.05
    # ISA-specific terms boost
    isa_terms = ["isa", "audit", "assurance", "standard", "iaasb"]
    isa_count = sum(1 for t in isa_terms if t in combined)
    score += min(0.10, isa_count * 0.02)

    return min(1.0, score)


def _generate_analysis_hints(
    results: list[dict[str, Any]],
    queries: list[str],
) -> list[str]:
    """Generate high-level analysis hints from web search results.

    These hints help the agent understand what topics and standards
    are most relevant in current professional discourse.
    """
    if not results:
        return []

    hints: list[str] = []

    # Count ISA number mentions across all results
    isa_mentions: dict[str, int] = {}
    for r in results:
        text = r.get("title", "") + " " + r.get("snippet", "")
        for match in re.findall(r"ISA\s+(\d{3})", text, re.IGNORECASE):
            isa_mentions[match] = isa_mentions.get(match, 0) + 1

    if isa_mentions:
        top_isas = sorted(isa_mentions, key=lambda x: -isa_mentions[x])[:5]
        hints.append(
            f"Most referenced standards in web results: "
            + ", ".join(f"ISA {n} ({isa_mentions[n]}x)" for n in top_isas)
        )

    # Check for preferred domain presence
    preferred_count = sum(
        1 for r in results
        if any(d in r.get("url", "").lower() for d in PREFERRED_DOMAINS)
    )
    if preferred_count > 0:
        hints.append(
            f"{preferred_count}/{len(results)} results from authoritative "
            f"auditing sources (IFAC, IAASB, PCAOB, AICPA)."
        )

    # High-relevance results
    high_rel = [r for r in results if r.get("relevance_score", 0) >= 0.6]
    if high_rel:
        hints.append(
            f"{len(high_rel)} high-relevance results found. "
            f"Top: \"{high_rel[0].get('title', '')}\"."
        )

    return hints
