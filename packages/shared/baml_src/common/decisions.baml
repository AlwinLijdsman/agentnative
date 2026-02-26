// Common Decision Types — Reusable across all agents
//
// Mirrors gamma's decisions.baml. Generic decision structures
// for binary and scored evaluations.

class BinaryDecision {
  decision bool @description("The yes/no decision")
  reasoning string @description("Explanation for the decision")
  confidence float @description("0.0-1.0 confidence in the decision")
}

class ScoredDecision {
  score float @description("0.0-1.0 score")
  reasoning string @description("Explanation for the score")
  factors string[] @description("Key factors that influenced the score")
}
