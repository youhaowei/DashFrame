/* eslint-disable sonarjs/cognitive-complexity */
import type { VisualizationType } from "../stores/types";
import type { Insight } from "../stores/types";
import type {
  Field,
  ChartEncoding,
  ChannelTransform,
  ChartTag,
  ColumnAnalysis,
  DateAnalysis,
} from "@dashframe/types";
import {
  selectTemporalAggregation,
  applyDateTransformToSql,
  getAxisTypeForTransform,
  temporalTransform,
  extractUUIDFromColumnAlias,
} from "@dashframe/engine";

/**
 * Re-export ChartEncoding as SuggestionEncoding for backwards compatibility.
 *
 * With UUID-based column naming, encoding values are now `field_<uuid>` format.
 * This format is used directly in SQL queries without transformation.
 * Display names are looked up from field definitions when rendering UI.
 */
export type SuggestionEncoding = ChartEncoding;

/**
 * Extended column analysis that includes display name from field metadata.
 * The columnName is the UUID alias (field_<uuid>), displayName is the user-visible name.
 */
type ExtendedColumnAnalysis = ColumnAnalysis & {
  /** User-visible display name from field metadata */
  displayName: string;
};
import {
  isBlockedColumn,
  hasNumericalVariance,
  isSuitableCategoricalXAxis,
  isSuitableColorColumn,
} from "./encoding-criteria";

/**
 * Enrich column analysis with display names from field metadata.
 *
 * With UUID-based column naming, column names in analysis are like `field_<uuid>`.
 * This function looks up the original field display name for use in suggestion titles.
 *
 * @param analysis - Raw column analysis with UUID column names
 * @param fields - Field metadata keyed by field ID
 * @returns Enriched analysis with displayName and fieldId
 */
function enrichColumnAnalysis(
  analysis: ColumnAnalysis[],
  fields: Record<string, Field>,
): ExtendedColumnAnalysis[] {
  return analysis.map((col) => {
    // Extract field ID from column alias (field_<uuid> → uuid)
    const extractedFieldId = extractUUIDFromColumnAlias(col.columnName);
    // Convert null to undefined to match ColumnAnalysisBase.fieldId type
    const fieldId = extractedFieldId ?? undefined;

    // Look up field by ID for display name
    const field = fieldId ? fields[fieldId] : undefined;
    const displayName = field?.name ?? col.columnName;

    return {
      ...col,
      displayName,
      fieldId,
    };
  });
}

/**
 * Extract raw field names from a visualization encoding.
 * Strips aggregation and date-binning wrappers to get the underlying column names.
 *
 * Handles both legacy vgplot functions (dateMonth, etc.) and new DuckDB functions (date_trunc).
 *
 * @example
 * // Returns ["revenue", "date", "category"]
 * extractRawFieldsFromEncoding({ x: "dateMonth(date)", y: "sum(revenue)", color: "category" })
 * extractRawFieldsFromEncoding({ x: "date_trunc('month', \"date\")", y: "sum(revenue)" })
 *
 * @param encoding - Visualization encoding with x, y, color, size channels
 * @returns Array of raw field names (without aggregation wrappers)
 */
