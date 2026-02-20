"""Tests for guide ingestion script.

Tests section splitting, ID generation, ISA reference extraction,
maps_to edge creation, and error paths.

Usage::

    cd isa-kb-mcp-server
    python -m pytest tests/test_ingest_guides.py -v
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Ensure scripts/ and src/ are importable
PROJECT_ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = PROJECT_ROOT / "src"
SCRIPTS_DIR = PROJECT_ROOT / "scripts"
for p in [str(SRC_DIR), str(SCRIPTS_DIR), str(PROJECT_ROOT)]:
    if p not in sys.path:
        sys.path.insert(0, p)

from scripts.ingest_guides import (
    GuideSection,
    ProcessedGuide,
    _classify_hop_type,
    _compute_hop_weight,
    _section_id,
    _split_long_text,
    extract_isa_references,
    split_into_sections,
)


# =========================================================================
# Test: Section ID generation
# =========================================================================


class TestSectionId:
    """Tests for gs_ prefixed ID generation."""

    def test_id_has_gs_prefix(self):
        sid = _section_id("LCE_Guide", "Chapter 1", 0)
        assert sid.startswith("gs_")

    def test_id_is_deterministic(self):
        sid1 = _section_id("LCE_Guide", "Chapter 1", 0)
        sid2 = _section_id("LCE_Guide", "Chapter 1", 0)
        assert sid1 == sid2

    def test_different_inputs_produce_different_ids(self):
        sid1 = _section_id("LCE_Guide", "Chapter 1", 0)
        sid2 = _section_id("LCE_Guide", "Chapter 2", 0)
        assert sid1 != sid2

    def test_id_uses_sha256(self):
        raw = "LCE_Guide|Chapter 1|0"
        expected_hash = hashlib.sha256(raw.encode()).hexdigest()[:8]
        sid = _section_id("LCE_Guide", "Chapter 1", 0)
        assert sid == f"gs_{expected_hash}"

    def test_char_offset_affects_id(self):
        sid1 = _section_id("LCE_Guide", "Same Heading", 0)
        sid2 = _section_id("LCE_Guide", "Same Heading", 100)
        assert sid1 != sid2

    def test_id_length(self):
        sid = _section_id("LCE_Guide", "Chapter 1", 0)
        # gs_ prefix (3) + 8 hex chars = 11
        assert len(sid) == 11


# =========================================================================
# Test: ISA reference extraction
# =========================================================================


class TestIsaReferenceExtraction:
    """Tests for ISA reference regex extraction."""

    def test_simple_standard_reference(self):
        text = "In accordance with ISA 315, the auditor shall..."
        refs = extract_isa_references(text)
        assert "ISA 315" in refs

    def test_paragraph_reference(self):
        text = "As required by ISA 315.12, the auditor shall..."
        refs = extract_isa_references(text)
        assert "ISA 315.12" in refs

    def test_sub_paragraph_reference(self):
        text = "Per ISA 315.12(a), risk assessment procedures..."
        refs = extract_isa_references(text)
        assert "ISA 315.12(a)" in refs

    def test_application_material_reference(self):
        text = "Application material at ISA 315.12.A2 states..."
        refs = extract_isa_references(text)
        assert "ISA 315.12.A2" in refs

    def test_multiple_references(self):
        text = "ISA 315 and ISA 500.6 and ISA 700 are relevant."
        refs = extract_isa_references(text)
        assert "ISA 315" in refs
        assert "ISA 500.6" in refs
        assert "ISA 700" in refs

    def test_deduplication(self):
        text = "ISA 315 is mentioned again: ISA 315."
        refs = extract_isa_references(text)
        assert refs.count("ISA 315") == 1

    def test_sorted_output(self):
        text = "ISA 700, ISA 315, ISA 500"
        refs = extract_isa_references(text)
        assert refs == sorted(refs)

    def test_no_references(self):
        text = "This section has no ISA standard references."
        refs = extract_isa_references(text)
        assert refs == []

    def test_partial_match_not_extracted(self):
        text = "The number 315 without ISA prefix should not match."
        refs = extract_isa_references(text)
        assert refs == []

    def test_full_reference_with_all_parts(self):
        text = "ISA 315.12(a).A2 provides detailed guidance."
        refs = extract_isa_references(text)
        assert "ISA 315.12(a).A2" in refs


# =========================================================================
# Test: Section splitting
# =========================================================================


class TestSectionSplitting:
    """Tests for text splitting into guide sections."""

    def test_markdown_heading_detection(self):
        text = (
            "# Chapter 1: Introduction\n"
            "This is the introduction section with enough content to meet "
            "the minimum section length requirement for processing.\n\n"
            "# Chapter 2: Risk Assessment\n"
            "Risk assessment procedures include inquiries, analytical "
            "procedures, and observation as described in ISA 315."
        )
        sections = split_into_sections(text, "test_guide")
        assert len(sections) >= 2
        headings = [s.heading for s in sections]
        assert any("Chapter 1" in h for h in headings)
        assert any("Chapter 2" in h for h in headings)

    def test_numbered_heading_detection(self):
        text = (
            "1.1 Introduction to the Standard\n"
            "This section provides introductory material about the auditing "
            "standard and its application to less complex entities.\n\n"
            "2.1 Risk Assessment Approach\n"
            "The risk assessment approach for LCE audits differs from "
            "full ISA audits in several key respects."
        )
        sections = split_into_sections(text, "test_guide")
        assert len(sections) >= 2

    def test_chapter_heading_detection(self):
        text = (
            "Chapter 1: Introduction\n"
            "This chapter introduces the standard and its purpose for "
            "auditing less complex entities in the current environment.\n\n"
            "Chapter 2: Scope\n"
            "This chapter defines the scope of application including which "
            "entities qualify as less complex entities."
        )
        sections = split_into_sections(text, "test_guide")
        assert len(sections) >= 2

    def test_min_section_length(self):
        text = (
            "# Short\n"
            "Too short.\n\n"
            "# Long Enough Section\n"
            "This section has enough content to meet the minimum section "
            "length requirement which is set at fifty characters."
        )
        sections = split_into_sections(text, "test_guide")
        # "Too short." section should be skipped (< 50 chars)
        for section in sections:
            assert len(section.content) >= 50

    def test_max_section_length_splitting(self):
        # Create a section longer than 3000 chars with paragraph breaks
        para1 = "This is a paragraph about risk assessment. " * 40  # ~1760 chars
        para2 = "This is a paragraph about materiality. " * 40  # ~1560 chars
        long_content = f"{para1}\n\n{para2}"
        text = f"# Long Section\n{long_content}"
        sections = split_into_sections(text, "test_guide")
        for section in sections:
            assert len(section.content) <= 3000

    def test_no_headings_single_section(self):
        text = (
            "This is a document without any headings. It contains enough "
            "content to form a single section about auditing procedures "
            "and requirements for less complex entities."
        )
        sections = split_into_sections(text, "test_guide")
        assert len(sections) >= 1
        assert sections[0].heading == "Document Content"

    def test_empty_text(self):
        sections = split_into_sections("", "test_guide")
        assert sections == []

    def test_whitespace_only_text(self):
        sections = split_into_sections("   \n\n  ", "test_guide")
        assert sections == []

    def test_isa_references_extracted_per_section(self):
        text = (
            "# Section 1\n"
            "The auditor shall comply with ISA 315.12(a) when performing "
            "risk assessment procedures in accordance with ISA 200.\n\n"
            "# Section 2\n"
            "External confirmations are addressed in ISA 505.6 and the "
            "auditor should review ISA 500 for general evidence requirements."
        )
        sections = split_into_sections(text, "test_guide")
        assert len(sections) >= 2

        # Check ISA refs extracted for relevant sections
        all_refs = []
        for s in sections:
            all_refs.extend(s.isa_references)
        assert any("ISA 315" in r for r in all_refs)
        assert any("ISA 505" in r for r in all_refs)

    def test_source_doc_preserved(self):
        text = (
            "# Chapter 1\n"
            "Content with enough text to meet the minimum section length "
            "requirement for the test to be valid."
        )
        sections = split_into_sections(text, "ISA_LCE_Guide")
        assert all(s.source_doc == "ISA_LCE_Guide" for s in sections)


class TestSplitLongText:
    """Tests for the long text splitting helper."""

    def test_single_short_chunk(self):
        text = "Short paragraph that fits in one section easily."
        sections = _split_long_text(text, "doc", "Heading", 0)
        assert len(sections) == 1
        assert sections[0].heading == "Heading"

    def test_multiple_chunks(self):
        # Create text that needs splitting (> 3000 chars)
        para = "A" * 1600
        text = f"{para}\n\n{para}\n\n{para}"
        sections = _split_long_text(text, "doc", "Long", 0)
        assert len(sections) >= 2

    def test_part_numbering(self):
        para = "A" * 1600
        text = f"{para}\n\n{para}\n\n{para}"
        sections = _split_long_text(text, "doc", "Base", 0)
        if len(sections) > 1:
            assert "(Part 1)" in sections[0].heading
            assert "(Part 2)" in sections[1].heading

    def test_no_part_numbering_for_single(self):
        text = "Short text that stays in one chunk."
        sections = _split_long_text(text, "doc", "Single", 0)
        assert "(Part" not in sections[0].heading


# =========================================================================
# Test: GuideSection dataclass
# =========================================================================


class TestGuideSection:
    """Tests for the GuideSection dataclass."""

    def test_auto_id_generation(self):
        section = GuideSection(
            heading="Test Section",
            content="Some content",
            source_doc="test_doc",
        )
        assert section.id.startswith("gs_")

    def test_explicit_id_preserved(self):
        section = GuideSection(
            id="gs_custom01",
            heading="Test",
            content="Content",
            source_doc="doc",
        )
        assert section.id == "gs_custom01"

    def test_enriched_content_returns_content(self):
        section = GuideSection(content="plain text")
        assert section.enriched_content == "plain text"


# =========================================================================
# Test: ProcessedGuide JSON serialization
# =========================================================================


class TestProcessedGuideJson:
    """Tests for ProcessedGuide JSON persistence."""

    def test_roundtrip(self, tmp_path):
        guide = ProcessedGuide(
            source_path=Path("/test/guide.pdf"),
            source_doc="guide",
            total_pages=10,
            sections=[
                GuideSection(
                    id="gs_abc12345",
                    heading="Chapter 1",
                    content="Content about ISA 315.",
                    source_doc="guide",
                    isa_references=["ISA 315"],
                    page_start=1,
                    page_end=5,
                    char_offset=0,
                ),
            ],
        )

        json_path = tmp_path / "guide.json"
        guide.to_json(json_path)

        loaded = ProcessedGuide.from_json(json_path)
        assert loaded.source_doc == "guide"
        assert loaded.total_pages == 10
        assert len(loaded.sections) == 1
        assert loaded.sections[0].id == "gs_abc12345"
        assert loaded.sections[0].heading == "Chapter 1"
        assert loaded.sections[0].isa_references == ["ISA 315"]


# =========================================================================
# Test: Hop weight and type classification
# =========================================================================


class TestHopWeightAndType:
    """Tests for hop weight computation and type classification."""

    def test_standard_weight(self):
        weight = _compute_hop_weight("ISA 315")
        assert weight == 0.60

    def test_paragraph_weight(self):
        weight = _compute_hop_weight("ISA 315.12")
        assert weight == 0.90

    def test_sub_paragraph_weight(self):
        weight = _compute_hop_weight("ISA 315.12(a)")
        assert weight == 0.95

    def test_app_material_weight(self):
        weight = _compute_hop_weight("ISA 315.12.A2")
        assert weight == 0.85

    def test_standard_type(self):
        assert _classify_hop_type("ISA 315") == "standard_ref"

    def test_paragraph_type(self):
        assert _classify_hop_type("ISA 315.12") == "cross_ref"

    def test_sub_paragraph_type(self):
        assert _classify_hop_type("ISA 315.12(a)") == "sub_paragraph"

    def test_app_material_type(self):
        assert _classify_hop_type("ISA 315.12.A2") == "app_material"


# =========================================================================
# Test: Debug fixture generation
# =========================================================================


class TestDebugFixture:
    """Tests for debug mode fixture generation."""

    @pytest.mark.asyncio
    async def test_debug_generates_sections(self):
        from scripts.ingest_guides import extract_guide_pdf

        guide = await extract_guide_pdf(Path("test_guide.pdf"), debug=True)
        assert len(guide.sections) > 0
        assert guide.source_doc == "test_guide"

    @pytest.mark.asyncio
    async def test_debug_sections_have_isa_references(self):
        from scripts.ingest_guides import extract_guide_pdf

        guide = await extract_guide_pdf(Path("test_guide.pdf"), debug=True)
        total_refs = sum(len(s.isa_references) for s in guide.sections)
        assert total_refs > 0

    @pytest.mark.asyncio
    async def test_debug_sections_have_gs_ids(self):
        from scripts.ingest_guides import extract_guide_pdf

        guide = await extract_guide_pdf(Path("test_guide.pdf"), debug=True)
        for section in guide.sections:
            assert section.id.startswith("gs_")


# =========================================================================
# Test: Embedding (debug mode)
# =========================================================================


class TestEmbedding:
    """Tests for section embedding in debug mode."""

    @pytest.mark.asyncio
    async def test_debug_embedding_generates_vectors(self):
        from scripts.ingest_guides import embed_sections

        sections = [
            GuideSection(
                id="gs_test0001",
                heading="Test",
                content="Content",
                source_doc="doc",
            ),
        ]
        embedded = await embed_sections(sections, debug=True)
        assert len(embedded[0].embedding) == 1024

    @pytest.mark.asyncio
    async def test_debug_embedding_is_deterministic(self):
        from scripts.ingest_guides import embed_sections

        sections = [
            GuideSection(
                id="gs_test0001",
                heading="Test",
                content="Content",
                source_doc="doc",
            ),
        ]
        embedded1 = await embed_sections(sections, debug=True)
        embedded2 = await embed_sections(sections, debug=True)
        assert embedded1[0].embedding == embedded2[0].embedding


# =========================================================================
# Test: Error paths
# =========================================================================


class TestErrorPaths:
    """Tests for error handling and edge cases."""

    def test_collect_nonexistent_path(self):
        from scripts.ingest_guides import collect_pdf_files

        result = collect_pdf_files(Path("/nonexistent/path"))
        assert result == []

    def test_collect_empty_directory(self, tmp_path):
        from scripts.ingest_guides import collect_pdf_files

        result = collect_pdf_files(tmp_path)
        assert result == []

    def test_collect_single_pdf(self, tmp_path):
        from scripts.ingest_guides import collect_pdf_files

        pdf_file = tmp_path / "test.pdf"
        pdf_file.write_bytes(b"%PDF-1.4")
        result = collect_pdf_files(pdf_file)
        assert len(result) == 1
        assert result[0] == pdf_file

    def test_collect_directory_with_pdfs(self, tmp_path):
        from scripts.ingest_guides import collect_pdf_files

        for name in ["guide1.pdf", "guide2.pdf", "readme.txt"]:
            (tmp_path / name).write_bytes(b"content")
        result = collect_pdf_files(tmp_path)
        assert len(result) == 2

    def test_split_empty_text_returns_empty(self):
        assert split_into_sections("", "doc") == []

    @pytest.mark.asyncio
    async def test_production_without_api_key_raises(self):
        from scripts.ingest_guides import extract_guide_pdf

        with patch.dict("os.environ", {}, clear=True):
            with pytest.raises(RuntimeError, match="AZURE_DOCUMENT_INTELLIGENCE"):
                await extract_guide_pdf(Path("test.pdf"), debug=False)

    @pytest.mark.asyncio
    async def test_embed_without_voyage_key_raises(self):
        from scripts.ingest_guides import embed_sections

        sections = [GuideSection(id="gs_test", content="text", source_doc="doc")]
        with patch.dict("os.environ", {}, clear=True):
            with pytest.raises(RuntimeError, match="VOYAGE_API_KEY"):
                await embed_sections(sections, debug=False)


# =========================================================================
# Test: CLI argument parsing
# =========================================================================


class TestArgParsing:
    """Tests for CLI argument parsing."""

    def test_required_input(self):
        from scripts.ingest_guides import parse_args

        args = parse_args(["--input", "/data/guides/"])
        assert args.input == Path("/data/guides/")

    def test_debug_flag(self):
        from scripts.ingest_guides import parse_args

        args = parse_args(["--input", "/data/", "--debug"])
        assert args.debug is True

    def test_defaults(self):
        from scripts.ingest_guides import parse_args

        args = parse_args(["--input", "/data/"])
        assert args.debug is False
        assert args.skip_enrichment is False
        assert args.skip_store is False
        assert args.skip_hoprag is False
        assert args.use_cache is False
        assert args.verbose is False
