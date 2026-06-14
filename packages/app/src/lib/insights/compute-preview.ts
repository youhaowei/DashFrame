import type {
  DataFrameColumn,
  DataFrameData,
  DataTable,
  Field,
  Insight,
  InsightMetric,
  UUID,
} from "@dashframe/types";

/**
 * Preview result containing sample data and metadata.
 * Uses DataFrameData (plain object with rows) for in-memory processing.
 */
export interface PreviewResult {
  dataFrame: DataFrameData;
  rowCount: number; // Total rows (after aggregation)
  sampleSize: number; // Rows in preview
}

/**
 * Computes a preview DataFrame from an insight.
 * Implements implicit GROUP BY: selected fields define grouping dimensions,
 * metrics define aggregations to compute per group.
 *
 * @param insight - The insight to preview (uses flat schema: selectedFields, not baseTable.selectedFields)
 * @param dataTable - The base data table
 * @param sourceDataFrame - The source DataFrameData containing the full data (plain object with rows)
 * @param maxRows - Maximum rows to include in preview (default: 50)
 * @returns Preview result with aggregated DataFrame
 */
export function computeInsightPreview(
  insight: Insight,
  dataTable: DataTable,
  sourceDataFrame: DataFrameData,
  maxRows = 50,
): PreviewResult {
  // Use flat schema: selectedFields directly on insight, not insight.baseTable.selectedFields
  const selectedFieldIds = insight.selectedFields ?? [];
  const metrics = insight.metrics ?? [];
  // Note: filters is now InsightFilter[] array, not object with excludeNulls/limit/orderBy
  // [Future] Implement InsightFilter array processing when filter UI is built

  // Get selected fields
  const selectedFields = dataTable.fields.filter((f) =>
    selectedFieldIds.includes(f.id),
  );

  // Create field ID to field mapping for lookups
  const fieldMap = new Map<UUID, Field>(dataTable.fields.map((f) => [f.id, f]));

  // Use source data rows
  const rows = sourceDataFrame.rows;

  // Implicit GROUP BY logic:
  // - If no selected fields → grand total (single aggregated row)
  // - If selected fields → group by those fields, compute metrics per group
  let aggregatedRows: Record<string, unknown>[];

  if (selectedFields.length === 0) {
    // No grouping - compute grand total
    const computedMetrics = computeMetrics(rows, metrics, fieldMap);
    aggregatedRows = [computedMetrics];
  } else {
    // Group by selected fields
    const groups = groupRowsBy(rows, selectedFields, fieldMap);

    // Compute metrics for each group
    aggregatedRows = groups.map((group) => {
      const groupKeys = extractGroupKeys(
        group.rows[0]!,
        selectedFields,
        fieldMap,
      );
      const computedMetrics = computeMetrics(group.rows, metrics, fieldMap);
      return { ...groupKeys, ...computedMetrics };
    });
  }

  // Apply limit for preview
  const totalRows = aggregatedRows.length;
  const limitedRows = aggregatedRows.slice(0, maxRows);

  // Build column metadata
  const columns: DataFrameColumn[] = [
    ...selectedFields.map((field) => ({
      name: field.name,
      type: field.type,
    })),
    ...metrics.map((metric) => ({
      name: metric.name,
      type: "number" as const,
    })),
  ];

  // Build preview DataFrameData (plain object format)
  const previewDataFrame: DataFrameData = {
    columns,
    rows: limitedRows,
  };

  return {
    dataFrame: previewDataFrame,
    rowCount: totalRows,
    sampleSize: limitedRows.length,
  };
}

/**
 * Groups rows by the specified fields.
 *
 * @param rows - Rows to group
 * @param fields - Fields to group by
 * @param fieldMap - Map of field IDs to Field objects
 * @returns Array of groups, each containing rows with the same field values
 */
