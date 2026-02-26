"""ISA-specific query expansion for improved retrieval.

Expands ISA audit acronyms to their full forms for better
BM25 keyword matching. Expansion is additive (original terms preserved).
"""

from __future__ import annotations

import logging
import re

logger = logging.getLogger("isa_kb_mcp_server.query_expand")

ISA_ACRONYMS: dict[str, str] = {
    "RA": "risk assessment",
    "ToC": "tests of controls",
    "RMM": "risk of material misstatement",
    "ROMM": "risk of material misstatement",
    "AM": "application material",
    "AP": "audit procedures",
    "TCWG": "those charged with governance",
    "KAM": "key audit matters",
    "LCE": "less complex entities",
    "GCM": "going concern matters",
    "SA": "substantive analytical procedures",
    "IT": "information technology",
    "ITGC": "IT general controls",
    "PM": "performance materiality",
    "FS": "financial statements",
    "ISA": "International Standard on Auditing",
    "IFAC": "International Federation of Accountants",
    "IAASB": "International Auditing and Assurance Standards Board",
    "PCAOB": "Public Company Accounting Oversight Board",
}


def expand_query(query: str) -> str:
    """Expand ISA acronyms in a query string.

    Tokenizes the query, checks each token against ISA_ACRONYMS,
    and appends expansions. Original terms are preserved.

    Args:
        query: The original query string.

    Returns:
        Query with acronym expansions appended.
    """
    tokens = re.findall(r'\b[A-Za-z]+\b', query)
    expansions: list[str] = []

    for token in tokens:
        if token in ISA_ACRONYMS:
            expansion = ISA_ACRONYMS[token]
            if expansion.lower() not in query.lower():
                expansions.append(expansion)
        elif token.upper() in ISA_ACRONYMS:
            expansion = ISA_ACRONYMS[token.upper()]
            if expansion.lower() not in query.lower():
                expansions.append(expansion)

    if expansions:
        expanded = f"{query} {' '.join(expansions)}"
        logger.debug("Query expanded: %r -> %r", query, expanded)
        return expanded

    return query


def expand_with_synonyms(query: str) -> list[str]:
    """Return query variants (original + expanded) for multi-query search.

    Args:
        query: The original query string.

    Returns:
        List of query variants: [original, expanded] (deduplicated).
    """
    expanded = expand_query(query)
    variants = [query]
    if expanded != query:
        variants.append(expanded)
    return variants
