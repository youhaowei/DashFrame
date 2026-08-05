#!/usr/bin/env bun
/**
 * `dashframe serve` — Bun CLI entry for the headless DashFrame server.
 *
 * Starts the same WyStack HTTP+WS server the Electron main process uses, backed
 * by an on-disk DashFrame project. Web dev can point `VITE_WYSTACK_URL` at the
 * printed URL.
 */
import {
  ApiAccessCredentials,
  FileMappingStore,
  openProject,
  type ProjectHandle,
} from "@dashframe/server-core";
import { SecretRegistry, SecretVault } from "@wystack/secret-vault";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import {
  createDashframeServer,
  type DashframeServer,
  type DashframeServerOptions,
} from "./app";
import { isLoopbackHost } from "./bind-host";
import {
  ENCRYPTED_FILE_BACKEND_NAME,
  EncryptedFileSecretBackend,
  loadSecretKeyring,
} from "./secret-file-backend";

export interface CliOptions {
  hostname?: string;
  port?: number;
  project?: string;
  dataDir?: string;
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
const DEFAULT_DATA_DIR = path.join(homedir(), ".DashFrame", "data");
export function printHelp(): void {
  console.log(`dashframe serve

Options:
  --project <dir>         Project directory (default: DASHFRAME_PROJECT_DIR or ~/.DashFrame/web-project)
  --data-dir <dir>        Host-local data directory (default: DASHFRAME_DATA_DIR or ~/.DashFrame/data)
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

Secret encryption:
  Set DASHFRAME_SECRET_KEY_FILE to a mode-0600 key file, or DASHFRAME_SECRET_KEY
  directly. The value must be canonical padded base64 encoding of 32 bytes; one
  trailing newline is allowed in either spelling.

  DASHFRAME_SECRET_KEY_PREVIOUS holds a comma-separated list of retired keys in
  the same encoding. They are used only to DECRYPT blobs written before a
  rotation; new secrets are always written with the active key. Dropping a key
  from this list permanently loses access to any secret still stored under it.

  To rotate: generate a new key, set it as DASHFRAME_SECRET_KEY, and move the
  old value into DASHFRAME_SECRET_KEY_PREVIOUS. Rotation does NOT re-encrypt
  existing secrets — they stay under the key that wrote them, so rotating limits
  future exposure but does not remediate a compromised key. Full remediation
  means revoking and re-issuing the affected access credentials.

  All three variables are read once at startup; restart the server after
  changing any of them.

  With no key configured the server fails closed. Named access credentials are
  unavailable, nothing is written to disk in the clear, and credential-bearing
  writes are refused outright: there is no plaintext fallback.
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

  // A full-form IPv6 literal (e.g. `::1`, `fe80::1`) has multiple colons and
  // must be bracketed to disambiguate the host from a `:port` suffix. Catch it
  // before the port-only branch below, which would otherwise misread `::1:4000`
  // as port `:1:4000`.
  if (!raw.startsWith("[") && raw.indexOf(":") !== raw.lastIndexOf(":")) {
    throw new Error(
      `Invalid --bind "${raw}": bracket IPv6 addresses as [host]:port, e.g. [::1]:4000`,
    );
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
    case "--data-dir":
      opts.dataDir = readValue(args, index, arg);
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

/**
 * Fail-closed auth gate. Loopback binds are reachable only from this machine,
 * so a token is optional there. A non-loopback bind exposes the project to the
 * network and must carry `--token`; `--insecure` is the deliberate opt-out.
 * Throws (rather than warns) so a forgotten token never silently exposes data.
 */
export function assertBindIsSafe(opts: CliOptions): void {
  if (isLoopbackHost(opts.hostname) || opts.token || opts.insecure) {
    return;
  }
  throw new Error(
    `Refusing to bind ${opts.hostname} without --token: a non-loopback bind ` +
      `exposes this project to the network. Pass --token <token>, or ` +
      `--insecure to opt out deliberately.`,
  );
}

export interface StandaloneSecretServices {
  vault?: SecretVault;
  accessCredentials?: ApiAccessCredentials;
}

/** Resolve host-local storage independently from the copiable project path. */
export function resolveDataDir(
  opts: CliOptions,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return opts.dataDir ?? environment.DASHFRAME_DATA_DIR ?? DEFAULT_DATA_DIR;
}

export function resolveProjectDirectory(
  opts: CliOptions,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return (
    opts.project ?? environment.DASHFRAME_PROJECT_DIR ?? DEFAULT_WEB_PROJECT_DIR
  );
}

/** Refuse any configuration that places host-local access data in the project. */
export function assertAccessRootOutsideProject(
  projectDir: string,
  dataDir: string,
): void {
  const projectRoot = resolveExistingPathSegments(projectDir);
  const accessRoot = resolveExistingPathSegments(
    path.join(dataDir, "access-credentials"),
  );
  // macOS (APFS/HFS+) and Windows are case-insensitive by default, so a
  // byte-wise compare lets `--data-dir /Project/data` slip past a project at
  // `/project` — the same directory, spelled differently. Case-fold both sides
  // there so the containment check matches what the filesystem actually does.
  const foldCase =
    process.platform === "darwin" || process.platform === "win32";
  const relative = path.relative(
    foldCase ? projectRoot.toLowerCase() : projectRoot,
    foldCase ? accessRoot.toLowerCase() : accessRoot,
  );
  if (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  ) {
    throw new Error(
      "Refusing to place host-local access credentials inside the project directory. " +
        "Choose a separate --data-dir or DASHFRAME_DATA_DIR.",
    );
  }
}

/** Resolve symlinks in existing ancestors while preserving missing suffixes. */
function resolveExistingPathSegments(targetPath: string): string {
  let candidate = path.resolve(targetPath);
  const missingSegments: string[] = [];
  while (true) {
    let resolved: string;
    try {
      // Resolved outside the `path.join` argument list: a throw from inside
      // that call would otherwise have already consumed `missingSegments` via
      // the in-place `reverse()` below, corrupting the next iteration.
      resolved = realpathSync(candidate);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        // ENOTDIR (a file used as a directory), EACCES (unreadable ancestor):
        // real misconfigurations that deserve an operator-legible message
        // rather than a bare syscall error from deep in the CLI.
        throw new Error(
          `cannot resolve --data-dir "${targetPath}": ${code ?? "unknown error"}`,
          { cause: error },
        );
      }
      const parent = path.dirname(candidate);
      if (parent === candidate) return path.resolve(targetPath);
      missingSegments.push(path.basename(candidate));
      candidate = parent;
      continue;
    }
    // Copy before reversing — `reverse()` mutates in place.
    return path.join(resolved, ...[...missingSegments].reverse());
  }
}

/** Compose the optional standalone-server vault when key material is present. */
export async function createStandaloneSecretServices(
  dataDir: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<StandaloneSecretServices> {
  const keyring = await loadSecretKeyring(environment);
  if (!keyring) return {};

  const accessRoot = path.join(dataDir, "access-credentials");
  const registry = new SecretRegistry();
  const backend = new EncryptedFileSecretBackend(
    path.join(accessRoot, "blobs"),
    keyring,
  );
  // Permanent mapping identifier: NEVER change after secrets may exist under it.
  // Scoped to `serve-token` only (the brief's named class), and registered
  // WITHOUT `fallback: true` — `SecretRegistry#getForClass` resolves
  // registry-wide fallback ahead of an absent class default, so `fallback:
  // true` would silently route `connector-key` and `assistant-provider`
  // writes here too. Desktop keeps those classes on a project-scoped
  // DrizzleMappingStore so credential refs travel with the copiable project
  // DB; a class with no explicit default here must keep throwing rather than
  // land in this host-local vault.
  registry.register(ENCRYPTED_FILE_BACKEND_NAME, backend);
  registry.setClassDefault("serve-token", ENCRYPTED_FILE_BACKEND_NAME);

  const vault = new SecretVault(
    registry,
    new FileMappingStore(path.join(accessRoot, "mappings.json")),
  );
  return {
    vault,
    accessCredentials: new ApiAccessCredentials(vault, accessRoot),
  };
}

export function createStandaloneServerOptions(
  opts: CliOptions,
  project: ProjectHandle,
  secretServices: StandaloneSecretServices,
): DashframeServerOptions {
  return {
    db: project.db,
    hostname: opts.hostname,
    port: opts.port,
    corsOrigin: opts.corsOrigin,
    authToken: opts.token,
    ...secretServices,
    // Drive the debounced snapshot scheduler on the headless serve path too, so
    // `dashframe serve` gets the same crash-durability guarantee as desktop.
    onWrite: () => project.touchSnapshot(),
    // Durable counterpart: used by the pre-release gate before deleting a vault
    // ref so the snapshot that drops the ref is confirmed on disk first.
    flushSnapshot: () => project.flushSnapshot(),
  };
}

function closeOnSignal(project: ProjectHandle, server: DashframeServer): void {
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    server.stop();
    const result = await project.close();
    if (result.snapshotError) {
      console.error(
        "[dashframe] close-time snapshot failed (data may not be persisted):",
        result.snapshotError,
      );
    }
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

  if (opts.insecure && !opts.token && !isLoopbackHost(opts.hostname)) {
    console.warn(
      "[dashframe] warning: --insecure non-loopback bind without --token exposes this project to the network",
    );
  }

  const projectDir = resolveProjectDirectory(opts);
  const dataDir = resolveDataDir(opts);
  const secretServices = await createStandaloneSecretServices(dataDir);
  // Only meaningful once a vault exists: the check guards where host-local
  // access-credential blobs land, and a keyless serve never writes any. Running
  // it unconditionally would hard-fail an unusual --project/--data-dir layout
  // over a feature that host never enabled.
  if (secretServices.vault) {
    assertAccessRootOutsideProject(projectDir, dataDir);
  }

  const project = await openProject({
    dir: projectDir,
    name: opts.name,
  });

  // Headless parity with the desktop host: surface a WAL-recovery rollback to
  // the operator. The renderer dialog is desktop-only, so without this the CLI
  // would silently serve a project restored from an older snapshot (or a fresh
  // one) with no signal that changes since the last snapshot were lost.
  if (project.recovery) {
    const { restoredSnapshot, quarantinedPath } = project.recovery;
    console.warn(
      "[dashframe] WARNING: recovered from an unclean shutdown (WAL corruption).",
    );
    console.warn(
      restoredSnapshot
        ? `[dashframe]   restored from snapshot taken ${restoredSnapshot.timestamp}; changes since then are lost.`
        : "[dashframe]   no snapshot was available — started a fresh empty project.",
    );
    console.warn(
      `[dashframe]   damaged database quarantined at: ${quarantinedPath}`,
    );
  }

  const server = await createDashframeServer(
    createStandaloneServerOptions(opts, project, secretServices),
  );

  closeOnSignal(project, server);

  console.log(`[dashframe] project: ${project.dir}`);
  // Enabled/disabled only — never key material, and never a key ID derived
  // from it.
  console.log(
    secretServices.vault
      ? "[dashframe] secret encryption: enabled (named access credentials available)"
      : "[dashframe] secret encryption: disabled (no DASHFRAME_SECRET_KEY/_FILE; named access credentials unavailable)",
  );
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
