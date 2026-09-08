#!/usr/bin/env bun
/**
 * Report which OS sandboxing primitives are actually available in this runtime,
 * and prove that a real DuckDB chart workload still runs inside each one that is.
 *
 * Why this exists: the hosted multi-user design puts each workspace's DuckDB in
 * its own sandboxed query process. Whether that is possible is a property of the
 * *deployment platform*, not of our code — container runtimes differ in whether
 * they permit user namespaces, retain CAP_SYS_CHROOT, or apply a seccomp profile
 * that blocks the syscalls a sandbox needs. Guessing is not acceptable here: a
 * sandbox that silently fails to engage looks exactly like one that works.
 *
 * So this probe is written to be run ON the target platform, and to answer two
 * questions per candidate mechanism:
 *
 *   1. Can we enter it at all?
 *   2. Once inside, does a legitimate workload still work, and does a
 *      cross-boundary read actually fail?
 *
 * Question 2 is the one that matters. A sandbox that blocks the attack but also
 * blocks joins and aggregates is not a deployable answer, and a sandbox we can
 * enter but that still reads outside files is not a sandbox.
 *
 * The "attack" target is a disposable sentinel file this script writes itself,
 * containing a marker string and nothing else. No real secret is ever used as
 * test material.
 *
 * Run:  bun scripts/sandbox-probe.ts
 * On Railway: set DASHFRAME_SANDBOX_PROBE=1 and redeploy; the start script runs
 * this instead of the server and the report lands in the deploy logs.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

const REPO_ROOT = path.dirname(import.meta.dirname);
/**
 * The workload lives under `packages/engine-server` rather than beside this
 * file: it imports `@duckdb/node-api`, and Bun resolves from the importing
 * file's location. A copy in `scripts/` cannot see the dependency at all.
 */
const CHILD = path.join(
  REPO_ROOT,
  "packages/engine-server/scripts/sandbox-duck-child.ts",
);
/**
 * Workspace directories live inside the repository, not in the OS temp dir.
 * The sandbox is given a read-only view of the repository plus a writable bind
 * for its own workspace, and `/tmp` inside the sandbox is a fresh tmpfs — so a
 * workspace under `/tmp` would be shadowed by that tmpfs and the sandbox could
 * not chdir into it.
 */
const WORKSPACE_ROOT = path.join(REPO_ROOT, ".data", "sandbox-probe");

/** Linux capability bit positions we care about, from <linux/capability.h>. */
const CAPABILITIES: Record<string, number> = {
  CAP_DAC_OVERRIDE: 1,
  CAP_SETGID: 6,
  CAP_SETUID: 7,
  CAP_SYS_CHROOT: 18,
  CAP_SYS_ADMIN: 21,
  CAP_NET_ADMIN: 12,
  CAP_SYS_PTRACE: 19,
};

async function readOptional(file: string): Promise<string | null> {
  try {
    return (await readFile(file, "utf8")).trim();
  } catch {
    return null;
  }
}

async function processStatusField(name: string): Promise<string | null> {
  const status = await readOptional("/proc/self/status");
  if (!status) return null;
  for (const line of status.split("\n")) {
    if (line.startsWith(`${name}:`)) return line.slice(name.length + 1).trim();
  }
  return null;
}

async function effectiveCapabilities(): Promise<string[]> {
  const raw = await processStatusField("CapEff");
  if (!raw) return [];
  const mask = BigInt(`0x${raw}`);
  return Object.entries(CAPABILITIES)
    .filter(([, bit]) => (mask >> BigInt(bit)) & 1n)
    .map(([name]) => name);
}

interface CommandResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(
  command: string,
  args: string[],
  options: {
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
    cwd?: string;
  } = {},
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: options.env ?? process.env,
      ...(options.cwd ? { cwd: options.cwd } : {}),
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(
      () => child.kill("SIGKILL"),
      options.timeoutMs ?? 60_000,
    );
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    const finish = (result: CommandResult) => {
      clearTimeout(timer);
      // eslint-disable-next-line promise/no-multiple-resolved -- clearTimeout does not settle the promise.
      resolve(result);
    };
    child.on("error", (error) => {
      finish({ ok: false, code: null, stdout, stderr: String(error) });
    });
    child.on("close", (code) => {
      finish({ ok: code === 0, code, stdout, stderr });
    });
  });
}

function have(binary: string): boolean {
  return (
    spawnSync("sh", ["-c", `command -v ${binary}`], {
      stdio: "ignore",
    }).status === 0
  );
}

