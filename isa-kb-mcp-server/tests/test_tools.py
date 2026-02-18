"""
ISA KB MCP Server — Tool Tests

Tests cover:
- Tool registration (all 10 tools)
- RRF fusion correctness
- Path resolution (Path object)
- Cross-reference extraction
- Context formatting (XML output, token budget, at-least-one guarantee)
- Web search graceful degradation (no BRAVE_API_KEY)
- Web search relevance scoring (_score_relevance)
- Contradiction pattern matching (regex patterns used by contradiction_check)
"""

import sys
import os
import re

# Add src to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))


# ============================================================
# Tool Registration
# ============================================================

def test_tool_registration():
    """All 10 tools should be registered on the MCP server."""
    from isa_kb_mcp_server import create_server
    mcp = create_server()

    expected_tools = [
        'isa_hybrid_search',
        'isa_hop_retrieve',
        'isa_list_standards',
        'isa_get_paragraph',
        'isa_entity_verify',
        'isa_citation_verify',
        'isa_relation_verify',
        'isa_contradiction_check',
        'isa_format_context',
        'isa_web_search',
    ]

    # FastMCP stores tools internally
    registered = list(mcp._tool_manager._tools.keys())
    for tool in expected_tools:
        assert tool in registered, f"Tool '{tool}' not registered. Got: {registered}"

    print(f"PASS: All {len(expected_tools)} tools registered")


# ============================================================
# RRF Fusion
# ============================================================

def test_rrf_fusion():
    """Items in both keyword and vector lists should score highest."""
    from isa_kb_mcp_server.search import _rrf_fuse

    keyword_results = [
        {'id': 'a', 'content': 'A', 'score': 10.0},
        {'id': 'b', 'content': 'B', 'score': 8.0},
        {'id': 'c', 'content': 'C', 'score': 5.0},
    ]
    vector_results = [
        {'id': 'b', 'content': 'B', 'distance': 0.1},
        {'id': 'd', 'content': 'D', 'distance': 0.3},
        {'id': 'a', 'content': 'A', 'distance': 0.5},
    ]

    fused = _rrf_fuse(keyword_results, vector_results, k=60)
    ids = [r['id'] for r in fused]

    # b appears at rank 1 in keyword (index 1) and rank 0 in vector — highest combined
    # a appears at rank 0 in keyword and rank 2 in vector
    # Both b and a should be top 2 (both appear in both lists)
    assert ids[0] == 'b', f"Expected 'b' first, got '{ids[0]}'"
    assert ids[1] == 'a', f"Expected 'a' second, got '{ids[1]}'"
    # c only in keyword, d only in vector — should be lower
    assert 'c' in ids, "'c' should be in results"
    assert 'd' in ids, "'d' should be in results"

    print("PASS: RRF fusion correctly ranks items in both lists highest")


# ============================================================
# Cross-Reference Extraction
# ============================================================

def test_cross_reference_extraction():
    """Cross-reference extractor should find ISA references in content."""
    from isa_kb_mcp_server.context import _extract_cross_references

    # Content mentioning other ISAs
    content = "As required by ISA 315.12, the auditor shall also consider ISA 500 and ISA 200."
    refs = _extract_cross_references(content, current_isa="315")

    # Should find ISA 500 and ISA 200, but NOT ISA 315 (self-reference)
    assert "ISA 500" in refs, f"Expected 'ISA 500' in refs, got: {refs}"
    assert "ISA 200" in refs, f"Expected 'ISA 200' in refs, got: {refs}"
    assert not any("315" in r for r in refs), f"Self-reference ISA 315 should be excluded, got: {refs}"

    print("PASS: Cross-reference extraction finds other ISAs, excludes self-reference")


def test_cross_reference_with_paragraph_numbers():
    """Cross-reference extractor should capture paragraph numbers."""
    from isa_kb_mcp_server.context import _extract_cross_references

    content = "Refer to ISA 240.15 for fraud-related procedures."
    refs = _extract_cross_references(content, current_isa="200")

    assert "ISA 240.15" in refs, f"Expected 'ISA 240.15' in refs, got: {refs}"

    print("PASS: Cross-reference extraction captures paragraph numbers")


def test_cross_reference_empty():
    """Cross-reference extractor should return empty for no references."""
    from isa_kb_mcp_server.context import _extract_cross_references

    content = "The auditor shall plan the audit engagement."
    refs = _extract_cross_references(content, current_isa="200")

    assert refs == [], f"Expected empty list, got: {refs}"

    print("PASS: Cross-reference extraction returns empty for no references")


