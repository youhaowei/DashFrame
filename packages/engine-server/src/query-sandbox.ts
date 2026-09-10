import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import type { QueryEngine } from "@dashframe/engine";
import { Table, tableFromIPC, tableToIPC } from "apache-arrow";
import { compareSchemas } from "apache-arrow/visitor/typecomparator";
import { tableKey } from "./table-identity";
import {
  SANDBOX_MAX_ARROW,
  SANDBOX_MAX_ROWS,
  SANDBOX_PROTOCOL,
  SandboxFrameDecoder,
  encodeFrame,
  encodeParams,
  object,
  tableName,
  type SandboxFrame,
} from "./sandbox-protocol";

/** Trusted deployment settings, never values supplied by a browser/SQL worker. */
export interface QuerySandboxConfiguration {
  launcher: string;
  runtime: string;
  worker: string;
  readPaths: readonly string[];
  uid: number;
  gid: number;
  /** Hard virtual-address-space ceiling, not an RSS measurement. */
  addressSpaceBytes: number;
  /** Cumulative child CPU time; exhausting it retires this engine. */
  cpuSeconds: number;
  /** RLIMIT_NPROC is shared across a UID, not a workspace cgroup. */
  uidTaskLimit: number;
  operationTimeoutMs?: number;
  startupTimeoutMs?: number;
  idleTimeoutMs?: number;
}

interface Operation {
  kind: "query" | "register" | "unregister";
  frame: Buffer;
  id: number;
  resolve: (bytes: Uint8Array) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  detachAbort: () => void;
}

/** Hosted app servers run under Bun, while the isolated worker requires Node. */
export function querySandboxNodeRuntime(
  execPath = process.execPath,
  runningUnderBun = typeof process.versions.bun === "string",
): string {
  return runningUnderBun ? "/usr/local/bin/node" : execPath;
}

const MAX_QUEUED = 8;
const MAX_PENDING_BYTES = 64 * 1024 * 1024;
const MAX_DIAGNOSTICS = 64 * 1024;

/** Measured glibc Linux layout. Additional image requirements must be explicit. */
export async function linuxQuerySandboxReadPaths(
  runtime: string,
  workerDirectory: string,
): Promise<string[]> {
  if (process.platform !== "linux" || !["x64", "arm64"].includes(process.arch))
    throw new Error("SANDBOX_UNSUPPORTED_PLATFORM");
  const libraries =
    process.arch === "x64"
      ? "/usr/lib/x86_64-linux-gnu"
      : "/usr/lib/aarch64-linux-gnu";
  const required = await Promise.all(
    [runtime, workerDirectory, libraries, "/dev/null"].map((path) =>
      realpath(path),
    ),
  );
  const unified = (await readFile("/proc/self/cgroup", "utf8"))
    .split("\n")
    .map((line) => line.split(":"))
    .find(
      ([hierarchy, controllers]) => hierarchy === "0" && controllers === "",
    );
  const cgroup = unified?.slice(2).join(":");
  if (!cgroup?.startsWith("/"))
    throw new Error("SANDBOX_UNSUPPORTED_CGROUP_LAYOUT");
  const mount = "/sys/fs/cgroup";
  let directory = resolve(mount, `.${cgroup}`);
  if (directory !== mount && !directory.startsWith(`${mount}/`))
    throw new Error("SANDBOX_UNSUPPORTED_CGROUP_LAYOUT");
  const limits: string[] = [];
  while (true) {
    const path = resolve(directory, "memory.max");
    try {
      await access(path);
      limits.push(await realpath(path));
    } catch {
      /* Some ancestors lack the controller. */
    }
    if (directory === mount) break;
    directory = dirname(directory);
  }
  if (!limits.length) throw new Error("SANDBOX_UNSUPPORTED_CGROUP_LAYOUT");
  return [...new Set([...required, ...limits])];
}

/**
 * One immutable workspace binding, process, and disposable catalog — the
 * `QueryEngine` backing for the hosted surface, where DuckDB runs behind a
 * seccomp-confined worker process instead of in the app server.
 */
