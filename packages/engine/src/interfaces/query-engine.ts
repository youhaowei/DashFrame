/**
 * QueryEngine — the Arrow-native surface every DuckDB backing implements.
 *
 * SQL goes in, Arrow IPC stream buffers come out. Row-shaped JSON is a
 * transport concern and lives there (`arrowIpcToJsonRows` in
 * `@dashframe/engine-server/arrow-data-path`), not on this interface.
 *
 * Backings: `NativeDuckDBEngine` (`@dashframe/engine-server`) runs DuckDB in
 * the server process, and `WorkspaceQueryEngine` (same package) runs it behind
 * the sandboxed hosted worker. They are backings of one interface, not sibling
 * APIs. The DuckDB-WASM helpers in `@dashframe/engine-browser` are a separate
 * renderer fallback and do NOT implement this interface today; binding them as
 * a third backing is its own step.
 *
 * There is no Postgres `QueryEngine` and no shared `QueryPlanner` /
 * `QueryPushDownCapable` API in this package. Individual connectors may still
 * run remote queries themselves (e.g. the Postgres connector pushes LIMIT/OFFSET
 * on table-reference fetches); that is connector-local, not a cross-engine planner.
 *
 * Every operation that can run long takes a caller `signal`. `params` bind
 * natively — no backing may substitute placeholder text into the SQL.
 */
export interface QueryEngine {
  /** Initialize the engine (open the database, apply access restrictions). */
  initialize(): Promise<void>;

  /** Release every resource the engine owns. Safe to call more than once. */
  dispose(): Promise<void>;

  /** True once `initialize()` has completed and the engine has not been disposed. */
  isReady(): boolean;

  /**
   * Execute `sql` and return the whole result as one Arrow IPC stream buffer.
   * @param params - Positional bind values, bound natively.
   * @param signal - Cancels the statement in flight.
   */
  queryArrow(
    sql: string,
    params?: readonly unknown[],
    signal?: AbortSignal,
  ): Promise<Uint8Array>;

  /**
   * Execute `sql` and yield the result as a sequence of Arrow IPC stream
   * buffers.
   *
   * This is a delivery shape, not a promise about production. The native
   * backing genuinely produces batches incrementally, so a large result never
   * has to be resident whole; the hosted backing answers a query with one
   * framed payload and yields that single buffer. Callers that must bound
   * memory need the native binding, and `nativeTransfer` on the host runtime
   * is how they tell.
   */
  queryArrowBatches(
    sql: string,
    params?: readonly unknown[],
    signal?: AbortSignal,
  ): AsyncIterable<Uint8Array>;

  /**
   * Register an Arrow IPC stream buffer as the named table, replacing any
   * previous table of that name. Atomic: a failure leaves the previous table
   * untouched.
   */
  registerArrowTable(
    name: string,
    arrow: Uint8Array,
    signal?: AbortSignal,
  ): Promise<void>;

  /** Same contract as `registerArrowTable`, fed by a chunked Arrow IPC stream. */
  registerArrowStream(
    name: string,
    chunks: AsyncIterable<Uint8Array>,
    signal?: AbortSignal,
  ): Promise<void>;

  /** Drop a registered table. Unknown names are not an error. */
  unregisterTable(name: string): Promise<void>;

  /** Whether `name` is currently registered with this engine. */
  hasTable(name: string): boolean;

  /** Every table name currently registered with this engine. */
  getTableNames(): string[];
}
