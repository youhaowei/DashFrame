/* eslint-disable sonarjs/cognitive-complexity */
import type { VisualizationType, VisualizationEncoding } from "../stores/types";
import type { Insight } from "../stores/types";
import type { Field } from "@dashframe/types";
import type { ColumnAnalysis } from "@dashframe/engine-browser";

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

/**
 * Chart suggestion with encoding configuration.
 * Note: No spec included - suggestions are temporary insight configurations,
 * not full visualization specs. Chart renders directly from encoding.
 */
export interface ChartSuggestion {
  id: string;
  title: string; // e.g., "Revenue by Region"
  chartType: VisualizationType;
  encoding: VisualizationEncoding;
  rationale?: string; // Why this chart was suggested
  /** Fields that would be newly added (not currently in insight) */
  newFields?: string[];
  /** Whether this suggestion uses only existing fields (no new additions) */
  usesExistingFieldsOnly?: boolean;
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
 * Options for chart suggestion generation
 */
export interface SuggestChartsOptions {
  /** Maximum number of suggestions (default: 3) */
  limit?: number;
  /** Optional mapping of columns to tables */
  columnTableMap?: Record<string, string[]>;
  /** Optional seed for randomness (default: 0 for deterministic behavior) */
  seed?: number;
  /** Chart types to exclude (e.g., types already created as visualizations) */
  excludeChartTypes?: VisualizationType[];
  /** Field names currently selected in the insight (for highlighting new fields) */
  existingFields?: string[];
  /** Encoding signatures to exclude (e.g., "x|y|color" strings from existing visualizations) */
  excludeEncodings?: Set<string>;
}

/**
 * Suggests up to 3 chart visualizations based on the insight's data structure.
 * Uses heuristics to match chart types to field categories.
 *
 * @param insight - The insight to generate suggestions for
 * @param analysis - Column analysis results from DuckDB
 * @param rowCount - Total number of rows in the dataset
 * @param fields - Field definitions for analysis
 * @param options - Configuration options for suggestion generation
 * @returns Array of chart suggestions
 */
export function suggestCharts(
  insight: Insight,
  analysis: ColumnAnalysis[],
  rowCount: number,
  fields: Record<string, Field>,
  options: SuggestChartsOptions = {},
): ChartSuggestion[] {
  const {
    limit = 3,
    columnTableMap,
    seed = 0,
    excludeChartTypes = [],
    existingFields = [],
    excludeEncodings,
  } = options;

  // Convert existing fields to a Set for O(1) lookup
  const existingFieldSet = new Set(existingFields);

  // Convert excluded chart types to a Set for O(1) lookup
  const excludedChartTypeSet = new Set(excludeChartTypes);

  // Helper to create encoding signature for deduplication
  const getEncodingSignature = (encoding: VisualizationEncoding): string => {
    return [encoding.x ?? "", encoding.y ?? "", encoding.color ?? ""].join("|");
  };

  // Helper to check if a suggestion should be excluded (matches existing visualization)
  const isExcludedEncoding = (encoding: VisualizationEncoding): boolean => {
    if (!excludeEncodings || excludeEncodings.size === 0) return false;
    return excludeEncodings.has(getEncodingSignature(encoding));
  };

  // Helper to extract raw field names from encoding (strips aggregation wrappers)
  const extractFieldsFromEncoding = (
    encoding: VisualizationEncoding,
  ): string[] => {
    const fields: string[] = [];
    const extractField = (value?: string) => {
      if (!value) return;
      // Strip aggregation wrapper: sum(field) -> field, dateMonth(field) -> field
      const match = value.match(
        /^(?:sum|avg|count|min|max|count_distinct|dateMonth|dateYear|dateDay)\(([^)]+)\)$/i,
      );
      fields.push(match ? match[1] : value);
    };
    extractField(encoding.x);
    extractField(encoding.y);
    extractField(encoding.color);
    extractField(encoding.size);
    return fields;
  };

  // Helper to annotate a suggestion with new field info
  const annotateSuggestion = (suggestion: ChartSuggestion): ChartSuggestion => {
    const usedFields = extractFieldsFromEncoding(suggestion.encoding);
    const newFields = usedFields.filter((f) => !existingFieldSet.has(f));
    return {
      ...suggestion,
      newFields: newFields.length > 0 ? newFields : undefined,
      usesExistingFieldsOnly: newFields.length === 0,
    };
  };

  // Create seeded random for reproducible variety
  const random = createSeededRandom(seed);

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
    // If we have extended stats (min/max), use them
    if (col.min !== undefined && col.max !== undefined) {
      // Check for variance
      if (col.min === col.max) return false;

      // Check for zero ratio if available
      if (col.zeroCount !== undefined && rowCount > 0) {
        if (col.zeroCount / rowCount > 0.8) return false;
      }
      return true;
    }

