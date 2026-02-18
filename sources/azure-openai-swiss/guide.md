# Azure OpenAI (Swiss)

Primary Azure OpenAI instance hosted in Switzerland (swiss-gpt-instance).

## Scope

- Chat completions with GPT models
- Text generation and reasoning tasks
- Model management and listing

## Guidelines

- Auth: `api-key` header
- API version required in all requests (e.g., `?api-version=2024-10-21`)
- Chat completions: `POST openai/deployments/{deployment}/chat/completions?api-version=2024-10-21`
- List models: `GET openai/models?api-version=2024-10-21`
- Rate limits apply per deployment

## API Reference

### GET /openai/models?api-version=2024-10-21
List available model deployments.

### POST /openai/deployments/{deployment}/chat/completions?api-version=2024-10-21
Create a chat completion.

**Parameters:**
- `messages` (array, required): Conversation messages
- `temperature` (number): Sampling temperature (0-2)
- `max_tokens` (number): Maximum tokens to generate
