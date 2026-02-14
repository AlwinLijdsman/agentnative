/**
 * Cross-platform electron dev script
 * Replaces platform-specific npm scripts with a unified TypeScript solution
 * Ported from Bun to Node.js/tsx for Windows ARM64 compatibility
 */

import { spawn, execSync, type ChildProcess } from "child_process";
import { existsSync, rmSync, cpSync, readFileSync, statSync, mkdirSync } from "fs";
import { join, basename, dirname } from "path";
import { fileURLToPath } from "url";
import * as esbuild from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT_DIR = join(__dirname, "..");
const ELECTRON_DIR = join(ROOT_DIR, "apps/electron");
const DIST_DIR = join(ELECTRON_DIR, "dist");

// MCP server paths (for Codex sessions)
const SESSION_SERVER_DIR = join(ROOT_DIR, "packages/session-mcp-server");
const SESSION_SERVER_OUTPUT = join(SESSION_SERVER_DIR, "dist/index.js");
const BRIDGE_SERVER_DIR = join(ROOT_DIR, "packages/bridge-mcp-server");
const BRIDGE_SERVER_OUTPUT = join(BRIDGE_SERVER_DIR, "dist/index.js");

// Platform-specific binary paths
const IS_WINDOWS = process.platform === "win32";
const BIN_EXT = IS_WINDOWS ? ".cmd" : "";
const VITE_BIN = join(ROOT_DIR, `node_modules/.bin/vite${BIN_EXT}`);
const ELECTRON_BIN = join(ROOT_DIR, `node_modules/.bin/electron${BIN_EXT}`);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Multi-instance detection (matches detect-instance.sh logic)
function detectInstance(): void {
  if (process.env.CRAFT_VITE_PORT) return;

  const folderName = basename(ROOT_DIR);
  const match = folderName.match(/-(\d+)$/);

  if (match) {
    const instanceNum = match[1];
    process.env.CRAFT_INSTANCE_NUMBER = instanceNum;
    process.env.CRAFT_VITE_PORT = `${instanceNum}173`;
    process.env.CRAFT_APP_NAME = `AgentNative [${instanceNum}]`;
    process.env.CRAFT_CONFIG_DIR = join(process.env.HOME || process.env.USERPROFILE || "", `.craft-agent-${instanceNum}`);
    process.env.CRAFT_DEEPLINK_SCHEME = `craftagents${instanceNum}`;
    console.log(`🔢 Instance ${instanceNum} detected: port=${process.env.CRAFT_VITE_PORT}, config=${process.env.CRAFT_CONFIG_DIR}`);
  }
}

// Load .env file if it exists
function loadEnvFile(): void {
  const envPath = join(ROOT_DIR, ".env");
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const eqIndex = trimmed.indexOf("=");
        if (eqIndex > 0) {
          const key = trimmed.slice(0, eqIndex).trim();
          let value = trimmed.slice(eqIndex + 1).trim();
          if ((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          process.env[key] = value;
        }
      }
    }
    console.log("📄 Loaded .env file");
  }
}

