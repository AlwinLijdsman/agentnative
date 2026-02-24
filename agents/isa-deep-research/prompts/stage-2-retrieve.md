# Stage 2: Retrieve

This stage is executed entirely by TypeScript via MCP tool calls. No LLM call is made.

## Retrieval Strategy (executed by code)

1. **Guide-first**: `isa_guide_search` → `isa_guide_to_isa_hop` → ISA paragraphs
2. **Direct ISA**: `isa_hybrid_search` per sub-query with optional `isa_filter`
3. **Multi-hop expansion**: `isa_hop_retrieve` for top results
4. **Deduplication**: By paragraph ID across all sub-queries
5. **Format context**: `isa_format_context` with role-grouped output

## Token Budget Allocation

| Role | Budget Share | Purpose |
|------|-------------|---------|
| `primary` | 60% | Deep coverage of primary ISA |
| `supporting` | 30% | Cross-references from related standards |
| `context` | 10% | Brief contextual references |
