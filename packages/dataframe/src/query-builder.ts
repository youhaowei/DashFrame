import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import type { DataFrame } from "./index";
import { loadArrowData } from "./persistence";

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
 * The first loader creates the table; subsequent loaders wait for completion and reuse it.
 */
const tableLoadingMutex = new Map<string, Promise<string>>();

/**
 * Set of tables that have been successfully loaded into DuckDB in this session.
 * Used to skip redundant DROP + INSERT operations.
 */
const loadedTables = new Set<string>();

/**
 * Invalidate the loaded table cache for a specific DataFrame.
 * Call this when the underlying data in IndexedDB has been updated
 * to ensure the next query loads fresh data.
 *
 * @param dataFrameId - The UUID of the DataFrame to invalidate
 */
export function invalidateTableCache(dataFrameId: string): void {
  const tableName = `df_${dataFrameId.replace(/-/g, "_")}`;
  loadedTables.delete(tableName);
}

/**
 * Clear all loaded table caches.
 * Useful for testing or when clearing all data.
 */
export function clearAllTableCaches(): void {
  loadedTables.clear();
}

// ============================================================================
// Query Operation Types
// ============================================================================

export type FilterOperator =
  | "="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "LIKE"
  | "ILIKE"
  | "IN"
  | "NOT IN"
  | "IS NULL"
  | "IS NOT NULL";

export type FilterPredicate = {
  columnName: string;
  operator: FilterOperator;
  value?: unknown;
  values?: unknown[];
};

export type SortDirection = "asc" | "desc";

export type SortOrder = {
  columnName: string;
  direction: SortDirection;
};

export type AggregationFunction =
  | "sum"
  | "avg"
  | "count"
  | "min"
  | "max"
  | "count_distinct";

export type Aggregation = {
  columnName: string;
  function: AggregationFunction;
  alias?: string;
};

export type JoinType = "inner" | "left" | "right" | "outer";

export type JoinOptions = {
  type: JoinType;
  leftColumn: string;
  rightColumn: string;
};

// ============================================================================
// Query Operations (Internal)
// ============================================================================

type Operation =
  | { type: "filter"; predicates: FilterPredicate[] }
  | { type: "sort"; orders: SortOrder[] }
  | { type: "group"; columns: string[]; aggregations?: Aggregation[] }
  | { type: "join"; rightDataFrame: DataFrame; options: JoinOptions }
  | { type: "limit"; count: number }
  | { type: "offset"; count: number }
  | { type: "select"; columns: string[] };

// ============================================================================
// QueryBuilder Class Implementation
// ============================================================================

/**
 * QueryBuilder - Handles data loading from storage and SQL execution
 *
 * Implements deferred execution pattern: operations are accumulated but not
 * executed until .run() is called. This enables query optimization and
 * efficient storage abstraction.
 */
export class QueryBuilder {
  private dataFrame: DataFrame;
  private conn: AsyncDuckDBConnection;
  private tableName?: string;
  private operations: Operation[] = [];

  constructor(dataFrame: DataFrame, conn: AsyncDuckDBConnection) {
    this.dataFrame = dataFrame;
    this.conn = conn;
  }

  // ============================================================================
  // Storage Loading
  // ============================================================================

