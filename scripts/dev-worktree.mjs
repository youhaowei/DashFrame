#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const DEFAULT_APP_NAME = "dashframe";

function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

export function sanitizeHostnameLabel(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function createDevIdentity({
  root,
  repoName = DEFAULT_APP_NAME,
  isMainWorktree = false,
  explicitName,
}) {
  if (explicitName) {
    const name = sanitizeHostnameLabel(explicitName)
      .slice(0, 63)
      .replace(/-+$/g, "");
    if (!name)
      throw new Error("DASHFRAME_DEV_NAME must contain a letter or number");
    return { id: name, name };
  }

  if (isMainWorktree) return { id: "main", name: repoName };

  const rootName = basename(root);
  const hint =
    rootName.toLowerCase() === repoName.toLowerCase()
      ? basename(dirname(root))
      : rootName;
  const hash = createHash("sha256").update(root).digest("hex").slice(0, 6);
  const prefix = `${repoName}-`;
  const safeHint = sanitizeHostnameLabel(hint) || "worktree";
  const maxHintLength = 63 - prefix.length - hash.length - 1;
  const shortHint = safeHint.slice(0, maxHintLength).replace(/-+$/g, "");
  const id = `${shortHint}-${hash}`;
  const name = `${prefix}${id}`;
  return { id, name };
}

export function getDevInfo(root = process.cwd()) {
  const resolvedRoot = resolve(root);
  const gitDir = resolve(
    resolvedRoot,
    git(["rev-parse", "--git-dir"], resolvedRoot),
  );
  const commonDir = resolve(
    resolvedRoot,
    git(["rev-parse", "--git-common-dir"], resolvedRoot),
  );
  const identity = createDevIdentity({
    root: resolvedRoot,
    isMainWorktree: gitDir === commonDir,
    explicitName: process.env.DASHFRAME_DEV_NAME,
  });

  return {
    ...identity,
    root: resolvedRoot,
    manifest: join(resolvedRoot, ".data", "dev-web.json"),
  };
}

function processIsRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readManifest(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function writeManifest(info) {
  const launcherPid = Number(process.env.DASHFRAME_DEV_LAUNCHER_PID);
  const serverPid = Number(process.env.DASHFRAME_DEV_SERVER_PID);
  if (!Number.isInteger(launcherPid) || !Number.isInteger(serverPid)) {
    throw new Error("The dev launcher and server PIDs are required");
  }
  if (!process.env.PORTLESS_URL || !process.env.VITE_WYSTACK_URL) {
    throw new Error("The Portless and API URLs are required");
  }
  const manifest = {
    schemaVersion: 1,
    id: info.id,
    name: info.name,
    webUrl: process.env.PORTLESS_URL,
    apiUrl: process.env.VITE_WYSTACK_URL,
    launcherPid,
    serverPid,
    projectDir: process.env.DASHFRAME_PROJECT_DIR,
    startedAt: new Date().toISOString(),
  };
  const tempPath = `${info.manifest}.${launcherPid}.tmp`;
  mkdirSync(dirname(info.manifest), { recursive: true });
  writeFileSync(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(tempPath, info.manifest);
  chmodSync(info.manifest, 0o600);
  process.stdout.write(`[dev-web] web: ${manifest.webUrl}\n`);
  process.stdout.write(`[dev-web] runtime manifest: ${info.manifest}\n`);
}

function clearManifest(info, expectedLauncherPid) {
  const manifest = readManifest(info.manifest);
  if (manifest && manifest.launcherPid === expectedLauncherPid) {
    rmSync(info.manifest);
  }
}

function status(info) {
  const manifest = readManifest(info.manifest);
  const running = Boolean(
    manifest &&
    processIsRunning(manifest.launcherPid) &&
    processIsRunning(manifest.serverPid),
  );
  return {
    id: info.id,
    name: info.name,
    running,
    stale: Boolean(manifest) && !running,
    manifest,
  };
}

function usage() {
  process.stderr.write(
    "Usage: node scripts/dev-worktree.mjs <info|name|manifest|write|clear|status> [root] [launcher-pid]\n",
  );
}

if (import.meta.main) {
  const [command = "info", root = process.cwd(), launcherPid] =
    process.argv.slice(2);
  const info = getDevInfo(root);

  switch (command) {
    case "info":
      process.stdout.write(`${JSON.stringify(info, null, 2)}\n`);
      break;
    case "name":
      process.stdout.write(`${info.name}\n`);
      break;
    case "manifest":
      process.stdout.write(`${info.manifest}\n`);
      break;
    case "write":
      writeManifest(info);
      break;
    case "clear":
      clearManifest(info, Number(launcherPid));
      break;
    case "status":
      process.stdout.write(`${JSON.stringify(status(info), null, 2)}\n`);
      break;
    default:
      usage();
      process.exitCode = 2;
  }
}
