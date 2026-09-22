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
 * - Repeat-join fields: `field_<uuid>_j{n}` (index≥1; e.g., `field_<uuid>_j1`)
 *
 * This ensures:
 * - No collision handling needed (UUIDs are globally unique)
 * - Encoding value = SQL column name = axis selection key (zero transformation)
 * - Display names looked up from field/metric definitions when rendering UI
 * - Two joins to the same table each get distinct aliases (via `_j{n}` suffix)
 */

import {
  absoluteDateRange,
  previousPeriod,
  previousYear,
  resolveRelativeDateRange,
} from "../reporting/periods";
import { frameTableName } from "./frame-table-name";
import type {
  DataTable,
  Field,
  Insight,
  InsightFilter,
  InsightFilterBetweenValue,
  InsightMetric,
  InsightPresentation,
  MeasureExpression,
  DateTransform,
  InsightSort,
  InsightReporting,
  UUID,
} from "@dashframe/types";

import { isMeasureExpression } from "@dashframe/types";

import { quoteIdentifier, quoteLiteral } from "./quoting";

// ============================================================================
// UUID Column Naming Utilities
// ============================================================================

/**
 * Convert a field ID to a SQL-safe column alias.
 * Format: field_<uuid_with_underscores>
 *
 * For repeat-join columns the caller passes an INSTANCE-QUALIFIED field ID
 * (produced by `joinInstanceFieldId`) so the resulting alias is
 * `field_<uuid>_j{n}` — distinct from the first instance's `field_<uuid>`.
 *
 * @example
 * fieldIdToColumnAlias("dd05ef4b-1234-5678-abcd-ef1234567890")
 * // Returns: "field_dd05ef4b_1234_5678_abcd_ef1234567890"
 */
export function fieldIdToColumnAlias(fieldId: string): string {
  return `field_${fieldId.replace(/-/g, "_")}`;
}

/**
 * Encode a join instance index into a field ID so two joins to the same table
 * produce distinct column aliases.
 *
 * - index 0 (first join): returns `fieldId` unchanged → alias stays `field_<uuid>`
 * - index ≥ 1 (repeat join): returns `fieldId_j{n}` → alias becomes `field_<uuid>_j{n}`
 *
 * This helper is used in two ways:
 * - SQL emission: fed into `fieldIdToColumnAlias` to produce unique SQL column aliases.
 * - Field accumulation: used as `Field.id` on SYNTHETIC Field objects returned by
 *   `buildInsightAvailableFields` and `processSingleJoin` so display-name / type maps
 *   keyed on `fieldIdToColumnAlias(field.id)` match the emitted aliases exactly.
 *
 * The source Insight does not store the instance-qualified ID in its own join
 * definition; it is synthesized while resolving that Insight's output fields.
 * A downstream Insight may persist the ID in `selectedFields` as a reference to
 * that specific repeated-join output.
 */
function joinInstanceFieldId(
  fieldId: string,
  joinInstanceIndex: number,
): string {
  if (joinInstanceIndex === 0) return fieldId;
  return `${fieldId}_j${joinInstanceIndex}`;
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
 * Handles both field_* and metric_* formats, including repeat-join suffixed
 * aliases produced by `joinInstanceFieldId` (e.g. `field_<uuid>_j1`).
 *
 * The join-instance suffix is stripped before UUID reconstruction so all callers
 * that need only the canonical field ID work correctly. Consumers that must
 * distinguish join instances should call `extractColumnAliasComponents` instead.
 *
 * @example
 * extractUUIDFromColumnAlias("field_dd05ef4b_1234_5678_abcd_ef1234567890")
 * // Returns: "dd05ef4b-1234-5678-abcd-ef1234567890"
 *
 * extractUUIDFromColumnAlias("field_dd05ef4b_1234_5678_abcd_ef1234567890_j1")
 * // Returns: "dd05ef4b-1234-5678-abcd-ef1234567890"
 */
export function extractUUIDFromColumnAlias(columnAlias: string): string | null {
  const match = columnAlias.match(/^(?:field|metric)_(.+)$/);
  if (!match) return null;

  // Strip the join-instance suffix appended by joinInstanceFieldId (e.g. `_j1`,
  // `_j2`) before reconstructing the UUID.
  const rawPart = (match[1] ?? "").replace(/_j\d+$/, "");
  if (!rawPart) return null;
  // UUID format: 8-4-4-4-12 characters
  // With underscores: 8_4_4_4_12
  const parts = rawPart.split("_");
  if (parts.length === 5) {
    return parts.join("-");
  }
  // Fallback: just replace all underscores (may not be exact UUID format)
  return rawPart.replace(/_/g, "-");
}

/**
 * Extract both the canonical UUID and the join-instance index from a column alias.
 *
 * Use this when downstream code needs to DISTINGUISH two join instances of the
 * same field (e.g. orders→users via created_by vs approved_by).
 * `extractUUIDFromColumnAlias` returns only the UUID (stripping the suffix);
 * this function returns the full breakdown.
 *
 * @example
 * extractColumnAliasComponents("field_dd05ef4b_1234_5678_abcd_ef1234567890")
 * // Returns: { uuid: "dd05ef4b-1234-5678-abcd-ef1234567890", instanceIndex: 0 }
 *
 * extractColumnAliasComponents("field_dd05ef4b_1234_5678_abcd_ef1234567890_j1")
 * // Returns: { uuid: "dd05ef4b-1234-5678-abcd-ef1234567890", instanceIndex: 1 }
 */
export function extractColumnAliasComponents(
  columnAlias: string,
): { uuid: string; instanceIndex: number } | null {
  const match = columnAlias.match(/^(?:field|metric)_(.+)$/);
  if (!match) return null;

  const rawPart = match[1] ?? "";
  // Check for join-instance suffix
  const instanceMatch = rawPart.match(/^(.+)_j(\d+)$/);
  let uuidRaw: string;
  let instanceIndex: number;
  if (instanceMatch) {
    uuidRaw = instanceMatch[1] ?? "";
    instanceIndex = parseInt(instanceMatch[2] ?? "0", 10);
  } else {
    uuidRaw = rawPart;
    instanceIndex = 0;
  }
  if (!uuidRaw) return null;

  const parts = uuidRaw.split("_");
  const uuid =
    parts.length === 5 ? parts.join("-") : uuidRaw.replace(/_/g, "-");
  return { uuid, instanceIndex };
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
  /** Fixed execution clock for relative report periods; defaults to now. */
  asOf?: Date;
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
  /** Exact pivot cell used to rank complete pivot rows. */
  pivotValues?: InsightSort["pivotValues"];
  /** Transient chart grouping over the canonical report cohort. */
  presentation?: InsightPresentation;
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
  // oxlint-disable-next-line sonarjs/slow-regex -- anchored trim of leading/trailing underscores on a short identifier; no nested quantifier to backtrack
  cleaned = cleaned.replace(/(^_+)|(_+$)/g, "");
  return cleaned || name;
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
    .find((field) => fieldMatchesReference(field, fieldName));
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
          pivotValues: firstSort.pivotValues,
        }
      : undefined;
  return {
    ...options,
    ...(effectiveLimit !== undefined && { limit: effectiveLimit }),
    ...sortOverride,
  };
}

function reportDateFilters(
  dateRange: NonNullable<InsightReporting["dateRange"]>,
  fields: Field[],
  asOf: Date | undefined,
  filters: InsightFilter[] | undefined,
): InsightFilter[] {
  const field = fields.find((candidate) => candidate.id === dateRange.fieldId);
  if (!field || field.type !== "date")
    throw new Error("Report date range references an unavailable date field");
  const range =
    dateRange.range.type === "absolute"
      ? absoluteDateRange(
          new Date(dateRange.range.start),
          new Date(dateRange.range.end),
        )
      : resolveRelativeDateRange(dateRange.range, asOf ?? new Date());
  const reference = fieldIdToColumnAlias(field.id);
  return [
    ...(filters ?? []),
    { field: reference, operator: "gte", value: range.start.toISOString() },
    { field: reference, operator: "lt", value: range.end.toISOString() },
  ];
}

