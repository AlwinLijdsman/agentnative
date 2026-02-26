"""XML context formatter for ISA Deep Research.

Implements ``isa_format_context`` — ports the XMLContextFormatter pattern
from the personalmcptools-nonprod pipeline. Takes retrieved paragraphs,
groups by role (primary/supporting/context), enforces a token budget,
and produces structured XML for synthesis.

Token estimation: 4 characters per token (conservative approximation).
"""

from __future__ import annotations

import logging
import re
from typing import Any
from xml.sax.saxutils import escape as xml_escape

logger = logging.getLogger("isa_kb_mcp_server.context")

# Approximate characters per token for budget enforcement
CHARS_PER_TOKEN = 4

# Role caps: max paragraphs per role group
ROLE_CAPS: dict[str, int] = {
    "primary": 999,      # Uncapped — primary results always included
    "supporting": 15,    # Cap per sub-query
    "context": 5,        # Cap per sub-query
}


def format_context(
    paragraphs: list[dict[str, Any]],
    query: str,
    *,
    max_tokens: int = 8000,
    roles: dict[str, str] | None = None,
    group_by_role: bool = True,
) -> dict[str, Any]:
    """Format retrieved paragraphs into structured XML for synthesis.

    Groups paragraphs by role, enforces token budget, and produces
    XML output with ranked results, source attribution, and metadata.

    When ``group_by_role`` is True (the default), the output XML is
    structured into ``<primary_isa>``, ``<supporting_isa>``, and
    ``<context_isa>`` sections with the token budget split 60/30/10
    across roles.

    Args:
        paragraphs: List of paragraph dicts (from ``isa_hybrid_search``
            or ``isa_hop_retrieve``). Each should have at least ``id``,
            ``content``, ``paragraph_ref``, ``isa_number``.
        query: The original search query.
        max_tokens: Token budget for the formatted output (default 8000).
        roles: Optional mapping of paragraph ID → role. Role is one of
            ``"primary"``, ``"supporting"``, ``"context"``.
            If not provided, all paragraphs are treated as primary.
        group_by_role: When True, produce role-grouped XML with
            ``<primary_isa>``, ``<supporting_isa>``, ``<context_isa>``
            wrapper elements and a 60/30/10 token budget split.
            When False, produce flat XML (legacy behavior).

    Returns:
        Dict with:
        - ``xml``: The formatted XML string.
        - ``included_count``: Number of paragraphs included.
        - ``excluded_count``: Number excluded due to budget.
        - ``total_tokens_estimated``: Estimated token count.
        - ``role_counts``: Paragraphs included per role (when group_by_role).
    """
    if not paragraphs:
        xml = (
            f'<search_results query="{xml_escape(query)}" '
            f'total_results="0" included_results="0" '
            f'token_budget="{max_tokens}">\n'
            f'  <no_results/>\n'
            f'</search_results>'
        )
        return {
            "xml": xml,
            "included_count": 0,
            "excluded_count": 0,
            "total_tokens_estimated": 0,
            "role_counts": {"primary": 0, "supporting": 0, "context": 0},
        }

    # Assign roles
    role_map = roles or {}
    grouped: dict[str, list[dict[str, Any]]] = {
        "primary": [],
        "supporting": [],
        "context": [],
    }

    for para in paragraphs:
        pid = para.get("id", "")
        role = role_map.get(pid, "primary")
        if role not in grouped:
            role = "primary"
        grouped[role].append(para)

    # Apply role caps
    for role, cap in ROLE_CAPS.items():
        if len(grouped[role]) > cap:
            grouped[role] = grouped[role][:cap]

    if group_by_role:
        return _format_role_grouped(grouped, query, max_tokens)
    else:
        return _format_flat(grouped, query, max_tokens, len(paragraphs))


