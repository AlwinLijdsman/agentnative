"""DuckDB connection management for the ISA Knowledge Base.

Provides a read-only connection pool with FTS extension pre-loaded.
All query functions go through `execute_query()` for consistent
error handling and logging.

Usage:
    from isa_kb_mcp_server.db import get_connection, execute_query, close_connection

    # Simple query
    rows = execute_query("SELECT * FROM ISAStandard WHERE isa_number = ?", ["315"])

    # Direct connection (for transactions or multiple queries)
    conn = get_connection()
    result = conn.execute("SELECT COUNT(*) FROM ISAParagraph").fetchone()
"""

from __future__ import annotations

import logging
import os
import threading
from pathlib import Path
from typing import Any

import duckdb

logger = logging.getLogger("isa_kb_mcp_server.db")

# ---------------------------------------------------------------------------
# Connection state (module-level singleton, thread-safe)
# ---------------------------------------------------------------------------

_lock = threading.Lock()
_connection: duckdb.DuckDBPyConnection | None = None


def _resolve_db_path() -> Path:
    """Resolve the DuckDB database file path.

    Checks ISA_KB_DB_PATH env var first, then falls back to the default
    location relative to the package root.
    """
    env_path = os.environ.get("ISA_KB_DB_PATH")
    if env_path:
        return Path(env_path)

    # Default: isa-kb-mcp-server/data/duckdb/isa_kb.duckdb
    # Package is at src/isa_kb_mcp_server/db.py -> project root is ../../..
    package_dir = Path(__file__).resolve().parent
    project_root = package_dir.parent.parent
    return project_root / "data" / "duckdb" / "isa_kb.duckdb"


def get_connection() -> duckdb.DuckDBPyConnection:
    """Get or create a DuckDB connection.

    The connection is opened in read-only mode for safety (the MCP server
    only queries — ingestion is done via scripts). FTS extension is loaded
    on first connect.

    Returns:
        A DuckDB connection handle.

    Raises:
        FileNotFoundError: If the database file does not exist.
        duckdb.IOException: If the database cannot be opened.
    """
    global _connection

    with _lock:
        if _connection is not None:
            return _connection

        db_path = _resolve_db_path()
        if not db_path.exists():
            raise FileNotFoundError(
                f"DuckDB database not found at {db_path}. "
                "Run 'python -m scripts.setup_infra && python -m scripts.ingest_isa' first."
            )

        logger.info("Opening DuckDB: %s (read-only)", db_path)
        _connection = duckdb.connect(str(db_path), read_only=True)

        # Load FTS extension for full-text search queries
        try:
            _connection.execute("LOAD fts;")
            logger.info("FTS extension loaded")
        except Exception as exc:
            logger.warning("FTS extension not available: %s", exc)

        return _connection


def execute_query(
    sql: str,
    params: list[Any] | None = None,
    *,
    fetch: str = "all",
) -> list[dict[str, Any]]:
    """Execute a read-only SQL query and return results as dicts.

    Args:
        sql: The SQL query string. Use ``?`` for parameter placeholders.
        params: Positional parameters for the query.
        fetch: One of ``"all"`` (default), ``"one"``, or ``"none"``.

    Returns:
        A list of dicts (column_name -> value). Empty list if no results.
        For ``fetch="one"``, returns a single-element list or empty list.
        For ``fetch="none"``, returns an empty list.

    Raises:
        duckdb.Error: On any DuckDB error (logged before re-raising).
    """
    conn = get_connection()

    try:
        if params:
            result = conn.execute(sql, params)
        else:
            result = conn.execute(sql)

        if fetch == "none":
            return []

        # Get column names from description
        columns = [desc[0] for desc in result.description] if result.description else []

        if fetch == "one":
            row = result.fetchone()
            if row is None:
                return []
            return [dict(zip(columns, row))]

        rows = result.fetchall()
        return [dict(zip(columns, row)) for row in rows]

    except duckdb.Error as exc:
        logger.error("DuckDB query failed: %s | SQL: %s | params: %s", exc, sql[:200], params)
        raise


def close_connection() -> None:
    """Close the DuckDB connection if open.

    Safe to call multiple times. Called on MCP server shutdown.
    """
    global _connection

    with _lock:
        if _connection is not None:
            try:
                _connection.close()
                logger.info("DuckDB connection closed")
            except Exception as exc:
                logger.warning("Error closing DuckDB connection: %s", exc)
            finally:
                _connection = None