// Kill any process using the specified port
async function killProcessOnPort(port: string): Promise<void> {
  try {
    if (IS_WINDOWS) {
      const output = execSync(`netstat -ano | findstr :${port}`, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).toString();
      const pids = new Set<string>();
      for (const line of output.split("\n")) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5) {
          const pid = parts[parts.length - 1];
          if (pid && /^\d+$/.test(pid) && pid !== "0") {
            pids.add(pid);
          }
        }
      }
      for (const pid of pids) {
        try {
          execSync(`taskkill /PID ${pid} /F`, { stdio: "pipe" });
        } catch {
          // Process may already be dead
        }
      }
      if (pids.size > 0) {
        console.log(`🔪 Killed ${pids.size} process(es) on port ${port}`);
      }
    } else {
      execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`, { stdio: "pipe" });
    }
  } catch {
    // Ignore errors - port may not be in use
  }
}

// Clean Vite cache directory
function cleanViteCache(): void {
  const viteCacheDir = join(ELECTRON_DIR, "node_modules/.vite");
  if (existsSync(viteCacheDir)) {
    rmSync(viteCacheDir, { recursive: true, force: true });
    console.log("🧹 Cleaned Vite cache");
  }
}

// Copy resources to dist
function copyResources(): void {
  const srcDir = join(ELECTRON_DIR, "resources");
  const destDir = join(ELECTRON_DIR, "dist/resources");
  if (existsSync(srcDir)) {
    cpSync(srcDir, destDir, { recursive: true, force: true });
    console.log("📦 Copied resources to dist");
  }
}

// Build MCP servers for Codex sessions
async function buildMcpServers(): Promise<void> {
  console.log("🌉 Building MCP servers for Codex sessions...");

  const sessionDistDir = join(SESSION_SERVER_DIR, "dist");
  const bridgeDistDir = join(BRIDGE_SERVER_DIR, "dist");
  if (!existsSync(sessionDistDir)) mkdirSync(sessionDistDir, { recursive: true });
  if (!existsSync(bridgeDistDir)) mkdirSync(bridgeDistDir, { recursive: true });

  const [sessionResult, bridgeResult] = await Promise.all([
    runEsbuild(
      "packages/session-mcp-server/src/index.ts",
      "packages/session-mcp-server/dist/index.js",
      {},
      { packagesExternal: true }
    ),
    runEsbuild(
      "packages/bridge-mcp-server/src/index.ts",
      "packages/bridge-mcp-server/dist/index.js",
      {},
      { packagesExternal: true }
    ),
  ]);

  if (!sessionResult.success) {
    console.error("❌ Session MCP server build failed:", sessionResult.error);
    process.exit(1);
  }
  console.log("✅ Session MCP server built");

  if (!bridgeResult.success) {
    console.error("❌ Bridge MCP server build failed:", bridgeResult.error);
    process.exit(1);
  }
  console.log("✅ Bridge MCP server built");
}

// Get OAuth defines for esbuild API
function getOAuthDefines(): Record<string, string> {
  const oauthVars = [
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "SLACK_OAUTH_CLIENT_ID",
    "SLACK_OAUTH_CLIENT_SECRET",
    "MICROSOFT_OAUTH_CLIENT_ID",
    "MICROSOFT_OAUTH_CLIENT_SECRET",
  ];

  const defines: Record<string, string> = {};
  for (const varName of oauthVars) {
    const value = process.env[varName] || "";
    defines[`process.env.${varName}`] = JSON.stringify(value);
  }
  return defines;
}

// Get environment variables for electron process
function getElectronEnv(): Record<string, string> {
  const vitePort = process.env.CRAFT_VITE_PORT || "5173";

  return {
    ...process.env as Record<string, string>,
    VITE_DEV_SERVER_URL: `http://localhost:${vitePort}`,
    CRAFT_CONFIG_DIR: process.env.CRAFT_CONFIG_DIR || "",
    CRAFT_APP_NAME: process.env.CRAFT_APP_NAME || "AgentNative",
    CRAFT_DEEPLINK_SCHEME: process.env.CRAFT_DEEPLINK_SCHEME || "craftagents",
    CRAFT_INSTANCE_NUMBER: process.env.CRAFT_INSTANCE_NUMBER || "",
  };
}

