import type { QueryEngine } from "@dashframe/engine";
import { tableKey } from "@dashframe/engine-server/table-identity";
const NATIVE_UNREGISTER_MAX_ATTEMPTS = 3;
const NATIVE_UNREGISTER_RETRY_MS = 250;
export class NativeTableLifecycle {
  /**
   * The engine as request handlers and the transport see it: every
   * registration and unregistration is serialized per table name and carries a
   * generation, so a late cleanup cannot drop a table a newer registration has
   * already replaced.
   *
   * Lifecycle is deliberately not forwarded. The server composition owns the
   * engine it constructed; a request handler that called `initialize()` or
   * `dispose()` would be reaching past its own request into a process-wide
   * resource other requests are using. They reject rather than delegate.
   */
  readonly engine: QueryEngine & { nativeTransfer: true };
  private readonly generations = new Map<string, number>();
  private readonly operations = new Map<string, Promise<void>>();
  private readonly retryTimers = new Map<
    string,
    { generation: number; timer: ReturnType<typeof setTimeout> }
  >();
  private closed = false;

  constructor(private readonly native: QueryEngine) {
    this.engine = {
      nativeTransfer: true,
      initialize: () => Promise.reject(new Error("ENGINE_LIFECYCLE_NOT_OWNED")),
      dispose: () => Promise.reject(new Error("ENGINE_LIFECYCLE_NOT_OWNED")),
      isReady: () => native.isReady(),
      queryArrow: (sql, params, signal) =>
        native.queryArrow(sql, params, signal),
      queryArrowBatches: native.queryArrowBatches.bind(native),
      registerArrowTable: (name, arrow, signal) =>
        this.register(name, arrow, signal),
      registerArrowStream: (name, stream, signal) =>
        this.registerStream(name, stream, signal),
      registerArrowBatches: (name, batches, signal) =>
        this.registerBatches(name, batches, signal),
      unregisterTable: (name) => this.unregisterCurrent(name),
      hasTable: (name) => native.hasTable(name),
      getTableNames: () => native.getTableNames(),
    };
  }

  async unregisterCommittedFrames(ids: readonly string[]): Promise<void> {
    await Promise.all(
      ids.map((id) => {
        const name = `df_${id.replaceAll("-", "_")}`;
        return this.tryUnregister(name, this.generation(name), 1);
      }),
    );
  }

  close(): void {
    this.closed = true;
    for (const { timer } of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
  }

  private generation(name: string): number {
    return this.generations.get(tableKey(name)) ?? 0;
  }

  private async register(
    name: string,
    arrow: Uint8Array,
    signal?: AbortSignal,
  ): Promise<void> {
    if (this.closed) throw new Error("Native table lifecycle is closed");
    await this.enqueue(name, async () => {
      if (this.closed) throw new Error("Native table lifecycle is closed");
      await this.native.registerArrowTable(name, arrow, signal);
      this.generations.set(tableKey(name), this.generation(name) + 1);
      this.cancelRetry(name);
    });
  }

  private async registerStream(
    name: string,
    stream: AsyncIterable<Uint8Array>,
    signal?: AbortSignal,
  ): Promise<void> {
    if (this.closed) throw new Error("Native table lifecycle is closed");
    await this.enqueue(name, async () => {
      if (this.closed) throw new Error("Native table lifecycle is closed");
      await this.native.registerArrowStream(name, stream, signal);
      this.generations.set(tableKey(name), this.generation(name) + 1);
      this.cancelRetry(name);
    });
  }

  private async registerBatches(
    name: string,
    batches: AsyncIterable<Uint8Array>,
    signal?: AbortSignal,
  ): Promise<void> {
    if (this.closed) throw new Error("Native table lifecycle is closed");
    await this.enqueue(name, async () => {
      if (this.closed) throw new Error("Native table lifecycle is closed");
      await this.native.registerArrowBatches(name, batches, signal);
      this.generations.set(tableKey(name), this.generation(name) + 1);
      this.cancelRetry(name);
    });
  }

  private async unregisterCurrent(name: string): Promise<void> {
    const generation = this.generation(name);
    await this.enqueue(name, async () => {
      if (this.closed || this.generation(name) !== generation) return;
      await this.native.unregisterTable!(name);
    });
  }

  private async tryUnregister(
    name: string,
    generation: number,
    attempt: number,
  ): Promise<void> {
    try {
      await this.enqueue(name, async () => {
        if (this.closed || this.generation(name) !== generation) return;
        await this.native.unregisterTable(name);
      });
    } catch (error) {
      if (this.closed || this.generation(name) !== generation) return;
      if (attempt >= NATIVE_UNREGISTER_MAX_ATTEMPTS) {
        console.error(
          `[dashframe] native table ${name} remains registered after ${attempt} cleanup attempts`,
          error,
        );
        return;
      }
      console.error(
        `[dashframe] native table ${name} unregister failed after durable frame deletion; retrying (${attempt + 1}/${NATIVE_UNREGISTER_MAX_ATTEMPTS})`,
        error,
      );
      this.scheduleRetry(name, generation, attempt + 1);
    }
  }

  private scheduleRetry(
    name: string,
    generation: number,
    attempt: number,
  ): void {
    this.cancelRetry(name);
    const timer = setTimeout(() => {
      const pending = this.retryTimers.get(tableKey(name));
      if (pending?.generation !== generation) return;
      this.retryTimers.delete(tableKey(name));
      this.tryUnregister(name, generation, attempt).catch((error) => {
        console.error("[dashframe] native unregister retry failed", error);
      });
    }, NATIVE_UNREGISTER_RETRY_MS);
    this.retryTimers.set(tableKey(name), { generation, timer });
  }

  private cancelRetry(name: string): void {
    const pending = this.retryTimers.get(tableKey(name));
    if (pending) clearTimeout(pending.timer);
    this.retryTimers.delete(tableKey(name));
  }

  private enqueue(name: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.operations.get(tableKey(name)) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    const settled = current.then(
      () => undefined,
      () => undefined,
    );
    this.operations.set(tableKey(name), settled);
    settled.then(() => {
      if (this.operations.get(tableKey(name)) === settled)
        this.operations.delete(tableKey(name));
    });
    return current;
  }
}
