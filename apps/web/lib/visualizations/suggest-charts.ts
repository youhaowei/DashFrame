import type { TopLevelSpec } from "vega-lite";
import type { VisualizationType, VisualizationEncoding } from "../stores/types";
import type { Insight } from "../stores/types";
import {
  analyzeDataFrame,
  type DataFrameData,
  type Field,
  type ColumnAnalysis,
} from "@dashframe/dataframe";

/**
 * Patterns that indicate a column is a meaningful metric for Y-axis.
 * Higher score = more likely to be a good metric.
 */
const METRIC_PATTERNS: Array<{ pattern: RegExp; score: number }> = [
  // High confidence metrics
  {
    pattern:
      /^(total|sum|count|amount|revenue|sales|profit|cost|price|value|qty|quantity)$/i,
    score: 10,
  },
  {
    pattern:
      /(total|sum|count|amount|revenue|sales|profit|cost|price|value|qty|quantity)$/i,
    score: 8,
  },
  { pattern: /^(avg|average|mean|rate|ratio|percent|pct|score)$/i, score: 8 },
  { pattern: /(avg|average|mean|rate|ratio|percent|pct|score)$/i, score: 6 },
  // Medium confidence metrics
  {
    pattern: /(spend|spent|income|expense|fee|charge|balance|budget)$/i,
    score: 6,
  },
  {
    pattern: /(duration|time|hours|minutes|seconds|days|weeks|months)$/i,
    score: 5,
  },
  { pattern: /(size|length|width|height|weight|distance)$/i, score: 4 },
  // Low confidence - generic number-like names
  { pattern: /^(n|num|number|val)$/i, score: 2 },
];

/**
 * Patterns that indicate a column is NOT a good metric (likely an ID or code).
 */
const NON_METRIC_PATTERNS: RegExp[] = [
  /id$/i, // Ends with "id"
  /key$/i, // Ends with "key"
  /code$/i, // Ends with "code"
  /no$/i, // Ends with "no" (number abbreviation)
  /num$/i, // Ends with "num"
  /index$/i, // Ends with "index"
  /seq$/i, // Ends with "seq"
  /^_/, // Starts with underscore (internal)
];

/**
 * Scores a column for how likely it is to be a meaningful metric.
 * Higher score = better candidate for Y-axis aggregation.
 * Returns 0 for columns that look like IDs.
 */
function getMetricScore(columnName: string): number {
  const name = columnName.toLowerCase();

  // Check if it looks like an ID first
  if (NON_METRIC_PATTERNS.some((pattern) => pattern.test(name))) {
    return 0;
  }

  // Find the highest matching metric pattern score
  for (const { pattern, score } of METRIC_PATTERNS) {
    if (pattern.test(name)) {
      return score;
    }
  }

  // Default score for unmatched numerical columns
  return 1;
}

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
 * Simple seeded random number generator for reproducible shuffling.
 * Uses a Linear Congruential Generator (LCG) algorithm.
 */
function createSeededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    // LCG parameters (same as glibc)
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

/**
 * Shuffle an array using Fisher-Yates algorithm with a seeded random.
 */
function shuffleWithSeed<T>(array: T[], random: () => number): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Suggests up to 3 chart visualizations based on the insight's data structure.
 * Uses heuristics to match chart types to field categories.
 *
 * @param insight - The insight to generate suggestions for
 * @param preview - Preview DataFrame with sample data
 * @param fields - Field definitions for analysis
 * @param limit - Maximum number of suggestions (default: 3)
 * @param columnTableMap - Optional mapping of columns to tables
 * @param seed - Optional seed for randomness (default: 0 for deterministic behavior)
 * @returns Array of chart suggestions
 */
