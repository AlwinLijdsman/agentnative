"""CLI script for guide document ingestion into the ISA Knowledge Base.

Runs the full guide ingestion pipeline:
    extract PDF -> chunk into sections -> extract ISA references ->
    embed -> store in DuckDB + LanceDB -> create maps_to + hop_edge

Usage::

    # Debug mode (no API calls, uses fixtures, < 2 seconds)
    cd isa-kb-mcp-server
    python -m scripts.ingest_guides --input data/raw/guides/ --debug

    # Production (real API calls)
    python -m scripts.ingest_guides --input data/raw/guides/

    # Single file
    python -m scripts.ingest_guides --input data/raw/guides/ISA_LCE.pdf --debug

    # Skip enrichment and graph edges
    python -m scripts.ingest_guides --input data/raw/guides/ --skip-enrichment --skip-hoprag

    # Use cached extraction (from previous run)
    python -m scripts.ingest_guides --input data/raw/guides/ --use-cache
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import logging
import os
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Resolve paths relative to isa-kb-mcp-server/
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"

# Ensure src/ is importable
SRC_DIR = PROJECT_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))


# =========================================================================
# Dataclasses
# =========================================================================


@dataclass
class GuideSection:
    """A single section extracted from a guide document.

    Attributes:
        id: Unique identifier (gs_ prefix + hash).
        heading: Section heading / title.
        content: Section text content.
        embedding: voyage-law-2 embedding vector (1024-dim), or empty.
        source_doc: Name of the source PDF.
        isa_references: ISA standard references found in this section.
        page_start: First page of this section in the source PDF.
        page_end: Last page of this section in the source PDF.
        char_offset: Character offset of this section in the full text.
    """

    id: str = ""
    heading: str = ""
    content: str = ""
    embedding: list[float] = field(default_factory=list)
    source_doc: str = ""
    isa_references: list[str] = field(default_factory=list)
    page_start: int = 0
    page_end: int = 0
    char_offset: int = 0

    def __post_init__(self) -> None:
        if not self.id:
            self.id = _section_id(self.source_doc, self.heading, self.char_offset)

    @property
    def enriched_content(self) -> str:
        """Content used for embedding (plain content for now)."""
        return self.content


@dataclass
class ProcessedGuide:
    """Complete extraction result for one guide PDF."""

    source_path: Path = field(default_factory=lambda: Path("."))
    source_doc: str = ""
    sections: list[GuideSection] = field(default_factory=list)
    total_pages: int = 0

    def to_json(self, path: Path) -> None:
        """Persist to JSON file (without embeddings)."""
        path.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "source_path": str(self.source_path),
            "source_doc": self.source_doc,
            "total_pages": self.total_pages,
            "sections": [
                {
                    "id": s.id,
                    "heading": s.heading,
                    "content": s.content,
                    "source_doc": s.source_doc,
                    "isa_references": s.isa_references,
                    "page_start": s.page_start,
                    "page_end": s.page_end,
                    "char_offset": s.char_offset,
                }
                for s in self.sections
            ],
        }
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        logger.info("[FILE] Saved processed guide: %s", path.name)

    @classmethod
    def from_json(cls, path: Path) -> ProcessedGuide:
        """Load from a previously saved JSON file."""
        with open(path, encoding="utf-8") as f:
            data = json.load(f)

        sections = [
            GuideSection(
                id=s["id"],
                heading=s["heading"],
                content=s["content"],
                source_doc=s["source_doc"],
                isa_references=s.get("isa_references", []),
                page_start=s.get("page_start", 0),
                page_end=s.get("page_end", 0),
                char_offset=s.get("char_offset", 0),
            )
            for s in data.get("sections", [])
        ]
        return cls(
            source_path=Path(data.get("source_path", ".")),
            source_doc=data.get("source_doc", ""),
            sections=sections,
            total_pages=data.get("total_pages", 0),
        )


# =========================================================================
# Utility functions
# =========================================================================


def _section_id(source_doc: str, heading: str, char_offset: int = 0) -> str:
    """Generate a deterministic section ID with gs_ prefix."""
    raw = f"{source_doc}|{heading}|{char_offset}"
    h = hashlib.sha256(raw.encode()).hexdigest()[:8]
    return f"gs_{h}"


# ISA reference regex: matches ISA 315, ISA 315.12, ISA 315.12(a), ISA 315.12.A2
_ISA_REF_PATTERN = re.compile(
    r"ISA\s+(\d{3})(?:\.(\d+))?(?:\(([a-z])\))?(?:\.(A\d+))?"
)

# Heading detection patterns (common in audit guides)
_HEADING_PATTERNS = [
    re.compile(r"^#{1,6}\s+(.+)$", re.MULTILINE),
    re.compile(
        r"^(?:Chapter|Section|Part)\s+\d+[:.]\s*(.+)$",
        re.MULTILINE | re.IGNORECASE,
    ),
    re.compile(r"^\d+\.\d*\s+([A-Z].{5,80})$", re.MULTILINE),
]

_MIN_SECTION_LENGTH = 50
_MAX_SECTION_LENGTH = 3000


def extract_isa_references(text: str) -> list[str]:
    """Extract unique ISA references from text.

    Returns sorted list of unique ISA reference strings like
    "ISA 315.12(a)", "ISA 500".
    """
    refs: set[str] = set()
    for m in _ISA_REF_PATTERN.finditer(text):
        ref = f"ISA {m.group(1)}"
        if m.group(2):
            ref += f".{m.group(2)}"
        if m.group(3):
            ref += f"({m.group(3)})"
        if m.group(4):
            ref += f".{m.group(4)}"
        refs.add(ref)
    return sorted(refs)


def split_into_sections(
    text: str,
    source_doc: str,
) -> list[GuideSection]:
    """Split extracted text into sections based on heading detection.

    Strategy:
    1. Find all heading positions using regex patterns.
    2. Split text at heading boundaries.
    3. Skip short sections below MIN_SECTION_LENGTH.
    4. Force-split long sections at paragraph boundaries.
    """
    if not text or not text.strip():
        return []

    # Find heading positions
    headings: list[tuple[int, str]] = []
    for pattern in _HEADING_PATTERNS:
        for m in pattern.finditer(text):
            headings.append((m.start(), m.group(0).strip()))

    # Sort by position and deduplicate nearby headings
    headings.sort(key=lambda x: x[0])
    deduped: list[tuple[int, str]] = []
    for pos, heading in headings:
        if not deduped or pos - deduped[-1][0] > 20:
            deduped.append((pos, heading))
    headings = deduped

    # If no headings found, treat entire text as one section
    if not headings:
        return _split_long_text(text, source_doc, "Document Content", 0)

    # Split at heading boundaries
    raw_sections: list[GuideSection] = []

    # Text before first heading
    if headings[0][0] > _MIN_SECTION_LENGTH:
        pre_text = text[: headings[0][0]].strip()
        if len(pre_text) >= _MIN_SECTION_LENGTH:
            raw_sections.append(
                GuideSection(
                    heading="Introduction",
                    content=pre_text,
                    source_doc=source_doc,
                    char_offset=0,
                )
            )

    # Each heading's section
    for i, (pos, heading) in enumerate(headings):
        end = headings[i + 1][0] if i + 1 < len(headings) else len(text)
        content = text[pos:end].strip()

        # Remove the heading line from content start
        lines = content.split("\n", 1)
        body = lines[1].strip() if len(lines) > 1 else ""

        if len(body) < _MIN_SECTION_LENGTH:
            continue

        raw_sections.append(
            GuideSection(
                heading=heading,
                content=body,
                source_doc=source_doc,
                char_offset=pos,
                isa_references=extract_isa_references(body),
            )
        )

    # Force-split long sections
    final_sections: list[GuideSection] = []
    for section in raw_sections:
        if len(section.content) > _MAX_SECTION_LENGTH:
            final_sections.extend(
                _split_long_text(
                    section.content,
                    source_doc,
                    section.heading,
                    section.char_offset,
                )
            )
        else:
            final_sections.append(section)

    return final_sections


def _split_long_text(
    text: str,
    source_doc: str,
    heading: str,
    base_offset: int,
) -> list[GuideSection]:
    """Split a long text block at paragraph boundaries."""
    paragraphs = re.split(r"\n\n+", text)

    chunks: list[str] = []
    current: list[str] = []
    current_len = 0

    for para in paragraphs:
        para = para.strip()
        if not para:
            continue

        if current_len + len(para) > _MAX_SECTION_LENGTH and current:
            chunks.append("\n\n".join(current))
            current = [para]
            current_len = len(para)
        else:
            current.append(para)
            current_len += len(para)

    if current:
        chunks.append("\n\n".join(current))

    sections: list[GuideSection] = []
    offset = base_offset
    for i, chunk in enumerate(chunks):
        part_heading = f"{heading} (Part {i + 1})" if len(chunks) > 1 else heading
        sections.append(
            GuideSection(
                heading=part_heading,
                content=chunk,
                source_doc=source_doc,
                char_offset=offset,
                isa_references=extract_isa_references(chunk),
            )
        )
        offset += len(chunk) + 2
    return sections


# =========================================================================
# Stage 1: Extract
# =========================================================================


async def extract_guide_pdf(
    pdf_path: Path,
    *,
    debug: bool = False,
    cache_dir: Path | None = None,
) -> ProcessedGuide:
    """Extract text from a guide PDF and chunk into sections.

    In debug mode, returns fixture data without calling any API.
    """
    source_doc = pdf_path.stem

    # Check cache
    if cache_dir:
        cache_file = cache_dir / f"{source_doc}.json"
        if cache_file.exists():
            logger.info("  [CACHE] Using cached extraction: %s", cache_file.name)
            return ProcessedGuide.from_json(cache_file)

    if debug:
        return _generate_debug_fixture(pdf_path)

    return await _extract_with_azure(pdf_path, cache_dir)


def _generate_debug_fixture(pdf_path: Path) -> ProcessedGuide:
    """Generate fixture data for debug mode."""
    source_doc = pdf_path.stem
    logger.info("  [DEBUG] Generating fixture sections for %s", source_doc)

    sections: list[GuideSection] = []

    # Generate realistic guide sections with ISA references
    fixture_sections = [
        (
            "1.1 Introduction to the Standard",
            "This guide provides requirements for audits of less complex entities. "
            "It references ISA 200 and ISA 315 for foundational concepts. "
            "The auditor should apply professional judgment in accordance with "
            "ISA 200.15 when determining the nature of audit procedures.",
        ),
        (
            "2.1 Risk Assessment Procedures",
            "The auditor shall perform risk assessment procedures as described "
            "in ISA 315.12(a). These procedures include inquiries of management "
            "and other personnel, analytical procedures, and observation. "
            "See also ISA 315.5 for the requirement to understand the entity.",
        ),
        (
            "3.1 Materiality Considerations",
            "Performance materiality is determined in accordance with ISA 320.9. "
            "The auditor shall determine materiality for the financial statements "
            "as a whole, per ISA 320.10. For group audits, refer to ISA 600.",
        ),
        (
            "4.1 Audit Evidence",
            "The auditor shall design and perform audit procedures to obtain "
            "sufficient appropriate audit evidence (ISA 500.6). External "
            "confirmations may be used per ISA 505.7(a). The reliability of "
            "audit evidence is guided by ISA 500.A31.",
        ),
        (
            "5.1 Reporting",
            "The auditor shall form an opinion on the financial statements "
            "based on ISA 700. Key audit matters are communicated in accordance "
            "with ISA 701.8. Modified opinions follow ISA 705.6(a).",
        ),
    ]

    for i, (heading, content) in enumerate(fixture_sections):
        section = GuideSection(
            heading=heading,
            content=content,
            source_doc=source_doc,
            char_offset=i * 500,
            isa_references=extract_isa_references(content),
        )
        sections.append(section)

    return ProcessedGuide(
        source_path=pdf_path,
        source_doc=source_doc,
        sections=sections,
        total_pages=20,
    )


async def _extract_with_azure(
    pdf_path: Path,
    cache_dir: Path | None,
) -> ProcessedGuide:
    """Extract text from guide PDF using Azure Document Intelligence."""
    source_doc = pdf_path.stem

    endpoint = os.environ.get("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT", "")
    key = os.environ.get("AZURE_DOCUMENT_INTELLIGENCE_KEY", "")

    if not endpoint or not key:
        raise RuntimeError(
            "AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and _KEY must be set. "
            "Use --debug for fixture mode."
        )

    from azure.ai.documentintelligence import DocumentIntelligenceClient
    from azure.core.credentials import AzureKeyCredential

    client = DocumentIntelligenceClient(endpoint, AzureKeyCredential(key))

    with open(pdf_path, "rb") as f:
        poller = client.begin_analyze_document(
            "prebuilt-read", body=f, content_type="application/pdf"
        )

    result = poller.result()

    full_text = ""
    total_pages = 0
    if result.pages:
        total_pages = len(result.pages)
    if result.content:
        full_text = result.content

    sections = split_into_sections(full_text, source_doc)

    guide = ProcessedGuide(
        source_path=pdf_path,
        source_doc=source_doc,
        sections=sections,
        total_pages=total_pages,
    )

    # Cache the extraction
    if cache_dir:
        cache_dir.mkdir(parents=True, exist_ok=True)
        guide.to_json(cache_dir / f"{source_doc}.json")

    return guide


# =========================================================================
# Stage 2: Embed
# =========================================================================


async def embed_sections(
    sections: list[GuideSection],
    *,
    debug: bool = False,
    batch_size: int = 128,
) -> list[GuideSection]:
    """Compute embeddings for all sections using Voyage AI.

    In debug mode, generates deterministic fake vectors.
    """
    if debug:
        logger.info("[EMBED] Debug mode -- generating fake vectors")
        for section in sections:
            vec = [0.0] * 1024
            fingerprint = int(hashlib.sha256(section.id.encode()).hexdigest()[:8], 16)
            vec[0] = (fingerprint % 10000) / 10000.0
            section.embedding = vec
        return sections

    api_key = os.environ.get("VOYAGE_API_KEY", "")
    if not api_key:
        raise RuntimeError(
            "VOYAGE_API_KEY not set. Use --debug for fixture mode."
        )

    import voyageai

    client = voyageai.Client(api_key=api_key)

    texts = [s.enriched_content for s in sections]
    logger.info("[EMBED] Embedding %d sections (batch_size=%d)", len(texts), batch_size)

    all_embeddings: list[list[float]] = []
    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        retries = 0
        max_retries = 3

        while retries < max_retries:
            try:
                result = client.embed(
                    batch, model="voyage-law-2", input_type="document"
                )
                all_embeddings.extend(result.embeddings)
                break
            except Exception as e:
                retries += 1
                if retries >= max_retries:
                    raise RuntimeError(
                        f"Voyage AI embedding failed after {max_retries} retries: {e}"
                    ) from e
                wait = 2**retries
                logger.warning(
                    "[EMBED] Retry %d/%d after %.1fs: %s", retries, max_retries, wait, e
                )
                await asyncio.sleep(wait)

        logger.info(
            "[EMBED] Batch %d/%d complete",
            min(i + batch_size, len(texts)),
            len(texts),
        )

    for section, emb in zip(sections, all_embeddings):
        section.embedding = emb

    logger.info("[EMBED] All %d sections embedded", len(sections))
    return sections


# =========================================================================
# Stage 3: Store (DuckDB + LanceDB)
# =========================================================================


async def store_in_duckdb(
    sections: list[GuideSection],
    *,
    skip: bool = False,
) -> dict[str, int]:
    """Store guide sections in DuckDB GuideSection table.

    Returns dict with counts: { guide_sections }.
    """
    if skip:
        logger.info("[STORE-DUCK] Skipping DuckDB storage")
        return {"guide_sections": 0}

    import duckdb

    db_path = DATA_DIR / "duckdb" / "isa_kb.duckdb"
    conn = duckdb.connect(str(db_path))

    # Load schema if needed
    schema_path = PROJECT_ROOT / "src" / "isa_kb_mcp_server" / "schema.sql"
    if schema_path.exists():
        conn.execute(schema_path.read_text(encoding="utf-8"))

    count = 0
    for s in sections:
        enriched = getattr(s, "enriched_content", s.content)
        conn.execute(
            "INSERT OR REPLACE INTO GuideSection "
            "(id, heading, content, enriched_content, embedding, source_doc) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            [s.id, s.heading, s.content, enriched, s.embedding, s.source_doc],
        )
        count += 1

    # Create FTS index on GuideSection
    try:
        conn.execute(
            "PRAGMA create_fts_index('GuideSection', 'id', 'content', overwrite=1)"
        )
    except Exception as e:
        logger.warning("[STORE-DUCK] FTS index creation warning: %s", e)

    conn.close()
    logger.info("[STORE-DUCK] Stored %d guide sections", count)
    return {"guide_sections": count}


async def store_in_lancedb(
    sections: list[GuideSection],
    *,
    skip: bool = False,
) -> int:
    """Store section embeddings in LanceDB guides table.

    Creates or appends to the 'guides' table with schema:
        { id, vector[1024], content, heading, source_doc,
          isa_references, page_start, page_end }
    """
    if skip:
        logger.info("[STORE-LANCE] Skipping LanceDB storage")
        return 0

    import lancedb
    import pandas as pd

    lance_dir = DATA_DIR / "lancedb"
    db = lancedb.connect(str(lance_dir))

    records = []
    for s in sections:
        if not s.embedding:
            continue
        records.append({
            "id": s.id,
            "vector": s.embedding,
            "content": s.content,
            "heading": s.heading,
            "source_doc": s.source_doc,
            "isa_references": json.dumps(s.isa_references),
            "page_start": s.page_start,
            "page_end": s.page_end,
        })

    if not records:
        logger.info("[STORE-LANCE] No records to store (no embeddings)")
        return 0

    df = pd.DataFrame(records)

    # Create or append to table
    try:
        table = db.open_table("guides")
        table.add(df)
    except Exception:
        db.create_table("guides", df)

    # Create FTS index on content
    try:
        table = db.open_table("guides")
        table.create_fts_index("content", replace=True)
    except Exception as e:
        logger.warning("[STORE-LANCE] FTS index warning: %s", e)

    logger.info("[STORE-LANCE] Stored %d rows in guides", len(records))
    return len(records)


# =========================================================================
# Stage 4: Build maps_to and hop_edge
# =========================================================================


# Hop weight by ISA reference specificity (same weights as ingest_isa.py)
_WEIGHT_SUB_PARAGRAPH = 0.95
_WEIGHT_PARAGRAPH = 0.90
_WEIGHT_APP_MATERIAL = 0.85
_WEIGHT_STANDARD = 0.60


def _compute_hop_weight(isa_ref: str) -> float:
    """Compute edge weight based on ISA reference specificity."""
    if ".A" in isa_ref:
        return _WEIGHT_APP_MATERIAL
    if "(" in isa_ref:
        return _WEIGHT_SUB_PARAGRAPH
    if "." in isa_ref and any(c.isdigit() for c in isa_ref.split(".")[-1]):
        return _WEIGHT_PARAGRAPH
    return _WEIGHT_STANDARD


def _classify_hop_type(isa_ref: str) -> str:
    """Classify the hop type based on ISA reference."""
    if "(" in isa_ref:
        return "sub_paragraph"
    if ".A" in isa_ref:
        return "app_material"
    if "." in isa_ref:
        return "cross_ref"
    return "standard_ref"


def _resolve_isa_paragraph_id(conn: Any, isa_ref: str) -> str | None:
    """Resolve an ISA reference string to a paragraph ID in DuckDB.

    Tries exact paragraph_ref match, then partial matches.
    Returns the paragraph ID or None if not found.
    """
    # Strip "ISA " prefix
    ref = re.sub(r"^ISA\s*", "", isa_ref)

    # Try exact match on paragraph_ref
    rows = conn.execute(
        "SELECT id FROM ISAParagraph WHERE paragraph_ref = ?",
        [ref],
    ).fetchall()

    if rows:
        return rows[0][0]

    # Try matching by isa_number only (standard-level reference)
    isa_match = re.match(r"(\d{3})$", ref)
    if isa_match:
        # Standard-level reference - find any paragraph from this standard
        rows = conn.execute(
            "SELECT id FROM ISAParagraph WHERE isa_number = ? ORDER BY para_num LIMIT 1",
            [isa_match.group(1)],
        ).fetchall()
        if rows:
            return rows[0][0]

    return None


async def build_maps_to_edges(
    sections: list[GuideSection],
    *,
    skip: bool = False,
) -> dict[str, int]:
    """Create maps_to edges from guide sections to ISA paragraphs.

    For each guide section, resolves its ISA references to paragraph IDs
    and creates edges in the maps_to table.

    Returns dict with counts: { maps_to, unresolved }.
    """
    if skip:
        logger.info("[MAPS_TO] Skipping maps_to edge building")
        return {"maps_to": 0, "unresolved": 0}

    import duckdb

    db_path = DATA_DIR / "duckdb" / "isa_kb.duckdb"
    conn = duckdb.connect(str(db_path))

    maps_to_count = 0
    unresolved_count = 0

    for section in sections:
        for isa_ref in section.isa_references:
            dst_id = _resolve_isa_paragraph_id(conn, isa_ref)
            if dst_id is None:
                logger.debug(
                    "[MAPS_TO] Unresolved reference: %s -> %s",
                    section.id, isa_ref,
                )
                unresolved_count += 1
                continue

            edge_id = f"mt_{hashlib.sha256(f'{section.id}|{dst_id}'.encode()).hexdigest()[:8]}"
            conn.execute(
                "INSERT OR REPLACE INTO maps_to (id, src_id, dst_id) VALUES (?, ?, ?)",
                [edge_id, section.id, dst_id],
            )
            maps_to_count += 1

    conn.close()
    logger.info(
        "[MAPS_TO] Created %d maps_to edges (%d unresolved references)",
        maps_to_count, unresolved_count,
    )
    return {"maps_to": maps_to_count, "unresolved": unresolved_count}


async def build_hop_edges(
    sections: list[GuideSection],
    *,
    skip: bool = False,
) -> int:
    """Create hop_edge entries for guide-to-ISA connections.

    These edges enable HopRAG traversal from guide sections to
    ISA paragraphs and beyond.

    Returns number of hop edges created.
    """
    if skip:
        logger.info("[HOPRAG] Skipping hop edge building")
        return 0

    import duckdb

    db_path = DATA_DIR / "duckdb" / "isa_kb.duckdb"
    conn = duckdb.connect(str(db_path))

    count = 0
    for section in sections:
        for isa_ref in section.isa_references:
            dst_id = _resolve_isa_paragraph_id(conn, isa_ref)
            if dst_id is None:
                continue

            weight = _compute_hop_weight(isa_ref)
            hop_type = _classify_hop_type(isa_ref)
            query = f"{section.heading} {isa_ref}"

            edge_id = f"he_{hashlib.sha256(f'{section.id}{dst_id}{hop_type}'.encode()).hexdigest()[:8]}"
            conn.execute(
                "INSERT OR REPLACE INTO hop_edge "
                "(id, src_id, dst_id, weight, query, hop_type) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                [edge_id, section.id, dst_id, weight, query, hop_type],
            )
            count += 1

    conn.close()
    logger.info("[HOPRAG] Built %d hop edges from guide sections", count)
    return count


# =========================================================================
# CLI
# =========================================================================


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse CLI arguments."""
    parser = argparse.ArgumentParser(
        description="Ingest guide PDFs into the ISA Knowledge Base.",
        prog="python -m scripts.ingest_guides",
    )
    parser.add_argument(
        "--input", type=Path, required=True,
        help="Path to a guide PDF or a directory of guide PDFs.",
    )
    parser.add_argument(
        "--debug", action="store_true", default=False,
        help="Run in debug mode (use fixtures, no API calls).",
    )
    parser.add_argument(
        "--skip-enrichment", action="store_true", default=False,
        help="Skip web enrichment step (reserved for Phase 6).",
    )
    parser.add_argument(
        "--skip-store", action="store_true", default=False,
        help="Skip LanceDB/DuckDB storage.",
    )
    parser.add_argument(
        "--skip-hoprag", action="store_true", default=False,
        help="Skip HopRAG hop edge building.",
    )
    parser.add_argument(
        "--use-cache", action="store_true", default=False,
        help="Use cached extraction results if available.",
    )
    parser.add_argument(
        "--verbose", "-v", action="store_true", default=False,
        help="Enable verbose logging.",
    )
    return parser.parse_args(argv)


