import type { VisualizationType, Insight } from "../stores/types";
import type { DataFrameData, Field } from "@dashframe/types";
import type { ColumnAnalysis } from "@dashframe/types";
import type { SuggestionEncoding } from "./suggest-charts";

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
  currentEncoding: SuggestionEncoding = {},
  insight?: Insight,
): SuggestionEncoding {
  // Simple analysis based on column types
  const analysis: ColumnAnalysis[] = (dataFrame.columns || []).map((col) => {
    const typeStr = String(col.type).toLowerCase();

    // Map type string to dataType and semantic
    if (
      typeStr === "number" ||
      typeStr === "integer" ||
      typeStr === "float" ||
      typeStr === "decimal" ||
      typeStr === "double"
    ) {
      return {
        columnName: col.name,
        dataType: "number" as const,
        semantic: "numerical" as const,
        min: 0,
        max: 0,
        cardinality: 0,
        uniqueness: 0,
        nullCount: 0,
        sampleValues: [],
      };
    } else if (
      typeStr === "date" ||
      typeStr === "datetime" ||
      typeStr === "timestamp" ||
      typeStr === "time"
    ) {
      return {
        columnName: col.name,
        dataType: "date" as const,
        semantic: "temporal" as const,
        minDate: 0,
        maxDate: 0,
        cardinality: 0,
        uniqueness: 0,
        nullCount: 0,
        sampleValues: [],
      };
    } else if (typeStr === "boolean") {
      return {
        columnName: col.name,
        dataType: "boolean" as const,
        semantic: "boolean" as const,
        trueCount: 0,
        falseCount: 0,
        cardinality: 0,
        uniqueness: 0,
        nullCount: 0,
        sampleValues: [],
      };
    } else {
      return {
        columnName: col.name,
        dataType: "string" as const,
        semantic: "categorical" as const,
        cardinality: 0,
        uniqueness: 0,
        nullCount: 0,
        sampleValues: [],
      };
    }
  });

  // Get metric names if insight is provided
  const metricNames = new Set(insight?.metrics?.map((m) => m.name) || []);

  // Helper to check if column exists in analysis
  const columnExists = (colName: string | undefined) =>
    colName && analysis.some((a) => a.columnName === colName);

  // Semantics we want to avoid for Y-axis in most charts
  const nonMeasureSemantics = new Set([
    "identifier",
    "reference",
    "email",
    "url",
    "uuid",
  ]);

  let newEncoding = { ...currentEncoding };

  if (type === "barY" || type === "line" || type === "areaY") {
    // For these charts: X is usually categorical/temporal, Y is numeric

    // Preserve X if it's valid (exists in analysis)
    let xColumn = newEncoding.x;
    if (!columnExists(xColumn)) {
      // Prefer temporal for line/area, categorical for bar
      if (type === "line" || type === "areaY") {
        xColumn = analysis.find((a) => a.semantic === "temporal")?.columnName;
      }
      if (!xColumn) {
        xColumn = analysis.find(
          (a) =>
            a.semantic === "categorical" ||
            a.semantic === "text" ||
            a.semantic === "boolean",
        )?.columnName;
      }
      // Fallback to first non-numerical column
      if (!xColumn) {
        xColumn = analysis.find((a) => a.semantic !== "numerical")?.columnName;
      }
      // Last resort: first column
      if (!xColumn && analysis.length > 0) {
        xColumn = analysis[0].columnName;
      }
    }

    // Preserve Y if it's valid AND numeric
    let yColumn = newEncoding.y;
    const yAnalysis = analysis.find((a) => a.columnName === yColumn);
    if (!yColumn || yAnalysis?.semantic !== "numerical") {
      // PRIORITY 1: Prefer metrics (aggregated columns)
      const metricColumn = analysis.find(
        (a) => a.semantic === "numerical" && metricNames.has(a.columnName),
      )?.columnName;

      if (metricColumn) {
        yColumn = metricColumn;
      } else {
        // PRIORITY 2: Find a numerical column that's not an identifier
        yColumn = analysis.find(
          (a) =>
            a.semantic === "numerical" && !nonMeasureSemantics.has(a.semantic),
        )?.columnName;

        // PRIORITY 3: Fallback to any numerical column
        if (!yColumn) {
          yColumn = analysis.find(
            (a) => a.semantic === "numerical",
          )?.columnName;
        }
      }
    }

    newEncoding = {
      ...newEncoding,
      x: xColumn,
      y: yColumn,
    };
  } else if (type === "dot") {
    // For scatter: X and Y should both be numeric

    const numericalColumns = analysis.filter((a) => a.semantic === "numerical");

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
        (a) => a.columnName !== xColumn && !nonMeasureSemantics.has(a.semantic),
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
