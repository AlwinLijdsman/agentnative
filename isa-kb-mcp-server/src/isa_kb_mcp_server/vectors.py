"""LanceDB vector search and Voyage AI query embedding.

Provides:
- LanceDB table access for similarity search on pre-embedded ISA paragraphs.
- Voyage AI runtime embedding for query text (``input_type="query"``).
- Graceful fallback: if VOYAGE_API_KEY is not set, vector search is
  unavailable and hybrid search degrades to keyword-only mode.

The ``isa_chunks`` LanceDB table is created during ingestion
(``scripts/ingest_isa.py``). This module only reads from it at runtime.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

logger = logging.getLogger("isa_kb_mcp_server.vectors")

# ---------------------------------------------------------------------------
# Module state
# ---------------------------------------------------------------------------

_lancedb_db: Any = None
_voyage_client: Any = None
_voyage_available: bool = False


def _resolve_lancedb_path() -> Path:
    """Resolve the LanceDB data directory path."""
    env_path = os.environ.get("ISA_KB_LANCEDB_PATH")
    if env_path:
        return Path(env_path)

    package_dir = Path(__file__).resolve().parent
    project_root = package_dir.parent.parent
    return project_root / "data" / "lancedb"


def init_vectors() -> None:
    """Initialize LanceDB and Voyage AI connections.

    Called once on MCP server startup. Safe to call multiple times
    (subsequent calls are no-ops).
    """
    global _lancedb_db, _voyage_client, _voyage_available

    # LanceDB
    if _lancedb_db is None:
        lancedb_path = _resolve_lancedb_path()
        if not lancedb_path.exists():
            logger.warning(
                "LanceDB directory not found at %s. "
                "Vector search will be unavailable until ingestion is run.",
                lancedb_path,
            )
        else:
            try:
                import lancedb

                _lancedb_db = lancedb.connect(str(lancedb_path))
                logger.info("LanceDB connected: %s", lancedb_path)
            except Exception as exc:
                logger.error("Failed to connect to LanceDB: %s", exc)

    # Voyage AI
    if _voyage_client is None:
        api_key = os.environ.get("VOYAGE_API_KEY", "")
        if api_key:
            try:
                import voyageai

                _voyage_client = voyageai.Client(api_key=api_key)
                _voyage_available = True
                logger.info("Voyage AI client initialized (voyage-law-2)")
            except Exception as exc:
                logger.warning("Failed to initialize Voyage AI client: %s", exc)
                _voyage_available = False
        else:
            logger.warning(
                "VOYAGE_API_KEY not set. Vector search will be unavailable; "
                "hybrid search will fall back to keyword-only mode."
            )
            _voyage_available = False


def is_vector_search_available() -> bool:
    """Check if vector search is available (LanceDB + Voyage AI both ready)."""
    return _lancedb_db is not None and _voyage_available


def get_embedding(text: str) -> list[float] | None:
    """Compute a query embedding using Voyage AI voyage-law-2.

    Args:
        text: The query text to embed.

    Returns:
        A 1024-dimensional embedding vector, or None if Voyage AI
        is not available.

    Raises:
        Exception: On Voyage AI API errors (rate limits, auth, etc.).
    """
    if not _voyage_available or _voyage_client is None:
        logger.debug("Voyage AI not available, skipping embedding")
        return None

    result = _voyage_client.embed(
        texts=[text],
        model="voyage-law-2",
        input_type="query",
    )
    return result.embeddings[0]


def search_vectors(
    query_embedding: list[float],
    *,
    table_name: str = "isa_chunks",
    limit: int = 20,
    isa_filter: str | None = None,
) -> list[dict[str, Any]]:
    """Search LanceDB for similar vectors.

    Args:
        query_embedding: The query embedding vector (1024 dims).
        table_name: LanceDB table to search (default: ``isa_chunks``).
        limit: Maximum number of results.
        isa_filter: Optional ISA number filter (e.g., ``"315"``).

    Returns:
        List of result dicts with keys: ``id``, ``content``, ``isa_number``,
        ``paragraph_ref``, ``sub_paragraph``, ``application_ref``,
        ``page_number``, ``_distance``.
        Empty list if LanceDB is not available or table doesn't exist.
    """
    if _lancedb_db is None:
        logger.warning("LanceDB not available, returning empty results")
        return []

    try:
        table = _lancedb_db.open_table(table_name)
    except Exception as exc:
        logger.warning("LanceDB table '%s' not found: %s", table_name, exc)
        return []

    try:
        query = table.search(query_embedding).limit(limit)

        if isa_filter:
            query = query.where(f"isa_number = '{isa_filter}'")

        results = query.to_pandas()

        rows: list[dict[str, Any]] = []
        for _, row in results.iterrows():
            rows.append({
                "id": str(row.get("id", "")),
                "content": str(row.get("content", "")),
                "isa_number": str(row.get("isa_number", "")),
                "paragraph_ref": str(row.get("paragraph_ref", "")),
                "sub_paragraph": str(row.get("sub_paragraph", "")),
                "application_ref": str(row.get("application_ref", "")),
                "page_number": int(row.get("page_number", 0)),
                "_distance": float(row.get("_distance", 0.0)),
            })

        return rows

    except Exception as exc:
        logger.error("LanceDB search failed: %s", exc)
        return []


def close_vectors() -> None:
    """Clean up vector resources on shutdown."""
    global _lancedb_db, _voyage_client, _voyage_available

    _lancedb_db = None
    _voyage_client = None
    _voyage_available = False
    logger.info("Vector resources released")
