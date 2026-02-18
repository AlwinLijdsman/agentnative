# Brave Search

Web, news, and image search via the Brave Search API.

## Scope

- Web search with rich snippets and descriptions
- News search for recent articles
- Image search
- No tracking, privacy-focused search

## Guidelines

- Auth: `X-Subscription-Token` header
- All endpoints are GET requests with query parameters
- Default result count: 20, max: 100
- Rate limits depend on plan (Free: 1 req/sec, 2000/month)
- Use `count` parameter to limit results
- Supports `freshness` parameter for time-based filtering

## API Reference

### GET /web/search
Search the web.

**Parameters:**
- `q` (string, required): Search query
- `count` (number): Results per page (default: 20, max: 100)
- `offset` (number): Pagination offset
- `freshness` (string): Filter by recency (`pd` = past day, `pw` = past week, `pm` = past month)
- `country` (string): Country code (e.g., `US`, `CH`)

### GET /news/search
Search for news articles.

**Parameters:**
- `q` (string, required): Search query
- `count` (number): Results per page
- `freshness` (string): Time filter

### GET /images/search
Search for images.

**Parameters:**
- `q` (string, required): Search query
- `count` (number): Results per page
