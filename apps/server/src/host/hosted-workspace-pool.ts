interface OwnedWorkspace<T> {
  resources: T;
  /** Stop all workers and flush stores before releasing the volume lease.
   * Rejection must retain ownership and allow a later close attempt. */
  close(): Promise<void>;
}

interface Entry<T> {
  ownerId: string;
  opening: Promise<OwnedWorkspace<T>>;
  active: number;
  retiring: boolean;
  closing?: Promise<void>;
}

/** Bounded process-local sharing, not a cross-process volume lock.
 * The factory must acquire exclusive volume ownership before opening resources
 * and fully clean up failed startup before rejecting. Call only after admission. */
export class HostedWorkspacePool<T> {
  private entries = new Map<string, Entry<T>>();
  private active = 0;
  private draining = false;
  private drained: (() => void) | undefined;
  private closing: Promise<void> | undefined;

  constructor(
    private readonly limit: number,
    private readonly open: (
      workspaceId: string,
      ownerId: string,
    ) => Promise<OwnedWorkspace<T>>,
  ) {
    if (!Number.isSafeInteger(limit) || limit < 1)
      throw new Error("Invalid hosted workspace limit");
  }

  async run<R>(
    workspaceId: string,
    ownerId: string,
    operation: (resources: T) => Promise<R>,
    signal?: AbortSignal,
  ): Promise<R> {
    validIdentity(workspaceId);
    validIdentity(ownerId);
    if (this.draining)
      throw new Error("Hosted workspace pool is shutting down");
    this.active++;
    let entry: Entry<T> | undefined;
    try {
      entry = await this.acquire(workspaceId, ownerId, signal);
      const workspace = await waitFor(entry.opening, signal);
      signal?.throwIfAborted();
      return await operation(workspace.resources);
    } finally {
      if (entry) entry.active--;
      this.active--;
      if (this.active === 0) this.drained?.();
    }
  }

  private async acquire(
    workspaceId: string,
    ownerId: string,
    signal?: AbortSignal,
  ): Promise<Entry<T>> {
    while (true) {
      signal?.throwIfAborted();
      let entry = this.entries.get(workspaceId);
      if (entry && entry.ownerId !== ownerId) throw new Error("FORBIDDEN");
      if (entry?.retiring) {
        await waitFor(this.retire(workspaceId, entry), signal);
        continue;
      }
      if (entry) {
        entry.active++;
        return entry;
      }
      if (this.entries.size >= this.limit) {
        const idle = [...this.entries].find(([, value]) => value.active === 0);
        if (!idle) throw new Error("Hosted workspace capacity reached");
        await waitFor(this.retire(...idle), signal);
        continue;
      }
      // Defer factory invocation until the shared entry has been installed,
      // including for synchronous throws or reentrant callers.
      const opening = Promise.resolve().then(() =>
        this.open(workspaceId, ownerId),
      );
      entry = { ownerId, opening, active: 1, retiring: false };
      this.entries.set(workspaceId, entry);
      const installed = entry;
      opening.catch(() => {
        if (this.entries.get(workspaceId) === installed)
          this.entries.delete(workspaceId);
      });
      return entry;
    }
  }

  /** Never reuse partially closed resources or free capacity before workers stop. */
  private retire(id: string, entry: Entry<T>): Promise<void> {
    if (entry.closing) return entry.closing;
    entry.retiring = true;
    const closing = entry.opening.then(async (workspace) => {
      await workspace.close();
      if (this.entries.get(id) === entry) this.entries.delete(id);
    });
    entry.closing = closing;
    closing.catch(() => {
      if (entry.closing === closing) entry.closing = undefined;
    });
    return closing;
  }

