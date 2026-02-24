"""Paragraph and standard listing tools for the ISA Knowledge Base.

Implements:
- ``isa_list_standards`` — Returns all ISA standards with metadata.
- ``isa_get_paragraph`` — Returns a specific paragraph by ID or
  paragraph reference (e.g., ``"ISA 315.12(a)"``, ``"ip_a1b2c3d4"``).
"""

from __future__ import annotations

import logging
import re
from typing import Any

from isa_kb_mcp_server.db import execute_query

logger = logging.getLogger("isa_kb_mcp_server.paragraphs")


def list_standards() -> dict[str, Any]:
    """List all ISA standards in the knowledge base.

    Returns:
        Dict with keys:
        - ``standards``: List of standard dicts (id, isa_number, title,
          version, effective_date, paragraph_count).
        - ``total_standards``: Count of standards.
    """
    sql = """
        SELECT
            s.id,
            s.isa_number,
            s.title,
            s.version,
            s.effective_date,
            COUNT(p.id) AS paragraph_count
        FROM ISAStandard s
        LEFT JOIN ISAParagraph p ON p.isa_number = s.isa_number
        GROUP BY s.id, s.isa_number, s.title, s.version, s.effective_date
        ORDER BY s.isa_number
    """

    try:
        rows = execute_query(sql)
    except Exception as exc:
        logger.error("Failed to list standards: %s", exc)
        return {"standards": [], "total_standards": 0, "error": str(exc)}

    standards: list[dict[str, Any]] = []
    for row in rows:
        standards.append({
            "id": row["id"],
            "isa_number": row["isa_number"],
            "title": row.get("title", ""),
            "version": row.get("version", ""),
            "effective_date": row.get("effective_date", ""),
            "paragraph_count": int(row.get("paragraph_count", 0)),
        })

    logger.info("Listed %d standards", len(standards))

    return {
        "standards": standards,
        "total_standards": len(standards),
    }


def get_paragraph(
    identifier: str,
) -> dict[str, Any]:
    """Get a specific ISA paragraph by ID or paragraph reference.

    Supports two lookup modes:
    1. **By ID:** Direct lookup using the paragraph's primary key
       (e.g., ``"ip_a1b2c3d4"``).
    2. **By paragraph reference:** Fuzzy match against the ``paragraph_ref``
       column (e.g., ``"315.12"``, ``"315.12(a)"``, ``"ISA 315.12(a).A2"``).

    The reference parser handles common formats:
    - ``"315.12"`` → isa_number=315, para_num=12
    - ``"315.12(a)"`` → isa_number=315, para_num=12, sub_paragraph=a
    - ``"ISA 315.12(a).A2"`` → full match including application ref
    - ``"315.A2"`` → application material lookup

    Args:
        identifier: Paragraph ID or reference string.

    Returns:
        Dict with keys:
        - ``paragraph``: The paragraph dict (or None if not found).
        - ``related``: List of directly related paragraphs (via edges).
        - ``found``: Boolean.
    """
    # Try direct ID lookup first
    if identifier.startswith("ip_") or identifier.startswith("gs_"):
        return _get_by_id(identifier)

    # Try paragraph reference parsing
    return _get_by_reference(identifier)


def _get_by_id(paragraph_id: str) -> dict[str, Any]:
    """Lookup a paragraph by its primary key ID."""
    rows = execute_query(
        """
        SELECT id, isa_number, para_num, sub_paragraph, application_ref,
               paragraph_ref, content, page_number, source_doc
        FROM ISAParagraph
        WHERE id = ?
        """,
        [paragraph_id],
    )

    if not rows:
        return {
            "paragraph": None,
            "related": [],
            "found": False,
            "error": f"Paragraph '{paragraph_id}' not found",
        }

    paragraph = _format_paragraph(rows[0])
    related = _get_related(paragraph_id)

    return {"paragraph": paragraph, "related": related, "found": True}