interface ChildVerdict {
  duckdbWorks?: boolean;
  envSentinelVisible?: boolean;
  inheritedFds?: string[];
  joinRows?: unknown;
  sentinelReadable?: boolean;
  sentinelReadableViaDuckdb?: boolean;
  restrictionsHeld?: boolean;
  networkReachable?: boolean;
  uid?: number | null;
  error?: string;
}

/** Parse the single JSON line the child prints, ignoring any other output. */
function parseVerdict(result: CommandResult): ChildVerdict {
  for (const line of result.stdout.split("\n").reverse()) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      return JSON.parse(trimmed) as ChildVerdict;
    } catch {
      // Not the verdict line; keep looking.
    }
  }
  return {
    error: `no verdict (exit ${result.code}): ${result.stderr.trim().slice(0, 300)}`,
  };
}

interface Candidate {
  name: string;
  note: string;
  available: boolean;
  /** Build the argv that runs `bun <child> <workdir> <sentinel>` under this sandbox. */
  wrap(workdir: string, sentinel: string): { command: string; args: string[] };
  /**
   * The environment the child is launched with. Omitted means "inherit the
   * probe's", which is the honest default: a mechanism that does not isolate
   * the environment should be measured as not isolating it.
   */
  env?(workdir: string): NodeJS.ProcessEnv;
  /** Working directory for the child, where the mechanism does not set one. */
  cwd?(workdir: string): string;
}

function bunPath(): string {
  return process.execPath;
}

/**
 * Built into the probe image from `deploy/sandbox-probe/landlock-exec.c`.
 * Absent on a developer machine unless it was compiled there, in which case the
 * candidate reports UNAVAILABLE rather than failing.
 */
const LANDLOCK_EXEC = "/usr/local/bin/landlock-exec";

/**
 * Directories the sandboxed child needs to READ to be able to run at all: the
 * runtime, its shared libraries, and the probe tree that holds the workload and
 * its node_modules. Everything not named here — including the sentinel — is
 * outside the sandbox.
 */
const RUNTIME_READ_PATHS = [
  "/usr",
  "/lib",
  "/lib64",
  "/bin",
  "/sbin",
  // Not optional: a Bun process reads its own /proc entries and /etc during
  // start-up, and without them it blocks rather than failing loudly.
  "/proc",
  "/etc",
  // DuckDB sizes its buffer pool from the container's cgroup limits, which live
  // under /sys/fs/cgroup. Denying it aborts the process inside the native
  // library ("Attempted to dereference unique_ptr that is NULL!") rather than
  // raising something JavaScript can catch, so the failure gives no clue what
  // it wanted.
  "/sys",
  "/run",
];
// Never granted: /var, because /var/tmp holds the out-of-sandbox sentinel.
// Adding it here would make the boundary test pass for the wrong reason.
/** Scratch the runtime writes to: /dev/null and friends, and temp files. */
const RUNTIME_WRITE_PATHS = ["/dev", "/tmp"];
/** Where the out-of-sandbox sentinel lives. Granted to no candidate. */
const SENTINEL_ROOT = "/var/tmp";