  /** Keep workspace ownership active until the response body is consumed or cancelled. */
  async runRequest(
    workspaceId: string,
    ownerId: string,
    request: Request,
    expiresAt: number,
    operation: (resources: T, signal: AbortSignal) => Promise<Response>,
    maxLifetimeMs: number,
  ): Promise<Response> {
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now())
      throw new Error("Hosted request credential has expired");
    if (!Number.isSafeInteger(maxLifetimeMs) || maxLifetimeMs < 1)
      throw new Error("Invalid hosted request lifetime");
    const lifetime = new AbortController();
    const abortFromRequest = () => lifetime.abort(request.signal.reason);
    if (request.signal.aborted) abortFromRequest();
    else
      request.signal.addEventListener("abort", abortFromRequest, {
        once: true,
      });
    const deadline = Math.min(expiresAt, Date.now() + maxLifetimeMs);
    const timeout = setTimeout(
      () => lifetime.abort(new Error("Hosted request deadline exceeded")),
      Math.max(0, deadline - Date.now()),
    );
    const endLifetime = () => {
      lifetime.abort(new Error("Hosted request lifetime ended"));
      clearTimeout(timeout);
      request.signal.removeEventListener("abort", abortFromRequest);
    };
    let resolveReady!: (response: Response) => void;
    let rejectReady!: (error: unknown) => void;
    const ready = new Promise<Response>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const execution = this.run(
      workspaceId,
      ownerId,
      async (resources) => {
        try {
          const response = await operation(resources, lifetime.signal);
          if (lifetime.signal.aborted) {
            await response.body?.cancel(lifetime.signal.reason);
            throw lifetime.signal.reason;
          }
          let finish!: () => void;
          const finished = new Promise<void>((resolve) => {
            finish = resolve;
          });
          resolveReady(holdResponse(response, lifetime, finish));
          await finished;
          return response;
        } catch (error) {
          rejectReady(error);
          throw error;
        } finally {
          // Accepted work invalidates its capability before `run` can release it.
          endLifetime();
        }
      },
      lifetime.signal,
    );
    // Also cover startup, capacity, owner, and draining failures that occur
    // before the operation callback is entered.
    execution.then(endLifetime, (error) => {
      endLifetime();
      rejectReady(error);
    });
    return ready;
  }

  /** Reject new work immediately; drain accepted work before closing resources.
   * Failed closes stay retained, and another call retries only those entries. */
  close(): Promise<void> {
    this.draining = true;
    if (this.closing) return this.closing;
    const attempt = this.finishClose();
    this.closing = attempt;
    attempt.catch(() => {
      if (this.closing === attempt) this.closing = undefined;
    });
    return attempt;
  }

  private async finishClose(): Promise<void> {
    if (this.active > 0)
      await new Promise<void>((resolve) => {
        this.drained = resolve;
      });
    this.drained = undefined;
    const outcomes = await Promise.allSettled(
      [...this.entries].map(([id, entry]) => this.retire(id, entry)),
    );
    const failures = outcomes
      .filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      )
      .map((result) => result.reason);
    if (failures.length)
      throw new AggregateError(failures, "Hosted workspace shutdown failed");
  }
}

function holdResponse(
  response: Response,
  lifetime: AbortController,
  finish: () => void,
): Response {
  if (!response.body) {
    lifetime.abort(new Error("Hosted response lifetime ended"));
    finish();
    return response;
  }
  const reader = response.body.getReader();
  let finished = false;
  const complete = () => {
    if (finished) return;
    finished = true;
    lifetime.signal.removeEventListener("abort", abort);
    lifetime.abort(new Error("Hosted response lifetime ended"));
    finish();
  };
  const abort = () => {
    reader
      .cancel(lifetime.signal.reason)
      .finally(complete)
      .catch(() => undefined);
  };
  lifetime.signal.addEventListener("abort", abort, { once: true });
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (lifetime.signal.aborted) {
        controller.error(lifetime.signal.reason);
        return;
      }
      try {
        const next = await reader.read();
        if (next.done) {
          complete();
          controller.close();
        } else controller.enqueue(next.value);
      } catch (error) {
        complete();
        controller.error(error);
      }
    },
    async cancel(reason) {
      lifetime.abort(reason ?? new Error("Hosted response cancelled"));
      try {
        await reader.cancel(reason);
      } finally {
        complete();
      }
    },
  });
  return new Response(body, response);
}

function validIdentity(value: string): void {
  if (
    !value ||
    value.length > 256 ||
    value.trim() !== value ||
    /[\s\p{Cc}]/u.test(value)
  )
    throw new Error("Invalid admitted workspace identity");
}

/** Cancel this waiter without cancelling shared startup or releasing worker ownership. */
function waitFor<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    pending.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}
