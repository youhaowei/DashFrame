/**
 * Pure SQL generation for Insight queries.
 *
 * This module generates standard SQL that works across databases (DuckDB, PostgreSQL, SQLite).
 * No async operations, no data fetching - just pure SQL string generation.
 *
 * ## Column Naming Convention
 *
 * All columns use UUID-based aliases for consistency:
 * - Fields: `field_<uuid>` (e.g., `field_dd05ef4b_1234_5678_abcd_ef1234567890`)
 * - Metrics: `metric_<uuid>` (e.g., `metric_cc33dd44_1234_5678_abcd_ef1234567890`)
 *
 * This ensures:
 * - No collision handling needed (UUIDs are globally unique)
 * - Encoding value = SQL column name = axis selection key (zero transformation)
 * - Display names looked up from field/metric definitions when rendering UI
 */

import type {
  DataTable,
  Field,
  Insight,
  InsightFilter,
  InsightFilterBetweenValue,
  InsightMetric,
  InsightSort,
  UUID,
} from "@dashframe/types";

import { quoteIdentifier } from "./quoting";

// ============================================================================
// UUID Column Naming Utilities
// ============================================================================

/**
 * Convert a field ID to a SQL-safe column alias.
 * Format: field_<uuid_with_underscores>
 *
 * @example
 * fieldIdToColumnAlias("dd05ef4b-1234-5678-abcd-ef1234567890")
 * // Returns: "field_dd05ef4b_1234_5678_abcd_ef1234567890"
 */
export function fieldIdToColumnAlias(fieldId: string): string {
  return `field_${fieldId.replace(/-/g, "_")}`;
}

/**
 * Convert a metric ID to a SQL-safe column alias.
 * Format: metric_<uuid_with_underscores>
 *
 * @example
 * metricIdToColumnAlias("cc33dd44-1234-5678-abcd-ef1234567890")
 * // Returns: "metric_cc33dd44_1234_5678_abcd_ef1234567890"
 */
export function metricIdToColumnAlias(metricId: string): string {
  return `metric_${metricId.replace(/-/g, "_")}`;
}

/**
 * Extract the original UUID from a column alias.
 * Handles both field_* and metric_* formats.
 *
 * @example
 * extractUUIDFromColumnAlias("field_dd05ef4b_1234_5678_abcd_ef1234567890")
 * // Returns: "dd05ef4b-1234-5678-abcd-ef1234567890"
 */
export function extractUUIDFromColumnAlias(columnAlias: string): string | null {
  const match = columnAlias.match(/^(?:field|metric)_(.+)$/);
  if (!match) return null;

  // Convert underscores back to hyphens in UUID format
  const uuidPart = match[1];
  if (!uuidPart) return null;
  // UUID format: 8-4-4-4-12 characters
  // With underscores: 8_4_4_4_12
  const parts = uuidPart.split("_");
  if (parts.length === 5) {
    return parts.join("-");
  }
  // Fallback: just replace all underscores (may not be exact UUID format)
  return uuidPart.replace(/_/g, "-");
}

// ============================================================================
// Metric SQL Expression
// ============================================================================

/**
 * Convert an InsightMetric to its SQL aggregation expression.
 *
 * This is the canonical format expected by vgplot/Mosaic for encoding values.
 * The expression matches the SQL aggregation syntax used in GROUP BY queries.
 *
 * @example
 * ```typescript
 * // Count all rows
 * metricToSqlExpression({ name: "Count", aggregation: "count" })
 * // Returns: "count(*)"
 *
 * // Count distinct values
 * metricToSqlExpression({ name: "Unique Users", aggregation: "count_distinct", columnName: "user_id" })
 * // Returns: "count_distinct(user_id)"
 *
 * // Standard aggregation
 * metricToSqlExpression({ name: "Total Sales", aggregation: "sum", columnName: "amount" })
 * // Returns: "sum(amount)"
 * ```
 */
export function metricToSqlExpression(metric: InsightMetric): string {
  const agg = metric.aggregation;

  // COUNT(*) - no column needed
  if (agg === "count" && !metric.columnName) {
    return "count(*)";
  }

  // COUNT(DISTINCT column) — unquoted: this string is consumed by vgplot's
  // parseEncodingValue DSL parser, which re-extracts the column name via regex
  // and passes it to Mosaic (which quotes on its own). Quoting here would
  // double-process the identifier and break the chart render.
  if (agg === "count_distinct" && metric.columnName) {
    return `count_distinct(${metric.columnName})`;
  }

  // Standard aggregation: SUM, AVG, MIN, MAX, COUNT — same reasoning as above.
  // The Mosaic API (api.sum(col), api.avg(col), etc.) quotes internally.
  return `${agg}(${metric.columnName ?? "*"})`;
}

/**
 * Options for building insight SQL.
 */
export interface BuildInsightSQLOptions {
  /**
   * Query mode:
   * - "model": Raw joined data without aggregations (for data preview)
   * - "query": Aggregated data with GROUP BY and metrics (for insight results)
   */
  mode: "model" | "query";
  /** Maximum number of rows to return */
  limit?: number;
  /** Number of rows to skip */
  offset?: number;
  /** Column to sort by */
  sortColumn?: string;
  /** Sort direction */
  sortDirection?: "asc" | "desc";
  /**
   * Effective filters resolved from per-cell overrides via `resolveEffectiveParams`.
   * When provided, REPLACES `insight.filters` for this query only — the insight
   * object is never mutated.  Used by dashboard cells to inject their per-cell
   * override params without modifying the shared insight definition.
   *
   * In "model" mode, filters are normally suppressed (raw-data preview).  When
   * `effectiveFilters` is explicitly supplied the caller has already coalesced the
   * cell override; the model-mode view for that cell SHOULD be filtered so the
   * Chart component aggregates on the correct data subset.
   */
  effectiveFilters?: InsightFilter[];
  /**
   * Effective sorts resolved from per-cell overrides via `resolveEffectiveParams`.
   * When provided, REPLACES `insight.sorts` for this query only.
   */
  effectiveSorts?: InsightSort[];
  /**
   * Effective row limit resolved from per-cell overrides via `resolveEffectiveParams`.
   * When provided, REPLACES both `options.limit` and the insight's own limit for
   * this query only.
   */
  effectiveLimit?: number;
}