// Run a one-shot esbuild using the JavaScript API
async function runEsbuild(
  entryPoint: string,
  outfile: string,
  defines: Record<string, string> = {},
  options: { packagesExternal?: boolean } = {}
): Promise<{ success: boolean; error?: string }> {
  try {
    await esbuild.build({
      entryPoints: [join(ROOT_DIR, entryPoint)],
      bundle: true,
      platform: "node",
      format: "cjs",
      outfile: join(ROOT_DIR, outfile),
      external: ["electron"],
      ...(options.packagesExternal ? { packages: "external" as const } : {}),
      define: defines,
      logLevel: "warning",
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// Verify a JavaScript file exists and has content
async function verifyJsFile(filePath: string): Promise<{ valid: boolean; error?: string }> {
  if (!existsSync(filePath)) {
    return { valid: false, error: "File does not exist" };
  }
  const stats = statSync(filePath);
  if (stats.size === 0) {
    return { valid: false, error: "File is empty" };
  }
  return { valid: true };
}

// Wait for file to stabilize (no size changes)
async function waitForFileStable(filePath: string, timeoutMs = 10000): Promise<boolean> {
  const startTime = Date.now();
  let lastSize = -1;
  let stableCount = 0;

  while (Date.now() - startTime < timeoutMs) {
    if (!existsSync(filePath)) {
      await sleep(100);
      continue;
    }

    const stats = statSync(filePath);
    if (stats.size === lastSize) {
      stableCount++;
      if (stableCount >= 3) {
        return true;
      }
    } else {
      stableCount = 0;
      lastSize = stats.size;
    }

    await sleep(100);
  }

  return false;
}

async function main(): Promise<void> {
  console.log("🚀 Starting Electron dev environment...\n");

  // Setup
  detectInstance();
  loadEnvFile();
  cleanViteCache();

  if (!existsSync(DIST_DIR)) {
    mkdirSync(DIST_DIR, { recursive: true });
  }

  copyResources();
  await buildMcpServers();

  const vitePort = process.env.CRAFT_VITE_PORT || "5173";
  const oauthDefines = getOAuthDefines();

  await killProcessOnPort(vitePort);

  // =========================================================
  // PHASE 1: Initial build (one-shot, wait for completion)
  // =========================================================
  console.log("🔨 Building main process...");

  const mainCjsPath = join(DIST_DIR, "main.cjs");
  const preloadCjsPath = join(DIST_DIR, "preload.cjs");

  if (existsSync(mainCjsPath)) rmSync(mainCjsPath);
  if (existsSync(preloadCjsPath)) rmSync(preloadCjsPath);

  const [mainResult, preloadResult] = await Promise.all([
    runEsbuild(
      "apps/electron/src/main/index.ts",
      "apps/electron/dist/main.cjs",
      oauthDefines
    ),
    runEsbuild(
      "apps/electron/src/preload/index.ts",
      "apps/electron/dist/preload.cjs"
    ),
  ]);

  if (!mainResult.success) {
    console.error("❌ Main process build failed:", mainResult.error);
    process.exit(1);
  }

  if (!preloadResult.success) {
    console.error("❌ Preload build failed:", preloadResult.error);
    process.exit(1);
  }

  console.log("⏳ Waiting for build files to stabilize...");
  const [mainStable, preloadStable] = await Promise.all([
    waitForFileStable(mainCjsPath),
    waitForFileStable(preloadCjsPath),
  ]);

  if (!mainStable || !preloadStable) {
    console.error("❌ Build files did not stabilize");
    process.exit(1);
  }

  console.log("🔍 Verifying build output...");
  const [mainValid, preloadValid] = await Promise.all([
    verifyJsFile(mainCjsPath),
    verifyJsFile(preloadCjsPath),
  ]);

  if (!mainValid.valid) {
    console.error("❌ main.cjs is invalid:", mainValid.error);
    process.exit(1);
  }

  if (!preloadValid.valid) {
    console.error("❌ preload.cjs is invalid:", preloadValid.error);
    process.exit(1);
  }

  console.log("✅ Initial build complete and verified\n");

  // =========================================================
  // PHASE 2: Start dev servers with watch mode
  // =========================================================
  console.log("📡 Starting dev servers...\n");

  const childProcesses: ChildProcess[] = [];
  const esbuildContexts: esbuild.BuildContext[] = [];

  // 1. Vite dev server
  const viteProc = spawn(VITE_BIN, ["dev", "--config", "apps/electron/vite.config.ts", "--port", vitePort, "--strictPort"], {
    cwd: ROOT_DIR,
    stdio: ["ignore", "inherit", "inherit"],
    env: process.env as Record<string, string>,
    shell: IS_WINDOWS,
  });
  childProcesses.push(viteProc);

  // 2. Main process watcher
  const mainContext = await esbuild.context({
    entryPoints: [join(ROOT_DIR, "apps/electron/src/main/index.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: join(ROOT_DIR, "apps/electron/dist/main.cjs"),
    external: ["electron"],
    define: oauthDefines,
    logLevel: "info",
  });
  await mainContext.watch();
  esbuildContexts.push(mainContext);
  console.log("👀 Watching main process...");

  // 3. Preload watcher
  const preloadContext = await esbuild.context({
    entryPoints: [join(ROOT_DIR, "apps/electron/src/preload/index.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: join(ROOT_DIR, "apps/electron/dist/preload.cjs"),
    external: ["electron"],
    logLevel: "info",
  });
  await preloadContext.watch();
  esbuildContexts.push(preloadContext);
  console.log("👀 Watching preload...");

  // 4. Start Electron
  console.log("🚀 Starting Electron...\n");

  const electronProc = spawn(ELECTRON_BIN, ["apps/electron"], {
    cwd: ROOT_DIR,
    stdio: ["ignore", "inherit", "inherit"],
    env: getElectronEnv(),
    shell: IS_WINDOWS,
  });
  childProcesses.push(electronProc);

  // Handle cleanup on exit
  const cleanup = async () => {
    console.log("\n🛑 Shutting down...");
    for (const ctx of esbuildContexts) {
      try {
        await ctx.dispose();
      } catch {
        // Context may already be disposed
      }
    }
    for (const proc of childProcesses) {
      try {
        proc.kill();
      } catch {
        // Process may already be dead
      }
    }
    process.exit(0);
  };

  process.on("SIGINT", () => cleanup());
  process.on("SIGTERM", () => cleanup());

  if (process.platform === "win32") {
    process.on("SIGHUP", () => cleanup());
  }

  // Wait for electron to exit
  electronProc.on("exit", () => cleanup());
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
