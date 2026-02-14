/**
 * Cross-platform preload build script with verification
 * Modified for Node.js/tsx compatibility (Windows ARM64 support)
 */

import { spawn } from "child_process";
import { existsSync, statSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT_DIR = join(__dirname, "..");
const DIST_DIR = join(ROOT_DIR, "apps/electron/dist");
const OUTPUT_FILE = join(DIST_DIR, "preload.cjs");

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

async function main(): Promise<void> {
  if (!existsSync(DIST_DIR)) {
    mkdirSync(DIST_DIR, { recursive: true });
  }

  console.log("Building preload...");

  const exitCode = await runCommand("npx", [
    "esbuild",
    "apps/electron/src/preload/index.ts",
    "--bundle",
    "--platform=node",
    "--format=cjs",
    "--outfile=apps/electron/dist/preload.cjs",
    "--external:electron",
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

  console.log("Preload build complete and verified");
  process.exit(0);
}

main();
