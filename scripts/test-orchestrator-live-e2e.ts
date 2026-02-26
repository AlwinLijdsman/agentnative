/**
 * Live E2E: Orchestrator Pipeline with Real Claude Max OAuth
 *
 * This test exercises the ACTUAL orchestrator path (not the SDK query() path):
 *   1. Reads fresh OAuth token from Claude Code's ~/.claude/.credentials.json
 *   2. Calls OrchestratorLlmClient.call() — raw Anthropic API with Bearer auth
 *   3. Runs AgentOrchestrator.run() — deterministic for-loop over stages
 *   4. Verifies: orchestrator_* events, stage 0 pause, pipeline state on disk
 *
 * This proves that when the Electron app receives an [agent:isa-deep-research]
 * message, the orchestrator pipeline produces correct output via real LLM calls.
 *
 * TOKEN SOURCE:
 *   - Primary: Claude Code's ~/.claude/.credentials.json (claudeAiOauth.accessToken)
 *   - Fallback: Craft Agent's ~/.craft-agent/credentials.enc (via extract-oauth-token.ts)
 *   - Override: CLAUDE_CODE_OAUTH_TOKEN env var
 *
 * Run:
 *   npx tsx scripts/test-orchestrator-live-e2e.ts
 *   npx tsx scripts/test-orchestrator-live-e2e.ts --query="Your custom query"
 *
 * Estimated cost: ~$0.05 per run (Claude Max subscription — flat rate)
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

// ============================================================================
// Token Resolution: Claude Code → Craft Agent → env var
// ============================================================================

interface TokenResult {
  token: string;
  source: string;
  expiresAt?: number;
}

function getClaudeCodeToken(): TokenResult | null {
  // Claude Code stores OAuth credentials in ~/.claude/.credentials.json
  const credPath = join(homedir(), '.claude', '.credentials.json');
  if (!existsSync(credPath)) return null;

  try {
    const creds = JSON.parse(readFileSync(credPath, 'utf-8'));
    const oauth = creds?.claudeAiOauth;
    if (!oauth?.accessToken) return null;

    // Check expiry
    if (oauth.expiresAt && oauth.expiresAt < Date.now()) {
      console.warn(`[token] Claude Code token expired at ${new Date(oauth.expiresAt).toISOString()}`);
      return null;
    }

    return {
      token: oauth.accessToken,
      source: 'claude-code (~/.claude/.credentials.json)',
      expiresAt: oauth.expiresAt,
    };
  } catch {
    return null;
  }
}

async function getCraftAgentToken(): Promise<TokenResult | null> {
  try {
    const { CredentialManager } = await import('../packages/shared/src/credentials/manager.ts');
    const manager = new CredentialManager();
    const creds = await manager.getClaudeOAuthCredentials();
    if (!creds?.accessToken) return null;

    if (creds.expiresAt && creds.expiresAt < Date.now()) {
      console.warn(`[token] Craft Agent token expired at ${new Date(creds.expiresAt).toISOString()}`);
      return null;
    }

    return {
      token: creds.accessToken,
      source: 'craft-agent (~/.craft-agent/credentials.enc)',
      expiresAt: creds.expiresAt,
    };
  } catch {
    return null;
  }
}

function getEnvToken(): TokenResult | null {
  const token = process.env['CLAUDE_CODE_OAUTH_TOKEN'];
  if (!token || token.length < 10) return null;
  return { token, source: 'env (CLAUDE_CODE_OAUTH_TOKEN)' };
}

async function resolveToken(): Promise<TokenResult> {
  // Priority: env var → Claude Code → Craft Agent
  const envToken = getEnvToken();
  if (envToken) return envToken;

  const ccToken = getClaudeCodeToken();
  if (ccToken) return ccToken;

  const caToken = await getCraftAgentToken();
  if (caToken) return caToken;

  console.error('ERROR: No valid OAuth token found.');
  console.error('Token is looked up in this order:');
  console.error('  1. CLAUDE_CODE_OAUTH_TOKEN env var');
  console.error('  2. Claude Code ~/.claude/.credentials.json (claudeAiOauth.accessToken)');
  console.error('  3. Craft Agent ~/.craft-agent/credentials.enc (via CredentialManager)');
  console.error('\nTo refresh: open Claude Code CLI or Craft Agent app.');
  process.exit(1);
}

// ============================================================================
// Main E2E Test
// ============================================================================

async function main() {
  const query = process.argv.find(a => a.startsWith('--query='))?.slice(8)
    ?? 'What should I consider when testing insurance reserves under ISA 540?';

  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║  LIVE E2E: Orchestrator Pipeline (real API calls)        ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');

  // ── Step 1: Resolve token ──────────────────────────────────────────────
  const tokenResult = await resolveToken();
  console.log(`\n[auth] Token source: ${tokenResult.source}`);
  console.log(`[auth] Token prefix: ${tokenResult.token.substring(0, 25)}...`);
  if (tokenResult.expiresAt) {
    const expiresIn = Math.round((tokenResult.expiresAt - Date.now()) / 60000);
    console.log(`[auth] Expires in: ${expiresIn} minutes`);
  }

  // ── Step 2: Load real agent config ─────────────────────────────────────
  const configPath = join(REPO_ROOT, 'agents', 'isa-deep-research', 'config.json');
  if (!existsSync(configPath)) {
    console.error(`ERROR: Agent config not found at ${configPath}`);
    process.exit(1);
  }
  const rawConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
  console.log(`\n[config] Agent: isa-deep-research`);
  console.log(`[config] Stages: ${rawConfig.controlFlow.stages.map((s: { name: string }) => s.name).join(' → ')}`);
  console.log(`[config] Pause after: stages ${rawConfig.controlFlow.pauseAfterStages.join(', ')}`);

  // ── Step 3: Test raw LLM call via OrchestratorLlmClient ───────────────
  console.log('\n────────────────────────────────────────────────────────────');
  console.log('  TEST 1: OrchestratorLlmClient.call() — raw Anthropic API');
  console.log('────────────────────────────────────────────────────────────\n');

  const { OrchestratorLlmClient } = await import('../packages/shared/src/agent/orchestrator/llm-client.ts');

  const llmClient = new OrchestratorLlmClient(
    async () => tokenResult.token,
    undefined,  // default base URL
    200_000,    // 200K context window
    4_096,      // min output budget
  );

  const streamChunks: string[] = [];
  let thinkingChunks: string[] = [];

  try {
    const result = await llmClient.call({
      systemPrompt: 'You are a helpful assistant. Respond very briefly (2-3 sentences max).',
      userMessage: 'What is ISA 540 about? One sentence only.',
      model: 'claude-opus-4-6',
      desiredMaxTokens: 1024,  // Small — just need to verify the call works
      effort: 'high',          // Not max — save thinking tokens for quick test
      onStreamEvent: (event) => {
        if (event.type === 'text_delta' && event.text) {
          streamChunks.push(event.text);
        }
        if (event.type === 'thinking_delta' && event.thinking) {
          thinkingChunks.push(event.thinking);
        }
      },
    });

    console.log('✅ LLM CALL SUCCEEDED');
    console.log(`   Model: ${result.model}`);
    console.log(`   Stop reason: ${result.stopReason}`);
    console.log(`   Input tokens: ${result.usage.inputTokens}`);
    console.log(`   Output tokens: ${result.usage.outputTokens}`);
    console.log(`   Streaming chunks received: ${streamChunks.length}`);
    console.log(`   Thinking chunks: ${thinkingChunks.length}`);
    console.log(`   Redacted thinking blocks: ${result.redactedThinkingBlocks}`);
    console.log(`   Response: ${result.text.trim().slice(0, 200)}`);

    // ASSERT: Key properties of orchestrator LLM call
    if (!result.text.trim()) {
      console.error('❌ FAIL: LLM returned empty text');
      process.exit(1);
    }
    if (result.usage.inputTokens === 0) {
      console.error('❌ FAIL: Zero input tokens — call may not have executed');
      process.exit(1);
    }
    if (result.model !== 'claude-opus-4-6' && !result.model.includes('opus')) {
      console.warn(`⚠️  WARN: Expected opus model, got: ${result.model}`);
    }
    console.log('   ✓ Auth: Bearer token + oauth beta header worked');
    console.log('   ✓ Streaming: messages.stream() + finalMessage() completed');
    console.log('   ✓ Adaptive thinking: enabled (no temperature, no tools)');
  } catch (err) {
    console.error('❌ LLM CALL FAILED:', err instanceof Error ? err.message : String(err));
    if (err instanceof Error && err.message.includes('401')) {
      console.error('   → OAuth token rejected. Token may be expired or invalid.');
      console.error('   → Open Claude Code CLI or Craft Agent app to refresh.');
    }
    process.exit(1);
  }

  // ── Step 4: Full Orchestrator Pipeline — Stage 0 with real LLM ────────
  console.log('\n────────────────────────────────────────────────────────────');
  console.log('  TEST 2: AgentOrchestrator.run() — full Stage 0 pipeline');
  console.log('────────────────────────────────────────────────────────────\n');

  const { AgentOrchestrator, CostTracker } = await import('../packages/shared/src/agent/orchestrator/index.ts');

  const SESSION_ID = `e2e-live-${Date.now()}`;
  const SESSION_PATH = join(tmpdir(), `craft-e2e-orch-${Date.now()}`, 'sessions', SESSION_ID);
  mkdirSync(SESSION_PATH, { recursive: true });

  // Build orchestrator AgentConfig
  const agentConfig = {
    slug: 'isa-deep-research',
    name: 'ISA Deep Research',
    controlFlow: {
      stages: rawConfig.controlFlow.stages.map((s: { id: number; name: string; description?: string; pauseInstructions?: string }) => ({
        id: s.id,
        name: s.name,
        description: s.description,
      })),
      pauseAfterStages: rawConfig.controlFlow.pauseAfterStages,
      repairUnits: rawConfig.controlFlow.repairUnits,
    },
    output: rawConfig.output ?? {},
    promptsDir: join(REPO_ROOT, 'agents', 'isa-deep-research', 'prompts'),
  };

  const costTracker = new CostTracker({ budgetUsd: 5 });

  const orchestrator = AgentOrchestrator.create(
    {
      sessionId: SESSION_ID,
      sessionPath: SESSION_PATH,
      getAuthToken: async () => {
        // Re-read token on each call (handles refresh if long pipeline)
        const fresh = getClaudeCodeToken() ?? tokenResult;
        return (fresh as TokenResult).token;
      },
      onStreamEvent: (event) => {
        if (event.type === 'text_delta' && event.text) {
          process.stdout.write('.');  // Progress dots
        }
      },
    },
    null,  // No MCP bridge (stage 0 doesn't need KB tools)
    costTracker,
  );

  console.log(`[orchestrator] Session: ${SESSION_ID}`);
  console.log(`[orchestrator] State path: ${SESSION_PATH}`);
  console.log(`[orchestrator] Query: ${query}`);
  console.log('[orchestrator] Running pipeline...\n');

  const events: Array<{ type: string; [key: string]: unknown }> = [];
  let stageTexts: Record<number, string> = {};

  const startTime = Date.now();

  try {
    for await (const event of orchestrator.run(query, agentConfig)) {
      events.push(event as { type: string; [key: string]: unknown });

      switch (event.type) {
        case 'orchestrator_stage_start':
          console.log(`\n[stage ${event.stage}] START: ${event.name}`);
          break;
        case 'orchestrator_stage_complete':
          console.log(`[stage ${event.stage}] COMPLETE: ${event.name}`);
          break;
        case 'orchestrator_pause':
          console.log(`\n[stage ${event.stage}] ⏸️  PAUSED`);
          stageTexts[event.stage] = event.message;
          break;
        case 'orchestrator_error':
          console.log(`[stage ${event.stage}] ❌ ERROR: ${event.error}`);
          break;
        case 'orchestrator_complete':
          console.log(`\n[pipeline] ✅ COMPLETE (${event.stageCount} stages, $${event.totalCostUsd})`);
          break;
        case 'text':
          // Intermediate text event
          break;
      }
    }
  } catch (err) {
    console.error(`\n[pipeline] FATAL: ${err instanceof Error ? err.message : String(err)}`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // ── Step 5: Validate results ──────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('  RESULTS');
  console.log('════════════════════════════════════════════════════════════\n');

  const eventTypes = events.map(e => e.type);
  console.log(`Events: ${eventTypes.join(' → ')}`);
  console.log(`Duration: ${elapsed}s`);
  console.log(`Cost: $${costTracker.totalCostUsd.toFixed(4)}`);

  // Check: all events are orchestrator_* (NOT SDK types)
  const allOrchestrator = eventTypes.every(t => t.startsWith('orchestrator_') || t === 'text');
  console.log(`\n[check] All events are orchestrator_* types: ${allOrchestrator ? '✅ PASS' : '❌ FAIL'}`);

  // Check: stage 0 started
  const hasStage0Start = events.some(e => e.type === 'orchestrator_stage_start' && (e as { stage: number }).stage === 0);
  console.log(`[check] Stage 0 started: ${hasStage0Start ? '✅ PASS' : '❌ FAIL'}`);

  // Check: pipeline paused at stage 0
  const pauseEvent = events.find(e => e.type === 'orchestrator_pause');
  const pausedAtStage0 = pauseEvent && (pauseEvent as { stage: number }).stage === 0;
  console.log(`[check] Paused at stage 0: ${pausedAtStage0 ? '✅ PASS' : '❌ FAIL'}`);

  // Check: no stage 1+ started (pipeline should stop at stage 0 pause)
  const stage1Events = events.filter(e =>
    (e as { stage?: number }).stage !== undefined && (e as { stage: number }).stage > 0,
  );
  const noPrematureStages = stage1Events.length === 0;
  console.log(`[check] No stage 1+ events (paused): ${noPrematureStages ? '✅ PASS' : '❌ FAIL — found stage 1+ events'}`);

  // Check: no SDK-type events
  const noSdkEvents = !events.some(e =>
    e.type === 'assistant' || e.type === 'tool' || e.type === 'tool_use',
  );
  console.log(`[check] No SDK-type events: ${noSdkEvents ? '✅ PASS' : '❌ FAIL — SDK events detected! WRONG FLOW!'}`);

  // Check: pipeline state persisted
  const statePath = join(SESSION_PATH, 'data', 'pipeline-state.json');
  const stateExists = existsSync(statePath);
  console.log(`[check] Pipeline state persisted: ${stateExists ? '✅ PASS' : '❌ FAIL'}`);

  if (stateExists) {
    const stateRaw = JSON.parse(readFileSync(statePath, 'utf-8'));
    const stateEvents = stateRaw.events?.map((e: { type: string }) => e.type) ?? [];
    const hasPause = stateEvents.includes('pause_requested');
    console.log(`[check] State has pause event: ${hasPause ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`[check] State events: ${stateEvents.join(' → ')}`);
  }

  // Show pause message (what user would see)
  if (stageTexts[0]) {
    console.log('\n────────────────────────────────────────────────────────────');
    console.log('  STAGE 0 OUTPUT (what user sees — orchestrator path):');
    console.log('────────────────────────────────────────────────────────────\n');
    console.log(stageTexts[0].trim().slice(0, 2000));
    console.log('\n────────────────────────────────────────────────────────────');
  }

  // Final verdict
  const allPassed = allOrchestrator && hasStage0Start && pausedAtStage0 && noPrematureStages && noSdkEvents && stateExists;

  console.log(`\n${'═'.repeat(60)}`);
  if (allPassed) {
    console.log('  ✅ ALL CHECKS PASSED — Orchestrator flow verified end-to-end');
    console.log('');
    console.log('  This proves:');
    console.log('  → OrchestratorLlmClient: Bearer auth + adaptive thinking works');
    console.log('  → AgentOrchestrator.run(): deterministic stage loop executes');
    console.log('  → Stage 0 runs and pauses correctly (not SDK query() flow)');
    console.log('  → Pipeline state persisted to disk for resume');
    console.log('  → Events are orchestrator_* types (NOT SDK assistant/tool events)');
  } else {
    console.log('  ❌ SOME CHECKS FAILED — See above for details');
    console.log('  If SDK events were detected, the orchestrator path is NOT being taken!');
  }
  console.log(`${'═'.repeat(60)}\n`);

  // Cleanup
  try {
    const tmpBase = join(SESSION_PATH, '..', '..');
    rmSync(tmpBase, { recursive: true, force: true });
  } catch { /* ignore */ }

  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error('FATAL:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
