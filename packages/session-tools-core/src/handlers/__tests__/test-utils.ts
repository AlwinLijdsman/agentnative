/**
 * Test Utilities for Session Tools Core handlers.
 *
 * Uses REAL temp directories because handlers call mkdirSync, renameSync,
 * appendFileSync directly from node:fs (outside ctx.fs abstraction).
 */

import { join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { SessionToolContext, FileSystemInterface, SessionToolCallbacks } from '../../context.ts';

// ============================================================
// Simple Mock Function
// ============================================================

interface MockFn {
  (...args: unknown[]): void;
  calls: unknown[][];
  callCount: number;
}

export function mockFn(): MockFn {
  const calls: unknown[][] = [];
  const fn = ((...args: unknown[]) => {
    calls.push(args);
  }) as MockFn;
  fn.calls = calls;
  Object.defineProperty(fn, 'callCount', {
    get: () => calls.length,
  });
  return fn;
}

// ============================================================
// Real File System (uses actual temp dirs)
// ============================================================

function createRealFileSystem(): FileSystemInterface {
  return {
    exists: (path: string) => existsSync(path),
    readFile: (path: string) => readFileSync(path, 'utf-8'),
    readFileBuffer: (path: string) => readFileSync(path),
    writeFile: (path: string, content: string) => {
      const dir = join(path, '..');
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, content, 'utf-8');
    },
    isDirectory: (path: string) => existsSync(path) && statSync(path).isDirectory(),
    readdir: (path: string) => existsSync(path) ? readdirSync(path) : [],
    stat: (path: string) => {
      const s = statSync(path);
      return { size: s.size, isDirectory: () => s.isDirectory() };
    },
  };
}

// ============================================================
// Mock Callbacks
// ============================================================

export interface MockCallbacks extends SessionToolCallbacks {
  onAgentStagePause: MockFn;
  onAgentEvent: MockFn;
}

export function createMockCallbacks(): MockCallbacks {
  return {
    onPlanSubmitted: mockFn(),
    onAuthRequest: mockFn(),
    onAgentStagePause: mockFn(),
    onAgentEvent: mockFn(),
  };
}

// ============================================================
// Mock Session Tool Context (Real FS)
// ============================================================

const DEFAULT_SESSION_ID = 'test-session-001';

export interface TestContext extends SessionToolContext {
  tempDir: string;
  cleanup(): void;
}

export function createMockContext(
  overrides: Partial<{
    sessionId: string;
    callbacks: SessionToolCallbacks;
  }> = {},
): TestContext {
  const tempDir = mkdtempSync(join(tmpdir(), 'stage-gate-test-'));
  const workspacePath = tempDir;
  const sessionId = overrides.sessionId ?? DEFAULT_SESSION_ID;
  const callbacks = overrides.callbacks ?? createMockCallbacks();

  mkdirSync(join(workspacePath, 'sessions', sessionId, 'plans'), { recursive: true });

  const ctx: TestContext = {
    sessionId,
    workspacePath,
    get sourcesPath() { return join(workspacePath, 'sources'); },
    get skillsPath() { return join(workspacePath, 'skills'); },
    get agentsPath() { return join(workspacePath, 'agents'); },
    plansFolderPath: join(workspacePath, 'sessions', sessionId, 'plans'),
    callbacks,
    fs: createRealFileSystem(),
    loadSourceConfig: () => null,
    tempDir,
    cleanup() {
      rmSync(tempDir, { recursive: true, force: true });
    },
  };

  return ctx;
}

// ============================================================
// Test Agent Config
// ============================================================

/**
 * Extended test config with schema validation and error escalation.
 * Used by integration tests for realistic coverage.
 */
export const TEST_AGENT_CONFIG_EXTENDED = {
  controlFlow: {
    stages: [
      { id: 0, name: 'analyze_query', description: 'Analyze' },
      { id: 1, name: 'retrieve', description: 'Retrieve' },
      { id: 2, name: 'synthesize', description: 'Synthesize' },
      { id: 3, name: 'verify', description: 'Verify' },
      { id: 4, name: 'output', description: 'Output' },
    ],
    repairUnits: [
      { stages: [2, 3] as [number, number], maxIterations: 2, feedbackField: 'repair_instructions' },
    ],
    pauseAfterStages: [0],
    autoAdvance: true,
    pauseOnErrors: ['auth', 'config'],
    stageOutputSchemas: {
      '0': {
        required: ['query_plan'],
        properties: {
          query_plan: {
            type: 'object',
            required: ['original_query', 'sub_queries', 'depth_mode'],
            properties: {
              original_query: { type: 'string' },
              sub_queries: { type: 'array', minItems: 1 },
              depth_mode: { type: 'string', enum: ['quick', 'standard', 'deep'] },
            },
          },
        },
      },
    },
  },
  depthModes: {
    quick: { maxSubQueries: 3, maxParagraphsPerQuery: 10, maxRepairIterations: 0 },
    standard: { maxSubQueries: 8, maxParagraphsPerQuery: 20, maxRepairIterations: 2 },
    deep: { maxSubQueries: 15, maxParagraphsPerQuery: 30, maxRepairIterations: 3 },
  },
  verification: {
    entityGrounding: { threshold: 0.80 },
    citationAccuracy: { threshold: 0.75 },
  },
};

export const TEST_AGENT_CONFIG = {
  controlFlow: {
    stages: [
      { id: 0, name: 'analyze_query', description: 'Analyze' },
      { id: 1, name: 'retrieve', description: 'Retrieve' },
      { id: 2, name: 'synthesize', description: 'Synthesize' },
      { id: 3, name: 'verify', description: 'Verify' },
      { id: 4, name: 'output', description: 'Output' },
    ],
    repairUnits: [
      { stages: [2, 3], maxIterations: 2, feedbackField: 'repair_instructions' },
    ],
    pauseAfterStages: [0],
    autoAdvance: true,
  },
  depthModes: {
    quick: { maxSubQueries: 3, maxParagraphsPerQuery: 10, maxRepairIterations: 0 },
    standard: { maxSubQueries: 8, maxParagraphsPerQuery: 20, maxRepairIterations: 2 },
    deep: { maxSubQueries: 15, maxParagraphsPerQuery: 30, maxRepairIterations: 3 },
  },
  verification: {
    entityGrounding: { threshold: 0.80 },
    citationAccuracy: { threshold: 0.75 },
  },
};

export const TEST_AGENT_SLUG = 'test-agent';

export function createTestAgentContext(
  overrides?: Parameters<typeof createMockContext>[0],
): TestContext {
  const ctx = createMockContext(overrides);

  const agentDir = join(ctx.workspacePath, 'agents', TEST_AGENT_SLUG);
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(
    join(agentDir, 'config.json'),
    JSON.stringify(TEST_AGENT_CONFIG, null, 2),
  );

  return ctx;
}

/**
 * Create a test agent context with extended config (schemas, pauseOnErrors).
 * Used by integration tests.
 */
export function createExtendedTestAgentContext(
  overrides?: Parameters<typeof createMockContext>[0],
): TestContext {
  const ctx = createMockContext(overrides);

  const agentDir = join(ctx.workspacePath, 'agents', TEST_AGENT_SLUG);
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(
    join(agentDir, 'config.json'),
    JSON.stringify(TEST_AGENT_CONFIG_EXTENDED, null, 2),
  );

  return ctx;
}
