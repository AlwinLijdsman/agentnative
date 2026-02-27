/**
 * Agent State Handler — Tests
 *
 * Tests: init, read, update (replace-all semantics),
 * follow-up detection, error handling.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { handleAgentState } from '../agent-state.ts';
import { createMockContext, type TestContext } from './test-utils.ts';
import type { SessionToolContext } from '../../context.ts';

const AGENT_SLUG = 'test-agent';

function parseResult(result: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(result.content[0]!.text);
}

async function stateAction(
  ctx: SessionToolContext,
  action: 'init' | 'read' | 'update',
  data?: Record<string, unknown>,
) {
  return handleAgentState(ctx, { agentSlug: AGENT_SLUG, action, data });
}

describe('Agent State', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  // ============================================================
  // Init
  // ============================================================

  describe('init', () => {
    it('should create empty state.json', async () => {
      const result = parseResult(await stateAction(ctx, 'init'));
      assert.equal(result.initialized, true);
      assert.deepEqual(result.state, {});
    });

    it('should fail if state already exists', async () => {
      await stateAction(ctx, 'init');
      const result = await stateAction(ctx, 'init');
      assert.equal(result.isError, true);
    });
  });

  // ============================================================
  // Read
  // ============================================================

  describe('read', () => {
    it('should return initialized: false when no state', async () => {
      const result = parseResult(await stateAction(ctx, 'read'));
      assert.equal(result.initialized, false);
      assert.equal(result.state, null);
    });

    it('should return state after init', async () => {
      await stateAction(ctx, 'init');
      const result = parseResult(await stateAction(ctx, 'read'));
      assert.equal(result.initialized, true);
      assert.deepEqual(result.state, {});
    });

    it('should return state after updates', async () => {
      await stateAction(ctx, 'init');
      await stateAction(ctx, 'update', { queries: ['q1'], count: 1 });
      const result = parseResult(await stateAction(ctx, 'read'));
      const state = result.state as Record<string, unknown>;
      assert.deepEqual(state.queries, ['q1']);
      assert.equal(state.count, 1);
    });
  });

  // ============================================================
  // Update — Replace-All Semantics
  // ============================================================

  describe('update (replace-all semantics)', () => {
    it('should add new top-level keys', async () => {
      await stateAction(ctx, 'init');
      await stateAction(ctx, 'update', { a: 1, b: 'hello' });
      const state = (parseResult(await stateAction(ctx, 'read'))).state as Record<string, unknown>;
      assert.equal(state.a, 1);
      assert.equal(state.b, 'hello');
    });

    it('should replace top-level keys (NOT deep merge)', async () => {
      await stateAction(ctx, 'init');
      await stateAction(ctx, 'update', { a: 1, b: [1] });
      await stateAction(ctx, 'update', { b: [1, 2] });
      const state = (parseResult(await stateAction(ctx, 'read'))).state as Record<string, unknown>;
      assert.equal(state.a, 1);        // preserved
      assert.deepEqual(state.b, [1, 2]); // replaced, not merged
    });

    it('should replace nested objects entirely', async () => {
      await stateAction(ctx, 'init');
      await stateAction(ctx, 'update', { config: { theme: 'dark', font: 'mono' } });
      await stateAction(ctx, 'update', { config: { theme: 'light' } });
      const state = (parseResult(await stateAction(ctx, 'read'))).state as Record<string, unknown>;
      // { theme: 'light' } — NOT { theme: 'light', font: 'mono' }
      assert.deepEqual(state.config, { theme: 'light' });
    });

    it('should preserve keys not mentioned in update', async () => {
      await stateAction(ctx, 'init');
      await stateAction(ctx, 'update', { x: 10, y: 20, z: 30 });
      await stateAction(ctx, 'update', { y: 999 });
      const state = (parseResult(await stateAction(ctx, 'read'))).state as Record<string, unknown>;
      assert.equal(state.x, 10);
      assert.equal(state.y, 999);
      assert.equal(state.z, 30);
    });

    it('should work without prior init', async () => {
      await stateAction(ctx, 'update', { fresh: true });
      const state = (parseResult(await stateAction(ctx, 'read'))).state as Record<string, unknown>;
      assert.equal(state.fresh, true);
    });

    it('should require data parameter', async () => {
      const result = await stateAction(ctx, 'update');
      assert.equal(result.isError, true);
    });
  });

  // ============================================================
  // Follow-Up Detection
  // ============================================================

  describe('follow-up detection', () => {
    it('should accumulate queries across multiple updates', async () => {
      await stateAction(ctx, 'init');
      await stateAction(ctx, 'update', {
        queriesSoFar: ['What is ISA 200?'],
        sectionsCovered: ['Overview'],
        lastRunId: 'run-001',
        totalRuns: 1,
      });

      const prev = (parseResult(await stateAction(ctx, 'read'))).state as Record<string, unknown>;
      await stateAction(ctx, 'update', {
        queriesSoFar: [...(prev.queriesSoFar as string[]), 'ISA 200 vs ISA 315?'],
        sectionsCovered: [...(prev.sectionsCovered as string[]), 'Cross-refs'],
        lastRunId: 'run-002',
        totalRuns: 2,
      });

      const state = (parseResult(await stateAction(ctx, 'read'))).state as Record<string, unknown>;
      assert.equal((state.queriesSoFar as string[]).length, 2);
      assert.equal((state.sectionsCovered as string[]).length, 2);
      assert.equal(state.totalRuns, 2);
    });
  });

  // ============================================================
  // Error Handling
  // ============================================================

  describe('error handling', () => {
    it('should handle corrupted state.json on update', async () => {
      const statePath = join(
        ctx.workspacePath, 'sessions', ctx.sessionId, 'data', 'agents', AGENT_SLUG, 'state.json',
      );
      ctx.fs.writeFile(statePath, '{invalid!!!');
      const result = parseResult(await stateAction(ctx, 'update', { recovered: true }));
      assert.equal(result.initialized, true);
      assert.equal((result.state as Record<string, unknown>).recovered, true);
    });

    it('should error for unknown action', async () => {
      const result = await handleAgentState(ctx, {
        agentSlug: AGENT_SLUG,
        action: 'delete' as 'read',
      });
      assert.equal(result.isError, true);
    });
  });
});
