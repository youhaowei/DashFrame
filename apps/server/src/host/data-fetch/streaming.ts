import type { HostContext } from "../context";

export const STREAM_BATCH_ROWS = 10_000;
export const STREAM_BATCH_BYTES = 8 * 1024 * 1024;

export function supportsStreaming(ctx: HostContext): boolean {
  // Hosted workers retain their negotiated protocol and existing ceilings.
  if (ctx.workspaceOwnerId !== undefined) return false;
  return Boolean(
    ctx.dataFrameStorage?.saveBatches &&
    ctx.dataFrameStorage.stream &&
    ctx.dataPlaneRuntime?.registerArrowStream &&
    ctx.dataPlaneRuntime.queryArrowBatches,
  );
}

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

  get joinable(): boolean {
    return !this.controller.signal.aborted;
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