# ============================================================
# Context Formatting
# ============================================================

def test_context_formatting():
    """Context formatter should produce valid XML within token budget."""
    from isa_kb_mcp_server.context import format_context

    paragraphs = [
        {
            'id': 'p1',
            'isa_number': '200',
            'paragraph_ref': '200.5',
            'content': 'The auditor shall plan the audit.',
            'rrf_score': 0.95,
        },
        {
            'id': 'p2',
            'isa_number': '315',
            'paragraph_ref': '315.12',
            'content': 'Understanding the entity and its environment.',
            'rrf_score': 0.80,
        },
    ]

    result = format_context(
        paragraphs=paragraphs,
        query='audit planning requirements',
        max_tokens=1000,
    )

    # Result is a dict with 'xml' key
    assert isinstance(result, dict), f"Expected dict, got {type(result)}"
    assert 'xml' in result, f"Expected 'xml' key in result, got keys: {list(result.keys())}"

    xml = result['xml']
    assert '<search_results' in xml, f"Missing <search_results> tag"
    assert 'ISA 200' in xml, f"Missing ISA 200 reference"
    assert 'ISA 315' in xml, f"Missing ISA 315 reference"
    assert '</search_results>' in xml, f"Missing closing tag"
    assert result['included_count'] == 2, f"Expected 2 included, got {result['included_count']}"

    print("PASS: Context formatting produces valid XML within budget")


def test_context_always_includes_at_least_one():
    """Even with a tiny token budget, at least 1 result should be included."""
    from isa_kb_mcp_server.context import format_context

    paragraphs = [
        {
            'id': 'p1',
            'isa_number': '200',
            'paragraph_ref': '200.5',
            'content': 'A very long paragraph ' * 100,
            'rrf_score': 0.95,
        },
    ]

    result = format_context(
        paragraphs=paragraphs,
        query='test',
        max_tokens=10,  # Impossibly small
    )

    xml = result['xml']
    # Should still include at least 1 result
    assert '<result' in xml, f"Should include at least 1 result even with tiny budget"
    assert result['included_count'] >= 1, f"Expected at least 1 included, got {result['included_count']}"

    print("PASS: Context always includes at least one result")


def test_context_empty_paragraphs():
    """Context formatter should handle empty input gracefully."""
    from isa_kb_mcp_server.context import format_context

    result = format_context(
        paragraphs=[],
        query='test',
        max_tokens=1000,
    )

    xml = result['xml']
    assert '<no_results/>' in xml, f"Expected <no_results/> for empty input"
    assert result['included_count'] == 0

    print("PASS: Context formatting handles empty input")


# ============================================================
# Contradiction Pattern Matching (unit-testable regex logic)
# ============================================================

def test_contradiction_patterns():
    """The regex patterns used by contradiction_check should detect opposites."""
    # These are the exact patterns from verify.py
    CONTRADICTION_PATTERNS = [
        (r"\bshall\b", r"\bshall not\b"),
        (r"\bmust\b", r"\bmust not\b"),
        (r"\brequired\b", r"\bnot required\b"),
        (r"\bprohibited\b", r"\bpermitted\b"),
        (r"\bmandatory\b", r"\boptional\b"),
        (r"\balways\b", r"\bnever\b"),
    ]

    text_pos = "The auditor shall obtain written representations."
    text_neg = "The auditor shall not obtain written representations."

    # Check: text_pos has "shall", text_neg has "shall not"
    pos_pattern, neg_pattern = CONTRADICTION_PATTERNS[0]
    assert re.search(pos_pattern, text_pos.lower()), "Should match 'shall' in positive text"
    assert re.search(neg_pattern, text_neg.lower()), "Should match 'shall not' in negative text"

    # Verify the cross-detection logic: p1 has positive, p2 has negative
    p1_has_pos = bool(re.search(pos_pattern, text_pos.lower()))
    p2_has_neg = bool(re.search(neg_pattern, text_neg.lower()))
    assert p1_has_pos and p2_has_neg, "Should detect contradiction pair"

    print("PASS: Contradiction regex patterns detect opposing requirements")


