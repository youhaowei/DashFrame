#!/usr/bin/env bun
/**
 * `dashframe serve` — Bun CLI entry for the headless DashFrame server.
 *
 * Starts the same WyStack HTTP+WS server the Electron main process uses, backed
 * by an on-disk DashFrame project. Web dev can point `VITE_WYSTACK_URL` at the
 * printed URL.
 */
import { openProject, type ProjectHandle } from "@dashframe/server-core";
import { homedir } from "node:os";
import path from "node:path";

import { createDashframeServer, type DashframeServer } from "./app";

interface CliOptions {
  hostname?: string;
  port?: number;
  project?: string;
  name?: string;
  corsOrigin?: string | string[];
}

const DEFAULT_WEB_PROJECT_DIR = path.join(
  homedir(),
  ".DashFrame",
  "web-project",
);

function printHelp(): void {
  console.log(`dashframe serve

Options:
  --host <host>           Bind host (default: 127.0.0.1)
  --port <port>           Bind port (default: 0, OS-assigned)
  --project <dir>         Project directory (default: DASHFRAME_PROJECT_DIR or ~/.DashFrame/web-project)
  --name <name>           Project display name when initializing
  --cors-origin <origin>  Allowed browser origin; repeat or comma-separate for multiple
  --help                  Show this help
`);
}

function readValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parsePort(raw: string): number {
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid --port "${raw}"`);
  }
  return port;
}

function appendCorsOrigins(
  current: CliOptions["corsOrigin"],
  raw: string,
): string[] {
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  let existing: string[] = [];
  if (Array.isArray(current)) {
    existing = current;
  } else if (current) {
    existing = [current];
  }
  return [...existing, ...values];
}

function parseArgs(args: string[]): CliOptions {
  const opts: CliOptions = {};

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    if (arg === "--host") {
      opts.hostname = readValue(args, i, arg);
      i += 1;
      continue;
    }

    if (arg === "--port") {
      opts.port = parsePort(readValue(args, i, arg));
      i += 1;
      continue;
    }

    if (arg === "--project") {
      opts.project = readValue(args, i, arg);
      i += 1;
      continue;
    }

    if (arg === "--name") {
      opts.name = readValue(args, i, arg);
      i += 1;
      continue;
    }

    if (arg === "--cors-origin") {
      opts.corsOrigin = appendCorsOrigins(
        opts.corsOrigin,
        readValue(args, i, arg),
      );
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument "${arg}"`);
  }

  return opts;
}

function closeOnSignal(project: ProjectHandle, server: DashframeServer): void {
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    server.stop();
    await project.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void close());
  process.on("SIGTERM", () => void close());
}

const opts = parseArgs(process.argv.slice(2));
const project = await openProject({
  dir:
    opts.project ??
    process.env.DASHFRAME_PROJECT_DIR ??
    DEFAULT_WEB_PROJECT_DIR,
  name: opts.name,
});
const server = await createDashframeServer({
  db: project.db,
  hostname: opts.hostname,
  port: opts.port,
  corsOrigin: opts.corsOrigin,
});

closeOnSignal(project, server);

console.log(`[dashframe] project: ${project.dir}`);
console.log(`[dashframe] server: ${server.url}`);
console.log("[dashframe] ready");
