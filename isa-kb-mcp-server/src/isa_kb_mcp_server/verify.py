"""Verification tools for ISA Deep Research synthesis output.

Implements 4-axis verification:
1. ``isa_entity_verify`` — Entity grounding (do entities in synthesis exist
   in source paragraphs?)
2. ``isa_citation_verify`` — Citation accuracy (do cited paragraph IDs exist
   and does content support the claim?)
3. ``isa_relation_verify`` — Relation preservation (are cross-standard
   relationships preserved in the synthesis?)
4. ``isa_contradiction_check`` — Contradiction detection (do any cited
   paragraphs contradict each other?)

Each tool returns: ``{ score: float, passed: bool, details: [...] }``
"""

from __future__ import annotations

import logging
import re
from typing import Any

from isa_kb_mcp_server.db import execute_query

logger = logging.getLogger("isa_kb_mcp_server.verify")


# ---------------------------------------------------------------------------
# 1. Entity Grounding Verification
# ---------------------------------------------------------------------------


def entity_verify(
    entities: list[str],
    source_paragraph_ids: list[str],
) -> dict[str, Any]:
    """Check that entities mentioned in a synthesis exist in source paragraphs.

    An "entity" is any ISA-specific term the synthesis references — standard
    numbers, paragraph references, defined terms, etc. This tool checks each
    entity against the content of the provided source paragraphs.

    Args:
        entities: List of entity strings to verify (e.g.,
            ``["ISA 315", "risk assessment procedures", "315.12(a)"]``).
        source_paragraph_ids: List of paragraph IDs that were used as
            sources for the synthesis.

    Returns:
        Dict with ``score`` (0-1), ``passed`` (bool), and ``details``
        (per-entity grounding results).
    """
    if not entities:
        return {"score": 1.0, "passed": True, "details": [], "total_entities": 0}

    if not source_paragraph_ids:
        return {
            "score": 0.0,
            "passed": False,
            "details": [{"entity": e, "grounded": False, "reason": "no source paragraphs"} for e in entities],
            "total_entities": len(entities),
        }

    # Fetch content of source paragraphs
    placeholders = ", ".join(["?" for _ in source_paragraph_ids])
    rows = execute_query(
        f"SELECT id, content, paragraph_ref FROM ISAParagraph WHERE id IN ({placeholders})",
        source_paragraph_ids,
    )

    # Build a combined text corpus from source paragraphs
    source_texts: dict[str, str] = {}
    for row in rows:
        source_texts[row["id"]] = row.get("content", "").lower()

    combined_source = " ".join(source_texts.values())

    details: list[dict[str, Any]] = []
    grounded_count = 0

    for entity in entities:
        entity_lower = entity.lower().strip()

        # Check if entity appears in any source paragraph
        found_in: list[str] = []
        for pid, text in source_texts.items():
            if entity_lower in text:
                found_in.append(pid)

        # Also check for ISA reference patterns (e.g., "ISA 315" matches "ISA 315.12")
        is_grounded = len(found_in) > 0
        if not is_grounded:
            # Try fuzzy: strip "ISA" prefix and check numeric pattern
            stripped = re.sub(r"^isa\s*", "", entity_lower)
            if stripped in combined_source:
                is_grounded = True
                found_in = ["fuzzy_match"]

        if is_grounded:
            grounded_count += 1

        details.append({
            "entity": entity,
            "grounded": is_grounded,
            "found_in": found_in[:5],  # Cap to avoid huge output
        })

    score = grounded_count / len(entities) if entities else 1.0

    return {
        "score": round(score, 4),
        "passed": score >= 0.8,  # Default threshold
        "details": details,
        "total_entities": len(entities),
        "grounded_count": grounded_count,
    }


# ---------------------------------------------------------------------------
# 2. Citation Accuracy Verification
# ---------------------------------------------------------------------------


