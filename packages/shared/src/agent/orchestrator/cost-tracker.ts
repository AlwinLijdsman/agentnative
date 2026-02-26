/**
 * Cost Tracker — Per-Stage Token Accounting & Budget Enforcement
 *
 * Tracks token usage per stage, calculates equivalent USD cost,
 * and enforces soft budget limits.
 *
 * Implements the CostTrackerPort interface from types.ts.
 *
 * Key design decisions:
 * - Claude Max subscription = flat fee, NOT per-token billing
 * - Cost tracking is informational: monitoring patterns, detecting runaway stages
 * - With adaptive thinking at effort 'max', output_tokens includes thinking tokens
 *   (thinking is billed as output at the same rate)
 * - Pricing rates are "equivalent" costs for monitoring — not actual charges
 * - Budget is a soft limit — pipeline stops gracefully, not mid-stream
 */

import type { CostTrackerPort, StageCostRecord, TokenUsage } from './types.ts';

// ============================================================================
// CONSTANTS — Opus 4.6 Equivalent Pricing
// ============================================================================

/**
 * Opus 4.6 input token cost per million tokens (USD).
 * This is the "equivalent" rate for monitoring — Claude Max users pay a flat subscription.
 */
const DEFAULT_INPUT_COST_PER_MTOK = 5.0;

/**
 * Opus 4.6 output token cost per million tokens (USD).
 * With adaptive thinking, output_tokens includes thinking tokens.
 * Thinking tokens are billed at the same output rate.
 */
const DEFAULT_OUTPUT_COST_PER_MTOK = 25.0;

/**
 * Default budget in USD. Generous default for Claude Max monitoring.
 * This is a soft limit — prevents runaway loops, not actual billing overages.
 */
const DEFAULT_BUDGET_USD = 50.0;

/** Tokens per million — used for cost calculation denominator. */
const TOKENS_PER_MILLION = 1_000_000;

// ============================================================================
// CONFIGURATION
// ============================================================================

/** Configuration for CostTracker pricing and budget. */
export interface CostTrackerConfig {
  /** Maximum budget in USD (soft limit). Default: $50. */
  budgetUsd?: number;
  /** Input token cost per million tokens. Default: $5.00 (Opus 4.6). */
  inputCostPerMTok?: number;
  /** Output token cost per million tokens. Default: $25.00 (Opus 4.6). */
  outputCostPerMTok?: number;
}

// ============================================================================
// COST TRACKER
// ============================================================================

/**
 * Per-stage cost tracker with budget enforcement.
 *
 * Mirrors gamma's CostTracker — records token usage per stage,
 * calculates USD equivalent, and checks against a soft budget limit.
 *
 * Usage:
 * ```typescript
 * const tracker = new CostTracker({ budgetUsd: 25.0 });
 * tracker.recordStage(0, { inputTokens: 5000, outputTokens: 2000 });
 * tracker.recordStage(1, { inputTokens: 80000, outputTokens: 50000 });
 * console.log(tracker.totalCostUsd);   // ~1.65
 * console.log(tracker.withinBudget()); // true
 * ```
 */
export class CostTracker implements CostTrackerPort {
  private readonly stageRecords = new Map<number, StageCostRecord>();
  private readonly budgetUsd: number;
  private readonly inputCostPerMTok: number;
  private readonly outputCostPerMTok: number;

  constructor(config?: CostTrackerConfig) {
    this.budgetUsd = config?.budgetUsd ?? DEFAULT_BUDGET_USD;
    this.inputCostPerMTok = config?.inputCostPerMTok ?? DEFAULT_INPUT_COST_PER_MTOK;
    this.outputCostPerMTok = config?.outputCostPerMTok ?? DEFAULT_OUTPUT_COST_PER_MTOK;
  }

  /**
   * Record token usage for a completed stage.
   *
   * If a stage is recorded multiple times (e.g., in a repair loop),
   * the new record ACCUMULATES with the previous one. Total cost is
   * always the sum of all records including repair iterations.
   *
   * With adaptive thinking at effort 'max':
   * - outputTokens includes both visible text AND thinking tokens
   * - Thinking tokens are billed at the same output rate
   * - The breakdown is not available in the API response
   *
   * @param stageId - Stage identifier (0-based)
   * @param usage - Token usage from the API response
   */
  recordStage(stageId: number, usage: TokenUsage): void {
    const costUsd = this.calculateCost(usage);
    const existing = this.stageRecords.get(stageId);
    if (existing) {
      // Accumulate costs across repair iterations — never lose previous data
      this.stageRecords.set(stageId, {
        stageId,
        usage: {
          inputTokens: existing.usage.inputTokens + usage.inputTokens,
          outputTokens: existing.usage.outputTokens + usage.outputTokens,
        },
        costUsd: existing.costUsd + costUsd,
      });
    } else {
      this.stageRecords.set(stageId, {
        stageId,
        usage,
        costUsd,
      });
    }
  }