function candidates(): Candidate[] {
  const list: Candidate[] = [];

  list.push({
    name: "none (baseline)",
    note: "No sandbox. Establishes that the workload itself works and that the sentinel is genuinely readable without one.",
    available: true,
    wrap: (workdir, sentinel) => ({
      command: bunPath(),
      args: [CHILD, workdir, sentinel],
    }),
  });

  list.push({
    name: "bubblewrap",
    note: "Unprivileged user-namespace sandbox. Gives a private mount, PID, IPC, UTS and network namespace, and exposes only the paths named. This is the mechanism to prefer if it is available.",
    available: have("bwrap"),
    wrap: (workdir, sentinel) => ({
      command: "bwrap",
      args: [
        // Nothing from the parent's environment crosses. PATH and HOME are set
        // back explicitly because Bun needs them; no credential-shaped variable
        // is reinstated, and the probe verifies the marker did not survive.
        "--clearenv",
        "--setenv",
        "PATH",
        "/usr/local/bin:/usr/bin:/bin",
        "--setenv",
        "HOME",
        "/tmp",
        "--unshare-all",
        "--die-with-parent",
        "--new-session",
        // Read-only view of the runtime and the app, nothing else.
        "--ro-bind",
        "/usr",
        "/usr",
        "--ro-bind-try",
        "/lib",
        "/lib",
        "--ro-bind-try",
        "/lib64",
        "/lib64",
        "--ro-bind-try",
        "/bin",
        "/bin",
        "--ro-bind-try",
        "/sbin",
        "/sbin",
        "--ro-bind",
        REPO_ROOT,
        REPO_ROOT,
        "--ro-bind",
        bunPath(),
        bunPath(),
        // The workspace's own directory is the only writable path.
        "--proc",
        "/proc",
        "--dev",
        "/dev",
        // A private /tmp, mounted BEFORE the workspace bind so it cannot shadow
        // it. The host's /tmp — where the sentinel lives — is never bound, so
        // it does not exist inside the sandbox at all.
        "--tmpfs",
        "/tmp",
        // The workspace's own directory is the only writable path. It is bound
        // after the read-only repository view, so it wins.
        "--bind",
        workdir,
        workdir,
        "--chdir",
        workdir,
        bunPath(),
        CHILD,
        workdir,
        sentinel,
      ],
    }),
  });

  list.push({
    name: "landlock",
    note: "Unprivileged LSM self-restriction. Needs no capability, no namespace and no mount operation, which is the reason to try it where mount-based sandboxes are refused. Filesystem only (plus TCP from ABI 4) — it says nothing about UDP or raw sockets.",
    available: have(LANDLOCK_EXEC),
    wrap: (workdir, sentinel) => ({
      command: LANDLOCK_EXEC,
      args: [
        [workdir, ...RUNTIME_WRITE_PATHS].join(":"),
        [...RUNTIME_READ_PATHS, REPO_ROOT].join(":"),
        "--",
        bunPath(),
        CHILD,
        workdir,
        sentinel,
      ],
    }),
    // Landlock restricts the filesystem and TCP. It says nothing about the
    // environment, so clearing that stays the parent's job — as it is with any
    // mechanism; bubblewrap's --clearenv is a convenience, not a property of
    // namespaces. HOME points into the workspace because DuckDB writes an
    // extension directory under it and aborts hard if it cannot.
    env: (workdir) => ({
      PATH: "/usr/local/bin:/usr/bin:/bin",
      HOME: workdir,
    }),
    cwd: (workdir) => workdir,
  });

  list.push({
    name: "unshare (user+net+mount)",
    note: "Namespaces without bubblewrap. Proves the kernel permits unprivileged namespace creation even if bwrap is not installed in the image.",
    available: have("unshare"),
    wrap: (workdir, sentinel) => ({
      command: "unshare",
      args: [
        "--user",
        "--map-root-user",
        "--net",
        "--mount",
        "--pid",
        "--fork",
        bunPath(),
        CHILD,
        workdir,
        sentinel,
      ],
    }),
  });

  return list;
}

