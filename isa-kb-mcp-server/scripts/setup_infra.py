"""ISA Knowledge Base infrastructure setup script.

Creates data directories, verifies package installations, initializes DuckDB
with FTS and optional DuckPGQ extensions, applies the graph schema, and checks
environment variables.

Run from the isa-kb-mcp-server/ directory:
    cd isa-kb-mcp-server
    python -m scripts.setup_infra

Exit codes:
    0 - Setup complete
    1 - Critical failure (missing packages, DuckDB init failed)
"""

from __future__ import annotations

import importlib
import logging
import os
import sys
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(message)s",
    stream=sys.stderr,
)
logger = logging.getLogger(__name__)


# =========================================================================
# Directory setup
# =========================================================================

# Resolve paths relative to isa-kb-mcp-server/ (parent of scripts/)
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"

DIRECTORIES = [
    DATA_DIR / "raw",
    DATA_DIR / "duckdb",
    DATA_DIR / "lancedb",
    DATA_DIR / "extractions",
    DATA_DIR / "enrichment_cache",
    DATA_DIR / "fixtures" / "pdf_extractions",
    DATA_DIR / "fixtures" / "embeddings",
]


def create_directories() -> bool:
    """Create all required data directories.

    Returns:
        True if all directories were created/exist.
    """
    logger.info("[DIR] Creating data directories...")
    for d in DIRECTORIES:
        d.mkdir(parents=True, exist_ok=True)
        logger.info("  [OK] %s", d.relative_to(PROJECT_ROOT))
    return True


# =========================================================================
# Package verification
# =========================================================================

# (module_name, pip_package_name, required)
ISA_PACKAGES: list[tuple[str, str, bool]] = [
    ("duckdb", "duckdb", True),
    ("lancedb", "lancedb", True),
    ("voyageai", "voyageai", True),
    ("flashrank", "flashrank", False),
    ("sklearn", "scikit-learn", True),
    ("pandas", "pandas", True),
    ("pyarrow", "pyarrow", True),
    ("httpx", "httpx", True),
    ("trafilatura", "trafilatura", False),
    ("numpy", "numpy", True),
]


def verify_packages() -> tuple[bool, list[str]]:
    """Verify all ISA research packages can be imported.

    Returns:
        (all_required_ok, list_of_missing_package_names)
    """
    logger.info("\n[PKG] Verifying package imports...")
    missing: list[str] = []
    all_required_ok = True

    for module_name, pip_name, required in ISA_PACKAGES:
        try:
            importlib.import_module(module_name)
            logger.info("  [OK] %s", module_name)
        except ImportError:
            tag = "ERROR" if required else "WARN"
            logger.info("  [%s] %s (pip install %s)", tag, module_name, pip_name)
            missing.append(pip_name)
            if required:
                all_required_ok = False

    return all_required_ok, missing


# =========================================================================
# DuckDB initialization
# =========================================================================


def init_duckdb() -> tuple[bool, bool]:
    """Initialize DuckDB database with extensions and apply schema.

    Creates the database file, installs FTS core extension, attempts
    DuckPGQ community extension (non-blocking if unavailable), and
    applies the graph schema from schema.sql.

    Returns:
        (db_ok, duckpgq_available)
    """
    logger.info("\n[DB] Initializing DuckDB...")

    try:
        import duckdb
    except ImportError:
        logger.error("  [ERROR] duckdb not installed -- cannot initialize database")
        return False, False

    db_path = DATA_DIR / "duckdb" / "isa_kb.duckdb"
    logger.info("  [FILE] %s", db_path.relative_to(PROJECT_ROOT))

    try:
        conn = duckdb.connect(str(db_path))
    except Exception as e:
        logger.error("  [ERROR] Failed to create/open DuckDB: %s", e)
        return False, False

    # FTS core extension (required)
    try:
        conn.execute("INSTALL fts;")
        conn.execute("LOAD fts;")
        logger.info("  [OK] FTS extension loaded")
    except Exception:
        try:
            conn.execute("LOAD fts;")
            logger.info("  [OK] FTS extension loaded (already installed)")
        except Exception as e2:
            logger.error("  [ERROR] FTS extension failed: %s", e2)
            conn.close()
            return False, False

    # DuckPGQ community extension (optional)
    duckpgq_available = False
    try:
        conn.execute("INSTALL duckpgq FROM community;")
        conn.execute("LOAD duckpgq;")
        duckpgq_available = True
        logger.info("  [OK] DuckPGQ extension loaded")
    except Exception:
        try:
            conn.execute("LOAD duckpgq;")
            duckpgq_available = True
            logger.info("  [OK] DuckPGQ extension loaded (already installed)")
        except Exception:
            logger.info(
                "  [WARN] DuckPGQ unavailable -- graph queries will use "
                "pure-SQL fallbacks (JOINs/CTEs)"
            )

    # Apply graph schema
    schema_path = PROJECT_ROOT / "src" / "isa_kb_mcp_server" / "schema.sql"
    if schema_path.exists():
        schema_sql = schema_path.read_text(encoding="utf-8")
        conn.execute(schema_sql)
        logger.info("  [OK] Graph schema applied")
    else:
        logger.error("  [ERROR] Schema file not found: %s", schema_path)
        conn.close()
        return False, False

    # Create FTS index on ISAParagraph.content (if table has data)
    try:
        row_count = conn.execute("SELECT COUNT(*) FROM ISAParagraph").fetchone()
        if row_count and row_count[0] > 0:
            conn.execute(
                "PRAGMA create_fts_index('ISAParagraph', 'id', 'content', "
                "overwrite=1)"
            )
            logger.info("  [OK] FTS index created on ISAParagraph.content")
        else:
            logger.info(
                "  [INFO] ISAParagraph table empty -- FTS index will be "
                "created after ingestion"
            )
    except Exception as e:
        logger.info("  [WARN] FTS index creation deferred: %s", e)

    conn.close()
    logger.info("  [OK] DuckDB initialized")
    return True, duckpgq_available


