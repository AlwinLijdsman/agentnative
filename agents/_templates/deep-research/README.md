# Deep Research Agent Template

Create a new multi-stage research agent from this template. The orchestrator drives a deterministic stage pipeline (Analyze → Retrieve → Synthesize → Verify → Output) with repair loops, verification axes, and progressive disclosure.

**Architecture: Orchestrator-driven.** Stage logic lives in `prompts/stage-*.md` files. Pipeline configuration lives in `config.json`. `AGENT.md` provides frontmatter metadata only (name, description, sources) — the body is intentionally empty.

## Prerequisites

- A working MCP source that provides search, retrieval, and verification tools
- The MCP source must be registered in the workspace `sources/` directory
- Brave Search API key (optional, for web calibration in Stage 0)

## Step-by-Step Guide

### 1. Choose your agent slug

Pick a kebab-case slug for your agent (e.g., `gaap-deep-research`, `gdpr-deep-research`).

```
agents/
└── {your-slug}/
    ├── AGENT.md          ← Frontmatter metadata only (name, description, sources)
    ├── config.json       ← Pipeline config (stages, depth modes, verification)
    ├── icon.svg
    └── prompts/          ← Stage logic (one .md file per stage)
        ├── stage-0-analyze.md
        ├── stage-1-retrieve.md
        ├── stage-2-synthesize.md
        ├── stage-3-verify.md
        └── stage-4-output.md
```

### 2. Define your placeholders

Fill in these values before generating from the template:

| Placeholder | Description | Example (ISA) |
|-------------|-------------|---------------|
| `{{AGENT_SLUG}}` | Kebab-case agent ID | `isa-deep-research` |
| `{{DOMAIN_NAME}}` | Human-readable domain name | `ISA` |
| `{{KB_DESCRIPTION}}` | What the knowledge base contains | `International Standards on Auditing (ISA)` |
| `{{KB_SOURCE_SLUG}}` | MCP source slug from `sources/` | `isa-knowledge-base` |
| `{{MCP_TOOLS}}` | YAML list of tool names (indented 6 spaces) | See below |
| `{{SEARCH_TOOL}}` | Primary search tool name | `isa_hybrid_search` |
| `{{HOP_TOOL}}` | Graph traversal tool name | `isa_hop_retrieve` |
| `{{FORMAT_TOOL}}` | Context formatter tool name | `isa_format_context` |
| `{{WEB_SEARCH_TOOL}}` | Web search tool name | `isa_web_search` |
| `{{CITATION_FORMAT}}` | Citation display format | `ISA {number}.{paragraph}` |

### 3. Configure depth modes

| Placeholder | Quick | Standard | Deep |
|-------------|-------|----------|------|
| `{{QUICK_SUB_QUERIES}}` | 3 | — | — |
| `{{STANDARD_SUB_QUERIES}}` | — | 8 | — |
| `{{DEEP_SUB_QUERIES}}` | — | — | 15 |
| `{{QUICK_MAX_PARAGRAPHS}}` | 10 | — | — |
| `{{STANDARD_MAX_PARAGRAPHS}}` | — | 20 | — |
| `{{DEEP_MAX_PARAGRAPHS}}` | — | — | 30 |
| `{{STANDARD_REPAIR_ITERATIONS}}` | — | 2 | — |
| `{{DEEP_REPAIR_ITERATIONS}}` | — | — | 3 |
| `{{QUICK_TOKEN_BUDGET}}` | 4000 | — | — |
| `{{STANDARD_TOKEN_BUDGET}}` | — | 8000 | — |
| `{{DEEP_TOKEN_BUDGET}}` | — | — | 16000 |

### 4. Define verification axes

The template supports N verification axes. For each axis, define:

| Placeholder | Description | Example (ISA — 4 axes) |
|-------------|-------------|------------------------|
| `{{VERIFICATION_AXIS_COUNT}}` | Number of verification axes | `4` |
| `{{VERIFICATION_AXIS_ABBREVIATIONS}}` | Comma-separated abbreviations | `EG, CA, RP, CD` |
| `{{VERIFICATION_AXES}}` | Markdown describing each axis and its tool call | See ISA example |
| `{{VERIFICATION_THRESHOLDS}}` | Markdown listing each threshold | See ISA example |
| `{{VERIFICATION_SCORE_TEMPLATE}}` | JSON template for score output | See ISA example |
| `{{VERIFICATION_CONFIG}}` | JSON config block for thresholds | See ISA example |

**ISA example — `{{VERIFICATION_AXES}}`:**
```markdown
1. **Entity Grounding** — Call `isa_entity_verify(entities, source_paragraph_ids)` with entities from Stage 2
2. **Citation Accuracy** — Call `isa_citation_verify(citations)` with citations from Stage 2
3. **Relation Preservation** — Call `isa_relation_verify(relations)` with relations from Stage 2
4. **Contradiction Detection** — Call `isa_contradiction_check(paragraph_ids)` with all cited paragraph IDs
```

