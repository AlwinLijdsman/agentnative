/**
 * Cross-platform renderer build script
 * Modified for Node.js/tsx compatibility (Windows ARM64 support)
 */

import { spawn } from "child_process";
import { existsSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT_DIR = join(__dirname, "..");
const ELECTRON_DIR = join(ROOT_DIR, "apps/electron");

// Clean renderer dist first
const rendererDir = join(ELECTRON_DIR, "dist/renderer");
if (existsSync(rendererDir)) {
  rmSync(rendererDir, { recursive: true, force: true });
}

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

async function main(): Promise<void> {
  const exitCode = await runCommand("npx", ["vite", "build", "--config", "apps/electron/vite.config.ts"]);
  process.exit(exitCode);
}

main();
