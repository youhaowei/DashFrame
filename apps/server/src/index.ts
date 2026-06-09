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
  token?: string;
  insecure?: boolean;
  help?: boolean;
}

const DEFAULT_WEB_PROJECT_DIR = path.join(
  homedir(),
  ".DashFrame",
  "web-project",
);

export function printHelp(): void {
  console.log(`dashframe serve

Options:
  --project <dir>         Project directory (default: DASHFRAME_PROJECT_DIR or ~/.DashFrame/web-project)
  --bind <addr>           Bind address as host[:port] (default: 127.0.0.1:0)
  --token <token>         Require Bearer token auth for HTTP and WebSocket clients
  --host <host>           Bind host alias (default: 127.0.0.1)
  --port <port>           Bind port alias (default: 0, OS-assigned)
  --name <name>           Project display name when initializing
  --cors-origin <origin>  Allowed browser origin; repeat or comma-separate for multiple
  --insecure              Allow a non-loopback bind without --token (opt out of the auth requirement)
  --help                  Show this help

Security boundary:
  The server exposes the selected local DashFrame project over HTTP and WebSocket.
  The default bind is loopback-only and safe to run without a token. Binding to
  0.0.0.0 or another network interface makes the project reachable from that
  network, so a non-loopback bind requires --token; pass --insecure to opt out
  deliberately. A token is not TLS and not multi-user authorization.
`);
}

function readValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parsePort(raw: string): number {
  if (!raw.trim()) {
    throw new Error(`Invalid --port "${raw}"`);
  }
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

function applyBind(opts: CliOptions, raw: string): void {
  if (!raw.trim()) {
    throw new Error("--bind requires a non-empty address");
  }

  if (raw.startsWith(":")) {
    opts.port = parsePort(raw.slice(1));
    return;
  }

  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    if (end === -1) {
      throw new Error(`Invalid --bind "${raw}"`);
    }
    opts.hostname = raw.slice(1, end);
    const suffix = raw.slice(end + 1);
    if (suffix) {
      if (!suffix.startsWith(":")) {
        throw new Error(`Invalid --bind "${raw}"`);
      }
      opts.port = parsePort(suffix.slice(1));
    }
    return;
  }

  const colon = raw.lastIndexOf(":");
  if (colon > 0 && raw.indexOf(":") === colon) {
    opts.hostname = raw.slice(0, colon);
    opts.port = parsePort(raw.slice(colon + 1));
    return;
  }

  opts.hostname = raw;
}

export function parseArgs(args: string[]): CliOptions {
  const opts: CliOptions = {};

  const normalizedArgs = args[0] === "serve" ? args.slice(1) : args;

  let i = 0;
  while (i < normalizedArgs.length) {
    i = parseArgAt(opts, normalizedArgs, i);
    i += 1;
  }

  return opts;
}

function parseArgAt(opts: CliOptions, args: string[], index: number): number {
  const arg = args[index]!;

  switch (arg) {
    case "--help":
    case "-h":
      opts.help = true;
      return index;
    case "--bind":
      applyBind(opts, readValue(args, index, arg));
      return index + 1;
    case "--host":
      opts.hostname = readValue(args, index, arg);
      return index + 1;
    case "--port":
      opts.port = parsePort(readValue(args, index, arg));
      return index + 1;
    case "--project":
      opts.project = readValue(args, index, arg);
      return index + 1;
    case "--name":
      opts.name = readValue(args, index, arg);
      return index + 1;
    case "--cors-origin":
      opts.corsOrigin = appendCorsOrigins(
        opts.corsOrigin,
        readValue(args, index, arg),
      );
      return index + 1;
    case "--token":
      opts.token = readValue(args, index, arg);
      return index + 1;
    case "--insecure":
      opts.insecure = true;
      return index;
    default:
      throw new Error(`Unknown argument "${arg}"`);
  }
}

function isLoopback(hostname: string | undefined): boolean {
  return (
    hostname === undefined ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1"
  );
}

/**
 * Fail-closed auth gate. Loopback binds are reachable only from this machine,
 * so a token is optional there. A non-loopback bind exposes the project to the
 * network and must carry `--token`; `--insecure` is the deliberate opt-out.
 * Throws (rather than warns) so a forgotten token never silently exposes data.
 */
export function assertBindIsSafe(opts: CliOptions): void {
  if (isLoopback(opts.hostname) || opts.token || opts.insecure) {
    return;
  }
  throw new Error(
    `Refusing to bind ${opts.hostname} without --token: a non-loopback bind ` +
      `exposes this project to the network. Pass --token <token>, or ` +
      `--insecure to opt out deliberately.`,
  );
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

export async function main(args = process.argv.slice(2)): Promise<void> {
  const opts = parseArgs(args);
  if (opts.help) {
    printHelp();
    return;
  }

  assertBindIsSafe(opts);

  if (opts.insecure && !opts.token && !isLoopback(opts.hostname)) {
    console.warn(
      "[dashframe] warning: --insecure non-loopback bind without --token exposes this project to the network",
    );
  }

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
    authToken: opts.token,
  });

  closeOnSignal(project, server);

  console.log(`[dashframe] project: ${project.dir}`);
  console.log(`[dashframe] listening: ${server.url}`);
  console.log("[dashframe] ready");
}

if (import.meta.main) {
  try {
    await main();
  } catch (err) {
    // Operator-facing CLI: print a one-line reason and exit non-zero rather
    // than dumping a stack trace for expected failures like the auth gate.
    console.error(`[dashframe] ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