def collect_pdf_files(input_path: Path) -> list[Path]:
    """Collect PDF files from the input path."""
    if input_path.is_file() and input_path.suffix.lower() == ".pdf":
        return [input_path]

    if input_path.is_dir():
        pdfs = sorted(input_path.glob("*.pdf"))
        if not pdfs:
            logger.warning("[WARN] No PDF files found in %s", input_path)
        return pdfs

    logger.error("[ERROR] Input path does not exist: %s", input_path)
    return []


async def run_pipeline(args: argparse.Namespace) -> dict[str, Any]:
    """Run the full guide ingestion pipeline."""
    t_start = time.monotonic()

    pdfs = collect_pdf_files(args.input)
    if not pdfs:
        return {"error": "No PDF files found", "elapsed_s": 0}

    logger.info(
        "[START] Ingesting %d guide PDF(s) [%s mode]",
        len(pdfs), "debug" if args.debug else "production",
    )

    total_sections = 0
    total_lance = 0
    total_duck: dict[str, int] = {"guide_sections": 0}
    total_maps_to: dict[str, int] = {"maps_to": 0, "unresolved": 0}
    total_hop_edges = 0
    results = []

    cache_dir = DATA_DIR / "extractions" / "guides" if args.use_cache else None

    for pdf_path in pdfs:
        logger.info("[PDF] Processing: %s", pdf_path.name)

        # Stage 1: Extract + Chunk
        guide = await extract_guide_pdf(
            pdf_path, debug=args.debug, cache_dir=cache_dir,
        )
        sections = guide.sections
        logger.info(
            "[EXTRACT] %s: %d sections from %d pages",
            pdf_path.name, len(sections), guide.total_pages,
        )

        if not sections:
            logger.warning("[WARN] No sections extracted from %s", pdf_path.name)
            results.append({"file": pdf_path.name, "sections": 0, "status": "empty"})
            continue

        # Stage 2: Embed
        sections = await embed_sections(sections, debug=args.debug)

        # Stage 3: Store
        skip_store = args.skip_store
        duck_counts = await store_in_duckdb(sections, skip=skip_store)
        lance_count = await store_in_lancedb(sections, skip=skip_store)

        # Stage 4: Build graph edges
        maps_counts = await build_maps_to_edges(sections, skip=skip_store)
        hop_count = await build_hop_edges(
            sections, skip=skip_store or args.skip_hoprag,
        )

        total_sections += len(sections)
        total_lance += lance_count
        for k in total_duck:
            total_duck[k] += duck_counts.get(k, 0)
        for k in total_maps_to:
            total_maps_to[k] += maps_counts.get(k, 0)
        total_hop_edges += hop_count

        results.append({
            "file": pdf_path.name,
            "source_doc": guide.source_doc,
            "sections": len(sections),
            "isa_references": sum(len(s.isa_references) for s in sections),
            "lance_rows": lance_count,
            "duck_rows": duck_counts,
            "maps_to": maps_counts,
            "hop_edges": hop_count,
            "status": "ok",
        })

        logger.info(
            "[OK] %s: %d sections, %d ISA refs, maps_to=%d, hop_edges=%d",
            guide.source_doc, len(sections),
            sum(len(s.isa_references) for s in sections),
            maps_counts["maps_to"], hop_count,
        )

    elapsed = time.monotonic() - t_start
    summary = {
        "files_processed": len(pdfs),
        "total_sections": total_sections,
        "total_lance_rows": total_lance,
        "total_duck": total_duck,
        "total_maps_to": total_maps_to,
        "total_hop_edges": total_hop_edges,
        "elapsed_s": round(elapsed, 2),
        "mode": "debug" if args.debug else "production",
        "results": results,
    }

    logger.info(
        "[DONE] Ingested %d files (%d sections, %d maps_to, %d hop edges) in %.1fs [%s]",
        len(pdfs), total_sections, total_maps_to["maps_to"],
        total_hop_edges, elapsed, summary["mode"],
    )
    return summary


def main(argv: list[str] | None = None) -> None:
    """Entry point for the guide ingestion script."""
    args = parse_args(argv)

    level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)-5s %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stderr,
        force=True,
    )

    summary = asyncio.run(run_pipeline(args))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
