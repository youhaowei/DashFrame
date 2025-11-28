import type { TopLevelSpec } from "vega-lite";
import type { VisualizationType, VisualizationEncoding } from "../stores/types";
import type { Insight } from "../stores/types";
import {
  analyzeDataFrame,
  type EnhancedDataFrame,
  type Field,
  type ColumnAnalysis,
} from "@dashframe/dataframe";

// Helper to get CSS variable color value
function getCSSColor(variable: string): string {
  if (typeof window === "undefined") return "#000000";
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(variable)
    .trim();
  return value || "#000000";
}

// Get theme-aware Vega-Lite config for mini charts
function getVegaThemeConfig() {
  return {
    background: "transparent",
    view: {
      stroke: "transparent",
    },
    axis: {
      domainColor: getCSSColor("--color-border"),
      gridColor: getCSSColor("--color-border"),
      tickColor: getCSSColor("--color-border"),
      labelColor: getCSSColor("--color-foreground"),
      titleColor: getCSSColor("--color-foreground"),
      labelFont: "inherit",
      titleFont: "inherit",
      domain: false,
      ticks: false,
      grid: false,
    },
    legend: {
      labelColor: getCSSColor("--color-foreground"),
      titleColor: getCSSColor("--color-foreground"),
      labelFont: "inherit",
      titleFont: "inherit",
    },
  };
}

/**
 * Chart suggestion with visualization spec and metadata
 */
export interface ChartSuggestion {
  id: string;
  title: string; // e.g., "Revenue by Region"
  chartType: VisualizationType;
  encoding: VisualizationEncoding;
  spec: TopLevelSpec; // Mini spec for preview
  rationale?: string; // Why this chart was suggested
}

/**
 * Suggests up to 3 chart visualizations based on the insight's data structure.
 * Uses heuristics to match chart types to field categories.
 *
 * @param insight - The insight to generate suggestions for
 * @param preview - Preview DataFrame with sample data
 * @param fields - Field definitions for analysis
 * @param limit - Maximum number of suggestions (default: 3)
 * @returns Array of chart suggestions
 */
