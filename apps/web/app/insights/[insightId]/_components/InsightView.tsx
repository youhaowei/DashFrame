"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@dashframe/ui";
import { AppLayout } from "@/components/layouts/AppLayout";
import {
  useInsightMutations,
  useDataTables,
  useDataFrames,
  useVisualizations,
  useVisualizationMutations,
} from "@dashframe/core";
import type {
  Insight,
  UUID,
  Field,
  InsightMetric,
  VegaLiteSpec,
  ColumnType,
} from "@dashframe/types";
import type { Insight as LocalInsight } from "@/lib/stores/types";
import { NotFoundView } from "./NotFoundView";
import { DataModelSection } from "./sections/DataModelSection";
import { SuggestedChartsSection } from "./sections/SuggestedChartsSection";
import { VisualizationsSection } from "./sections/VisualizationsSection";
import { InsightConfigPanel } from "./config-panel";
import { useDataFramePagination } from "@/hooks/useDataFramePagination";
import { useDuckDB } from "@/components/providers/DuckDBProvider";
import { suggestCharts } from "@/lib/visualizations/suggest-charts";
import type { ChartSuggestion } from "@/lib/visualizations/suggest-charts";
import { computeCombinedFields } from "@/lib/insights/compute-combined-fields";
import {
  analyzeDataFrame,
  type ColumnAnalysis,
} from "@dashframe/engine-browser";

interface InsightViewProps {
  insight: Insight;
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

