import { spawn, execFile, execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import {
  chmod,
  link,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { getFunctionName, makeFunctionReference } from "convex/server";
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from "convex/server";
import { convexToJson, jsonToConvex } from "convex/values";
import type { Value } from "convex/values";
import {
  BACKEND_VERSION,
  CONVEX_VERSION,
  verifyBackendBinary,
} from "./binary.js";

import {
  DeploymentFailure,
  isTransientDeploymentDiagnostic,
  retryDeployment,
} from "./deployment-retry.js";

export interface LocalConvexOptions {
  projectDir: string;
  /** Package root containing convex.json, convex/, and generated bindings. */
  functionsDirectory: string;
  auth: { issuer: string; jwksDataUri: string; audience: "dashframe" };
  binaryPath?: string;
  onUnexpectedExit?: () => void;
}

type InternalQuery = FunctionReference<"query", "internal">;
type InternalMutation = FunctionReference<"mutation", "internal">;
export interface InternalClient {
  query<Q extends InternalQuery>(
    query: Q,
    args: FunctionArgs<Q>,
  ): Promise<FunctionReturnType<Q>>;
  mutation<M extends InternalMutation>(
    mutation: M,
    args: FunctionArgs<M>,
  ): Promise<FunctionReturnType<M>>;
}

export interface LocalConvex {
  url: string;
  /** Host-only capability. Deliberately cannot call public application functions. */
  internalClient: InternalClient;
  closed: Promise<void>;
  stop(): Promise<void>;
}

interface Config {
  backendVersion: string;
  deploymentName: string;
  instanceSecret: string;
  adminKey: string;
}

function isConfig(value: unknown): value is Config {
  if (!value || typeof value !== "object") return false;
  const config = value as Partial<Config>;
  return (
    config.backendVersion === BACKEND_VERSION &&
    typeof config.deploymentName === "string" &&
    /^dashframe_[a-f0-9]{32}$/.test(config.deploymentName) &&
    typeof config.instanceSecret === "string" &&
    /^[a-f0-9]{64}$/.test(config.instanceSecret) &&
    typeof config.adminKey === "string" &&
    /^dashframe_[a-f0-9]{32}\|[a-f0-9]+$/.test(config.adminKey) &&
    config.adminKey.startsWith(`${config.deploymentName}|`)
  );
}

async function loadOrCreateConfig(
  state: string,
  binary: string,
): Promise<Config> {
  const file = path.join(state, "config.json");
  try {
    const source = await readFile(file, "utf8");
    let value: unknown;
    try {
      value = JSON.parse(source);
    } catch {
      throw new Error(
        "Local Convex config is malformed; existing state was preserved.",
      );
    }
    if (!isConfig(value))
      throw new Error(
        "Local Convex config is invalid or uses another backend version. Explicit upgrade required; existing state was preserved.",
      );
    await chmod(file, 0o600);
    return value;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  const files = await readdir(state);
  if (
    files.some(
      (name) => name.startsWith("backend.sqlite3") || name === "storage",
    )
  ) {
    throw new Error(
      "Local Convex identity config is missing but backend state exists. Restore its original config; existing data was preserved.",
    );
  }
  const deploymentName = `dashframe_${randomUUID().replaceAll("-", "")}`;
  const instanceSecret = randomBytes(32).toString("hex");
  let adminKey: string;
  try {
    const result = await promisify(execFile)(
      binary,
      [
        "keygen",
        "admin-key",
        "--instance-name",
        deploymentName,
        "--instance-secret",
        instanceSecret,
      ],
      {
        timeout: 10_000,
        maxBuffer: 16_384,
      },
    );
    adminKey = result.stdout.trim();
  } catch {
    // execFile's error includes argv, which contains the instance secret.
    throw new Error("Local Convex key provisioning failed.");
  }
  const config = {
    backendVersion: BACKEND_VERSION,
    deploymentName,
    instanceSecret,
    adminKey,
  };
  if (!isConfig(config))
    throw new Error("Local Convex key generator returned an invalid key.");
  const temporary = `${file}.${randomUUID()}`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(config));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, file);
  return config;
}

async function reservePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Could not reserve a loopback port.");
  return {
    port: address.port,
    release: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

function ownedProcess(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    captureOutput?: boolean;
  } = {},
) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    detached: true,
    windowsHide: true,
    stdio: options.captureOutput ? ["ignore", "pipe", "pipe"] : "ignore",
  });
  let output = "";
  const recordOutput = (chunk: Buffer) => {
    output = (output + chunk.toString("utf8")).slice(-8192);
  };
  child.stdout?.on("data", recordOutput);
  child.stderr?.on("data", recordOutput);
  let exited = false;
  let successful = false;
  const closed = new Promise<void>((resolve) => {
    child.once("error", () => {
      exited = true;
      resolve();
    });
    child.once("exit", (code) => {
      successful = code === 0;
      exited = true;
      resolve();
    });
  });
  function signal(signal: NodeJS.Signals) {
    if (!child.pid) return;
    try {
      if (process.platform === "win32") {
        // Node cannot signal a Windows process group. Terminate only the tree
        // rooted at this owned PID; taskkill /T includes the CLI's esbuild child.
        execFileSync(
          path.win32.join(
            process.env.SystemRoot ?? "C:\\Windows",
            "System32",
            "taskkill.exe",
          ),
          ["/PID", String(child.pid), "/T", "/F"],
          {
            stdio: "ignore",
            windowsHide: true,
            timeout: 10_000,
          },
        );
      } else process.kill(-child.pid, signal);
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ESRCH")
      )
        throw error;
    }
  }
  const onHostExit = () => {
    if (!exited) {
      try {
        signal("SIGKILL");
      } catch {
        /* A terminating host cannot recover; preserve the ownership lock. */
      }
    }
  };
  process.once("exit", onHostExit);
  closed.then(() => process.removeListener("exit", onHostExit));
  let stopping: Promise<void> | undefined;
  return {
    pid: child.pid,
    closed,
    get output() {
      return output;
    },
    get exited() {
      return exited;
    },
    get successful() {
      return successful;
    },
    stop() {
      if (stopping) return stopping;
      stopping = (async () => {
        if (exited) return;
        signal("SIGTERM");
        const timer = setTimeout(() => {
          if (!exited) signal("SIGKILL");
        }, 5_000);
        try {
          await closed;
        } finally {
          clearTimeout(timer);
        }
      })();
      return stopping;
    },
  };
}

