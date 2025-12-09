"use client";

import { use, useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Toggle } from "@dashframe/ui";
import { ArrowLeft, Loader2, Settings, Eye } from "@dashframe/ui/icons";
import { InsightConfigureTab } from "@/components/insights/InsightConfigureTab";
import { InsightPreviewTab } from "@/components/insights/InsightPreviewTab";
import { useInsightsStore } from "@/lib/stores/insights-store";
import { useDataSourcesStore } from "@/lib/stores/data-sources-store";
import { useVisualizationsStore } from "@/lib/stores/visualizations-store";
import { useDataFrameData } from "@/hooks/useDataFrameData";
import { WorkbenchLayout } from "@/components/layouts/WorkbenchLayout";
import { useStoreQuery } from "@/hooks/useStoreQuery";
import { computeInsightPreview } from "@/lib/insights/compute-preview";
import type { PreviewResult } from "@/lib/insights/compute-preview";
import type { UUID } from "@dashframe/dataframe";
import type {
  Visualization,
  InsightMetric,
  Insight,
  DataTable,
} from "@/lib/stores/types";
import type { Field } from "@dashframe/dataframe";

interface PageProps {
  params: Promise<{ insightId: string }>;
}

/**
 * Adaptive Insight Page (Local-only)
 *
 * This page adapts based on the insight's configuration state:
 * - Unconfigured (draft): Shows data preview + chart suggestions + join action
 * - Configured: Shows insight configuration editor + preview tab with visualizations
 */
export default function InsightPage({ params }: PageProps) {
  const { insightId } = use(params);
  const router = useRouter();

  // Get data from local stores with hydration-aware hook
  const { data: insight, isLoading: isInsightLoading } = useStoreQuery(
    useInsightsStore,
    (s) => s.getInsight(insightId),
  );
  const updateInsightName = useInsightsStore((s) => s.updateInsight);
  const { data: dataSources, isLoading: isSourcesLoading } = useStoreQuery(
    useDataSourcesStore,
    (s) => s.getAll(),
  );
  const { data: allVisualizations, isLoading: isVizLoading } = useStoreQuery(
    useVisualizationsStore,
    (s) => s.getAll(),
  );

  // Filter visualizations to only those using this insight
  const visualizations = useMemo(() => {
    return allVisualizations.filter(
      (viz: Visualization) => viz.source.insightId === insightId,
    );
  }, [allVisualizations, insightId]);

  // Local state
  const [insightName, setInsightName] = useState("");
  const [activeTab, setActiveTab] = useState("configure");

  // Sync insight name when data loads
  useEffect(() => {
    if (insight?.name) {
      setInsightName(insight.name);
    }
  }, [insight?.name]);

  // Find data source and table
  const dataTableInfo = useMemo(() => {
    if (!insight) return null;

    const tableId = insight.baseTable?.tableId;
    if (!tableId) return null;

    // Find the table in all data sources
    for (const source of dataSources) {
      const table = source.dataTables.get(tableId);
      if (table) {
        return {
          dataSource: source,
          dataTable: table,
          fields: table.fields,
          metrics: table.metrics,
        };
      }
    }

    return null;
  }, [insight, dataSources]);

  // Determine if insight is configured
  const isConfigured = useMemo(() => {
    if (!insight) return false;
    return (insight.baseTable?.selectedFields?.length ?? 0) > 0;
  }, [insight]);

  // Load source data for preview computation (async from IndexedDB)
  // Use Infinity to load all rows - insight aggregations need complete data for accurate results
  // Note: This is loaded progressively - don't block the UI on this
  const { data: sourceData } = useDataFrameData(
    dataTableInfo?.dataTable?.dataFrameId,
    { limit: Infinity },
  );

  // Compute selected fields for preview
  const selectedFields = useMemo(() => {
    if (!dataTableInfo) return [];
    return dataTableInfo.fields.filter(
      (f) =>
        insight?.baseTable?.selectedFields?.includes(f.id) &&
        !f.name.startsWith("_"),
    );
  }, [dataTableInfo, insight?.baseTable?.selectedFields]);

  // Compute aggregated preview for configured insights
  const aggregatedPreview = useMemo<PreviewResult | null>(() => {
    if (!isConfigured || !insight || !dataTableInfo || !sourceData) return null;
    const { dataTable, fields } = dataTableInfo;
    if (!dataTable?.dataFrameId) return null;

    try {
      const insightForCompute = {
        id: insightId,
        name: insight.name,
        baseTable: {
          tableId: dataTable.id,
          selectedFields: insight.baseTable?.selectedFields || [],
        },
        metrics: (insight.metrics || []).map((m: InsightMetric) => ({
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
        metrics: dataTable.metrics || [],
        createdAt: dataTable.createdAt,
      };

      // Convert LoadedDataFrameData to DataFrameData format (add empty fieldIds)
      const sourceDataFrame = {
        fieldIds: [] as UUID[],
        columns: sourceData.columns,
        rows: sourceData.rows,
      };

      // Use Infinity for maxRows to compute all aggregated groups
      return computeInsightPreview(
        insightForCompute as Insight,
        dataTableForCompute,
        sourceDataFrame,
        Infinity,
      );
    } catch (error) {
      console.error("Failed to compute preview:", error);
      return null;
    }
  }, [isConfigured, insight, insightId, dataTableInfo, sourceData]);

  // Handle name change
  const handleNameChange = (newName: string) => {
    setInsightName(newName);
    updateInsightName(insightId, { name: newName });
  };

  // Only block on store hydration, not on heavy data loading
  // This enables progressive loading - UI shows immediately, data streams in
  const isHydrating = isInsightLoading || isSourcesLoading || isVizLoading;

  // Loading state during SSR/hydration
  // Wait for stores to hydrate, but NOT for source data (loaded progressively)
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
              insightMetrics={insight.metrics || []}
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
              metrics={insight.metrics || []}
            />
          </div>
        )}
      </div>
    </WorkbenchLayout>
  );
}
