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

function validIdentity(value: string): void {
  if (
    !value ||
    value.length > 256 ||
    value.trim() !== value ||
    /[\s\p{Cc}]/u.test(value)
  )
    throw new Error("Invalid admitted workspace identity");
}