/**
 * Shortens auto-generated table names by removing UUIDs and file extensions.
 *
 * Examples:
 * - "sales_data_a1b2c3d4-e5f6-7890-abcd-ef1234567890.csv" -> "sales_data"
 * - "customers_12345678-1234-1234-1234-123456789012_v2" -> "customers_v2"
 */
export function shortenAutoGeneratedName(name: string): string {
  let cleaned = name.replace(/\.(csv|xlsx|json)$/i, "");
  cleaned = cleaned.replace(
    /[_-]?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[_-]?/gi,
    "",
  );
  cleaned = cleaned.replace(/[_-]\d+$/, "");
  // eslint-disable-next-line sonarjs/slow-regex
  cleaned = cleaned.replace(/(^_+)|(_+$)/g, "");
  return cleaned || name;
}

/**
 * Generates the DuckDB table name from a dataFrameId.
 * Format: df_<uuid_with_underscores>
 */
export function getTableName(dataFrameId: string): string {
  return `df_${dataFrameId.replace(/-/g, "_")}`;
}

/**
 * Builds SQL for an insight query.
 *
 * Two modes:
 * 1. Model mode: Shows raw joined data without aggregations
 * 2. Query mode: Applies GROUP BY, aggregations, and metrics
 *
 * @param baseTable - The base table for the query
 * @param joinedTables - Map of rightTableId -> DataTable for joined tables
 * @param insight - The insight configuration (selectedFields, metrics, joins)
 * @param options - Query options (mode, limit, offset, sort)
 * @returns SQL string or null if baseTable has no dataFrameId
 * @throws {Error} if any filter value is a non-finite number (NaN, Infinity, -Infinity),
 *   if a join type is not one of inner/left/right/full,
 *   if a metric aggregation is not one of sum/avg/count/min/max/count_distinct,
 *   if sortDirection is not "asc" or "desc",
 *   or if limit/offset is not a non-negative integer.
 *
 * @example
 * ```typescript
 * const sql = buildInsightSQL(
 *   baseTable,
 *   new Map([[joinTableId, joinTable]]),
 *   insight,
 *   { mode: "query", limit: 100 }
 * );
 * ```
 */

/**
 * Resolve a sort field name (column name, e.g. "region") to its UUID column
 * alias (e.g. "field_<uuid>") using the table's field list.  Falls back to the
 * raw field name if no matching field is found (e.g. a metric alias) — the
 * `appendPagination` validator will silently drop an unrecognised sort column.
 */
function resolveSortColumnAlias(
  fieldName: string,
  tableFields: Field[],
): string {
  const f = tableFields
    .filter((field) => !field.name.startsWith("_"))
    .find((field) => (field.columnName ?? field.name) === fieldName);
  return f ? fieldIdToColumnAlias(f.id) : fieldName;
}

/**
 * Merge effective limit and effective sorts (from per-cell overrides) into the
 * caller-supplied `BuildInsightSQLOptions`.
 *
 * `appendPagination` drives ORDER BY from `options.sortColumn/sortDirection`,
 * not from `insight.sorts`.  When the caller has already set `sortColumn` (e.g.
 * a user-triggered interactive sort), we leave it alone — the interactive sort
 * wins.  Otherwise the first effective sort is mapped to those scalar fields.
 */
function buildEffectiveOptions(
  options: BuildInsightSQLOptions,
  effectiveLimit: number | undefined,
  effectiveSorts: InsightSort[] | undefined,
  tableFields: Field[],
): BuildInsightSQLOptions {
  if (effectiveLimit === undefined && !effectiveSorts?.length) {
    return options;
  }
  const firstSort = effectiveSorts?.[0];
  const sortOverride =
    firstSort && !options.sortColumn
      ? {
          sortColumn: resolveSortColumnAlias(firstSort.field, tableFields),
          sortDirection: firstSort.direction,
        }
      : undefined;
  return {
    ...options,
    ...(effectiveLimit !== undefined && { limit: effectiveLimit }),
    ...sortOverride,
  };
}

