# Stage 5: Output

This stage is executed entirely by TypeScript. No LLM call is made.

## Rendering (executed by code)

1. Build `sourceTexts` map from Stage 4's `source_texts` + fallback `isa_get_paragraph` calls
2. Call `renderDocument()` from session-tools-core to assemble the research document
3. Call `injectSourceBlocks()` to add verbatim ISA text after each section
4. Write output to `{{answerFile}}`

## What the Renderer Produces

- Executive summary with progressive disclosure
- Thematic sections with inline citations
- `> **Sources**` blockquotes with verbatim ISA paragraph text after each section
- Verification summary table (4-axis scores)
- Citations index
- Research decomposition appendix (sub-queries and roles)