# =========================================================================
# Environment variable checks
# =========================================================================

ENV_VARS: list[tuple[str, bool, str]] = [
    ("VOYAGE_API_KEY", True, "Embedding generation (voyage-law-2) -- ingestion + runtime"),
    ("BRAVE_API_KEY", False, "Web enrichment (Brave Search) -- optional"),
    (
        "AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT",
        False,
        "PDF extraction -- required for production ingestion",
    ),
    (
        "AZURE_DOCUMENT_INTELLIGENCE_KEY",
        False,
        "PDF extraction -- required for production ingestion",
    ),
]


def check_env_vars() -> bool:
    """Check required and optional environment variables.

    Returns:
        True if all required env vars are set.
    """
    logger.info("\n[ENV] Checking environment variables...")

    all_required_ok = True
    for var_name, required, description in ENV_VARS:
        value = os.environ.get(var_name)
        if value:
            masked = value[:4] + "..." + value[-4:] if len(value) > 10 else "***"
            logger.info("  [OK] %s = %s (%s)", var_name, masked, description)
        else:
            tag = "ERROR" if required else "WARN"
            logger.info("  [%s] %s not set (%s)", tag, var_name, description)
            if required:
                all_required_ok = False

    return all_required_ok


# =========================================================================
# Main entry point
# =========================================================================


def main() -> int:
    """Run the full infrastructure setup.

    Returns:
        Exit code (0 = success, 1 = critical failure).
    """
    logger.info("=" * 60)
    logger.info("ISA Knowledge Base -- Infrastructure Setup")
    logger.info("=" * 60)

    errors: list[str] = []

    # Step 1: Create directories
    create_directories()

    # Step 2: Verify packages
    pkgs_ok, missing = verify_packages()
    if not pkgs_ok:
        errors.append(
            f"Missing required packages: {', '.join(missing)}. "
            f"Run: pip install -e '.[dev]'"
        )

    # Step 3: Initialize DuckDB + apply schema
    if pkgs_ok:
        db_ok, duckpgq_available = init_duckdb()
        if not db_ok:
            errors.append("DuckDB initialization failed")
    else:
        logger.info("\n[DB] Skipping DuckDB init (missing packages)")
        db_ok = False
        duckpgq_available = False

    # Step 4: Check env vars
    env_ok = check_env_vars()
    if not env_ok:
        errors.append("Missing required environment variables (see above)")

    # Summary
    logger.info("\n" + "=" * 60)
    if errors:
        logger.info("[WARN] Setup completed with issues:")
        for err in errors:
            logger.info("  - %s", err)
        # Only fail on package errors -- env vars can be deferred
        if not pkgs_ok or not db_ok:
            logger.info("\n[ERROR] Setup failed -- fix issues above and re-run")
            return 1
        else:
            logger.info("\n[OK] Setup complete (non-critical warnings above)")
            return 0
    else:
        logger.info("[OK] Setup complete")
        logger.info(
            "  DuckPGQ: %s",
            "available" if duckpgq_available else "unavailable (using SQL fallbacks)",
        )
        return 0


if __name__ == "__main__":
    sys.exit(main())