export function buildInsightSQL(
  baseTable: DataTable,
  joinedTables: Map<UUID, DataTable>,
  insight: Insight,
  options: BuildInsightSQLOptions,
): string | null {
  const { mode, effectiveFilters, effectiveSorts, effectiveLimit } = options;

  if (!baseTable.dataFrameId) return null;

  // When the caller has pre-resolved effective params (e.g. dashboard cell with
  // per-cell overrides), coalesce them onto a shallow copy of the insight so that
  // every downstream helper sees the already-merged values.  The original `insight`
  // is NEVER mutated — this is a local shadow only.
  const effectiveInsight: Insight =
    effectiveFilters !== undefined ||
    effectiveSorts !== undefined ||
    effectiveLimit !== undefined
      ? {
          ...insight,
          ...(effectiveFilters !== undefined && {
            filters: effectiveFilters,
          }),
          ...(effectiveSorts !== undefined && { sorts: effectiveSorts }),
        }
      : insight;

  // Fail-closed: validate filter values before any SQL is generated.
  // When effectiveFilters is provided it replaces insight.filters; validate
  // whichever set will actually be used so non-finite numbers are rejected with
  // a field-aware error message regardless of the input path.
  validateEffectiveFilters(effectiveFilters ?? insight.filters);

  // Build effective options: fold `effectiveLimit` and `effectiveSorts` into the
  // options object used by downstream helpers.
  //
  // `appendPagination` reads `options.sortColumn/sortDirection`, NOT `insight.sorts`,
  // so we map the first effective sort to those scalar fields when no caller-supplied
  // sort is already set.  The mapping is done by a dedicated helper to keep this
  // function within the complexity budget.
  const effectiveOptions = buildEffectiveOptions(
    options,
    effectiveLimit,
    effectiveSorts,
    baseTable.fields ?? [],
  );

  const baseDFTable = getTableName(baseTable.dataFrameId);
  const baseDisplayName = shortenAutoGeneratedName(baseTable.name);
  const baseFields = (baseTable.fields ?? []).filter(
    (f) => !f.name.startsWith("_"),
  );

  // No joins: simple query on base table with alias
  if (!effectiveInsight.joins?.length) {
    return buildSimpleSQL(
      baseDFTable,
      baseDisplayName,
      baseFields,
      effectiveInsight,
      effectiveOptions,
    );
  }

  // Build joined SQL
  const joined = buildJoinedSQL(
    baseDFTable,
    baseDisplayName,
    baseFields,
    effectiveInsight,
    joinedTables,
  );

  if (!joined) return null;

  // `availableFields` is the exact column set present in the joined subquery —
  // dropped right join-keys are already excluded. Using it (rather than the raw
  // union of all table fields) ensures a filter can only resolve to a column
  // that actually exists in the FROM clause; anything else is safely skipped.
  const allFields = joined.availableFields;

  // Re-resolve effective options against the full joined field list so that sort
  // overrides referencing a joined-table column resolve to the correct UUID alias
  // (the initial call used only baseTable.fields, which excludes joined columns).
  const joinedEffectiveOptions = buildEffectiveOptions(
    options,
    effectiveLimit,
    effectiveSorts,
    allFields,
  );

  // Model mode: raw data without aggregations.
  // When `effectiveFilters` was supplied, the caller is a dashboard cell that
  // needs its overridden filters applied even in model mode (so the Chart
  // aggregates on the correct data subset).  When NOT supplied (the standard
  // insight-preview / useInsightView path) filters are suppressed as before —
  // previews show raw rows.
  if (mode === "model") {
    // Build set of valid column names from all fields (no metrics in model mode)
    const validColumns = new Set(allFields.map((f) => f.columnName ?? f.name));

    if (effectiveFilters !== undefined && effectiveFilters.length > 0) {
      // Apply the effective filters in alias mode: the joined subquery already
      // has UUID-aliased columns, so WHERE must reference those aliases.
      const fieldIdMap = buildFieldIdMap(allFields);
      const { whereClause } = buildFilterClauses(
        effectiveInsight,
        fieldIdMap,
        false, // no aggregation in model mode → all filters go to WHERE
        "alias",
      );
      const base = `SELECT * FROM ${joined.sql}`;
      return appendPagination(
        whereClause ? `${base} ${whereClause}` : base,
        joinedEffectiveOptions,
        validColumns,
      );
    }

    return appendPagination(
      `SELECT * FROM ${joined.sql}`,
      joinedEffectiveOptions,
      validColumns,
    );
  }

  // Apply aggregations with all available fields
  return buildAggregatedSQL(
    joined.sql,
    allFields,
    effectiveInsight,
    joinedEffectiveOptions,
  );
}

/**
 * Builds SQL for a simple query without joins.
 *
 * In model mode, wraps the table with UUID-aliased columns for consistency
 * with joined queries. This ensures Chart components always receive the same
 * column format regardless of whether joins exist.
 */
function buildSimpleSQL(
  tableName: string,
  displayName: string,
  baseFields: Field[],
  insight: Insight,
  options: BuildInsightSQLOptions,
): string {
  const { mode } = options;

  // Model mode or no configuration: return all rows with UUID aliases
  if (
    mode === "model" ||
    (!insight.selectedFields?.length && !insight.metrics?.length)
  ) {
    // Build SELECT with UUID aliases for consistency
    const selectParts = buildFieldSelects(displayName, baseFields);
    const validColumns = new Set(
      baseFields.map((f) => fieldIdToColumnAlias(f.id)),
    );

    // Filters apply in QUERY mode OR when the caller has explicitly supplied
    // effective filters (e.g. a dashboard cell with per-cell overrides building
    // a filtered model view for the Chart).  Plain model-mode preview (no
    // effectiveFilters) still shows raw source rows.
    let whereClause = "";
    if (mode === "query" || options.effectiveFilters !== undefined) {
      // No GROUP BY in this path → all filters map to WHERE. The FROM is the raw
      // base table, whose columns still carry their source names — resolve refs
      // against raw column names ("raw" mode).
      const fieldIdMap = buildFieldIdMap(baseFields);
      ({ whereClause } = buildFilterClauses(insight, fieldIdMap, false, "raw"));
    }

    let sql = `SELECT ${selectParts.join(", ")} FROM ${tableName} AS ${quoteIdentifier(displayName)}`;
    if (whereClause) {
      sql += ` ${whereClause}`;
    }

    return appendPagination(sql, options, validColumns);
  }

  // Query mode with configuration: wrap table with UUID aliases, then apply aggregations
  // This ensures the FROM clause for aggregation has UUID-aliased columns
  const selectParts = buildFieldSelects(displayName, baseFields);
  const wrappedFromClause = `(SELECT ${selectParts.join(", ")} FROM ${tableName} AS ${quoteIdentifier(displayName)})`;

  return buildAggregatedSQL(wrappedFromClause, baseFields, insight, options);
}

// ============================================================================
// Join SQL Helpers
// ============================================================================

/** Find a field by its column name (or name fallback) */
function findFieldByColumnName(
  fields: Field[],
  columnName: string,
): Field | undefined {
  return fields.find((f) => (f.columnName ?? f.name) === columnName);
}