    // Fallback if extended stats missing (rely on cardinality)
    return col.cardinality > 1;
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

  // Debug logging to understand filtering
  console.debug("[suggestCharts] Column filtering results", {
    totalColumns: analysis.length,
    numerical: numerical.length,
    temporal: temporal.length,
    categorical: categorical.length,
    colorSuitable: colorSuitable.length,
    numericalColumns: numerical.map((c) => c.columnName),
    temporalColumns: temporal.map((c) => c.columnName),
    categoricalColumns: categorical.map((c) => c.columnName),
    allCategories: analysis.map((a) => ({
      name: a.columnName,
      category: a.category,
      blocked: isBlocked(a),
    })),
  });

  const suggestions: ChartSuggestion[] = [];
  const usedSignatures = new Set<string>(); // Track signatures we've already added

  // Helper to add suggestion if not excluded and not duplicate
  const addSuggestion = (suggestion: ChartSuggestion): boolean => {
    const sig = getEncodingSignature(suggestion.encoding);
    if (isExcludedEncoding(suggestion.encoding)) return false;
    if (usedSignatures.has(sig)) return false;
    usedSignatures.add(sig);
    suggestions.push(suggestion);
    return true;
  };

  // Heuristic 1: Bar Chart (categorical/temporal X + numerical Y)
  // Try multiple combinations if first choice is excluded
  if (categorical.length > 0 && numerical.length > 0) {
    for (const xCol of categorical) {
      for (const yCol of numerical) {
        const xAxisType = getAxisType(xCol);
        const encoding: VisualizationEncoding = {
          x: xCol.columnName,
          y: `sum(${yCol.columnName})`,
          xType: xAxisType,
          yType: "quantitative",
        };
        if (
          addSuggestion({
            id: `bar-${xCol.columnName}-${yCol.columnName}`,
            title: `${yCol.columnName} by ${xCol.columnName}`,
            chartType: "bar",
            encoding,
            rationale: "Categorical dimension with numeric measure",
          })
        )
          break; // Found a valid one, stop trying
      }
      if (suggestions.some((s) => s.chartType === "bar" && !s.encoding.color))
        break;
    }
  }

  // Heuristic 2: Line Chart (temporal X + numerical Y)
  // Use dateMonth() binning to aggregate dates by month for readable time series
  if (temporal.length > 0 && numerical.length > 0) {
    for (const xCol of temporal) {
      for (const yCol of numerical) {
        const encoding: VisualizationEncoding = {
          x: `dateMonth(${xCol.columnName})`,
          y: `sum(${yCol.columnName})`,
          xType: "temporal",
          yType: "quantitative",
        };
        if (
          addSuggestion({
            id: `line-${xCol.columnName}-${yCol.columnName}`,
            title: `${yCol.columnName} by month`,
            chartType: "line",
            encoding,
            rationale: "Time series data aggregated by month",
          })
        )
          break;
      }
      if (suggestions.some((s) => s.chartType === "line")) break;
    }
  }

  // Heuristic 3: Scatter Plot (2 numerical columns)
  if (numerical.length >= 2) {
    outer: for (let i = 0; i < numerical.length; i++) {
      for (let j = 0; j < numerical.length; j++) {
        if (i === j) continue;
        const xCol = numerical[i];
        const yCol = numerical[j];
        const encoding: VisualizationEncoding = {
          x: xCol.columnName,
          y: yCol.columnName,
          xType: "quantitative",
          yType: "quantitative",
        };
        if (
          addSuggestion({
            id: `scatter-${xCol.columnName}-${yCol.columnName}`,
            title: `${yCol.columnName} vs ${xCol.columnName}`,
            chartType: "scatter",
            encoding,
            rationale: "Two numeric dimensions for correlation",
          })
        )
          break outer;
      }
    }
  }

  // Heuristic 4: Area Chart (alternative to line for temporal data)
  // Use dateMonth() binning to aggregate dates by month
  if (
    temporal.length > 0 &&
    numerical.length > 0 &&
    !suggestions.some((s) => s.chartType === "line")
  ) {
    for (const xCol of temporal) {
      for (const yCol of numerical) {
        const encoding: VisualizationEncoding = {
          x: `dateMonth(${xCol.columnName})`,
          y: `sum(${yCol.columnName})`,
          xType: "temporal",
          yType: "quantitative",
        };
        if (
          addSuggestion({
            id: `area-${xCol.columnName}-${yCol.columnName}`,
            title: `${yCol.columnName} trend`,
            chartType: "area",
            encoding,
            rationale: "Cumulative trend visualization by month",
          })
        )
          break;
      }
      if (suggestions.some((s) => s.chartType === "area")) break;
    }
  }

