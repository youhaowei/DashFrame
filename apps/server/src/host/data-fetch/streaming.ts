import { inspectArrowIpc } from "@dashframe/engine-server/arrow-data-path";
import type { HostContext } from "../context";

export const STREAM_BATCH_ROWS = 1_000;
export const STREAM_BATCH_BYTES = 8 * 1024 * 1024;
export const STREAM_TOTAL_BYTES = 256 * 1024 * 1024;
export const STREAM_STORAGE_BYTES = 2 * 1024 * 1024 * 1024;
export const STREAM_DURATION_MS = 5 * 60 * 1000;

export function supportsStreaming(ctx: HostContext): boolean {
  return Boolean(
    ctx.dataFrameStorage?.saveBatches &&
    ctx.dataFrameStorage.loadBatches &&
    ctx.dataPlaneRuntime?.registerArrowBatches &&
    ctx.dataPlaneRuntime.queryArrowBatches,
  );
}

/** Runtime identity scopes admission to one workspace's analytical catalog. */
const active = new WeakSet<object>();

/** Cancel shared acquisition only when every abortable consumer has left. */
export class CoalescedOperation<T> {
  readonly promise: Promise<T>;
  private readonly controller = new AbortController();
  private waiters = 0;
  private pinned = false;
  private settled = false;

  constructor(run: (signal: AbortSignal) => Promise<T>) {
    this.promise = run(this.controller.signal);
    const settle = () => {
      this.settled = true;
    };
    this.promise.then(settle, settle);
  }

  wait(signal?: AbortSignal): Promise<T> {
    if (!signal) {
      this.pinned = true;
      return this.promise;
    }
    if (signal.aborted) return Promise.reject(signal.reason);
    this.waiters++;
    return new Promise<T>((resolve, reject) => {
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        signal.removeEventListener("abort", abort);
        this.waiters--;
      };
      const abort = () => {
        release();
        if (!this.settled && !this.pinned && this.waiters === 0) {
          this.controller.abort(signal.reason);
        } else reject(signal.reason);
      };
      signal.addEventListener("abort", abort, { once: true });
      this.promise.then(
        (value) => {
          release();
          if (signal.aborted) reject(signal.reason);
          else resolve(value);
        },
        (error: unknown) => {
          release();
          reject(error);
        },
      );
    });
  }
}

export class StreamingBudget {
  private bytes = 0;
  private rows = 0;
  private readonly startedAt = Date.now();

  constructor(
    private readonly ctx: HostContext,
    private readonly initialStorageBytes: number,
  ) {}

  check(): void {
    this.ctx.requestSignal?.throwIfAborted();
  }

  /** Buffered adapters retain their payload contract, with aggregate accounting. */
  acceptBuffered(byteLength: number, rowCount: number): void {
    this.check();
    this.account(byteLength);
    this.rows += rowCount;
    this.report("source");
  }

  private account(byteLength: number): void {
    this.bytes += byteLength;
    if (this.bytes > STREAM_TOTAL_BYTES)
      throw new Error("SOURCE_RESULT_TOO_LARGE");
    if (this.initialStorageBytes + this.bytes > STREAM_STORAGE_BYTES)
      throw new Error("MATERIALIZATION_STORAGE_LIMIT");
  }

  report(phase: "source" | "result" | "publication"): void {
    // Observers cannot change publication or cleanup behavior.
    try {
      this.ctx.onMaterializationProgress?.({
        phase,
        rows: this.rows,
        bytes: this.bytes,
        elapsedMs: Date.now() - this.startedAt,
      });
    } catch {
      // Telemetry is best effort and contains no source values.
    }
  }

  async *batches(
    input: AsyncIterable<Uint8Array>,
    phase: "source" | "result",
    inspect?: (arrow: Uint8Array) => void,
  ): AsyncIterable<Uint8Array> {
    this.check();
    for await (const arrow of input) {
      this.check();
      if (arrow.byteLength > STREAM_BATCH_BYTES)
        throw new Error("SOURCE_RESULT_TOO_LARGE");
      // IPC schema overhead makes this accounting conservative for saved bytes.
      this.account(arrow.byteLength);
      const { rowCount } = inspectArrowIpc(arrow);
      this.rows += rowCount;
      inspect?.(arrow);
      this.report(phase);
      yield arrow;
      this.check();
    }
  }
}

export async function withStreamingBudget<T>(
  ctx: HostContext,
  run: (context: HostContext, budget?: StreamingBudget) => Promise<T>,
): Promise<T> {
  if (!supportsStreaming(ctx)) return run(ctx);
  const runtime = ctx.dataPlaneRuntime!;
  if (active.has(runtime)) throw new Error("MATERIALIZATION_BUSY");
  active.add(runtime);
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("MATERIALIZATION_TIMEOUT")),
    STREAM_DURATION_MS,
  );
  const context: HostContext = {
    ...ctx,
    requestSignal: ctx.requestSignal
      ? AbortSignal.any([ctx.requestSignal, controller.signal])
      : controller.signal,
  };
  try {
    context.requestSignal!.throwIfAborted();
    const usage = await ctx.dataFrameStorage!.getUsage();
    context.requestSignal!.throwIfAborted();
    if (
      usage.totalBytes === undefined ||
      usage.totalBytes > STREAM_STORAGE_BYTES
    )
      throw new Error("MATERIALIZATION_STORAGE_LIMIT");
    return await run(context, new StreamingBudget(context, usage.totalBytes));
  } finally {
    clearTimeout(timer);
    active.delete(runtime);
  }
}