export function buildInsightSQL(
  baseTable: DataTable,
  joinedTables: Map<UUID, DataTable>,
  insight: Insight,
  options: BuildInsightSQLOptions,
): string | null {
  const { mode, effectiveFilters, effectiveSorts } = options;
  const effectiveLimit = options.effectiveLimit ?? insight.reporting?.limit;

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

  const baseDFTable = frameTableName(baseTable.dataFrameId);
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
 *
 * When the same `rightTableId` appears in multiple joins (a legitimate
 * double-join, e.g. orders→users on `created_by` AND `approved_by`), the
 * second and later instances get `_j{n}`-suffixed aliases so DuckDB never sees
 * duplicate column names in the SELECT.  `availableFields` contains synthetic
 * Field objects with the instance-qualified IDs so that display-name/type maps
 * keyed on `fieldIdToColumnAlias(field.id)` match the emitted aliases exactly.
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

  // Track how many times each rightTableId has been successfully joined so
  // processSingleJoin can suffix aliases for repeat-join instances.
  // IMPORTANT: the counter is only incremented on SUCCESSFUL joins — a skipped
  // join (missing table, missing keys, invalid type) does NOT advance the index.
  // This keeps the emitted suffix and the hooks' display-name maps in sync.
  const joinInstanceCount = new Map<UUID, number>();

  for (const join of insight.joins ?? []) {
    const instanceIndex = joinInstanceCount.get(join.rightTableId) ?? 0;

    const joinResult = processSingleJoin(
      join,
      joinedTables,
      currentSQL,
      baseDisplayName,
      currentFields,
      instanceIndex,
    );

    if (joinResult) {
      // Advance the counter ONLY on success — a skipped join must not consume
      // an index slot, otherwise the next valid join gets a wrong suffix.
      joinInstanceCount.set(join.rightTableId, instanceIndex + 1);
      currentSQL = joinResult.sql;
      // Accumulate fields from all joined tables for subsequent joins.
      // `joinResult.allFields` excludes dropped right join-keys and contains
      // synthetic Fields with instance-suffixed IDs for repeat-joins, so it is
      // the accurate column set actually present in `currentSQL`.
      currentFields = joinResult.allFields;
    }
  }

  // `currentFields` is the exact column set in the emitted subquery — dropped
  // join keys and instance suffixes already applied. Returning it lets callers
  // build display-name/type maps that match the FROM clause precisely.
  return { sql: currentSQL, availableFields: currentFields };
}

/**
 * Compute the field set that `buildInsightSQL` will emit for a given insight.
 *
 * Returns the same synthetic Field list that `buildJoinedSQL` accumulates
 * internally: base fields + joined fields with dropped right join-keys and
 * instance-suffixed IDs for repeat-joins (`field_<uuid>_j{n}` for index≥1).
 *
 * Use this in hooks/UI code to build display-name and type maps that are
 * keyed on `fieldIdToColumnAlias(field.id)` and therefore match the SQL
 * column names DuckDB actually produces — without re-deriving the instance
 * index logic in multiple places (the desync risk #162 left open).
 *
 * Returns `null` when `baseTable.dataFrameId` is absent (same guard as
 * `buildInsightSQL`).
 */
