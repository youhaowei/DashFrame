import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import type { DataFrame } from "@dashframe/engine";
import { loadArrowData } from "./storage";
import { BrowserDataFrame } from "./dataframe";

// ============================================================================
// Global Table Loading Mutex
// ============================================================================

/**
 * Global mutex to prevent concurrent table creation for the same DataFrame.
 *
 * Problem: When multiple QueryBuilder instances try to load the same DataFrame
 * concurrently (e.g., React Strict Mode double-render, multiple components),
 * they can race between DROP TABLE and INSERT, causing "ENTRY_ALREADY_EXISTS".
 *
 * Solution: A global promise-based mutex that serializes table creation per DataFrame.
 */
const tableLoadingMutex = new Map<string, Promise<string>>();

/**
 * Set of tables successfully loaded into DuckDB in this session.
 */
const loadedTables = new Set<string>();

const makeTableName = (dataFrameId: string): string =>
  `df_${dataFrameId.replace(/-/g, "_")}`;

const quoteIdent = (identifier: string): string =>
  `"${identifier.replace(/"/g, '""')}"`;

const formatValue = (value: unknown): string => {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" || typeof value === "bigint")
    return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return `'${value.toISOString()}'`;
  return `'${String(value).replace(/'/g, "''")}'`;
};

/**
 * Invalidate the loaded table cache for a specific DataFrame.
 * Call when underlying IndexedDB data has been updated.
 */
export function invalidateTableCache(dataFrameId: string): void {
  const tableName = makeTableName(dataFrameId);
  loadedTables.delete(tableName);
}

/**
 * Clear all loaded table caches.
 */
export function clearAllTableCaches(): void {
  loadedTables.clear();
}

// ============================================================================
// Query Operations Types (Local)
// ============================================================================

type FilterPredicateLocal = {
  columnName: string;
  operator: string;
  value?: unknown;
  values?: unknown[];
};

type SortOrderLocal = {
  columnName: string;
  direction: "asc" | "desc";
};

type AggregationLocal = {
  columnName: string;
  function: string;
  alias?: string;
};

type JoinOptionsLocal = {
  type: "inner" | "left" | "right" | "outer";
  leftColumn: string;
  rightColumn: string;
};

type Operation =
  | { type: "filter"; predicates: FilterPredicateLocal[] }
  | { type: "sort"; orders: SortOrderLocal[] }
  | { type: "group"; columns: string[]; aggregations?: AggregationLocal[] }
  | { type: "join"; rightDataFrame: DataFrame; options: JoinOptionsLocal }
  | { type: "limit"; count: number }
  | { type: "offset"; count: number }
  | { type: "select"; columns: string[] };

type JoinOperation = Extract<Operation, { type: "join" }>;

type QueryPlan = {
  filters: FilterPredicateLocal[];
  sorts: SortOrderLocal[];
  joins: JoinOperation[];
  groupColumns?: string[];
  aggregations?: AggregationLocal[];
  selectColumns?: string[];
  limit?: number;
  offset?: number;
};

// ============================================================================
// Helpers
// ============================================================================

const formatPredicate = (pred: FilterPredicateLocal): string => {
  const column = quoteIdent(pred.columnName);
  const operator = pred.operator.toUpperCase();

  if (operator === "IS NULL" || operator === "IS NOT NULL") {
    return `${column} ${operator}`;
  }

  if (operator === "IN" || operator === "NOT IN") {
    const list = (pred.values ?? []).map(formatValue).join(", ");
    return `${column} ${operator} (${list})`;
  }

  return `${column} ${operator} ${formatValue(pred.value)}`;
};

const buildPlan = (operations: Operation[]): QueryPlan => {
  const plan: QueryPlan = {
    filters: [],
    sorts: [],
    joins: [],
  };

  for (const op of operations) {
    switch (op.type) {
      case "filter":
        plan.filters.push(...op.predicates);
        break;
      case "sort":
        plan.sorts = op.orders;
        break;
      case "group":
        plan.groupColumns = op.columns;
        plan.aggregations = op.aggregations;
        break;
      case "join":
        plan.joins.push(op);
        break;
      case "limit":
        plan.limit = op.count;
        break;
      case "offset":
        plan.offset = op.count;
        break;
      case "select":
        plan.selectColumns = op.columns;
        break;
    }
  }

  return plan;
};

