#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";

const desktopDir = path.resolve(import.meta.dirname, "..");
const rendererDir = path.resolve(desktopDir, "..", "renderer");

let viteProc = null;
let electronProc = null;

function cleanup() {
  electronProc?.kill("SIGTERM");
  viteProc?.kill("SIGTERM");
}

process.on("SIGINT", () => { cleanup(); process.exit(0); });
process.on("SIGTERM", () => { cleanup(); process.exit(0); });

// 1. Build main + preload
const build = spawn("bun", ["run", "build"], {
  cwd: desktopDir,
  stdio: "inherit",
});
await new Promise((resolve, reject) => {
  build.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`build failed (${code})`)));
});

// 2. Start Vite in renderer; parse its stdout for the auto-assigned port
viteProc = spawn("bun", ["run", "dev"], {
  cwd: rendererDir,
  stdio: ["ignore", "pipe", "inherit"],
});

const viteUrl = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Vite did not report a Local URL within 15s")), 15_000);
  viteProc.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    // Match Vite banner: "  ➜  Local:   http://localhost:5174/"
    const match = text.match(/Local:\s+(https?:\/\/[^\s/]+)/);
    if (match) {
      clearTimeout(timeout);
      resolve(match[1]);
    }
  });
  viteProc.on("exit", (code) => {
    clearTimeout(timeout);
    reject(new Error(`Vite exited before reporting URL (${code})`));
  });
});

const cdpPort = process.env.CDP_PORT ?? "9222";

console.log(`\n[dev] Vite ready at ${viteUrl}`);
console.log(`[dev] Electron CDP: http://localhost:${cdpPort} (agent-browser --cdp localhost:${cdpPort})`);
console.log(`[dev] launching Electron...\n`);

// 3. Launch Electron with DEV_URL env + CDP remote debugging
electronProc = spawn("electron", [`--remote-debugging-port=${cdpPort}`, "."], {
  cwd: desktopDir,
  env: { ...process.env, DEV_URL: viteUrl },
  stdio: "inherit",
});

electronProc.on("exit", (code) => {
  console.log(`[dev] Electron exited (${code}), shutting down Vite...`);
  viteProc?.kill("SIGTERM");
  process.exit(code ?? 0);
});
