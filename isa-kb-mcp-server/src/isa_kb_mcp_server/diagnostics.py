"""Diagnostic tools for the ISA Knowledge Base.

Provides runtime health checks, hop trace debugging, and search
pipeline debugging for the ISA KB MCP server.
"""

from __future__ import annotations

import logging
from typing import Any

from isa_kb_mcp_server.db import execute_query, get_connection

logger = logging.getLogger("isa_kb_mcp_server.diagnostics")


def kb_status() -> dict[str, Any]:
    """Return KB health status including table counts and connection state.

    Returns:
        Dict with duckdb, lancedb, and API availability status.
    """
    status: dict[str, Any] = {
        "duckdb": {"connected": False, "tables": {}},
        "lancedb": {"connected": False, "tables": {}},
        "voyage_ai": {"available": False},
    }

    # DuckDB status
    try:
        conn = get_connection()
        status["duckdb"]["connected"] = True

        table_queries = {
            "GuideSection": "SELECT COUNT(*) AS cnt FROM GuideSection",
            "ISAStandard": "SELECT COUNT(*) AS cnt FROM ISAStandard",
            "ISAParagraph": "SELECT COUNT(*) AS cnt FROM ISAParagraph",
            "maps_to": "SELECT COUNT(*) AS cnt FROM maps_to",
            "belongs_to": "SELECT COUNT(*) AS cnt FROM belongs_to",
            "cites": "SELECT COUNT(*) AS cnt FROM cites",
            "hop_edge": "SELECT COUNT(*) AS cnt FROM hop_edge",
        }

        for table_name, sql in table_queries.items():
            try:
                rows = execute_query(sql)
                count = int(rows[0]["cnt"]) if rows else 0
                status["duckdb"]["tables"][table_name] = {"row_count": count}
            except Exception:
                status["duckdb"]["tables"][table_name] = {"row_count": 0, "error": "table not found"}

    except Exception as exc:
        logger.warning("DuckDB not available for diagnostics: %s", exc)

    # LanceDB status
    try:
        from isa_kb_mcp_server.vectors import _lancedb_db, _voyage_available

        if _lancedb_db is not None:
            status["lancedb"]["connected"] = True
            for table_name in ["isa_chunks", "guides"]:
                try:
                    table = _lancedb_db.open_table(table_name)
                    count = len(table)
                    status["lancedb"]["tables"][table_name] = {"vector_count": count}
                except Exception:
                    status["lancedb"]["tables"][table_name] = {"vector_count": 0, "error": "table not found"}

        status["voyage_ai"]["available"] = _voyage_available

    except Exception as exc:
        logger.warning("LanceDB status check failed: %s", exc)

    return status


def debug_hop_trace(
    start_id: str,
    *,
    max_hops: int = 3,
) -> dict[str, Any]:
    """Trace the full multi-hop path from a node.

    Shows every edge traversed, useful for debugging graph connectivity.

    Args:
        start_id: Starting node ID (gs_ for guide, ip_ for paragraph).
        max_hops: Maximum traversal depth.

    Returns:
        Dict with start_node, hops list, total_nodes_discovered, max_depth_reached.
    """
    # Determine node type and get info
    node_type = "GuideSection" if start_id.startswith("gs_") else "ISAParagraph"

    if node_type == "GuideSection":
        rows = execute_query(
            "SELECT id, heading AS label, content FROM GuideSection WHERE id = ?",
            [start_id],
        )
    else:
        rows = execute_query(
            "SELECT id, paragraph_ref AS label, content FROM ISAParagraph WHERE id = ?",
            [start_id],
        )

    if not rows:
        return {
            "start_node": {"id": start_id, "type": node_type, "error": "not found"},
            "hops": [],
            "total_nodes_discovered": 0,
            "max_depth_reached": 0,
        }

    start_node = {
        "id": start_id,
        "type": node_type,
        "label": rows[0].get("label", ""),
        "content_preview": (rows[0].get("content", ""))[:200],
    }

    hops: list[dict[str, Any]] = []
    discovered: set[str] = {start_id}

    # Trace maps_to edges (guide -> ISA)
    if node_type == "GuideSection":
        mt_rows = execute_query(
            "SELECT m.id AS edge_id, m.dst_id, p.paragraph_ref, p.content "
            "FROM maps_to m JOIN ISAParagraph p ON m.dst_id = p.id "
            "WHERE m.src_id = ?",
            [start_id],
        )
        for row in mt_rows:
            dst_id = row["dst_id"]
            if dst_id not in discovered:
                discovered.add(dst_id)
                hops.append({
                    "depth": 1,
                    "edge_type": "maps_to",
                    "from_id": start_id,
                    "to_id": dst_id,
                    "target_label": row.get("paragraph_ref", ""),
                    "target_content_preview": (row.get("content", ""))[:200],
                })

    # Trace hop_edge (ISA -> ISA)
    frontier = [start_id] if node_type == "ISAParagraph" else [h["to_id"] for h in hops]
    current_depth = 1 if node_type == "GuideSection" else 0

    for _ in range(max_hops):
        if not frontier:
            break
        current_depth += 1
        next_frontier: list[str] = []

        for src_id in frontier:
            he_rows = execute_query(
                "SELECT h.dst_id, h.weight, h.hop_type, p.paragraph_ref, p.content "
                "FROM hop_edge h JOIN ISAParagraph p ON h.dst_id = p.id "
                "WHERE h.src_id = ?",
                [src_id],
            )
            for row in he_rows:
                dst_id = row["dst_id"]
                if dst_id not in discovered:
                    discovered.add(dst_id)
                    next_frontier.append(dst_id)
                    hops.append({
                        "depth": current_depth,
                        "edge_type": "hop_edge",
                        "from_id": src_id,
                        "to_id": dst_id,
                        "weight": round(float(row.get("weight", 1.0)), 4),
                        "hop_type": row.get("hop_type", ""),
                        "target_label": row.get("paragraph_ref", ""),
                        "target_content_preview": (row.get("content", ""))[:200],
                    })

        frontier = next_frontier

    max_depth = max((h["depth"] for h in hops), default=0)

    return {
        "start_node": start_node,
        "hops": hops,
        "total_nodes_discovered": len(discovered),
        "max_depth_reached": max_depth,
    }
