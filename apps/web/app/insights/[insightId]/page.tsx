"use client";

import { use, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Toggle } from "@dashframe/ui";
import { ArrowLeft, Loader2, Settings, Eye } from "@dashframe/ui/icons";
import { InsightConfigureTab } from "@/components/insights/InsightConfigureTab";
import { InsightPreviewTab } from "@/components/insights/InsightPreviewTab";
import {
  useInsights,
  useInsightMutations,
  useDataSources,
  useDataTables,
  useVisualizations,
} from "@dashframe/core-dexie";
import { useDataFrameData } from "@/hooks/useDataFrameData";
import { WorkbenchLayout } from "@/components/layouts/WorkbenchLayout";
import { computeInsightPreview } from "@/lib/insights/compute-preview";
import type { PreviewResult } from "@/lib/insights/compute-preview";
import type { Field, Insight, DataTable } from "@dashframe/core";

interface PageProps {
  params: Promise<{ insightId: string }>;
}

/**
 * Adaptive Insight Page (Local-only, Dexie-backed)
 *
 * This page adapts based on the insight's configuration state:
 * - Unconfigured (draft): Shows data preview + chart suggestions + join action
 * - Configured: Shows insight configuration editor + preview tab with visualizations
 */
export default function InsightPage({ params }: PageProps) {
  const { insightId } = use(params);
  const router = useRouter();

  // Get data from Dexie with reactive hooks
  const { data: insights, isLoading: isInsightsLoading } = useInsights();
  const { update: updateInsight } = useInsightMutations();
  const { data: dataSources, isLoading: isSourcesLoading } = useDataSources();
  const { data: allDataTables, isLoading: isTablesLoading } = useDataTables();
  // Filter visualizations by insight ID using the hook's built-in filter
  const { data: visualizations = [], isLoading: isVizLoading } =
    useVisualizations(insightId);

  // Find the insight from the list
  const insight = useMemo(
    () => insights?.find((i) => i.id === insightId),
    [insights, insightId],
  );

  // Local state for UI
  const [activeTab, setActiveTab] = useState("configure");
  // Use insight name directly - mutations update the database which triggers re-render
  const insightName = insight?.name ?? "";

  // Find data source and table using flat schema (baseTableId directly on insight)
  const dataTableInfo = useMemo(() => {
    if (!insight?.baseTableId) return null;

    // Find the data table directly
    const dataTable = allDataTables?.find((t) => t.id === insight.baseTableId);
    if (!dataTable) return null;

    // Find the data source for this table
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

  // Determine if insight is configured (using flat schema - selectedFields directly on insight)
  const isConfigured = useMemo(() => {
    if (!insight) return false;
    return (insight.selectedFields?.length ?? 0) > 0;
  }, [insight]);

  // Load source data for preview computation (async from IndexedDB)
  // Use Infinity to load all rows - insight aggregations need complete data for accurate results
  const { data: sourceData } = useDataFrameData(
    dataTableInfo?.dataTable?.dataFrameId,
    { limit: Infinity },
  );

  // Compute selected fields for preview (using flat schema)
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
      // Build insight object for computation - use flat schema properties
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

      // Use source data directly (DataFrameData format)
      const sourceDataFrame = {
        columns: sourceData.columns,
        rows: sourceData.rows,
      };

      // Use Infinity for maxRows to compute all aggregated groups
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

  // Handle name change - directly update database, which triggers re-render via hook
  const handleNameChange = (newName: string) => {
    updateInsight(insightId, { name: newName });
  };

  // Only block on store hydration, not on heavy data loading
  const isHydrating =
    isInsightsLoading || isSourcesLoading || isTablesLoading || isVizLoading;

  // Loading state during hydration
  if (isHydrating) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
          <p className="text-muted-foreground text-sm">Loading insight...</p>
        </div>
      </div>
    );
  }

  // Insight not found
  if (!insight) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold">Insight not found</h2>
          <p className="text-muted-foreground mt-2 text-sm">
            The insight you&apos;re looking for doesn&apos;t exist.
          </p>
          <Button onClick={() => router.push("/insights")} className="mt-4">
            Go to Insights
          </Button>
        </div>
      </div>
    );
  }

  // Data table not found
  if (!dataTableInfo) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold">Data table not found</h2>
          <p className="text-muted-foreground mt-2 text-sm">
            The data table for this insight no longer exists.
          </p>
          <Button onClick={() => router.push("/insights")} className="mt-4">
            Go to Insights
          </Button>
        </div>
      </div>
    );
  }

  const { dataSource, dataTable, fields, metrics } = dataTableInfo;

  return (
    <WorkbenchLayout
      header={
        <div className="container mx-auto px-6 py-4">
          <div className="flex flex-wrap items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push("/insights")}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <div className="min-w-[220px] flex-1">
              <Input
                value={insightName}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="Insight name"
                className="w-full"
              />
            </div>
            <Toggle
              value={activeTab}
              onValueChange={setActiveTab}
              options={[
                {
                  value: "configure",
                  icon: <Settings />,
                  label: "Configure",
                },
                {
                  value: "preview",
                  icon: <Eye />,
                  label: "Preview",
                  badge:
                    visualizations.length > 0
                      ? visualizations.length
                      : undefined,
                  disabled: !isConfigured && visualizations.length === 0,
                },
              ]}
            />
          </div>
        </div>
      }
      childrenClassName="overflow-hidden flex flex-col"
    >
      {/* Tab Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {activeTab === "configure" && (
          <div className="flex-1 overflow-y-auto">
            <InsightConfigureTab
              insightId={insightId}
              insight={insight}
              dataTable={dataTable}
              fields={fields}
              tableMetrics={metrics}
              insightMetrics={insight.metrics ?? []}
              dataSource={dataSource}
              isConfigured={isConfigured}
            />
          </div>
        )}

        {activeTab === "preview" && (
          <div className="flex-1 overflow-y-auto">
            <InsightPreviewTab
              insightId={insightId}
              insight={insight}
              visualizations={visualizations}
              aggregatedPreview={aggregatedPreview}
              selectedFields={selectedFields}
              metrics={insight.metrics ?? []}
            />
          </div>
        )}
      </div>
    </WorkbenchLayout>
  );
}
