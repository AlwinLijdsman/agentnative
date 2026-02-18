# Azure Embeddings

Text embedding-3-large model (3072 dimensions) via Azure OpenAI for semantic search.

## Scope

- Generate high-dimensional text embeddings (3072 dims)
- Semantic search and similarity matching
- RAG (Retrieval-Augmented Generation) pipelines

## Guidelines

- Auth: `api-key` header
- Deployment: `text-embedding-3-large`
- Full endpoint: `POST openai/deployments/text-embedding-3-large/embeddings?api-version=2023-05-15`
- Max input tokens: 8191 per text
- Batch up to 2048 inputs per request
- Output: 3072-dimensional vectors

## API Reference

### POST /openai/deployments/text-embedding-3-large/embeddings?api-version=2023-05-15
Generate text embeddings.

**Parameters:**
- `input` (string or array, required): Text to embed
- `dimensions` (number): Output dimensions (default: 3072, can reduce for efficiency)
