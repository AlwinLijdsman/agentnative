/**
 * Tests for SDK breakout auto-resume: deferred 'complete' event mechanism.
 *
 * Verifies the fix for the generator.return() propagation bug where yielding
 * {type:'complete'} inside chat()'s for-await loop during an SDK breakout
 * kills the generator chain before checkAndResumeBreakout() can execute.
 *
 * The fix: when _activeBreakoutMeta is set, intercept 'complete' events,
 * capture their usage data, and emit it via 'usage_update' post-loop. This
 * lets the for-await loop exit naturally so post-loop code is reachable.
 *
 * These tests use simplified async generators that mirror the real delegation
 * chain (sessions.ts consumer → executeSdkBreakoutStage → chat → SDK messages)
 * to verify the behavioral properties the fix relies on.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentEvent, AgentEventUsage } from '@craft-agent/core/types';

// ============================================================
// Simulated generator chain: mirrors the real delegation pattern
// ============================================================

/**
 * Simulates the BROKEN chat() inner loop — yields 'complete' unconditionally.
 * Consumer's generator.return() kills the chain before post-loop code runs.
 */
async function* brokenChatLoop(
  events: AgentEvent[],
  isBreakoutActive: boolean,
): AsyncGenerator<AgentEvent> {
  // Simulate for-await of SDK messages → convertSDKMessage → yield each event
  for (const event of events) {
    yield event;
  }
  // Post-loop: checkAndResumeBreakout() — UNREACHABLE if consumer returns on 'complete'
  if (isBreakoutActive) {
    yield { type: 'info', message: 'POST_LOOP_REACHED' };
  }
}

/**
 * Simulates the FIXED chat() inner loop — defers 'complete' when breakout active.
 * The for-await loop exits naturally, making post-loop code reachable.
 */
async function* fixedChatLoop(
  events: AgentEvent[],
  isBreakoutActive: boolean,
): AsyncGenerator<AgentEvent> {
  let deferredCompleteUsage: AgentEventUsage | undefined;

  for (const event of events) {
    if (event.type === 'complete') {
      if (isBreakoutActive) {
        deferredCompleteUsage = event.usage;
        continue; // Don't yield — let loop exit naturally
      }
    }
    yield event;
  }

  // Post-loop: emit deferred usage and check for breakout completion
  if (isBreakoutActive) {
    if (deferredCompleteUsage) {
      yield { type: 'usage_update', usage: deferredCompleteUsage };
    }
    yield { type: 'info', message: 'POST_LOOP_REACHED' };
  }
}

/**
 * Simulates sessions.ts consumer: returns on 'complete', killing the generator.
 */
async function consumeWithReturn(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const collected: AgentEvent[] = [];
  for await (const event of gen) {
    collected.push(event);
    if (event.type === 'complete') {
      return collected; // This triggers generator.return() on the generator
    }
  }
  return collected;
}

/**
 * Simulates sessions.ts consumer via yield* delegation (like executeSdkBreakoutStage).
 * The outer generator wraps the inner one with yield* and has post-delegation code.
 */
async function* wrapWithYieldStar(
  inner: AsyncGenerator<AgentEvent>,
): AsyncGenerator<AgentEvent> {
  yield* inner;
  // Post-delegation code (like executeSdkBreakoutStage's post-chat checks)
  yield { type: 'info', message: 'OUTER_POST_DELEGATION_REACHED' };
}

// ============================================================
// Tests
// ============================================================