/**
 * Build SELECT part for a column using UUID-based alias.
 * Format: "tableName"."columnName" AS "field_<uuid>"
 *
 * No collision handling needed - UUIDs are globally unique.
 */
function buildColumnSelectWithFieldId(
  tableName: string,
  columnName: string,
  fieldId: string,
): string {
  const alias = fieldIdToColumnAlias(fieldId);
  // alias is a generated UUID-based name (field_<uuid>) — safe as-is; tableName
  // and columnName may contain " from user-controlled data and must be quoted.
  return `${quoteIdentifier(tableName)}.${quoteIdentifier(columnName)} AS "${alias}"`;
}

/** Build SELECT parts for all fields from a table using UUID aliases */
function buildFieldSelects(tableName: string, fields: Field[]): string[] {
  return fields.map((field) => {
    const columnName = field.columnName ?? field.name;
    return buildColumnSelectWithFieldId(tableName, columnName, field.id);
  });
}

/**
 * Builds the JOIN SQL using UUID-based column aliases.
 * No collision handling needed - UUIDs are globally unique.
 *
 * The first step wraps the base table with UUID aliases, then subsequent joins
 * can reference columns by their UUID alias names.
 */
function buildJoinedSQL(
  baseDFTable: string,
  baseDisplayName: string,
  baseFields: Field[],
  insight: Insight,
  joinedTables: Map<UUID, DataTable>,
): { sql: string; availableFields: Field[] } | null {
  // First, wrap base table with UUID-aliased columns
  const baseSelects = buildFieldSelects(baseDisplayName, baseFields);
  let currentSQL = `(SELECT ${baseSelects.join(", ")} FROM ${baseDFTable} AS ${quoteIdentifier(baseDisplayName)})`;
  let currentFields = baseFields;

  for (const join of insight.joins ?? []) {
    const joinResult = processSingleJoin(
      join,
      joinedTables,
      currentSQL,
      baseDisplayName,
      currentFields,
    );

    if (joinResult) {
      currentSQL = joinResult.sql;
      // Accumulate fields from all joined tables for subsequent joins.
      // `joinResult.allFields` excludes dropped right join-keys, so it is the
      // accurate set of columns actually present in `currentSQL`.
      currentFields = joinResult.allFields;
    }
  }

  // `currentFields` is the exact column set in the emitted subquery — dropped
  // join keys are already excluded. Returning it lets callers build a field map
  // that matches the FROM clause, so filters can't reference a missing column.
  return { sql: currentSQL, availableFields: currentFields };
}

/** Result from processing a single join */
interface JoinResult {
  sql: string;
  allFields: Field[];
  displayName: string;
}

/**
 * Process a single join and return the updated SQL with UUID-based column aliases.
 * Returns null if join is invalid.
 */
function processSingleJoin(
  join: NonNullable<Insight["joins"]>[number],
  joinedTables: Map<UUID, DataTable>,
  currentSQL: string,
  currentDisplayName: string,
  currentFields: Field[],
): JoinResult | null {
  // Validate join table
  const joinTable = joinedTables.get(join.rightTableId);
  if (!joinTable) {
    console.warn(`Join table ${join.rightTableId} not found in joinedTables`);
    return null;
  }
  if (!joinTable.dataFrameId) {
    console.warn(`Join table ${joinTable.name} has no dataFrameId`);
    return null;
  }

  // Get join table metadata
  const joinDFTable = getTableName(joinTable.dataFrameId);
  const joinDisplayName = shortenAutoGeneratedName(joinTable.name);
  const joinFields = (joinTable.fields ?? []).filter(
    (f) => !f.name.startsWith("_"),
  );

  // Find and validate join keys
  const currentKeyField = findFieldByColumnName(currentFields, join.leftKey);
  const joinKeyField = findFieldByColumnName(joinFields, join.rightKey);
  if (!currentKeyField || !joinKeyField) {
    console.warn(
      `Join key fields not found: ${join.leftKey}, ${join.rightKey}`,
    );
    return null;
  }

  const rightColName = joinKeyField.columnName ?? joinKeyField.name;

  // Build SELECT parts using UUID-based aliases
  // For the left side, use the field alias (field_<uuid>) since it's already aliased
  const leftKeyAlias = fieldIdToColumnAlias(currentKeyField.id);

  // Validate join type early so we can use it for the key-projection decision.
  const rawJoinType = join.type ?? "inner";
  if (!JOIN_TYPE_WHITELIST_CONST.has(rawJoinType)) {
    throw new Error(
      `processSingleJoin: invalid join type "${rawJoinType}" — must be one of: inner, left, right, full`,
    );
  }
  const joinTypeSQL = rawJoinType.toUpperCase();

  // For INNER/LEFT joins the left key is always non-null when a row appears, so
  // a bare reference is safe.  For RIGHT/FULL joins an unmatched right-side row
  // has NULL in the left key while the discarded right key carries the real
  // value.  We project COALESCE(left_key_alias, right_table.right_col) so the
  // result is always non-null for any matched or unmatched row.
  const isRightOrFull = rawJoinType === "right" || rawJoinType === "full";
  const baseSelects = currentFields.map((field) => {
    const alias = fieldIdToColumnAlias(field.id);
    if (isRightOrFull && alias === leftKeyAlias) {
      // COALESCE to pick up the right-side key for unmatched right-only rows.
      return `COALESCE("${leftKeyAlias}", ${quoteIdentifier(joinDisplayName)}.${quoteIdentifier(rightColName)}) AS "${leftKeyAlias}"`;
    }
    return `"${alias}"`;
  });

  // For the right side, select with UUID aliases (excluding join key to avoid duplication)
  const joinSelects = joinFields
    .filter((f) => {
      const colName = f.columnName ?? f.name;
      return colName !== rightColName;
    })
    .map((field) => {
      const columnName = field.columnName ?? field.name;
      return buildColumnSelectWithFieldId(
        joinDisplayName,
        columnName,
        field.id,
      );
    });

  const selectParts = [...baseSelects, ...joinSelects];

  // Build JOIN SQL using the UUID alias for the join condition.
  const sql = `(
    SELECT ${selectParts.join(", ")}
    FROM ${currentSQL}
    ${joinTypeSQL} JOIN ${joinDFTable} AS ${quoteIdentifier(joinDisplayName)}
    ON "${leftKeyAlias}" = ${quoteIdentifier(joinDisplayName)}.${quoteIdentifier(rightColName)}
  )`;

  // Combine all fields for subsequent joins (excluding duplicate join key)
  const allFields = [
    ...currentFields,
    ...joinFields.filter((f) => {
      const colName = f.columnName ?? f.name;
      return colName !== rightColName;
    }),
  ];

  return { sql, allFields, displayName: joinDisplayName };
}