def citation_verify(
    citations: list[dict[str, str]],
) -> dict[str, Any]:
    """Verify that cited paragraph IDs exist and content supports claims.

    Each citation is a dict with ``paragraph_id`` (or ``paragraph_ref``)
    and ``claim`` — the text the synthesis attributes to that source.

    Args:
        citations: List of citation dicts, each with:
            - ``paragraph_id`` or ``paragraph_ref``: The cited source.
            - ``claim``: The claim attributed to this source.

    Returns:
        Dict with ``score`` (0-1), ``passed`` (bool), and ``details``
        (per-citation verification results).
    """
    if not citations:
        return {"score": 1.0, "passed": True, "details": [], "total_citations": 0}

    details: list[dict[str, Any]] = []
    verified_count = 0

    for citation in citations:
        pid = citation.get("paragraph_id", "")
        pref = citation.get("paragraph_ref", "")
        claim = citation.get("claim", "")

        # Look up the paragraph
        row = None
        if pid:
            rows = execute_query(
                "SELECT id, content, paragraph_ref FROM ISAParagraph WHERE id = ?",
                [pid],
            )
            if rows:
                row = rows[0]
        elif pref:
            # Try by paragraph_ref
            clean_ref = re.sub(r"^ISA\s*", "", pref, flags=re.IGNORECASE).strip()
            rows = execute_query(
                "SELECT id, content, paragraph_ref FROM ISAParagraph WHERE paragraph_ref = ?",
                [clean_ref],
            )
            if rows:
                row = rows[0]

        if row is None:
            details.append({
                "paragraph_id": pid or pref,
                "claim": claim[:200],
                "exists": False,
                "supports_claim": False,
                "reason": "paragraph not found in knowledge base",
            })
            continue

        # Check if the paragraph content supports the claim
        content = row.get("content", "").lower()
        claim_lower = claim.lower().strip()

        # Extract key terms from claim (words > 3 chars, skip stop words)
        stop_words = {"the", "and", "for", "that", "this", "with", "from", "are", "was", "were", "been", "have", "has", "not", "but", "can", "should", "shall", "may", "must"}
        claim_terms = [
            w for w in re.findall(r"\b\w{4,}\b", claim_lower)
            if w not in stop_words
        ]

        if not claim_terms:
            # Very short claim — just check existence
            details.append({
                "paragraph_id": row["id"],
                "paragraph_ref": row.get("paragraph_ref", ""),
                "claim": claim[:200],
                "exists": True,
                "supports_claim": True,
                "term_overlap": 1.0,
                "reason": "paragraph exists; claim too short for content analysis",
            })
            verified_count += 1
            continue

        # Term overlap scoring
        matching_terms = sum(1 for t in claim_terms if t in content)
        term_overlap = matching_terms / len(claim_terms) if claim_terms else 0

        supports = term_overlap >= 0.3  # At least 30% term overlap
        if supports:
            verified_count += 1

        details.append({
            "paragraph_id": row["id"],
            "paragraph_ref": row.get("paragraph_ref", ""),
            "claim": claim[:200],
            "exists": True,
            "supports_claim": supports,
            "term_overlap": round(term_overlap, 4),
            "matching_terms": matching_terms,
            "total_claim_terms": len(claim_terms),
        })

    score = verified_count / len(citations) if citations else 1.0

    return {
        "score": round(score, 4),
        "passed": score >= 0.75,
        "details": details,
        "total_citations": len(citations),
        "verified_count": verified_count,
    }


# ---------------------------------------------------------------------------
# 3. Relation Preservation Verification
# ---------------------------------------------------------------------------


def relation_verify(
    relations: list[dict[str, str]],
) -> dict[str, Any]:
    """Check that relationships between standards are preserved in synthesis.

    Verifies that cross-references and relationships claimed in the
    synthesis actually exist in the knowledge graph edge tables.

    Args:
        relations: List of relation dicts, each with:
            - ``source_paragraph``: Source paragraph ID or ref.
            - ``target_paragraph``: Target paragraph ID or ref.
            - ``relation_type``: Type of relationship (e.g., "cites",
              "cross_references", "requires").

    Returns:
        Dict with ``score`` (0-1), ``passed`` (bool), and ``details``.
    """
    if not relations:
        return {"score": 1.0, "passed": True, "details": [], "total_relations": 0}

    details: list[dict[str, Any]] = []
    preserved_count = 0

    for rel in relations:
        src = rel.get("source_paragraph", "")
        dst = rel.get("target_paragraph", "")
        rel_type = rel.get("relation_type", "")

        # Resolve IDs if references were given
        src_id = _resolve_paragraph_id(src)
        dst_id = _resolve_paragraph_id(dst)

        if not src_id or not dst_id:
            details.append({
                "source": src,
                "target": dst,
                "relation_type": rel_type,
                "preserved": False,
                "reason": f"{'source' if not src_id else 'target'} paragraph not found",
            })
            continue

        # Check edge tables for the relationship
        edge_found = False

        # Check cites table
        cite_rows = execute_query(
            "SELECT id FROM cites WHERE src_id = ? AND dst_id = ?",
            [src_id, dst_id],
        )
        if cite_rows:
            edge_found = True

        # Check hop_edge table (broader)
        if not edge_found:
            hop_rows = execute_query(
                "SELECT id FROM hop_edge WHERE src_id = ? AND dst_id = ?",
                [src_id, dst_id],
            )
            if hop_rows:
                edge_found = True

        # Check reverse direction too (relationships may be bidirectional)
        if not edge_found:
            rev_rows = execute_query(
                "SELECT id FROM cites WHERE src_id = ? AND dst_id = ? "
                "UNION ALL "
                "SELECT id FROM hop_edge WHERE src_id = ? AND dst_id = ?",
                [dst_id, src_id, dst_id, src_id],
            )
            if rev_rows:
                edge_found = True

        # Also check if both paragraphs belong to the same standard (implicit relation)
        if not edge_found:
            same_std = execute_query(
                "SELECT 1 FROM ISAParagraph a JOIN ISAParagraph b "
                "ON a.isa_number = b.isa_number "
                "WHERE a.id = ? AND b.id = ?",
                [src_id, dst_id],
            )
            if same_std:
                edge_found = True

        if edge_found:
            preserved_count += 1

        details.append({
            "source": src,
            "source_id": src_id,
            "target": dst,
            "target_id": dst_id,
            "relation_type": rel_type,
            "preserved": edge_found,
        })

    score = preserved_count / len(relations) if relations else 1.0

    return {
        "score": round(score, 4),
        "passed": score >= 0.70,
        "details": details,
        "total_relations": len(relations),
        "preserved_count": preserved_count,
    }


