# Azure AI Search

Full-text and vector search over document indexes (digitalauditor-search instance).

## Scope

- Search document indexes (e.g., `familychat-document-pages`)
- Full-text search with filters and facets
- Vector/hybrid search for semantic queries
- Index management and statistics

## Guidelines

- Auth: `api-key` header
- API version required: `?api-version=2024-07-01`
- Primary index: `familychat-document-pages`
- Search supports OData `$filter`, `$select`, `$top`, `$skip`
- Use `search=*` for all documents, or provide search terms

## API Reference

### GET /indexes?api-version=2024-07-01
List all search indexes.

### GET /indexes/{index}/docs?api-version=2024-07-01&search={query}
Search documents in an index.

**Parameters:**
- `search` (string): Search query (`*` for all)
- `$filter` (string): OData filter expression
- `$select` (string): Comma-separated fields to return
- `$top` (number): Max results
- `$skip` (number): Pagination offset

### POST /indexes/{index}/docs/search?api-version=2024-07-01
Advanced search with JSON body (supports vector search).

**Body:**
- `search` (string): Search text
- `filter` (string): OData filter
- `select` (string): Fields to return
- `top` (number): Max results
- `vectorQueries` (array): Vector search configuration
