---
name: ISA Deep Research
description: Multi-stage research agent for ISA standards with hybrid search, 4-axis verification, and progressive disclosure output
sources:
  - slug: isa-knowledge-base
    required: true
    tools:
      - isa_hybrid_search
      - isa_hop_retrieve
      - isa_list_standards
      - isa_get_paragraph
      - isa_entity_verify
      - isa_citation_verify
      - isa_relation_verify
      - isa_contradiction_check
      - isa_format_context
      - isa_web_search
      - isa_guide_search
      - isa_guide_to_isa_hop
      - isa_list_guides
      - isa_multi_tier_search
      - isa_kb_status
      - isa_debug_hop_trace
---

<!-- Orchestrator-driven agent. Stage logic lives in prompts/stage-*.md, pipeline config in config.json. -->