def test_no_false_contradictions():
    """Non-contradictory text should not trigger contradiction patterns."""
    CONTRADICTION_PATTERNS = [
        (r"\bshall\b", r"\bshall not\b"),
        (r"\bmust\b", r"\bmust not\b"),
        (r"\brequired\b", r"\bnot required\b"),
        (r"\bprohibited\b", r"\bpermitted\b"),
        (r"\bmandatory\b", r"\boptional\b"),
        (r"\balways\b", r"\bnever\b"),
    ]

    text1 = "The auditor shall plan the engagement."
    text2 = "The auditor shall document the plan."

    # Both have "shall" (positive) but neither has "shall not" (negative)
    # No contradiction should be detected
    for pos_pattern, neg_pattern in CONTRADICTION_PATTERNS:
        t1_pos = bool(re.search(pos_pattern, text1.lower()))
        t1_neg = bool(re.search(neg_pattern, text1.lower()))
        t2_pos = bool(re.search(pos_pattern, text2.lower()))
        t2_neg = bool(re.search(neg_pattern, text2.lower()))

        is_contradiction = (t1_pos and t2_neg) or (t1_neg and t2_pos)
        assert not is_contradiction, \
            f"False positive: pattern ({pos_pattern}, {neg_pattern}) on non-contradictory text"

    print("PASS: No false positives in contradiction detection")


# ============================================================
# Web Search: Graceful Degradation
# ============================================================

def test_web_search_no_api_key():
    """Web search should return empty results when BRAVE_API_KEY is not set."""
    # Ensure no API key
    original = os.environ.pop('BRAVE_API_KEY', None)
    try:
        from isa_kb_mcp_server.web_search import web_search
        result = web_search(queries=['ISA 200 audit requirements'])
        assert result['results'] == [], f"Expected empty results, got: {result['results']}"
        assert result['queries_executed'] == 0, f"Expected 0 queries executed, got: {result['queries_executed']}"
        assert len(result['warnings']) > 0, "Expected a warning about missing API key"
    finally:
        if original is not None:
            os.environ['BRAVE_API_KEY'] = original

    print("PASS: Web search gracefully returns empty when no API key")


# ============================================================
# Web Search: Relevance Scoring
# ============================================================

def test_relevance_scoring():
    """Relevance scorer should prefer authoritative domains and term overlap."""
    from isa_kb_mcp_server.web_search import _score_relevance

    # Authoritative domain with term overlap
    score_auth = _score_relevance(
        'ISA 200 audit',  # query
        'ISA 200 Overview',  # title
        'Overall Objectives of the Independent Auditor',  # snippet
        'https://www.ifac.org/isa-200',  # url
    )

    # Non-authoritative domain (same title/snippet)
    score_noauth = _score_relevance(
        'ISA 200 audit',  # query
        'ISA 200 Overview',  # title
        'Overall Objectives of the Independent Auditor',  # snippet
        'https://random-blog.example.com/isa-200',  # url
    )

    assert score_auth > score_noauth, \
        f"Auth domain ({score_auth}) should score higher than non-auth ({score_noauth})"

    # Difference should be about 0.25 (the preferred domain bonus)
    assert abs((score_auth - score_noauth) - 0.25) < 0.01, \
        f"Domain bonus should be ~0.25, got {score_auth - score_noauth}"

    print("PASS: Relevance scoring prefers authoritative domains")


def test_relevance_scoring_term_overlap():
    """Relevance scorer should increase with more matching query terms."""
    from isa_kb_mcp_server.web_search import _score_relevance

    # Many matching terms
    score_high = _score_relevance(
        'ISA 315 risk assessment procedures',
        'ISA 315 Risk Assessment',
        'Risk assessment procedures in accordance with ISA 315',
        'https://example.com/315',
    )

    # Few matching terms
    score_low = _score_relevance(
        'ISA 315 risk assessment procedures',
        'Accounting Standards Update',
        'General overview of financial reporting changes',
        'https://example.com/other',
    )

    assert score_high > score_low, \
        f"High overlap ({score_high}) should score higher than low overlap ({score_low})"

    print("PASS: Relevance scoring increases with term overlap")


# ============================================================
# Path Resolution
# ============================================================

def test_db_path_resolution():
    """Database path should resolve relative to package root."""
    from isa_kb_mcp_server.db import _resolve_db_path
    from pathlib import Path

    path = _resolve_db_path()

    # Should be a Path object
    assert isinstance(path, Path), f"Expected Path object, got {type(path)}"

    # Should end with data/duckdb/isa_kb.duckdb
    path_str = str(path)
    expected_suffix = os.path.join('data', 'duckdb', 'isa_kb.duckdb')
    assert path_str.endswith(expected_suffix), \
        f"Unexpected DB path: {path_str}, expected to end with {expected_suffix}"

    print("PASS: Database path resolves correctly")


