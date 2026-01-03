"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { AppLayout } from "@/components/layouts/AppLayout";
import {
  useInsightMutations,
  useDataTables,
  useDataFrames,
  useDataFrameMutations,
  useVisualizations,
  useVisualizationMutations,
} from "@dashframe/core";
import type {
  Insight,
  UUID,
  Field,
  InsightMetric,
  VegaLiteSpec,
} from "@dashframe/types";
import type { Insight as LocalInsight } from "@/lib/stores/types";
import { NotFoundView } from "./NotFoundView";
import { DataModelSection } from "./sections/DataModelSection";
import { DataPreviewSection } from "./sections/DataPreviewSection";
import { VisualizationsSection } from "./sections/VisualizationsSection";
import { InsightConfigPanel } from "./config-panel";
import { useInsightView } from "@/hooks/useInsightView";
import { useLazyDuckDB } from "@/components/providers/LazyDuckDBProvider";
import type { ChartSuggestion } from "@/lib/visualizations/suggest-charts";
import { computeCombinedFields } from "@/lib/insights/compute-combined-fields";
import { analyzeView, ensureTableLoaded } from "@dashframe/engine-browser";
import { getDataFrame } from "@dashframe/core";
import type { ColumnAnalysis, DataFrameAnalysis } from "@dashframe/types";
import { fieldIdToColumnAlias } from "@dashframe/engine";
import { mergeAnalyses } from "@/lib/visualizations/merge-analyses";

/**
 * Remap column names in analysis results from original names to UUID aliases.
 *
 * When analyzing individual DataFrame tables (e.g., `df_04de4d84_...`), DuckDB
 * returns original column names like `roomattend`. But the joined insight view
 * uses UUID-aliased names like `field_<uuid>`. This function maps the analysis
 * to use the UUID aliases expected by the visualization system.
 *
 * @param analysis - Column analysis with original column names
 * @param fields - Field array containing the columnName → id mapping
 * @returns Analysis with column names remapped to UUID aliases
 */
function remapAnalysisColumnNames(
  analysis: ColumnAnalysis[],
  fields: Field[],
): ColumnAnalysis[] {
  // Build reverse lookup: original column name → field UUID alias
  const columnNameToAlias = new Map<string, string>();
  for (const field of fields) {
    if (field.columnName) {
      columnNameToAlias.set(field.columnName, fieldIdToColumnAlias(field.id));
    }
  }

  return analysis.map((col) => {
    const alias = columnNameToAlias.get(col.columnName);
    if (alias) {
      return { ...col, columnName: alias };
    }
    // If no mapping found (e.g., computed columns), keep original name
    return col;
  });
}

import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import type { ChartEncoding, VisualizationEncoding } from "@dashframe/types";
import { fieldEncoding, metricEncoding } from "@dashframe/types";
import { useConfirmDialogStore } from "@/lib/stores/confirm-dialog-store";

/** Helper context for DataFrame analysis operations */
interface AnalysisContext {
  duckDBConnection: AsyncDuckDBConnection;
  updateAnalysis: (id: UUID, analysis: DataFrameAnalysis) => Promise<void>;
}

/**
 * Analyze a single DataFrame and cache the results.
 * Returns the analysis for merging with other DataFrames.
 */
async function analyzeAndCacheDataFrame(
  dataFrameId: UUID,
  fields: Field[],
  rowCount: number,
  ctx: AnalysisContext,
): Promise<DataFrameAnalysis | null> {
  const dataFrame = await getDataFrame(dataFrameId);
  if (!dataFrame) {
    console.error("[InsightView] DataFrame entity not found:", dataFrameId);
    return null;
  }

  const tableName = await ensureTableLoaded(dataFrame, ctx.duckDBConnection);
  const results = await analyzeView(ctx.duckDBConnection, tableName);
  const remappedResults = remapAnalysisColumnNames(results, fields);

  const analysis: DataFrameAnalysis = {
    columns: remappedResults,
    rowCount,
    analyzedAt: Date.now(),
    fieldHash: fields
      .map((f) => f.id)
      .sort()
      .join(","),
  };

  await ctx.updateAnalysis(dataFrameId, analysis);
  console.log(
    "[InsightView] DataFrame cached",
    dataFrameId,
    remappedResults.length,
    "columns",
  );

  return analysis;
}