async function main(): Promise<void> {
  const report: Record<string, unknown> = {};
  report.platform = process.platform;
  report.kernel = (
    spawnSync("uname", ["-sr"], { encoding: "utf8" }).stdout ?? ""
  ).trim();
  report.node = process.version;
  report.uid = process.getuid?.() ?? null;
  report.gid = process.getgid?.() ?? null;
  report.effectiveCapabilities = await effectiveCapabilities();
  report.seccompMode = await processStatusField("Seccomp");
  report.noNewPrivs = await processStatusField("NoNewPrivs");
  report.unprivilegedUsernsClone = await readOptional(
    "/proc/sys/kernel/unprivileged_userns_clone",
  );
  report.maxUserNamespaces = await readOptional(
    "/proc/sys/user/max_user_namespaces",
  );
  report.apparmorUsernsRestrict = await readOptional(
    "/proc/sys/kernel/apparmor_restrict_unprivileged_userns",
  );
  report.tools = {
    bwrap: have("bwrap"),
    unshare: have("unshare"),
    setpriv: have("setpriv"),
    chroot: have("chroot"),
    landlockExec: have(LANDLOCK_EXEC),
  };
  // Two mechanisms that need no mount operation, probed for availability
  // separately from the candidate runs below so that "the tool is missing" and
  // "the tool ran and the sandbox did not hold" stay distinguishable.
  report.chrootPermitted = (
    await run("chroot", ["/", "/bin/true"], { timeoutMs: 10_000 })
  ).ok;
  report.uidDropPermitted = (
    await run(
      "setpriv",
      ["--reuid", "65534", "--regid", "65534", "--clear-groups", "/bin/true"],
      { timeoutMs: 10_000 },
    )
  ).ok;

  console.log("=== runtime ===");
  console.log(JSON.stringify(report, null, 2));

  await mkdir(WORKSPACE_ROOT, { recursive: true });
  // The sentinel deliberately lives OUTSIDE every path any candidate is given.
  // `/var/tmp` rather than `/tmp` specifically: the Landlock candidate has to
  // grant `/tmp` because the runtime writes there, so a sentinel in `/tmp`
  // would be legitimately readable and the test would quietly stop meaning
  // anything. `/var/tmp` exists on every image here, is writable, and is named
  // by no candidate.
  const root = await mkdtemp(path.join(SENTINEL_ROOT, "df-sandbox-probe-"));
  // Disposable, non-secret. If a sandbox can read this, it could read anything
  // else the host process can — that is the whole point of the marker.
  const sentinel = path.join(root, "sentinel.txt");
  const marker = `DASHFRAME-SENTINEL-${randomBytes(8).toString("hex")}`;
  await writeFile(sentinel, marker, { mode: 0o600 });
  // Planted in the PROBE's own environment, standing in for the credentials the
  // real host process carries. Candidates that inherit the environment show it
  // straight back; that is the measurement, not an accident of the harness.
  process.env.DF_HOST_SECRET_SENTINEL = `DASHFRAME-ENV-SENTINEL-${randomBytes(8).toString("hex")}`;

  console.log("\n=== candidates ===");
  const results: Array<Record<string, unknown>> = [];
  for (const candidate of candidates()) {
    if (!candidate.available) {
      console.log(`\n- ${candidate.name}: UNAVAILABLE (tool not present)`);
      results.push({ name: candidate.name, available: false });
      continue;
    }
    const workdir = await mkdtemp(path.join(WORKSPACE_ROOT, "ws-"));
    const { command, args } = candidate.wrap(workdir, sentinel);
    const result = await run(command, args, {
      timeoutMs: 120_000,
      env: candidate.env?.(workdir),
      cwd: candidate.cwd?.(workdir),
    });
    const verdict = parseVerdict(result);
    const entered = result.ok || verdict.duckdbWorks !== undefined;
    console.log(`\n- ${candidate.name}`);
    console.log(`  ${candidate.note}`);
    console.log(`  entered:            ${entered}`);
    console.log(`  duckdb works:       ${verdict.duckdbWorks ?? "n/a"}`);
    console.log(
      `  join/aggregate:     ${JSON.stringify(verdict.joinRows ?? null)}`,
    );
    console.log(`  restrictions held:  ${verdict.restrictionsHeld ?? "n/a"}`);
    console.log(`  sentinel via fs:    ${verdict.sentinelReadable ?? "n/a"}`);
    console.log(
      `  sentinel via duckdb:${verdict.sentinelReadableViaDuckdb ?? "n/a"}`,
    );
    console.log(`  network reachable:  ${verdict.networkReachable ?? "n/a"}`);
    console.log(`  host env leaked:    ${verdict.envSentinelVisible ?? "n/a"}`);
    console.log(
      `  inherited fds:      ${JSON.stringify(verdict.inheritedFds ?? null)}`,
    );
    console.log(`  uid inside:         ${verdict.uid ?? "n/a"}`);
    if (verdict.error) console.log(`  error:              ${verdict.error}`);
    if (!entered && result.stderr.trim())
      console.log(
        `  stderr:             ${result.stderr.trim().slice(0, 400)}`,
      );
    results.push({ name: candidate.name, entered, ...verdict });
  }

  await rm(root, { recursive: true, force: true });
  await rm(WORKSPACE_ROOT, { recursive: true, force: true });

  console.log("\n=== verdict ===");
  // A mechanism counts as usable only if it does the whole job: the workload
  // runs, the filesystem sentinel is out of reach, AND the parent's environment
  // did not cross. The last one is not optional — the host process carries the
  // deployment's credentials in `environ`, so a sandbox that inherits it has
  // handed over the keys regardless of what its mount namespace looks like.
  const usable = results.filter(
    (r) =>
      r.name !== "none (baseline)" &&
      r.entered === true &&
      r.duckdbWorks === true &&
      r.sentinelReadable === false &&
      r.envSentinelVisible === false,
  );
  if (usable.length === 0) {
    console.log(
      "NO USABLE SANDBOX on this platform. Per-workspace query isolation cannot be delivered here as designed; report this as a deployment constraint rather than downgrading to in-process separation.",
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `USABLE: ${usable.map((r) => r.name).join(", ")} — each entered, ran a real join/aggregate, could not read the filesystem sentinel, and did not inherit the environment sentinel.`,
  );
}

await main();