  // Heuristic 5: Grouped Bar (categorical X + color + numerical Y)
  // Only suggest when color adds meaningful segmentation without creating unreadable thin bars
  // Skip entirely if conditions aren't ideal - the basic bar chart already covers this case
  //
  // Key insight: Color is only useful if it creates visible variation in the chart.
  // Use maxFrequencyRatio to detect dominated distributions (e.g., 95% "Yes" / 5% "No")
  if (
    categorical.length >= 1 &&
    colorSuitable.length >= 1 &&
    numerical.length > 0
  ) {
    // Find the best X column (lowest cardinality for readable bars)
    const xCol = categorical.reduce((best, col) =>
      col.cardinality < best.cardinality ? col : best,
    );

    // Find a suitable color column with requirements:
    // - Different from X axis
    // - 2-6 categories (need at least 2 for color to make sense)
    // - Distribution not dominated by one value (maxFrequencyRatio < 0.8)
    // - Combined cardinality reasonable for readability
    const colorCol = colorSuitable.find((col) => {
      if (col.columnName === xCol.columnName) return false;
      if (col.cardinality < 2 || col.cardinality > 6) return false;
      if (xCol.cardinality * col.cardinality > 18) return false;

      // Check distribution uniformity - reject if one category dominates
      // maxFrequencyRatio of 0.8 means 80%+ of rows have the same value
      const maxFreqRatio = col.maxFrequencyRatio ?? 1;
      if (maxFreqRatio > 0.7) return false; // Dominated distribution, not useful

      return true;
    });

    // Only add grouped bar if we found a genuinely useful color dimension
    if (colorCol && numerical.length > 0) {
      const yCol = numerical[0];
      const xAxisType = getAxisType(xCol);
      const encoding: VisualizationEncoding = {
        x: xCol.columnName,
        y: `sum(${yCol.columnName})`,
        xType: xAxisType,
        yType: "quantitative",
        color: colorCol.columnName,
      };
      addSuggestion({
        id: `bar-grouped-${xCol.columnName}-${colorCol.columnName}-${yCol.columnName}`,
        title: `${yCol.columnName} by ${xCol.columnName} and ${colorCol.columnName}`,
        chartType: "bar",
        encoding,
        rationale: "Multi-dimensional categorical comparison",
      });
    }
  }

  // Filter out excluded chart types and encodings that match existing visualizations
  const filteredSuggestions = suggestions.filter(
    (s) =>
      !excludedChartTypeSet.has(s.chartType) && !isExcludedEncoding(s.encoding),
  );

  // Rank by preference
  const rankedSuggestions = rankSuggestions(
    filteredSuggestions,
    columnTableMap,
    1 + (insight.joins?.length ?? 0),
    existingFieldSet,
  );

  // Annotate with new field info and return top N
  return rankedSuggestions.slice(0, limit).map(annotateSuggestion);
}

/**
 * Converts column analysis category to encoding axis type
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
 * Extract field names from a suggestion's encoding
 */
function getFieldsFromSuggestion(suggestion: ChartSuggestion): string[] {
  const fields: string[] = [];
  const extractField = (value?: string) => {
    if (!value) return;
    // Strip aggregation wrapper: sum(field) -> field, dateMonth(field) -> field
    const match = value.match(
      /^(?:sum|avg|count|min|max|count_distinct|dateMonth|dateYear|dateDay)\(([^)]+)\)$/i,
    );
    fields.push(match ? match[1] : value);
  };
  extractField(suggestion.encoding.x);
  extractField(suggestion.encoding.y);
  extractField(suggestion.encoding.color);
  extractField(suggestion.encoding.size);
  return fields;
}

/**
 * Ranks suggestions by preference.
 * Priority (highest to lowest):
 * 1. Uses only existing fields (no new additions needed)
 * 2. Uses more tables (for multi-table insights)
 * 3. Chart type priority: Line/Area > Bar > Scatter > Table
 * 4. Simpler encodings (no color) over complex ones
 */
function rankSuggestions(
  suggestions: ChartSuggestion[],
  columnTableMap?: Record<string, string[]>,
  totalTables = 1,
  existingFieldSet?: Set<string>,
): ChartSuggestion[] {
  const priority: Record<VisualizationType, number> = {
    line: 1,
    area: 1,
    bar: 2,
    scatter: 3,
    table: 4,
  };

  // Helper to count new fields (fields not in existingFieldSet)
  const countNewFields = (suggestion: ChartSuggestion): number => {
    if (!existingFieldSet || existingFieldSet.size === 0) return 0;
    const fields = getFieldsFromSuggestion(suggestion);
    return fields.filter((f) => !existingFieldSet.has(f)).length;
  };

  return suggestions.sort((a, b) => {
    // HIGHEST PRIORITY: Prefer suggestions that use existing fields only
    const aNewFields = countNewFields(a);
    const bNewFields = countNewFields(b);
    if (aNewFields !== bNewFields) {
      return aNewFields - bNewFields; // Fewer new fields = higher rank
    }

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