const buildSelectClause = (plan: QueryPlan): string => {
  if (plan.groupColumns?.length) {
    if (plan.selectColumns?.length) {
      return plan.selectColumns.map(quoteIdent).join(", ");
    }

    const groupCols = plan.groupColumns.map(quoteIdent);
    const aggregations =
      plan.aggregations?.map((agg) => {
        const func = agg.function.toUpperCase();
        const alias = agg.alias ? ` AS ${quoteIdent(agg.alias)}` : "";
        return `${func}(${quoteIdent(agg.columnName)})${alias}`;
      }) ?? [];

    return [...aggregations, ...groupCols].join(", ");
  }

  if (plan.selectColumns?.length) {
    return plan.selectColumns.map(quoteIdent).join(", ");
  }

  return "*";
};

const buildOrderClause = (sorts: SortOrderLocal[]): string | undefined => {
  if (!sorts.length) return undefined;
  return sorts
    .map(
      (order) =>
        `${quoteIdent(order.columnName)} ${order.direction.toUpperCase()}`,
    )
    .join(", ");
};

// ============================================================================
// Table Loading
// ============================================================================

export async function ensureTableLoaded(
  dataFrame: DataFrame,
  conn: AsyncDuckDBConnection,
): Promise<string> {
  const tableName = makeTableName(dataFrame.id);

  // Check if there's an ongoing load for this table (mutex prevents concurrent loads)
  const existingLoad = tableLoadingMutex.get(tableName);
  if (existingLoad) {
    return existingLoad;
  }

  // Create mutex promise for this load
  let resolveLoad!: (name: string) => void;
  let rejectLoad!: (err: Error) => void;
  const loadPromise = new Promise<string>((resolve, reject) => {
    resolveLoad = resolve;
    rejectLoad = reject;
  });
  tableLoadingMutex.set(tableName, loadPromise);

  try {
    // Always check if table exists in DuckDB (even if cache says it's loaded)
    // This handles cases where DuckDB was reset or table was dropped externally
    let tableExists = false;
    try {
      const checkResult = await conn.query(
        `SELECT 1 FROM information_schema.tables WHERE table_name = '${tableName}' LIMIT 1`,
      );
      tableExists = checkResult.toArray().length > 0;
      console.log(
        `[ensureTableLoaded] Table ${tableName} exists check:`,
        tableExists,
      );
    } catch (err) {
      // If check fails, assume table doesn't exist
      console.warn(
        `[ensureTableLoaded] Failed to check table existence for ${tableName}:`,
        err,
      );
      tableExists = false;
    }

    if (tableExists) {
      // Table already exists in DuckDB - mark as loaded and return
      console.log(
        `[ensureTableLoaded] Skipping load for existing table ${tableName}`,
      );
      loadedTables.add(tableName);
      resolveLoad(tableName);
      return tableName;
    }

    // Table doesn't exist - create it
    console.log(
      `[ensureTableLoaded] Creating table ${tableName} (dropping first if exists)`,
    );
    await conn.query(`DROP TABLE IF EXISTS ${quoteIdent(tableName)}`);

    switch (dataFrame.storage.type) {
      case "indexeddb": {
        const buffer = await loadArrowData(dataFrame.storage.key);
        if (!buffer) {
          throw new Error(
            `Data not found in IndexedDB: ${dataFrame.storage.key}`,
          );
        }

        await conn.insertArrowFromIPCStream(buffer, {
          name: tableName,
          create: true,
        });
        break;
      }
      case "s3":
        throw new Error("S3 storage not yet implemented");
      case "r2":
        throw new Error("R2 storage not yet implemented");
      default: {
        const _exhaustive: never = dataFrame.storage;
        throw new Error(
          `Unsupported storage type: ${JSON.stringify(_exhaustive)}`,
        );
      }
    }

    loadedTables.add(tableName);
    resolveLoad(tableName);
    return tableName;
  } catch (err) {
    rejectLoad(err instanceof Error ? err : new Error(String(err)));
    throw err;
  } finally {
    tableLoadingMutex.delete(tableName);
  }
}

