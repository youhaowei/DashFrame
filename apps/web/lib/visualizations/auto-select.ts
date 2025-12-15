import type {
  VisualizationType,
  VisualizationEncoding,
  Insight,
} from "../stores/types";
import type { DataFrameData, Field } from "@dashframe/types";
import type { ColumnAnalysis } from "@dashframe/engine-browser";

/**
 * Auto-selects axes based on chart type and column analysis.
 * Uses column categorization to make intelligent defaults.
 * Prefers metrics over raw fields for Y-axis when available.
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Complex by design: intelligent axis selection based on chart type, column analysis, and heuristics
export function autoSelectEncoding(
  type: VisualizationType,
  dataFrame: DataFrameData,
  fields?: Record<string, Field>,
  currentEncoding: VisualizationEncoding = {},
  insight?: Insight,
): VisualizationEncoding {
  // Simple analysis based on column types
  const analysis: ColumnAnalysis[] = (dataFrame.columns || []).map((col) => {
    let category: ColumnAnalysis["category"] = "unknown";
    const typeStr = String(col.type).toLowerCase();

    if (
      typeStr === "number" ||
      typeStr === "integer" ||
      typeStr === "float" ||
      typeStr === "decimal" ||
      typeStr === "double"
    ) {
      category = "numerical";
    } else if (
      typeStr === "date" ||
      typeStr === "datetime" ||
      typeStr === "timestamp" ||
      typeStr === "time"
    ) {
      category = "temporal";
    } else if (typeStr === "boolean") {
      category = "boolean";
    } else {
      category = "categorical";
    }

    return {
      columnName: col.name,
      category,
      cardinality: 0,
      uniqueness: 0,
      nullCount: 0,
      sampleValues: [],
    };
  });

  // Get metric names if insight is provided
  const metricNames = new Set(insight?.metrics?.map((m) => m.name) || []);

  // Helper to check if column exists in analysis
  const columnExists = (colName: string | undefined) =>
    colName && analysis.some((a) => a.columnName === colName);

  // Categories we want to avoid for Y-axis in most charts
  const nonMeasureCategories = new Set([
    "identifier",
    "reference",
    "email",
    "url",
    "uuid",
  ]);

  let newEncoding = { ...currentEncoding };

  if (type === "bar" || type === "line" || type === "area") {
    // For these charts: X is usually categorical/temporal, Y is numeric

    // Preserve X if it's valid (exists in analysis)
    let xColumn = newEncoding.x;
    if (!columnExists(xColumn)) {
      // Prefer temporal for line/area, categorical for bar
      if (type === "line" || type === "area") {
        xColumn = analysis.find((a) => a.category === "temporal")?.columnName;
      }
      if (!xColumn) {
        xColumn = analysis.find(
          (a) =>
            a.category === "categorical" ||
            a.category === "text" ||
            a.category === "boolean",
        )?.columnName;
      }
      // Fallback to first non-numerical column
      if (!xColumn) {
        xColumn = analysis.find((a) => a.category !== "numerical")?.columnName;
      }
      // Last resort: first column
      if (!xColumn && analysis.length > 0) {
        xColumn = analysis[0].columnName;
      }
    }

    // Preserve Y if it's valid AND numeric
    let yColumn = newEncoding.y;
    const yAnalysis = analysis.find((a) => a.columnName === yColumn);
    if (!yColumn || yAnalysis?.category !== "numerical") {
      // PRIORITY 1: Prefer metrics (aggregated columns)
      const metricColumn = analysis.find(
        (a) => a.category === "numerical" && metricNames.has(a.columnName),
      )?.columnName;

      if (metricColumn) {
        yColumn = metricColumn;
      } else {
        // PRIORITY 2: Find a numerical column that's not an identifier
        yColumn = analysis.find(
          (a) =>
            a.category === "numerical" && !nonMeasureCategories.has(a.category),
        )?.columnName;

        // PRIORITY 3: Fallback to any numerical column
        if (!yColumn) {
          yColumn = analysis.find(
            (a) => a.category === "numerical",
          )?.columnName;
        }
      }
    }

    newEncoding = {
      ...newEncoding,
      x: xColumn,
      y: yColumn,
    };
  } else if (type === "scatter") {
    // For scatter: X and Y should both be numeric

    const numericalColumns = analysis.filter((a) => a.category === "numerical");

    // Preserve X if it's valid AND numeric
    let xColumn = newEncoding.x;
    if (!numericalColumns.some((a) => a.columnName === xColumn)) {
      xColumn = numericalColumns[0]?.columnName;
    }

    // Preserve Y if it's valid AND numeric
    let yColumn = newEncoding.y;
    if (!numericalColumns.some((a) => a.columnName === yColumn)) {
      // Try to find a different numeric column for Y that's not an identifier
      yColumn = numericalColumns.find(
        (a) =>
          a.columnName !== xColumn && !nonMeasureCategories.has(a.category),
      )?.columnName;

      // Fallback to any numeric column different from X
      if (!yColumn) {
        yColumn = numericalColumns.find(
          (a) => a.columnName !== xColumn,
        )?.columnName;
      }

      // Last resort: use first numerical column
      if (!yColumn) {
        yColumn = numericalColumns[0]?.columnName;
      }
    }

    newEncoding = {
      ...newEncoding,
      x: xColumn,
      y: yColumn,
    };
  }

  return newEncoding;
}
