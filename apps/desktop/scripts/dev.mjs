#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";

const desktopDir = path.resolve(import.meta.dirname, "..");
const rendererDir = path.resolve(desktopDir, "..", "renderer");

let viteProc = null;
let electronProc = null;

function cleanup() {
  if (electronProc && !electronProc.killed) electronProc.kill("SIGTERM");
  if (viteProc && !viteProc.killed) viteProc.kill("SIGTERM");
}

process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});
process.on("unhandledRejection", (err) => {
  console.error("[dev] startup failed:", err);
  cleanup();
  process.exit(1);
});

function awaitProc(child, label) {
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${label} failed (${code})`)),
    );
  });
}

// 1. Build server-core first — desktop's main bundle marks workspace
// packages as external, so @dashframe/server-core must exist as JS at
// dist/index.js before main.ts is bundled. Electron 33 (Node 20) cannot
// load .ts entry points at runtime.
await awaitProc(
  spawn("bun", ["run", "--filter", "@dashframe/server-core", "build"], {
    cwd: path.resolve(desktopDir, "..", ".."),
    stdio: "inherit",
  }),
  "server-core build",
);

// 2. Build desktop main + preload
await awaitProc(
  spawn("bun", ["run", "build"], { cwd: desktopDir, stdio: "inherit" }),
  "desktop build",
);

// 3. Start Vite in renderer; parse its stdout for the auto-assigned port
viteProc = spawn("bun", ["run", "dev"], {
  cwd: rendererDir,
  stdio: ["ignore", "pipe", "pipe"],
});

const viteUrl = await new Promise((resolve, reject) => {
  let settled = false;
  let stderr = "";
  const timeout = setTimeout(
    () => fail(new Error("Vite did not report a Local URL within 15s")),
    15_000,
  );
  function fail(error) {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    cleanup();
    reject(error);
  }
  viteProc.on("error", fail);
  viteProc.on("exit", (code) => {
    if (settled) return;
    const detail =
      code === 0
        ? "Vite exited cleanly before reporting URL"
        : `Vite failed before reporting URL (exit ${code})`;
    const stderrDetail = stderr.trim() ? `\n${stderr.trim()}` : "";
    fail(new Error(`${detail}${stderrDetail}`));
  });
  viteProc.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    process.stderr.write(text);
    stderr += text;
    if (stderr.length > 4096) stderr = stderr.slice(-4096);
  });
  // Buffer stdout across chunks — node stream chunk boundaries are arbitrary,
  // so the "Local: http://..." banner can split across chunks. Match against
  // the accumulated buffer (trimmed at line boundaries to bound memory).
  let buffer = "";
  viteProc.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    if (settled) return;
    buffer += text;
    // Match Vite banner: "  ➜  Local:   http://localhost:5174/"
    const match = buffer.match(/Local:\s+(https?:\/\/[^\s/]+)/);
    if (match) {
      settled = true;
      clearTimeout(timeout);
      resolve(match[1]);
      buffer = "";
      return;
    }
    // Cap buffer size: keep only last 4KB so an unbounded stream without
    // the banner doesn't grow without limit before the 15s timeout fires.
    if (buffer.length > 4096) buffer = buffer.slice(-4096);
  });
});

const cdpPort = process.env.CDP_PORT ?? "9222";

console.log(`\n[dev] Vite ready at ${viteUrl}`);
console.log(
  `[dev] Electron CDP: http://localhost:${cdpPort} (agent-browser --cdp localhost:${cdpPort})`,
);
console.log(`[dev] launching Electron...\n`);

// 4. Launch Electron with DEV_URL env + CDP remote debugging
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
electronProc.on("error", (error) => {
  console.error("[dev] Electron failed to launch:", error);
  cleanup();
  process.exit(1);
});