def _get_by_reference(reference: str) -> dict[str, Any]:
    """Lookup a paragraph by its reference string.

    Parses the reference and builds a query against paragraph_ref or
    the individual columns (isa_number, para_num, sub_paragraph, application_ref).
    """
    # Strip common prefixes
    ref = reference.strip()
    ref = re.sub(r"^ISA\s*", "", ref, flags=re.IGNORECASE)

    # Try exact match on paragraph_ref first
    rows = execute_query(
        """
        SELECT id, isa_number, para_num, sub_paragraph, application_ref,
               paragraph_ref, content, page_number, source_doc
        FROM ISAParagraph
        WHERE paragraph_ref = ?
        """,
        [ref],
    )

    if rows:
        paragraph = _format_paragraph(rows[0])
        related = _get_related(rows[0]["id"])
        return {"paragraph": paragraph, "related": related, "found": True}

    # Parse the reference into components
    # Pattern: {isa_number}.{para_num}({sub_paragraph}).A{app_ref}
    match = re.match(
        r"(\d{3})\.(\d+)(?:\(([a-z])\))?(?:\.A(\d+))?",
        ref,
    )

    if match:
        isa_number = match.group(1)
        para_num = match.group(2)
        sub_paragraph = match.group(3)  # may be None
        application_ref = match.group(4)  # may be None

        conditions: list[str] = ["isa_number = ?", "para_num = ?"]
        params: list[Any] = [isa_number, para_num]

        if sub_paragraph:
            conditions.append("sub_paragraph = ?")
            params.append(sub_paragraph)

        if application_ref:
            conditions.append("application_ref = ?")
            params.append(f"A{application_ref}")

        where = " AND ".join(conditions)
        rows = execute_query(
            f"""
            SELECT id, isa_number, para_num, sub_paragraph, application_ref,
                   paragraph_ref, content, page_number, source_doc
            FROM ISAParagraph
            WHERE {where}
            ORDER BY paragraph_ref
            """,
            params,
        )

        if rows:
            # Return first match, but include all matches if multiple
            paragraph = _format_paragraph(rows[0])
            related = _get_related(rows[0]["id"])

            result: dict[str, Any] = {
                "paragraph": paragraph,
                "related": related,
                "found": True,
            }
            if len(rows) > 1:
                result["additional_matches"] = [
                    _format_paragraph(r) for r in rows[1:]
                ]
            return result

    # Try application material lookup: {isa_number}.A{ref}
    app_match = re.match(r"(\d{3})\.A(\d+)", ref)
    if app_match:
        isa_number = app_match.group(1)
        app_ref = f"A{app_match.group(2)}"

        rows = execute_query(
            """
            SELECT id, isa_number, para_num, sub_paragraph, application_ref,
                   paragraph_ref, content, page_number, source_doc
            FROM ISAParagraph
            WHERE isa_number = ? AND application_ref = ?
            """,
            [isa_number, app_ref],
        )

        if rows:
            paragraph = _format_paragraph(rows[0])
            related = _get_related(rows[0]["id"])
            return {"paragraph": paragraph, "related": related, "found": True}

    # Nothing found
    logger.info("Paragraph not found for reference: %s", reference)
    return {
        "paragraph": None,
        "related": [],
        "found": False,
        "error": f"Paragraph '{reference}' not found",
        "hint": (
            "Try formats: '315.12', '315.12(a)', '315.12(a).A2', '315.A2', "
            "or a direct ID like 'ip_a1b2c3d4'."
        ),
    }


def _format_paragraph(row: dict[str, Any]) -> dict[str, Any]:
    """Format a raw DB row into a clean paragraph dict."""
    return {
        "id": row["id"],
        "isa_number": row.get("isa_number", ""),
        "para_num": row.get("para_num", ""),
        "sub_paragraph": row.get("sub_paragraph", ""),
        "application_ref": row.get("application_ref", ""),
        "paragraph_ref": row.get("paragraph_ref", ""),
        "content": row.get("content", ""),
        "page_number": row.get("page_number", 0),
        "source_doc": row.get("source_doc", ""),
    }


def _get_related(paragraph_id: str) -> list[dict[str, Any]]:
    """Get directly related paragraphs via edge tables.

    Looks up outgoing edges (cites, maps_to) and incoming edges
    (belongs_to) to find related content.
    """
    related: list[dict[str, Any]] = []

    # Outgoing citations
    try:
        cite_rows = execute_query(
            """
            SELECT p.id, p.paragraph_ref, p.isa_number, p.content,
                   c.citation_text, 'cites' AS relation
            FROM cites c
            JOIN ISAParagraph p ON c.dst_id = p.id
            WHERE c.src_id = ?
            """,
            [paragraph_id],
        )
        for row in cite_rows:
            related.append({
                "id": row["id"],
                "paragraph_ref": row.get("paragraph_ref", ""),
                "isa_number": row.get("isa_number", ""),
                "relation": "cites",
                "citation_text": row.get("citation_text", ""),
                "content_preview": (row.get("content", ""))[:200],
            })
    except Exception as exc:
        logger.warning("Failed to get citations for %s: %s", paragraph_id, exc)

    # Incoming citations (paragraphs that cite this one)
    try:
        cited_by_rows = execute_query(
            """
            SELECT p.id, p.paragraph_ref, p.isa_number, p.content,
                   c.citation_text, 'cited_by' AS relation
            FROM cites c
            JOIN ISAParagraph p ON c.src_id = p.id
            WHERE c.dst_id = ?
            """,
            [paragraph_id],
        )
        for row in cited_by_rows:
            related.append({
                "id": row["id"],
                "paragraph_ref": row.get("paragraph_ref", ""),
                "isa_number": row.get("isa_number", ""),
                "relation": "cited_by",
                "citation_text": row.get("citation_text", ""),
                "content_preview": (row.get("content", ""))[:200],
            })
    except Exception as exc:
        logger.warning("Failed to get cited_by for %s: %s", paragraph_id, exc)

    # Parent standard
    try:
        parent_rows = execute_query(
            """
            SELECT s.id, s.isa_number, s.title, 'belongs_to' AS relation
            FROM belongs_to b
            JOIN ISAStandard s ON b.dst_id = s.id
            WHERE b.src_id = ?
            """,
            [paragraph_id],
        )
        for row in parent_rows:
            related.append({
                "id": row["id"],
                "isa_number": row.get("isa_number", ""),
                "relation": "belongs_to",
                "title": row.get("title", ""),
            })
    except Exception as exc:
        logger.warning("Failed to get parent standard for %s: %s", paragraph_id, exc)

    return related