export function suggestCharts(
  insight: Insight,
  preview: EnhancedDataFrame,
  fields: Record<string, Field>,
  limit = 3,
  columnTableMap?: Record<string, string[]>,
): ChartSuggestion[] {
  // Analyze columns to categorize them
  const analysis = analyzeDataFrame(preview, fields);

  // Categories to avoid for chart encodings (identifiers/references should not be axes)
  const blockedAxisCategories = new Set([
    "identifier",
    "reference",
    "email",
    "url",
    "uuid",
  ]);

  // Helper to check if a column should be blocked from axis usage
  const isBlocked = (col: ColumnAnalysis): boolean => {
    // Check category (analyzeDataFrame handles ID detection via patterns and uniqueness)
    if (blockedAxisCategories.has(col.category)) {
      return true;
    }
    // Also check field metadata for identifier/reference flags (as a fallback)
    const field = fields[col.columnName];
    if (field && (field.isIdentifier || field.isReference)) {
      return true;
    }
    return false;
  };

  // Find columns by category, excluding blocked ones
  const numerical = analysis.filter(
    (a) => a.category === "numerical" && !isBlocked(a),
  );
  const temporal = analysis.filter(
    (a) => a.category === "temporal" && !isBlocked(a),
  );
  const categorical = analysis.filter(
    (a) =>
      (a.category === "categorical" ||
        a.category === "text" ||
        a.category === "boolean") &&
      !isBlocked(a),
  );

  const suggestions: ChartSuggestion[] = [];

  // Heuristic 1: Bar Chart (categorical/temporal X + numerical Y)
  if (categorical.length > 0 && numerical.length > 0) {
    const pair = pickBestPair(categorical, numerical, columnTableMap);
    const xCol = pair?.[0] ?? categorical[0];
    const yCol = pair?.[1] ?? numerical[0];
    const xAxisType = getAxisType(xCol);

    suggestions.push({
      id: `bar-${xCol.columnName}-${yCol.columnName}`,
      title: `${yCol.columnName} by ${xCol.columnName}`,
      chartType: "bar",
      encoding: {
        x: xCol.columnName,
        y: `sum(${yCol.columnName})`, // Use aggregated format for encoding
        xType: xAxisType,
        yType: "quantitative",
      },
      spec: createMiniSpec(
        "bar",
        xCol.columnName,
        yCol.columnName,
        preview.data.rows,
        undefined,
        xAxisType,
      ),
      rationale: "Categorical dimension with numeric measure",
    });
  }

  // Heuristic 2: Line Chart (temporal X + numerical Y)
  if (temporal.length > 0 && numerical.length > 0) {
    const pair = pickBestPair(temporal, numerical, columnTableMap);
    const xCol = pair?.[0] ?? temporal[0];
    const yCol = pair?.[1] ?? numerical[numerical.length > 1 ? 1 : 0];

    suggestions.push({
      id: `line-${xCol.columnName}-${yCol.columnName}`,
      title: `${yCol.columnName} over time`,
      chartType: "line",
      encoding: {
        x: xCol.columnName,
        y: `sum(${yCol.columnName})`, // Use aggregated format for encoding
        xType: "temporal",
        yType: "quantitative",
      },
      spec: createMiniSpec(
        "line",
        xCol.columnName,
        yCol.columnName,
        preview.data.rows,
        undefined,
        "temporal",
      ),
      rationale: "Time series data",
    });
  }

  // Heuristic 3: Scatter Plot (2 numerical columns)
  if (numerical.length >= 2) {
    const pair = pickBestPair(numerical, numerical, columnTableMap, {
      disallowSame: true,
    });
    const xCol = pair?.[0] ?? numerical[0];
    const yCol = pair?.[1] ?? numerical[1];

    suggestions.push({
      id: `scatter-${xCol.columnName}-${yCol.columnName}`,
      title: `${yCol.columnName} vs ${xCol.columnName}`,
      chartType: "scatter",
      encoding: {
        x: xCol.columnName,
        y: yCol.columnName,
        xType: "quantitative",
        yType: "quantitative",
      },
      spec: createMiniSpec(
        "scatter",
        xCol.columnName,
        yCol.columnName,
        preview.data.rows,
      ),
      rationale: "Two numeric dimensions for correlation",
    });
  }

  // Heuristic 4: Area Chart (alternative to line for temporal data)
  if (
    temporal.length > 0 &&
    numerical.length > 0 &&
    !suggestions.some((s) => s.chartType === "line")
  ) {
    const pair = pickBestPair(temporal, numerical, columnTableMap);
    const xCol = pair?.[0] ?? temporal[0];
    const yCol = pair?.[1] ?? numerical[0];

    suggestions.push({
      id: `area-${xCol.columnName}-${yCol.columnName}`,
      title: `${yCol.columnName} trend`,
      chartType: "area",
      encoding: {
        x: xCol.columnName,
        y: `sum(${yCol.columnName})`, // Use aggregated format for encoding
        xType: "temporal",
        yType: "quantitative",
      },
      spec: createMiniSpec(
        "area",
        xCol.columnName,
        yCol.columnName,
        preview.data.rows,
        undefined,
        "temporal",
      ),
      rationale: "Cumulative trend visualization",
    });
  }

  // Heuristic 5: Grouped Bar (2 categorical + 1 numerical)
  if (categorical.length >= 2 && numerical.length > 0) {
    const triple = pickBestTriple(categorical, numerical, columnTableMap) ?? [
      categorical[0],
      categorical[1],
      numerical[0],
    ];
    const xCol = triple[0];
    const colorCol = triple[1];
    const yCol = triple[2];
    const xAxisType = getAxisType(xCol);

    suggestions.push({
      id: `bar-grouped-${xCol.columnName}-${colorCol.columnName}-${yCol.columnName}`,
      title: `${yCol.columnName} by ${xCol.columnName} and ${colorCol.columnName}`,
      chartType: "bar",
      encoding: {
        x: xCol.columnName,
        y: `sum(${yCol.columnName})`, // Use aggregated format for encoding
        xType: xAxisType,
        yType: "quantitative",
        color: colorCol.columnName,
      },
      spec: createMiniSpec(
        "bar",
        xCol.columnName,
        yCol.columnName,
        preview.data.rows,
        colorCol.columnName,
        xAxisType,
      ),
      rationale: "Multi-dimensional categorical comparison",
    });
  }

  // Rank by preference and return top N
  return rankSuggestions(
    suggestions,
    columnTableMap,
    1 + (insight.joins?.length ?? 0),
  ).slice(0, limit);
}

/**
 * Converts column analysis category to Vega-Lite axis type
 */
function getAxisType(
  column: ColumnAnalysis,
): "quantitative" | "nominal" | "temporal" {
  switch (column.category) {
    case "numerical":
      return "quantitative";
    case "temporal":
      return "temporal";
    default:
      return "nominal";
  }
}

/**
 * Creates a mini Vega-Lite spec for chart preview (200x150px).
 * This is a simplified spec optimized for small preview cards.
 * Includes automatic aggregation for bar/line/area charts.
 */
function createMiniSpec(
  type: VisualizationType,
  xField: string,
  yField: string,
  data: Array<Record<string, unknown>>,
  colorField?: string,
  xType: "nominal" | "temporal" | "quantitative" = "nominal",
): TopLevelSpec {
  // Map chart type to Vega-Lite mark type
  const getMarkType = (
    chartType: VisualizationType,
  ): "bar" | "line" | "area" | "point" => {
    switch (chartType) {
      case "bar":
        return "bar";
      case "line":
        return "line";
      case "area":
        return "area";
      default:
        return "point";
    }
  };
  const mark = getMarkType(type);

  // For bar/line/area charts, we want to aggregate the Y values by X groups
  const shouldAggregate = type === "bar" || type === "line" || type === "area";

  // Using a record type here as Vega-Lite encoding types are complex generics
  const encoding: Record<string, unknown> = {
    x: {
      field: xField,
      type: xType,
      axis: {
        title: null,
        labels: false,
        format: xType === "temporal" ? "%b %Y" : undefined, // Format dates as "Jan 2024"
      },
      sort: type === "line" || type === "area" ? null : "-y", // Sort bars by value, keep order for time series
    },
    y: {
      field: yField,
      type: "quantitative",
      aggregate: shouldAggregate ? "sum" : undefined, // Aggregate for bar/line/area
      axis: { title: null, grid: false, labels: false },
    },
  };

  if (colorField) {
    encoding.color = { field: colorField, type: "nominal", legend: null };
  }

  return {
    $schema: "https://vega.github.io/schema/vega-lite/v5.json",
    width: 180,
    height: 120,
    data: { values: data.slice(0, 100) }, // Use more rows for aggregation
    mark: { type: mark, tooltip: false },
    encoding,
    config: getVegaThemeConfig(),
  };
}