// ============================================================================
// Filter Clause Helpers
// ============================================================================

/**
 * Quote a scalar value for safe SQL embedding.
 *
 * - Booleans are emitted as-is (`true`/`false`).
 * - Finite numbers are emitted as-is. Non-finite numbers (NaN, Infinity, -Infinity)
 *   throw — they cannot be represented as SQL literals and indicate a bad caller input.
 * - Strings are single-quoted with internal single-quotes escaped by doubling
 *   (standard SQL escaping: `'` → `''`). This matches the convention used in
 *   the rest of this module (no parameterized placeholders — values are inlined
 *   at query-build time, not at the DB driver level).
 * - null / undefined → `NULL`.
 * - Anything else is coerced to string and then quoted.
 * @throws {Error} if val is a non-finite number.
 */
function quoteValue(val: unknown): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return String(val);
  if (typeof val === "number") {
    if (!Number.isFinite(val)) {
      throw new Error(
        `quoteValue: non-finite number (${val}) cannot be embedded in SQL`,
      );
    }
    return String(val);
  }
  // For everything else (string, Date.toISOString output, etc.) single-quote and escape
  const str = String(val);
  // Escape single quotes by doubling them (standard SQL)
  return `'${str.replace(/'/g, "''")}'`;
}

/**
 * Validate a filter value fail-closed: throw if it contains a non-finite number.
 * Called at effectiveFilters coalesce time so bad values are rejected before SQL generation.
 */
function validateFilterValue(value: unknown, field: string): void {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(
      `validateFilterValue: non-finite number (${value}) in filter on field "${field}"`,
    );
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      validateFilterValue(item, field);
    }
  }
  if (
    value !== null &&
    typeof value === "object" &&
    "low" in value &&
    "high" in value
  ) {
    validateFilterValue((value as { low: unknown }).low, field);
    validateFilterValue((value as { high: unknown }).high, field);
  }
}

/**
 * Validate all filters in an effectiveFilters array. No-op when undefined.
 * Extracted to keep buildInsightSQL within the sonarjs cognitive-complexity budget.
 */
function validateEffectiveFilters(
  effectiveFilters: InsightFilter[] | undefined,
): void {
  if (effectiveFilters === undefined) return;
  for (const f of effectiveFilters) {
    validateFilterValue(f.value, f.field);
  }
}

/**
 * Build a single SQL predicate from an InsightFilter.
 *
 * The `columnRef` is the already-resolved SQL column reference (possibly
 * quoted as `"field_<uuid>"` or a raw column name — caller decides).
 */
