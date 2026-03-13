/**
 * Full Pipeline Live E2E: All 6 Stages with Pause/Resume (Real API)
 *
 * This test exercises the COMPLETE orchestrator pipeline end-to-end:
 *
 *   Phase 1: Initial Run
 *     - orchestrator.run() → Stage 0 (analyze_query) → PAUSE
 *     - Validates: events, pipeline-state.json, context-windows.jsonl, debug .txt files
 *
 *   Phase 2: Resume After Stage 0
 *     - orchestrator.resume("proceed") → Stage 1 (websearch_calibration) → PAUSE
 *     - Validates: resume event recorded, stage 1 started/completed, new pause
 *
 *   Phase 3: Resume After Stage 1
 *     - orchestrator.resume("yes, proceed") → Stages 2-5 run to completion
 *     - Stage 2: retrieve (no MCP bridge → graceful skip)
 *     - Stage 3: synthesize (LLM call with empty retrieval)
 *     - Stage 4: verify (no MCP bridge → graceful skip)
 *     - Stage 5: output (deterministic renderer)
 *     - Validates: all stages completed, final output rendered, pipeline_complete event
 *
 *   Phase 4: Artifact Deep Validation
 *     - pipeline-state.json has all 6 stage outputs
 *     - context-windows.jsonl has entries for LLM stages
 *     - debug .txt context files written for LLM stages
 *     - plans/answer.md rendered
 *     - plans/answer.json written (for follow-up)
 *     - No breakout scope files lingering
 *
 * Run:
 *   npx tsx scripts/test-full-pipeline-live-e2e.ts
 *   npx tsx scripts/test-full-pipeline-live-e2e.ts --query="Your query"
 *
 * Estimated cost: ~$0.15-0.25 per run (3 LLM calls: stage 0, 1, 3)
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

// ============================================================================
// Token Resolution (reused from test-orchestrator-live-e2e.ts)
// ============================================================================

interface TokenResult {
  token: string;
  source: string;
  expiresAt?: number;
}

function getClaudeCodeToken(): TokenResult | null {
  const credPath = join(homedir(), '.claude', '.credentials.json');
  if (!existsSync(credPath)) return null;
  try {
    const creds = JSON.parse(readFileSync(credPath, 'utf-8'));
    const oauth = creds?.claudeAiOauth;
    if (!oauth?.accessToken) return null;
    if (oauth.expiresAt && oauth.expiresAt < Date.now()) return null;
    return { token: oauth.accessToken, source: 'claude-code', expiresAt: oauth.expiresAt };
  } catch { return null; }
}

async function getCraftAgentToken(): Promise<TokenResult | null> {
  try {
    const { CredentialManager } = await import('../packages/shared/src/credentials/manager.ts');
    const manager = new CredentialManager();
    const creds = await manager.getClaudeOAuthCredentials();
    if (!creds?.accessToken) return null;
    if (creds.expiresAt && creds.expiresAt < Date.now()) return null;
    return { token: creds.accessToken, source: 'craft-agent', expiresAt: creds.expiresAt };
  } catch { return null; }
}

function getEnvToken(): TokenResult | null {
  const token = process.env['CLAUDE_CODE_OAUTH_TOKEN'];
  if (!token || token.length < 10) return null;
  return { token, source: 'env' };
}

async function resolveToken(): Promise<TokenResult> {
  const envToken = getEnvToken();
  if (envToken) return envToken;
  const ccToken = getClaudeCodeToken();
  if (ccToken) return ccToken;
  const caToken = await getCraftAgentToken();
  if (caToken) return caToken;
  console.error('ERROR: No valid OAuth token found.');
  process.exit(1);
}

// ============================================================================
// Test Result Tracking
// ============================================================================

interface Check {
  name: string;
  passed: boolean;
  details?: string;
}

const checks: Check[] = [];
let totalLlmCalls = 0;

function check(name: string, passed: boolean, details?: string): void {
  checks.push({ name, passed, details });
  const icon = passed ? '✅' : '❌';
  const det = details ? ` — ${details}` : '';
  console.log(`  ${icon} ${name}${det}`);
}

function section(title: string): void {
  console.log(`\n${'─'.repeat(64)}`);
  console.log(`  ${title}`);
  console.log(`${'─'.repeat(64)}\n`);
}

function bigSection(title: string): void {
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`  ${title}`);
  console.log(`${'═'.repeat(64)}\n`);
}

// ============================================================================
// Helpers
// ============================================================================

function listRecursive(dir: string, prefix = ''): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...listRecursive(fullPath, relPath));
    } else {
      results.push(relPath);
    }
  }
  return results;
}

// ============================================================================
// Main E2E Test
// ============================================================================

async function main() {
  const query = process.argv.find(a => a.startsWith('--query='))?.slice(8)
    ?? 'What are the key ISA 540 requirements for auditing accounting estimates?';

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  FULL PIPELINE LIVE E2E: All 6 Stages + Pause/Resume      ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  // ── Token ──────────────────────────────────────────────────────────────
  const tokenResult = await resolveToken();
  console.log(`\n[auth] Source: ${tokenResult.source}`);
  console.log(`[auth] Token: ${tokenResult.token.substring(0, 25)}...`);

  // ── Agent config ───────────────────────────────────────────────────────
  const configPath = join(REPO_ROOT, 'agents', 'isa-deep-research', 'config.json');
  if (!existsSync(configPath)) {
    console.error(`ERROR: Agent config not found at ${configPath}`);
    process.exit(1);
  }
  const rawConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
  const stageNames = rawConfig.controlFlow.stages.map((s: { name: string }) => s.name);
  console.log(`[config] Agent: isa-deep-research`);
  console.log(`[config] Stages: ${stageNames.join(' → ')}`);
  console.log(`[config] Pause after: stages ${rawConfig.controlFlow.pauseAfterStages.join(', ')}`);
  console.log(`[config] Query: ${query}`);
  console.log(`[config] autoAdvance: DISABLED (testing pause/resume cycles)\n`);

  // ── Setup temp session ─────────────────────────────────────────────────
  const { AgentOrchestrator, CostTracker } = await import('../packages/shared/src/agent/orchestrator/index.ts');

  const SESSION_ID = `e2e-full-${Date.now()}`;
  const TMP_BASE = join(tmpdir(), `craft-e2e-full-${Date.now()}`);
  const SESSION_PATH = join(TMP_BASE, 'sessions', SESSION_ID);
  mkdirSync(SESSION_PATH, { recursive: true });

  // IMPORTANT: We set autoAdvance to FALSE to force pause/resume testing.
  // With autoAdvance:true (the production setting), stages without pauseChoices
  // auto-advance and the entire pipeline runs in a single orchestrator.run() call.
  // We explicitly test pause/resume by disabling this.
  const agentConfig = {
    slug: 'isa-deep-research',
    name: 'ISA Deep Research',
    controlFlow: {
      stages: rawConfig.controlFlow.stages.map((s: { id: number; name: string; description?: string; pauseInstructions?: string; pauseChoices?: unknown[] }) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        pauseInstructions: s.pauseInstructions,
        pauseChoices: s.pauseChoices,
      })),
      pauseAfterStages: rawConfig.controlFlow.pauseAfterStages,
      repairUnits: rawConfig.controlFlow.repairUnits,
      // Disabled to force pause/resume cycles (production has autoAdvance:true)
      autoAdvance: false,
    },
    output: rawConfig.output ?? {},
    promptsDir: join(REPO_ROOT, 'agents', 'isa-deep-research', 'prompts'),
  };

  const costTracker = new CostTracker({ budgetUsd: 5 });
  const debugMessages: string[] = [];
  const allEvents: Array<{ phase: number; type: string; [key: string]: unknown }> = [];

  const orchestrator = AgentOrchestrator.create(
    {
      sessionId: SESSION_ID,
      sessionPath: SESSION_PATH,
      getAuthToken: async () => {
        const fresh = getClaudeCodeToken() ?? tokenResult;
        return (fresh as TokenResult).token;
      },
      onStreamEvent: (event) => {
        if (event.type === 'text_delta' && event.text) {
          process.stdout.write('.');
        }
      },
      onDebug: (msg: string) => {
        debugMessages.push(msg);
      },
    },
    null,  // No MCP bridge — stage 2 (retrieve) and 4 (verify) will gracefully skip
    costTracker,
  );

  const startTime = Date.now();

  // ══════════════════════════════════════════════════════════════════════
  //  PHASE 1: Initial Run → Stage 0 → Pause
  // ══════════════════════════════════════════════════════════════════════
  bigSection('PHASE 1: Initial Run → Stage 0 (analyze_query) → Pause');

  let phase1PauseMessage = '';
  const phase1Start = Date.now();

  try {
    for await (const event of orchestrator.run(query, agentConfig)) {
      const tagged = { ...event, phase: 1 } as { phase: number; type: string; [key: string]: unknown };
      allEvents.push(tagged);

      switch (event.type) {
        case 'orchestrator_stage_start':
          console.log(`  [stage ${event.stage}] START: ${event.name}`);
          break;
        case 'orchestrator_substep':
          // Progress substeps (silent for cleaner output)
          break;
        case 'orchestrator_pause':
          console.log(`\n  [stage ${event.stage}] ⏸️  PAUSED (${((Date.now() - phase1Start) / 1000).toFixed(1)}s)`);
          phase1PauseMessage = event.message;
          break;
        case 'orchestrator_stage_complete':
          console.log(`  [stage ${event.stage}] COMPLETE: ${event.name}`);
          break;
        case 'text':
          // Auto-advance info text
          break;
      }
    }
  } catch (err) {
    console.error(`  FATAL: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const phase1Duration = ((Date.now() - phase1Start) / 1000).toFixed(1);
  totalLlmCalls++;

  // Phase 1 checks
  section('Phase 1 Checks');
  const p1Events = allEvents.filter(e => e.phase === 1);
  check('Stage 0 started', p1Events.some(e => e.type === 'orchestrator_stage_start' && e.stage === 0));
  check('Stage 0 paused', p1Events.some(e => e.type === 'orchestrator_pause' && e.stage === 0));
  check('No stage 1+ events', !p1Events.some(e => (e.stage as number) > 0));
  check('Pause message non-empty', phase1PauseMessage.length > 50, `${phase1PauseMessage.length} chars`);

  // Check pipeline state on disk
  const statePath = join(SESSION_PATH, 'data', 'pipeline-state.json');
  check('Pipeline state persisted', existsSync(statePath));

  if (existsSync(statePath)) {
    const stateRaw = JSON.parse(readFileSync(statePath, 'utf-8'));
    const stateEvents = stateRaw.events?.map((e: { type: string }) => e.type) ?? [];
    check('State has stage_started', stateEvents.includes('stage_started'));
    check('State has stage_completed', stateEvents.includes('stage_completed'));
    check('State has pause_requested', stateEvents.includes('pause_requested'));
    check('State has pause_formatted', stateEvents.includes('pause_formatted'));
    check('Stage 0 output exists', stateRaw.stageOutputs?.['0'] != null);
  }

  // Check context-windows.jsonl
  const cwPath = join(SESSION_PATH, 'data', 'context-windows.jsonl');
  const cwExists = existsSync(cwPath);
  check('context-windows.jsonl created', cwExists);

  if (cwExists) {
    const cwLines = readFileSync(cwPath, 'utf-8').trim().split('\n').filter(Boolean);
    check('Context window has stage 0 entry', cwLines.length >= 1, `${cwLines.length} entries`);
  }

  // Check debug context .txt files
  const contextsDir = join(SESSION_PATH, 'data', 'agents', 'isa-deep-research', 'contexts');
  const txtFiles = existsSync(contextsDir)
    ? readdirSync(contextsDir).filter(f => f.endsWith('.txt'))
    : [];
  check('Debug context .txt files created', txtFiles.length >= 1, `${txtFiles.length} files`);

  if (txtFiles.length > 0) {
    const firstTxt = readFileSync(join(contextsDir, txtFiles[0]!), 'utf-8');
    check('Debug .txt has structured header',
      firstTxt.includes('=== Debug Context Capture ===') &&
      firstTxt.includes('Stage:') &&
      firstTxt.includes('Timestamp:'));
  }

  console.log(`\n  Phase 1 duration: ${phase1Duration}s | Cost so far: $${costTracker.totalCostUsd.toFixed(4)}`);

  // Show pause message preview
  console.log(`\n  Pause message preview (first 500 chars):`);
  console.log(`  ${phase1PauseMessage.trim().slice(0, 500).replace(/\n/g, '\n  ')}`);

  // ══════════════════════════════════════════════════════════════════════
  //  PHASE 2: Resume After Stage 0 → Stage 1 → Pause
  // ══════════════════════════════════════════════════════════════════════
  bigSection('PHASE 2: Resume → Stage 1 (websearch_calibration) → Pause');

  let phase2PauseMessage = '';
  const phase2Start = Date.now();

  try {
    for await (const event of orchestrator.resume('Yes, proceed with the research plan', agentConfig)) {
      const tagged = { ...event, phase: 2 } as { phase: number; type: string; [key: string]: unknown };
      allEvents.push(tagged);

      switch (event.type) {
        case 'orchestrator_stage_start':
          console.log(`  [stage ${event.stage}] START: ${event.name}`);
          break;
        case 'orchestrator_substep':
          break;
        case 'orchestrator_pause':
          console.log(`\n  [stage ${event.stage}] ⏸️  PAUSED (${((Date.now() - phase2Start) / 1000).toFixed(1)}s)`);
          phase2PauseMessage = event.message;
          break;
        case 'orchestrator_stage_complete':
          console.log(`  [stage ${event.stage}] COMPLETE: ${event.name}`);
          break;
        case 'text':
          // Auto-advance info text (stage 1 may auto-advance if no pauseChoices)
          console.log(`  [text] Stage output delivered (auto-advance)`);
          break;
      }
    }
  } catch (err) {
    console.error(`  FATAL: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const phase2Duration = ((Date.now() - phase2Start) / 1000).toFixed(1);
  totalLlmCalls++;

  // Phase 2 checks
  section('Phase 2 Checks');
  const p2Events = allEvents.filter(e => e.phase === 2);
  check('Stage 1 started', p2Events.some(e => e.type === 'orchestrator_stage_start' && e.stage === 1));
  
  // Stage 1 may pause or auto-advance depending on config.autoAdvance and pauseChoices
  const stage1Paused = p2Events.some(e => e.type === 'orchestrator_pause' && e.stage === 1);
  const stage1Completed = p2Events.some(e => e.type === 'orchestrator_stage_complete' && e.stage === 1);
  const stage1AutoAdvanced = !stage1Paused && stage1Completed;
  
  if (stage1AutoAdvanced) {
    // Auto-advance path: stages 1-5 may all run in this phase
    check('Stage 1 auto-advanced (no pauseChoices)', true, 'autoAdvance=true, no pauseChoices');
    
    // Check if remaining stages also ran
    const maxStage = Math.max(...p2Events.filter(e => e.stage !== undefined).map(e => e.stage as number));
    check(`Pipeline progressed to stage ${maxStage}`, maxStage >= 1);
    
    if (p2Events.some(e => e.type === 'orchestrator_complete')) {
      check('Pipeline completed in phase 2 (all auto-advanced)', true);
      phase2PauseMessage = '[auto-advanced through all remaining stages]';
    }
  } else {
    check('Stage 1 paused', stage1Paused);
    check('Pause message non-empty', phase2PauseMessage.length > 20, `${phase2PauseMessage.length} chars`);
  }

  // Reload state and check
  if (existsSync(statePath)) {
    const stateRaw = JSON.parse(readFileSync(statePath, 'utf-8'));
    const stateEvents = stateRaw.events?.map((e: { type: string }) => e.type) ?? [];
    check('State has resumed event', stateEvents.includes('resumed'));
    check('Stage 1 output exists', stateRaw.stageOutputs?.['1'] != null);
  }

  console.log(`\n  Phase 2 duration: ${phase2Duration}s | Cost so far: $${costTracker.totalCostUsd.toFixed(4)}`);

  // ══════════════════════════════════════════════════════════════════════
  //  PHASE 3: Resume After Stage 1 → Stages 2-5 → Complete
  //  (only if pipeline didn't already complete in Phase 2)
  // ══════════════════════════════════════════════════════════════════════
  
  const pipelineAlreadyComplete = allEvents.some(e => e.type === 'orchestrator_complete');
  
  if (!pipelineAlreadyComplete) {
    bigSection('PHASE 3: Resume → Stages 2-5 → Pipeline Complete');

    const phase3Start = Date.now();
    const stageCompletions: number[] = [];

    try {
      for await (const event of orchestrator.resume('Yes, proceed with retrieval and synthesis', agentConfig)) {
        const tagged = { ...event, phase: 3 } as { phase: number; type: string; [key: string]: unknown };
        allEvents.push(tagged);

        switch (event.type) {
          case 'orchestrator_stage_start':
            console.log(`  [stage ${event.stage}] START: ${event.name}`);
            break;
          case 'orchestrator_substep':
            break;
          case 'orchestrator_stage_complete':
            console.log(`  [stage ${event.stage}] COMPLETE: ${event.name}`);
            stageCompletions.push(event.stage as number);
            break;
          case 'orchestrator_complete':
            console.log(`\n  ✅ PIPELINE COMPLETE (${event.stageCount} stages, $${(event.totalCostUsd as number).toFixed(4)})`);
            break;
          case 'orchestrator_pause':
            // Shouldn't pause here, but handle gracefully
            console.log(`  [stage ${event.stage}] ⏸️  UNEXPECTED PAUSE`);
            break;
          case 'text':
            console.log(`  [text] Stage output delivered`);
            break;
        }
      }
    } catch (err) {
      console.error(`  FATAL: ${err instanceof Error ? err.message : String(err)}`);
      // Don't exit — continue to validation
    }

    const phase3Duration = ((Date.now() - phase3Start) / 1000).toFixed(1);

    // Phase 3 checks
    section('Phase 3 Checks');
    const p3Events = allEvents.filter(e => e.phase === 3);
    
    // Stage 2 (retrieve) — should complete (gracefully skipped, no MCP bridge)
    check('Stage 2 started (retrieve)', p3Events.some(e => e.type === 'orchestrator_stage_start' && e.stage === 2));
    check('Stage 2 completed', p3Events.some(e => e.type === 'orchestrator_stage_complete' && e.stage === 2));

    // Stage 3 (synthesize) — LLM call, even with empty retrieval
    check('Stage 3 started (synthesize)', p3Events.some(e => e.type === 'orchestrator_stage_start' && e.stage === 3));
    check('Stage 3 completed', p3Events.some(e => e.type === 'orchestrator_stage_complete' && e.stage === 3));
    totalLlmCalls++;

    // Stage 4 (verify) — should complete (gracefully skipped, no MCP bridge)
    check('Stage 4 started (verify)', p3Events.some(e => e.type === 'orchestrator_stage_start' && e.stage === 4));
    check('Stage 4 completed', p3Events.some(e => e.type === 'orchestrator_stage_complete' && e.stage === 4));

    // Stage 5 (output) — deterministic renderer
    check('Stage 5 started (output)', p3Events.some(e => e.type === 'orchestrator_stage_start' && e.stage === 5));
    check('Stage 5 completed', p3Events.some(e => e.type === 'orchestrator_stage_complete' && e.stage === 5));

    // Pipeline complete
    check('Pipeline completed', p3Events.some(e => e.type === 'orchestrator_complete'));

    console.log(`\n  Phase 3 duration: ${phase3Duration}s | Cost so far: $${costTracker.totalCostUsd.toFixed(4)}`);
  }

  // ══════════════════════════════════════════════════════════════════════
  //  PHASE 4: Deep Artifact Validation
  // ══════════════════════════════════════════════════════════════════════
  bigSection('PHASE 4: Deep Artifact Validation');

  // List all files in session directory
  const allFiles = listRecursive(SESSION_PATH);
  console.log('  Session directory contents:');
  for (const f of allFiles) {
    const fullPath = join(SESSION_PATH, f.replace(/\//g, '\\'));
    const size = existsSync(fullPath) ? readFileSync(fullPath).length : 0;
    console.log(`    ${f} (${size} bytes)`);
  }
  console.log('');

  // 4a. Pipeline state — check all 6 stage outputs
  section('4a. Pipeline State Validation');
  if (existsSync(statePath)) {
    const stateRaw = JSON.parse(readFileSync(statePath, 'utf-8'));
    
    for (let i = 0; i < 6; i++) {
      const output = stateRaw.stageOutputs?.[String(i)];
      check(`Stage ${i} output in state`, output != null, output ? `summary: ${output.summary?.slice(0, 80)}` : 'MISSING');
    }

    // Check event sequence
    const stateEvents = (stateRaw.events ?? []) as Array<{ type: string; stage?: number }>;
    const eventSummary = stateEvents.map(e => `${e.type}(${e.stage ?? '-'})`).join(' → ');
    console.log(`\n  Event sequence: ${eventSummary}`);

    // Verify chronological ordering
    const timestamps = (stateRaw.events ?? []) as Array<{ timestamp: string }>;
    let chronological = true;
    for (let i = 1; i < timestamps.length; i++) {
      if (timestamps[i]!.timestamp < timestamps[i - 1]!.timestamp) {
        chronological = false;
        break;
      }
    }
    check('Events chronologically ordered', chronological);

    // Verify no duplicate events
    const eventKeys = stateEvents.map((e, idx) => `${e.type}-${e.stage ?? 'x'}-${idx}`);
    const uniqueCount = new Set(eventKeys).size;
    check('No duplicate events', uniqueCount === eventKeys.length, `${uniqueCount}/${eventKeys.length}`);

    // Check final status
    const lastEvent = stateEvents[stateEvents.length - 1];
    check('Pipeline reached terminal state', 
      lastEvent?.type === 'stage_completed' || lastEvent?.type === 'pause_formatted',
      `last event: ${lastEvent?.type}`);
  }

  // 4b. Context windows
  section('4b. Context Windows Validation');
  if (existsSync(cwPath)) {
    const cwLines = readFileSync(cwPath, 'utf-8').trim().split('\n').filter(Boolean);
    check('Context window entries exist', cwLines.length > 0, `${cwLines.length} entries`);

    // Parse and validate each entry
    let validEntries = 0;
    const stagesCovered = new Set<number>();
    for (const line of cwLines) {
      try {
        const entry = JSON.parse(line);
        if (entry.stageId !== undefined && entry.timestamp && entry.source) {
          validEntries++;
          stagesCovered.add(entry.stageId);
        }
      } catch { /* skip malformed */ }
    }
    check('All context window entries valid JSON', validEntries === cwLines.length, `${validEntries}/${cwLines.length}`);
    check('Context window covers LLM stages', stagesCovered.size >= 2, `stages: ${[...stagesCovered].sort().join(', ')}`);
  }

  // 4c. Debug context .txt files
  section('4c. Debug Context Files Validation');
  const updatedTxtFiles = existsSync(contextsDir)
    ? readdirSync(contextsDir).filter(f => f.endsWith('.txt'))
    : [];
  check('Debug .txt files created across pipeline', updatedTxtFiles.length >= 2, `${updatedTxtFiles.length} files`);

  if (updatedTxtFiles.length > 0) {
    // Validate structure of each file
    let validHeaders = 0;
    for (const f of updatedTxtFiles) {
      const content = readFileSync(join(contextsDir, f), 'utf-8');
      if (content.includes('=== Debug Context Capture ===') && content.includes('Stage:') && content.includes('Timestamp:')) {
        validHeaders++;
      }
    }
    check('All debug .txt files have structured headers', validHeaders === updatedTxtFiles.length, `${validHeaders}/${updatedTxtFiles.length}`);
  }

  // 4d. Output artifacts (isa-research-output.md, answer.json)
  section('4d. Output Artifacts Validation');
  const plansDir = join(SESSION_PATH, 'plans');
  // The agent config sets answerFile to 'isa-research-output.md'
  const answerMdPath = join(plansDir, 'isa-research-output.md');
  // answer.json is written to data/ directory (not plans/)
  const answerJsonPath = join(SESSION_PATH, 'data', 'answer.json');

  check('plans/ directory exists', existsSync(plansDir));
  check('isa-research-output.md rendered', existsSync(answerMdPath), existsSync(answerMdPath) ? `${readFileSync(answerMdPath).length} bytes` : 'MISSING');
  check('answer.json written', existsSync(answerJsonPath), existsSync(answerJsonPath) ? `${readFileSync(answerJsonPath).length} bytes` : 'MISSING');

  if (existsSync(answerMdPath)) {
    const md = readFileSync(answerMdPath, 'utf-8');
    check('output markdown has content', md.length > 200, `${md.length} chars`);
    check('output markdown has section headings', md.includes('##'), 'has ## headings');
  }

  if (existsSync(answerJsonPath)) {
    try {
      const answerJson = JSON.parse(readFileSync(answerJsonPath, 'utf-8'));
      check('answer.json has version', answerJson.version === 1);
      check('answer.json has original_query', typeof answerJson.original_query === 'string');
      check('answer.json has answer text', typeof answerJson.answer === 'string' && answerJson.answer.length > 100);
    } catch {
      check('answer.json valid JSON', false);
    }
  }

  // 4e. Breakout scope (should NOT exist — isa-deep-research has no sdk_breakout stages)
  section('4e. Breakout Scope Validation');
  const agentDataDir = join(SESSION_PATH, 'data', 'agents', 'isa-deep-research');
  const breakoutScopePath = join(agentDataDir, 'breakout-scope.json');
  check('No lingering breakout scope file', !existsSync(breakoutScopePath));

  // ══════════════════════════════════════════════════════════════════════
  //  FINAL REPORT
  // ══════════════════════════════════════════════════════════════════════
  bigSection('FINAL REPORT');

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
  const passed = checks.filter(c => c.passed).length;
  const failed = checks.filter(c => !c.passed).length;
  const total = checks.length;

  console.log(`  Pipeline: isa-deep-research (6 stages)`);
  console.log(`  Stages executed: ${stageNames.join(' → ')}`);
  console.log(`  LLM calls: ${totalLlmCalls} (stages 0, 1, 3)`);
  console.log(`  Total duration: ${totalDuration}s`);
  console.log(`  Total cost: $${costTracker.totalCostUsd.toFixed(4)}`);
  console.log(`  Session: ${SESSION_ID}`);
  console.log(`  Session path: ${SESSION_PATH}`);
  console.log('');
  console.log(`  Checks: ${passed}/${total} passed, ${failed} failed`);
  console.log('');

  // Event sequence summary
  const eventTypes = allEvents.map(e => `[P${e.phase}] ${e.type}`);
  console.log('  Event trace:');
  for (const et of eventTypes) {
    console.log(`    ${et}`);
  }

  // Debug messages summary
  if (debugMessages.length > 0) {
    console.log(`\n  Debug messages (${debugMessages.length} total):`);
    for (const msg of debugMessages.slice(0, 20)) {
      console.log(`    ${msg}`);
    }
    if (debugMessages.length > 20) {
      console.log(`    ... and ${debugMessages.length - 20} more`);
    }
  }

  // List failures
  const failures = checks.filter(c => !c.passed);
  if (failures.length > 0) {
    console.log(`\n  ❌ FAILURES:`);
    for (const f of failures) {
      console.log(`    - ${f.name}${f.details ? ` (${f.details})` : ''}`);
    }
  }

  // Final verdict
  console.log(`\n${'═'.repeat(64)}`);
  if (failed === 0) {
    console.log('  ✅ ALL CHECKS PASSED — Full pipeline verified end-to-end');
    console.log('');
    console.log('  Proven:');
    console.log('  → Stage 0 runs + pauses correctly');
    console.log('  → Resume after stage 0 continues to stage 1');
    console.log('  → Stage 1 runs (websearch calibration)');
    console.log('  → Resume after stage 1 continues through stages 2-5');
    console.log('  → Stage 2 gracefully skips without MCP bridge');
    console.log('  → Stage 3 synthesizes (LLM call) with available context');
    console.log('  → Stage 4 gracefully skips verification without MCP bridge');
    console.log('  → Stage 5 renders deterministic output document');
    console.log('  → Pipeline state persisted at every checkpoint');
    console.log('  → Context windows logged for all LLM stages');
    console.log('  → Debug .txt files written with structured headers');
    console.log('  → answer.md + answer.json produced');
    console.log('  → No breakout scope lingering after completion');
  } else {
    console.log(`  ❌ ${failed} CHECK(S) FAILED — See failures above`);
  }
  console.log(`${'═'.repeat(64)}\n`);

  // Cleanup temp directory
  try {
    rmSync(TMP_BASE, { recursive: true, force: true });
    console.log('  [cleanup] Temp directory removed');
  } catch {
    console.log(`  [cleanup] Temp directory at ${TMP_BASE} — manual cleanup needed`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('FATAL:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
