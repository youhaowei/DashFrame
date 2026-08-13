#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

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

export function getDevInfo(
  root = process.cwd(),
  surface = process.env.DASHFRAME_DEV_SURFACE ?? "web",
) {
  const resolvedRoot = resolve(root);
  const safeSurface = sanitizeHostnameLabel(surface);
  if (!safeSurface) {
    throw new Error("The development surface must contain a letter or number");
  }
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
    surface: safeSurface,
    root: resolvedRoot,
    manifest: join(resolvedRoot, ".data", `dev-${safeSurface}.json`),
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
  } catch {
    return null;
  }
}

function isPid(value) {
  return Number.isInteger(value) && value > 0;
}

export function writeManifest(
  info,
  runtime = {
    launcherPid: Number(process.env.DASHFRAME_DEV_LAUNCHER_PID),
    processes: {
      server: Number(process.env.DASHFRAME_DEV_SERVER_PID),
      vite: Number(process.env.DASHFRAME_DEV_VITE_PID),
    },
    endpoints: {
      app: process.env.PORTLESS_URL,
      api: process.env.VITE_WYSTACK_URL,
    },
    requiredEndpoints: ["app", "api"],
    projectDir: process.env.DASHFRAME_PROJECT_DIR,
  },
) {
  if (!isPid(runtime.launcherPid)) {
    throw new Error("A positive development launcher PID is required");
  }
  const processes = Object.fromEntries(
    Object.entries(runtime.processes ?? {}).filter(([, pid]) => pid != null),
  );
  if (
    Object.keys(processes).length === 0 ||
    Object.values(processes).some((pid) => !isPid(pid))
  ) {
    throw new Error("Development process PIDs must be positive integers");
  }
  const endpoints = Object.fromEntries(
    Object.entries(runtime.endpoints ?? {}).filter(
      ([, url]) => typeof url === "string" && url.length > 0,
    ),
  );
  if (Object.keys(endpoints).length === 0) {
    throw new Error("At least one development endpoint is required");
  }
  const missingEndpoints = (runtime.requiredEndpoints ?? []).filter(
    (name) => !endpoints[name],
  );
  if (missingEndpoints.length > 0) {
    throw new Error(
      `Missing required development endpoints: ${missingEndpoints.join(", ")}`,
    );
  }
  const manifest = {
    schemaVersion: 2,
    surface: info.surface,
    id: info.id,
    name: info.name,
    launcherPid: runtime.launcherPid,
    processes,
    endpoints,
    projectDir: runtime.projectDir ?? null,
    startedAt: new Date().toISOString(),
  };
  const tempPath = `${info.manifest}.${runtime.launcherPid}.tmp`;
  mkdirSync(dirname(info.manifest), { recursive: true });
  writeFileSync(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(tempPath, info.manifest);
  chmodSync(info.manifest, 0o600);
  process.stdout.write(
    `[dev-runtime] ${manifest.surface}: ${Object.values(endpoints).join(", ")}\n`,
  );
  process.stdout.write(`[dev-runtime] manifest: ${info.manifest}\n`);
}

export function clearManifest(info, expectedLauncherPid) {
  const manifest = readManifest(info.manifest);
  if (manifest && manifest.launcherPid === expectedLauncherPid) {
    rmSync(info.manifest);
  }
}

export function clearStoppedManifest(info, expectedLauncherPid) {
  const manifest = readManifest(info.manifest);
  if (!manifest) return true;
  if (manifest.launcherPid !== expectedLauncherPid) return false;
  if (Object.values(manifest.processes ?? {}).some(processIsRunning)) {
    return false;
  }
  rmSync(info.manifest);
  return true;
}

export function status(info) {
  const manifest = readManifest(info.manifest);
  const running = Boolean(
    manifest &&
    processIsRunning(manifest.launcherPid) &&
    Object.values(manifest.processes ?? {}).length > 0 &&
    Object.values(manifest.processes).every(processIsRunning),
  );
  return {
    surface: manifest?.surface ?? info.surface,
    id: manifest?.id ?? info.id,
    name: manifest?.name ?? info.name,
    running,
    stale: Boolean(manifest) && !running,
    manifest,
  };
}

export function allStatuses(root = process.cwd()) {
  const resolvedRoot = resolve(root);
  const dataDir = join(resolvedRoot, ".data");
  let files;
  try {
    files = readdirSync(dataDir);
  } catch {
    return [];
  }
  return files
    .filter((file) => /^dev-[a-z0-9-]+\.json$/.test(file))
    .sort()
    .map((file) => {
      const surface = file.slice(4, -5);
      return status(getDevInfo(resolvedRoot, surface));
    });
}

function usage() {
  process.stderr.write(
    "Usage: node scripts/dev-worktree.mjs <identity|info|name|manifest|write|clear|clear-stopped|status|status-all> [root] [launcher-pid]\n",
  );
}

const isMain = Boolean(
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url,
);

if (isMain) {
  const [command = "info", root = process.cwd(), launcherPid] =
    process.argv.slice(2);
  const info = getDevInfo(root);

  switch (command) {
    case "identity":
      process.stdout.write(
        `${JSON.stringify({ id: info.id, name: info.name, root: info.root }, null, 2)}\n`,
      );
      break;
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
    case "clear-stopped":
      if (!clearStoppedManifest(info, Number(launcherPid))) {
        process.exitCode = 1;
      }
      break;
    case "status":
      process.stdout.write(`${JSON.stringify(status(info), null, 2)}\n`);
      break;
    case "status-all":
      process.stdout.write(`${JSON.stringify(allStatuses(root), null, 2)}\n`);
      break;
    default:
      usage();
      process.exitCode = 2;
  }
}