  /**
   * Load data from storage location into DuckDB
   * Uses appropriate loading strategy based on storage type.
   *
   * This method uses a global mutex to prevent race conditions when multiple
   * QueryBuilder instances try to load the same DataFrame concurrently.
   */
  private async ensureLoaded(): Promise<string> {
    if (this.tableName) {
      return this.tableName;
    }

    const tableName = `df_${this.dataFrame.id.replace(/-/g, "_")}`;

    // Fast path: If table is already loaded in this session, just reuse it
    if (loadedTables.has(tableName)) {
      this.tableName = tableName;
      return tableName;
    }

    // Check if another QueryBuilder is already loading this table
    const existingLoad = tableLoadingMutex.get(tableName);
    if (existingLoad) {
      // Wait for the existing load to complete, then reuse the table
      await existingLoad;
      this.tableName = tableName;
      return tableName;
    }

    // We're the first to load this table - create a promise for others to wait on
    let resolveLoad: (name: string) => void;
    let rejectLoad: (err: Error) => void;
    const loadPromise = new Promise<string>((resolve, reject) => {
      resolveLoad = resolve;
      rejectLoad = reject;
    });
    tableLoadingMutex.set(tableName, loadPromise);

    try {
      // Drop existing table if it exists (ensures fresh data from IndexedDB)
      await this.conn.query(`DROP TABLE IF EXISTS ${tableName}`);

      switch (this.dataFrame.storage.type) {
        case "indexeddb": {
          const buffer = await loadArrowData(this.dataFrame.storage.key);
          if (!buffer) {
            throw new Error(
              `Data not found in IndexedDB: ${this.dataFrame.storage.key}`,
            );
          }

          // Insert Arrow IPC data into DuckDB using the dedicated method
          await this.conn.insertArrowFromIPCStream(buffer, {
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
          const _exhaustive: never = this.dataFrame.storage;
          throw new Error(
            `Unsupported storage type: ${JSON.stringify(_exhaustive)}`,
          );
        }
      }

      // Mark table as loaded and resolve the promise
      loadedTables.add(tableName);
      this.tableName = tableName;
      resolveLoad!(tableName);
      return tableName;
    } catch (err) {
      // Reject the promise so other waiters know loading failed
      rejectLoad!(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      // Clean up the mutex (whether success or failure)
      tableLoadingMutex.delete(tableName);
    }
  }

  // ============================================================================
  // Query Operations (Method Chaining)
  // ============================================================================

  /**
   * Filter rows based on predicates
   */
  filter(predicates: FilterPredicate[]): QueryBuilder {
    this.operations.push({ type: "filter", predicates });
    return this;
  }

  /**
   * Sort results by columns
   */
  sort(orders: SortOrder[]): QueryBuilder {
    this.operations.push({ type: "sort", orders });
    return this;
  }

  /**
   * Group by columns with optional aggregations
   */
  groupBy(columns: string[], aggregations?: Aggregation[]): QueryBuilder {
    this.operations.push({ type: "group", columns, aggregations });
    return this;
  }

  /**
   * Join with another DataFrame
   */
  join(other: DataFrame, options: JoinOptions): QueryBuilder {
    this.operations.push({ type: "join", rightDataFrame: other, options });
    return this;
  }

  /**
   * Limit number of rows
   */
  limit(count: number): QueryBuilder {
    this.operations.push({ type: "limit", count });
    return this;
  }

  /**
   * Skip first N rows (for pagination)
   */
  offset(count: number): QueryBuilder {
    this.operations.push({ type: "offset", count });
    return this;
  }

  /**
   * Select specific columns
   */
  select(columns: string[]): QueryBuilder {
    this.operations.push({ type: "select", columns });
    return this;
  }

  // ============================================================================
  // SQL Generation and Execution
  // ============================================================================

  /**
   * Generate SQL from accumulated operations
   */
  async sql(): Promise<string> {
    const baseTableName = await this.ensureLoaded();
    let query = `SELECT * FROM ${baseTableName}`;
    let hasGroupBy = false;

    for (const operation of this.operations) {
      switch (operation.type) {
        case "filter":
          const whereClause = operation.predicates
            .map((pred) => {
              const { columnName, operator, value, values } = pred;

              if (operator === "IS NULL" || operator === "IS NOT NULL") {
                return `${columnName} ${operator}`;
              }

              if (operator === "IN" || operator === "NOT IN") {
                const list =
                  values
                    ?.map((v) => (typeof v === "string" ? `'${v}'` : String(v)))
                    .join(", ") || "";
                return `${columnName} ${operator} (${list})`;
              }

              const formattedValue =
                typeof value === "string"
                  ? `'${value}'`
                  : String(value ?? "NULL");
              return `${columnName} ${operator} ${formattedValue}`;
            })
            .join(" AND ");

          query += ` WHERE ${whereClause}`;
          break;

        case "sort":
          const orderByClause = operation.orders
            .map(
              (order) => `${order.columnName} ${order.direction.toUpperCase()}`,
            )
            .join(", ");
          query += hasGroupBy ? ` ORDER BY ${orderByClause}` : "";
          break;

        case "group":
          hasGroupBy = true;
          const groupByClause = operation.columns.join(", ");
          const selectClause =
            operation.aggregations
              ?.map((agg) => {
                const aggFunction = agg.function.toUpperCase();
                const column = agg.columnName;
                const alias = agg.alias ? ` AS ${agg.alias}` : "";
                return `${aggFunction}(${column})${alias}`;
              })
              .join(", ") || operation.columns;

          query = `SELECT ${selectClause}, ${groupByClause} FROM ${baseTableName} GROUP BY ${groupByClause}`;
          break;

        case "join":
          const rightTable = `df_${operation.rightDataFrame.id.replace(/-/g, "_")}`;
          // Load right table if needed
          const rightQueryBuilder = new QueryBuilder(
            operation.rightDataFrame,
            this.conn,
          );
          await rightQueryBuilder.ensureLoaded();

          const joinType = operation.options.type.toUpperCase();
          query = `SELECT * FROM ${query} ${joinType} JOIN ${rightTable} ON ${baseTableName}.${operation.options.leftColumn} = ${rightTable}.${operation.options.rightColumn}`;
          break;

        case "limit":
          query += ` LIMIT ${operation.count}`;
          break;

        case "offset":
          query += ` OFFSET ${operation.count}`;
          break;

        case "select":
          const selectList = operation.columns.join(", ");
          query = query.replace("SELECT *", `SELECT ${selectList}`);
          break;
      }
    }

    // Add ORDER BY for sort operations if not already added
    const sortOperation = this.operations.find((op) => op.type === "sort");
    if (sortOperation && !hasGroupBy) {
      const orderByClause = sortOperation.orders
        .map((order) => `${order.columnName} ${order.direction.toUpperCase()}`)
        .join(", ");
      if (orderByClause && !query.includes("ORDER BY")) {
        query += ` ORDER BY ${orderByClause}`;
      }
    }

    return query;
  }

  /**
   * Execute query and return new DataFrame with result
   */
  async run(): Promise<DataFrame> {
    const sql = await this.sql();
    console.debug("Executing QueryBuilder SQL:", sql);

    // Export result to Arrow IPC buffer
    const exportResult = await this.conn.query(`
      COPY (${sql}) TO 'output.arrow' (FORMAT ARROW)
    `);

    const arrowBuffer = exportResult.toArray()[0];

    // Create new DataFrame with result
    // Note: For query results, we don't preserve fieldIds since the structure may have changed
    const { DataFrame: DataFrameClass } = await import("./index");
    const resultDataFrame = await DataFrameClass.create(arrowBuffer, []);

    return resultDataFrame;
  }

  // ============================================================================
  // Convenience Methods
  // ============================================================================

  /**
   * Get preview of results (first 10 rows)
   */
  async preview(): Promise<Record<string, unknown>[]> {
    const tempLimit = this.limit(10);
    const sql = await tempLimit.sql();
    const result = await this.conn.query(sql);
    return result.toArray();
  }

  /**
   * Get count of matching rows
   */
  async count(): Promise<number> {
    const baseTableName = await this.ensureLoaded();
    let query = `SELECT COUNT(*) as count FROM ${baseTableName}`;

    // Apply filters but ignore other operations for count
    const filterOperation = this.operations.find((op) => op.type === "filter");
    if (filterOperation) {
      const whereClause = filterOperation.predicates
        .map((pred) => {
          const { columnName, operator, value, values } = pred;

          if (operator === "IS NULL" || operator === "IS NOT NULL") {
            return `${columnName} ${operator}`;
          }

          if (operator === "IN" || operator === "NOT IN") {
            const list =
              values
                ?.map((v) => (typeof v === "string" ? `'${v}'` : String(v)))
                .join(", ") || "";
            return `${columnName} ${operator} (${list})`;
          }

          const formattedValue =
            typeof value === "string" ? `'${value}'` : String(value ?? "NULL");
          return `${columnName} ${operator} ${formattedValue}`;
        })
        .join(" AND ");

      query += ` WHERE ${whereClause}`;
    }

    const result = await this.conn.query(query);
    return result.toArray()[0].count as number;
  }
}