function buildFilterPredicate(
  columnRef: string,
  filter: InsightFilter,
): string {
  const { operator, value } = filter;

  switch (operator) {
    case "eq":
      // `= NULL` is always false in SQL — use IS NULL for null equality.
      if (value === null || value === undefined) return `${columnRef} IS NULL`;
      return `${columnRef} = ${quoteValue(value)}`;
    case "ne":
      if (value === null || value === undefined)
        return `${columnRef} IS NOT NULL`;
      return `${columnRef} <> ${quoteValue(value)}`;
    case "gt":
      return `${columnRef} > ${quoteValue(value)}`;
    case "gte":
      return `${columnRef} >= ${quoteValue(value)}`;
    case "lt":
      return `${columnRef} < ${quoteValue(value)}`;
    case "lte":
      return `${columnRef} <= ${quoteValue(value)}`;
    case "contains": {
      // LIKE '%value%' — escape the value's own % and _ to prevent wildcards
      const escaped = String(value ?? "")
        .replace(/\\/g, "\\\\")
        .replace(/%/g, "\\%")
        .replace(/_/g, "\\_")
        .replace(/'/g, "''");
      return `${columnRef} LIKE '%${escaped}%' ESCAPE '\\'`;
    }
    case "in": {
      const arr = Array.isArray(value) ? value : [value];
      if (arr.length === 0) return "1=0"; // empty IN → always false
      return `${columnRef} IN (${arr.map(quoteValue).join(", ")})`;
    }
    case "between": {
      // Guard the value shape: a malformed `between` value (null, missing
      // bound) must not throw or silently filter every row. Emit an always-true
      // predicate and warn — a no-op is safer than dropping all rows.
      if (
        value === null ||
        typeof value !== "object" ||
        !("low" in value) ||
        !("high" in value)
      ) {
        // Warn on shape only — never log the value itself: filter values can be
        // sensitive literals and must not leak into logs (privacy invariant).
        console.warn(
          `between filter has malformed value (expected { low, high }); received ${value === null ? "null" : typeof value}`,
        );
        return "1=1";
      }
      const bv = value as InsightFilterBetweenValue;
      return `${columnRef} BETWEEN ${quoteValue(bv.low)} AND ${quoteValue(bv.high)}`;
    }
    default: {
      // Exhaustiveness guard — TypeScript should catch this, but guard at runtime too
      const _exhaustive: never = operator;
      console.warn(`Unknown filter operator: ${String(_exhaustive)}`);
      return "1=1";
    }
  }
}

/**
 * How to render the SQL column reference for a filter field.
 *
 * - `"alias"`: reference the UUID alias (`"field_<uuid>"`). Use when the FROM
 *   clause is a wrapped subquery whose columns are already UUID-aliased (the
 *   aggregated / joined path).
 * - `"raw"`: reference the source column name (`"columnName"`). Use when the
 *   FROM clause is the raw base table whose columns still have their original
 *   names (the model / no-config simple path) — UUID aliases there are
 *   SELECT-only and not portably usable in WHERE.
 */
type FilterColumnRefMode = "alias" | "raw";

/**
 * Derive the SQL column reference for a filter field.
 *
 * Filters reference fields by their source column name (`Field.columnName ?? Field.name`).
 * We look up the matching field to resolve either its UUID alias or its raw
 * column name depending on `refMode`.
 *
 * Returns `null` when no field in `fieldIdMap` matches the filter field. That
 * is the fail-safe signal: the column is NOT present in the FROM clause (e.g. a
 * filter targeting a joined table's right-key, which `processSingleJoin` drops
 * from the joined subquery). Emitting a reference to a missing column would make
 * the whole query fail at runtime, so the caller skips the filter instead.
 */
function resolveFilterColumnRef(
  filterField: string,
  fieldIdMap: Map<string, Field>,
  refMode: FilterColumnRefMode,
): string | null {
  const field = Array.from(fieldIdMap.values()).find(
    (f) => (f.columnName ?? f.name) === filterField,
  );
  if (!field) return null;
  if (refMode === "alias") {
    return `"${fieldIdToColumnAlias(field.id)}"`;
  }
  return `"${field.columnName ?? field.name}"`;
}

/**
 * Resolve a metric filter to the aggregate SQL expression used in HAVING.
 *
 * The filter `field` matches either a metric's source `columnName` or its
 * output alias (`metric_<uuid>`). We rebuild the aggregate expression
 * (e.g. `SUM("field_<uuid>")`, `COUNT(*)`) so HAVING references the aggregate,
 * not the (out-of-scope post-aggregation) raw column.
 *
 * Falls back to the quoted filter field if no metric matches (shouldn't happen
 * since this is only called when `isMetricFilter` is true).
 */
function resolveMetricAggRef(
  filterField: string,
  insight: Insight,
  fieldIdMap: Map<string, Field>,
): string {
  const metric = (insight.metrics ?? []).find(
    (m) =>
      m.columnName === filterField ||
      metricIdToColumnAlias(m.id) === filterField,
  );
  if (!metric) return quoteIdentifier(filterField);

  if (!AGG_WHITELIST_CONST.has(metric.aggregation)) {
    throw new Error(
      `resolveMetricAggRef: invalid aggregation "${metric.aggregation}" — must be one of: sum, avg, count, min, max, count_distinct`,
    );
  }
  const aggFn = metric.aggregation.toUpperCase();

  // COUNT(*) - no column
  if (metric.aggregation === "count" && !metric.columnName) {
    return "COUNT(*)";
  }

  if (!metric.columnName) return quoteIdentifier(filterField);

  // Resolve the source column to its UUID alias (columns are aliased upstream)
  const sourceField = Array.from(fieldIdMap.values()).find(
    (f) => (f.columnName ?? f.name) === metric.columnName,
  );
  const sourceRef = sourceField
    ? fieldIdToColumnAlias(sourceField.id)
    : metric.columnName;

  if (metric.aggregation === "count_distinct") {
    return `COUNT(DISTINCT ${quoteIdentifier(sourceRef)})`;
  }

  return `${aggFn}(${quoteIdentifier(sourceRef)})`;
}

/**
 * Determine whether a filter targets a dimension (grouped field) or a metric.
 *
 * A filter field is a **dimension** when the insight's `selectedFields` list
 * contains the ID of a Field whose column name matches the filter field.
 *
 * A filter field is a **metric** when the insight's `metrics` list references
 * a column whose name matches the filter field, OR when the filter field name
 * matches a metric's output alias (`metric_<uuid>`).
 *
 * **Dimension membership takes precedence.** If a column is both selected as a
 * grouped dimension and used as a metric's source column, the dimension reading
 * wins — the grouped value is in scope pre-aggregation, so the filter routes to
 * WHERE. (A metric still aggregates the same source column independently.)
 *
 * Everything else defaults to dimension (pre-aggregation WHERE).
 */
function isMetricFilter(
  filter: InsightFilter,
  insight: Insight,
  fieldIdMap: Map<string, Field>,
): boolean {
  // Dimension membership wins: if the field is a selected (grouped) dimension,
  // it is NOT a metric filter, even if the same column also feeds a metric.
  for (const fieldId of insight.selectedFields ?? []) {
    const field = fieldIdMap.get(fieldId);
    if (field && (field.columnName ?? field.name) === filter.field) {
      return false; // explicitly a dimension
    }
  }

  // Otherwise, a match against a metric column or metric output alias → metric.
  for (const metric of insight.metrics ?? []) {
    if (metric.columnName === filter.field) return true;
    if (metricIdToColumnAlias(metric.id) === filter.field) return true;
  }

  // Default: treat as dimension (pre-aggregation)
  return false;
}

/**
 * Build WHERE and HAVING clauses from insight filters.
 *
 * Routing logic (compile-time, derived from insight definition):
 * - Filter on a grouped dimension → WHERE  (pre-aggregation)
 * - Filter on a metric            → HAVING (post-aggregation)
 *
 * Returns empty strings when there are no filters of that kind.
 */
function buildFilterClauses(
  insight: Insight,
  fieldIdMap: Map<string, Field>,
  hasAggregation: boolean,
  refMode: FilterColumnRefMode,
): { whereClause: string; havingClause: string } {
  const filters = insight.filters ?? [];
  if (filters.length === 0) return { whereClause: "", havingClause: "" };

  const wherePredicates: string[] = [];
  const havingPredicates: string[] = [];

  for (const filter of filters) {
    // A metric filter routes to HAVING only when the query actually aggregates.
    // Aggregation happens whenever metrics are present — with OR without a
    // GROUP BY (a metrics-only insight emits e.g. COUNT(*) and still needs
    // HAVING, not WHERE, for a predicate on the aggregate).
    const isMetric =
      hasAggregation && isMetricFilter(filter, insight, fieldIdMap);

    if (isMetric) {
      // HAVING: reference the aggregate expression (e.g. SUM("field_<uuid>")),
      // since the raw metric column is not in scope post-aggregation.
      const aggRef = resolveMetricAggRef(filter.field, insight, fieldIdMap);
      havingPredicates.push(buildFilterPredicate(aggRef, filter));
    } else {
      const columnRef = resolveFilterColumnRef(
        filter.field,
        fieldIdMap,
        refMode,
      );
      if (columnRef === null) {
        // Fail-safe: the filter field is not a column present in the FROM
        // clause (e.g. a joined table's right-key, dropped from the joined
        // subquery). Emitting `WHERE "missing_col" = …` would crash the whole
        // query at runtime, so skip this filter and warn — a dropped filter is
        // recoverable; a broken query is not. Warn on the field name only, never
        // the value (privacy: filter values must not reach logs).
        console.warn(
          `Filter on field "${filter.field}" skipped — column not present in query result set (e.g. a dropped join key).`,
        );
        continue;
      }
      wherePredicates.push(buildFilterPredicate(columnRef, filter));
    }
  }

  const whereClause =
    wherePredicates.length > 0 ? `WHERE ${wherePredicates.join(" AND ")}` : "";
  const havingClause =
    havingPredicates.length > 0
      ? `HAVING ${havingPredicates.join(" AND ")}`
      : "";

  return { whereClause, havingClause };
}

// ============================================================================
// Aggregation SQL Helpers
// ============================================================================

/** Build a map from field ID to Field */
function buildFieldIdMap(fields: Field[]): Map<string, Field> {
  const map = new Map<string, Field>();
  for (const field of fields) {
    map.set(field.id, field);
  }
  return map;
}

/**
 * Build dimension column parts (SELECT and GROUP BY) from selected field IDs.
 *
 * Output uses UUID-based aliases:
 * - SELECT: `"field_<uuid>"` (passthrough since source already has this alias)
 * - GROUP BY: `"field_<uuid>"`
 * - Valid columns: `field_<uuid>` (for pagination sorting)
 */
function buildDimensionColumns(
  selectedFieldIds: string[],
  fieldIdMap: Map<string, Field>,
): { selectParts: string[]; groupByParts: string[]; columnAliases: string[] } {
  const selectParts: string[] = [];
  const groupByParts: string[] = [];
  const columnAliases: string[] = [];

  for (const fieldId of selectedFieldIds) {
    const field = fieldIdMap.get(fieldId);
    if (field) {
      const alias = fieldIdToColumnAlias(fieldId);
      // Source column already has UUID alias, just reference it
      selectParts.push(`"${alias}"`);
      groupByParts.push(`"${alias}"`);
      columnAliases.push(alias);
    }
  }

  return { selectParts, groupByParts, columnAliases };
}

/**
 * Build SQL expression for a single metric aggregation with UUID alias.
 *
 * @param metric - The metric configuration
 * @param fieldIdMap - Map of field ID to Field for resolving source column
 *
 * Output format: `AGG("source_column") AS "metric_<uuid>"`
 *
 * Note: When aggregating from a joined view, the source column is already aliased
 * as `field_<uuid>`. We need to look up the field by columnName to get its UUID.
 */
function buildMetricExpressionWithUUID(
  metric: NonNullable<Insight["metrics"]>[number],
  fieldIdMap: Map<string, Field>,
): string | null {
  if (!AGG_WHITELIST_CONST.has(metric.aggregation)) {
    throw new Error(
      `buildMetricExpressionWithUUID: invalid aggregation "${metric.aggregation}" — must be one of: sum, avg, count, min, max, count_distinct`,
    );
  }
  const aggFn = metric.aggregation.toUpperCase();
  const outputAlias = metricIdToColumnAlias(metric.id);

  // COUNT(*) - no column needed
  if (metric.aggregation === "count" && !metric.columnName) {
    return `COUNT(*) AS "${outputAlias}"`;
  }

  if (!metric.columnName) return null;

  // Find the source field by columnName to get its UUID alias
  let sourceColumnRef: string;
  const sourceField = Array.from(fieldIdMap.values()).find(
    (f) => (f.columnName ?? f.name) === metric.columnName,
  );

  if (sourceField) {
    // Source is a field with UUID alias
    sourceColumnRef = fieldIdToColumnAlias(sourceField.id);
  } else {
    // Fallback: use raw column name (shouldn't happen with proper config)
    sourceColumnRef = metric.columnName;
  }

  // COUNT(DISTINCT column)
  if (metric.aggregation === "count_distinct") {
    return `COUNT(DISTINCT "${sourceColumnRef}") AS "${outputAlias}"`;
  }

  // Standard aggregation: SUM, AVG, MIN, MAX, COUNT
  return `${aggFn}("${sourceColumnRef}") AS "${outputAlias}"`;
}

/** Build SELECT parts for all metrics with UUID aliases */
function buildMetricColumnsWithUUID(
  metrics: NonNullable<Insight["metrics"]>,
  fieldIdMap: Map<string, Field>,
): { selectParts: string[]; columnAliases: string[] } {
  const selectParts: string[] = [];
  const columnAliases: string[] = [];

  for (const metric of metrics) {
    const expr = buildMetricExpressionWithUUID(metric, fieldIdMap);
    if (expr) {
      selectParts.push(expr);
      columnAliases.push(metricIdToColumnAlias(metric.id));
    }
  }

  return { selectParts, columnAliases };
}

/**
 * Builds aggregated SQL with GROUP BY and metrics using UUID column aliases.
 *
 * All output columns use UUID-based naming:
 * - Dimensions: `field_<uuid>`
 * - Metrics: `metric_<uuid>`
 *
 * The source FROM clause already has UUID-aliased columns from model SQL.
 */
function buildAggregatedSQL(
  fromClause: string,
  allFields: Field[],
  insight: Insight,
  options: BuildInsightSQLOptions,
): string {
  const hasSelectedFields = (insight.selectedFields?.length ?? 0) > 0;
  const hasMetrics = (insight.metrics?.length ?? 0) > 0;

  // Build field map for lookups
  const fieldIdMap = buildFieldIdMap(allFields);

  // No configuration: fall back to raw data (all fields with UUID aliases)
  if (!hasSelectedFields && !hasMetrics) {
    // Valid columns are UUID aliases
    const validColumns = new Set(
      allFields.map((f) => fieldIdToColumnAlias(f.id)),
    );
    // No GROUP BY here, so all filters map to WHERE. The fromClause is a wrapped
    // subquery whose columns are already UUID-aliased → use "alias" refMode.
    const { whereClause } = buildFilterClauses(
      insight,
      fieldIdMap,
      false,
      "alias",
    );
    let sql = `SELECT * FROM ${fromClause}`;
    if (whereClause) {
      sql += ` ${whereClause}`;
    }
    return appendPagination(sql, options, validColumns);
  }

  // Build dimension columns with UUID aliases
  const {
    selectParts: dimensionSelects,
    groupByParts,
    columnAliases: dimensionAliases,
  } = hasSelectedFields
    ? buildDimensionColumns(insight.selectedFields!, fieldIdMap)
    : { selectParts: [], groupByParts: [], columnAliases: [] };

  // Build metric columns with UUID aliases
  const { selectParts: metricSelects, columnAliases: metricAliases } =
    hasMetrics
      ? buildMetricColumnsWithUUID(insight.metrics!, fieldIdMap)
      : { selectParts: [], columnAliases: [] };

  // Combine SELECT parts
  const selectParts = [...dimensionSelects, ...metricSelects];

  // Build set of valid columns for sorting (all use UUID aliases now)
  const validColumns = new Set<string>([...dimensionAliases, ...metricAliases]);

  // Build filter clauses (WHERE for dimension filters, HAVING for metric filters).
  // Dimension-vs-metric is derived at compile time from the insight definition:
  // a filter field that matches a metric column → HAVING (post-aggregation),
  // everything else → WHERE (pre-aggregation). The query aggregates whenever
  // metrics are present (with or without GROUP BY), so that gates HAVING.
  const hasGroupBy = groupByParts.length > 0;
  const { whereClause, havingClause } = buildFilterClauses(
    insight,
    fieldIdMap,
    hasMetrics,
    "alias",
  );

  // Build final SQL
  let sql = `SELECT ${selectParts.join(", ")} FROM ${fromClause}`;

  if (whereClause) {
    sql += ` ${whereClause}`;
  }

  if (hasGroupBy) {
    sql += ` GROUP BY ${groupByParts.join(", ")}`;
  }

  if (havingClause) {
    sql += ` ${havingClause}`;
  }

  return appendPagination(sql, options, validColumns);
}

// Module-level whitelist constants — defined once, shared across all guard sites.
// Centralised here so a future AggregationType addition requires a single edit.
const SORT_DIRECTION_WHITELIST = new Set<string>(["asc", "desc"]);
const JOIN_TYPE_WHITELIST_CONST = new Set<string>([
  "inner",
  "left",
  "right",
  "full",
]);
const AGG_WHITELIST_CONST = new Set<string>([
  "sum",
  "avg",
  "count",
  "min",
  "max",
  "count_distinct",
]);

/**
 * Appends ORDER BY, LIMIT, and OFFSET clauses to SQL.
 *
 * @param sql - The base SQL query
 * @param options - Query options including sort, limit, offset
 * @param validColumns - Set of column names that exist in the query result.
 *                       sortColumn must be in this set to be applied.
 *                       This prevents sorting by metric columns that don't exist in model mode.
 */
function appendPagination(
  sql: string,
  options: BuildInsightSQLOptions,
  validColumns: Set<string>,
): string {
  const { sortColumn, sortDirection, limit, offset } = options;

  // Only apply ORDER BY if sortColumn exists in valid columns
  // This prevents errors when sorting by metric columns in model mode
  if (sortColumn && sortDirection) {
    if (!SORT_DIRECTION_WHITELIST.has(sortDirection)) {
      throw new Error(
        `appendPagination: invalid sortDirection "${sortDirection}" — must be "asc" or "desc"`,
      );
    }
    if (validColumns.has(sortColumn)) {
      sql += ` ORDER BY ${quoteIdentifier(sortColumn)} ${sortDirection.toUpperCase()}`;
    }
  }
  if (limit !== undefined) {
    if (!Number.isInteger(limit) || limit < 0 || !Number.isFinite(limit)) {
      throw new Error(
        `appendPagination: invalid limit "${limit}" — must be a non-negative integer`,
      );
    }
    sql += ` LIMIT ${limit}`;
  }
  if (offset !== undefined) {
    if (!Number.isInteger(offset) || offset < 0 || !Number.isFinite(offset)) {
      throw new Error(
        `appendPagination: invalid offset "${offset}" — must be a non-negative integer`,
      );
    }
    sql += ` OFFSET ${offset}`;
  }

  return sql;
}
