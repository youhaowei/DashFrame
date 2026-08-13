#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";

import {
  clearManifest,
  getDevInfo,
  writeManifest,
} from "../../../scripts/dev-worktree.mjs";

const desktopDir = path.resolve(import.meta.dirname, "..");
const rendererDir = path.resolve(desktopDir, "..", "renderer");
const repoRoot = path.resolve(desktopDir, "..", "..");
const electronBinary = path.join(
  desktopDir,
  "node_modules",
  ".bin",
  "electron",
);
const runtimeInfo = getDevInfo(repoRoot, "desktop");
const projectDir =
  process.env.DASHFRAME_PROJECT_DIR ??
  (runtimeInfo.id === "main"
    ? undefined
    : path.join(repoRoot, ".data", "desktop-project"));
const childEnv = {
  ...process.env,
  ...(projectDir ? { DASHFRAME_PROJECT_DIR: projectDir } : {}),
};

let viteProc = null;
let electronProc = null;
let setupProc = null;
let shutdownPromise = null;
let shutdownRequested = false;

function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const forceTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    forceTimer.unref();
    child.once("exit", () => {
      clearTimeout(forceTimer);
      resolve();
    });
    if (!child.kill("SIGTERM")) {
      clearTimeout(forceTimer);
      resolve();
    }
  });
}

function cleanup(exitCode) {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    await stopChild(electronProc);
    await stopChild(viteProc);
    await stopChild(setupProc);
    clearManifest(runtimeInfo, process.pid);
    process.exitCode = exitCode;
  })();
  return shutdownPromise;
}

process.on("SIGINT", () => {
  shutdownRequested = true;
  void cleanup(130);
});
process.on("SIGTERM", () => {
  shutdownRequested = true;
  void cleanup(143);
});
process.on("unhandledRejection", (err) => {
  console.error("[dev] startup failed:", err);
  void cleanup(1);
});

function awaitProc(child, label) {
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${label} failed (${code})`)),
    );
  });
}

async function runSetup(args, cwd, label) {
  if (shutdownRequested) throw new Error("Development startup was stopped");
  setupProc = spawn("bun", args, { cwd, stdio: "inherit" });
  try {
    await awaitProc(setupProc, label);
  } finally {
    setupProc = null;
  }
  if (shutdownRequested) throw new Error("Development startup was stopped");
}

try {
  // The desktop main bundle resolves @dashframe/* and @wystack/* workspace
  // packages via the "bun" export condition → raw TypeScript source. esbuild
  // bundles them at build:main time, so no pre-built dist is needed for any
  // @dashframe/* package. Only @wystack/* still ship dist (submodule packages
  // outside this repo's control), so we build those first.
  // 1. Build the @wystack/* packages main consumes via @dashframe/server.
  // @dashframe/* packages are all TS-main; they resolve from src at bundle time.
  await runSetup(["run", "build:wystack"], repoRoot, "wystack build");

  // 2. Build desktop main + preload
  await runSetup(["run", "build"], desktopDir, "desktop build");

  // 3. Start Vite in renderer; parse its stdout for the auto-assigned port
  viteProc = spawn("bun", ["run", "dev"], {
    cwd: rendererDir,
    env: childEnv,
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
      void cleanup(1);
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

  const requestedCdpPort = process.env.CDP_PORT ?? "0";

  console.log(`\n[dev] Vite ready at ${viteUrl}`);
  console.log(`[dev] Electron CDP port: ${requestedCdpPort || "automatic"}`);
  console.log(`[dev] launching Electron...\n`);

  // 4. Launch Electron with DEV_URL env + CDP remote debugging
  electronProc = spawn(
    electronBinary,
    [`--remote-debugging-port=${requestedCdpPort}`, "."],
    {
      cwd: desktopDir,
      env: { ...childEnv, DEV_URL: viteUrl },
      stdio: ["inherit", "pipe", "pipe"],
    },
  );
  const electronExit = new Promise((resolve) => {
    electronProc.once("exit", (code) => resolve(code ?? 0));
  });

  await new Promise((resolve, reject) => {
    let settled = false;
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let windowReady = false;
    let apiUrl;
    let cdpUrl;
    const timeout = setTimeout(
      () => fail(new Error("Electron did not create its window within 30s")),
      30_000,
    );
    function fail(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    }
    function maybeReady() {
      if (!windowReady || !apiUrl || !cdpUrl || settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ apiUrl, cdpUrl });
    }
    electronProc.on("error", fail);
    electronProc.on("exit", (code) => {
      fail(new Error(`Electron exited before becoming ready (${code})`));
    });
    electronProc.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      process.stderr.write(text);
      if (settled) return;
      stderrBuffer = `${stderrBuffer}${text}`.slice(-4096);
      const match = stderrBuffer.match(
        /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//,
      );
      if (match) cdpUrl = `http://127.0.0.1:${match[1]}`;
      maybeReady();
    });
    electronProc.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      process.stdout.write(text);
      if (settled) return;
      stdoutBuffer = `${stdoutBuffer}${text}`.slice(-4096);
      windowReady ||= stdoutBuffer.includes("[dashframe] window created");
      const match = stdoutBuffer.match(
        /\[dashframe\] loopback server ready at (http:\/\/[^\s]+)/,
      );
      if (match) apiUrl = match[1];
      maybeReady();
    });
  }).then(({ apiUrl, cdpUrl }) => {
    writeManifest(runtimeInfo, {
      launcherPid: process.pid,
      processes: {
        renderer: viteProc.pid,
        electron: electronProc.pid,
      },
      endpoints: {
        renderer: viteUrl,
        api: apiUrl,
        cdp: cdpUrl,
      },
      requiredEndpoints: ["renderer", "api", "cdp"],
      projectDir,
    });
    console.log(
      `[dev] Electron CDP ready at ${cdpUrl} (see bun run dev:desktop:status)`,
    );
  });

  const electronExitCode = await electronExit;
  console.log(
    `[dev] Electron exited (${electronExitCode}), shutting down Vite...`,
  );
  await cleanup(electronExitCode);
} catch (error) {
  console.error("[dev] startup failed:", error);
  await cleanup(1);
}
