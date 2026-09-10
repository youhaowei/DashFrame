import type { DataFrameStorage } from "@dashframe/engine";

export interface TransferLimits {
  batchBytes: number;
  runBytes: number;
  storageBytes: number;
  timeoutMs: number;
}

export const DEFAULT_TRANSFER_LIMITS: TransferLimits = {
  batchBytes: 16 * 1024 * 1024,
  runBytes: 256 * 1024 * 1024,
  storageBytes: 2 * 1024 * 1024 * 1024,
  timeoutMs: 120_000,
};

/** One run's source + result IPC budget. Native DuckDB memory is separate. */
export class TransferBudget {
  readonly controller = new AbortController();
  readonly signal: AbortSignal;
  readonly started = Date.now();
  bytes = 0;
  batches = 0;
  rows = 0;
  private storedBytes?: number;
  private readonly timer: ReturnType<typeof setTimeout>;

  constructor(
    readonly limits = DEFAULT_TRANSFER_LIMITS,
    parentSignal?: AbortSignal,
  ) {
    this.signal = parentSignal
      ? AbortSignal.any([this.controller.signal, parentSignal])
      : this.controller.signal;
    this.timer = setTimeout(
      () => this.controller.abort(new Error("FETCH_DEADLINE_EXCEEDED")),
      limits.timeoutMs,
    );
    this.timer.unref?.();
  }

  async admit(storage: DataFrameStorage): Promise<void> {
    if (this.storedBytes !== undefined) return;
    const usage = await storage.getUsage();
    if (usage.totalBytes === undefined) throw new Error("TARGET_NOT_READY");
    this.storedBytes = usage.totalBytes;
    this.check();
  }

  check(): void {
    this.signal.throwIfAborted();
    if ((this.storedBytes ?? 0) + this.bytes > this.limits.storageBytes)
      throw new Error("FETCH_STORAGE_BUDGET_EXCEEDED");
  }

  consume(bytes: Uint8Array, rows: number): void {
    this.check();
    if (bytes.byteLength > this.limits.batchBytes)
      throw new Error("FETCH_BATCH_BYTES_EXCEEDED");
    this.consumeBuffered(bytes, rows);
  }

  /** Whole compatibility sources use run/storage limits, not a page limit. */
  consumeBuffered(bytes: Uint8Array, rows: number): void {
    this.check();
    if (this.bytes + bytes.byteLength > this.limits.runBytes)
      throw new Error("FETCH_BYTE_BUDGET_EXCEEDED");
    this.bytes += bytes.byteLength;
    this.batches++;
    this.rows += rows;
    this.check();
  }

  close(): void {
    clearTimeout(this.timer);
  }
}

/** One active run and four waiting definitions per native runtime. */
const waitingTransfers = new WeakMap<object, Array<() => void>>();
export const MAX_WAITING_TRANSFERS = 4;

export function acquireNativeTransfer(
  identity: object,
  signal: AbortSignal,
): Promise<() => void> {
  signal.throwIfAborted();
  const existing = waitingTransfers.get(identity);
  if (existing && existing.length >= MAX_WAITING_TRANSFERS)
    return Promise.reject(new Error("FETCH_BUSY"));
  const queue = existing ?? [];
  if (!existing) waitingTransfers.set(identity, queue);
  return new Promise((resolve, reject) => {
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const next = queue.shift();
      if (next) next();
      else waitingTransfers.delete(identity);
    };
    const grant = () => {
      signal.removeEventListener("abort", cancel);
      resolve(release);
    };
    const cancel = () => {
      const index = queue.indexOf(grant);
      if (index >= 0) queue.splice(index, 1);
      reject(signal.reason);
    };
    if (!existing) grant();
    else {
      queue.push(grant);
      signal.addEventListener("abort", cancel, { once: true });
    }
  });
}