  /**
   * Total equivalent USD cost across all recorded stages.
   *
   * For Claude Max subscriptions, this is an informational metric —
   * the user pays a flat subscription fee, not per-token.
   */
  get totalCostUsd(): number {
    let total = 0;
    for (const record of this.stageRecords.values()) {
      total += record.costUsd;
    }
    return total;
  }

  /**
   * Check if the pipeline is within budget.
   *
   * Returns false when totalCostUsd >= budgetUsd.
   * The orchestrator should stop gracefully when this returns false.
   */
  withinBudget(): boolean {
    return this.totalCostUsd < this.budgetUsd;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // REPORTING
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Get the cost record for a specific stage, or undefined if not recorded.
   */
  getStageRecord(stageId: number): StageCostRecord | undefined {
    return this.stageRecords.get(stageId);
  }

  /**
   * Get all stage cost records as an array, sorted by stage ID.
   */
  getAllRecords(): StageCostRecord[] {
    return [...this.stageRecords.values()].sort((a, b) => a.stageId - b.stageId);
  }

  /**
   * Total input tokens across all stages.
   */
  get totalInputTokens(): number {
    let total = 0;
    for (const record of this.stageRecords.values()) {
      total += record.usage.inputTokens;
    }
    return total;
  }

  /**
   * Total output tokens across all stages.
   * Includes thinking tokens when adaptive thinking is enabled.
   */
  get totalOutputTokens(): number {
    let total = 0;
    for (const record of this.stageRecords.values()) {
      total += record.usage.outputTokens;
    }
    return total;
  }

  /**
   * Number of stages recorded.
   */
  get stageCount(): number {
    return this.stageRecords.size;
  }

  /**
   * Configured budget in USD.
   */
  get budget(): number {
    return this.budgetUsd;
  }

  /**
   * Budget utilization as a percentage (0–100+).
   * Can exceed 100% if the last stage pushed over budget.
   */
  get budgetUtilizationPercent(): number {
    if (this.budgetUsd <= 0) return 0;
    return (this.totalCostUsd / this.budgetUsd) * 100;
  }

  /**
   * Generate a cost summary report.
   *
   * Useful for logging, debugging, and UI display.
   * Shows per-stage breakdown and totals.
   */
  generateReport(): CostReport {
    const records = this.getAllRecords();
    return {
      stages: records,
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      totalCostUsd: this.totalCostUsd,
      budgetUsd: this.budgetUsd,
      budgetUtilizationPercent: this.budgetUtilizationPercent,
      withinBudget: this.withinBudget(),
      pricing: {
        inputCostPerMTok: this.inputCostPerMTok,
        outputCostPerMTok: this.outputCostPerMTok,
      },
    };
  }

  /**
   * Reset all tracked state. Useful for testing or re-running a pipeline.
   */
  reset(): void {
    this.stageRecords.clear();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // INTERNAL
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Calculate USD cost from token usage.
   *
   * Formula: (input_tokens / 1M * inputRate) + (output_tokens / 1M * outputRate)
   *
   * With adaptive thinking, output_tokens already includes thinking tokens —
   * no separate calculation needed (Anthropic bills thinking as output).
   */
  private calculateCost(usage: TokenUsage): number {
    const inputCost = (usage.inputTokens / TOKENS_PER_MILLION) * this.inputCostPerMTok;
    const outputCost = (usage.outputTokens / TOKENS_PER_MILLION) * this.outputCostPerMTok;
    return inputCost + outputCost;
  }
}

// ============================================================================
// REPORT TYPE
// ============================================================================

/** Structured cost report for logging and UI display. */
export interface CostReport {
  /** Per-stage cost breakdown, sorted by stage ID. */
  stages: StageCostRecord[];
  /** Total input tokens across all stages. */
  totalInputTokens: number;
  /** Total output tokens across all stages (includes thinking tokens). */
  totalOutputTokens: number;
  /** Total equivalent USD cost. */
  totalCostUsd: number;
  /** Configured budget in USD. */
  budgetUsd: number;
  /** Budget utilization (0–100+%). */
  budgetUtilizationPercent: number;
  /** Whether the pipeline is within budget. */
  withinBudget: boolean;
  /** Pricing rates used for calculation. */
  pricing: {
    inputCostPerMTok: number;
    outputCostPerMTok: number;
  };
}
