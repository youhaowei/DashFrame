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

/**
 * Invalidate the loaded table cache for a specific DataFrame.
 * Call when underlying IndexedDB data has been updated.
 */
export function invalidateTableCache(dataFrameId: string): void {
  const tableName = `df_${dataFrameId.replace(/-/g, "_")}`;
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

// ============================================================================
// QueryBuilder Class
// ============================================================================

/**
 * QueryBuilder - Handles data loading from storage and SQL execution.
 *
 * Implements deferred execution pattern: operations are accumulated but not
 * executed until .run() is called.
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

  /**
   * Load data from storage into DuckDB.
   * Uses global mutex to prevent race conditions.
   */
  private async ensureLoaded(): Promise<string> {
    if (this.tableName) {
      return this.tableName;
    }

    const tableName = `df_${this.dataFrame.id.replace(/-/g, "_")}`;

    // Fast path: table already loaded this session
    if (loadedTables.has(tableName)) {
      this.tableName = tableName;
      return tableName;
    }

    // Check if another instance is already loading
    const existingLoad = tableLoadingMutex.get(tableName);
    if (existingLoad) {
      await existingLoad;
      this.tableName = tableName;
      return tableName;
    }

    // Create mutex promise
    let resolveLoad: (name: string) => void;
    let rejectLoad: (err: Error) => void;
    const loadPromise = new Promise<string>((resolve, reject) => {
      resolveLoad = resolve;
      rejectLoad = reject;
    });
    tableLoadingMutex.set(tableName, loadPromise);

    try {
      // Drop existing table
      await this.conn.query(`DROP TABLE IF EXISTS ${tableName}`);

      switch (this.dataFrame.storage.type) {
        case "indexeddb": {
          const buffer = await loadArrowData(this.dataFrame.storage.key);
          if (!buffer) {
            throw new Error(
              `Data not found in IndexedDB: ${this.dataFrame.storage.key}`,
            );
          }

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

      loadedTables.add(tableName);
      this.tableName = tableName;
      resolveLoad!(tableName);
      return tableName;
    } catch (err) {
      rejectLoad!(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      tableLoadingMutex.delete(tableName);
    }
  }

  // ============================================================================
  // Query Operations (Method Chaining)
  // ============================================================================

  filter(predicates: FilterPredicateLocal[]): QueryBuilder {
    this.operations.push({ type: "filter", predicates });
    return this;
  }

  sort(orders: SortOrderLocal[]): QueryBuilder {
    this.operations.push({ type: "sort", orders });
    return this;
  }

  groupBy(columns: string[], aggregations?: AggregationLocal[]): QueryBuilder {
    this.operations.push({ type: "group", columns, aggregations });
    return this;
  }

  join(other: DataFrame, options: JoinOptionsLocal): QueryBuilder {
    this.operations.push({ type: "join", rightDataFrame: other, options });
    return this;
  }

  limit(count: number): QueryBuilder {
    this.operations.push({ type: "limit", count });
    return this;
  }

  offset(count: number): QueryBuilder {
    this.operations.push({ type: "offset", count });
    return this;
  }

  select(columns: string[]): QueryBuilder {
    this.operations.push({ type: "select", columns });
    return this;
  }

  // ============================================================================
  // SQL Generation
  // ============================================================================

  async sql(): Promise<string> {
    const baseTableName = await this.ensureLoaded();
    let query = `SELECT * FROM ${baseTableName}`;
    let hasGroupBy = false;

    for (const operation of this.operations) {
      switch (operation.type) {
        case "filter": {
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
        }

        case "sort": {
          const orderByClause = operation.orders
            .map(
              (order) => `${order.columnName} ${order.direction.toUpperCase()}`,
            )
            .join(", ");
          query += hasGroupBy ? ` ORDER BY ${orderByClause}` : "";
          break;
        }

        case "group": {
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
        }

        case "join": {
          const rightTable = `df_${operation.rightDataFrame.id.replace(/-/g, "_")}`;
          const rightQueryBuilder = new QueryBuilder(
            operation.rightDataFrame,
            this.conn,
          );
          await rightQueryBuilder.ensureLoaded();

          const joinType = operation.options.type.toUpperCase();
          query = `SELECT * FROM ${query} ${joinType} JOIN ${rightTable} ON ${baseTableName}.${operation.options.leftColumn} = ${rightTable}.${operation.options.rightColumn}`;
          break;
        }

        case "limit":
          query += ` LIMIT ${operation.count}`;
          break;

        case "offset":
          query += ` OFFSET ${operation.count}`;
          break;

        case "select": {
          const selectList = operation.columns.join(", ");
          query = query.replace("SELECT *", `SELECT ${selectList}`);
          break;
        }
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
  async preview(): Promise<Record<string, unknown>[]> {
    const tempLimit = this.limit(10);
    const sql = await tempLimit.sql();
    const result = await this.conn.query(sql);
    return result.toArray();
  }

  /**
   * Get count of matching rows.
   */
  async count(): Promise<number> {
    const baseTableName = await this.ensureLoaded();
    let query = `SELECT COUNT(*) as count FROM ${baseTableName}`;

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

// Re-export types for convenience
export type {
  FilterPredicate,
  SortOrder,
  Aggregation,
  JoinOptions,
} from "@dashframe/engine";
