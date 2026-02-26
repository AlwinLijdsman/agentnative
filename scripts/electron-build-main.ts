/**
 * Cross-platform main process build script
 * Loads .env and passes OAuth defines to esbuild
 * Modified for Node.js/tsx compatibility (Windows ARM64 support)
 */

import { spawn } from "child_process";
import { existsSync, readFileSync, statSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT_DIR = join(__dirname, "..");
const DIST_DIR = join(ROOT_DIR, "apps/electron/dist");
const OUTPUT_FILE = join(DIST_DIR, "main.cjs");
const COPILOT_INTERCEPTOR_SOURCE = join(ROOT_DIR, "packages/shared/src/copilot-network-interceptor.ts");
const COPILOT_INTERCEPTOR_OUTPUT = join(DIST_DIR, "copilot-interceptor.cjs");
const BRIDGE_SERVER_DIR = join(ROOT_DIR, "packages/bridge-mcp-server");
const BRIDGE_SERVER_OUTPUT = join(BRIDGE_SERVER_DIR, "dist/index.js");
const SESSION_TOOLS_CORE_DIR = join(ROOT_DIR, "packages/session-tools-core");
const SESSION_SERVER_DIR = join(ROOT_DIR, "packages/session-mcp-server");
const SESSION_SERVER_OUTPUT = join(SESSION_SERVER_DIR, "dist/index.js");
const MERMAID_DIR = join(ROOT_DIR, "packages/mermaid");

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

function runCommand(cmd: string, args: string[], cwd: string = ROOT_DIR): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: "inherit",
      shell: true,
    });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

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
  }
}

function getBuildDefines(): string[] {
  const definedVars = [
    "SLACK_OAUTH_CLIENT_ID",
    "SLACK_OAUTH_CLIENT_SECRET",
    "MICROSOFT_OAUTH_CLIENT_ID",
    "MICROSOFT_OAUTH_CLIENT_SECRET",
    "SENTRY_ELECTRON_INGEST_URL",
  ];

  const defines = definedVars.map((varName) => {
    const value = process.env[varName] || "";
    // Escape quotes so esbuild sees a JS string literal after shell processing
    // On Windows, shell:true uses cmd.exe where \" is a literal quote
    return `--define:process.env.${varName}=\\"${value}\\"`;
  });

  // Embed build timestamp so stale builds are immediately visible (Section 21)
  const timestamp = new Date().toISOString();
  defines.push(`--define:process.env.BUILD_TIMESTAMP=\\"${timestamp}\\"`);

  return defines;
}

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

async function verifyJsFile(filePath: string): Promise<{ valid: boolean; error?: string }> {
  if (!existsSync(filePath)) {
    return { valid: false, error: "File does not exist" };
  }

  const stats = statSync(filePath);
  if (stats.size === 0) {
    return { valid: false, error: "File is empty" };
  }

  const exitCode = await runCommand("node", ["--check", filePath]);

  if (exitCode !== 0) {
    return { valid: false, error: "Syntax error" };
  }

  return { valid: true };
}

function verifySessionToolsCore(): void {
  console.log("Verifying Session Tools Core...");

  const sourceFile = join(SESSION_TOOLS_CORE_DIR, "src/index.ts");
  if (!existsSync(sourceFile)) {
    console.error("Session tools core source not found at", sourceFile);
    process.exit(1);
  }

  console.log("Session tools core verified");
}

async function buildCopilotInterceptor(): Promise<void> {
  console.log("Building Copilot network interceptor...");

  const exitCode = await runCommand("npx", [
    "esbuild",
    COPILOT_INTERCEPTOR_SOURCE,
    "--bundle",
    "--platform=node",
    "--format=cjs",
    `--outfile=${COPILOT_INTERCEPTOR_OUTPUT}`,
  ]);

  if (exitCode !== 0) {
    console.error("Copilot interceptor build failed with exit code", exitCode);
    process.exit(exitCode);
  }

  if (!existsSync(COPILOT_INTERCEPTOR_OUTPUT)) {
    console.error("Copilot interceptor output not found at", COPILOT_INTERCEPTOR_OUTPUT);
    process.exit(1);
  }

  console.log("Copilot interceptor built successfully");
}

async function buildBridgeServer(): Promise<void> {
  console.log("Building Bridge MCP Server...");

  const distDir = join(BRIDGE_SERVER_DIR, "dist");
  if (!existsSync(distDir)) {
    mkdirSync(distDir, { recursive: true });
  }

  const exitCode = await runCommand("npx", [
    "esbuild",
    join(BRIDGE_SERVER_DIR, "src/index.ts"),
    "--bundle",
    "--platform=node",
    "--format=cjs",
    `--outfile=${BRIDGE_SERVER_OUTPUT}`,
  ]);

  if (exitCode !== 0) {
    console.error("Bridge server build failed with exit code", exitCode);
    process.exit(exitCode);
  }

  if (!existsSync(BRIDGE_SERVER_OUTPUT)) {
    console.error("Bridge server output not found at", BRIDGE_SERVER_OUTPUT);
    process.exit(1);
  }

  console.log("Bridge server built successfully");
}

async function buildSessionServer(): Promise<void> {
  console.log("Building Session MCP Server...");

  const distDir = join(SESSION_SERVER_DIR, "dist");
  if (!existsSync(distDir)) {
    mkdirSync(distDir, { recursive: true });
  }

  const exitCode = await runCommand("npx", [
    "esbuild",
    join(SESSION_SERVER_DIR, "src/index.ts"),
    "--bundle",
    "--platform=node",
    "--format=cjs",
    `--outfile=${SESSION_SERVER_OUTPUT}`,
    `--alias:@craft-agent/session-tools-core=${join(SESSION_TOOLS_CORE_DIR, "src/index.ts")}`,
    `--alias:@craft-agent/mermaid=${join(MERMAID_DIR, "src/index.ts")}`,
  ]);

  if (exitCode !== 0) {
    console.error("Session server build failed with exit code", exitCode);
    process.exit(exitCode);
  }

  if (!existsSync(SESSION_SERVER_OUTPUT)) {
    console.error("Session server output not found at", SESSION_SERVER_OUTPUT);
    process.exit(1);
  }

  console.log("Session server built successfully");
}

async function main(): Promise<void> {
  loadEnvFile();

  if (!existsSync(DIST_DIR)) {
    mkdirSync(DIST_DIR, { recursive: true });
  }

  verifySessionToolsCore();
  await buildBridgeServer();
  await buildSessionServer();
  await buildCopilotInterceptor();

  const buildDefines = getBuildDefines();

  console.log("Building main process...");

  const exitCode = await runCommand("npx", [
    "esbuild",
    "apps/electron/src/main/index.ts",
    "--bundle",
    "--platform=node",
    "--format=cjs",
    "--outfile=apps/electron/dist/main.cjs",
    "--external:electron",
    ...buildDefines,
  ]);

  if (exitCode !== 0) {
    console.error("esbuild failed with exit code", exitCode);
    process.exit(exitCode);
  }

  console.log("Waiting for file to stabilize...");
  const stable = await waitForFileStable(OUTPUT_FILE);

  if (!stable) {
    console.error("Output file did not stabilize");
    process.exit(1);
  }

  console.log("Verifying build output...");
  const verification = await verifyJsFile(OUTPUT_FILE);

  if (!verification.valid) {
    console.error("Build verification failed:", verification.error);
    process.exit(1);
  }

  console.log("Build complete and verified");
  process.exit(0);
}

main();