  // Sync local name when insight prop changes from external source
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional: syncing local state from prop changes
    setLocalName(insight.name);
  }, [insight.name]);

  // Mutations
  const { update: updateInsight } = useInsightMutations();
  const { create: createVisualizationLocal } = useVisualizationMutations();

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

  // DuckDB connection for chart suggestions
  const { connection: duckDBConnection, isInitialized: isDuckDBReady } =
    useDuckDB();

  // Find data table
  const dataTable = useMemo(
    () => allDataTables.find((t) => t.id === insight.baseTableId),
    [allDataTables, insight.baseTableId],
  );

  // Pagination hook for DuckDB table readiness
  const { isReady: isPreviewReady } = useDataFramePagination(
    dataTable?.dataFrameId,
  );

  // Compute metadata
  const baseDataFrameEntry = useMemo(
    () =>
      dataTable?.dataFrameId
        ? allDataFrameEntries.find((e) => e.id === dataTable.dataFrameId)
        : undefined,
    [allDataFrameEntries, dataTable?.dataFrameId],
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

  // Determine if insight is configured (has fields or metrics)
  const isConfigured =
    (insight.selectedFields?.length ?? 0) > 0 ||
    (insight.metrics?.length ?? 0) > 0;

  // Build field map for suggestions
  const fieldMap = useMemo<Record<string, Field>>(() => {
    if (!dataTable) return {};
    const map: Record<string, Field> = {};
    (dataTable.fields ?? [])
      .filter((f) => !f.name.startsWith("_"))
      .forEach((f) => {
        map[f.name] = f;
      });
    return map;
  }, [dataTable]);

  // Column analysis effect - runs DuckDB analysis on the source table
  // Now runs for ALL insights (not just unconfigured) to support suggestions
  useEffect(() => {
    if (!duckDBConnection || !isDuckDBReady) return;
    if (!dataTable?.dataFrameId) return;
    if (!isPreviewReady) return;

    const runAnalysis = async () => {
      try {
        const targetTable = `df_${dataTable.dataFrameId!.replace(/-/g, "_")}`;

        // Prepare columns list from fields
        const colsToAnalyze = (dataTable.fields ?? [])
          .filter((f) => !f.name.startsWith("_"))
          .map((f) => ({
            name: f.columnName ?? f.name,
            type: f.type as ColumnType,
          }));

        if (colsToAnalyze.length === 0) {
          setColumnAnalysis([]);
          return;
        }

        // Run DuckDB analysis
        const results = await analyzeDataFrame(
          duckDBConnection,
          targetTable,
          colsToAnalyze,
        );

        setColumnAnalysis(results);
      } catch (e) {
        console.error("[InsightView] Analysis failed:", e);
        setColumnAnalysis([]);
      }
    };

    runAnalysis();
  }, [
    duckDBConnection,
    isDuckDBReady,
    dataTable?.dataFrameId,
    dataTable?.fields,
    isPreviewReady,
  ]);

  // Get existing field and metric column names from insight configuration
  const existingFieldNames = useMemo(() => {
    if (!dataTable) return [];

    const names: string[] = [];

    // Map selected field IDs to column names
    const fieldIdToName = new Map<string, string>();
    (dataTable.fields ?? []).forEach((f) => {
      fieldIdToName.set(f.id, f.columnName ?? f.name);
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
  }, [dataTable, insight.selectedFields, insight.metrics]);

  // Build set of existing visualization encoding signatures for deduplication
  const existingVizSignatures = useMemo(() => {
    const signatures = new Set<string>();
    insightVisualizations.forEach((viz) => {
      if (viz.encoding) {
        // Create a normalized signature from encoding (x, y, color)
        const sig = [
          viz.encoding.x ?? "",
          viz.encoding.y ?? "",
          viz.encoding.color ?? "",
        ].join("|");
        signatures.add(sig);
      }
    });
    return signatures;
  }, [insightVisualizations]);

  // Generate chart suggestions for all insights
  // Filters out suggestions that match existing visualizations
  const suggestions = useMemo<ChartSuggestion[]>(() => {
    // Wait for prerequisites
    if (!isPreviewReady) return [];
    if (columnAnalysis.length === 0) return [];
    if (rowCount === 0) return [];

    try {
      // Create minimal insight object for suggestions
      // Uses LocalInsight type from stores which is expected by suggestCharts
      const insightForSuggestions: LocalInsight = {
        id: insightId,
        name: insight.name,
        baseTable: {
          tableId: dataTable!.id,
          selectedFields: [],
        },
        metrics: [],
        createdAt: insight.createdAt,
        updatedAt: insight.updatedAt ?? insight.createdAt,
      };

      // Column table map for ranking multi-table charts
      const columnTableMap: Record<string, UUID[]> = {};
      (dataTable!.fields ?? [])
        .filter((f) => !f.name.startsWith("_"))
        .forEach((field) => {
          const name = field.columnName ?? field.name;
          columnTableMap[name] = [dataTable!.id];
        });

      // Generate suggestions with options
      // Pass excludeEncodings so suggestCharts filters during generation
      return suggestCharts(
        insightForSuggestions,
        columnAnalysis,
        rowCount,
        fieldMap,
        {
          limit: 3,
          columnTableMap,
          seed: suggestionSeed,
          existingFields: existingFieldNames,
          excludeEncodings: existingVizSignatures,
        },
      );
    } catch (error) {
      console.error("Failed to generate suggestions:", error);
      return [];
    }
  }, [
    isPreviewReady,
    columnAnalysis,
    rowCount,
    insightId,
    insight,
    dataTable,
    fieldMap,
    suggestionSeed,
    existingFieldNames,
    existingVizSignatures,
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
      if (!dataTable?.dataFrameId) return;
      if (!isPreviewReady) return;

      // Parse encoding to determine fields and metrics for the insight
      const encoding = suggestion.encoding;
      const dimensionFields: string[] = []; // Column names to group by
      const metrics: InsightMetric[] = [];

      // Process X axis
      if (encoding.x) {
        const parsed = parseAggregateExpression(encoding.x);
        if (parsed) {
          // X is an aggregate
          const metricId = crypto.randomUUID() as UUID;
          metrics.push({
            id: metricId,
            name: encoding.x,
            sourceTable: dataTable.id,
            columnName: parsed.columnName,
            aggregation: parsed.aggregation,
          });
        } else {
          // X is a dimension field
          dimensionFields.push(encoding.x);
        }
      }

      // Process Y axis
      if (encoding.y) {
        const parsed = parseAggregateExpression(encoding.y);
        if (parsed) {
          // Y is an aggregate - add as metric
          const metricId = crypto.randomUUID() as UUID;
          metrics.push({
            id: metricId,
            name: encoding.y,
            sourceTable: dataTable.id,
            columnName: parsed.columnName,
            aggregation: parsed.aggregation,
          });
        } else {
          // Y is a dimension
          dimensionFields.push(encoding.y);
        }
      }

      // Process color
      if (encoding.color) {
        const parsed = parseAggregateExpression(encoding.color);
        if (!parsed) {
          dimensionFields.push(encoding.color);
        }
      }

      // Map dimension column names to field IDs
      const fieldIdMap = new Map<string, UUID>();
      (dataTable.fields ?? []).forEach((f) => {
        fieldIdMap.set(f.columnName ?? f.name, f.id);
      });

      // Convert dimension column names to field IDs
      const newSelectedFieldIds = dimensionFields
        .map((colName) => fieldIdMap.get(colName))
        .filter((id): id is UUID => id !== undefined);

      // Merge with existing insight fields/metrics (don't overwrite if already present)
      // This preserves fields/metrics used by other visualizations
      const existingFieldIds = insight.selectedFields ?? [];
      const mergedFieldIds = [
        ...existingFieldIds,
        ...newSelectedFieldIds.filter((id) => !existingFieldIds.includes(id)),
      ];

      // Merge metrics - check by columnName + aggregation combo to avoid duplicates
      const existingMetrics = insight.metrics ?? [];
      const mergedMetrics = [...existingMetrics];
      for (const newMetric of metrics) {
        const isDuplicate = existingMetrics.some(
          (m) =>
            m.columnName === newMetric.columnName &&
            m.aggregation === newMetric.aggregation,
        );
        if (!isDuplicate) {
          mergedMetrics.push(newMetric);
        }
      }

      // Update insight with merged fields and metrics
      updateInsight(insightId, {
        selectedFields: mergedFieldIds,
        metrics: mergedMetrics,
      });

      // Create visualization using encoding-driven rendering
      const vizId = await createVisualizationLocal(
        suggestion.title,
        insightId,
        suggestion.chartType,
        {} as VegaLiteSpec, // Deprecated: rendering now uses encoding
        suggestion.encoding,
      );

      // Navigate to the visualization
      router.push(`/visualizations/${vizId}`);
    },
    [
      dataTable,
      isPreviewReady,
      parseAggregateExpression,
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
        {/* Data Model - combines data sources + preview */}
        <DataModelSection
          insight={insight}
          dataTable={dataTable}
          allDataTables={allDataTables}
          combinedFieldCount={combinedFieldCount}
        />

        {/* Visualizations - Only show if there are visualizations */}
        {insightVisualizations.length > 0 && (
          <VisualizationsSection
            visualizations={insightVisualizations}
            insightId={insightId}
          />
        )}

        {/* Suggested Charts - Shows below visualizations, filters out existing chart types */}
        {dataTable.dataFrameId && suggestions.length > 0 && (
          <SuggestedChartsSection
            tableName={`df_${dataTable.dataFrameId.replace(/-/g, "_")}`}
            suggestions={suggestions}
            isLoading={
              !isPreviewReady ||
              (isPreviewReady && columnAnalysis.length === 0 && rowCount > 0)
            }
            onCreateChart={handleCreateChart}
            onRegenerate={handleRegenerate}
            hasExistingVisualizations={insightVisualizations.length > 0}
          />
        )}
      </div>
    </AppLayout>
  );
}
