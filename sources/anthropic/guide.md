# Anthropic API

Direct access to Anthropic's Claude AI models API.

## Scope

- List available models
- Create messages/completions with Claude models
- Manage and inspect model capabilities

## Guidelines

- Use `x-api-key` header for authentication
- Include `anthropic-version: 2023-06-01` header in requests
- Rate limits apply per organization - check headers for remaining quota
- Message API is the primary endpoint: `POST messages`

## API Reference

### GET /models
List all available Claude models.

### GET /models/{model_id}
Get details about a specific model.

### POST /messages
Create a message with a Claude model.

**Parameters:**
- `model` (string, required): Model ID (e.g., "claude-sonnet-4-5-20250929")
- `max_tokens` (number, required): Maximum tokens to generate
- `messages` (array, required): Conversation messages

**Example:**
```json
{
  "model": "claude-sonnet-4-5-20250929",
  "max_tokens": 1024,
  "messages": [
    { "role": "user", "content": "Hello, Claude!" }
  ]
}
```