// ============================================================================
// QueryBuilder Class
// ============================================================================

/**
 * QueryBuilder - Handles data loading from storage and SQL execution.
 *
 * Implements deferred execution pattern with immutable chaining: operations are
 * accumulated but not executed until .run()/.rows()/.preview() are called.
 */
export class QueryBuilder {
  private readonly dataFrame: DataFrame;
  private readonly conn: AsyncDuckDBConnection;
  private readonly operations: Operation[];
  private tableName?: string;

  constructor(
    dataFrame: DataFrame,
    conn: AsyncDuckDBConnection,
    operations: Operation[] = [],
    tableName?: string,
  ) {
    this.dataFrame = dataFrame;
    this.conn = conn;
    this.operations = operations;
    this.tableName = tableName;
  }

  private cloneWith(operation: Operation): QueryBuilder {
    return new QueryBuilder(
      this.dataFrame,
      this.conn,
      [...this.operations, operation],
      this.tableName,
    );
  }

  /**
   * Load data from storage into DuckDB.
   * Uses global mutex to prevent race conditions.
   * Public method to allow explicit table loading before queries.
   */
  async ensureLoaded(): Promise<string> {
    if (this.tableName) {
      return this.tableName;
    }

    const tableName = await ensureTableLoaded(this.dataFrame, this.conn);
    this.tableName = tableName;
    return tableName;
  }

  private async buildFromClause(
    baseTableName: string,
    joins: JoinOperation[],
  ): Promise<string> {
    let clause = quoteIdent(baseTableName);

    for (const join of joins) {
      const rightTable = await ensureTableLoaded(
        join.rightDataFrame,
        this.conn,
      );
      const joinType = (join.options.type ?? "inner").toUpperCase();
      clause = `${clause} ${joinType} JOIN ${quoteIdent(rightTable)} ON ${quoteIdent(baseTableName)}.${quoteIdent(join.options.leftColumn)} = ${quoteIdent(rightTable)}.${quoteIdent(join.options.rightColumn)}`;
    }

    return clause;
  }

  private async buildSQL(operations: Operation[]): Promise<string> {
    const baseTableName = await this.ensureLoaded();
    const plan = buildPlan(operations);

    const selectClause = buildSelectClause(plan);
    const fromClause = await this.buildFromClause(baseTableName, plan.joins);
    const whereClause =
      plan.filters.length > 0
        ? plan.filters.map(formatPredicate).join(" AND ")
        : "";
    const groupClause = plan.groupColumns?.length
      ? plan.groupColumns.map(quoteIdent).join(", ")
      : "";
    const orderClause = buildOrderClause(plan.sorts);

    let query = `SELECT ${selectClause} FROM ${fromClause}`;
    if (whereClause) query += ` WHERE ${whereClause}`;
    if (groupClause) query += ` GROUP BY ${groupClause}`;
    if (orderClause) query += ` ORDER BY ${orderClause}`;
    if (plan.limit !== undefined) query += ` LIMIT ${plan.limit}`;
    if (plan.offset !== undefined) query += ` OFFSET ${plan.offset}`;

    return query;
  }

  // ============================================================================
  // Query Operations (Method Chaining)
  // ============================================================================

  filter(predicates: FilterPredicateLocal[]): QueryBuilder {
    return this.cloneWith({ type: "filter", predicates });
  }

  sort(orders: SortOrderLocal[]): QueryBuilder {
    return this.cloneWith({ type: "sort", orders });
  }

  orderBy(orders: SortOrderLocal[]): QueryBuilder {
    return this.sort(orders);
  }

  groupBy(columns: string[], aggregations?: AggregationLocal[]): QueryBuilder {
    return this.cloneWith({ type: "group", columns, aggregations });
  }