**ISA example — `{{VERIFICATION_CONFIG}}`:**
```json
"entityGrounding": { "threshold": 0.80 },
"relationPreservation": { "threshold": 0.70 },
"citationAccuracy": { "threshold": 0.75 },
"contradictions": { "maxUnresolved": 0 }
```

### 5. Define synthesis behaviors

| Placeholder | Description |
|-------------|-------------|
| `{{SYNTHESIS_BEHAVIOR_COUNT}}` | Number of synthesis behaviors (ISA uses 12) |
| `{{SYNTHESIS_BEHAVIORS}}` | Numbered markdown list of all synthesis behaviors |

The ISA agent uses these 12 behaviors: Structured Organization, Source-First Attribution, Requirement Classification, Cross-Source Linking, Practical Application, Scope Boundaries, Effective Date Awareness, Professional Judgment Indicators, Risk-Based Framing, Completeness Check, Confidence Calibration, Progressive Disclosure.

Adapt these to your domain. The minimum recommended set is:
1. Structured Organization
2. Source-First Attribution (every claim cites a specific source)
3. Completeness Check (verify all sub-queries addressed)
4. Confidence Calibration (high/medium/low per section)
5. Progressive Disclosure (lead with direct answer)

### 6. Configure web search domains

| Placeholder | Description | Example |
|-------------|-------------|---------|
| `{{WEB_SEARCH_DOMAINS}}` | JSON array entries (indented 8 spaces) | See ISA example |

**ISA example:**
```json
        "ifac.org",
        "iaasb.org",
        "pcaobus.org",
        "aicpa.org",
        "accountancyeurope.eu"
```

### 7. Configure MCP tools list

The `{{MCP_TOOLS}}` placeholder is a YAML list for the AGENT.md frontmatter:

```yaml
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
```

### 8. Write stage prompts

Create a `prompts/` directory in your agent folder. Write one markdown file per stage:

| File | Purpose |
|------|---------|
| `stage-0-analyze.md` | Query decomposition, clarity gate, sub-query generation |
| `stage-1-retrieve.md` | Search strategy, hop traversal, context formatting |
| `stage-2-synthesize.md` | Synthesis instructions, citation format, section structure |
| `stage-3-verify.md` | Verification axes, threshold checks, repair instructions |
| `stage-4-output.md` | Output rendering, state update, file writing |

Each prompt file is injected by the orchestrator as the system prompt for that stage. The orchestrator automatically provides stage context (previous stage outputs, pipeline state) — your prompts focus on domain-specific instructions.

See `agents/isa-deep-research/prompts/` for the reference implementation.

### 9. Generate the config files

Replace all `{{PLACEHOLDER}}` values in both templates and save as:
- `agents/{your-slug}/AGENT.md` (frontmatter-only, from `AGENT.md.template`)
- `agents/{your-slug}/config.json` (from `config.json.template`)

### 10. Add an icon

Create or copy an `icon.svg` to `agents/{your-slug}/icon.svg`. Recommended: 24x24 viewBox, single-color design that represents the domain.

### 11. Validate

Run the agent validator to check your configuration:

```
agent_validate({ agentSlug: "{your-slug}" })
```

This checks:
- AGENT.md has valid YAML frontmatter with required `name` and `description` fields
- AGENT.md body may be empty (expected for orchestrator-driven agents)
- config.json has valid `controlFlow` with sequential stage IDs starting at 0
- `repairUnits` reference valid stage pairs
- `pauseAfterStages` reference valid stage IDs
- Required sources exist in the workspace

## Architecture Reference

The `AgentOrchestrator` drives execution as a deterministic TypeScript for-loop over stages defined in `config.json`. Each stage loads its prompt from `prompts/stage-N-*.md`.

```
AgentOrchestrator.run()
  │
  for each stage in config.controlFlow.stages:
  │   ├── StageRunner.runStage(N)
  │   │     └── loads prompts/stage-N-*.md as system prompt
  │   │     └── Claude SDK query() with stage context
  │   ├── pause check (if N in pauseAfterStages)
  │   └── repair loop (if stage is in a repairUnit and verification failed)
  │
  └── pipeline complete
```

Key properties:
- **Deterministic** — stages run in order, no SDK tool-calling for flow control
- **Repair loop** — re-runs Synthesize → Verify until all thresholds pass (or max iterations)
- **Pause after Stage 0** — lets the user review the query plan before retrieval begins
- **AGENT.md** — frontmatter-only metadata (name, description, sources) consumed by the UI
- **Follow-up protocol** — uses accumulated state for delta retrieval across runs

## Quick Reference: ISA Deep Research

The reference implementation (`agents/isa-deep-research/`) uses:
- 10 MCP tools from `isa-knowledge-base` source
- 4 verification axes (EG 0.80, CA 0.75, RP 0.70, CD 0)
- 12 synthesis behaviors
- 3 depth modes (quick/standard/deep)
- Brave Search with 5 preferred ISA/audit domains
- Citation format: `ISA {number}.{paragraph}`