/** Entry with optional cached analysis */
interface DataFrameEntry {
  id: UUID;
  rowCount?: number;
  analysis?: DataFrameAnalysis;
}

/** Table entry with optional fields */
interface DataTableEntry {
  id: UUID;
  dataFrameId?: string;
  fields?: Field[];
}

/** Join specification */
interface JoinSpec {
  rightTableId: UUID;
}

/**
 * Analyze joined DataFrames and merge results.
 * Returns merged column analysis from all DataFrames.
 */
async function analyzeJoinedDataFrames(
  baseDataFrameEntry: DataFrameEntry,
  baseFields: Field[],
  joins: JoinSpec[],
  allDataTables: DataTableEntry[],
  allDataFrameEntries: DataFrameEntry[],
  ctx: AnalysisContext,
): Promise<ColumnAnalysis[]> {
  const analysesToMerge: DataFrameAnalysis[] = [];

  // Analyze base DataFrame if not cached
  if (baseDataFrameEntry.analysis) {
    analysesToMerge.push(baseDataFrameEntry.analysis);
  } else {
    const baseAnalysis = await analyzeAndCacheDataFrame(
      baseDataFrameEntry.id,
      baseFields,
      baseDataFrameEntry.rowCount ?? 0,
      ctx,
    );
    if (!baseAnalysis) return [];
    analysesToMerge.push(baseAnalysis);
  }

  // Analyze each joined DataFrame if not cached
  for (const join of joins) {
    const joinedTable = allDataTables.find((t) => t.id === join.rightTableId);
    if (!joinedTable?.dataFrameId) continue;

    const joinedDfEntry = allDataFrameEntries.find(
      (df) => df.id === joinedTable.dataFrameId,
    );
    if (!joinedDfEntry) continue;

    if (joinedDfEntry.analysis) {
      analysesToMerge.push(joinedDfEntry.analysis);
    } else {
      const joinFields = joinedTable.fields ?? [];
      const joinAnalysis = await analyzeAndCacheDataFrame(
        joinedDfEntry.id,
        joinFields,
        joinedDfEntry.rowCount ?? 0,
        ctx,
      );
      if (joinAnalysis) {
        analysesToMerge.push(joinAnalysis);
      }
    }
  }

  return mergeAnalyses(analysesToMerge);
}

interface InsightViewProps {
  insight: Insight;
}

interface ParsedEncoding {
  dimensionFields: string[];
  metrics: InsightMetric[];
}

/**
 * Parse a single encoding axis value to determine if it's a dimension or metric.
 * Dimensions are raw field names, metrics are aggregation expressions like "sum(revenue)".
 *
 * @param value - The encoding value (e.g., "category" or "sum(revenue)")
 * @param parseAggregateExpression - Function to parse aggregation expressions
 * @param dataTableId - ID of the data table for metric creation
 * @returns Object with either a dimension field name or a metric object
 */
function parseEncodingAxis(
  value: string | undefined,
  parseAggregateExpression: (expr: string) => {
    aggregation: InsightMetric["aggregation"];
    columnName?: string;
  } | null,
  dataTableId: string,
): { dimension?: string; metric?: InsightMetric } {
  if (!value) return {};

  const parsed = parseAggregateExpression(value);
  if (parsed) {
    return {
      metric: {
        id: crypto.randomUUID() as UUID,
        name: value,
        sourceTable: dataTableId,
        columnName: parsed.columnName,
        aggregation: parsed.aggregation,
      },
    };
  }
  return { dimension: value };
}

/**
 * Process a full chart encoding to extract all dimensions and metrics.
 * Analyzes x, y, and color channels to separate raw fields from aggregations.
 *
 * @param encoding - The chart encoding with SQL expressions (ChartEncoding)
 * @param parseAggregateExpression - Function to parse aggregation expressions
 * @param dataTableId - ID of the data table for metric creation
 * @returns Object containing arrays of dimension field names and metric objects
 */