export function suggestCharts(
  insight: Insight,
  preview: DataFrameData,
  fields: Record<string, Field>,
  limit = 3,
  columnTableMap?: Record<string, string[]>,
  seed = 0,
): ChartSuggestion[] {
  // Create seeded random for reproducible variety
  const random = createSeededRandom(seed);
  // Analyze columns to categorize them
  const analysis = analyzeDataFrame(preview.rows, preview.columns, fields);

  // Categories to avoid for chart encodings (identifiers/references should not be axes)
  const blockedAxisCategories = new Set([
    "identifier",
    "reference",
    "email",
    "url",
    "uuid",
  ]);

  // Calculate total row count for null rate calculation
  const rowCount = preview.rows.length;

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
    // Skip columns with high null rate (>50% missing data)
    // These are not useful for chart axes
    if (rowCount > 0 && col.nullCount / rowCount > 0.5) {
      return true;
    }
    return false;
  };

  // Helper to check if a categorical column is good for X-axis
  // Good categorical X-axis columns should have:
  // - More than 1 unique value (has variance)
  // - Not too many unique values (readable chart, typically < 50)
  const isGoodCategoricalXAxis = (col: ColumnAnalysis): boolean => {
    // Must have variance (more than 1 unique value)
    if (col.cardinality <= 1) {
      return false;
    }
    // Should not have too many unique values for a readable chart
    // A bar chart with 100+ categories is usually not useful
    if (col.cardinality > 50) {
      return false;
    }
    return true;
  };

  // Helper to check if a categorical column is good for color encoding
  // Color legends should have few unique values (2-15 is ideal)
  const isGoodColorColumn = (col: ColumnAnalysis): boolean => {
    // Need at least 2 values to show color differentiation
    if (col.cardinality < 2) {
      return false;
    }
    // Too many colors makes the legend unreadable
    if (col.cardinality > 15) {
      return false;
    }
    return true;
  };

  // Helper to check if a numerical column has meaningful variance
  // Skip columns that are mostly zeros or have the same value
  const hasNumericalVariance = (col: ColumnAnalysis): boolean => {
    // Get actual values from preview data for this column
    const values = preview.rows
      .map((row) => row[col.columnName])
      .filter((v) => v !== null && v !== undefined) as number[];

    if (values.length === 0) return false;

    // Check if most values are zeros (>80% zeros is bad)
    const zeroCount = values.filter((v) => v === 0).length;
    if (zeroCount / values.length > 0.8) {
      return false;
    }

    // Check if there's actual variance (not all same value)
    const uniqueValues = new Set(values);
    if (uniqueValues.size <= 1) {
      return false;
    }

    // Check if there's meaningful range (not all clustered)
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min === max) {
      return false;
    }

    return true;
  };

  // Find columns by category, excluding blocked ones
  // Shuffle with seed to introduce variety when regenerating
  // For numerical columns, also check for meaningful variance (not all zeros)
  const numerical = shuffleWithSeed(
    analysis.filter(
      (a) =>
        a.category === "numerical" && !isBlocked(a) && hasNumericalVariance(a),
    ),
    random,
  );
  const temporal = shuffleWithSeed(
    analysis.filter((a) => a.category === "temporal" && !isBlocked(a)),
    random,
  );
  // For categorical columns, also filter for good X-axis candidates
  // (proper variance - not too few or too many unique values)
  const categorical = shuffleWithSeed(
    analysis.filter(
      (a) =>
        (a.category === "categorical" ||
          a.category === "text" ||
          a.category === "boolean") &&
        !isBlocked(a) &&
        isGoodCategoricalXAxis(a),
    ),
    random,
  );

  // Separate list for color-suitable columns (lower cardinality for readable legends)
  const colorSuitable = shuffleWithSeed(
    analysis.filter(
      (a) =>
        (a.category === "categorical" ||
          a.category === "text" ||
          a.category === "boolean") &&
        !isBlocked(a) &&
        isGoodColorColumn(a),
    ),
    random,
  );

  const suggestions: ChartSuggestion[] = [];

  // Heuristic 1: Bar Chart (categorical/temporal X + numerical Y)
  if (categorical.length > 0 && numerical.length > 0) {
    const pair = pickBestPair(categorical, numerical, columnTableMap, {
      preferMetricY: true,
      random,
    });
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
        preview.rows,
        undefined,
        xAxisType,
      ),
      rationale: "Categorical dimension with numeric measure",
    });
  }

  // Heuristic 2: Line Chart (temporal X + numerical Y)
  if (temporal.length > 0 && numerical.length > 0) {
    const pair = pickBestPair(temporal, numerical, columnTableMap, {
      preferMetricY: true,
      random,
    });
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
        preview.rows,
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
      preferMetricY: true,
      random,
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
        preview.rows,
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
    const pair = pickBestPair(temporal, numerical, columnTableMap, {
      preferMetricY: true,
      random,
    });
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
        preview.rows,
        undefined,
        "temporal",
      ),
      rationale: "Cumulative trend visualization",
    });
  }

  // Heuristic 5: Grouped Bar (categorical X + color + numerical Y)
  // Use colorSuitable for color encoding (lower cardinality for readable legends)
  if (
    categorical.length >= 1 &&
    colorSuitable.length >= 1 &&
    numerical.length > 0
  ) {
    const triple = pickBestTriple(
      categorical,
      colorSuitable,
      numerical,
      columnTableMap,
      random,
    ) ?? [categorical[0], colorSuitable[0], numerical[0]];
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
        preview.rows,
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
  options: {
    disallowSame?: boolean;
    preferMetricY?: boolean;
    random?: () => number;
  } = {},
): [ColumnAnalysis, ColumnAnalysis] | null {
  if (first.length === 0 || second.length === 0) return null;

  // Collect all valid pairs with their scores
  const validPairs: Array<{
    pair: [ColumnAnalysis, ColumnAnalysis];
    score: number;
  }> = [];

  for (const a of first) {
    for (const b of second) {
      if (options.disallowSame && a.columnName === b.columnName) continue;

      // Base score from table coverage
      let score = coverageScore([a.columnName, b.columnName], columnTableMap);

      // Add metric score for Y-axis candidate (second column) to prefer meaningful metrics
      if (options.preferMetricY) {
        const metricScore = getMetricScore(b.columnName);
        // Skip columns that look like IDs (metric score = 0)
        if (metricScore === 0) continue;
        // Weight metric score heavily to prioritize good metrics
        score += metricScore * 100;
      }

      // Prefer columns with more complete data (lower null rate)
      // Add a small bonus for data completeness (0-10 points based on fill rate)
      const aFillRate =
        1 - a.nullCount / Math.max(a.cardinality + a.nullCount, 1);
      const bFillRate =
        1 - b.nullCount / Math.max(b.cardinality + b.nullCount, 1);
      score += (aFillRate + bFillRate) * 5;

      // For X-axis (first column), prefer moderate cardinality for readable charts
      // Sweet spot is around 5-20 unique values for bar charts
      if (a.cardinality >= 3 && a.cardinality <= 20) {
        score += 10; // Ideal range bonus
      } else if (a.cardinality >= 2 && a.cardinality <= 30) {
        score += 5; // Good range bonus
      }

      validPairs.push({ pair: [a, b], score });
    }
  }

  if (validPairs.length === 0) return null;

  // Sort by score descending
  validPairs.sort((a, b) => b.score - a.score);

  // If random is provided, pick from top candidates with weighted probability
  // This adds variety while still preferring higher-scored options
  if (options.random && validPairs.length > 1) {
    // Consider top 5 candidates (or all if less than 5)
    const topN = Math.min(5, validPairs.length);
    const candidates = validPairs.slice(0, topN);

    // Weight selection towards higher scores but allow variety
    // Use exponential weighting: score^2 gives more weight to better options
    const weights = candidates.map((c) => Math.pow(c.score + 1, 2));
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);

    let randomValue = options.random() * totalWeight;
    for (let i = 0; i < candidates.length; i++) {
      randomValue -= weights[i];
      if (randomValue <= 0) {
        return candidates[i].pair;
      }
    }
  }

  // Default: return the best pair
  return validPairs[0].pair;
}

