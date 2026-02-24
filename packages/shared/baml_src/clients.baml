// BAML Client Definitions — Claude Max OAuth
//
// These clients are used by BAML functions for LLM calls.
// Authentication is injected at RUNTIME via client options override —
// the authToken from Claude Max OAuth is passed by baml-adapter.ts.
//
// Two client tiers:
// - ClaudeMax: Full-power model for synthesis (Stage 3)
// - ClaudeMaxLight: Same model, lower token budgets for lightweight stages (0, 1)

client<llm> ClaudeMax {
  provider anthropic
  options {
    model "claude-opus-4-6"
    max_tokens 128000
    // authToken injected at runtime via BAML client options override
    // See: packages/shared/src/agent/orchestrator/baml-adapter.ts
  }
}

client<llm> ClaudeMaxLight {
  provider anthropic
  options {
    model "claude-opus-4-6"
    max_tokens 16384
    // Used for lightweight stages (stage 0, stage 1) with lower token budgets
    // authToken injected at runtime
  }
}