# ---------------------------------------------------------------------------
# 4. Contradiction Detection
# ---------------------------------------------------------------------------


def contradiction_check(
    paragraph_ids: list[str],
    synthesis_claims: list[str] | None = None,
) -> dict[str, Any]:
    """Detect potential contradictions between cited paragraphs.

    Checks for contradictory language patterns between paragraphs that
    the synthesis cites together. Uses heuristic pattern matching for
    opposing requirements (e.g., "shall" vs "shall not", "required" vs
    "not required").

    Args:
        paragraph_ids: List of paragraph IDs used in the synthesis.
        synthesis_claims: Optional list of claim strings to cross-check
            against source content.

    Returns:
        Dict with ``score`` (count of contradictions — 0 is best),
        ``passed`` (bool), and ``details``.
    """
    if len(paragraph_ids) < 2:
        return {
            "contradiction_count": 0,
            "passed": True,
            "details": [],
            "total_pairs_checked": 0,
        }

    # Fetch all paragraph contents
    placeholders = ", ".join(["?" for _ in paragraph_ids])
    rows = execute_query(
        f"SELECT id, content, paragraph_ref, isa_number FROM ISAParagraph WHERE id IN ({placeholders})",
        paragraph_ids,
    )

    paragraphs: dict[str, dict[str, Any]] = {}
    for row in rows:
        paragraphs[row["id"]] = row

    # Contradiction patterns: pairs of opposing phrases
    CONTRADICTION_PATTERNS: list[tuple[str, str]] = [
        (r"\bshall\b", r"\bshall not\b"),
        (r"\bmust\b", r"\bmust not\b"),
        (r"\brequired\b", r"\bnot required\b"),
        (r"\bprohibited\b", r"\bpermitted\b"),
        (r"\bmandatory\b", r"\boptional\b"),
        (r"\balways\b", r"\bnever\b"),
    ]

    contradictions: list[dict[str, Any]] = []
    pairs_checked = 0

    # Check all pairs (but limit to avoid quadratic explosion on large sets)
    ids_list = list(paragraphs.keys())
    max_pairs = 100  # Safety limit
    pair_count = 0

    for i in range(len(ids_list)):
        for j in range(i + 1, len(ids_list)):
            if pair_count >= max_pairs:
                break
            pair_count += 1
            pairs_checked += 1

            p1 = paragraphs[ids_list[i]]
            p2 = paragraphs[ids_list[j]]
            c1 = p1.get("content", "").lower()
            c2 = p2.get("content", "").lower()

            for pos_pattern, neg_pattern in CONTRADICTION_PATTERNS:
                p1_has_pos = bool(re.search(pos_pattern, c1))
                p1_has_neg = bool(re.search(neg_pattern, c1))
                p2_has_pos = bool(re.search(pos_pattern, c2))
                p2_has_neg = bool(re.search(neg_pattern, c2))

                # Contradiction: one paragraph asserts X, the other negates X
                # on the same topic (same ISA number or cross-referenced)
                if (p1_has_pos and p2_has_neg) or (p1_has_neg and p2_has_pos):
                    # Only flag if they're about the same topic
                    same_isa = p1.get("isa_number") == p2.get("isa_number")
                    if same_isa:
                        contradictions.append({
                            "paragraph_1": {
                                "id": p1["id"],
                                "ref": p1.get("paragraph_ref", ""),
                                "excerpt": c1[:150],
                            },
                            "paragraph_2": {
                                "id": p2["id"],
                                "ref": p2.get("paragraph_ref", ""),
                                "excerpt": c2[:150],
                            },
                            "pattern": f"{pos_pattern} vs {neg_pattern}",
                            "severity": "potential",
                        })

    return {
        "contradiction_count": len(contradictions),
        "passed": len(contradictions) == 0,
        "details": contradictions,
        "total_pairs_checked": pairs_checked,
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _resolve_paragraph_id(identifier: str) -> str | None:
    """Resolve a paragraph ID or reference to an actual ID."""
    if not identifier:
        return None

    # Direct ID
    if identifier.startswith("ip_") or identifier.startswith("gs_"):
        rows = execute_query(
            "SELECT id FROM ISAParagraph WHERE id = ?",
            [identifier],
        )
        return rows[0]["id"] if rows else None

    # Reference lookup
    clean = re.sub(r"^ISA\s*", "", identifier, flags=re.IGNORECASE).strip()
    rows = execute_query(
        "SELECT id FROM ISAParagraph WHERE paragraph_ref = ?",
        [clean],
    )
    return rows[0]["id"] if rows else None
