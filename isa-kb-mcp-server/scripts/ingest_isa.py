"""CLI script for ISA standard ingestion into the knowledge base.

Runs the full ISA ingestion pipeline:
    extract -> parse paragraphs -> enrich -> embed -> store -> build graph

Usage::

    # Debug mode (no API calls, uses fixtures, < 2 seconds)
    cd isa-kb-mcp-server
    python -m scripts.ingest_isa --input data/raw/ --debug

    # Production (real API calls)
    python -m scripts.ingest_isa --input data/raw/

    # Single file
    python -m scripts.ingest_isa --input data/raw/ISA_315.pdf --debug

    # Skip enrichment and graph
    python -m scripts.ingest_isa --input data/raw/ --skip-enrichment --skip-hoprag
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
# Dataclasses (ported from tier2_standards.py)
# =========================================================================


@dataclass
class ISAParagraph:
    """A single paragraph from an ISA standard.

    Supports the 4-level hierarchical numbering:
        standard_number.para_num(sub_paragraph).application_ref

    Examples:
        ISA 315.12      -> isa_number="315", para_num="12"
        ISA 505.6(a)    -> isa_number="505", para_num="6",  sub_paragraph="a"
        ISA 315.12.A2   -> isa_number="315", para_num="12", application_ref="A2"
    """

    id: str = ""
    isa_number: str = ""
    para_num: str = ""
    sub_paragraph: str = ""
    application_ref: str = ""
    paragraph_ref: str = ""
    content: str = ""
    embedding: list[float] = field(default_factory=list)
    page_number: int = 0
    source_doc: str = ""
    enrichment: dict[str, Any] = field(default_factory=dict)
    cross_references: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        if not self.paragraph_ref:
            self.paragraph_ref = _build_paragraph_ref(
                self.isa_number, self.para_num,
                self.sub_paragraph, self.application_ref,
            )
        if not self.id:
            self.id = _paragraph_id(self.isa_number, self.paragraph_ref)

    @property
    def enriched_content(self) -> str:
        """Content with web enrichment appended (used for embedding)."""
        if not self.enrichment:
            return self.content
        parts = [self.content]
        snippets = self.enrichment.get("snippets", [])
        if snippets:
            parts.append("\n\n[Practical context]")
            for s in snippets[:3]:
                parts.append(f"- {s}")
        notes = self.enrichment.get("application_notes", "")
        if notes:
            parts.append(f"\n[Application notes] {notes}")
        return "\n".join(parts)

    @property
    def full_reference(self) -> str:
        return f"ISA {self.paragraph_ref}"


@dataclass
class CrossReference:
    """A detected cross-reference between ISA paragraphs."""

    src_paragraph_ref: str = ""
    dst_paragraph_ref: str = ""
    citation_text: str = ""
    src_id: str = ""
    dst_id: str = ""


@dataclass
class ProcessedStandard:
    """Complete extraction result for one ISA standard PDF."""

    source_path: Path = field(default_factory=lambda: Path("."))
    source_doc: str = ""
    isa_number: str = ""
    title: str = ""
    paragraphs: list[ISAParagraph] = field(default_factory=list)
    cross_references: list[CrossReference] = field(default_factory=list)
    total_pages: int = 0


# =========================================================================
# Utility functions
# =========================================================================


def _build_paragraph_ref(
    isa_number: str, para_num: str, sub_paragraph: str = "", application_ref: str = ""
) -> str:
    """Build composite paragraph reference like 315.12(a).A2."""
    ref = f"{isa_number}.{para_num}"
    if sub_paragraph:
        ref += f"({sub_paragraph})"
    if application_ref:
        ref += f".{application_ref}"
    return ref


def _paragraph_id(isa_number: str, paragraph_ref: str) -> str:
    """Generate deterministic paragraph ID."""
    raw = f"ISA_{isa_number}|{paragraph_ref}"
    return f"ip_{hashlib.sha256(raw.encode()).hexdigest()[:8]}"


def _standard_id(isa_number: str) -> str:
    """Generate deterministic standard ID."""
    return f"is_{hashlib.sha256(f'ISA_{isa_number}'.encode()).hexdigest()[:8]}"


# ISA paragraph reference regex
# Matches: 315.12, 315.12(a), 315.12.A2, 315.12(a).A2
_PARA_REF_PATTERN = re.compile(
    r"(\d{3})\.\s*(\d+)(?:\(([a-z])\))?(?:\.A(\d+))?"
)

# ISA cross-reference detection (e.g., "ISA 315.12(a)", "ISA 500")
_CROSS_REF_PATTERN = re.compile(
    r"ISA\s+(\d{3})(?:\.(\d+)(?:\(([a-z])\))?(?:\.A(\d+))?)?"
)


# =========================================================================
# Stage 1: Extract
# =========================================================================


async def extract_isa_pdf(
    pdf_path: Path,
    *,
    debug: bool = False,
    cache_dir: Path | None = None,
) -> ProcessedStandard:
    """Extract text from an ISA PDF and parse into paragraphs.

    In debug mode, returns fixture data without calling any API.

    Args:
        pdf_path: Path to the ISA PDF file.
        debug: If True, use fixtures instead of Azure Document Intelligence.
        cache_dir: Directory to cache extraction results.

    Returns:
        ProcessedStandard with parsed paragraphs.
    """
    # Try to determine ISA number from filename
    name = pdf_path.stem
    isa_match = re.search(r"(\d{3})", name)
    isa_number = isa_match.group(1) if isa_match else "000"

    # Check cache
    if cache_dir:
        cache_file = cache_dir / f"{name}_extraction.json"
        if cache_file.exists():
            logger.info("  [CACHE] Using cached extraction: %s", cache_file.name)
            cached = json.loads(cache_file.read_text(encoding="utf-8"))
            return _parse_cached_extraction(cached, pdf_path, isa_number)

    if debug:
        # Debug mode: generate fixture paragraphs
        return _generate_debug_fixture(pdf_path, isa_number)

    # Production: call Azure Document Intelligence
    return await _extract_with_azure(pdf_path, isa_number, cache_dir)


def _generate_debug_fixture(pdf_path: Path, isa_number: str) -> ProcessedStandard:
    """Generate fixture data for debug mode."""
    logger.info("  [DEBUG] Generating fixture paragraphs for ISA %s", isa_number)

    paragraphs = []
    for i in range(1, 11):
        para = ISAParagraph(
            isa_number=isa_number,
            para_num=str(i),
            content=f"[Fixture] ISA {isa_number} paragraph {i}: "
            f"The auditor shall consider the requirements of this "
            f"standard in the context of the engagement.",
            page_number=i,
            source_doc=pdf_path.name,
        )
        paragraphs.append(para)

    # Add some application material
    for i in range(1, 4):
        para = ISAParagraph(
            isa_number=isa_number,
            para_num=str(i),
            application_ref=f"A{i}",
            content=f"[Fixture] ISA {isa_number}.{i}.A{i}: "
            f"Application material providing guidance on paragraph {i}.",
            page_number=i + 10,
            source_doc=pdf_path.name,
        )
        paragraphs.append(para)

    # Detect cross-references within fixture content
    cross_refs = _detect_cross_references(paragraphs)

    return ProcessedStandard(
        source_path=pdf_path,
        source_doc=pdf_path.name,
        isa_number=isa_number,
        title=f"ISA {isa_number} (Fixture)",
        paragraphs=paragraphs,
        cross_references=cross_refs,
        total_pages=15,
    )


def _parse_cached_extraction(
    cached: dict[str, Any], pdf_path: Path, isa_number: str
) -> ProcessedStandard:
    """Parse a cached extraction JSON into a ProcessedStandard."""
    paragraphs = []
    for p in cached.get("paragraphs", []):
        para = ISAParagraph(
            isa_number=p.get("isa_number", isa_number),
            para_num=p.get("para_num", ""),
            sub_paragraph=p.get("sub_paragraph", ""),
            application_ref=p.get("application_ref", ""),
            content=p.get("content", ""),
            page_number=p.get("page_number", 0),
            source_doc=pdf_path.name,
        )
        paragraphs.append(para)

    cross_refs = _detect_cross_references(paragraphs)

    return ProcessedStandard(
        source_path=pdf_path,
        source_doc=pdf_path.name,
        isa_number=isa_number,
        title=cached.get("title", f"ISA {isa_number}"),
        paragraphs=paragraphs,
        cross_references=cross_refs,
        total_pages=cached.get("total_pages", 0),
    )


async def _extract_with_azure(
    pdf_path: Path, isa_number: str, cache_dir: Path | None
) -> ProcessedStandard:
    """Extract text from PDF using Azure Document Intelligence.

    Uses the prebuilt-read model for text extraction.
    """
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

    # Parse extracted text into paragraphs
    full_text = ""
    total_pages = 0
    if result.pages:
        total_pages = len(result.pages)

    if result.content:
        full_text = result.content

    paragraphs = _parse_paragraphs_from_text(full_text, isa_number, pdf_path.name)
    cross_refs = _detect_cross_references(paragraphs)

    # Cache the extraction
    if cache_dir:
        cache_dir.mkdir(parents=True, exist_ok=True)
        cache_file = cache_dir / f"{pdf_path.stem}_extraction.json"
        cache_data = {
            "isa_number": isa_number,
            "title": f"ISA {isa_number}",
            "total_pages": total_pages,
            "paragraphs": [
                {
                    "isa_number": p.isa_number,
                    "para_num": p.para_num,
                    "sub_paragraph": p.sub_paragraph,
                    "application_ref": p.application_ref,
                    "content": p.content,
                    "page_number": p.page_number,
                }
                for p in paragraphs
            ],
        }
        cache_file.write_text(json.dumps(cache_data, indent=2), encoding="utf-8")
        logger.info("  [CACHE] Saved extraction to %s", cache_file.name)

    return ProcessedStandard(
        source_path=pdf_path,
        source_doc=pdf_path.name,
        isa_number=isa_number,
        title=f"ISA {isa_number}",
        paragraphs=paragraphs,
        cross_references=cross_refs,
        total_pages=total_pages,
    )


# =========================================================================
# Stage 2: Parse
# =========================================================================


def _parse_paragraphs_from_text(
    text: str, isa_number: str, source_doc: str
) -> list[ISAParagraph]:
    """Parse ISA paragraph references from extracted text.

    Splits text into paragraphs using the ISA numbering regex and
    handles long paragraphs by splitting at double-newline boundaries.
    """
    paragraphs: list[ISAParagraph] = []
    lines = text.split("\n")
    current_para: ISAParagraph | None = None
    current_lines: list[str] = []
    page_num = 1

    for line in lines:
        # Try to match a paragraph reference at start of line
        m = _PARA_REF_PATTERN.match(line.strip())
        if m and m.group(1) == isa_number:
            # Save previous paragraph
            if current_para and current_lines:
                current_para.content = "\n".join(current_lines).strip()
                if current_para.content:
                    _split_and_add(paragraphs, current_para, source_doc)

            # Start new paragraph
            current_para = ISAParagraph(
                isa_number=isa_number,
                para_num=m.group(2),
                sub_paragraph=m.group(3) or "",
                application_ref=f"A{m.group(4)}" if m.group(4) else "",
                page_number=page_num,
                source_doc=source_doc,
            )
            current_lines = [line]
        else:
            current_lines.append(line)

        # Simple page break detection
        if "\f" in line:
            page_num += 1

    # Save final paragraph
    if current_para and current_lines:
        current_para.content = "\n".join(current_lines).strip()
        if current_para.content:
            _split_and_add(paragraphs, current_para, source_doc)

    return paragraphs


def _split_and_add(
    paragraphs: list[ISAParagraph],
    para: ISAParagraph,
    source_doc: str,
    max_chars: int = 3000,
) -> None:
    """Split long paragraphs at double-newline boundaries."""
    if len(para.content) <= max_chars:
        paragraphs.append(para)
        return

    chunks = para.content.split("\n\n")
    for i, chunk in enumerate(chunks):
        chunk = chunk.strip()
        if not chunk:
            continue
        split_para = ISAParagraph(
            isa_number=para.isa_number,
            para_num=para.para_num,
            sub_paragraph=para.sub_paragraph,
            application_ref=para.application_ref,
            paragraph_ref=para.paragraph_ref + (f"_part{i+1}" if i > 0 else ""),
            content=chunk,
            page_number=para.page_number,
            source_doc=source_doc,
        )
        # Re-generate ID for split paragraphs
        if i > 0:
            split_para.id = _paragraph_id(
                split_para.isa_number, split_para.paragraph_ref
            )
        paragraphs.append(split_para)


def _detect_cross_references(paragraphs: list[ISAParagraph]) -> list[CrossReference]:
    """Detect cross-references within paragraph content.

    Scans each paragraph for patterns like "ISA 315.12(a)" and creates
    CrossReference objects linking the source paragraph to the referenced one.
    """
    cross_refs: list[CrossReference] = []
    para_by_ref: dict[str, ISAParagraph] = {p.paragraph_ref: p for p in paragraphs}

    for para in paragraphs:
        for m in _CROSS_REF_PATTERN.finditer(para.content):
            dst_isa = m.group(1)
            dst_para_num = m.group(2) or ""
            dst_sub = m.group(3) or ""
            dst_app = m.group(4) or ""

            if dst_para_num:
                dst_ref = _build_paragraph_ref(dst_isa, dst_para_num, dst_sub, dst_app)
            else:
                dst_ref = dst_isa  # Standard-level reference

            # Skip self-references
            if dst_ref == para.paragraph_ref:
                continue

            # Track cross-reference
            cr = CrossReference(
                src_paragraph_ref=para.paragraph_ref,
                dst_paragraph_ref=dst_ref,
                citation_text=m.group(0),
                src_id=para.id,
            )

            # Resolve destination ID if paragraph exists
            if dst_ref in para_by_ref:
                cr.dst_id = para_by_ref[dst_ref].id

            cross_refs.append(cr)
            para.cross_references.append(dst_ref)

    return cross_refs


# =========================================================================
# Stage 3: Enrich (optional, requires Brave API)
# =========================================================================


async def enrich_paragraphs(
    paragraphs: list[ISAParagraph],
    *,
    skip: bool = False,
    max_queries_per_standard: int = 5,
) -> list[ISAParagraph]:
    """Enrich paragraphs with web context from Brave Search.

    Focuses on requirement paragraphs (no application_ref) that would
    benefit from practical context.

    Args:
        paragraphs: List of parsed paragraphs.
        skip: If True, skip enrichment entirely.
        max_queries_per_standard: Max number of web queries per standard.

    Returns:
        The same list of paragraphs, with enrichment dicts populated.
    """
    if skip:
        logger.info("[ENRICH] Skipping web enrichment")
        return paragraphs

    api_key = os.environ.get("BRAVE_API_KEY", "")
    if not api_key:
        logger.info("[ENRICH] BRAVE_API_KEY not set -- skipping enrichment")
        return paragraphs

    import httpx

    cache_dir = DATA_DIR / "enrichment_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)

    # Only enrich requirement paragraphs (not application material)
    requirements = [p for p in paragraphs if not p.application_ref]
    enriched_count = 0

    for para in requirements[:max_queries_per_standard]:
        # Check cache
        query = f"ISA auditing {para.content[:200]}"
        cache_key = hashlib.sha256(query.encode()).hexdigest()[:12]
        cache_file = cache_dir / f"enrichment_{cache_key}.json"

        if cache_file.exists():
            cached = json.loads(cache_file.read_text(encoding="utf-8"))
            para.enrichment = cached
            enriched_count += 1
            continue

        # Call Brave Search
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    "https://api.search.brave.com/res/v1/web/search",
                    headers={
                        "Accept": "application/json",
                        "X-Subscription-Token": api_key,
                    },
                    params={"q": query, "count": "5"},
                )
                resp.raise_for_status()
                data = resp.json()

            results = data.get("web", {}).get("results", [])
            snippets = []
            for r in results:
                score = _score_relevance(r, para.content)
                if score >= 0.3:
                    snippets.append(r.get("description", ""))

            enrichment = {
                "query": query,
                "results_count": len(results),
                "snippets": snippets[:3],
                "application_notes": "",
            }

            para.enrichment = enrichment
            cache_file.write_text(json.dumps(enrichment, indent=2), encoding="utf-8")
            enriched_count += 1

        except Exception as e:
            logger.warning("[ENRICH] Brave Search failed for para %s: %s", para.id, e)

    logger.info("[ENRICH] Enriched %d/%d paragraphs", enriched_count, len(requirements))
    return paragraphs


def _score_relevance(result: dict[str, Any], content: str) -> float:
    """Score relevance of a Brave Search result.

    Scoring: term overlap (0-0.5) + domain preference (0-0.25)
    + snippet quality (0-0.25).
    """
    score = 0.0
    snippet = result.get("description", "").lower()
    content_lower = content[:200].lower()

    # Term overlap (0-0.5)
    content_words = set(content_lower.split())
    snippet_words = set(snippet.split())
    if content_words:
        overlap = len(content_words & snippet_words) / len(content_words)
        score += min(overlap, 0.5)

    # Domain preference (0-0.25)
    url = result.get("url", "").lower()
    preferred_domains = ["ifac.org", "iaasb.org", "pcaobus.org", "aicpa.org"]
    if any(d in url for d in preferred_domains):
        score += 0.25

    # Snippet quality (0-0.25)
    if len(snippet) > 50:
        score += 0.15
    if any(kw in snippet for kw in ["audit", "isa", "standard", "requirement"]):
        score += 0.10

    return score


# =========================================================================
# Stage 4: Embed
# =========================================================================


async def embed_paragraphs(
    paragraphs: list[ISAParagraph],
    *,
    debug: bool = False,
    batch_size: int = 128,
) -> list[ISAParagraph]:
    """Compute embeddings for all paragraphs using Voyage AI.

    In debug mode, generates deterministic fake vectors.

    Args:
        paragraphs: List of paragraphs (with enriched_content).
        debug: If True, generate fake vectors.
        batch_size: Number of texts per Voyage API call.

    Returns:
        Same list with embedding field populated.
    """
    if debug:
        logger.info("[EMBED] Debug mode -- generating fake vectors")
        for para in paragraphs:
            # Deterministic fake: all-zeros with dim-0 = hash fingerprint
            vec = [0.0] * 1024
            fingerprint = int(hashlib.sha256(para.id.encode()).hexdigest()[:8], 16)
            vec[0] = (fingerprint % 10000) / 10000.0
            para.embedding = vec
        return paragraphs

    api_key = os.environ.get("VOYAGE_API_KEY", "")
    if not api_key:
        raise RuntimeError(
            "VOYAGE_API_KEY not set. Use --debug for fixture mode."
        )

    import voyageai

    client = voyageai.Client(api_key=api_key)

    texts = [p.enriched_content for p in paragraphs]
    logger.info("[EMBED] Embedding %d paragraphs (batch_size=%d)", len(texts), batch_size)

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

    for para, emb in zip(paragraphs, all_embeddings):
        para.embedding = emb

    logger.info("[EMBED] All %d paragraphs embedded", len(paragraphs))
    return paragraphs


# =========================================================================
# Stage 5: Store (DuckDB + LanceDB)
# =========================================================================


async def store_in_duckdb(
    paragraphs: list[ISAParagraph],
    standard: ProcessedStandard,
    *,
    skip: bool = False,
    skip_edges: bool = False,
) -> dict[str, int]:
    """Store paragraphs, standard, and graph edges in DuckDB.

    Args:
        paragraphs: List of paragraphs to store.
        standard: Processed standard with cross-references.
        skip: If True, skip all DuckDB storage entirely.
        skip_edges: If True, skip edge insertion (belongs_to, cites) but still
            store paragraphs and standards. Used by --skip-graph flag.

    Returns:
        Dict with counts: { paragraphs, isa_standard, belongs_to, cites }.
    """
    if skip:
        logger.info("[STORE-DUCK] Skipping DuckDB storage")
        return {"paragraphs": 0, "isa_standard": 0, "belongs_to": 0, "cites": 0}

    import duckdb

    db_path = DATA_DIR / "duckdb" / "isa_kb.duckdb"
    conn = duckdb.connect(str(db_path))

    # Load schema if needed
    schema_path = PROJECT_ROOT / "src" / "isa_kb_mcp_server" / "schema.sql"
    if schema_path.exists():
        conn.execute(schema_path.read_text(encoding="utf-8"))

    counts: dict[str, int] = {"paragraphs": 0, "isa_standard": 0, "belongs_to": 0, "cites": 0}

    # Insert ISAStandard
    std_id = _standard_id(standard.isa_number)
    conn.execute(
        "INSERT OR REPLACE INTO ISAStandard (id, isa_number, title) VALUES (?, ?, ?)",
        [std_id, standard.isa_number, standard.title],
    )
    counts["isa_standard"] = 1

    # Insert ISAParagraphs
    for para in paragraphs:
        conn.execute(
            "INSERT OR REPLACE INTO ISAParagraph "
            "(id, isa_number, para_num, sub_paragraph, application_ref, "
            "paragraph_ref, content, embedding, page_number, source_doc) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                para.id, para.isa_number, para.para_num, para.sub_paragraph,
                para.application_ref, para.paragraph_ref, para.content,
                para.embedding, para.page_number, para.source_doc,
            ],
        )
        counts["paragraphs"] += 1

    # Insert belongs_to edges (skip if --skip-graph)
    if not skip_edges:
        for para in paragraphs:
            edge_id = f"bt_{hashlib.sha256(f'{para.id}|{std_id}'.encode()).hexdigest()[:8]}"
            conn.execute(
                "INSERT OR REPLACE INTO belongs_to (id, src_id, dst_id) VALUES (?, ?, ?)",
                [edge_id, para.id, std_id],
            )
            counts["belongs_to"] += 1

        # Insert cites edges from cross-references
        for cr in standard.cross_references:
            if cr.src_id and cr.dst_id:
                edge_id = f"ct_{hashlib.sha256(f'{cr.src_id}|{cr.dst_id}'.encode()).hexdigest()[:8]}"
                conn.execute(
                    "INSERT OR REPLACE INTO cites (id, src_id, dst_id, citation_text) "
                    "VALUES (?, ?, ?, ?)",
                    [edge_id, cr.src_id, cr.dst_id, cr.citation_text],
                )
                counts["cites"] += 1
    else:
        logger.info("[STORE-DUCK] Skipping graph edges (--skip-graph)")

    # Create FTS index (overwrite to include new data)
    try:
        conn.execute(
            "PRAGMA create_fts_index('ISAParagraph', 'id', 'content', overwrite=1)"
        )
    except Exception as e:
        logger.warning("[STORE-DUCK] FTS index creation warning: %s", e)

    conn.close()
    logger.info(
        "[STORE-DUCK] Stored: %d paragraphs, %d belongs_to, %d cites",
        counts["paragraphs"], counts["belongs_to"], counts["cites"],
    )
    return counts


async def store_in_lancedb(
    paragraphs: list[ISAParagraph],
    *,
    skip: bool = False,
) -> int:
    """Store paragraph embeddings in LanceDB.

    Creates or appends to the 'isa_chunks' table with schema:
        { id, vector[1024], content, isa_number, paragraph_ref,
          sub_paragraph, application_ref, page_number }

    Returns:
        Number of rows inserted.
    """
    if skip:
        logger.info("[STORE-LANCE] Skipping LanceDB storage")
        return 0

    import lancedb
    import pyarrow as pa

    lance_dir = DATA_DIR / "lancedb"
    db = lancedb.connect(str(lance_dir))

    # Build records
    records = []
    for para in paragraphs:
        if not para.embedding:
            continue
        records.append({
            "id": para.id,
            "vector": para.embedding,
            "content": para.content,
            "isa_number": para.isa_number,
            "paragraph_ref": para.paragraph_ref,
            "sub_paragraph": para.sub_paragraph or "",
            "application_ref": para.application_ref or "",
            "page_number": para.page_number,
        })

    if not records:
        logger.info("[STORE-LANCE] No records to store (no embeddings)")
        return 0

    import pandas as pd

    df = pd.DataFrame(records)

    # Create or append to table
    try:
        table = db.open_table("isa_chunks")
        table.add(df)
    except Exception:
        db.create_table("isa_chunks", df)

    # Create FTS index on content
    try:
        table = db.open_table("isa_chunks")
        table.create_fts_index("content", replace=True)
    except Exception as e:
        logger.warning("[STORE-LANCE] FTS index warning: %s", e)

    logger.info("[STORE-LANCE] Stored %d rows in isa_chunks", len(records))
    return len(records)


# =========================================================================
# Stage 6: Build HopRAG Graph
# =========================================================================

# Weight by reference specificity (ported from hoprag.py)
_WEIGHT_SUB_PARAGRAPH = 0.95
_WEIGHT_PARAGRAPH = 0.90
_WEIGHT_APP_MATERIAL = 0.85
_WEIGHT_STANDARD = 0.60


def _compute_hop_weight(dst_ref: str) -> float:
    """Compute edge weight based on reference specificity."""
    if not dst_ref:
        return _WEIGHT_STANDARD

    parts = dst_ref.split(".")
    has_app = any(p.startswith("A") and len(p) > 1 and p[1:].isdigit() for p in parts)
    has_sub = "(" in dst_ref

    if has_sub:
        return _WEIGHT_SUB_PARAGRAPH
    if has_app:
        return _WEIGHT_APP_MATERIAL
    if len(parts) >= 2 and parts[1].isdigit():
        return _WEIGHT_PARAGRAPH
    return _WEIGHT_STANDARD


def _classify_hop_type(dst_ref: str) -> str:
    """Classify the hop type based on reference."""
    if "(" in dst_ref:
        return "sub_paragraph"
    parts = dst_ref.split(".")
    has_app = any(p.startswith("A") and len(p) > 1 and p[1:].isdigit() for p in parts)
    if has_app:
        return "app_material"
    if "." in dst_ref:
        return "cross_ref"
    return "standard_ref"


async def build_hoprag_edges(
    paragraphs: list[ISAParagraph],
    cross_refs: list[CrossReference],
    *,
    skip: bool = False,
) -> int:
    """Build hop_edge rows from cross-references.

    Each cross-reference produces a directed edge with specificity-based
    weight and a pseudo-query derived from citation context.

    Returns:
        Number of hop edges created.
    """
    if skip:
        logger.info("[HOPRAG] Skipping HopRAG edge building")
        return 0

    if not cross_refs:
        logger.info("[HOPRAG] No cross-references to index")
        return 0

    import duckdb

    db_path = DATA_DIR / "duckdb" / "isa_kb.duckdb"
    conn = duckdb.connect(str(db_path))

    para_lookup = {p.id: p for p in paragraphs}
    count = 0

    for cr in cross_refs:
        if not cr.src_id or not cr.dst_id:
            continue

        weight = _compute_hop_weight(cr.dst_paragraph_ref)
        hop_type = _classify_hop_type(cr.dst_paragraph_ref)

        # Pseudo-query from citation context
        if cr.citation_text:
            query = cr.citation_text
        else:
            src_content = para_lookup.get(cr.src_id, ISAParagraph()).content[:100]
            dst_content = para_lookup.get(cr.dst_id, ISAParagraph()).content[:100]
            query = f"{src_content} {dst_content}"

        edge_id = f"he_{hashlib.sha256(f'{cr.src_id}{cr.dst_id}{hop_type}'.encode()).hexdigest()[:8]}"

        conn.execute(
            "INSERT OR REPLACE INTO hop_edge "
            "(id, src_id, dst_id, weight, query, hop_type) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            [edge_id, cr.src_id, cr.dst_id, weight, query, hop_type],
        )
        count += 1

    conn.close()
    logger.info("[HOPRAG] Built %d hop edges from cross-references", count)
    return count


# =========================================================================
# CLI
# =========================================================================


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse CLI arguments."""
    parser = argparse.ArgumentParser(
        description="Ingest ISA standard PDFs into the knowledge base.",
        prog="python -m scripts.ingest_isa",
    )
    parser.add_argument(
        "--input", type=Path, required=True,
        help="Path to an ISA PDF or a directory of ISA PDFs.",
    )
    parser.add_argument(
        "--debug", action="store_true", default=False,
        help="Run in debug mode (use fixtures, no API calls).",
    )
    parser.add_argument(
        "--skip-enrichment", action="store_true", default=False,
        help="Skip web enrichment step.",
    )
    parser.add_argument(
        "--skip-store", action="store_true", default=False,
        help="Skip LanceDB/DuckDB storage.",
    )
    parser.add_argument(
        "--skip-graph", action="store_true", default=False,
        help="Skip graph edge building (belongs_to, cites).",
    )
    parser.add_argument(
        "--skip-hoprag", action="store_true", default=False,
        help="Skip HopRAG hop edge building.",
    )
    parser.add_argument(
        "--max-enrichment-queries", type=int, default=5,
        help="Max web search queries per ISA standard (default: 5).",
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
    """Run the full ISA ingestion pipeline."""
    t_start = time.monotonic()

    pdfs = collect_pdf_files(args.input)
    if not pdfs:
        return {"error": "No PDF files found", "elapsed_s": 0}

    logger.info("[START] Ingesting %d ISA PDF(s) [%s mode]", len(pdfs), "debug" if args.debug else "production")

    total_paragraphs = 0
    total_lance = 0
    total_duck: dict[str, int] = {"paragraphs": 0, "isa_standard": 0, "belongs_to": 0, "cites": 0}
    total_hop_edges = 0
    results = []

    for pdf_path in pdfs:
        logger.info("[PDF] Processing: %s", pdf_path.name)

        # Stage 1+2: Extract + Parse
        standard = await extract_isa_pdf(
            pdf_path, debug=args.debug,
            cache_dir=DATA_DIR / "extractions",
        )
        paragraphs = standard.paragraphs
        logger.info(
            "[EXTRACT] %s (ISA %s): %d paragraphs",
            pdf_path.name, standard.isa_number, len(paragraphs),
        )

        if not paragraphs:
            logger.warning("[WARN] No paragraphs extracted from %s", pdf_path.name)
            results.append({"file": pdf_path.name, "paragraphs": 0, "status": "empty"})
            continue

        # Stage 3: Enrich
        paragraphs = await enrich_paragraphs(
            paragraphs,
            skip=args.skip_enrichment or args.debug,
            max_queries_per_standard=args.max_enrichment_queries,
        )

        # Stage 4: Embed
        paragraphs = await embed_paragraphs(paragraphs, debug=args.debug)

        # Stage 5: Store
        skip_store = args.skip_store
        duck_counts = await store_in_duckdb(
            paragraphs, standard, skip=skip_store,
            skip_edges=args.skip_graph,
        )
        lance_count = await store_in_lancedb(paragraphs, skip=skip_store)

        # Stage 6: HopRAG
        hop_count = await build_hoprag_edges(
            paragraphs, standard.cross_references,
            skip=skip_store or args.skip_hoprag,
        )

        total_paragraphs += len(paragraphs)
        total_lance += lance_count
        for k in total_duck:
            total_duck[k] += duck_counts.get(k, 0)
        total_hop_edges += hop_count

        results.append({
            "file": pdf_path.name,
            "isa_number": standard.isa_number,
            "paragraphs": len(paragraphs),
            "cross_references": len(standard.cross_references),
            "lance_rows": lance_count,
            "duck_rows": duck_counts,
            "hop_edges": hop_count,
            "status": "ok",
        })

        logger.info(
            "[OK] ISA %s: %d paragraphs, %d cross-refs, hop_edges=%d",
            standard.isa_number, len(paragraphs),
            len(standard.cross_references), hop_count,
        )

    elapsed = time.monotonic() - t_start
    summary = {
        "files_processed": len(pdfs),
        "total_paragraphs": total_paragraphs,
        "total_lance_rows": total_lance,
        "total_duck": total_duck,
        "total_hop_edges": total_hop_edges,
        "elapsed_s": round(elapsed, 2),
        "mode": "debug" if args.debug else "production",
        "results": results,
    }

    logger.info(
        "[DONE] Ingested %d files (%d paragraphs, %d hop edges) in %.1fs [%s]",
        len(pdfs), total_paragraphs, total_hop_edges, elapsed, summary["mode"],
    )
    return summary


def main(argv: list[str] | None = None) -> None:
    """Entry point for the ISA ingestion script."""
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
