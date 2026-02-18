# Azure DeepSeek R1

DeepSeek R1 reasoning model deployed via Azure AI Model Catalog.

## Scope

- Advanced reasoning and chain-of-thought tasks
- Complex problem solving requiring step-by-step reasoning
- Code generation and mathematical analysis

## Guidelines

- Auth: `api-key` header
- Uses Azure AI inference API format (not OpenAI-compatible)
- Endpoint: `POST v1/chat/completions`
- Model info: `GET info`
- DeepSeek R1 excels at multi-step reasoning tasks

## API Reference

### GET /info
Get model information and capabilities.

### POST /v1/chat/completions
Create a chat completion with reasoning.

**Parameters:**
- `messages` (array, required): Conversation messages
- `temperature` (number): Sampling temperature
- `max_tokens` (number): Maximum tokens to generate