def _format_flat(
    grouped: dict[str, list[dict[str, Any]]],
    query: str,
    max_tokens: int,
    total_paragraphs: int,
) -> dict[str, Any]:
    """Produce flat XML output (legacy behavior)."""
    # Build ordered list: primary first, then supporting, then context
    ordered: list[tuple[str, dict[str, Any]]] = []
    for role in ["primary", "supporting", "context"]:
        for para in grouped[role]:
            ordered.append((role, para))

    # Token budget enforcement
    max_chars = max_tokens * CHARS_PER_TOKEN
    header_chars = 200  # Approximate XML header/footer overhead
    available_chars = max_chars - header_chars

    included: list[tuple[int, str, dict[str, Any]]] = []
    chars_used = 0
    excluded_count = 0

    for rank_idx, (role, para) in enumerate(ordered):
        content = para.get("content", "")
        result_chars = len(content) + 200

        if chars_used + result_chars > available_chars:
            if len(included) == 0:
                included.append((rank_idx + 1, role, para))
                chars_used += result_chars
            else:
                excluded_count += 1
            continue

        included.append((rank_idx + 1, role, para))
        chars_used += result_chars

    # Build XML
    xml_parts: list[str] = []
    xml_parts.append(
        f'<search_results query="{xml_escape(query)}" '
        f'total_results="{total_paragraphs}" '
        f'included_results="{len(included)}" '
        f'token_budget="{max_tokens}">'
    )

    for rank, role, para in included:
        _append_result_xml(xml_parts, rank, role, para, indent="  ")

    if excluded_count > 0:
        xml_parts.append(f'  <out_of_scope_segments count="{excluded_count}"/>')

    xml_parts.append("</search_results>")
    xml = "\n".join(xml_parts)

    estimated_tokens = len(xml) // CHARS_PER_TOKEN
    role_counts = {r: sum(1 for _, ro, _ in included if ro == r) for r in ["primary", "supporting", "context"]}

    logger.info(
        "Context formatted (flat): %d/%d included, ~%d tokens, budget=%d",
        len(included), total_paragraphs, estimated_tokens, max_tokens,
    )

    return {
        "xml": xml,
        "included_count": len(included),
        "excluded_count": excluded_count,
        "total_tokens_estimated": estimated_tokens,
        "role_counts": role_counts,
    }


# Token budget split for role-grouped format
_ROLE_BUDGET_SPLIT: dict[str, float] = {
    "primary": 0.60,
    "supporting": 0.30,
    "context": 0.10,
}

# XML wrapper element names for role groups
_ROLE_XML_ELEMENTS: dict[str, str] = {
    "primary": "primary_isa",
    "supporting": "supporting_isa",
    "context": "context_isa",
}


def _format_role_grouped(
    grouped: dict[str, list[dict[str, Any]]],
    query: str,
    max_tokens: int,
) -> dict[str, Any]:
    """Produce role-grouped XML with <primary_isa>, <supporting_isa>, <context_isa> sections."""
    total_paragraphs = sum(len(v) for v in grouped.values())
    max_chars = max_tokens * CHARS_PER_TOKEN
    header_chars = 300  # Approximate XML header/footer/section overhead
    available_chars = max_chars - header_chars

    # Split budget across roles
    role_budgets: dict[str, int] = {}
    for role, fraction in _ROLE_BUDGET_SPLIT.items():
        role_budgets[role] = int(available_chars * fraction)

    # Fill each role group within its budget
    included_by_role: dict[str, list[tuple[int, dict[str, Any]]]] = {
        "primary": [],
        "supporting": [],
        "context": [],
    }
    excluded_count = 0
    global_rank = 0

    for role in ["primary", "supporting", "context"]:
        budget = role_budgets[role]
        chars_used = 0

        for para in grouped[role]:
            global_rank += 1
            content = para.get("content", "")
            result_chars = len(content) + 200

            if chars_used + result_chars > budget:
                # Always include at least 1 result per role (if available)
                if len(included_by_role[role]) == 0:
                    included_by_role[role].append((global_rank, para))
                    chars_used += result_chars
                else:
                    excluded_count += 1
                continue

            included_by_role[role].append((global_rank, para))
            chars_used += result_chars

    total_included = sum(len(v) for v in included_by_role.values())

    # Build role-grouped XML
    xml_parts: list[str] = []
    xml_parts.append(
        f'<search_results query="{xml_escape(query)}" '
        f'total_results="{total_paragraphs}" '
        f'included_results="{total_included}" '
        f'token_budget="{max_tokens}" '
        f'format="role_grouped">'
    )

    for role in ["primary", "supporting", "context"]:
        element = _ROLE_XML_ELEMENTS[role]
        role_items = included_by_role[role]
        budget_pct = int(_ROLE_BUDGET_SPLIT[role] * 100)

        xml_parts.append(
            f'  <{element} count="{len(role_items)}" '
            f'budget_pct="{budget_pct}">'
        )

        for rank, para in role_items:
            _append_result_xml(xml_parts, rank, role, para, indent="    ")

        xml_parts.append(f"  </{element}>")

    if excluded_count > 0:
        xml_parts.append(f'  <excluded_by_budget count="{excluded_count}"/>')

    xml_parts.append("</search_results>")
    xml = "\n".join(xml_parts)

    estimated_tokens = len(xml) // CHARS_PER_TOKEN
    role_counts = {r: len(included_by_role[r]) for r in ["primary", "supporting", "context"]}

    logger.info(
        "Context formatted (role-grouped): %d/%d included (P:%d S:%d C:%d), ~%d tokens, budget=%d",
        total_included, total_paragraphs,
        role_counts["primary"], role_counts["supporting"], role_counts["context"],
        estimated_tokens, max_tokens,
    )

    return {
        "xml": xml,
        "included_count": total_included,
        "excluded_count": excluded_count,
        "total_tokens_estimated": estimated_tokens,
        "role_counts": role_counts,
    }