function parseChartEncoding(
  encoding: ChartEncoding,
  parseAggregateExpression: (expr: string) => {
    aggregation: InsightMetric["aggregation"];
    columnName?: string;
  } | null,
  dataTableId: string,
): ParsedEncoding {
  const dimensionFields: string[] = [];
  const metrics: InsightMetric[] = [];

  // Process X axis
  const xResult = parseEncodingAxis(
    encoding.x,
    parseAggregateExpression,
    dataTableId,
  );
  if (xResult.dimension) dimensionFields.push(xResult.dimension);
  if (xResult.metric) metrics.push(xResult.metric);

  // Process Y axis
  const yResult = parseEncodingAxis(
    encoding.y,
    parseAggregateExpression,
    dataTableId,
  );
  if (yResult.dimension) dimensionFields.push(yResult.dimension);
  if (yResult.metric) metrics.push(yResult.metric);

  // Process color (only as dimension)
  if (encoding.color) {
    const colorParsed = parseAggregateExpression(encoding.color);
    if (!colorParsed) {
      dimensionFields.push(encoding.color);
    }
  }

  return { dimensionFields, metrics };
}

/**
 * Merge new fields and metrics with existing insight fields, avoiding duplicates.
 * Field IDs are compared directly; metrics are compared by column name + aggregation.
 *
 * @param newFieldIds - Field IDs to add from the new visualization
 * @param newMetrics - Metrics to add from the new visualization
 * @param existingFieldIds - Current insight field IDs
 * @param existingMetrics - Current insight metrics
 * @returns Merged arrays with no duplicates
 */
function mergeFieldsAndMetrics(
  newFieldIds: UUID[],
  newMetrics: InsightMetric[],
  existingFieldIds: UUID[],
  existingMetrics: InsightMetric[],
): { mergedFieldIds: UUID[]; mergedMetrics: InsightMetric[] } {
  const mergedFieldIds = [
    ...existingFieldIds,
    ...newFieldIds.filter((id) => !existingFieldIds.includes(id)),
  ];

  const mergedMetrics = [...existingMetrics];
  for (const newMetric of newMetrics) {
    const isDuplicate = existingMetrics.some(
      (m) =>
        m.columnName === newMetric.columnName &&
        m.aggregation === newMetric.aggregation,
    );
    if (!isDuplicate) {
      mergedMetrics.push(newMetric);
    }
  }

  return { mergedFieldIds, mergedMetrics };
}

/**
 * Convert a ChartEncoding (SQL expressions) to VisualizationEncoding (prefixed IDs).
 *
 * This is the key conversion point between:
 * - ChartEncoding: Used for rendering (plain strings like "category" or "sum(revenue)")
 * - VisualizationEncoding: Used for persistence (prefixed IDs like "field:uuid" or "metric:uuid")
 *
 * @param chartEncoding - The chart encoding with SQL expressions
 * @param fieldIdMap - Map from column name to field ID
 * @param mergedMetrics - Metrics array (after merge) with their IDs
 * @param parseAggregateExpression - Function to detect if a string is an aggregation
 * @param suggestion - The full chart suggestion containing transforms
 */
function convertToVisualizationEncoding(
  chartEncoding: ChartEncoding,
  fieldIdMap: Map<string, UUID>,
  mergedMetrics: InsightMetric[],
  parseAggregateExpression: (expr: string) => {
    aggregation: InsightMetric["aggregation"];
    columnName?: string;
  } | null,
  suggestion?: ChartSuggestion,
): VisualizationEncoding {
  const result: VisualizationEncoding = {};

  // Helper to convert a single channel
  const convertChannel = (
    value: string | undefined,
  ):
    | ReturnType<typeof fieldEncoding>
    | ReturnType<typeof metricEncoding>
    | undefined => {
    if (!value) return undefined;

    // Check if it's an aggregation expression
    const parsed = parseAggregateExpression(value);
    if (parsed) {
      // It's a metric - find matching metric in mergedMetrics by aggregation + columnName
      const metric = mergedMetrics.find(
        (m) =>
          m.aggregation === parsed.aggregation &&
          m.columnName === parsed.columnName,
      );
      if (metric) {
        return metricEncoding(metric.id);
      }
      // Fallback: shouldn't happen if mergeFieldsAndMetrics was called first
      console.warn(
        `[convertToVisualizationEncoding] Metric not found for: ${value}`,
      );
      return undefined;
    }

    // It's a dimension field - find field ID by column name
    const fieldId = fieldIdMap.get(value);
    if (fieldId) {
      return fieldEncoding(fieldId);
    }
    console.warn(
      `[convertToVisualizationEncoding] Field not found for: ${value}`,
    );
    return undefined;
  };

  result.x = convertChannel(chartEncoding.x);
  result.y = convertChannel(chartEncoding.y);
  result.color = convertChannel(chartEncoding.color);
  result.size = convertChannel(chartEncoding.size);
  result.xType = chartEncoding.xType;
  result.yType = chartEncoding.yType;

  // Copy date transforms from suggestion (for temporal axis aggregation)
  if (suggestion?.xTransform) {
    result.xTransform = suggestion.xTransform;
  }
  if (suggestion?.yTransform) {
    result.yTransform = suggestion.yTransform;
  }

  return result;
}