function internalClient(url: string, adminKey: string): InternalClient {
  async function call(
    type: "query" | "mutation",
    reference: InternalQuery | InternalMutation,
    args: Value,
  ) {
    const response = await fetch(`${url}/api/${type}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Convex ${adminKey}`,
      },
      body: JSON.stringify({
        path: getFunctionName(reference),
        args: [convexToJson(args)],
        format: "convex_encoded_json",
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const result = (await response.json()) as {
      status?: string;
      value?: Parameters<typeof jsonToConvex>[0];
    };
    if (
      !response.ok ||
      result.status !== "success" ||
      result.value === undefined
    ) {
      throw new Error(
        `Local Convex internal ${type} failed (${response.status}).`,
      );
    }
    return jsonToConvex(result.value);
  }
  return {
    query: async <Q extends InternalQuery>(
      reference: Q,
      args: FunctionArgs<Q>,
    ) => (await call("query", reference, args)) as FunctionReturnType<Q>,
    mutation: async <M extends InternalMutation>(
      reference: M,
      args: FunctionArgs<M>,
    ) => (await call("mutation", reference, args)) as FunctionReturnType<M>,
  };
}

async function deployFunctions(
  options: LocalConvexOptions,
  state: string,
  url: string,
  config: Config,
) {
  await retryDeployment(async () => {
    const response = await fetch(`${url}/api/update_environment_variables`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Convex ${config.adminKey}`,
      },
      body: JSON.stringify({
        changes: [
          { name: "DASHFRAME_AUTH_ISSUER", value: options.auth.issuer },
          { name: "DASHFRAME_AUTH_JWKS", value: options.auth.jwksDataUri },
        ],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    await response.body?.cancel();
    if (!response.ok)
      throw new DeploymentFailure(
        "Could not configure local Convex authentication.",
        response.status === 429,
      );
  });

  const require = createRequire(import.meta.url);
  const convexPackagePath = require.resolve("convex/package.json");
  const convexPackage = JSON.parse(
    await readFile(convexPackagePath, "utf8"),
  ) as { version?: string };
  if (convexPackage.version !== CONVEX_VERSION)
    throw new Error("Convex CLI does not match the pinned package version.");
  // An explicit env file prevents project/user .env files from selecting cloud.
  // No credentials are passed on the CLI command line or inherited by renderer.
  const envFile = path.join(state, "deploy.env");
  await writeFile(
    envFile,
    `CONVEX_SELF_HOSTED_URL=${url}\nCONVEX_SELF_HOSTED_ADMIN_KEY=${config.adminKey}\n`,
    { mode: 0o600 },
  );
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    CONVEX_AGENT_MODE: "anonymous",
    CONVEX_DISABLE_TELEMETRY: "1",
    SENTRY_DSN: "",
  };
  for (const key of [
    "CONVEX_DEPLOYMENT",
    "CONVEX_DEPLOY_KEY",
    "CONVEX_SELF_HOSTED_URL",
    "CONVEX_SELF_HOSTED_ADMIN_KEY",
  ])
    delete env[key];
  try {
    await retryDeployment(async () => {
      const deployment = ownedProcess(
        process.execPath,
        [
          path.join(path.dirname(convexPackagePath), "bin/main.js"),
          "deploy",
          "--env-file",
          envFile,
          "--typecheck",
          "disable",
          "--codegen",
          "disable",
        ],
        { cwd: options.functionsDirectory, env, captureOutput: true },
      );
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          deployment.closed,
          new Promise<never>((_, reject) => {
            deadline = setTimeout(
              () =>
                reject(
                  new DeploymentFailure(
                    "Local Convex function deployment timed out.",
                    false,
                  ),
                ),
              120_000,
            );
          }),
        ]);
        if (!deployment.successful) {
          const diagnostic = deployment.output
            .replaceAll(config.adminKey, "[redacted]")
            .replaceAll(config.instanceSecret, "[redacted]");
          throw new DeploymentFailure(
            `Local Convex function deployment failed: ${diagnostic.trim() || "CLI exited without diagnostic output"}`,
            isTransientDeploymentDiagnostic(diagnostic),
          );
        }
      } finally {
        clearTimeout(deadline);
        // Fully stop each owned CLI before another deploy can begin.
        await deployment.stop();
      }
    });
  } finally {
    await rm(envFile, { force: true });
  }
}

async function waitUntil(
  backend: ReturnType<typeof ownedProcess>,
  check: () => Promise<boolean>,
  stage: string,
  attempts: number,
) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (backend.exited)
      throw new Error(`Local Convex exited during ${stage} readiness.`);
    try {
      if (await check()) return;
    } catch {
      /* Cold startup can briefly precede HTTP and application readiness. */
    }
    await delay(200);
  }
  throw new Error(`Local Convex ${stage} readiness timed out.`);
}

const PROJECT_OWNED_MESSAGE =
  "Local Convex project is already owned, or has an unclean-shutdown lock. Stop its owner before removing .convex/runtime.lock; existing data was preserved.";

function hasErrorCode(error: unknown, code: string) {
  return error instanceof Error && "code" in error && error.code === code;
}

function ownerIsAlive(ownerPid: number) {
  try {
    process.kill(ownerPid, 0);
    return true;
  } catch (error) {
    // EPERM still proves that a process occupies this PID. Only ESRCH proves
    // that the recorded owner is gone.
    return !hasErrorCode(error, "ESRCH");
  }
}

async function acquireRuntimeLock(lockPath: string) {
  const reclaimPath = `${lockPath}.reclaim`;
  let reclaim: Awaited<ReturnType<typeof open>>;
  try {
    reclaim = await open(reclaimPath, "wx", 0o600);
  } catch (error) {
    if (hasErrorCode(error, "EEXIST")) throw new Error(PROJECT_OWNED_MESSAGE);
    throw error;
  }
  try {
    return await acquireRuntimeLockWithGuard(lockPath);
  } finally {
    try {
      await reclaim.close();
    } finally {
      await rm(reclaimPath, { force: true });
    }
  }
}

async function acquireRuntimeLockWithGuard(lockPath: string) {
  const attemptId = randomUUID();
  const candidatePath = `${lockPath}.${attemptId}.candidate`;
  const candidate = await open(candidatePath, "wx", 0o600);
  let acquired = false;

  try {
    await candidate.writeFile(JSON.stringify({ ownerPid: process.pid }));
    await candidate.sync();
    const snapshotPath = `${lockPath}.${attemptId}.snapshot`;
    let snapshot: Awaited<ReturnType<typeof open>> | undefined;
    try {
      try {
        await link(lockPath, snapshotPath);
      } catch (error) {
        if (!hasErrorCode(error, "ENOENT")) throw error;
        await rename(candidatePath, lockPath);
        acquired = true;
        return candidate;
      }

      snapshot = await open(snapshotPath, "r");
      let ownerPid: number | undefined;
      try {
        const value = JSON.parse(await snapshot.readFile("utf8")) as {
          ownerPid?: unknown;
        };
        if (
          typeof value.ownerPid === "number" &&
          Number.isSafeInteger(value.ownerPid) &&
          value.ownerPid > 0
        ) {
          ownerPid = value.ownerPid;
        }
      } catch {
        // A missing, unreadable, or malformed lock is not provably stale.
      }
      if (ownerPid === undefined || ownerIsAlive(ownerPid))
        throw new Error(PROJECT_OWNED_MESSAGE);

      await rename(candidatePath, lockPath);
      acquired = true;
      return candidate;
    } finally {
      await snapshot?.close();
      await rm(snapshotPath, { force: true });
    }
  } finally {
    if (!acquired) {
      try {
        await candidate.close();
      } finally {
        await rm(candidatePath, { force: true });
      }
    }
  }
}

/** One owned backend per private project state directory; never attach to a port owner. */
export async function startLocalConvex(
  options: LocalConvexOptions,
): Promise<LocalConvex> {
  if (
    options.auth.audience !== "dashframe" ||
    !options.auth.issuer.startsWith("https://") ||
    !options.auth.jwksDataUri.startsWith("data:")
  ) {
    throw new Error("Invalid local Convex authentication configuration.");
  }
  const binary = await verifyBackendBinary(
    options.binaryPath ?? process.env.DASHFRAME_CONVEX_BINARY,
  );
  await mkdir(options.projectDir, { recursive: true, mode: 0o700 });
  const state = path.join(await realpath(options.projectDir), ".convex");
  await mkdir(state, { recursive: true, mode: 0o700 });
  await chmod(state, 0o700);
  const lockPath = path.join(state, "runtime.lock");
  const lock = await acquireRuntimeLock(lockPath);
  await lock.close();
  let backend: ReturnType<typeof ownedProcess> | undefined;
  let released = false;
  let stopping: Promise<void> | undefined;
  const stop = () =>
    (stopping ??= (async () => {
      await backend?.stop();
      if (!released) {
        await rm(lockPath);
        released = true;
      }
    })());
  try {
    const config = await loadOrCreateConfig(state, binary);
    const cloud = await reservePort();
    let site: Awaited<ReturnType<typeof reservePort>>;
    try {
      site = await reservePort();
    } catch (error) {
      await cloud.release();
      throw error;
    }
    const url = `http://127.0.0.1:${cloud.port}`;
    await cloud.release();
    await site.release();
    backend = ownedProcess(
      binary,
      [
        "--interface",
        "127.0.0.1",
        "--port",
        String(cloud.port),
        "--site-proxy-port",
        String(site.port),
        "--instance-name",
        config.deploymentName,
        "--instance-secret",
        config.instanceSecret,
        "--local-storage",
        path.join(state, "storage"),
        "--disable-beacon",
        "--redact-logs-to-client",
        path.join(state, "backend.sqlite3"),
      ],
      { env: { ...process.env, SENTRY_DSN: "", DISABLE_BEACON: "1" } },
    );
    await writeFile(
      lockPath,
      JSON.stringify({ ownerPid: process.pid, backendPid: backend.pid }),
      { mode: 0o600 },
    );
    await waitUntil(
      backend,
      async () => {
        const response = await fetch(`${url}/instance_name`, {
          signal: AbortSignal.timeout(500),
        });
        return response.ok && (await response.text()) === config.deploymentName;
      },
      "identity",
      150,
    );
    await delay(200);
    if (backend.exited)
      throw new Error("Local Convex could not own its loopback ports.");
    await deployFunctions(options, state, url, config);
    const client = internalClient(url, config.adminKey);
    const readiness = makeFunctionReference<
      "query",
      Record<string, never>,
      { ready: boolean }
    >("host:runtimeReady") as unknown as FunctionReference<
      "query",
      "internal",
      Record<string, never>,
      { ready: boolean }
    >;
    await waitUntil(
      backend,
      async () => (await client.query(readiness, {})).ready,
      "application",
      30,
    );
    backend.closed.then(() => {
      if (!stopping) options.onUnexpectedExit?.();
    });
    return { url, internalClient: client, closed: backend.closed, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
