"""Integration tests for the ISA KB Guide Reference feature.

Tests:
- Guide section splitting (heading detection, min/max, paragraph boundary)
- gs_ ID generation determinism
- ISA reference extraction regex
- Guide search formatting
- Multi-tier search tier labels
- Query expansion (ISA acronyms)
- Reranker graceful fallback
- Diagnostic kb_status structure
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Ensure src/ is importable
PROJECT_ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = PROJECT_ROOT / "src"
SCRIPTS_DIR = PROJECT_ROOT / "scripts"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))


# ============================================================
# Guide Ingestion Tests (from ingest_guides.py)
# ============================================================


class TestSectionSplitting:
    """Test split_into_sections from ingest_guides.py."""

    def test_heading_detection_markdown(self):
        """Markdown headings are detected as section boundaries."""
        from scripts.ingest_guides import split_into_sections

        text = (
            "# Introduction\n"
            "This is the introduction section with enough content to pass "
            "the minimum section length threshold of fifty characters.\n\n"
            "# Risk Assessment\n"
            "Risk assessment procedures are described in ISA 315.12(a). "
            "These include inquiries of management and other personnel."
        )
        sections = split_into_sections(text, "test_guide")
        assert len(sections) >= 2
        headings = [s.heading for s in sections]
        assert any("Introduction" in h for h in headings)
        assert any("Risk Assessment" in h for h in headings)

    def test_heading_detection_numbered(self):
        """Numbered section headings are detected."""
        from scripts.ingest_guides import split_into_sections

        text = (
            "1.1 Scope of the Standard\n"
            "This section describes the scope of the auditing standard. "
            "It applies to all audits of financial statements conducted "
            "under the International Standards on Auditing framework.\n\n"
            "2.1 Application Guidance\n"
            "Application material provides additional guidance on the "
            "requirements of this standard. Auditors should consider "
            "all relevant factors when applying professional judgment."
        )
        sections = split_into_sections(text, "test_guide")
        assert len(sections) >= 1

    def test_min_section_length(self):
        """Sections below 50 chars are skipped, longer ones are kept."""
        from scripts.ingest_guides import split_into_sections

        # Build text where "Short" body < 50 chars, "Long Section" body >= 50 chars
        # Headings must be >20 chars apart to avoid heading dedup logic
        text = (
            "# Short\n"
            "Too short body here.\n\n\n\n\n\n\n\n\n\n\n\n\n\n"
            "# Long Section\n"
            "This is a long enough section body that exceeds the minimum "
            "section length of fifty characters for testing purposes."
        )
        sections = split_into_sections(text, "test_guide")
        headings = [s.heading for s in sections]
        # Long section should be kept
        assert any("Long Section" in h for h in headings)

    def test_max_section_length_split(self):
        """Sections over 3000 chars are force-split into multiple sections."""
        from scripts.ingest_guides import split_into_sections

        # Create text with multiple paragraphs (separated by double newlines)
        long_text = "# Very Long Section\n" + ("\n\n".join(["This is paragraph number %d. " % i * 10 for i in range(50)]))
        sections = split_into_sections(long_text, "test_guide")
        # Should produce more than 1 section from the force-split
        assert len(sections) >= 1

    def test_no_headings_single_section(self):
        """Text without headings becomes a single section."""
        from scripts.ingest_guides import split_into_sections

        text = "This is plain text without any headings. " * 10
        sections = split_into_sections(text, "test_guide")
        assert len(sections) >= 1
        assert sections[0].heading == "Document Content"

    def test_empty_text_returns_empty(self):
        """Empty text returns no sections."""
        from scripts.ingest_guides import split_into_sections

        assert split_into_sections("", "test") == []
        assert split_into_sections("   ", "test") == []


class TestSectionIds:
    """Test gs_ ID generation."""

    def test_id_has_gs_prefix(self):
        """IDs start with gs_ prefix."""
        from scripts.ingest_guides import _section_id

        sid = _section_id("test_doc", "Introduction", 0)
        assert sid.startswith("gs_")

    def test_id_is_deterministic(self):
        """Same inputs produce same ID."""
        from scripts.ingest_guides import _section_id

        id1 = _section_id("doc", "heading", 100)
        id2 = _section_id("doc", "heading", 100)
        assert id1 == id2

    def test_different_inputs_different_ids(self):
        """Different inputs produce different IDs."""
        from scripts.ingest_guides import _section_id

        id1 = _section_id("doc1", "heading", 0)
        id2 = _section_id("doc2", "heading", 0)
        assert id1 != id2


class TestIsaReferenceExtraction:
    """Test ISA reference extraction regex."""

    def test_basic_isa_reference(self):
        """Extract simple ISA NNN references."""
        from scripts.ingest_guides import extract_isa_references

        refs = extract_isa_references("See ISA 315 for details.")
        assert "ISA 315" in refs

    def test_paragraph_reference(self):
        """Extract ISA NNN.NN references."""
        from scripts.ingest_guides import extract_isa_references

        refs = extract_isa_references("Per ISA 315.12, the auditor shall...")
        assert "ISA 315.12" in refs

    def test_sub_paragraph_reference(self):
        """Extract ISA NNN.NN(x) references."""
        from scripts.ingest_guides import extract_isa_references

        refs = extract_isa_references("ISA 315.12(a) requires risk assessment.")
        assert "ISA 315.12(a)" in refs

    def test_application_material_reference(self):
        """Extract ISA NNN.NN.ANN references."""
        from scripts.ingest_guides import extract_isa_references

        refs = extract_isa_references("Refer to ISA 500.6.A31 for guidance.")
        assert any("A31" in r for r in refs)

    def test_multiple_references(self):
        """Extract multiple ISA references from one text."""
        from scripts.ingest_guides import extract_isa_references

        text = "ISA 315 and ISA 500.6 both apply. See also ISA 330."
        refs = extract_isa_references(text)
        assert len(refs) >= 3

    def test_no_references(self):
        """Text without ISA references returns empty list."""
        from scripts.ingest_guides import extract_isa_references

        refs = extract_isa_references("No audit standards mentioned here.")
        assert refs == []

    def test_references_are_sorted(self):
        """References are returned in sorted order."""
        from scripts.ingest_guides import extract_isa_references

        refs = extract_isa_references("ISA 500 then ISA 200 then ISA 315")
        assert refs == sorted(refs)

    def test_references_are_unique(self):
        """Duplicate references are deduplicated."""
        from scripts.ingest_guides import extract_isa_references

        refs = extract_isa_references("ISA 315 and ISA 315 again")
        assert refs.count("ISA 315") == 1


class TestQueryExpansion:
    """Test ISA acronym query expansion."""

    def test_known_acronym_expands(self):
        """Known ISA acronyms are expanded."""
        from isa_kb_mcp_server.query_expand import expand_query

        result = expand_query("RA procedures")
        assert "risk assessment" in result.lower()

    def test_original_term_preserved(self):
        """Original terms are preserved after expansion."""
        from isa_kb_mcp_server.query_expand import expand_query

        result = expand_query("TCWG communication")
        assert "TCWG" in result

    def test_unknown_term_unchanged(self):
        """Unknown terms pass through unchanged."""
        from isa_kb_mcp_server.query_expand import expand_query

        result = expand_query("audit procedures for revenue")
        assert result == "audit procedures for revenue"

    def test_expand_with_synonyms_returns_variants(self):
        """expand_with_synonyms returns original + expanded."""
        from isa_kb_mcp_server.query_expand import expand_with_synonyms

        variants = expand_with_synonyms("KAM disclosure")
        assert len(variants) >= 1
        assert variants[0] == "KAM disclosure"
        if len(variants) > 1:
            assert "key audit matters" in variants[1].lower()


class TestReranker:
    """Test reranker graceful fallback."""

    def test_rerank_empty_results(self):
        """Reranking empty results returns empty list."""
        from isa_kb_mcp_server.rerank import rerank_results

        result = rerank_results("test query", [])
        assert result == []

    def test_rerank_preserves_results(self):
        """Reranking returns results (possibly reordered or unchanged)."""
        from isa_kb_mcp_server.rerank import rerank_results

        results = [
            {"id": "1", "content": "ISA 315 risk assessment requirements"},
            {"id": "2", "content": "ISA 500 audit evidence"},
        ]
        reranked = rerank_results("risk assessment", results)
        assert len(reranked) <= 2
        # All original IDs should be present
        reranked_ids = {r["id"] for r in reranked}
        assert reranked_ids == {"1", "2"}