function normalizeColumnReference(value?: string): string | null {
  if (!value) return null;
  const match = value.match(
    /^(sum|avg|count|min|max|count_distinct)\((.+)\)$/i,
  );
  if (match) return match[2];
  return value;
}

function coverageScore(
  columns: Array<string | undefined>,
  columnTableMap?: Record<string, string[]>,
): number {
  if (!columnTableMap) return 0;
  const tables = new Set<string>();
  columns.forEach((col) => {
    const normalized = normalizeColumnReference(col);
    if (!normalized) return;
    columnTableMap[normalized]?.forEach((tableId) => tables.add(tableId));
  });
  return tables.size;
}

function pickBestPair(
  first: ColumnAnalysis[],
  second: ColumnAnalysis[],
  columnTableMap?: Record<string, string[]>,
  options: { disallowSame?: boolean } = {},
): [ColumnAnalysis, ColumnAnalysis] | null {
  if (first.length === 0 || second.length === 0) return null;
  let best: [ColumnAnalysis, ColumnAnalysis] | null = null;
  let bestScore = -1;

  for (const a of first) {
    for (const b of second) {
      if (options.disallowSame && a.columnName === b.columnName) continue;
      const score = coverageScore([a.columnName, b.columnName], columnTableMap);
      if (score <= bestScore) continue;
      best = [a, b];
      bestScore = score;
    }
  }

  return best;
}

function pickBestTriple(
  categories: ColumnAnalysis[],
  numericals: ColumnAnalysis[],
  columnTableMap?: Record<string, string[]>,
): [ColumnAnalysis, ColumnAnalysis, ColumnAnalysis] | null {
  if (categories.length < 2 || numericals.length === 0) return null;

  let best: [ColumnAnalysis, ColumnAnalysis, ColumnAnalysis] | null = null;
  let bestScore = -1;

  for (const xCol of categories) {
    for (const colorCol of categories) {
      if (colorCol.columnName === xCol.columnName) continue;
      for (const yCol of numericals) {
        const score = coverageScore(
          [xCol.columnName, colorCol.columnName, yCol.columnName],
          columnTableMap,
        );
        if (score <= bestScore) continue;
        best = [xCol, colorCol, yCol];
        bestScore = score;
      }
    }
  }

  return best;
}

function tablesUsedBySuggestion(
  suggestion: ChartSuggestion,
  columnTableMap?: Record<string, string[]>,
): Set<string> {
  const columns = [
    suggestion.encoding.x,
    suggestion.encoding.y,
    suggestion.encoding.color,
    suggestion.encoding.size,
  ];
  const tables = new Set<string>();
  columns.forEach((col) => {
    const normalized = normalizeColumnReference(col);
    if (!normalized) return;
    columnTableMap?.[normalized]?.forEach((tableId) => tables.add(tableId));
  });
  return tables;
}

/**
 * Ranks suggestions by preference.
 * Priority:
 * 1. Line/Area (temporal data is highly valuable)
 * 2. Bar (most common/understandable)
 * 3. Scatter (more specialized)
 * 4. Grouped charts (more complex)
 */
function rankSuggestions(
  suggestions: ChartSuggestion[],
  columnTableMap?: Record<string, string[]>,
  totalTables = 1,
): ChartSuggestion[] {
  const priority: Record<VisualizationType, number> = {
    line: 1,
    area: 1,
    bar: 2,
    scatter: 3,
    table: 4,
  };

  return suggestions.sort((a, b) => {
    const aTables = tablesUsedBySuggestion(a, columnTableMap);
    const bTables = tablesUsedBySuggestion(b, columnTableMap);
    const aTableCount = aTables.size;
    const bTableCount = bTables.size;
    const aUsesAll = totalTables > 1 && aTableCount >= totalTables;
    const bUsesAll = totalTables > 1 && bTableCount >= totalTables;

    if (aUsesAll !== bUsesAll) {
      return aUsesAll ? -1 : 1;
    }

    if (aTableCount !== bTableCount) {
      return bTableCount - aTableCount;
    }

    const aPriority = priority[a.chartType] || 5;
    const bPriority = priority[b.chartType] || 5;

    // Lower priority number = higher rank
    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }

    // If same type, prefer simpler (no color encoding)
    const aComplexity = a.encoding.color ? 1 : 0;
    const bComplexity = b.encoding.color ? 1 : 0;
    return aComplexity - bComplexity;
  });
}