# ============================================================
# Entity Verify — Score Calculation (fuzzy matching logic)
# ============================================================

def test_entity_verify_scoring():
    """Entity verify scoring: mixed found/not-found entities produce correct ratio."""
    # Test the term extraction and fuzzy matching logic used by entity_verify
    # The actual entity_verify function needs a DB, but we can test
    # the scoring formula and matching approach

    # Simulate the scoring logic from verify.py
    entities = ["ISA 315", "risk assessment", "internal control", "nonexistent concept"]
    source_text = "ISA 315 covers risk assessment procedures for the auditor."

    combined = source_text.lower()
    grounded = 0
    for entity in entities:
        entity_lower = entity.lower()
        # Direct match
        if entity_lower in combined:
            grounded += 1
        # Fuzzy: strip "ISA" prefix
        elif entity_lower.startswith("isa"):
            stripped = entity_lower.replace("isa", "").strip()
            if stripped and stripped in combined:
                grounded += 1

    score = grounded / len(entities) if entities else 1.0
    # ISA 315 -> found, risk assessment -> found, internal control -> NOT found, nonexistent -> NOT found
    assert grounded == 2, f"Expected 2 grounded, got {grounded}"
    assert score == 0.5, f"Expected score 0.5, got {score}"

    print("PASS: Entity verify scoring correctly handles mixed found/not-found")


# ============================================================
# Citation Verify — Term Overlap Threshold
# ============================================================

def test_citation_verify_term_overlap():
    """Citation term overlap: threshold at 30% with edge cases."""
    # Test the term extraction and overlap logic from verify.py
    stop_words = {"the", "and", "for", "that", "this", "with", "from", "are",
                  "was", "were", "been", "have", "has", "not", "but", "can",
                  "should", "shall", "may", "must"}

    def extract_terms(text):
        return [w for w in re.findall(r"\b\w{4,}\b", text.lower()) if w not in stop_words]

    def term_overlap(claim, content):
        claim_terms = extract_terms(claim)
        content_lower = content.lower()
        if not claim_terms:
            return 0.0
        matching = sum(1 for t in claim_terms if t in content_lower)
        return matching / len(claim_terms)

    # High overlap (above 30%)
    claim = "The auditor shall assess inherent risk factors"
    content = "ISA 315 requires the auditor to assess inherent risk factors in the entity."
    overlap = term_overlap(claim, content)
    assert overlap >= 0.3, f"Expected >= 0.3, got {overlap}"

    # Low overlap (below 30%)
    claim = "Professional judgment documentation requirements"
    content = "The entity operates in a regulated industry."
    overlap_low = term_overlap(claim, content)
    assert overlap_low < 0.3, f"Expected < 0.3, got {overlap_low}"

    # Edge case: empty claim terms
    overlap_empty = term_overlap("the and for", content)  # All stop words
    assert overlap_empty == 0.0, f"Expected 0.0 for all stop words, got {overlap_empty}"

    print("PASS: Citation term overlap threshold works correctly with edge cases")


# ============================================================
# Relation Verify — Implicit Same-ISA Detection
# ============================================================

def test_relation_verify_implicit():
    """Same-ISA implicit relation: paragraphs from same standard should be related."""
    # The actual relation_verify needs DB for edge table lookups,
    # but we can test the implicit detection logic:
    # Two paragraphs with the same isa_number are implicitly related

    paragraphs = {
        "p1": {"isa_number": "315", "paragraph_ref": "315.5"},
        "p2": {"isa_number": "315", "paragraph_ref": "315.12"},
        "p3": {"isa_number": "500", "paragraph_ref": "500.7"},
    }

    def check_same_standard(src_id, dst_id):
        src = paragraphs.get(src_id)
        dst = paragraphs.get(dst_id)
        if src and dst:
            return src["isa_number"] == dst["isa_number"]
        return False

    # Same ISA -> implicit relation
    assert check_same_standard("p1", "p2") is True, "Same ISA should be implicit relation"

    # Different ISA -> no implicit relation
    assert check_same_standard("p1", "p3") is False, "Different ISA should not be implicit"

    # Unknown paragraph -> no relation
    assert check_same_standard("p1", "unknown") is False, "Unknown paragraph should not match"

    print("PASS: Implicit same-ISA relation detection works correctly")


# ============================================================
# Context — Role Caps Enforcement
# ============================================================

