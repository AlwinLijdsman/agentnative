# Azure OpenAI (Sweden)

Secondary Azure OpenAI instance hosted in Sweden (gptogether-sweden).

## Scope

- Chat completions with GPT models
- Alternative region for redundancy or lower latency to EU
- Same capabilities as Swiss instance

## Guidelines

- Auth: `api-key` header
- API version required: `?api-version=2024-10-21`
- Chat completions: `POST openai/deployments/{deployment}/chat/completions?api-version=2024-10-21`
- List models: `GET openai/models?api-version=2024-10-21`

## API Reference

### GET /openai/models?api-version=2024-10-21
List available model deployments.

### POST /openai/deployments/{deployment}/chat/completions?api-version=2024-10-21
Create a chat completion.
