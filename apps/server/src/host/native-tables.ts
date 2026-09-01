import type {
  ArrowQueryRunner,
  ArrowTableRegistrar,
} from "@dashframe/engine-server/arrow-data-path";
const NATIVE_UNREGISTER_MAX_ATTEMPTS = 3;
const NATIVE_UNREGISTER_RETRY_MS = 250;
export class NativeTableLifecycle {
  readonly engine: ArrowQueryRunner & Partial<ArrowTableRegistrar>;
  private readonly generations = new Map<string, number>();
  private readonly operations = new Map<string, Promise<void>>();
  private readonly retryTimers = new Map<
    string,
    { generation: number; timer: ReturnType<typeof setTimeout> }
  >();
  private closed = false;

  constructor(
    private readonly native: ArrowQueryRunner & Partial<ArrowTableRegistrar>,
  ) {
    this.engine = {
      queryArrow: (sql, params) => native.queryArrow(sql, params),
      ...(typeof native.registerArrowTable === "function"
        ? {
            registerArrowTable: (name: string, arrow: Uint8Array) =>
              this.register(name, arrow),
          }
        : {}),
      ...(typeof native.unregisterTable === "function"
        ? { unregisterTable: (name: string) => this.unregisterCurrent(name) }
        : {}),
    };
  }

  async unregisterCommittedFrames(ids: readonly string[]): Promise<void> {
    if (typeof this.native.unregisterTable !== "function") return;
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
    return this.generations.get(name) ?? 0;
  }

  private async register(name: string, arrow: Uint8Array): Promise<void> {
    if (this.closed) throw new Error("Native table lifecycle is closed");
    await this.enqueue(name, async () => {
      if (this.closed) throw new Error("Native table lifecycle is closed");
      await this.native.registerArrowTable!(name, arrow);
      this.generations.set(name, this.generation(name) + 1);
      this.cancelRetry(name);
    });
  }

  private async unregisterCurrent(name: string): Promise<void> {
    if (typeof this.native.unregisterTable !== "function") return;
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
        await this.native.unregisterTable!(name);
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
      const pending = this.retryTimers.get(name);
      if (pending?.generation !== generation) return;
      this.retryTimers.delete(name);
      this.tryUnregister(name, generation, attempt).catch((error) => {
        console.error("[dashframe] native unregister retry failed", error);
      });
    }, NATIVE_UNREGISTER_RETRY_MS);
    this.retryTimers.set(name, { generation, timer });
  }

  private cancelRetry(name: string): void {
    const pending = this.retryTimers.get(name);
    if (pending) clearTimeout(pending.timer);
    this.retryTimers.delete(name);
  }

  private enqueue(name: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.operations.get(name) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    const settled = current.then(
      () => undefined,
      () => undefined,
    );
    this.operations.set(name, settled);
    settled.then(() => {
      if (this.operations.get(name) === settled) this.operations.delete(name);
    });
    return current;
  }
}