function groupRowsBy(
  rows: Record<string, unknown>[],
  fields: Field[],
  _fieldMap: Map<UUID, Field>,
): Array<{ key: string; rows: Record<string, unknown>[] }> {
  const groupMap = new Map<string, Record<string, unknown>[]>();

  for (const row of rows) {
    // Build a collision-resistant key using typed tuples per field.
    //
    // The encoding is a TOTAL, injective function over every value DuckDB
    // can produce (string, finite number, bigint, boolean, null/undefined,
    // non-finite number). Two distinct values must never share a key; no
    // value may throw. Type tags prevent cross-type collisions (e.g. the
    // string "1" vs the number 1 vs the bigint 1n each produce distinct keys).
    //
    // Tags:
    //   ["null"]           — null or undefined
    //   ["num", str]       — non-finite numbers: "NaN", "Infinity", "-Infinity"
    //                        (JSON.stringify coerces these to null otherwise)
    //   ["bigint", str]    — BigInt values (JSON.stringify THROWS on bigint)
    //   ["v", value]       — everything else: string, finite number, boolean
    //
    // Column lookup: field.columnName ?? field.name (codebase convention,
    // matching compute-combined-fields.ts and the SQL builder helpers).
    const keyParts = fields.map((field) => {
      const colKey = field.columnName ?? field.name;
      const value = row[colKey];
      if (value == null) return ["null"];
      if (typeof value === "bigint") return ["bigint", value.toString()];
      if (typeof value === "number" && !isFinite(value)) {
        return ["num", String(value)]; // "NaN", "Infinity", "-Infinity"
      }
      return ["v", value];
    });
    const key = JSON.stringify(keyParts);

    // Add row to group
    if (!groupMap.has(key)) {
      groupMap.set(key, []);
    }
    groupMap.get(key)!.push(row);
  }

  return Array.from(groupMap.entries()).map(([key, rows]) => ({ key, rows }));
}

/**
 * Extracts group key values from a row.
 *
 * @param row - Row to extract from
 * @param fields - Fields to extract
 * @param fieldMap - Map of field IDs to Field objects
 * @returns Object with field names as keys
 */
function extractGroupKeys(
  row: Record<string, unknown>,
  fields: Field[],
  _fieldMap: Map<UUID, Field>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const field of fields) {
    // Use columnName when available; fall back to field.name (codebase
    // convention: columnName ?? name, matching compute-combined-fields.ts)
    // so that fields without a columnName still contribute a value instead
    // of being silently dropped from the output row.
    const colKey = field.columnName ?? field.name;
    result[field.name] = row[colKey];
  }

  return result;
}

/**
 * Computes metrics (aggregations) over a set of rows.
 * Returns an object with metric names as keys and computed values.
 *
 * @param rows - Rows to aggregate over
 * @param metrics - Metric definitions
 * @param fieldMap - Map of field IDs to Field objects
 * @returns Object with metric values
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Complex by design: handles multiple aggregation types (count, sum, avg, min, max, count_distinct)
function computeMetrics(
  rows: Record<string, unknown>[],
  metrics: InsightMetric[],
  _fieldMap: Map<UUID, Field>,
): Record<string, number> {
  const result: Record<string, number> = {};

  for (const metric of metrics) {
    const columnName = metric.columnName;

    let value = 0;

    switch (metric.aggregation) {
      case "count": {
        // Count non-null rows
        value = rows.length;
        break;
      }
      case "count_distinct": {
        // Count distinct values
        if (columnName) {
          const values = rows
            .map((r) => r[columnName])
            .filter((v) => v != null);
          value = new Set(values).size;
        }
        break;
      }
      case "sum": {
        // Sum of numeric values
        if (columnName) {
          value = rows.reduce((sum, r) => {
            const val = r[columnName];
            return sum + (typeof val === "number" ? val : 0);
          }, 0);
        }
        break;
      }
      case "avg": {
        // Average of numeric values
        if (columnName) {
          const values = rows
            .map((r) => r[columnName])
            .filter((v) => typeof v === "number") as number[];
          value =
            values.length > 0
              ? values.reduce((sum, v) => sum + v, 0) / values.length
              : 0;
        }
        break;
      }
      case "min": {
        // Minimum value
        if (columnName) {
          const values = rows
            .map((r) => r[columnName])
            .filter((v) => typeof v === "number") as number[];
          value =
            values.length > 0
              ? values.reduce((a, b) => (a < b ? a : b), Infinity)
              : 0;
        }
        break;
      }
      case "max": {
        // Maximum value
        if (columnName) {
          const values = rows
            .map((r) => r[columnName])
            .filter((v) => typeof v === "number") as number[];
          value =
            values.length > 0
              ? values.reduce((a, b) => (a > b ? a : b), -Infinity)
              : 0;
        }
        break;
      }
    }

    result[metric.name] = value;
  }

  return result;
}

/**
 * Computes a full DataFrame from an insight (no sampling).
 * This is used when creating a visualization (not just previewing).
 *
 * @param insight - The insight to compute
 * @param dataTable - The base data table
 * @param sourceDataFrame - The source DataFrameData containing the full data (plain object with rows)
 * @returns Full DataFrameData with aggregated data
 */
export function computeInsightDataFrame(
  insight: Insight,
  dataTable: DataTable,
  sourceDataFrame: DataFrameData,
): DataFrameData {
  // For full compute, call preview with maxRows = Infinity
  // This applies all filters and grouping without limiting preview rows
  const result = computeInsightPreview(
    insight,
    dataTable,
    sourceDataFrame,
    Infinity,
  );
  return result.dataFrame;
}
