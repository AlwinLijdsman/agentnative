# Stage 4: Verify

This stage is executed entirely by TypeScript via MCP tool calls. No LLM call is made.

## 4-Axis Verification (executed by code)

1. **Entity Grounding** — `isa_entity_verify(entities, source_paragraph_ids)`
   - Checks entities against ISAParagraph and GuideSection content
   - Threshold: {{entityGroundingThreshold}}

2. **Citation Accuracy** — `isa_citation_verify(citations)`
   - Verifies each citation exists and supports the claim
   - Match levels: exact (>= 60%), partial (30–59%), content_mismatch (< 30%), not_found
   - Threshold: {{citationAccuracyThreshold}}

3. **Relation Preservation** — `isa_relation_verify(relations)`
   - Validates cross-references between paragraphs
   - Threshold: {{relationPreservationThreshold}}

4. **Contradiction Detection** — `isa_contradiction_check(paragraph_ids)`
   - Checks for contradictions between cited paragraphs
   - Max unresolved: {{contradictionsMaxUnresolved}}

## Source Text Backfill

Extract `source_text` from `isa_citation_verify` results to build the source_texts map for Stage 5 output rendering.

## Repair Decision

If any axis fails its threshold, generate `repair_instructions` with error categories:
- `CONTENT_MISMATCH`: Rewrite claim or replace citation
- `SUB_PARA_NOT_FOUND`: Cite parent paragraph instead
- `NOT_FOUND`: Remove citation or replace via search
- `WRONG_REF`: Look up correct paragraph