def _append_result_xml(
    xml_parts: list[str],
    rank: int,
    role: str,
    para: dict[str, Any],
    *,
    indent: str = "  ",
) -> None:
    """Append XML elements for a single result to *xml_parts*."""
    content = para.get("content", "")
    confidence = para.get("confidence", para.get("rrf_score", para.get("hop_score", 0)))
    retrieval_path = para.get("retrieval_path", "unknown")
    tier = para.get("tier", 2)

    if tier == 1:
        # Guide section
        heading = para.get("heading", "")
        source_doc = para.get("source_doc", "")
        source_label = f"Guide: {heading}" if heading else f"Guide: {source_doc}"

        xml_parts.append(
            f'{indent}<result rank="{rank}" source="{xml_escape(source_label)}" '
            f'confidence="{confidence}" retrieval_path="{xml_escape(str(retrieval_path))}" '
            f'role="{role}" tier="1">'
        )
        xml_parts.append(f"{indent}  <content>{xml_escape(content)}</content>")
        xml_parts.append(
            f'{indent}  <source_text guide="{xml_escape(str(source_doc))}" '
            f'section="{xml_escape(str(heading))}"/>'
        )

        isa_refs = para.get("isa_references", [])
        if isa_refs:
            xml_parts.append(f"{indent}  <metadata>")
            xml_parts.append(f"{indent}    <isa_references>{xml_escape(', '.join(str(r) for r in isa_refs))}</isa_references>")
            xml_parts.append(f"{indent}  </metadata>")
    else:
        # ISA paragraph (default, tier 2)
        paragraph_ref = para.get("paragraph_ref", "")
        isa_number = para.get("isa_number", "")
        page_number = para.get("page_number", 0)
        sub_paragraph = para.get("sub_paragraph", "")
        application_ref = para.get("application_ref", "")

        source_label = f"ISA {isa_number}"
        if paragraph_ref:
            source_label = f"ISA {paragraph_ref}"

        xml_parts.append(
            f'{indent}<result rank="{rank}" source="{xml_escape(source_label)}" '
            f'confidence="{confidence}" retrieval_path="{xml_escape(str(retrieval_path))}" '
            f'role="{role}" tier="2">'
        )
        xml_parts.append(f"{indent}  <content>{xml_escape(content)}</content>")
        xml_parts.append(
            f'{indent}  <source_text standard="ISA {xml_escape(str(isa_number))}" '
            f'paragraph="{xml_escape(str(paragraph_ref))}" '
            f'page="{page_number}"/>'
        )

        cross_refs = _extract_cross_references(content, isa_number)
        if cross_refs:
            xml_parts.append(f"{indent}  <metadata>")
            xml_parts.append(f"{indent}    <cross_references>{xml_escape(', '.join(cross_refs))}</cross_references>")
            if sub_paragraph:
                xml_parts.append(f"{indent}    <sub_paragraph>{xml_escape(sub_paragraph)}</sub_paragraph>")
            if application_ref:
                xml_parts.append(f"{indent}    <application_ref>{xml_escape(application_ref)}</application_ref>")
            xml_parts.append(f"{indent}  </metadata>")

    xml_parts.append(f"{indent}</result>")


def _extract_cross_references(content: str, current_isa: str) -> list[str]:
    """Extract ISA cross-references from paragraph content.

    Looks for patterns like "ISA 315.12", "ISA 500", etc. and returns
    unique references excluding self-references.
    """
    # Match "ISA NNN" with optional paragraph numbers
    refs = re.findall(r"ISA\s+(\d{3})(?:\.(\d+))?", content, re.IGNORECASE)

    cross_refs: list[str] = []
    seen: set[str] = set()

    for isa_num, para_num in refs:
        if isa_num == str(current_isa):
            continue  # Skip self-references
        ref = f"ISA {isa_num}"
        if para_num:
            ref = f"ISA {isa_num}.{para_num}"
        if ref not in seen:
            seen.add(ref)
            cross_refs.append(ref)

    return cross_refs