function extractRawFieldsFromEncoding(encoding: SuggestionEncoding): string[] {
  const fields: string[] = [];
  const addField = (value?: string) => {
    if (!value) return;
    // Pattern 1: Simple aggregation functions - sum(col), avg(col), etc.
    const simpleMatch = value.match(
      /^(?:sum|avg|count|min|max|count_distinct|dateMonth|dateYear|dateDay|monthname|dayname|quarter)\(([^)]+)\)$/i,
    );
    if (simpleMatch) {
      // Remove quotes from column name if present
      fields.push(simpleMatch[1].replace(/(?:^["'])|(?:["']$)/g, ""));
      return;
    }
    // Pattern 2: date_trunc('period', "column") - DuckDB date functions
    // Use possessive-like pattern to avoid backtracking
    const dateTruncMatch = value.match(/^date_trunc\('[^']+',\s*"([^"]+)"\)$/i);
    if (dateTruncMatch) {
      fields.push(dateTruncMatch[1]);
      return;
    }
    // No wrapper, use as-is (remove quotes if present)
    fields.push(value.replace(/(?:^["'])|(?:["']$)/g, ""));
  };
  addField(encoding.x);
  addField(encoding.y);
  addField(encoding.color);
  addField(encoding.size);
  return fields;
}

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

// SCATTER_MAX_POINTS is imported from @dashframe/types and re-exported for convenience
import { SCATTER_MAX_POINTS } from "@dashframe/types";
export { SCATTER_MAX_POINTS };

/**
 * Scores a column for how likely it is to be a meaningful metric.
 * Higher score = better candidate for Y-axis aggregation.
 * Returns 0 for columns that look like IDs.
 *
 * @param displayName - The user-visible display name (not UUID alias)
 */
function getMetricScore(displayName: string): number {
  const name = displayName.toLowerCase();

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
  encoding: SuggestionEncoding;
  rationale?: string; // Why this chart was suggested
  /** Fields that would be newly added (not currently in insight) */
  newFields?: string[];
  /** Whether this suggestion uses only existing fields (no new additions) */
  usesExistingFieldsOnly?: boolean;
  /** Date transform for X-axis (when applicable) - for persistence */
  xTransform?: ChannelTransform;
  /** Date transform for Y-axis (when applicable) - for persistence */
  yTransform?: ChannelTransform;
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
 * Extended date analysis with display name.
 */
type ExtendedDateAnalysis = DateAnalysis & {
  displayName: string;
};

/**
 * Type guard to check if ExtendedColumnAnalysis is specifically a date analysis.
 */
function isDateAnalysis(
  col: ExtendedColumnAnalysis,
): col is ExtendedDateAnalysis {
  return col.dataType === "date";
}

/**
 * Build a temporal encoding for a date column using auto-selected aggregation.
 *
 * Uses the column's minDate/maxDate to select optimal granularity:
 * - < 14 days: none (raw dates)
 * - 14 days - 6 months: yearWeek (weekly)
 * - 6 months - 5 years: yearMonth (monthly)
 * - > 5 years: year (yearly)
 *
 * @param col - Temporal column analysis (with minDate/maxDate)
 * @returns Object with x expression, axis type, and transform config
 */
function buildTemporalEncoding(col: ExtendedDateAnalysis): {
  xExpr: string;
  xType: "temporal" | "ordinal";
  xTransform: ChannelTransform;
  aggregationLabel: string;
  /** X-axis label including the aggregation (e.g., "Year of arrival") */
  xAxisLabel: string;
} {
  // Auto-select aggregation based on date range
  const aggregation = selectTemporalAggregation(col.minDate, col.maxDate);
  const transform = temporalTransform(aggregation);

  // Generate SQL expression using DuckDB date_trunc
  // Use UUID column name for SQL, not display name
  const xExpr = applyDateTransformToSql(col.columnName, transform);

  // Get appropriate axis type based on data
  const xType = getAxisTypeForTransform(transform) as "temporal" | "ordinal";

  // Human-readable labels
  const aggregationLabels: Record<string, string> = {
    none: "",
    yearWeek: "by week",
    yearMonth: "by month",
    year: "by year",
  };
  const aggregationLabel = aggregationLabels[aggregation] || "by month";

  // X-axis label showing the aggregation applied (e.g., "Year of arrival", "Month of created_date")
  const axisLabelPrefixes: Record<string, string> = {
    none: "",
    yearWeek: "Week of",
    yearMonth: "Month of",
    year: "Year of",
  };
  const prefix = axisLabelPrefixes[aggregation] || "";
  const xAxisLabel = prefix ? `${prefix} ${col.displayName}` : col.displayName;

  return {
    xExpr,
    xType,
    xTransform: { type: "date", transform },
    aggregationLabel,
    xAxisLabel,
  };
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
  /**
   * Tag context for the suggestion. When provided, the suggestion logic adapts
   * to the tag's analytical purpose. For example, "trend" tag requires
   * temporal or continuous X-axis even for bar charts.
   */
  tagContext?: ChartTag;
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

  // Enrich analysis with display names from field metadata
  // This allows us to use UUID column names for SQL while showing readable names in UI
  const enrichedAnalysis = enrichColumnAnalysis(analysis, fields);

  // Convert existing fields to a Set for O(1) lookup
  const existingFieldSet = new Set(existingFields);

  // Convert excluded chart types to a Set for O(1) lookup
  const excludedChartTypeSet = new Set(excludeChartTypes);

  // Helper to create encoding signature for deduplication
  const getEncodingSignature = (encoding: SuggestionEncoding): string => {
    return [encoding.x ?? "", encoding.y ?? "", encoding.color ?? ""].join("|");
  };

  // Helper to check if a suggestion should be excluded (matches existing visualization)
  const isExcludedEncoding = (encoding: SuggestionEncoding): boolean => {
    if (!excludeEncodings || excludeEncodings.size === 0) return false;
    return excludeEncodings.has(getEncodingSignature(encoding));
  };

  // Helper to annotate a suggestion with new field info
  const annotateSuggestion = (suggestion: ChartSuggestion): ChartSuggestion => {
    const usedFields = extractRawFieldsFromEncoding(suggestion.encoding);
    const newFields = usedFields.filter((f) => !existingFieldSet.has(f));
    return {
      ...suggestion,
      newFields: newFields.length > 0 ? newFields : undefined,
      usesExistingFieldsOnly: newFields.length === 0,
    };
  };

  // Create seeded random for reproducible variety
  const random = createSeededRandom(seed);

  // Helper wrappers that use unified encoding criteria
  // Note: Use fieldId to look up field metadata since columnName is now UUID-based
  const isBlocked = (col: ExtendedColumnAnalysis): boolean => {
    const field = col.fieldId ? fields[col.fieldId] : undefined;
    return !isBlockedColumn(col, field, rowCount).good;
  };

  const hasVariance = (col: ExtendedColumnAnalysis): boolean => {
    return hasNumericalVariance(col, rowCount).good;
  };

  // Find columns by category, excluding blocked ones
  // Shuffle with seed to introduce variety when regenerating
  // For numerical columns, also check for meaningful variance (not all zeros)
  const numerical = shuffleWithSeed(
    enrichedAnalysis.filter(
      (a) => a.semantic === "numerical" && !isBlocked(a) && hasVariance(a),
    ),
    random,
  );
  // Use type guard to narrow temporal columns to ExtendedDateAnalysis
  const temporal = shuffleWithSeed(
    enrichedAnalysis.filter(
      (a): a is ExtendedDateAnalysis => isDateAnalysis(a) && !isBlocked(a),
    ),
    random,
  );
  // For categorical columns, also filter for good X-axis candidates
  // (proper variance - not too few or too many unique values)
  const categorical = shuffleWithSeed(
    enrichedAnalysis.filter(
      (a) =>
        (a.semantic === "categorical" ||
          a.semantic === "text" ||
          a.semantic === "boolean") &&
        !isBlocked(a) &&
        isSuitableCategoricalXAxis(a),
    ),
    random,
  );

  // Separate list for color-suitable columns (lower cardinality for readable legends)
  const colorSuitable = shuffleWithSeed(
    enrichedAnalysis.filter(
      (a) =>
        (a.semantic === "categorical" ||
          a.semantic === "text" ||
          a.semantic === "boolean") &&
        !isBlocked(a) &&
        isSuitableColorColumn(a),
    ),
    random,
  );

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
  // Note: Use columnName (UUID) for encoding, displayName for titles
  if (categorical.length > 0 && numerical.length > 0) {
    for (const xCol of categorical) {
      for (const yCol of numerical) {
        const xAxisType = getAxisType(xCol);
        const encoding: SuggestionEncoding = {
          x: xCol.columnName,
          y: `sum(${yCol.columnName})`,
          xType: xAxisType,
          yType: "quantitative",
          xLabel: xCol.displayName,
          yLabel: `sum of ${yCol.displayName}`,
        };
        if (
          addSuggestion({
            id: `barY-${xCol.fieldId ?? xCol.columnName}-${yCol.fieldId ?? yCol.columnName}`,
            title: `${yCol.displayName} by ${xCol.displayName}`,
            chartType: "barY",
            encoding,
            rationale: "Categorical dimension with numeric measure",
          })
        )
          break; // Found a valid one, stop trying
      }
      if (suggestions.some((s) => s.chartType === "barY" && !s.encoding.color))
        break;
    }
  }

  // Heuristic 2: Line Chart (temporal X + numerical Y)
  // Use auto-selected temporal aggregation based on date range
  // Line charts require temporal data - no fallback to categorical
  if (temporal.length > 0 && numerical.length > 0) {
    for (const xCol of temporal) {
      for (const yCol of numerical) {
        const { xExpr, xType, xTransform, aggregationLabel, xAxisLabel } =
          buildTemporalEncoding(xCol);
        const encoding: SuggestionEncoding = {
          x: xExpr,
          y: `sum(${yCol.columnName})`,
          xType,
          yType: "quantitative",
          xLabel: xAxisLabel,
          yLabel: `sum of ${yCol.displayName}`,
          xTransform, // Include transform for consistency
        };
        const title = aggregationLabel
          ? `${yCol.displayName} ${aggregationLabel}`
          : `${yCol.displayName} over time`;
        if (
          addSuggestion({
            id: `line-${xCol.fieldId ?? xCol.columnName}-${yCol.fieldId ?? yCol.columnName}`,
            title,
            chartType: "line",
            encoding,
            rationale: `Time series data ${aggregationLabel || ""}`.trim(),
            xTransform,
          })
        )
          break;
      }
      if (suggestions.some((s) => s.chartType === "line")) break;
    }
  }

  // Heuristic 3: Scatter Plot (2 numerical columns)
  if (numerical.length >= 2) {
    let scatterAdded = false;
    for (let i = 0; i < numerical.length && !scatterAdded; i++) {
      for (let j = 0; j < numerical.length && !scatterAdded; j++) {
        if (i === j) continue;
        const xCol = numerical[i];
        const yCol = numerical[j];
        const encoding: SuggestionEncoding = {
          x: xCol.columnName,
          y: yCol.columnName,
          xType: "quantitative",
          yType: "quantitative",
          xLabel: xCol.displayName,
          yLabel: yCol.displayName,
        };
        scatterAdded = addSuggestion({
          id: `dot-${xCol.fieldId ?? xCol.columnName}-${yCol.fieldId ?? yCol.columnName}`,
          title: `${yCol.displayName} vs ${xCol.displayName}`,
          chartType: "dot",
          encoding,
          rationale: "Two numeric dimensions for correlation",
        });
      }
    }
  }

  // Heuristic 4: Area Chart (alternative to line for temporal data)
  // Use auto-selected temporal aggregation based on date range
  // Area charts require temporal data - no fallback to categorical
  if (temporal.length > 0 && numerical.length > 0) {
    for (const xCol of temporal) {
      for (const yCol of numerical) {
        const { xExpr, xType, xTransform, aggregationLabel, xAxisLabel } =
          buildTemporalEncoding(xCol);
        const encoding: SuggestionEncoding = {
          x: xExpr,
          y: `sum(${yCol.columnName})`,
          xType,
          yType: "quantitative",
          xLabel: xAxisLabel,
          yLabel: `sum of ${yCol.displayName}`,
          xTransform, // Include transform for consistency
        };
        if (
          addSuggestion({
            id: `areaY-${xCol.fieldId ?? xCol.columnName}-${yCol.fieldId ?? yCol.columnName}`,
            title: `${yCol.displayName} trend`,
            chartType: "areaY",
            encoding,
            rationale:
              `Cumulative trend visualization ${aggregationLabel || ""}`.trim(),
            xTransform,
          })
        )
          break;
      }
      if (suggestions.some((s) => s.chartType === "areaY")) break;
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
      // Only StringAnalysis has maxFrequencyRatio - default to 1 (pass check) for other types
      const maxFreqRatio =
        col.dataType === "string" ? (col.maxFrequencyRatio ?? 1) : 1;
      if (maxFreqRatio > 0.7) return false; // Dominated distribution, not useful

      return true;
    });

    // Only add grouped bar if we found a genuinely useful color dimension
    if (colorCol && numerical.length > 0) {
      const yCol = numerical[0];
      const xAxisType = getAxisType(xCol);
      const encoding: SuggestionEncoding = {
        x: xCol.columnName,
        y: `sum(${yCol.columnName})`,
        xType: xAxisType,
        yType: "quantitative",
        color: colorCol.columnName,
        xLabel: xCol.displayName,
        yLabel: `sum of ${yCol.displayName}`,
        colorLabel: colorCol.displayName,
      };
      addSuggestion({
        id: `barY-grouped-${xCol.fieldId ?? xCol.columnName}-${colorCol.fieldId ?? colorCol.columnName}-${yCol.fieldId ?? yCol.columnName}`,
        title: `${yCol.displayName} by ${xCol.displayName} and ${colorCol.displayName}`,
        chartType: "barY",
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
 * Converts column analysis semantic to encoding axis type
 */
function getAxisType(
  column: ColumnAnalysis,
): "quantitative" | "nominal" | "temporal" {
  switch (column.semantic) {
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

function _pickBestPair(
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

function _pickBestTriple(
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
 * Extract field names from a suggestion's encoding.
 * Wrapper for extractRawFieldsFromEncoding that takes a suggestion.
 */
function getFieldsFromSuggestion(suggestion: ChartSuggestion): string[] {
  return extractRawFieldsFromEncoding(suggestion.encoding);
}

/**
 * Ranks suggestions by preference.
 * Priority (highest to lowest):
 * 1. Uses only existing fields (no new additions needed)
 * 2. Uses more tables (for multi-table insights)
 * 3. Chart type priority: Line/Area > Bar > Scatter > Table
 * 4. Simpler encodings (no color) over complex ones
 */
/**
 * Generates a single chart suggestion for a specific chart type.
 * Uses targeted heuristics for each chart type to ensure viable suggestions.
 *
 * @param insight - The insight to generate suggestion for
 * @param analysis - Column analysis results from DuckDB
 * @param rowCount - Total number of rows in the dataset
 * @param fields - Field definitions for analysis
 * @param chartType - The specific chart type to generate a suggestion for
 * @param options - Configuration options
 * @returns A single chart suggestion or null if no valid suggestion
 */
export function suggestByChartType(
  _insight: Insight,
  analysis: ColumnAnalysis[],
  rowCount: number,
  fields: Record<string, Field>,
  chartType: VisualizationType,
  options: Omit<SuggestChartsOptions, "limit" | "excludeChartTypes"> = {},
): ChartSuggestion | null {
  const {
    existingFields = [],
    excludeEncodings,
    seed = 0,
    tagContext,
  } = options;
  const existingFieldSet = new Set(existingFields);

  // Create seeded random for reproducible variety when regenerating
  const random = createSeededRandom(seed);

  // Enrich analysis with display names from field metadata
  const enrichedAnalysis = enrichColumnAnalysis(analysis, fields);

  // Helper wrappers for column filtering
  const isBlocked = (col: ExtendedColumnAnalysis): boolean => {
    const field = col.fieldId ? fields[col.fieldId] : undefined;
    return !isBlockedColumn(col, field, rowCount).good;
  };

  const hasVariance = (col: ExtendedColumnAnalysis): boolean => {
    return hasNumericalVariance(col, rowCount).good;
  };

  // Categorize columns and shuffle with seed to vary suggestions on regenerate
  const numerical = shuffleWithSeed(
    enrichedAnalysis.filter(
      (a) => a.semantic === "numerical" && !isBlocked(a) && hasVariance(a),
    ),
    random,
  );
  // Use type guard to narrow temporal columns to ExtendedDateAnalysis
  const temporal = shuffleWithSeed(
    enrichedAnalysis.filter(
      (a): a is ExtendedDateAnalysis => isDateAnalysis(a) && !isBlocked(a),
    ),
    random,
  );
  const categorical = shuffleWithSeed(
    enrichedAnalysis.filter(
      (a) =>
        (a.semantic === "categorical" ||
          a.semantic === "text" ||
          a.semantic === "boolean") &&
        !isBlocked(a) &&
        isSuitableCategoricalXAxis(a),
    ),
    random,
  );

  // Helper to check if encoding is excluded
  const isExcludedEncoding = (encoding: SuggestionEncoding): boolean => {
    if (!excludeEncodings || excludeEncodings.size === 0) return false;
    const sig = [encoding.x ?? "", encoding.y ?? "", encoding.color ?? ""].join(
      "|",
    );
    return excludeEncodings.has(sig);
  };

  // Helper to annotate suggestion with new field info
  const annotateSuggestion = (suggestion: ChartSuggestion): ChartSuggestion => {
    const extractField = (value?: string): string | null => {
      if (!value) return null;
      const match = value.match(
        /^(?:sum|avg|count|min|max|count_distinct|dateMonth|dateYear|dateDay)\(([^)]+)\)$/i,
      );
      return match ? match[1] : value;
    };
    const usedFields = [
      extractField(suggestion.encoding.x),
      extractField(suggestion.encoding.y),
      extractField(suggestion.encoding.color),
    ].filter((f): f is string => f !== null);
    const newFields = usedFields.filter((f) => !existingFieldSet.has(f));
    return {
      ...suggestion,
      newFields: newFields.length > 0 ? newFields : undefined,
      usesExistingFieldsOnly: newFields.length === 0,
    };
  };

  let suggestion: ChartSuggestion | null = null;

  switch (chartType) {
    case "barY":
      // Bar Chart: behavior varies by tag context
      // - "trend" tag: Use temporal X-axis (show change over time)
      // - Other tags: Use categorical X-axis (compare categories)
      if (tagContext === "trend") {
        // Trend context: bar chart needs temporal X for showing change over time
        if (temporal.length > 0 && numerical.length > 0) {
          const xCol = temporal[0];
          const yCol = numerical[0];
          const { xExpr, xType, xTransform, aggregationLabel, xAxisLabel } =
            buildTemporalEncoding(xCol);
          const encoding: SuggestionEncoding = {
            x: xExpr,
            y: `sum(${yCol.columnName})`,
            xType,
            yType: "quantitative",
            xLabel: xAxisLabel,
            yLabel: `sum of ${yCol.displayName}`,
            xTransform, // Include transform for renderer to use rectY with interval
          };
          if (!isExcludedEncoding(encoding)) {
            const title = aggregationLabel
              ? `${yCol.displayName} ${aggregationLabel}`
              : `${yCol.displayName} over time`;
            suggestion = {
              id: `barY-trend-${xCol.fieldId ?? xCol.columnName}-${yCol.fieldId ?? yCol.columnName}`,
              title,
              chartType: "barY",
              encoding,
              rationale:
                `Time series bar chart ${aggregationLabel || ""}`.trim(),
              xTransform,
            };
          }
        }
      } else {
        // Default: categorical X-axis for comparing values across categories
        if (categorical.length > 0 && numerical.length > 0) {
          const xCol = categorical[0];
          const yCol = numerical[0];
          const encoding: SuggestionEncoding = {
            x: xCol.columnName,
            y: `sum(${yCol.columnName})`,
            xType: getAxisType(xCol),
            yType: "quantitative",
            xLabel: xCol.displayName,
            yLabel: `sum of ${yCol.displayName}`,
          };
          if (!isExcludedEncoding(encoding)) {
            suggestion = {
              id: `barY-${xCol.fieldId ?? xCol.columnName}-${yCol.fieldId ?? yCol.columnName}`,
              title: `${yCol.displayName} by ${xCol.displayName}`,
              chartType: "barY",
              encoding,
              rationale: "Categorical dimension with numeric measure",
            };
          }
        }
      }
      break;

    case "barX":
      // Horizontal Bar: numerical X + categorical Y
      if (categorical.length > 0 && numerical.length > 0) {
        const yCol = categorical[0];
        const xCol = numerical[0];
        const encoding: SuggestionEncoding = {
          x: `sum(${xCol.columnName})`,
          y: yCol.columnName,
          xType: "quantitative",
          yType: getAxisType(yCol),
          xLabel: `sum of ${xCol.displayName}`,
          yLabel: yCol.displayName,
        };
        if (!isExcludedEncoding(encoding)) {
          suggestion = {
            id: `barX-${xCol.fieldId ?? xCol.columnName}-${yCol.fieldId ?? yCol.columnName}`,
            title: `${xCol.displayName} by ${yCol.displayName}`,
            chartType: "barX",
            encoding,
            rationale: "Horizontal categorical comparison",
          };
        }
      }
      break;

    case "line":
      // Line Chart: temporal X + numerical Y
      // Line charts require temporal data for meaningful visualization
      if (temporal.length > 0 && numerical.length > 0) {
        const xCol = temporal[0];
        const yCol = numerical[0];
        const { xExpr, xType, xTransform, aggregationLabel, xAxisLabel } =
          buildTemporalEncoding(xCol);
        const encoding: SuggestionEncoding = {
          x: xExpr,
          y: `sum(${yCol.columnName})`,
          xType,
          yType: "quantitative",
          xLabel: xAxisLabel,
          yLabel: `sum of ${yCol.displayName}`,
          xTransform, // Include transform for consistency
        };
        if (!isExcludedEncoding(encoding)) {
          const title = aggregationLabel
            ? `${yCol.displayName} ${aggregationLabel}`
            : `${yCol.displayName} over time`;
          suggestion = {
            id: `line-${xCol.fieldId ?? xCol.columnName}-${yCol.fieldId ?? yCol.columnName}`,
            title,
            chartType: "line",
            encoding,
            rationale: `Time series data ${aggregationLabel || ""}`.trim(),
            xTransform,
          };
        }
      }
      // No fallback for line charts - they require temporal data
      break;

    case "areaY":
      // Area Chart: temporal X + numerical Y
      // Area charts require temporal data for meaningful visualization
      if (temporal.length > 0 && numerical.length > 0) {
        const xCol = temporal[0];
        const yCol = numerical[0];
        const { xExpr, xType, xTransform, aggregationLabel, xAxisLabel } =
          buildTemporalEncoding(xCol);
        const encoding: SuggestionEncoding = {
          x: xExpr,
          y: `sum(${yCol.columnName})`,
          xType,
          yType: "quantitative",
          xLabel: xAxisLabel,
          yLabel: `sum of ${yCol.displayName}`,
          xTransform, // Include transform for consistency
        };
        if (!isExcludedEncoding(encoding)) {
          suggestion = {
            id: `areaY-${xCol.fieldId ?? xCol.columnName}-${yCol.fieldId ?? yCol.columnName}`,
            title: `${yCol.displayName} trend`,
            chartType: "areaY",
            encoding,
            rationale:
              `Cumulative trend visualization ${aggregationLabel || ""}`.trim(),
            xTransform,
          };
        }
      }
      // No fallback for area charts - they require temporal data
      break;

    case "dot":
      // Scatter Plot: 2 numerical columns
      // Only suggest scatter for small datasets - hexbin handles large ones
      if (numerical.length >= 2 && rowCount <= SCATTER_MAX_POINTS) {
        const xCol = numerical[0];
        const yCol = numerical[1];
        const encoding: SuggestionEncoding = {
          x: xCol.columnName,
          y: yCol.columnName,
          xType: "quantitative",
          yType: "quantitative",
          xLabel: xCol.displayName,
          yLabel: yCol.displayName,
        };
        if (!isExcludedEncoding(encoding)) {
          suggestion = {
            id: `dot-${xCol.fieldId ?? xCol.columnName}-${yCol.fieldId ?? yCol.columnName}`,
            title: `${yCol.displayName} vs ${xCol.displayName}`,
            chartType: "dot",
            encoding,
            rationale: "Two numeric dimensions for correlation",
          };
        }
      }
      // No suggestion for scatter with large datasets - use hexbin instead
      break;

    case "hexbin":
      // Hexbin: density visualization for 2 numerical columns
      // Always available, but especially useful for large datasets
      if (numerical.length >= 2) {
        const xCol = numerical[0];
        const yCol = numerical[1];
        const encoding: SuggestionEncoding = {
          x: xCol.columnName,
          y: yCol.columnName,
          xType: "quantitative",
          yType: "quantitative",
          xLabel: xCol.displayName,
          yLabel: yCol.displayName,
        };
        if (!isExcludedEncoding(encoding)) {
          const isLargeDataset = rowCount > SCATTER_MAX_POINTS;
          suggestion = {
            id: `hexbin-${xCol.fieldId ?? xCol.columnName}-${yCol.fieldId ?? yCol.columnName}`,
            title: `${yCol.displayName} vs ${xCol.displayName}${isLargeDataset ? "" : " (density)"}`,
            chartType: "hexbin",
            encoding,
            rationale: isLargeDataset
              ? `Density plot for ${rowCount.toLocaleString()} points`
              : "Hexagonal binning shows point density distribution",
          };
        }
      }
      break;
  }

  return suggestion ? annotateSuggestion(suggestion) : null;
}

/**
 * Generates suggestions for all chart types at once.
 * Calls suggestByChartType for each type to ensure all viable suggestions are found.
 *
 * @param insight - The insight to generate suggestions for
 * @param analysis - Column analysis results from DuckDB
 * @param rowCount - Total number of rows in the dataset
 * @param fields - Field definitions for analysis
 * @param chartTypes - Array of chart types to generate suggestions for
 * @param options - Configuration options
 * @returns Map of chart type to suggestion (or null)
 */
export function suggestForAllChartTypes(
  insight: Insight,
  analysis: ColumnAnalysis[],
  rowCount: number,
  fields: Record<string, Field>,
  chartTypes: VisualizationType[],
  options: Omit<SuggestChartsOptions, "limit" | "excludeChartTypes"> = {},
): Map<VisualizationType, ChartSuggestion | null> {
  const result = new Map<VisualizationType, ChartSuggestion | null>();

  // Generate suggestion for each chart type independently
  for (const chartType of chartTypes) {
    const suggestion = suggestByChartType(
      insight,
      analysis,
      rowCount,
      fields,
      chartType,
      options,
    );
    result.set(chartType, suggestion);
  }

  return result;
}

/**
 * Date-related column name patterns.
 * Fallback heuristic for edge cases where dates aren't properly typed.
 * Note: CSV connector now uses TimestampMillisecond for date columns,
 * so this is mainly for data from other sources or legacy imports.
 */
const DATE_COLUMN_PATTERNS = [
  /date$/i, // leaddate, bookdate, etc.
  /^date/i, // date, dateCreated, etc.
  /_date$/i, // created_date, etc.
  /arrival/i,
  /departure/i,
  /timestamp/i,
  /created/i,
  /updated/i,
  /modified/i,
  /time$/i,
];

/**
 * Returns a human-readable reason why a chart type isn't available for the data.
 * Used to display explanations when graying out chart types in the picker.
 *
 * @param chartType - The chart type to check
 * @param analysis - Column analysis from DuckDB
 * @returns Explanation string, or null if chart type should be available
 */
export function getChartTypeUnavailableReason(
  chartType: VisualizationType,
  analysis: ColumnAnalysis[],
): string | null {
  // Check for temporal columns (native DATE/TIMESTAMP types)
  const hasTemporal = analysis.some((c) => c.semantic === "temporal");

  // Also check for date-like column names (for string dates like "Feb 22, 2026")
  const hasDateLikeColumn = analysis.some((c) =>
    DATE_COLUMN_PATTERNS.some((pattern) => pattern.test(c.columnName)),
  );

  const hasTemporalOrDateLike = hasTemporal || hasDateLikeColumn;

  const hasNumerical = analysis.some((c) => c.semantic === "numerical");
  const hasCategorical = analysis.some(
    (c) =>
      c.semantic === "categorical" ||
      c.semantic === "text" ||
      c.semantic === "boolean",
  );
  const numericalCount = analysis.filter(
    (c) => c.semantic === "numerical",
  ).length;

  switch (chartType) {
    case "line":
    case "areaY":
      // Line and area charts require temporal + numerical data
      if (!hasTemporalOrDateLike) {
        return "Requires date column";
      }
      if (!hasNumerical) {
        return "Requires numeric column";
      }
      return null;

    case "dot":
      // Scatter plots need at least 2 numerical columns
      if (numericalCount < 2) {
        return "Requires 2+ numeric columns";
      }
      return null;

    case "barY":
    case "barX":
      // Bar charts need categorical + numerical
      if (!hasCategorical && !hasTemporalOrDateLike) {
        return "Requires category column";
      }
      if (!hasNumerical) {
        return "Requires numeric column";
      }
      return null;

    default:
      return null;
  }
}

function rankSuggestions(
  suggestions: ChartSuggestion[],
  columnTableMap?: Record<string, string[]>,
  totalTables = 1,
  existingFieldSet?: Set<string>,
): ChartSuggestion[] {
  const priority: Record<VisualizationType, number> = {
    line: 1,
    areaY: 1,
    barY: 2,
    barX: 2,
    dot: 3,
    hexbin: 3,
    heatmap: 3,
    raster: 3,
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

// ============================================================================
// Tag-Based Suggestion System
// ============================================================================

import {
  getChartTypesForTag,
  CHART_TYPE_METADATA,
  CHART_TAG_METADATA,
} from "@dashframe/types";

/**
 * Suggestion for a specific tag/category with the best chart type.
 */
export interface TagSuggestion {
  /** The tag this suggestion is for */
  tag: ChartTag;
  /** Tag display name */
  tagDisplayName: string;
  /** Tag description */
  tagDescription: string;
  /** The best chart type for this tag given the data */
  chartType: VisualizationType;
  /** Chart display name */
  chartDisplayName: string;
  /** The full suggestion details */
  suggestion: ChartSuggestion;
}

/**
 * Select the best chart type for a tag based on data characteristics.
 *
 * This function applies heuristics to pick the most appropriate chart type
 * within a tag category based on the data size and characteristics.
 *
 * @param tag - The chart tag
 * @param rowCount - Number of rows in the dataset
 * @param analysis - Column analysis data
 * @returns The best chart type for this tag
 */
function selectBestChartTypeForTag(
  tag: ChartTag,
  rowCount: number,
  analysis: ColumnAnalysis[],
): VisualizationType | null {
  const chartTypes = getChartTypesForTag(tag);

  // Check data characteristics
  const hasTemporalColumn = analysis.some((c) => c.semantic === "temporal");
  const hasCategoricalColumn = analysis.some(
    (c) => c.semantic === "categorical" || c.semantic === "boolean",
  );
  const numericalCount = analysis.filter(
    (c) => c.semantic === "numerical",
  ).length;

  switch (tag) {
    case "comparison":
      // Prefer barY for comparison, barX for many categories
      if (hasCategoricalColumn) {
        const maxCardinality = Math.max(
          ...analysis
            .filter(
              (c) => c.semantic === "categorical" || c.semantic === "boolean",
            )
            .map((c) => c.cardinality),
        );
        // Use horizontal bar for more than 10 categories (better readability)
        return maxCardinality > 10 ? "barX" : "barY";
      }
      return chartTypes[0] ?? null;

    case "trend":
      // Trend charts need temporal or continuous numeric X-axis
      if (hasTemporalColumn) {
        // Default to line chart for time series trends
        return "line";
      }
      // Without temporal data, need at least one numeric column for continuous X
      // (categorical data like "status" doesn't make sense for trends)
      if (numericalCount >= 2) {
        // Can show trend with numeric X and Y
        return "line";
      }
      return null; // Can't show trend without temporal or continuous data

    case "correlation":
      // Select based on data size: dot (<5K) → hexbin (5K+)
      // Note: raster is defined but not yet implemented in suggestByChartType,
      // so we use hexbin for all large datasets until raster support is added
      if (numericalCount < 2) {
        return null; // Need at least 2 numerical columns
      }
      if (rowCount <= SCATTER_MAX_POINTS) {
        return "dot";
      } else {
        return "hexbin";
      }

    case "distribution":
      // Use hexbin or heatmap for distribution visualization
      if (numericalCount >= 2) {
        return rowCount > 10000 ? "heatmap" : "hexbin";
      }
      return null; // Need numerical data

    default:
      return chartTypes[0] ?? null;
  }
}

/**
 * Generate suggestions organized by tag/category.
 *
 * For each valid tag, returns the best chart suggestion based on the data.
 * This is used for the category-based picker UI.
 *
 * @param insight - The insight providing context
 * @param analysis - Column analysis from DuckDB
 * @param rowCount - Number of rows in the dataset
 * @param fields - Field metadata keyed by field ID
 * @param options - Additional options (excludeEncodings, seed)
 * @returns Array of tag suggestions, one per valid tag
 */
export function suggestByTag(
  insight: Insight,
  analysis: ColumnAnalysis[],
  rowCount: number,
  fields: Record<string, Field>,
  options?: {
    /** Encoding signatures to exclude (e.g., "x|y|color" strings from existing visualizations) */
    excludeEncodings?: Set<string>;
    /** Seed for reproducible randomization (default: 0) */
    seed?: number;
  },
): TagSuggestion[] {
  const results: TagSuggestion[] = [];

  // Available tags to check
  const tags: ChartTag[] = [
    "comparison",
    "trend",
    "correlation",
    "distribution",
  ];

  for (const tag of tags) {
    // Select the best chart type for this tag
    const chartType = selectBestChartTypeForTag(tag, rowCount, analysis);
    if (!chartType) continue;

    // Get suggestion for this chart type with tag context
    // Tag context affects encoding selection (e.g., "trend" uses temporal X even for barY)
    const suggestion = suggestByChartType(
      insight,
      analysis,
      rowCount,
      fields,
      chartType,
      {
        excludeEncodings: options?.excludeEncodings,
        seed: options?.seed ?? 0,
        tagContext: tag,
      },
    );

    if (suggestion) {
      const tagMeta = CHART_TAG_METADATA[tag];
      const chartMeta = CHART_TYPE_METADATA[chartType];

      results.push({
        tag,
        tagDisplayName: tagMeta.displayName,
        tagDescription: tagMeta.description,
        chartType,
        chartDisplayName: chartMeta.displayName,
        suggestion,
      });
    }
  }

  return results;
}

/**
 * Get alternative chart types within the same tag as the current chart type.
 *
 * Used to show "Alternative charts" dropdown in the settings panel.
 *
 * @param currentType - The current chart type
 * @returns Array of alternative chart types (excluding current)
 */
export function getAlternativeChartTypes(
  currentType: VisualizationType,
): VisualizationType[] {
  // Get all tags for the current type
  const tags = CHART_TYPE_METADATA[currentType].tags;

  // Collect all chart types from those tags
  const alternatives = new Set<VisualizationType>();
  for (const tag of tags) {
    for (const type of getChartTypesForTag(tag)) {
      if (type !== currentType) {
        alternatives.add(type);
      }
    }
  }

  return Array.from(alternatives);
}
