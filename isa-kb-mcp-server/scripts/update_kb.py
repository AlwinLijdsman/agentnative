"""Incremental knowledge base update script.

Compares a manifest hash of PDFs in data/raw/ with a stored manifest
and re-ingests only new or modified PDFs. Removes paragraphs for
deleted PDFs (cascading edge cleanup).

Usage::

    cd isa-kb-mcp-server
    python -m scripts.update_kb

    # Force full re-ingestion
    python -m scripts.update_kb --force

    # Debug mode
    python -m scripts.update_kb --debug
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import logging
import sys
from pathlib import Path

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"
MANIFEST_PATH = DATA_DIR / "duckdb" / "manifest.json"


def _file_hash(path: Path) -> str:
    """Compute SHA-256 hash of a file."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def _build_manifest(raw_dir: Path) -> dict[str, str]:
    """Build a manifest of {filename: sha256_hash} for all PDFs."""
    manifest: dict[str, str] = {}
    if raw_dir.exists():
        for pdf in sorted(raw_dir.glob("*.pdf")):
            manifest[pdf.name] = _file_hash(pdf)
    return manifest


def _load_manifest() -> dict[str, str]:
    """Load the stored manifest, or return empty dict."""
    if MANIFEST_PATH.exists():
        return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    return {}


def _save_manifest(manifest: dict[str, str]) -> None:
    """Save the manifest to disk."""
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2), encoding="utf-8")


async def _remove_standard(isa_number: str) -> int:
    """Remove all data for an ISA standard from DuckDB.

    Cascading cleanup: paragraphs, belongs_to, cites, hop_edge.

    Returns:
        Number of rows deleted.
    """
    import duckdb

    db_path = DATA_DIR / "duckdb" / "isa_kb.duckdb"
    conn = duckdb.connect(str(db_path))
    deleted = 0

    # Get paragraph IDs for this standard
    rows = conn.execute(
        "SELECT id FROM ISAParagraph WHERE isa_number = ?", [isa_number]
    ).fetchall()
    para_ids = [r[0] for r in rows]

    if para_ids:
        placeholders = ", ".join(["?"] * len(para_ids))

        # Delete hop_edges involving these paragraphs
        conn.execute(
            f"DELETE FROM hop_edge WHERE src_id IN ({placeholders}) "
            f"OR dst_id IN ({placeholders})",
            para_ids + para_ids,
        )

        # Delete cites edges
        conn.execute(
            f"DELETE FROM cites WHERE src_id IN ({placeholders}) "
            f"OR dst_id IN ({placeholders})",
            para_ids + para_ids,
        )

        # Delete belongs_to edges
        conn.execute(
            f"DELETE FROM belongs_to WHERE src_id IN ({placeholders})",
            para_ids,
        )

        # Delete paragraphs
        result = conn.execute(
            "DELETE FROM ISAParagraph WHERE isa_number = ?", [isa_number]
        )
        deleted = result.fetchone()[0] if result else len(para_ids)

    # Delete the standard itself
    conn.execute("DELETE FROM ISAStandard WHERE isa_number = ?", [isa_number])

    conn.close()
    logger.info("[REMOVE] Deleted ISA %s: %d paragraphs + edges", isa_number, deleted)
    return deleted


def _extract_isa_number(filename: str) -> str:
    """Extract ISA number from filename."""
    import re

    m = re.search(r"(\d{3})", filename)
    return m.group(1) if m else "000"


async def run_update(args: argparse.Namespace) -> dict:
    """Run the incremental update."""
    raw_dir = DATA_DIR / "raw"
    current = _build_manifest(raw_dir)
    stored = _load_manifest() if not args.force else {}

    # Diff
    new_files = [f for f in current if f not in stored]
    modified_files = [
        f for f in current if f in stored and current[f] != stored[f]
    ]
    deleted_files = [f for f in stored if f not in current]
    unchanged = [f for f in current if f in stored and current[f] == stored[f]]

    logger.info("[UPDATE] New: %d, Modified: %d, Deleted: %d, Unchanged: %d",
                len(new_files), len(modified_files), len(deleted_files), len(unchanged))

    to_ingest = new_files + modified_files

    # Remove deleted standards
    for filename in deleted_files:
        isa_num = _extract_isa_number(filename)
        await _remove_standard(isa_num)

    # Remove modified standards (will be re-ingested)
    for filename in modified_files:
        isa_num = _extract_isa_number(filename)
        await _remove_standard(isa_num)

    # Re-ingest only new/modified files (one at a time)
    if to_ingest:
        from scripts.ingest_isa import run_pipeline, parse_args

        summaries = []
        for filename in to_ingest:
            file_path = raw_dir / filename
            if not file_path.exists():
                logger.warning("[UPDATE] File no longer exists: %s", filename)
                continue
            ingest_argv = ["--input", str(file_path)]
            if args.debug:
                ingest_argv.append("--debug")
            ingest_args = parse_args(ingest_argv)
            file_summary = await run_pipeline(ingest_args)
            summaries.append({"file": filename, **file_summary})
        summary = {"files_ingested": len(summaries), "details": summaries}
    else:
        summary = {"message": "No files to ingest"}

    # Save updated manifest
    _save_manifest(current)

    return {
        "new": new_files,
        "modified": modified_files,
        "deleted": deleted_files,
        "unchanged": unchanged,
        "ingest_summary": summary,
    }


def main() -> None:
    """Entry point."""
    parser = argparse.ArgumentParser(
        description="Incremental knowledge base update.",
        prog="python -m scripts.update_kb",
    )
    parser.add_argument("--force", action="store_true", help="Force full re-ingestion.")
    parser.add_argument("--debug", action="store_true", help="Debug mode.")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose logging.")
    args = parser.parse_args()

    level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)-5s %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stderr,
        force=True,
    )

    result = asyncio.run(run_update(args))
    print(json.dumps(result, indent=2, default=str))


if __name__ == "__main__":
    main()
