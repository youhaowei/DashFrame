interface OwnedWorkspace<T> {
  resources: T;
  /** Stop all workers and flush stores before releasing the volume lease.
   * Rejection must retain ownership and allow a later close attempt. */
  close(): Promise<void>;
}

interface Entry<T> {
  ownerId: string;
  opening: Promise<OwnedWorkspace<T>>;
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
  ): Promise<R> {
    validIdentity(workspaceId);
    validIdentity(ownerId);
    if (this.draining)
      throw new Error("Hosted workspace pool is shutting down");
    let entry = this.entries.get(workspaceId);
    if (entry && entry.ownerId !== ownerId) throw new Error("FORBIDDEN");
    if (!entry) {
      if (this.entries.size >= this.limit)
        throw new Error("Hosted workspace capacity reached");
      // Defer factory invocation until the shared entry has been installed,
      // including for synchronous throws or reentrant callers.
      const opening = Promise.resolve().then(() =>
        this.open(workspaceId, ownerId),
      );
      entry = { ownerId, opening };
      this.entries.set(workspaceId, entry);
      const installed = entry;
      opening.catch(() => {
        if (this.entries.get(workspaceId) === installed)
          this.entries.delete(workspaceId);
      });
    }
    this.active++;
    try {
      const workspace = await entry.opening;
      return await operation(workspace.resources);
    } finally {
      this.active--;
      if (this.active === 0) this.drained?.();
    }
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
    const execution = this.run(workspaceId, ownerId, async (resources) => {
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
    });
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
      [...this.entries].map(async ([id, entry]) => {
        const workspace = await entry.opening;
        await workspace.close();
        this.entries.delete(id);
      }),
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