export function buildInsightAvailableFields(
  baseTable: DataTable,
  joinedTables: Map<UUID, DataTable>,
  insight: Pick<Insight, "joins">,
): Field[] | null {
  if (!baseTable.dataFrameId) return null;

  const baseFields = (baseTable.fields ?? []).filter(
    (f) => !f.name.startsWith("_"),
  );

  if (!insight.joins?.length) {
    return baseFields;
  }

  // Mirror buildJoinedSQL's field accumulation without emitting any SQL.
  const joinInstanceCount = new Map<UUID, number>();
  const currentFields: Field[] = [...baseFields];

  for (const join of insight.joins) {
    const instanceIndex = joinInstanceCount.get(join.rightTableId) ?? 0;
    const joinTable = joinedTables.get(join.rightTableId);
    if (!joinTable || !joinTable.dataFrameId) continue;

    const joinFields = (joinTable.fields ?? []).filter(
      (f) => !f.name.startsWith("_"),
    );

    // Validate join keys exactly as processSingleJoin does; skip if invalid.
    const currentKeyField = currentFields.find(
      (f) => (f.columnName ?? f.name) === join.leftKey,
    );
    const joinKeyField = joinFields.find(
      (f) => (f.columnName ?? f.name) === join.rightKey,
    );
    if (!currentKeyField || !joinKeyField) continue;

    const rightColName = joinKeyField.columnName ?? joinKeyField.name;
    const rawJoinType = join.type ?? "inner";
    // Intentional divergence from processSingleJoin: that function throws on an
    // invalid join type (fail-closed SQL path), while here we skip the join
    // instead.  `buildInsightAvailableFields` must never throw — it runs in
    // render-path hooks that have no error boundary around this call.  The
    // counters stay in sync because the throw in buildJoinedSQL prevents
    // `joinInstanceCount.set` from ever being reached for the invalid join.
    if (!JOIN_TYPE_WHITELIST_CONST.has(rawJoinType)) continue;

    const nonKeyJoinFields = joinFields.filter(
      (f) => (f.columnName ?? f.name) !== rightColName,
    );

    // Mirror processSingleJoin: instance 0 → canonical IDs; index≥1 → suffixed.
    const instanceFields: Field[] = nonKeyJoinFields.map((f) => ({
      ...f,
      id: joinInstanceFieldId(f.id, instanceIndex) as UUID,
    }));

    // Counter advances only on a valid join (mirrors buildJoinedSQL).
    joinInstanceCount.set(join.rightTableId, instanceIndex + 1);
    currentFields.push(...instanceFields);
  }

  return currentFields;
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
 *
 * @param joinInstanceIndex - How many times this `rightTableId` has been
 *   successfully joined BEFORE this call (0 = first time, 1 = second, …).
 *   When > 0, the right-side non-key columns get `_j{n}`-suffixed aliases so
 *   two joins to the same table emit distinct SQL output column names.
 *   Without this, DuckDB silently keeps only the first occurrence → the second
 *   join's columns are unreachable (silent wrong results).
 */
function processSingleJoin(
  join: NonNullable<Insight["joins"]>[number],
  joinedTables: Map<UUID, DataTable>,
  currentSQL: string,
  currentDisplayName: string,
  currentFields: Field[],
  joinInstanceIndex: number,
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
  const joinDFTable = frameTableName(joinTable.dataFrameId);
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

  // Right side: exclude the join key; suffix aliases for repeat-join instances.
  // For instance 0 (first join to this table) the suffix is absent → alias is
  // the canonical `field_<uuid>` (no regression vs. the pre-fix behaviour).
  // For instance ≥ 1 the alias becomes `field_<uuid>_j{n}` so DuckDB sees two
  // distinct output columns and cannot silently discard the second (the bug).
  const nonKeyJoinFields = joinFields.filter(
    (f) => (f.columnName ?? f.name) !== rightColName,
  );
  const joinSelects = nonKeyJoinFields.map((field) => {
    const columnName = field.columnName ?? field.name;
    const instanceId = joinInstanceFieldId(field.id, joinInstanceIndex);
    return buildColumnSelectWithFieldId(
      joinDisplayName,
      columnName,
      instanceId,
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

  // Combine fields for subsequent joins (excluding dropped right join-key).
  // For repeat-join instances, create synthetic Fields with instance-suffixed IDs
  // so that subsequent join iterations see the correct suffixed aliases when
  // building their passthrough SELECTs — not the original IDs from a prior instance.
  // These synthetic IDs may be persisted by downstream Insights in
  // selectedFields so a repeated join instance remains addressable.
  const instanceFields = nonKeyJoinFields.map((f) => ({
    ...f,
    id: joinInstanceFieldId(f.id, joinInstanceIndex) as UUID,
  }));

  const allFields = [...currentFields, ...instanceFields];

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
  return quoteLiteral(String(val));
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
        .replace(/_/g, "\\_");
      const pattern = quoteLiteral(`%${escaped}%`);
      return `${columnRef} LIKE ${pattern} ESCAPE '\\'`;
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

function fieldMatchesReference(field: Field, reference: string): boolean {
  return (
    (field.columnName ?? field.name) === reference ||
    fieldIdToColumnAlias(field.id) === reference
  );
}

/**
 * Derive the SQL column reference for a filter field.
 *
 * Filters reference fields by either their physical source column name or the
 * canonical UUID alias emitted by the editor. We look up the matching field to
 * resolve the reference appropriate to the actual FROM clause.
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
  const field = Array.from(fieldIdMap.values()).find((candidate) =>
    fieldMatchesReference(candidate, filterField),
  );
  if (!field) return null;
  if (refMode === "alias") {
    return `"${fieldIdToColumnAlias(field.id)}"`;
  }
  // Source column names come from the data verbatim (CSV headers), so they can
  // contain double-quotes — quote through the shared helper, which doubles them.
  return quoteIdentifier(field.columnName ?? field.name);
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

  return compileMeasure(metric, insight.metrics, fieldIdMap);
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
    if (field && fieldMatchesReference(field, filter.field)) {
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
  reporting?: InsightReporting,
): { selectParts: string[]; groupByParts: string[]; columnAliases: string[] } {
  const selectParts: string[] = [];
  const groupByParts: string[] = [];
  const columnAliases: string[] = [];

  for (const fieldId of selectedFieldIds) {
    const field = fieldIdMap.get(fieldId);
    if (field) {
      const alias = fieldIdToColumnAlias(fieldId);
      const grain = reporting?.dateGrains?.[fieldId];
      if (
        grain &&
        !["day", "week", "month", "quarter", "year"].includes(grain)
      ) {
        throw new Error("Invalid date grouping");
      }
      if (grain && field.type !== "date")
        throw new Error("Date grouping requires a date field");
      const expression = grain
        ? `DATE_TRUNC('${grain}', ${quoteIdentifier(alias)})`
        : quoteIdentifier(alias);
      selectParts.push(`${expression} AS ${quoteIdentifier(alias)}`);
      groupByParts.push(expression);
      columnAliases.push(alias);
    }
  }

  return { selectParts, groupByParts, columnAliases };
}

function resolveMeasureSourceField(
  metric: InsightMetric,
  fields: Map<string, Field>,
): Field | undefined {
  if (!metric.columnName) return undefined;
  return Array.from(fields.values()).find(
    (field) =>
      field.tableId === metric.sourceTable &&
      fieldMatchesReference(field, metric.columnName!),
  );
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
/** Compile once for SELECT, HAVING, and aggregate totals. Never sum displayed ratios. */
function compileMeasure(
  metric: InsightMetric,
  measures: InsightMetric[],
  fields: Map<string, Field>,
  visiting = new Set<string>(),
): string {
  if (visiting.has(metric.id)) throw new Error("Cyclic measure reference");
  const path = new Set(visiting).add(metric.id);
  if (metric.expression) {
    if (!isMeasureExpression(metric.expression))
      throw new Error("Invalid measure expression");
    if (metric.filters?.length)
      throw new Error("Apply filters to the referenced aggregate measures");
    return compileMeasureExpression(
      metric.expression,
      measures,
      fields,
      path,
      0,
    );
  }
  if (!AGG_WHITELIST_CONST.has(metric.aggregation)) {
    throw new Error(`invalid aggregation "${metric.aggregation}"`);
  }
  if (!metric.columnName && metric.aggregation !== "count") {
    throw new Error("A measure requires a source column");
  }
  const source = resolveMeasureSourceField(metric, fields);
  const sourceColumn = source
    ? fieldIdToColumnAlias(source.id)
    : metric.columnName;
  const column = sourceColumn ? quoteIdentifier(sourceColumn) : "*";
  const aggregate =
    metric.aggregation === "count_distinct"
      ? `COUNT(DISTINCT ${column})`
      : `${metric.aggregation.toUpperCase()}(${column})`;
  if (!metric.filters?.length) return aggregate;
  const predicates = metric.filters.map((filter) => {
    const ref = resolveFilterColumnRef(filter.field, fields, "alias");
    if (!ref) throw new Error("Measure filter references an unavailable field");
    return buildFilterPredicate(ref, filter);
  });
  return `${aggregate} FILTER (WHERE ${predicates.join(" AND ")})`;
}

function compileMeasureExpression(
  expression: MeasureExpression,
  measures: InsightMetric[],
  fields: Map<string, Field>,
  visiting: Set<string>,
  depth: number,
): string {
  if (depth > 64 || visiting.size > 64)
    throw new Error("Measure expression is too deep");
  switch (expression.kind) {
    case "constant":
      if (!Number.isFinite(expression.value))
        throw new Error("Measure constants must be finite");
      return String(expression.value);
    case "measure": {
      const metric = measures.find(
        (candidate) => candidate.id === expression.measureId,
      );
      if (!metric) throw new Error("Unknown measure reference");
      return compileMeasure(metric, measures, fields, visiting);
    }
    case "binary": {
      const left = compileMeasureExpression(
        expression.left,
        measures,
        fields,
        visiting,
        depth + 1,
      );
      const right = compileMeasureExpression(
        expression.right,
        measures,
        fields,
        visiting,
        depth + 1,
      );
      // Undefined ratios remain NULL in every presentation, including grand totals.
      if (expression.operator === "divide")
        return `(${left} / NULLIF(${right}, 0))`;
      const operator = { add: "+", subtract: "-", multiply: "*" }[
        expression.operator
      ];
      if (!operator) throw new Error("Invalid measure operator");
      return `(${left} ${operator} ${right})`;
    }
    default:
      throw new Error("Invalid measure expression");
  }
}

/** Build SELECT parts for all metrics with UUID aliases */
function buildMetricColumnsWithUUID(
  metrics: NonNullable<Insight["metrics"]>,
  fieldIdMap: Map<string, Field>,
  measureIds?: string[],
): { selectParts: string[]; columnAliases: string[] } {
  const selectParts: string[] = [];
  const columnAliases: string[] = [];

  const selected =
    measureIds?.map((id) => {
      const metric = metrics.find((candidate) => candidate.id === id);
      if (!metric) throw new Error("Selected measure is unavailable");
      return metric;
    }) ?? metrics;
  if (!selected.length) throw new Error("Select at least one measure");
  for (const metric of selected) {
    const expr = `${compileMeasure(metric, metrics, fieldIdMap)} AS ${quoteIdentifier(metricIdToColumnAlias(metric.id))}`;
    if (expr) {
      selectParts.push(expr);
      columnAliases.push(metricIdToColumnAlias(metric.id));
    }
  }

  return { selectParts, columnAliases };
}

function validateSelectedSortDimension(
  allFields: Field[],
  insight: Insight,
  options: BuildInsightSQLOptions,
): void {
  if (
    options.sortColumn &&
    (insight.metrics.length || insight.selectedFields.length)
  ) {
    const sortedField = allFields.find(
      (field) => fieldIdToColumnAlias(field.id) === options.sortColumn,
    );
    if (sortedField && !insight.selectedFields.includes(sortedField.id))
      throw new Error(
        "Sort dimension is not selected; choose a displayed dimension or measure",
      );
  }
}

type PivotSortContext = {
  measureAlias: string;
  pivotAliases: string[];
  rowAliases: string[];
  values: Array<{ field: Field; value: string | number | boolean | null }>;
};

function resolvePivotSortContext(
  fields: Field[],
  insight: Insight,
  options: BuildInsightSQLOptions,
): PivotSortContext | undefined {
  if (options.pivotValues === undefined) return undefined;
  if (!options.sortColumn || !options.sortDirection)
    throw new Error("Pivot sort requires a measure and direction");
  if (!SORT_DIRECTION_WHITELIST.has(options.sortDirection))
    throw new Error("Invalid pivot sort direction");

  const pivotIds = insight.reporting?.pivotFields ?? [];
  if (!pivotIds.length)
    throw new Error("Pivot sort requires at least one pivot dimension");
  if (new Set(pivotIds).size !== pivotIds.length)
    throw new Error("Pivot dimensions are ambiguous");
  if (pivotIds.some((id) => !insight.selectedFields.includes(id)))
    throw new Error("Pivot sort references an unavailable pivot dimension");

  const tuple = options.pivotValues;
  const tupleIds = tuple.map((entry) => entry.fieldId);
  if (
    tuple.length !== pivotIds.length ||
    new Set(tupleIds).size !== tupleIds.length ||
    pivotIds.some((id) => !tupleIds.includes(id))
  ) {
    throw new Error(
      "Pivot sort must specify each pivot dimension exactly once",
    );
  }

  const metrics = insight.metrics.filter(
    (metric) => metricIdToColumnAlias(metric.id) === options.sortColumn,
  );
  if (metrics.length !== 1)
    throw new Error(
      "Pivot sort references an unavailable or ambiguous measure",
    );

  const fieldMap = buildFieldIdMap(fields);
  const values = pivotIds.map((fieldId) => {
    const field = fieldMap.get(fieldId);
    if (!field)
      throw new Error("Pivot sort references an unavailable pivot dimension");
    const entry = tuple.find((candidate) => candidate.fieldId === fieldId)!;
    validatePivotValue(field, entry.value);
    return { field, value: entry.value };
  });
  const pivotSet = new Set(pivotIds);
  return {
    measureAlias: options.sortColumn,
    pivotAliases: pivotIds.map(fieldIdToColumnAlias),
    rowAliases: insight.selectedFields
      .filter((id) => !pivotSet.has(id))
      .map(fieldIdToColumnAlias),
    values,
  };
}

function validatePivotValue(
  field: Field,
  value: string | number | boolean | null,
): void {
  if (value === null) return;
  if (field.type === "date") {
    if (
      (typeof value !== "string" || !Number.isFinite(Date.parse(value))) &&
      (typeof value !== "number" || !Number.isFinite(value))
    ) {
      throw new Error("Pivot sort date value must be an ISO date or timestamp");
    }
    return;
  }
  if (field.type !== "unknown" && typeof value !== field.type)
    throw new Error(`Pivot sort value does not match ${field.type} dimension`);
  if (typeof value === "number" && !Number.isFinite(value))
    throw new Error("Pivot sort values must be finite");
}

function qualifiedColumn(alias: string, column: string): string {
  return `${quoteIdentifier(alias)}.${quoteIdentifier(column)}`;
}

function pivotValueSQL(
  column: string,
  field: Field,
  value: string | number | boolean | null,
): string {
  if (value === null) return `${column} IS NULL`;
  if (field.type !== "date")
    return `${column} IS NOT DISTINCT FROM ${quoteValue(value)}`;
  const timestamp =
    typeof value === "number"
      ? `MAKE_TIMESTAMP_MS(${value})`
      : `CAST(${quoteLiteral(String(value))} AS TIMESTAMP)`;
  return `CAST(${column} AS TIMESTAMP) IS NOT DISTINCT FROM ${timestamp}`;
}

function pivotCellPredicate(
  context: PivotSortContext,
  sourceAlias: string,
  detailOnly = false,
): string {
  const predicates = context.values.map(({ field, value }) =>
    pivotValueSQL(
      qualifiedColumn(sourceAlias, fieldIdToColumnAlias(field.id)),
      field,
      value,
    ),
  );
  if (detailOnly)
    predicates.unshift(
      `${qualifiedColumn(sourceAlias, "__report_grouping")} = 0`,
    );
  return predicates.join(" AND ");
}

function pivotStableOrder(context: PivotSortContext, alias: string): string[] {
  return [...context.rowAliases, ...context.pivotAliases].map(
    (column) => `${qualifiedColumn(alias, column)} ASC NULLS LAST`,
  );
}

/** Select complete pivot rows before totals are re-aggregated from source rows. */
function buildPivotRowSelectionSQL(
  sql: string,
  context: PivotSortContext,
  options: BuildInsightSQLOptions,
  outputColumns: string[],
): string {
  const rowColumns = context.rowAliases.map(quoteIdentifier);
  const groupBy = rowColumns.length ? ` GROUP BY ${rowColumns.join(", ")}` : "";
  const rowPrefix = rowColumns.length ? `${rowColumns.join(", ")}, ` : "";
  const key = `MAX(CASE WHEN ${pivotCellPredicate(context, "__pivot_cell")} THEN ${qualifiedColumn("__pivot_cell", context.measureAlias)} END)`;
  const rowOrder = [
    `"__pivot_sort_key" ${options.sortDirection!.toUpperCase()} NULLS LAST`,
    ...context.rowAliases.map(
      (column) => `${quoteIdentifier(column)} ASC NULLS LAST`,
    ),
  ];
  const rows = appendPagination(
    `SELECT ${rowPrefix}${key} AS "__pivot_sort_key" FROM "__pivot_cells" AS "__pivot_cell"${groupBy} ORDER BY ${rowOrder.join(", ")}`,
    { mode: options.mode, limit: options.limit, offset: options.offset },
    new Set(),
  );
  const joins = context.rowAliases.map(
    (column) =>
      `${qualifiedColumn("__pivot_cell", column)} IS NOT DISTINCT FROM ${qualifiedColumn("__pivot_selected", column)}`,
  );
  const projected = outputColumns.map((column) =>
    qualifiedColumn("__pivot_cell", column),
  );
  const order = [
    `${qualifiedColumn("__pivot_selected", "__pivot_sort_key")} ${options.sortDirection!.toUpperCase()} NULLS LAST`,
    ...pivotStableOrder(context, "__pivot_cell"),
  ];
  return (
    `WITH "__pivot_cells" AS (${sql}), "__pivot_selected" AS (${rows}) ` +
    `SELECT ${projected.join(", ")} FROM "__pivot_cells" AS "__pivot_cell" ` +
    `JOIN "__pivot_selected" AS "__pivot_selected" ON ${joins.join(" AND ") || "TRUE"} ` +
    `ORDER BY ${order.join(", ")}`
  );
}

function pivotResultOrder(
  context: PivotSortContext,
  sourceAlias: string,
  direction: "asc" | "desc",
  hasTotals: boolean,
): string[] {
  const partition = context.rowAliases.length
    ? ` PARTITION BY ${context.rowAliases
        .map((column) => qualifiedColumn(sourceAlias, column))
        .join(", ")}`
    : "";
  const key =
    `MAX(CASE WHEN ${pivotCellPredicate(context, sourceAlias, hasTotals)} ` +
    `THEN ${qualifiedColumn(sourceAlias, context.measureAlias)} END) OVER (` +
    `${partition.trimStart()}) ${direction.toUpperCase()} NULLS LAST`;
  return [
    ...(hasTotals
      ? [`${qualifiedColumn(sourceAlias, "__report_grouping")} ASC`]
      : []),
    key,
    ...pivotStableOrder(context, sourceAlias),
  ];
}

function validatePresentation(
  presentation: InsightPresentation,
  insight: Insight,
  fields: Field[],
): void {
  if (new Set(presentation.dimensions).size !== presentation.dimensions.length)
    throw new Error("Presentation dimensions must be unique");
  if (
    presentation.dimensions.some((id) => !insight.selectedFields.includes(id))
  )
    throw new Error("Presentation dimension is not selected");
  const transforms = presentation.transforms ?? {};
  for (const [id, transform] of Object.entries(transforms)) {
    if (!presentation.dimensions.includes(id))
      throw new Error(
        "Presentation transform must target a presentation dimension",
      );
    const field = fields.find((candidate) => candidate.id === id);
    if (!field || field.type !== "date")
      throw new Error("Presentation date transform requires a date field");
    if (!isValidPresentationTransform(transform))
      throw new Error("Invalid presentation date transform");
  }
}

function isValidPresentationTransform(transform: DateTransform): boolean {
  if (!transform) return false;
  if (transform.kind === "temporal")
    return ["none", "year", "yearMonth", "yearWeek"].includes(
      transform.aggregation,
    );
  if (transform.kind === "categorical")
    return ["monthName", "dayOfWeek", "quarter"].includes(transform.groupBy);
  return false;
}

function transformDateExpression(
  expression: string,
  transform: DateTransform | undefined,
): string {
  if (!transform) return expression;
  if (transform.kind === "temporal") {
    if (transform.aggregation === "none") return expression;
    const grain = {
      year: "year",
      yearMonth: "month",
      yearWeek: "week",
    }[transform.aggregation];
    if (!grain) throw new Error("Invalid presentation date transform");
    return `DATE_TRUNC('${grain}', ${expression})`;
  }
  const functionName = {
    monthName: "MONTHNAME",
    dayOfWeek: "DAYNAME",
    quarter: "QUARTER",
  }[transform.groupBy];
  if (!functionName) throw new Error("Invalid presentation date transform");
  return `${functionName}(${expression})`;
}

function presentationDimensions(
  presentation: InsightPresentation,
  insight: Insight,
  fields: Map<string, Field>,
  alignment?: { fieldId: string; shift: string },
): { selections: string[]; groups: string[]; aliases: string[] } {
  const dimensions = buildDimensionColumns(
    presentation.dimensions,
    fields,
    insight.reporting,
  );
  alignComparisonDimensions(
    dimensions.groupByParts,
    dimensions.selectParts,
    presentation.dimensions,
    alignment,
  );
  const groups = dimensions.groupByParts.map((expression, index) =>
    transformDateExpression(
      expression,
      presentation.transforms?.[presentation.dimensions[index]!],
    ),
  );
  return {
    groups,
    aliases: dimensions.columnAliases,
    selections: groups.map(
      (expression, index) =>
        `${expression} AS ${quoteIdentifier(dimensions.columnAliases[index]!)}`,
    ),
  };
}

function canonicalMeasureIds(
  insight: Insight,
  options: BuildInsightSQLOptions,
): string[] | undefined {
  const selected = insight.reporting?.measureIds;
  if (!selected) return undefined;
  const sorted = insight.metrics.find(
    (metric) => metricIdToColumnAlias(metric.id) === options.sortColumn,
  );
  return sorted && !selected.includes(sorted.id)
    ? [...selected, sorted.id]
    : selected;
}

function rawCohortSource(
  fromClause: string,
  whereClause: string,
  groupByParts: string[],
  dimensionAliases: string[],
  eligible: string,
): string {
  const sourceAlias = quoteIdentifier("__presentation_source");
  const matches = groupByParts.map((expression, index) => {
    const alias = quoteIdentifier(dimensionAliases[index]!);
    const qualified = expression.replaceAll(alias, `${sourceAlias}.${alias}`);
    return `${qualified} IS NOT DISTINCT FROM "__presentation_groups".${alias}`;
  });
  return (
    `(SELECT ${sourceAlias}.*, "__presentation_groups"."__presentation_ordinal" ` +
    `FROM (SELECT * FROM ${fromClause} ${whereClause}) AS ${sourceAlias} ` +
    `JOIN (${eligible}) AS "__presentation_groups" ON ${matches.join(" AND ") || "TRUE"}) AS "__presentation_rows"`
  );
}

/** Attach an explicit ordinal so presentation rollups retain canonical cell order. */
function eligibleWithPresentationOrdinal(
  eligible: string,
  dimensionAliases: string[],
  metricAliases: string[],
  options: BuildInsightSQLOptions,
  pivotSort?: PivotSortContext,
): string {
  const available = new Set([...dimensionAliases, ...metricAliases]);
  if (pivotSort) {
    const source = "__presentation_eligible";
    const partition = pivotSort.rowAliases.length
      ? ` PARTITION BY ${pivotSort.rowAliases
          .map((column) => qualifiedColumn(source, column))
          .join(", ")}`
      : "";
    const key =
      `MAX(CASE WHEN ${pivotCellPredicate(pivotSort, source)} ` +
      `THEN ${qualifiedColumn(source, pivotSort.measureAlias)} END) OVER (` +
      `${partition.trimStart()})`;
    const keyed =
      `SELECT ${quoteIdentifier(source)}.*, ${key} AS "__presentation_sort_key" ` +
      `FROM (${eligible}) AS ${quoteIdentifier(source)}`;
    const keyedAlias = "__presentation_keyed";
    const order = [
      `${qualifiedColumn(keyedAlias, "__presentation_sort_key")} ${options.sortDirection!.toUpperCase()} NULLS LAST`,
      ...pivotStableOrder(pivotSort, keyedAlias),
    ];
    return (
      `SELECT ${quoteIdentifier(keyedAlias)}.*, ` +
      `ROW_NUMBER() OVER (ORDER BY ${order.join(", ")}) AS "__presentation_ordinal" ` +
      `FROM (${keyed}) AS ${quoteIdentifier(keyedAlias)}`
    );
  }

  const source = "__presentation_eligible";
  const order: string[] = [];
  if (
    options.sortColumn &&
    options.sortDirection &&
    available.has(options.sortColumn)
  ) {
    order.push(
      `${qualifiedColumn(source, options.sortColumn)} ${options.sortDirection.toUpperCase()} NULLS LAST`,
    );
  }
  order.push(
    ...dimensionAliases.map(
      (column) => `${qualifiedColumn(source, column)} ASC NULLS LAST`,
    ),
  );
  if (!order.length) order.push("1");
  return (
    `SELECT ${quoteIdentifier(source)}.*, ` +
    `ROW_NUMBER() OVER (ORDER BY ${order.join(", ")}) AS "__presentation_ordinal" ` +
    `FROM (${eligible}) AS ${quoteIdentifier(source)}`
  );
}

function buildPresentationAggregate(
  source: string,
  fields: Field[],
  insight: Insight,
  presentation: InsightPresentation,
  alignment?: { fieldId: string; shift: string },
  exposeOrdinal = false,
): { sql: string; aliases: string[]; outputAliases: string[] } {
  validatePresentation(presentation, insight, fields);
  const fieldMap = buildFieldIdMap(fields);
  const dimensions = presentationDimensions(
    presentation,
    insight,
    fieldMap,
    alignment,
  );
  const metrics = buildMetricColumnsWithUUID(
    insight.metrics,
    fieldMap,
    insight.reporting?.measureIds,
  );
  const outputAliases = [...dimensions.aliases, ...metrics.columnAliases];
  const selections = [
    ...dimensions.selections,
    ...metrics.selectParts,
    `MIN("__presentation_ordinal") AS "__presentation_ordinal"`,
  ];
  let aggregate = `SELECT ${selections.join(", ")} FROM ${source}`;
  if (dimensions.groups.length)
    aggregate += ` GROUP BY ${dimensions.groups.join(", ")}`;
  else aggregate += " HAVING COUNT(*) > 0";
  const sql = exposeOrdinal
    ? aggregate
    : `SELECT ${outputAliases.map(quoteIdentifier).join(", ")} FROM (${aggregate}) AS "__presentation_result" ORDER BY "__presentation_ordinal" ASC`;
  return { sql, aliases: dimensions.aliases, outputAliases };
}

/** Keep hidden measure sorting inside the canonical query, then project only requested output. */
function buildHiddenMeasureSortSQL(
  fromClause: string,
  fields: Field[],
  insight: Insight,
  options: BuildInsightSQLOptions,
): string | undefined {
  const selected = insight.reporting?.measureIds;
  const sorted = insight.metrics.find(
    (metric) => metricIdToColumnAlias(metric.id) === options.sortColumn,
  );
  if (!selected?.length || !options.sortDirection) return undefined;
  if (!sorted || selected.includes(sorted.id)) return undefined;
  const inner = buildAggregatedSQL(
    fromClause,
    fields,
    {
      ...insight,
      reporting: { ...insight.reporting, measureIds: [...selected, sorted.id] },
    },
    options,
    undefined,
    true,
  );
  const dimensions = insight.selectedFields.map(fieldIdToColumnAlias);
  const measures = selected.flatMap((id) => {
    const alias = metricIdToColumnAlias(id);
    return insight.reporting?.comparison
      ? [
          alias,
          alias + "_previous",
          alias + "_change",
          alias + "_change_percent",
        ]
      : [alias];
  });
  const totals = Boolean(insight.reporting?.totals && dimensions.length);
  const pivotSort = resolvePivotSortContext(fields, insight, options);
  const columns = [
    ...dimensions,
    ...measures,
    ...(totals ? ["__report_grouping"] : []),
  ].map(quoteIdentifier);
  const order = pivotSort
    ? pivotResultOrder(
        pivotSort,
        "__projected_report",
        options.sortDirection,
        totals,
      )
    : [
        ...(totals ? ['"__report_grouping" ASC'] : []),
        `${quoteIdentifier(options.sortColumn!)} ${options.sortDirection === "desc" ? "DESC" : "ASC"}`,
      ];
  return `SELECT ${columns.join(", ")} FROM (${inner}) AS "__projected_report" ORDER BY ${order.join(", ")}`;
}

function buildSpecialReportSQL(
  fromClause: string,
  allFields: Field[],
  insight: Insight,
  options: BuildInsightSQLOptions,
  deferPivotResultOrder: boolean,
): string | undefined {
  if (insight.reporting?.comparison) {
    assertNumericComparisonMeasures(insight, buildFieldIdMap(allFields));
  }
  if (!options.presentation) {
    const projected = buildHiddenMeasureSortSQL(
      fromClause,
      allFields,
      insight,
      options,
    );
    if (projected) return projected;
  }
  if (insight.reporting?.comparison) {
    return options.presentation
      ? buildPresentationPeriodComparisonSQL(
          fromClause,
          allFields,
          insight,
          options,
        )
      : buildPeriodComparisonSQL(
          fromClause,
          allFields,
          insight,
          options,
          deferPivotResultOrder,
        );
  }
  if (!insight.reporting?.dateRange) return undefined;
  const { dateRange, ...reporting } = insight.reporting;
  return buildAggregatedSQL(
    fromClause,
    allFields,
    {
      ...insight,
      reporting,
      filters: reportDateFilters(
        dateRange,
        allFields,
        options.asOf,
        insight.filters,
      ),
    },
    options,
    undefined,
    deferPivotResultOrder,
  );
}

/**
 * Period comparisons emit subtraction and division columns, so every compared
 * measure must produce a number. MIN/MAX preserve their source type, while
 * count aggregations always produce a number. Derived measures are numeric only
 * when all referenced measures are numeric.
 */
function assertNumericComparisonMeasures(
  insight: Insight,
  fields: Map<string, Field>,
): void {
  const selectedIds =
    insight.reporting?.measureIds ?? insight.metrics.map((metric) => metric.id);
  for (const id of selectedIds) {
    const metric = insight.metrics.find((candidate) => candidate.id === id);
    if (!metric) throw new Error("Selected comparison measure is unavailable");
    if (
      !isNumericComparisonMeasure(metric, insight.metrics, fields, new Set())
    ) {
      throw new Error(
        `Period comparison requires numeric measures; "${metric.name}" is not numeric`,
      );
    }
  }
}

function isNumericComparisonMeasure(
  metric: InsightMetric,
  measures: InsightMetric[],
  fields: Map<string, Field>,
  visiting: Set<string>,
): boolean {
  if (visiting.has(metric.id)) throw new Error("Cyclic measure reference");
  if (metric.expression) {
    if (!isMeasureExpression(metric.expression))
      throw new Error("Invalid measure expression");
    const path = new Set(visiting).add(metric.id);
    const expressionIsNumeric = (expression: MeasureExpression): boolean => {
      if (expression.kind === "constant") return true;
      if (expression.kind === "binary") {
        return (
          expressionIsNumeric(expression.left) &&
          expressionIsNumeric(expression.right)
        );
      }
      const dependency = measures.find(
        (candidate) => candidate.id === expression.measureId,
      );
      if (!dependency) throw new Error("Unknown measure reference");
      return isNumericComparisonMeasure(dependency, measures, fields, path);
    };
    return expressionIsNumeric(metric.expression);
  }

  if (metric.aggregation === "count" || metric.aggregation === "count_distinct")
    return true;
  const source = resolveMeasureSourceField(metric, fields);
  return source?.type === "number";
}

function buildUnconfiguredSQL(
  querySource: string,
  fields: Field[],
  insight: Insight,
  options: BuildInsightSQLOptions,
  fieldIdMap: Map<string, Field>,
): string | undefined {
  if (insight.selectedFields.length || insight.metrics.length) return undefined;
  const validColumns = new Set(
    fields.map((field) => fieldIdToColumnAlias(field.id)),
  );
  const { whereClause } = buildFilterClauses(
    insight,
    fieldIdMap,
    false,
    "alias",
  );
  const filter = whereClause ? " " + whereClause : "";
  const sql = `SELECT * FROM ${querySource}${filter}`;
  return appendPagination(sql, options, validColumns);
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
  alignment?: { fieldId: string; shift: string },
  deferPivotResultOrder = false,
): string {
  validateSelectedSortDimension(allFields, insight, options);
  const special = buildSpecialReportSQL(
    fromClause,
    allFields,
    insight,
    options,
    deferPivotResultOrder,
  );
  if (special) return special;
  const hasSelectedFields = (insight.selectedFields?.length ?? 0) > 0;
  const hasMetrics = (insight.metrics?.length ?? 0) > 0;

  // Build field map for lookups
  const fieldIdMap = buildFieldIdMap(allFields);
  const querySource = buildTopNSource(fromClause, insight, fieldIdMap);

  // No configuration: fall back to raw data (all fields with UUID aliases)
  const unconfigured = buildUnconfiguredSQL(
    querySource,
    allFields,
    insight,
    options,
    fieldIdMap,
  );
  if (unconfigured) return unconfigured;

  // Build dimension columns with UUID aliases
  const {
    selectParts: dimensionSelects,
    groupByParts,
    columnAliases: dimensionAliases,
  } = hasSelectedFields
    ? buildDimensionColumns(
        insight.selectedFields!,
        fieldIdMap,
        insight.reporting,
      )
    : { selectParts: [], groupByParts: [], columnAliases: [] };

  alignComparisonDimensions(
    groupByParts,
    dimensionSelects,
    insight.selectedFields,
    alignment,
  );

  // Build metric columns with UUID aliases
  const outputMeasureIds = options.presentation
    ? canonicalMeasureIds(insight, options)
    : insight.reporting?.measureIds;
  const { selectParts: metricSelects, columnAliases: metricAliases } =
    hasMetrics
      ? buildMetricColumnsWithUUID(
          insight.metrics!,
          fieldIdMap,
          outputMeasureIds,
        )
      : { selectParts: [], columnAliases: [] };

  // Combine SELECT parts
  const selectParts = [...dimensionSelects, ...metricSelects];

  // Build set of valid columns for sorting (all use UUID aliases now)
  const validColumns = new Set<string>([...dimensionAliases, ...metricAliases]);
  const pivotSort = resolvePivotSortContext(allFields, insight, options);

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
  let sql = `SELECT ${selectParts.join(", ")} FROM ${querySource}`;

  if (whereClause) {
    sql += ` ${whereClause}`;
  }

  if (hasGroupBy) {
    sql += ` GROUP BY ${groupByParts.join(", ")}`;
  }

  if (havingClause) {
    sql += ` ${havingClause}`;
  }

  if (options.presentation) {
    const canonicalEligible = pivotSort
      ? buildPivotRowSelectionSQL(sql, pivotSort, options, [
          ...dimensionAliases,
          ...metricAliases,
        ])
      : appendPagination(sql, options, validColumns);
    const eligible = eligibleWithPresentationOrdinal(
      canonicalEligible,
      dimensionAliases,
      metricAliases,
      options,
      pivotSort,
    );
    return buildPresentationAggregate(
      rawCohortSource(
        querySource,
        whereClause,
        groupByParts,
        dimensionAliases,
        eligible,
      ),
      allFields,
      insight,
      options.presentation,
      alignment,
    ).sql;
  }

  if (insight.reporting?.totals && hasMetrics && hasGroupBy) {
    return buildReportTotalsSQL({
      sql,
      fromClause: querySource,
      whereClause,
      groupByParts,
      dimensionSelects,
      metricSelects,
      dimensionAliases,
      insight,
      options,
      validColumns,
      pivotSort,
      deferPivotResultOrder,
    });
  }
  if (pivotSort) {
    return buildPivotRowSelectionSQL(sql, pivotSort, options, [
      ...dimensionAliases,
      ...metricAliases,
    ]);
  }
  return appendPagination(sql, options, validColumns);
}

function alignComparisonDimensions(
  groupByParts: string[],
  dimensionSelects: string[],
  selectedFields: string[],
  alignment: { fieldId: string; shift: string } | undefined,
): void {
  if (alignment) {
    const index = selectedFields.indexOf(alignment.fieldId);
    const expression = groupByParts[index];
    if (expression) {
      const alias = quoteIdentifier(fieldIdToColumnAlias(alignment.fieldId));
      const aligned = expression.replaceAll(
        alias,
        `(${alias} + ${alignment.shift})`,
      );
      groupByParts[index] = aligned;
      dimensionSelects[index] = `${aligned} AS ${alias}`;
    }
  }
}

function buildPresentationPeriodComparisonSQL(
  fromClause: string,
  fields: Field[],
  insight: Insight,
  options: BuildInsightSQLOptions,
): string {
  const { comparison, dateRange, ...reporting } = insight.reporting!;
  if (!dateRange) throw new Error("Period comparison requires a date range");
  const currentRange =
    dateRange.range.type === "absolute"
      ? absoluteDateRange(
          new Date(dateRange.range.start),
          new Date(dateRange.range.end),
        )
      : resolveRelativeDateRange(dateRange.range, options.asOf ?? new Date());
  const baselineRange =
    comparison === "previous_year"
      ? previousYear(currentRange)
      : previousPeriod(currentRange);
  const shift = comparisonShift(
    currentRange.start,
    baselineRange.start,
    comparison === "previous_year",
  );
  const currentInsight: Insight = {
    ...insight,
    reporting: { ...reporting, totals: false },
    filters: reportDateFilters(
      {
        fieldId: dateRange.fieldId,
        range: {
          type: "absolute",
          start: currentRange.start.toISOString(),
          end: currentRange.end.toISOString(),
        },
      },
      fields,
      options.asOf,
      insight.filters,
    ),
  };
  const canonicalOptions = { ...options, presentation: undefined };
  const eligibleInsight: Insight = {
    ...currentInsight,
    reporting: {
      ...currentInsight.reporting,
      measureIds: canonicalMeasureIds(currentInsight, options),
    },
  };
  const canonicalEligible = buildAggregatedSQL(
    fromClause,
    fields,
    eligibleInsight,
    canonicalOptions,
  );
  const fieldMap = buildFieldIdMap(fields);
  const currentSource = buildTopNSource(fromClause, currentInsight, fieldMap);
  const currentDimensions = buildDimensionColumns(
    insight.selectedFields,
    fieldMap,
    reporting,
  );
  const { whereClause: currentWhere } = buildFilterClauses(
    currentInsight,
    fieldMap,
    true,
    "alias",
  );
  const eligibleMetrics = buildMetricColumnsWithUUID(
    eligibleInsight.metrics,
    fieldMap,
    eligibleInsight.reporting?.measureIds,
  ).columnAliases;
  const currentEligible = eligibleWithPresentationOrdinal(
    canonicalEligible,
    currentDimensions.columnAliases,
    eligibleMetrics,
    options,
    resolvePivotSortContext(fields, eligibleInsight, options),
  );
  const currentRows = rawCohortSource(
    currentSource,
    currentWhere,
    currentDimensions.groupByParts,
    currentDimensions.columnAliases,
    currentEligible,
  );
  const current = buildPresentationAggregate(
    currentRows,
    fields,
    currentInsight,
    options.presentation!,
    undefined,
    true,
  );

  const dateAlias = quoteIdentifier(fieldIdToColumnAlias(dateRange.fieldId));
  const membership = currentDimensions.groupByParts.map((expression, index) => {
    let shifted = expression.replaceAll(dateAlias, `(${dateAlias} + ${shift})`);
    for (const field of fields) {
      const alias = quoteIdentifier(fieldIdToColumnAlias(field.id));
      shifted = shifted.replaceAll(alias, `"__comparison_raw".${alias}`);
    }
    return `${shifted} IS NOT DISTINCT FROM "__comparison_groups".${quoteIdentifier(currentDimensions.columnAliases[index]!)}`;
  });
  const { whereClause } = buildFilterClauses(insight, fieldMap, true, "alias");
  const predicates = [
    `${dateAlias} >= ${quoteLiteral(baselineRange.start.toISOString())}`,
    `${dateAlias} < ${quoteLiteral(baselineRange.end.toISOString())}`,
    ...(whereClause ? [whereClause.replace(/^WHERE /, "")] : []),
  ];
  const baselineRows =
    `(SELECT "__comparison_raw".*, "__comparison_groups"."__presentation_ordinal" ` +
    `FROM (SELECT * FROM ${fromClause} WHERE ${predicates.join(" AND ")}) AS "__comparison_raw" ` +
    `JOIN (${currentEligible}) AS "__comparison_groups" ON ${membership.join(" AND ") || "TRUE"}) AS "__comparison_rows"`;
  const baseline = buildPresentationAggregate(
    baselineRows,
    fields,
    { ...currentInsight, filters: [] },
    options.presentation!,
    { fieldId: dateRange.fieldId, shift },
  );
  const joins = current.aliases.map((alias) => {
    const column = quoteIdentifier(alias);
    return `"c".${column} IS NOT DISTINCT FROM "b".${column}`;
  });
  const changes = comparisonColumns(insight);
  const currentOutput = current.outputAliases.map(
    (alias) => `"c".${quoteIdentifier(alias)}`,
  );
  return `WITH "__comparison_current" AS (${current.sql}), "__comparison_baseline" AS (${baseline.sql}) SELECT ${[...currentOutput, ...changes].join(", ")} FROM "__comparison_current" AS "c" LEFT JOIN "__comparison_baseline" AS "b" ON ${joins.join(" AND ") || "TRUE"} ORDER BY "c"."__presentation_ordinal" ASC`;
}

/** Baselines use the current report's retained groups, including Top N/HAVING. */
function buildPeriodComparisonSQL(
  fromClause: string,
  fields: Field[],
  insight: Insight,
  options: BuildInsightSQLOptions,
  deferPivotResultOrder = false,
): string {
  const { comparison, dateRange, ...reporting } = insight.reporting!;
  if (!dateRange) throw new Error("Period comparison requires a date range");
  // Validates the date field and the range through the same path as ordinary reports.
  reportDateFilters(dateRange, fields, options.asOf, []);
  const currentRange =
    dateRange.range.type === "absolute"
      ? absoluteDateRange(
          new Date(dateRange.range.start),
          new Date(dateRange.range.end),
        )
      : resolveRelativeDateRange(dateRange.range, options.asOf ?? new Date());
  const baselineRange =
    comparison === "previous_year"
      ? previousYear(currentRange)
      : previousPeriod(currentRange);
  const shift = comparisonShift(
    currentRange.start,
    baselineRange.start,
    comparison === "previous_year",
  );
  const dateAlias = quoteIdentifier(fieldIdToColumnAlias(dateRange.fieldId));
  const current = buildAggregatedSQL(
    fromClause,
    fields,
    {
      ...insight,
      reporting: {
        ...reporting,
        dateRange: {
          fieldId: dateRange.fieldId,
          range: {
            type: "absolute",
            start: currentRange.start.toISOString(),
            end: currentRange.end.toISOString(),
          },
        },
      },
    },
    options,
  );
  const fieldMap = buildFieldIdMap(fields);
  const { groupByParts, columnAliases } = buildDimensionColumns(
    insight.selectedFields,
    fieldMap,
    reporting,
  );
  const hasTotals = Boolean(
    reporting.totals && groupByParts.length && insight.metrics.length,
  );
  const membership = groupByParts.map((expression, index) => {
    let shifted = expression.replaceAll(dateAlias, `(${dateAlias} + ${shift})`);
    for (const field of fields) {
      const alias = quoteIdentifier(fieldIdToColumnAlias(field.id));
      shifted = shifted.replaceAll(alias, `"__comparison_raw".${alias}`);
    }
    return `${shifted} IS NOT DISTINCT FROM "__comparison_current".${quoteIdentifier(columnAliases[index]!)}`;
  });
  if (hasTotals)
    membership.push('"__comparison_current"."__report_grouping" = 0');
  const { whereClause } = buildFilterClauses(insight, fieldMap, true, "alias");
  const membershipWhere = membership.length
    ? ` WHERE ${membership.join(" AND ")}`
    : "";
  const predicates = [
    `${dateAlias} >= ${quoteLiteral(baselineRange.start.toISOString())}`,
    `${dateAlias} < ${quoteLiteral(baselineRange.end.toISOString())}`,
    ...(whereClause ? [whereClause.replace(/^WHERE /, "")] : []),
    `EXISTS (SELECT 1 FROM "__comparison_current"${membershipWhere})`,
  ];
  const baselineSource = `(SELECT * FROM (SELECT * FROM ${fromClause}) AS "__comparison_raw" WHERE ${predicates.join(" AND ")}) AS "__comparison_source"`;
  const baseline = buildAggregatedSQL(
    baselineSource,
    fields,
    {
      ...insight,
      filters: [],
      sorts: [],
      reporting: { ...reporting, topN: undefined, limit: undefined },
    },
    { mode: "query" },
    { fieldId: dateRange.fieldId, shift },
  );
  const joins = columnAliases.map((alias) => {
    const column = quoteIdentifier(alias);
    return `"c".${column} IS NOT DISTINCT FROM "b".${column}`;
  });
  if (hasTotals)
    joins.push('"c"."__report_grouping" = "b"."__report_grouping"');
  const changes = comparisonColumns(insight);
  const order = comparisonOrder(
    options,
    columnAliases,
    insight,
    fields,
    hasTotals,
    deferPivotResultOrder,
  );
  return `WITH "__comparison_current" AS (${current}), "__comparison_baseline" AS (${baseline}) SELECT "c".*, ${changes.join(", ")} FROM "__comparison_current" AS "c" LEFT JOIN "__comparison_baseline" AS "b" ON ${joins.join(" AND ") || "TRUE"}${order}`;
}

function comparisonOrder(
  options: BuildInsightSQLOptions,
  dimensions: string[],
  insight: Insight,
  fields: Field[],
  hasTotals: boolean,
  deferPivotResultOrder: boolean,
): string {
  const pivotSort = resolvePivotSortContext(fields, insight, options);
  if (pivotSort) {
    if (deferPivotResultOrder) {
      return hasTotals ? ' ORDER BY "c"."__report_grouping" ASC' : "";
    }
    return ` ORDER BY ${pivotResultOrder(
      pivotSort,
      "c",
      options.sortDirection!,
      hasTotals,
    ).join(", ")}`;
  }
  const parts = hasTotals ? ['"c"."__report_grouping" ASC'] : [];
  const allowed = new Set([
    ...dimensions,
    ...(
      insight.reporting?.measureIds ??
      insight.metrics.map((metric) => metric.id)
    ).map(metricIdToColumnAlias),
  ]);
  if (
    options.sortColumn &&
    options.sortDirection &&
    allowed.has(options.sortColumn) &&
    SORT_DIRECTION_WHITELIST.has(options.sortDirection)
  ) {
    parts.push(
      `"c".${quoteIdentifier(options.sortColumn)} ${options.sortDirection.toUpperCase()}`,
    );
  }
  return parts.length ? ` ORDER BY ${parts.join(", ")}` : "";
}

function comparisonShift(current: Date, baseline: Date, year: boolean): string {
  const months =
    (current.getUTCFullYear() - baseline.getUTCFullYear()) * 12 +
    current.getUTCMonth() -
    baseline.getUTCMonth();
  const calendar = [current, baseline].every(
    (date) =>
      date.getUTCDate() === 1 &&
      date.getUTCHours() === 0 &&
      date.getUTCMinutes() === 0 &&
      date.getUTCSeconds() === 0 &&
      date.getUTCMilliseconds() === 0,
  );
  const sameCalendarDay =
    current.getUTCMonth() === baseline.getUTCMonth() &&
    current.getUTCDate() === baseline.getUTCDate();
  if ((year && sameCalendarDay) || calendar)
    return `INTERVAL '${year ? 12 : months} months'`;
  return `INTERVAL '${current.getTime() - baseline.getTime()} milliseconds'`;
}

function comparisonColumns(insight: Insight): string[] {
  const metrics =
    insight.reporting?.measureIds ?? insight.metrics.map((metric) => metric.id);
  if (!metrics.length) throw new Error("Period comparison requires a measure");
  return metrics.flatMap((id) => {
    const alias = metricIdToColumnAlias(id);
    const current = `"c".${quoteIdentifier(alias)}`;
    const baseline = `"b".${quoteIdentifier(alias)}`;
    const difference = `(${current} - ${baseline})`;
    return [
      `${baseline} AS ${quoteIdentifier(alias + "_previous")}`,
      `${difference} AS ${quoteIdentifier(alias + "_change")}`,
      `(${difference} / NULLIF(${baseline}, 0) * 100) AS ${quoteIdentifier(alias + "_change_percent")}`,
    ];
  });
}

function eligibleTopNSource(
  fromClause: string,
  insight: Insight,
  fields: Map<string, Field>,
): string {
  const { whereClause, havingClause } = buildFilterClauses(
    insight,
    fields,
    true,
    "alias",
  );
  if (!havingClause) return fromClause;
  const { selectParts, groupByParts, columnAliases } = buildDimensionColumns(
    insight.selectedFields,
    fields,
    insight.reporting,
  );
  const eligible = `SELECT ${selectParts.join(", ")} FROM ${fromClause} ${whereClause} GROUP BY ${groupByParts.join(", ")} ${havingClause}`;
  const matches = groupByParts.map((expression, index) => {
    const alias = quoteIdentifier(columnAliases[index]!);
    const qualified = expression.replaceAll(
      alias,
      `"__eligible_source".${alias}`,
    );
    return `${qualified} IS NOT DISTINCT FROM "__eligible_groups".${alias}`;
  });
  return `(SELECT "__eligible_source".* FROM (SELECT * FROM ${fromClause} ${whereClause}) AS "__eligible_source" WHERE EXISTS (SELECT 1 FROM (${eligible}) AS "__eligible_groups" WHERE ${matches.join(" AND ")})) AS "__eligible_rank_source"`;
}

/** Rank a selected dimension independently of the other grouping dimensions. */
function buildTopNSource(
  fromClause: string,
  insight: Insight,
  fields: Map<string, Field>,
): string {
  const top = insight.reporting?.topN;
  if (!top) return fromClause;
  if (
    !Number.isInteger(top.count) ||
    top.count < 1 ||
    top.count > 10000 ||
    !SORT_DIRECTION_WHITELIST.has(top.direction)
  )
    throw new Error("Invalid Top N settings");
  const field = fields.get(top.fieldId);
  const metric = insight.metrics.find(
    (candidate) => candidate.id === top.measureId,
  );
  if (!field || !metric || !insight.selectedFields.includes(top.fieldId))
    throw new Error("Top N references an unavailable dimension or measure");
  fromClause = eligibleTopNSource(fromClause, insight, fields);
  const alias = quoteIdentifier(fieldIdToColumnAlias(field.id));
  const { groupByParts } = buildDimensionColumns(
    [field.id],
    fields,
    insight.reporting,
  );
  const dimension = groupByParts[0]!;
  const measure = compileMeasure(metric, insight.metrics, fields);
  const { whereClause } = buildFilterClauses(insight, fields, true, "alias");
  const ranking = `SELECT ${dimension} AS ${alias} FROM ${fromClause} ${whereClause} GROUP BY ${dimension} ORDER BY ${measure} ${top.direction.toUpperCase()}, ${dimension} ASC NULLS LAST LIMIT ${top.count}`;
  const outer = dimension.replaceAll(alias, `"__rank_source".${alias}`);
  return `(SELECT "__rank_source".* FROM (SELECT * FROM ${fromClause}) AS "__rank_source" WHERE EXISTS (SELECT 1 FROM (${ranking}) AS "__ranked" WHERE ${outer} IS NOT DISTINCT FROM "__ranked".${alias})) AS "__rank_result"`;
}

/** Re-aggregate contributing source rows, including after HAVING and Top N. */
function buildReportTotalsSQL(args: {
  sql: string;
  fromClause: string;
  whereClause: string;
  groupByParts: string[];
  dimensionSelects: string[];
  metricSelects: string[];
  dimensionAliases: string[];
  insight: Insight;
  options: BuildInsightSQLOptions;
  validColumns: Set<string>;
  pivotSort?: PivotSortContext;
  deferPivotResultOrder: boolean;
}): string {
  const {
    sql,
    fromClause,
    whereClause,
    groupByParts,
    dimensionSelects,
    metricSelects,
    dimensionAliases,
    insight,
    options,
    validColumns,
    pivotSort,
    deferPivotResultOrder,
  } = args;
  if (groupByParts.length > 16)
    throw new Error("Totals support at most 16 dimensions");
  const eligible = pivotSort
    ? buildPivotRowSelectionSQL(sql, pivotSort, options, [
        ...dimensionAliases,
        ...(
          insight.reporting?.measureIds ??
          insight.metrics.map((metric) => metric.id)
        ).map(metricIdToColumnAlias),
      ])
    : appendPagination(sql, options, validColumns);
  const sourceAlias = quoteIdentifier("__report_source");
  const matches = groupByParts.map((expression, index) => {
    const alias = quoteIdentifier(dimensionAliases[index]!);
    const qualified = expression.replaceAll(alias, `${sourceAlias}.${alias}`);
    return `${qualified} IS NOT DISTINCT FROM "__report_groups".${alias}`;
  });
  const pivot = new Set(insight.reporting?.pivotFields ?? []);
  const rows = groupByParts.filter(
    (_, index) => !pivot.has(insight.selectedFields[index]!),
  );
  const columns = groupByParts.filter((_, index) =>
    pivot.has(insight.selectedFields[index]!),
  );
  const sets = new Set([groupByParts.join(", "), ""]);
  if (rows.length && columns.length) {
    sets.add(rows.join(", "));
    sets.add(columns.join(", "));
  }
  const grouping = `GROUPING(${groupByParts.join(", ")})`;
  const selections = [
    ...dimensionSelects,
    ...metricSelects,
    `${grouping} AS "__report_grouping"`,
  ].join(", ");
  const groupingSets = [...sets].map((set) => `(${set})`).join(", ");
  const grouped =
    `WITH "__report_groups" AS (${eligible}), "__report_rows" AS (` +
    `SELECT ${sourceAlias}.* FROM (SELECT * FROM ${fromClause} ${whereClause}) AS ${sourceAlias} ` +
    `WHERE EXISTS (SELECT 1 FROM "__report_groups" WHERE ${matches.join(" AND ")})) ` +
    `SELECT ${selections} ` +
    `FROM "__report_rows" GROUP BY GROUPING SETS (${groupingSets})`;
  if (pivotSort) {
    const output = [
      ...dimensionAliases,
      ...(
        insight.reporting?.measureIds ??
        insight.metrics.map((metric) => metric.id)
      ).map(metricIdToColumnAlias),
      "__report_grouping",
    ].map((column) => qualifiedColumn("__pivot_report", column));
    const projected = `SELECT ${output.join(", ")} FROM (${grouped}) AS "__pivot_report"`;
    if (deferPivotResultOrder) return projected;
    return `${projected} ORDER BY ${pivotResultOrder(
      pivotSort,
      "__pivot_report",
      options.sortDirection!,
      true,
    ).join(", ")}`;
  }
  let result = `${grouped} ORDER BY "__report_grouping" ASC`;
  if (
    options.sortColumn &&
    options.sortDirection &&
    validColumns.has(options.sortColumn)
  ) {
    result += `, ${quoteIdentifier(options.sortColumn)} ${options.sortDirection.toUpperCase()}`;
  }
  return result;
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