export class WorkspaceQueryEngine implements QueryEngine {
  private child: ChildProcessWithoutNullStreams | undefined;
  private opening: Promise<void> | undefined;
  private closed: Error | undefined;
  private ready = false;
  private reaped = true;
  private nextId = 1;
  private queue: Operation[] = [];
  private active: Operation | undefined;
  private pendingBytes = 0;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private closedPromise: Promise<void> = Promise.resolve();
  /**
   * Tables this engine has registered, mirrored here so `hasTable` and
   * `getTableNames` answer synchronously as the interface requires. The worker
   * owns the catalog; this is a projection of the registrations it has
   * acknowledged, and it is only written after an acknowledgement.
   *
   * Keyed by `tableKey()` and valued by the registered spelling, for the same
   * reason as the native engine: the worker's DuckDB identifies `"Sales"` and
   * `"sales"` as one table, so a raw-keyed set would claim two.
   */
  private readonly registered = new Map<string, string>();
  private startupReject: ((error: Error) => void) | undefined;
  private startupTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly options: QuerySandboxConfiguration;

  constructor(
    readonly workspaceId: string,
    options: QuerySandboxConfiguration,
  ) {
    if (!workspaceId || workspaceId.length > 256)
      throw new Error("SANDBOX_INVALID_WORKSPACE");
    for (const path of [
      options.launcher,
      options.runtime,
      options.worker,
      ...options.readPaths,
    ])
      if (!isAbsolute(path) || path.includes("\0"))
        throw new Error("SANDBOX_INVALID_PATH");
    for (const value of [
      options.uid,
      options.gid,
      options.addressSpaceBytes,
      options.cpuSeconds,
      options.uidTaskLimit,
    ])
      if (!Number.isSafeInteger(value) || value < 1)
        throw new Error("SANDBOX_INVALID_LIMIT");
    for (const value of [
      options.operationTimeoutMs,
      options.startupTimeoutMs,
      options.idleTimeoutMs,
    ])
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 1))
        throw new Error("SANDBOX_INVALID_LIMIT");
    this.options = { ...options, readPaths: [...options.readPaths] };
  }

  isReady(): boolean {
    return this.ready && !this.closed;
  }
  isClosed(): boolean {
    return this.closed !== undefined;
  }
  isReaped(): boolean {
    return this.reaped;
  }

  initialize(): Promise<void> {
    if (this.closed) return Promise.reject(this.closed);
    this.opening ??= this.start();
    return this.opening;
  }

  private async start(): Promise<void> {
    try {
      if (process.platform !== "linux")
        throw new Error("SANDBOX_UNSUPPORTED_PLATFORM");
      const options = this.options;
      const [launcher, runtime, worker, ...readPaths] = await Promise.all(
        [
          options.launcher,
          options.runtime,
          options.worker,
          ...options.readPaths,
        ].map((path) => realpath(path)),
      );
      if (this.closed) throw this.closed;
      const args = [
        "--uid",
        String(options.uid),
        "--parent-pid",
        String(process.pid),
        "--gid",
        String(options.gid),
        "--memory-bytes",
        String(options.addressSpaceBytes),
        "--cpu-seconds",
        String(options.cpuSeconds),
        "--threads",
        String(options.uidTaskLimit),
        ...readPaths.flatMap((path) => ["--read", path]),
        "--",
        runtime!,
        "--jitless",
        "--disable-wasm-trap-handler",
        "--openssl-config=/dev/null",
        "--max-old-space-size=128",
        "--max-semi-space-size=8",
        worker!,
      ];
      this.child = spawn(launcher!, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: {},
        cwd: dirname(worker!),
        shell: false,
        windowsHide: true,
      });
      const child = this.child;
      this.reaped = false;
      this.closedPromise = new Promise((resolve) => {
        child.once("close", () => {
          this.reaped = true;
          resolve();
        });
      });
      const startup = new Promise<void>((resolve, reject) => {
        this.startupReject = reject;
        this.startupTimer = setTimeout(
          () => this.fail(new Error("SANDBOX_STARTUP_TIMEOUT")),
          options.startupTimeoutMs ?? 60_000,
        );
        const decoder = new SandboxFrameDecoder((frame) => {
          if (!this.ready) {
            const metadata = object(frame.metadata);
            if (
              metadata.version !== SANDBOX_PROTOCOL ||
              metadata.id !== 0 ||
              metadata.status !== "ready" ||
              frame.payload.length
            )
              throw new Error("SANDBOX_PROTOCOL_ERROR");
            this.ready = true;
            clearTimeout(this.startupTimer);
            this.startupReject = undefined;
            resolve();
            this.armIdle();
          } else this.receive(frame);
        });
        child.stdout.on("data", (chunk: Buffer) => {
          if (this.closed) return;
          try {
            decoder.push(chunk);
          } catch {
            this.fail(new Error("SANDBOX_PROTOCOL_ERROR"));
          }
        });
      });
      let diagnosticBytes = 0;
      child.stderr.on("data", (chunk: Buffer) => {
        diagnosticBytes += chunk.length;
        // Drain, but never relay native errors or untrusted log contents.
        if (diagnosticBytes > MAX_DIAGNOSTICS)
          this.fail(new Error("SANDBOX_DIAGNOSTIC_LIMIT"));
      });
      child.once("error", () => this.fail(new Error("SANDBOX_START_FAILED")));
      child.once("exit", () => this.fail(new Error("SANDBOX_WORKER_EXITED")));
      child.stdout.once("end", () =>
        this.fail(new Error("SANDBOX_TRANSPORT_CLOSED")),
      );
      child.stdin.on("error", () =>
        this.fail(new Error("SANDBOX_TRANSPORT_CLOSED")),
      );
      child.stdout.on("error", () =>
        this.fail(new Error("SANDBOX_TRANSPORT_CLOSED")),
      );
      child.stderr.on("error", () =>
        this.fail(new Error("SANDBOX_TRANSPORT_CLOSED")),
      );
      await startup;
    } catch (error) {
      this.fail(
        error instanceof Error && error.message.startsWith("SANDBOX_")
          ? error
          : new Error("SANDBOX_START_FAILED"),
      );
      throw this.closed;
    }
  }

  queryArrow(
    sql: string,
    params: readonly unknown[] = [],
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    if (typeof sql !== "string" || !sql.trim())
      return Promise.reject(new Error("SANDBOX_INVALID_SQL"));
    if (Buffer.byteLength(sql) > 32 * 1024)
      return Promise.reject(new Error("SANDBOX_MESSAGE_LIMIT"));
    try {
      return this.request(
        { operation: "query", sql, params: encodeParams(params) },
        undefined,
        signal,
      );
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * The worker answers a query with one framed Arrow payload, bounded by
   * `SANDBOX_MAX_ROWS`, so a batch sequence here is that single buffer — the
   * whole result is resident before the first yield. It exists because the
   * interface is one shape across backings; a caller that must bound memory
   * gets that from the native backing, not from a request/response worker
   * protocol pretending to stream.
   */
  async *queryArrowBatches(
    sql: string,
    params: readonly unknown[] = [],
    signal?: AbortSignal,
  ): AsyncGenerator<Uint8Array> {
    yield await this.queryArrow(sql, params, signal);
  }

  async registerArrowTable(
    name: string,
    bytes: Uint8Array,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!bytes.byteLength || bytes.byteLength > SANDBOX_MAX_ARROW)
      throw new Error("SANDBOX_MESSAGE_LIMIT");
    await this.request(
      { operation: "register", name: tableName(name) },
      bytes,
      signal,
    );
    this.registered.set(tableKey(name), name);
  }

  /**
   * Same contract as `registerArrowTable`, fed by chunks.
   *
   * The worker protocol is one framed request carrying one payload, so the
   * chunks are joined here and registered as a single buffer. That is the whole
   * of the "streaming" this backing can offer — but the size ceiling still has
   * to hold, so it is enforced on the running total as chunks arrive rather
   * than after the join: a source larger than the limit is rejected without
   * ever being resident whole.
   *
   * `signal` is checked between chunks, which is the only cancellation this
   * method can offer — the hosted binding drops caller signals anyway
   * (`createHostedQueryRuntime`), so in practice a long source read here runs
   * to completion.
   */
  async registerArrowStream(
    name: string,
    chunks: AsyncIterable<Uint8Array>,
    signal?: AbortSignal,
  ): Promise<void> {
    const parts: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of chunks) {
      if (signal?.aborted) throw new Error("SANDBOX_CANCELLED");
      total += chunk.byteLength;
      if (total > SANDBOX_MAX_ARROW) throw new Error("SANDBOX_MESSAGE_LIMIT");
      parts.push(chunk);
    }
    const joined = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      joined.set(part, offset);
      offset += part.byteLength;
    }
    await this.registerArrowTable(name, joined, signal);
  }

  async unregisterTable(name: string): Promise<void> {
    await this.request({ operation: "unregister", name: tableName(name) });
    this.registered.delete(tableKey(name));
  }

  /** Buffered compatibility adapter; never advertises native transfer semantics. */
  async registerArrowBatches(
    name: string,
    batches: AsyncIterable<Uint8Array>,
    signal?: AbortSignal,
  ): Promise<void> {
    const tables: Table[] = [];
    let total = 0;
    for await (const bytes of batches) {
      if (signal?.aborted) throw new Error("SANDBOX_CANCELLED");
      total += bytes.byteLength;
      if (total > SANDBOX_MAX_ARROW) throw new Error("SANDBOX_MESSAGE_LIMIT");
      const table = tableFromIPC(bytes);
      if (tables[0] && !compareSchemas(tables[0].schema, table.schema))
        throw new Error("Arrow schema changed while registering table");
      tables.push(table);
    }
    if (!tables.length) throw new Error("Arrow batch stream is empty");
    const table = new Table(
      tables[0]!.schema,
      tables.flatMap((part) => part.batches),
    );
    await this.registerArrowTable(name, tableToIPC(table, "stream"), signal);
  }

  hasTable(name: string): boolean {
    return this.registered.has(tableKey(name));
  }

  getTableNames(): string[] {
    return [...this.registered.values()];
  }

  private request(
    metadata: Record<string, unknown> & { operation: Operation["kind"] },
    payload?: Uint8Array,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    if (this.closed) return Promise.reject(this.closed);
    if (signal?.aborted) return Promise.reject(new Error("SANDBOX_CANCELLED"));
    if (this.queue.length + (this.active ? 1 : 0) >= MAX_QUEUED)
      return Promise.reject(new Error("SANDBOX_QUEUE_FULL"));
    const id = this.nextId++;
    if (!Number.isSafeInteger(id))
      return Promise.reject(new Error("SANDBOX_REQUEST_LIMIT"));
    const frame = encodeFrame(
      { ...metadata, version: SANDBOX_PROTOCOL, id },
      payload,
    );
    if (this.pendingBytes + frame.length > MAX_PENDING_BYTES)
      return Promise.reject(new Error("SANDBOX_QUEUE_FULL"));
    clearTimeout(this.idleTimer);
    this.pendingBytes += frame.length;
    const result = new Promise<Uint8Array>((resolve, reject) => {
      const abort = () => this.fail(new Error("SANDBOX_CANCELLED"));
      const timer = setTimeout(
        () => this.fail(new Error("SANDBOX_OPERATION_TIMEOUT")),
        this.options.operationTimeoutMs ?? 30_000,
      );
      signal?.addEventListener("abort", abort, { once: true });
      this.queue.push({
        kind: metadata.operation,
        id,
        frame,
        resolve,
        reject,
        timer,
        detachAbort: () => signal?.removeEventListener("abort", abort),
      });
    });
    this.initialize().then(
      () => this.dispatch(),
      () => {
        /* fail() rejects queue */
      },
    );
    return result;
  }

  private dispatch(): void {
    if (this.closed || !this.ready || this.active || !this.child) return;
    this.active = this.queue.shift();
    if (!this.active) {
      this.armIdle();
      return;
    }
    this.child.stdin.write(this.active.frame, (error) => {
      if (error) this.fail(new Error("SANDBOX_TRANSPORT_CLOSED"));
    });
  }

  private receive(frame: SandboxFrame): void {
    const metadata = object(frame.metadata);
    const active = this.active;
    if (
      !active ||
      metadata.version !== SANDBOX_PROTOCOL ||
      metadata.id !== active.id ||
      (metadata.status !== "ok" && metadata.status !== "error") ||
      (metadata.status === "error" && frame.payload.length)
    )
      throw new Error("SANDBOX_PROTOCOL_ERROR");
    if (metadata.status === "ok")
      this.validateSuccess(active.kind, frame.payload);
    this.active = undefined;
    this.pendingBytes -= active.frame.length;
    clearTimeout(active.timer);
    active.detachAbort();
    if (metadata.status === "ok") active.resolve(frame.payload);
    else
      active.reject(new Error(`SANDBOX_${active.kind.toUpperCase()}_FAILED`));
    this.dispatch();
  }

  private validateSuccess(kind: Operation["kind"], payload: Uint8Array): void {
    if (kind !== "query") {
      if (payload.length) throw new Error("SANDBOX_PROTOCOL_ERROR");
      return;
    }
    if (
      payload.length < 16 ||
      !payload.subarray(0, 4).every((byte) => byte === 255)
    )
      throw new Error("SANDBOX_PROTOCOL_ERROR");
    const result = tableFromIPC(payload);
    if (result.numRows > SANDBOX_MAX_ROWS || result.numCols > 1024)
      throw new Error("SANDBOX_PROTOCOL_ERROR");
  }

  private armIdle(): void {
    clearTimeout(this.idleTimer);
    if (!this.closed && !this.active && !this.queue.length)
      this.idleTimer = setTimeout(
        () => this.fail(new Error("SANDBOX_IDLE")),
        this.options.idleTimeoutMs ?? 60_000,
      );
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = error;
    this.ready = false;
    // Every way this engine ends comes through here — dispose(), idle expiry,
    // an operation timeout, a protocol violation, the worker exiting. The
    // worker's catalog dies with it, so the projection of that catalog must
    // not outlive it and claim tables nothing holds.
    this.registered.clear();
    clearTimeout(this.idleTimer);
    clearTimeout(this.startupTimer);
    this.startupReject?.(error);
    this.startupReject = undefined;
    for (const pending of [
      ...(this.active ? [this.active] : []),
      ...this.queue,
    ]) {
      clearTimeout(pending.timer);
      pending.detachAbort();
      pending.reject(error);
    }
    this.active = undefined;
    this.queue = [];
    this.pendingBytes = 0;
    // The syscall policy forbids child processes. SIGKILL reaps all its threads.
    this.child?.kill("SIGKILL");
    this.child?.stdin.destroy();
  }

  async dispose(): Promise<void> {
    this.fail(new Error("SANDBOX_CLOSED"));
    await this.closedPromise;
  }
}

/** Caller supplies an already-authorized workspace; this is not authentication. */
export class WorkspaceQueryEngines {
  private readonly engines = new Map<string, WorkspaceQueryEngine>();
  private closed = false;
  constructor(
    private readonly configuration: QuerySandboxConfiguration,
    private readonly maxWorkers: number,
  ) {
    if (!Number.isSafeInteger(maxWorkers) || maxWorkers < 1)
      throw new Error("SANDBOX_INVALID_LIMIT");
  }

  forWorkspace(workspaceId: string): WorkspaceQueryEngine {
    if (this.closed) throw new Error("SANDBOX_CLOSED");
    for (const [id, engine] of this.engines)
      if (engine.isClosed() && engine.isReaped()) this.engines.delete(id);
    const current = this.engines.get(workspaceId);
    if (current) return current;
    if (this.engines.size >= this.maxWorkers)
      throw new Error("SANDBOX_CAPACITY");
    const engine = new WorkspaceQueryEngine(workspaceId, this.configuration);
    this.engines.set(workspaceId, engine);
    return engine;
  }

  async dispose(): Promise<void> {
    this.closed = true;
    await Promise.all(
      [...this.engines.values()].map((engine) => engine.dispose()),
    );
    this.engines.clear();
  }
}