describe('Breakout auto-resume: deferred complete mechanism', () => {
  const testUsage: AgentEventUsage = {
    inputTokens: 5000,
    outputTokens: 1200,
    cacheReadTokens: 3000,
    cacheCreationTokens: 500,
    costUsd: 0.042,
    contextWindow: 200000,
  };

  const sdkEvents: AgentEvent[] = [
    { type: 'text_complete', text: 'Stage 1 complete.', isIntermediate: false },
    { type: 'complete', usage: testUsage },
  ];

  describe('generator.return() propagation (demonstrates the bug)', () => {
    it('BROKEN: consumer return on complete kills post-loop code', async () => {
      const gen = brokenChatLoop(sdkEvents, true);
      const events = await consumeWithReturn(gen);

      // Consumer gets text_complete and complete, then returns
      assert.equal(events.length, 2);
      assert.equal(events[0]!.type, 'text_complete');
      assert.equal(events[1]!.type, 'complete');
      // POST_LOOP_REACHED was never yielded — generator.return() killed it
    });

    it('BROKEN: yield* delegation chain is killed by generator.return()', async () => {
      const inner = brokenChatLoop(sdkEvents, true);
      const outer = wrapWithYieldStar(inner);
      const events = await consumeWithReturn(outer);

      // Consumer returns on 'complete' — kills both inner and outer generators
      assert.equal(events.length, 2);
      const types = events.map(e => e.type);
      assert.ok(!types.includes('info'), 'Post-loop and post-delegation code should be unreachable');
    });
  });

  describe('deferred complete (the fix)', () => {
    it('post-loop code is reachable when complete is deferred', async () => {
      const gen = fixedChatLoop(sdkEvents, true);
      // Consume ALL events (no early return on complete)
      const events: AgentEvent[] = [];
      for await (const event of gen) {
        events.push(event);
      }

      const types = events.map(e => e.type);
      // 'complete' should NOT appear (it was deferred)
      assert.ok(!types.includes('complete'), 'complete should not be yielded during breakout');
      // POST_LOOP_REACHED should appear
      assert.ok(types.includes('info'), 'Post-loop code should be reachable');
      const postLoopEvent = events.find(e => e.type === 'info' && 'message' in e && e.message === 'POST_LOOP_REACHED');
      assert.ok(postLoopEvent, 'POST_LOOP_REACHED marker should be present');
    });

    it('deferred usage is emitted as usage_update with full data', async () => {
      const gen = fixedChatLoop(sdkEvents, true);
      const events: AgentEvent[] = [];
      for await (const event of gen) {
        events.push(event);
      }

      const usageEvent = events.find(e => e.type === 'usage_update');
      assert.ok(usageEvent, 'usage_update should be emitted with deferred usage');
      assert.equal(usageEvent!.type, 'usage_update');
      if (usageEvent!.type === 'usage_update') {
        assert.equal(usageEvent!.usage.inputTokens, 5000);
        // With widened type, outputTokens et al. should be present
        const usage = usageEvent!.usage as AgentEventUsage;
        assert.equal(usage.outputTokens, 1200);
        assert.equal(usage.costUsd, 0.042);
        assert.equal(usage.cacheReadTokens, 3000);
        assert.equal(usage.cacheCreationTokens, 500);
        assert.equal(usage.contextWindow, 200000);
      }
    });

    it('sessions.ts consumer return does NOT kill chain when complete is deferred', async () => {
      const inner = fixedChatLoop(sdkEvents, true);
      const outer = wrapWithYieldStar(inner);

      // Consumer that returns on 'complete' — but there IS no 'complete' event
      const events = await consumeWithReturn(outer);

      // Since complete was deferred, consumer never returns early.
      // All events including post-loop and post-delegation are collected.
      const types = events.map(e => e.type);
      assert.ok(!types.includes('complete'), 'No complete event should be yielded');
      assert.ok(types.includes('usage_update'), 'usage_update should be present');
      // Both POST_LOOP_REACHED and OUTER_POST_DELEGATION_REACHED should appear
      const infoMessages = events
        .filter((e): e is AgentEvent & { type: 'info'; message: string } => e.type === 'info')
        .map(e => e.message);
      assert.ok(infoMessages.includes('POST_LOOP_REACHED'), 'Inner post-loop code should run');
      assert.ok(infoMessages.includes('OUTER_POST_DELEGATION_REACHED'), 'Outer post-delegation code should run');
    });

    it('non-breakout path still yields complete normally', async () => {
      const gen = fixedChatLoop(sdkEvents, false);
      const events: AgentEvent[] = [];
      for await (const event of gen) {
        events.push(event);
      }

      const types = events.map(e => e.type);
      // In non-breakout mode, complete should be yielded normally
      assert.ok(types.includes('complete'), 'complete should be yielded when not in breakout');
      // No usage_update should be emitted (not deferred)
      assert.ok(!types.includes('usage_update'), 'No usage_update when not deferring');
      // No post-loop breakout code should run
      const infoMessages = events
        .filter((e): e is AgentEvent & { type: 'info'; message: string } => e.type === 'info')
        .map(e => e.message);
      assert.ok(!infoMessages.includes('POST_LOOP_REACHED'), 'Post-loop breakout code should not run in non-breakout mode');
    });
  });

  describe('usage_update type compatibility', () => {
    it('AgentEventUsage is assignable to usage_update usage field', () => {
      // This test verifies the widened type works at runtime
      const fullUsage: AgentEventUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        costUsd: 0.01,
        contextWindow: 200000,
      };

      // Construct a usage_update event with full usage data
      const event: AgentEvent = { type: 'usage_update', usage: fullUsage };
      assert.equal(event.type, 'usage_update');
      if (event.type === 'usage_update') {
        assert.equal(event.usage.inputTokens, 1000);
      }
    });

    it('minimal usage (inputTokens only) still works with usage_update', () => {
      const minimalUsage = { inputTokens: 2000 };
      const event: AgentEvent = { type: 'usage_update', usage: minimalUsage };
      assert.equal(event.type, 'usage_update');
      if (event.type === 'usage_update') {
        assert.equal(event.usage.inputTokens, 2000);
      }
    });
  });
});
