import { query } from '@anthropic-ai/claude-agent-sdk';
import { join, dirname } from 'node:path';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { CredentialManager } from '../packages/shared/src/credentials/manager.ts';
import { getSessionScopedTools,
  registerSessionScopedToolCallbacks,
  unregisterSessionScopedToolCallbacks,
} from '../packages/shared/src/agent/session-scoped-tools.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const CLI_JS = join(REPO_ROOT, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js');
const SESSION_ID = `e2e-test-${Date.now()}`;

const RAW_QUERY = process.argv.find(a => a.startsWith('--query='))?.slice(8)
  ?? 'What should I consider in context of testwork and documentation when testing insurance reserves';

async function ensureAuth(): Promise<void> {
  if (process.argv.includes('--auto-auth') || !process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    const manager = new CredentialManager();
    const creds = await manager.getClaudeOAuthCredentials();
    if (!creds?.accessToken) { console.error('ERROR: no token'); process.exit(1); }
    process.env.CLAUDE_CODE_OAUTH_TOKEN = creds.accessToken;
    console.log('[auth] token loaded from credential store');
  }
}

function createTempWorkspace(): string {
  const dir = join(tmpdir(), `craft-e2e-${Date.now()}`);
  const agentDir = join(dir, 'agents', 'isa-deep-research');
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(join(dir, 'sessions', SESSION_ID), { recursive: true });
  writeFileSync(join(agentDir, 'config.json'),
    readFileSync(join(REPO_ROOT, 'agents', 'isa-deep-research', 'config.json'), 'utf-8'));
  writeFileSync(join(agentDir, 'AGENT.md'),
    readFileSync(join(REPO_ROOT, 'agents', 'isa-deep-research', 'AGENT.md'), 'utf-8'));
  return dir;
}

async function main() {
  await ensureAuth();
  const workspaceDir = createTempWorkspace();
  const fullPrompt = RAW_QUERY;

  let pauseFired = false;
  registerSessionScopedToolCallbacks(SESSION_ID, {
    onAgentStagePause: (args) => {
      pauseFired = true;
      console.log('\n[PAUSE CALLBACK]', JSON.stringify(args, null, 2));
    },
    onAgentEvent: (e) => console.log(`  [agent_event] ${e.type} stage=${JSON.stringify((e.data as Record<string,unknown>).stage ?? '')}`),
    isPauseLocked: () => pauseFired,
  });

  const sessionMcp = getSessionScopedTools(SESSION_ID, workspaceDir);
  const agentMd = readFileSync(join(workspaceDir, 'agents', 'isa-deep-research', 'AGENT.md'), 'utf-8');

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  Stage 0 Live E2E — ISA Deep Research');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`\nINPUT: ${fullPrompt}\n`);
  console.log('──────────────────── SDK events ───────────────────────────\n');

  const toolCalls: Array<{ name: string; input: unknown; result: string }> = [];
  let assistantText = '';
  let pendingTool: { name: string; input: unknown } | null = null;

  try {
    for await (const event of query({
      prompt: fullPrompt,
      options: {
        pathToClaudeCodeExecutable: CLI_JS,
        executable: 'node' as 'bun',
        executableArgs: [],
        cwd: workspaceDir,
        env: { ...process.env, CLAUDECODE: '', CRAFT_DEBUG: '0' },
        plugins: [{ type: 'local', path: workspaceDir }],
        mcpServers: { session: sessionMcp },
        permissionMode: 'bypassPermissions' as const,
        systemPrompt: {
          type: 'preset' as const,
          preset: 'claude_code' as const,
          append: agentMd,
        },
        maxTurns: 12,
      },
    })) {
      if (event.type === 'assistant') {
        for (const block of event.message.content) {
          if (block.type === 'text' && block.text.trim()) {
            assistantText += block.text;
            console.log(`[assistant] ${block.text.slice(0, 200).replace(/\n/g,' ')}`);
          } else if (block.type === 'tool_use') {
            pendingTool = { name: block.name, input: block.input };
            console.log(`[tool_use]  ${block.name}  ${JSON.stringify(block.input).slice(0,120)}`);
          }
        }
      } else if (event.type === 'tool') {
        const raw = typeof event.result === 'string' ? event.result : JSON.stringify(event.result);
        if (pendingTool) { toolCalls.push({ ...pendingTool, result: raw }); pendingTool = null; }
        try {
          const outer = JSON.parse(raw);
          const inner = typeof outer[0]?.text === 'string' ? JSON.parse(outer[0].text) : outer;
          if (inner.pauseRequired) {
            console.log('\n┌─ PAUSE TOOL RESULT ──────────────────────────────────────');
            console.log(`│ pausedAtStage: ${inner.pausedAtStage}  allowed: ${inner.allowed}`);
            console.log(`│ validationWarnings: ${JSON.stringify(inner.validationWarnings ?? [])}`);
            console.log('│ --- reason (verbatim) ---');
            inner.reason.split('\n').forEach((l: string) => console.log(`│ ${l}`));
            console.log('└──────────────────────────────────────────────────────────\n');
          }
        } catch { /* not a stage gate result */ }
      }
    }
  } catch (err) {
    console.error('\nSDK ERROR:', err instanceof Error ? err.message : String(err));
  }

  unregisterSessionScopedToolCallbacks(SESSION_ID);

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  RESULTS');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`\nPause fired: ${pauseFired}`);
  console.log(`Tool calls (${toolCalls.length}):`);
  for (const [i, tc] of toolCalls.entries()) {
    console.log(`  ${i+1}. ${tc.name}  input=${JSON.stringify(tc.input).slice(0,100)}`);
    try {
      const r = JSON.parse(tc.result);
      const inner = typeof r[0]?.text === 'string' ? JSON.parse(r[0].text) : r;
      console.log(`     result=${JSON.stringify(inner).slice(0,200)}`);
    } catch { console.log(`     result=${tc.result?.slice(0,200)}`); }
  }
  console.log('\nFINAL ASSISTANT TEXT (what user sees after Stage 0):');
  console.log('──────────────────────────────────────────────────────────');
  console.log(assistantText.trim() || '(no text output — agent stopped at pause)');
  console.log('──────────────────────────────────────────────────────────\n');

  try { rmSync(workspaceDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
