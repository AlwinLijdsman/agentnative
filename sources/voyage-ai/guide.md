# Voyage AI

Text embeddings for semantic search, legal text analysis, and code similarity.

## Scope

- Generate text embeddings for semantic search
- Specialized models for legal text (voyage-law-2)
- Code embeddings (voyage-code-3)
- General purpose embeddings (voyage-3, voyage-3-lite)

## Guidelines

- Auth: Bearer token (Authorization header)
- All requests are POST to `/embeddings`
- Input can be a string or array of strings
- Max 128 inputs per batch
- Dimensions vary by model (voyage-3: 1024, voyage-3-lite: 512)

## API Reference

### POST /embeddings
Generate text embeddings.

**Parameters:**
- `input` (string or array, required): Text to embed
- `model` (string, required): Model name
  - `voyage-3` - Best general purpose (1024 dims)
  - `voyage-3-lite` - Faster, smaller (512 dims)
  - `voyage-law-2` - Legal text specialized
  - `voyage-code-3` - Code specialized
- `input_type` (string): `document` or `query` (optimizes for retrieval)