def test_context_role_caps():
    """Role caps should limit supporting (15) and context (5) paragraphs."""
    from isa_kb_mcp_server.context import format_context

    # Create 20 supporting and 10 context paragraphs
    paragraphs = []
    for i in range(20):
        paragraphs.append({
            'id': f'sup_{i}',
            'isa_number': '315',
            'paragraph_ref': f'315.{i}',
            'content': f'Supporting paragraph {i} about risk.',
            'rrf_score': 0.9 - (i * 0.01),
        })
    for i in range(10):
        paragraphs.append({
            'id': f'ctx_{i}',
            'isa_number': '200',
            'paragraph_ref': f'200.{i}',
            'content': f'Context paragraph {i} about audit.',
            'rrf_score': 0.5 - (i * 0.01),
        })

    roles = {}
    for i in range(20):
        roles[f'sup_{i}'] = 'supporting'
    for i in range(10):
        roles[f'ctx_{i}'] = 'context'

    result = format_context(
        paragraphs=paragraphs,
        query='risk assessment',
        max_tokens=100000,  # Large budget to avoid token truncation
        roles=roles,
    )

    xml = result['xml']

    # Count included results by role
    supporting_count = xml.count('role="supporting"')
    context_count = xml.count('role="context"')

    assert supporting_count <= 15, f"Supporting should be capped at 15, got {supporting_count}"
    assert context_count <= 5, f"Context should be capped at 5, got {context_count}"

    print(f"PASS: Role caps enforced — supporting: {supporting_count}/15, context: {context_count}/5")


# ============================================================
# Context — XML Structure Validation
# ============================================================

def test_format_context_xml_structure():
    """Context XML output should have correct structure and attributes."""
    from isa_kb_mcp_server.context import format_context

    paragraphs = [
        {
            'id': 'p1',
            'isa_number': '315',
            'paragraph_ref': '315.12',
            'content': 'The auditor shall identify and assess risks per ISA 200.',
            'rrf_score': 0.95,
            'page_number': 5,
            'sub_paragraph': '(a)',
            'application_ref': 'A1',
        },
    ]

    result = format_context(
        paragraphs=paragraphs,
        query='risk assessment',
        max_tokens=5000,
        roles={'p1': 'primary'},
    )

    xml = result['xml']

    # Check root element attributes
    assert 'query="risk assessment"' in xml, "Missing query attribute"
    assert 'total_results="1"' in xml, "Missing total_results attribute"
    assert 'included_results="1"' in xml, "Missing included_results attribute"

    # Check result element
    assert 'rank="1"' in xml, "Missing rank attribute"
    assert 'source="ISA 315.12"' in xml, "Missing source attribute"
    assert 'role="primary"' in xml, "Missing role attribute"

    # Check content
    assert '<content>' in xml, "Missing content element"
    assert 'identify and assess risks per ISA 200' in xml, "Missing paragraph content"

    # Check source_text
    assert '<source_text' in xml, "Missing source_text element"
    assert 'standard="ISA 315"' in xml, "Missing standard attribute"

    # Check metadata
    assert '<metadata>' in xml, "Missing metadata element"

    print("PASS: Context XML structure has correct elements and attributes")


# ============================================================
# Run All Tests
# ============================================================

if __name__ == '__main__':
    tests = [
        test_tool_registration,
        test_rrf_fusion,
        test_cross_reference_extraction,
        test_cross_reference_with_paragraph_numbers,
        test_cross_reference_empty,
        test_context_formatting,
        test_context_always_includes_at_least_one,
        test_context_empty_paragraphs,
        test_contradiction_patterns,
        test_no_false_contradictions,
        test_web_search_no_api_key,
        test_relevance_scoring,
        test_relevance_scoring_term_overlap,
        test_db_path_resolution,
        test_entity_verify_scoring,
        test_citation_verify_term_overlap,
        test_relation_verify_implicit,
        test_context_role_caps,
        test_format_context_xml_structure,
    ]

    passed = 0
    failed = 0
    errors = []

    for test in tests:
        try:
            test()
            passed += 1
        except Exception as e:
            failed += 1
            errors.append((test.__name__, str(e)))
            print(f"FAIL: {test.__name__}: {e}")

    print(f"\n{'='*60}")
    print(f"Results: {passed} passed, {failed} failed out of {len(tests)} tests")
    if errors:
        for name, err in errors:
            print(f"  FAIL: {name}: {err}")
    print(f"{'='*60}")

    sys.exit(1 if failed > 0 else 0)