function pickBestTriple(
  xCategories: ColumnAnalysis[],
  colorCategories: ColumnAnalysis[],
  numericalCols: ColumnAnalysis[],
  columnTableMap?: Record<string, string[]>,
  random?: () => number,
): [ColumnAnalysis, ColumnAnalysis, ColumnAnalysis] | null {
  if (
    xCategories.length === 0 ||
    colorCategories.length === 0 ||
    numericalCols.length === 0
  ) {
    return null;
  }

  // Collect all valid triples with their scores
  const validTriples: Array<{
    triple: [ColumnAnalysis, ColumnAnalysis, ColumnAnalysis];
    score: number;
  }> = [];

  for (const xCol of xCategories) {
    for (const colorCol of colorCategories) {
      // Skip if same column (can happen if color and x categories overlap)
      if (colorCol.columnName === xCol.columnName) continue;
      for (const yCol of numericalCols) {
        // Skip Y columns that look like IDs
        const metricScore = getMetricScore(yCol.columnName);
        if (metricScore === 0) continue;

        let score = coverageScore(
          [xCol.columnName, colorCol.columnName, yCol.columnName],
          columnTableMap,
        );
        // Weight metric score heavily to prioritize good metrics
        score += metricScore * 100;

        // Bonus for lower cardinality color columns (more readable legends)
        if (colorCol.cardinality <= 5) {
          score += 20; // Ideal: 2-5 colors
        } else if (colorCol.cardinality <= 10) {
          score += 10; // Good: 6-10 colors
        }

        validTriples.push({ triple: [xCol, colorCol, yCol], score });
      }
    }
  }

  if (validTriples.length === 0) return null;

  // Sort by score descending
  validTriples.sort((a, b) => b.score - a.score);

  // If random is provided, pick from top candidates with weighted probability
  if (random && validTriples.length > 1) {
    const topN = Math.min(5, validTriples.length);
    const candidates = validTriples.slice(0, topN);
    const weights = candidates.map((c) => Math.pow(c.score + 1, 2));
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);

    let randomValue = random() * totalWeight;
    for (let i = 0; i < candidates.length; i++) {
      randomValue -= weights[i];
      if (randomValue <= 0) {
        return candidates[i].triple;
      }
    }
  }

  return validTriples[0].triple;
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
