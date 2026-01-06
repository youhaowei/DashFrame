"use client";

import { useDataFrameData } from "@/hooks/useDataFrameData";
import type { PreviewResult } from "@/lib/insights/compute-preview";
import { computeInsightPreview } from "@/lib/insights/compute-preview";
import {
  useDataSources,
  useDataTables,
  useInsightMutations,
  useInsights,
  useVisualizations,
} from "@dashframe/core";
import type {
  DataSource,
  DataTable,
  Field,
  Insight,
  Metric,
} from "@dashframe/types";
import { useMemo } from "react";

/**
 * Data table info derived from insight's baseTableId
 */
export interface DataTableInfo {
  dataSource: DataSource | null;
  dataTable: DataTable;
  fields: Field[];
  metrics: Metric[];
}

/**
 * Joined table info derived from insight.joins
 */
export interface JoinedTableInfo {
  joinIndex: number;
  dataTable: DataTable;
  dataSource: DataSource | null;
  fields: Field[];
}

/**
 * Return type for useInsightPageData hook
 */
export interface InsightPageData {
  // Loading states
  isLoading: boolean;

  // Core entities
  insight: Insight | undefined;
  dataTableInfo: DataTableInfo | null;
  visualizations: ReturnType<typeof useVisualizations>["data"];

  // Joined tables (resolved from insight.joins)
  joinedTables: JoinedTableInfo[];

  // All data tables (for components that need to look up tables)
  allDataTables: DataTable[];

  // Derived data
  isConfigured: boolean;
  selectedFields: Field[];
  aggregatedPreview: PreviewResult | null;

  // Mutations
  updateInsight: ReturnType<typeof useInsightMutations>["update"];
}

/**
 * Custom hook that encapsulates all data fetching and computation
 * for the insight page.
 *
 * Separates data concerns from rendering, following the pattern
 * used by the home page's clean architecture.
 */
export function useInsightPageData(insightId: string): InsightPageData {
  // Get data from Dexie with reactive hooks
  const { data: insights, isLoading: isInsightsLoading } = useInsights();
  const { update: updateInsight } = useInsightMutations();
  const { data: dataSources, isLoading: isSourcesLoading } = useDataSources();
  const { data: allDataTables = [], isLoading: isTablesLoading } =
    useDataTables();
  const { data: visualizations = [], isLoading: isVizLoading } =
    useVisualizations(insightId);

  // Find the insight from the list
  const insight = useMemo(
    () => insights?.find((i) => i.id === insightId),
    [insights, insightId],
  );

  // Find data source and table using flat schema (baseTableId directly on insight)
  const dataTableInfo = useMemo<DataTableInfo | null>(() => {
    if (!insight?.baseTableId) return null;

    const dataTable = allDataTables.find((t) => t.id === insight.baseTableId);
    if (!dataTable) return null;

    const dataSource = dataSources?.find(
      (s) => s.id === dataTable.dataSourceId,
    );

    return {
      dataSource: dataSource ?? null,
      dataTable,
      fields: dataTable.fields ?? [],
      metrics: dataTable.metrics ?? [],
    };
  }, [insight?.baseTableId, allDataTables, dataSources]);

  // Resolve joined tables from insight.joins
  const joinedTables = useMemo<JoinedTableInfo[]>(() => {
    if (!insight?.joins?.length) return [];

    return insight.joins
      .map((join, joinIndex) => {
        const dataTable = allDataTables.find((t) => t.id === join.rightTableId);
        if (!dataTable) return null;

        const dataSource = dataSources?.find(
          (s) => s.id === dataTable.dataSourceId,
        );

        return {
          joinIndex,
          dataTable,
          dataSource: dataSource ?? null,
          fields: dataTable.fields ?? [],
        };
      })
      .filter((t): t is JoinedTableInfo => t !== null);
  }, [insight?.joins, allDataTables, dataSources]);

  // Determine if insight is configured (has selected fields)
  const isConfigured = useMemo(() => {
    if (!insight) return false;
    return (insight.selectedFields?.length ?? 0) > 0;
  }, [insight]);

  // Load source data for preview computation (async from IndexedDB)
  // Use Infinity to load all rows - insight aggregations need complete data
  const { data: sourceData } = useDataFrameData(
    dataTableInfo?.dataTable?.dataFrameId,
    { limit: Infinity },
  );

  // Compute selected fields for preview
  const selectedFields = useMemo(() => {
    if (!dataTableInfo) return [];
    return dataTableInfo.fields.filter(
      (f) => insight?.selectedFields?.includes(f.id) && !f.name.startsWith("_"),
    );
  }, [dataTableInfo, insight?.selectedFields]);

  // Compute aggregated preview for configured insights
  const aggregatedPreview = useMemo<PreviewResult | null>(() => {
    if (!isConfigured || !insight || !dataTableInfo || !sourceData) return null;
    const { dataTable, fields } = dataTableInfo;
    if (!dataTable?.dataFrameId) return null;

    try {
      // Build insight object for computation
      const insightForCompute: Insight = {
        id: insightId,
        name: insight.name,
        baseTableId: dataTable.id,
        selectedFields: insight.selectedFields ?? [],
        metrics: (insight.metrics ?? []).map((m) => ({
          id: m.id,
          name: m.name,
          sourceTable: m.sourceTable,
          columnName: m.columnName,
          aggregation: m.aggregation,
        })),
        filters: insight.filters,
        createdAt: insight.createdAt,
        updatedAt: insight.updatedAt,
      };

      const dataTableForCompute: DataTable = {
        id: dataTable.id,
        name: dataTable.name,
        table: dataTable.table,
        dataSourceId: dataTable.dataSourceId,
        dataFrameId: dataTable.dataFrameId,
        fields: fields.map((f: Field) => ({
          id: f.id,
          name: f.name,
          tableId: f.tableId,
          columnName: f.columnName,
          type: f.type,
        })),
        metrics: dataTable.metrics ?? [],
        createdAt: dataTable.createdAt,
      };

      const sourceDataFrame = {
        columns: sourceData.columns,
        rows: sourceData.rows,
      };

      return computeInsightPreview(
        insightForCompute,
        dataTableForCompute,
        sourceDataFrame,
        Infinity,
      );
    } catch (error) {
      console.error("Failed to compute preview:", error);
      return null;
    }
  }, [isConfigured, insight, insightId, dataTableInfo, sourceData]);

  // Combined loading state - only block on store hydration
  const isLoading =
    isInsightsLoading || isSourcesLoading || isTablesLoading || isVizLoading;

  return {
    isLoading,
    insight,
    dataTableInfo,
    visualizations,
    joinedTables,
    allDataTables,
    isConfigured,
    selectedFields,
    aggregatedPreview,
    updateInsight,
  };
}
