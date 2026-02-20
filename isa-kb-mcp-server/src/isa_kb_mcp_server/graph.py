"""Graph traversal tools for the ISA Knowledge Base.

Implements:
- ``isa_hop_retrieve`` — Multi-hop traversal from a seed ISA paragraph
  via ``hop_edge`` table.
- ``guide_to_isa_hop`` — From a guide section, follow ``maps_to`` edges
  to ISA paragraphs, then optionally continue via ``hop_edge``.

Uses pure-SQL recursive CTEs (no DuckPGQ dependency) for maximum
compatibility on all platforms including Windows ARM64.
"""

from __future__ import annotations

import logging
from typing import Any

from isa_kb_mcp_server.db import execute_query

logger = logging.getLogger("isa_kb_mcp_server.graph")


def hop_retrieve(
    paragraph_id: str,
    *,
    max_hops: int = 3,
    decay: float = 0.7,
    min_score: float = 0.01,
    max_results: int = 30,
) -> dict[str, Any]:
    """Multi-hop graph traversal from a seed paragraph.

    Starting from ``paragraph_id``, recursively follows ``hop_edge``
    relationships up to ``max_hops`` deep. Each hop multiplies the
    accumulated score by ``decay * edge_weight``, pruning paths below
    ``min_score``.

    Args:
        paragraph_id: The starting paragraph ID (e.g., ``"ip_a1b2c3d4"``).
        max_hops: Maximum traversal depth (default 3).
        decay: Score decay factor per hop (default 0.7). Lower values
            favor closer paragraphs.
        min_score: Minimum accumulated score threshold (default 0.01).
            Paths below this are pruned.
        max_results: Maximum number of connected paragraphs to return.

    Returns:
        Dict with keys:
        - ``seed_id``: The starting paragraph ID.
        - ``connected``: List of connected paragraph dicts with
          ``hop_score``, ``hop_depth``, and ``hop_path``.
        - ``total_found``: Number of connected paragraphs found.
        - ``max_hops_used``: The configured max hops.
    """
    # Validate the seed paragraph exists
    seed_rows = execute_query(
        "SELECT id, paragraph_ref, isa_number FROM ISAParagraph WHERE id = ?",
        [paragraph_id],
    )
    if not seed_rows:
        return {
            "seed_id": paragraph_id,
            "connected": [],
            "total_found": 0,
            "max_hops_used": max_hops,
            "error": f"Paragraph '{paragraph_id}' not found",
        }

    # Recursive CTE for multi-hop traversal
    # - Starts from all edges where src_id = paragraph_id
    # - Each iteration joins the frontier with hop_edge to discover new nodes
    # - Cycle detection via list_contains(path, dst_id)
    # - Score pruning via min_score threshold
    sql = """
        WITH RECURSIVE hops AS (
            -- Base case: direct neighbors of the seed paragraph
            SELECT
                e.dst_id,
                e.weight AS score,
                list_value(e.src_id) AS path,
                1 AS depth,
                e.hop_type
            FROM hop_edge e
            WHERE e.src_id = ?

            UNION ALL

            -- Recursive case: extend paths by one hop
            SELECT
                e.dst_id,
                h.score * ? * e.weight AS score,
                list_append(h.path, e.src_id) AS path,
                h.depth + 1 AS depth,
                e.hop_type
            FROM hops h
            JOIN hop_edge e ON h.dst_id = e.src_id
            WHERE h.depth < ?
                AND NOT list_contains(h.path, e.dst_id)
                AND h.score * ? * e.weight >= ?
        )
        SELECT DISTINCT ON (p.id)
            p.id,
            p.isa_number,
            p.para_num,
            p.sub_paragraph,
            p.application_ref,
            p.paragraph_ref,
            p.content,
            p.page_number,
            p.source_doc,
            h.score AS hop_score,
            h.depth AS hop_depth,
            h.path AS hop_path,
            h.hop_type
        FROM hops h
        JOIN ISAParagraph p ON h.dst_id = p.id
        WHERE p.id != ?
        ORDER BY p.id, h.score DESC
    """

    params: list[Any] = [
        paragraph_id,   # Base case: src_id = ?
        decay,          # Recursive: score * ? * weight
        max_hops,       # Recursive: depth < ?
        decay,          # Recursive: score * ? * weight >= min
        min_score,      # Recursive: >= ?
        paragraph_id,   # Exclude seed from results
    ]

    try:
        rows = execute_query(sql, params)
    except Exception as exc:
        logger.error("Hop retrieve failed for %s: %s", paragraph_id, exc)
        return {
            "seed_id": paragraph_id,
            "connected": [],
            "total_found": 0,
            "max_hops_used": max_hops,
            "error": str(exc),
        }

    # Sort by score descending and limit
    rows.sort(key=lambda r: -float(r.get("hop_score", 0)))
    rows = rows[:max_results]

    # Format results
    connected: list[dict[str, Any]] = []
    for row in rows:
        connected.append({
            "id": row["id"],
            "paragraph_ref": row.get("paragraph_ref", ""),
            "content": row.get("content", ""),
            "isa_number": row.get("isa_number", ""),
            "sub_paragraph": row.get("sub_paragraph", ""),
            "application_ref": row.get("application_ref", ""),
            "page_number": row.get("page_number", 0),
            "source_doc": row.get("source_doc", ""),
            "hop_score": round(float(row.get("hop_score", 0)), 4),
            "hop_depth": int(row.get("hop_depth", 0)),
            "hop_path": row.get("hop_path", []),
            "hop_type": row.get("hop_type", ""),
        })

    logger.info(
        "Hop retrieve: seed=%s hops=%d found=%d",
        paragraph_id, max_hops, len(connected),
    )

    return {
        "seed_id": paragraph_id,
        "connected": connected,
        "total_found": len(connected),
        "max_hops_used": max_hops,
    }