/**
 * InsightView - Unified view for insight page
 *
 * Single-page layout (no tabs) with modular sections:
 * - Data sources
 * - Data preview
 * - Configuration (fields, metrics)
 * - Chart suggestions
 * - Visualizations
 *
 * Performance optimizations:
 * - Local state for insight name with debounced updates
 * - Sections only re-render when their specific data changes
 */
export function InsightView({ insight }: InsightViewProps) {
  const insightId = insight.id;
  const router = useRouter();

  // Local state for insight name (prevents re-renders on typing)
  const [localName, setLocalName] = useState(insight.name);
  const saveTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // Chart suggestions state
  const [suggestionSeed, setSuggestionSeed] = useState(0);
  const [columnAnalysis, setColumnAnalysis] = useState<ColumnAnalysis[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Sync local name when insight prop changes from external source
  useEffect(() => {
    setLocalName(insight.name);
  }, [insight.name]);

  // Mutations
  const { update: updateInsight } = useInsightMutations();
  const { create: createVisualizationLocal, remove: removeVisualization } =
    useVisualizationMutations();
  const { updateAnalysis } = useDataFrameMutations();
  const { confirm } = useConfirmDialogStore();

  // Debounced save for insight name (500ms after typing stops)
  const handleNameChange = useCallback(
    (newName: string) => {
      setLocalName(newName);

      // Clear previous timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      // Set new timeout to save after 500ms of no typing
      saveTimeoutRef.current = setTimeout(() => {
        if (newName !== insight.name) {
          updateInsight(insightId, { name: newName });
        }
      }, 500);
    },
    [insightId, insight.name, updateInsight],
  );

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // Fetch related data
  const { data: allDataTables = [] } = useDataTables();
  const { data: allDataFrameEntries = [] } = useDataFrames();
  const { data: allVisualizations = [] } = useVisualizations();

  // DuckDB connection for chart suggestions (lazy-loaded on component mount)
  const {
    connection: duckDBConnection,
    isInitialized: isDuckDBReady,
    isLoading: isDuckDBLoading,
  } = useLazyDuckDB();

  // Find data table
  const dataTable = useMemo(
    () => allDataTables.find((t) => t.id === insight.baseTableId),
    [allDataTables, insight.baseTableId],
  );

  // Get DuckDB view/table name for chart rendering
  // For insights with joins, creates a view with joined data
  // For simple insights, returns the base table name
  const { viewName: chartTableName, isReady: isChartViewReady } =
    useInsightView(insight);

  // Compute metadata
  const baseDataFrameEntry = useMemo(
    () =>
      dataTable?.dataFrameId
        ? allDataFrameEntries.find((e) => e.id === dataTable.dataFrameId)
        : undefined,
    [allDataFrameEntries, dataTable],
  );

  const rowCount = baseDataFrameEntry?.rowCount ?? 0;

  // Compute combined field count (base + joins)
  const combinedFieldCount = useMemo(() => {
    if (!dataTable) return 0;
    const { count } = computeCombinedFields(
      dataTable,
      insight.joins,
      allDataTables,
    );
    return count;
  }, [dataTable, insight.joins, allDataTables]);

  // Get visualizations for this insight
  const insightVisualizations = useMemo(
    () => allVisualizations.filter((v) => v.insightId === insightId),
    [allVisualizations, insightId],
  );

  // Build field map for suggestions
  // Key by field ID to match enrichColumnAnalysis lookup in suggest-charts.ts
  // Includes fields from both base table AND joined tables
  const fieldMap = useMemo<Record<string, Field>>(() => {
    if (!dataTable) return {};
    const map: Record<string, Field> = {};

    // Add base table fields (keyed by field ID)
    (dataTable.fields ?? [])
      .filter((f) => !f.name.startsWith("_"))
      .forEach((f) => {
        map[f.id] = f;
      });

    // Add fields from joined tables (keyed by field ID)
    insight.joins?.forEach((join) => {
      const joinTable = allDataTables.find((t) => t.id === join.rightTableId);
      if (joinTable) {
        (joinTable.fields ?? [])
          .filter((f) => !f.name.startsWith("_"))
          .forEach((f) => {
            // Don't overwrite if field ID already exists (base table takes precedence)
            if (!map[f.id]) {
              map[f.id] = f;
            }
          });
      }
    });

    return map;
  }, [dataTable, insight.joins, allDataTables]);

  // Helper: Compute a hash of field IDs for cache invalidation
  // When fields change (e.g., new columns added via join), the cache is invalid
  const computeFieldHash = useCallback((): string => {
    const fieldIds: string[] = [];

    // Base table fields
    (dataTable?.fields ?? []).forEach((f) => fieldIds.push(f.id));

    // Joined table fields
    insight.joins?.forEach((join) => {
      const joinTable = allDataTables.find((t) => t.id === join.rightTableId);
      (joinTable?.fields ?? []).forEach((f) => fieldIds.push(f.id));
    });

    // Sort for deterministic hash
    fieldIds.sort();
    return fieldIds.join(",");
  }, [dataTable?.fields, insight.joins, allDataTables]);

  // Column analysis effect - uses cached analysis from DataFrame if available
  // DuckDB is lazy-loaded, so we check isDuckDBLoading before running analysis
  useEffect(() => {
    if (isDuckDBLoading || !duckDBConnection || !isDuckDBReady) return;
    if (!chartTableName || !isChartViewReady) {
      setColumnAnalysis([]);
      return;
    }
    // Wait for DataFrame entity to load before checking cache
    // This prevents triggering analysis before we can check for cached results
    if (!baseDataFrameEntry) return;

    const hasJoins = (insight.joins?.length ?? 0) > 0;
    const fieldHash = computeFieldHash();

    // Helper: Check if all joined DataFrames are loaded (for joined insights)
    const areJoinedDataFramesLoaded = (): boolean => {
      for (const join of insight.joins ?? []) {
        const joinedTable = allDataTables.find(
          (t) => t.id === join.rightTableId,
        );
        if (!joinedTable?.dataFrameId) return false;
        const joinedDf = allDataFrameEntries.find(
          (df) => df.id === joinedTable.dataFrameId,
        );
        if (!joinedDf) return false;
      }
      return true;
    };

    // For joined insights, wait for all DataFrames to load
    if (hasJoins && !areJoinedDataFramesLoaded()) return;

    // Helper: Get cached columns for single DataFrame (non-joined)
    const getCachedSingleAnalysis = (): ColumnAnalysis[] | null => {
      if (!baseDataFrameEntry.analysis) {
        console.log("[InsightView] No cached analysis on DataFrame");
        return null;
      }
      const cached = baseDataFrameEntry.analysis;
      if (cached.fieldHash !== fieldHash) {
        console.log("[InsightView] Cache miss: fieldHash mismatch", {
          cached: cached.fieldHash,
          current: fieldHash,
        });
        return null;
      }
      if (cached.columns.length === 0) {
        console.log("[InsightView] Cache miss: empty columns");
        return null;
      }
      console.log(
        "[InsightView] Cache HIT - using cached analysis",
        cached.columns.length,
        "columns",
      );
      return cached.columns;
    };

    // Helper: Get merged cached columns for joined insights
    const getCachedJoinedAnalysis = (): ColumnAnalysis[] | null => {
      if (!baseDataFrameEntry.analysis) {
        console.log(
          "[InsightView] Joined: No cached analysis on base DataFrame",
        );
        return null;
      }
      const analysesToMerge: DataFrameAnalysis[] = [
        baseDataFrameEntry.analysis,
      ];
      for (const join of insight.joins ?? []) {
        const joinedTable = allDataTables.find(
          (t) => t.id === join.rightTableId,
        );
        if (!joinedTable?.dataFrameId) {
          console.log(
            "[InsightView] Joined: Missing dataFrameId for join table",
          );
          return null;
        }
        const joinedDf = allDataFrameEntries.find(
          (df) => df.id === joinedTable.dataFrameId,
        );
        if (!joinedDf?.analysis) {
          console.log(
            "[InsightView] Joined: No cached analysis on joined DataFrame",
            joinedTable.dataFrameId,
          );
          return null;
        }
        analysesToMerge.push(joinedDf.analysis);
      }
      const merged = mergeAnalyses(analysesToMerge);
      console.log(
        "[InsightView] Cache HIT - using merged cached analyses",
        merged.length,
        "columns",
      );
      return merged;
    };

    // Try cached analysis first
    const cachedColumns = hasJoins
      ? getCachedJoinedAnalysis()
      : getCachedSingleAnalysis();

    if (cachedColumns) {
      console.log("[InsightView] Using cached analysis, skipping DuckDB");
      setColumnAnalysis(cachedColumns);
      return;
    }

    // No valid cache - run analysis and cache results
    // Skip if already analyzing (prevents duplicate runs from effect re-triggering)
    if (isAnalyzing) {
      console.log("[InsightView] Analysis already in progress, skipping...");
      return;
    }

    console.log("[InsightView] Cache miss - running DuckDB analysis...");
    const runAnalysis = async () => {
      setIsAnalyzing(true);
      const ctx: AnalysisContext = { duckDBConnection, updateAnalysis };

      try {
        if (!hasJoins) {
          // Single DataFrame - analyze and cache
          console.log("[InsightView] Analyzing single DataFrame...");
          const results = await analyzeView(duckDBConnection, chartTableName);
          console.log(
            "[InsightView] Analysis complete",
            results.length,
            "columns",
          );
          setColumnAnalysis(results);

          // Cache for this DataFrame
          const analysisToCache: DataFrameAnalysis = {
            columns: results,
            rowCount,
            analyzedAt: Date.now(),
            fieldHash,
          };
          await updateAnalysis(baseDataFrameEntry.id, analysisToCache);
          console.log(
            "[InsightView] Analysis cached for DataFrame",
            baseDataFrameEntry.id,
          );
        } else {
          // Joined insight - analyze each DataFrame individually and cache
          console.log(
            "[InsightView] Analyzing joined DataFrames individually...",
          );
          const baseFields = dataTable?.fields ?? [];
          const merged = await analyzeJoinedDataFrames(
            baseDataFrameEntry,
            baseFields,
            insight.joins ?? [],
            allDataTables,
            allDataFrameEntries,
            ctx,
          );
          console.log(
            "[InsightView] Merged analysis complete",
            merged.length,
            "columns",
          );
          setColumnAnalysis(merged);
        }
      } catch (e) {
        console.error("[InsightView] Analysis failed:", e);
        setColumnAnalysis([]);
      } finally {
        setIsAnalyzing(false);
      }
    };

    // Defer to allow React to paint first
    const timeoutId = setTimeout(runAnalysis, 100);
    return () => clearTimeout(timeoutId);
    // Note: dataTable?.fields is intentionally excluded from dependencies.
    // The computeFieldHash callback already captures field changes via its
    // dependency on dataTable?.fields, and we use fieldHash for cache invalidation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    duckDBConnection,
    isDuckDBReady,
    isDuckDBLoading,
    chartTableName,
    isChartViewReady,
    baseDataFrameEntry,
    insight.joins,
    computeFieldHash,
    rowCount,
    updateAnalysis,
    allDataTables,
    allDataFrameEntries,
    isAnalyzing,
  ]);

  // Get existing field and metric column names from insight configuration
  // Includes fields from both base table AND joined tables
  const existingFieldNames = useMemo(() => {
    if (!dataTable) return [];

    const names: string[] = [];

    // Map selected field IDs to column names (includes base + joined tables)
    const fieldIdToName = new Map<string, string>();
    (dataTable.fields ?? []).forEach((f) => {
      fieldIdToName.set(f.id, f.columnName ?? f.name);
    });

    // Add joined table fields to the mapping
    insight.joins?.forEach((join) => {
      const joinTable = allDataTables.find((t) => t.id === join.rightTableId);
      if (joinTable) {
        (joinTable.fields ?? []).forEach((f) => {
          fieldIdToName.set(f.id, f.columnName ?? f.name);
        });
      }
    });

    (insight.selectedFields ?? []).forEach((id) => {
      const name = fieldIdToName.get(id);
      if (name) names.push(name);
    });

    // Also include metric column names (the underlying column, not the aggregation)
    (insight.metrics ?? []).forEach((metric) => {
      if (metric.columnName) {
        names.push(metric.columnName);
      }
    });

    return names;
  }, [
    dataTable,
    insight.selectedFields,
    insight.metrics,
    insight.joins,
    allDataTables,
  ]);

  // Create minimal insight object for suggestions
  // Uses LocalInsight type from stores which is expected by suggestCharts
  const insightForSuggestions = useMemo<LocalInsight | null>(() => {
    if (!dataTable) return null;
    return {
      id: insightId,
      name: insight.name,
      baseTable: {
        tableId: dataTable.id,
        selectedFields: [],
      },
      metrics: [],
      createdAt: insight.createdAt,
      updatedAt: insight.updatedAt ?? insight.createdAt,
    };
  }, [
    insightId,
    insight.name,
    insight.createdAt,
    insight.updatedAt,
    dataTable,
  ]);

  // Parse aggregate expression like "sum(amount)" → { aggregation: "sum", columnName: "amount" }
  const parseAggregateExpression = useCallback(
    (
      expr: string,
    ): {
      aggregation: InsightMetric["aggregation"];
      columnName: string;
    } | null => {
      const match = expr.match(
        /^(sum|avg|count|min|max|count_distinct)\(([^)]+)\)$/i,
      );
      if (match) {
        return {
          aggregation: match[1].toLowerCase() as InsightMetric["aggregation"],
          columnName: match[2],
        };
      }
      return null;
    },
    [],
  );

  // Handle creating a chart from suggestion
  const handleCreateChart = useCallback(
    async (suggestion: ChartSuggestion) => {
      if (!dataTable?.dataFrameId || !isChartViewReady) return;

      // Parse encoding to extract dimensions and metrics
      const { dimensionFields, metrics } = parseChartEncoding(
        suggestion.encoding,
        parseAggregateExpression,
        dataTable.id,
      );

      // Map dimension column names to field IDs (base table + joined tables)
      // Supports both original column names AND UUID-based aliases (field_<uuid>)
      // because suggestions use UUID aliases but we need to look up field IDs
      const fieldIdMap = new Map<string, UUID>();

      // Base table fields - add both original name and UUID alias
      (dataTable.fields ?? []).forEach((f) => {
        fieldIdMap.set(f.columnName ?? f.name, f.id);
        // Also add UUID-based alias (field_<uuid>) for suggestion encoding lookups
        fieldIdMap.set(fieldIdToColumnAlias(f.id), f.id);
      });

      // Joined table fields - add both original name and UUID alias
      insight.joins?.forEach((join) => {
        const joinTable = allDataTables.find((t) => t.id === join.rightTableId);
        if (joinTable) {
          (joinTable.fields ?? []).forEach((f) => {
            const key = f.columnName ?? f.name;
            // Don't overwrite if column already exists (base table takes precedence)
            if (!fieldIdMap.has(key)) {
              fieldIdMap.set(key, f.id);
            }
            // Always add UUID alias (no collision risk with these unique keys)
            fieldIdMap.set(fieldIdToColumnAlias(f.id), f.id);
          });
        }
      });

      // Convert dimension column names to field IDs
      const newSelectedFieldIds = dimensionFields
        .map((colName) => fieldIdMap.get(colName))
        .filter((id): id is UUID => id !== undefined);

      // Merge with existing insight fields/metrics
      const { mergedFieldIds, mergedMetrics } = mergeFieldsAndMetrics(
        newSelectedFieldIds,
        metrics,
        insight.selectedFields ?? [],
        insight.metrics ?? [],
      );

      // Update insight with merged fields and metrics
      // IMPORTANT: Must await to ensure fields/metrics are saved before navigation
      await updateInsight(insightId, {
        selectedFields: mergedFieldIds,
        metrics: mergedMetrics,
      });

      // Convert ChartEncoding (SQL expressions) to VisualizationEncoding (prefixed IDs)
      // Pass the full suggestion to preserve xTransform/yTransform for temporal axes
      const visualizationEncoding = convertToVisualizationEncoding(
        suggestion.encoding,
        fieldIdMap,
        mergedMetrics,
        parseAggregateExpression,
        suggestion,
      );

      // Create visualization using encoding-driven rendering
      const vizId = await createVisualizationLocal(
        suggestion.title,
        insightId,
        suggestion.chartType,
        {} as VegaLiteSpec, // Deprecated: rendering now uses encoding
        visualizationEncoding,
      );

      // Navigate to the visualization
      router.push(`/visualizations/${vizId}`);
    },
    [
      dataTable,
      allDataTables,
      isChartViewReady,
      parseAggregateExpression,
      insight,
      updateInsight,
      insightId,
      createVisualizationLocal,
      router,
    ],
  );

  // Handle regenerating suggestions with a different seed
  const handleRegenerate = useCallback(() => {
    setSuggestionSeed((prev) => prev + 1);
  }, []);

  // Handle duplicating a visualization
  const handleDuplicateVisualization = useCallback(
    async (vizId: string) => {
      const viz = insightVisualizations.find((v) => v.id === vizId);
      if (!viz) return;

      const newVizId = await createVisualizationLocal(
        `${viz.name} (copy)`,
        insightId,
        viz.visualizationType,
        viz.spec,
        viz.encoding,
      );

      router.push(`/visualizations/${newVizId}`);
    },
    [insightVisualizations, createVisualizationLocal, insightId, router],
  );

  // Handle deleting a visualization
  const handleDeleteVisualization = useCallback(
    (vizId: string, name: string) => {
      confirm({
        title: "Delete visualization",
        description: `Are you sure you want to delete "${name}"? This action cannot be undone.`,
        confirmLabel: "Delete",
        variant: "destructive",
        onConfirm: async () => {
          await removeVisualization(vizId);
        },
      });
    },
    [confirm, removeVisualization],
  );

  // Data table not found - check after all hooks are called
  if (!dataTable) {
    return <NotFoundView type="dataTable" />;
  }

  return (
    <AppLayout
      breadcrumbs={[
        { label: "Insights", href: "/insights" },
        { label: localName || "Untitled" },
      ]}
      leftPanel={
        <InsightConfigPanel
          insight={insight}
          dataTable={dataTable}
          allDataTables={allDataTables}
          name={localName}
          onNameChange={handleNameChange}
        />
      }
    >
      {/* Main content - unified view */}
      <div className="container mx-auto max-w-6xl space-y-6 px-6 py-6">
        {/* Data Model - shows data sources (tables and joins) */}
        <DataModelSection
          insight={insight}
          dataTable={dataTable}
          allDataTables={allDataTables}
          combinedFieldCount={combinedFieldCount}
        />

        {/* Data Preview - shows table with toggle for Join Preview vs Insight Result */}
        <DataPreviewSection
          insight={insight}
          combinedFieldCount={combinedFieldCount}
        />

        {/* Visualizations - Shows chart type picker or grid of existing visualizations */}
        <VisualizationsSection
          visualizations={insightVisualizations}
          tableName={chartTableName ?? undefined}
          insight={insightForSuggestions ?? undefined}
          columnAnalysis={columnAnalysis}
          rowCount={rowCount}
          fieldMap={fieldMap}
          existingFields={existingFieldNames}
          onCreateChart={handleCreateChart}
          onDuplicateVisualization={handleDuplicateVisualization}
          onDeleteVisualization={handleDeleteVisualization}
          isChartViewLoading={!isChartViewReady}
          suggestionSeed={suggestionSeed}
          onRegenerate={handleRegenerate}
        />
      </div>
    </AppLayout>
  );
}