  join(other: DataFrame, options: JoinOptionsLocal): QueryBuilder {
    const joinType = options.type ?? "inner";
    return this.cloneWith({
      type: "join",
      rightDataFrame: other,
      options: { ...options, type: joinType },
    });
  }

  limit(count: number): QueryBuilder {
    return this.cloneWith({ type: "limit", count });
  }

  offset(count: number): QueryBuilder {
    return this.cloneWith({ type: "offset", count });
  }

  select(columns: string[]): QueryBuilder {
    return this.cloneWith({ type: "select", columns });
  }

  // ============================================================================
  // SQL Generation
  // ============================================================================

  async sql(): Promise<string> {
    return this.buildSQL(this.operations);
  }

  async toSQL(): Promise<string> {
    return this.sql();
  }

  async rows(): Promise<Record<string, unknown>[]> {
    const result = await this.conn.query(await this.sql());
    return result.toArray();
  }

  /**
   * Execute query and return new DataFrame with result.
   */
  async run(): Promise<BrowserDataFrame> {
    const sql = await this.sql();
    console.debug("Executing QueryBuilder SQL:", sql);

    const exportResult = await this.conn.query(`
      COPY (${sql}) TO 'output.arrow' (FORMAT ARROW)
    `);

    const arrowBuffer = exportResult.toArray()[0];
    return BrowserDataFrame.create(arrowBuffer, []);
  }

  /**
   * Get preview of results (first 10 rows).
   */
  async preview(limit = 10): Promise<Record<string, unknown>[]> {
    return this.limit(limit).rows();
  }

  /**
   * Get count of matching rows.
   */
  async count(): Promise<number> {
    const operationsForCount = this.operations.filter(
      (op) =>
        op.type !== "limit" &&
        op.type !== "offset" &&
        op.type !== "sort" &&
        op.type !== "select",
    );

    const sql = await this.buildSQL(operationsForCount);
    const result = await this.conn.query(
      `SELECT COUNT(*) as count FROM (${sql})`,
    );
    return Number(result.toArray()[0]?.count ?? 0);
  }

  /**
   * Execute multiple SQL queries in a single database call using UNION ALL.
   * Each query result is tagged with an index for separation.
   *
   * This helper allows batching multiple independent queries to reduce round-trips.
   * Example use case: analyzing all columns in a table with one query instead of N queries.
   *
   * @param conn - DuckDB connection
   * @param queries - Array of SQL SELECT statements to execute
   * @returns Array of result arrays, one per input query in the same order
   *
   * @example
   * ```typescript
   * const [statsResults, samplesResults] = await QueryBuilder.batchQuery(conn, [
   *   `SELECT COUNT(*) as count FROM table1`,
   *   `SELECT DISTINCT col FROM table2 LIMIT 10`
   * ]);
   * ```
   */
  static async batchQuery<T extends Record<string, unknown>>(
    conn: AsyncDuckDBConnection,
    queries: string[],
  ): Promise<T[][]> {
    if (queries.length === 0) return [];
    if (queries.length === 1) {
      const result = await conn.query(queries[0]);
      return [result.toArray() as T[]];
    }

    // Wrap each query with a _batch_idx identifier
    const wrappedQueries = queries.map(
      (q, i) => `SELECT ${i} as _batch_idx, * FROM (${q})`,
    );
    const combinedSQL = wrappedQueries.join(" UNION ALL ");

    const result = await conn.query(combinedSQL);
    const rows = result.toArray() as (T & { _batch_idx: number })[];

    // Partition results by _batch_idx
    const partitioned: T[][] = queries.map(() => []);
    for (const row of rows) {
      const idx = row._batch_idx;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { _batch_idx, ...rest } = row;
      partitioned[idx].push(rest as unknown as T);
    }

    return partitioned;
  }
}

// Re-export types for convenience
export type {
  FilterPredicate,
  SortOrder,
  Aggregation,
  JoinOptions,
} from "@dashframe/engine";