def guide_to_isa_hop(
    guide_section_id: str,
    *,
    max_hops: int = 2,
    decay: float = 0.7,
    min_score: float = 0.01,
    max_results: int = 30,
) -> dict[str, Any]:
    """From a guide section, find connected ISA paragraphs.

    First follows ``maps_to`` edges from the guide section to directly
    referenced ISA paragraphs. Then optionally continues via ``hop_edge``
    for further ISA-to-ISA connections.

    Args:
        guide_section_id: The guide section ID (e.g., ``"gs_a1b2c3d4"``).
        max_hops: Maximum additional hops beyond maps_to (default 2).
        decay: Score decay per hop (default 0.7).
        min_score: Minimum score threshold (default 0.01).
        max_results: Maximum results (default 30).

    Returns:
        Dict with seed_id, direct_references (from maps_to),
        connected (from further hops), and total_found.
    """
    # Step 1: Get the guide section
    guide_rows = execute_query(
        "SELECT id, heading, content, source_doc FROM GuideSection WHERE id = ?",
        [guide_section_id],
    )
    if not guide_rows:
        return {
            "seed_id": guide_section_id,
            "guide_section": None,
            "direct_references": [],
            "connected": [],
            "total_found": 0,
            "error": f"Guide section '{guide_section_id}' not found",
        }

    guide = guide_rows[0]

    # Step 2: Follow maps_to edges to ISA paragraphs
    maps_to_sql = """
        SELECT
            p.id,
            p.isa_number,
            p.para_num,
            p.sub_paragraph,
            p.application_ref,
            p.paragraph_ref,
            p.content,
            p.page_number,
            p.source_doc
        FROM maps_to m
        JOIN ISAParagraph p ON m.dst_id = p.id
        WHERE m.src_id = ?
    """

    try:
        direct_rows = execute_query(maps_to_sql, [guide_section_id])
    except Exception as exc:
        logger.error("maps_to query failed for %s: %s", guide_section_id, exc)
        direct_rows = []

    direct_refs: list[dict[str, Any]] = []
    for row in direct_rows:
        direct_refs.append({
            "id": row["id"],
            "paragraph_ref": row.get("paragraph_ref", ""),
            "content": row.get("content", ""),
            "isa_number": row.get("isa_number", ""),
            "sub_paragraph": row.get("sub_paragraph", ""),
            "application_ref": row.get("application_ref", ""),
            "page_number": row.get("page_number", 0),
            "source_doc": row.get("source_doc", ""),
            "hop_depth": 0,
            "hop_path": [guide_section_id],
        })

    # Step 3: For each direct ISA paragraph, do further hop traversal
    further_connected: list[dict[str, Any]] = []
    seen_ids: set[str] = {r["id"] for r in direct_refs}

    if max_hops > 0:
        for ref in direct_refs:
            hop_result = hop_retrieve(
                ref["id"],
                max_hops=max_hops,
                decay=decay,
                min_score=min_score,
                max_results=max_results,
            )
            for conn in hop_result.get("connected", []):
                if conn["id"] not in seen_ids:
                    seen_ids.add(conn["id"])
                    # Adjust hop path to include guide section
                    conn["hop_path"] = [guide_section_id, ref["id"]] + conn.get("hop_path", [])
                    conn["hop_depth"] = conn.get("hop_depth", 0) + 1
                    further_connected.append(conn)

    # Sort further connected by score
    further_connected.sort(key=lambda r: -float(r.get("hop_score", 0)))
    further_connected = further_connected[:max_results]

    total = len(direct_refs) + len(further_connected)
    logger.info(
        "Guide-to-ISA hop: seed=%s direct=%d further=%d total=%d",
        guide_section_id, len(direct_refs), len(further_connected), total,
    )

    return {
        "seed_id": guide_section_id,
        "guide_section": {
            "id": guide["id"],
            "heading": guide.get("heading", ""),
            "source_doc": guide.get("source_doc", ""),
            "content_preview": (guide.get("content", ""))[:200],
        },
        "direct_references": direct_refs,
        "connected": further_connected,
        "total_found": total,
    }
