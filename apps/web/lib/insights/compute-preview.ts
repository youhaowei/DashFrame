import type { DataFrame, UUID, Field } from "@dashframe/dataframe";
import type { Insight, DataTable, InsightMetric } from "../stores/types";

/**
 * Preview result containing sample data and metadata
 */
export interface PreviewResult {
  dataFrame: DataFrame;
  rowCount: number; // Total rows (before sampling)
  sampleSize: number; // Rows in preview
}

/**
 * Computes a preview DataFrame from an insight.
 * Returns a sample of the data (up to maxRows) with selected fields and metrics.
 *
 * @param insight - The insight to preview
 * @param dataTable - The base data table
 * @param sourceDataFrame - The source DataFrame containing the full data
 * @param maxRows - Maximum rows to include in preview (default: 50)
 * @returns Preview result with sampled DataFrame
 */
export function computeInsightPreview(
  insight: Insight,
  dataTable: DataTable,
  sourceDataFrame: DataFrame,
  maxRows = 50
): PreviewResult {
  const { baseTable, metrics } = insight;

  // Get selected fields
  const selectedFields = dataTable.fields.filter((f) =>
    baseTable.selectedFields.includes(f.id)
  );

  // Create field ID to field mapping for lookups
  const fieldMap = new Map<UUID, Field>(
    dataTable.fields.map((f) => [f.id, f])
  );

  // Sample rows (first N rows for preview)
  const totalRows = sourceDataFrame.rows.length;
  const sampleRows = sourceDataFrame.rows.slice(0, maxRows);

  // Build preview rows with only selected fields
  const previewRows = sampleRows.map((row) => {
    const previewRow: Record<string, unknown> = {};

    // Add selected fields
    for (const fieldId of baseTable.selectedFields) {
      const field = fieldMap.get(fieldId);
      if (field && field.columnName) {
        // Use field name as key (user-facing)
        previewRow[field.name] = row[field.columnName];
      }
    }

    return previewRow;
  });

  // Compute metrics (if any)
  // For preview, we'll compute metrics across the sampled data
  const computedMetrics = computeMetrics(sampleRows, metrics, fieldMap);

  // Add metrics to each row (they're aggregations, so same value for all rows)
  const rowsWithMetrics = previewRows.map((row) => ({
    ...row,
    ...computedMetrics,
  }));

  // Build column metadata for selected fields and metrics
  const columns = [
    ...selectedFields.map((field) => ({
      name: field.name,
      type: field.type,
    })),
    ...metrics.map((metric) => ({
      name: metric.name,
      type: "number" as const, // Metrics are always numbers
    })),
  ];

  // Build preview DataFrame
  const previewDataFrame: DataFrame = {
    fieldIds: [
      ...baseTable.selectedFields,
      ...metrics.map((m) => m.id), // Metric IDs as field IDs
    ],
    columns, // Add column metadata
    rows: rowsWithMetrics,
    primaryKey: sourceDataFrame.primaryKey,
  };

  return {
    dataFrame: previewDataFrame,
    rowCount: totalRows,
    sampleSize: rowsWithMetrics.length,
  };
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
function computeMetrics(
  rows: Record<string, unknown>[],
  metrics: InsightMetric[],
  fieldMap: Map<UUID, Field>
): Record<string, number> {
  const result: Record<string, number> = {};

  for (const metric of metrics) {
    const field = fieldMap.get(metric.sourceTable); // In v1, sourceTable is the field ID
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
          const values = rows.map((r) => r[columnName]).filter((v) => v != null);
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
          value = values.length > 0
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
          value = values.length > 0 ? Math.min(...values) : 0;
        }
        break;
      }
      case "max": {
        // Maximum value
        if (columnName) {
          const values = rows
            .map((r) => r[columnName])
            .filter((v) => typeof v === "number") as number[];
          value = values.length > 0 ? Math.max(...values) : 0;
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
 * @param sourceDataFrame - The source DataFrame containing the full data
 * @returns Full DataFrame with selected fields and metrics
 */
export function computeInsightDataFrame(
  insight: Insight,
  dataTable: DataTable,
  sourceDataFrame: DataFrame
): DataFrame {
  // For full compute, just call preview with maxRows = Infinity
  const result = computeInsightPreview(
    insight,
    dataTable,
    sourceDataFrame,
    Infinity
  );
  return result.dataFrame;
}
