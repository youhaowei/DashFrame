"use client";

import { use, useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Input,
  Toggle,
} from "@dashframe/ui";
import { LuArrowLeft, LuLoader, LuSettings, LuEye } from "react-icons/lu";
import { InsightConfigureTab } from "@/components/insights/InsightConfigureTab";
import { InsightPreviewTab } from "@/components/insights/InsightPreviewTab";
import { useInsightsStore } from "@/lib/stores/insights-store";
import { useDataSourcesStore } from "@/lib/stores/data-sources-store";
import { useVisualizationsStore } from "@/lib/stores/visualizations-store";
import { useDataFramesStore } from "@/lib/stores/dataframes-store";
import { WorkbenchLayout } from "@/components/layouts/WorkbenchLayout";
import { useStoreQuery } from "@/hooks/useStoreQuery";
import { computeInsightPreview } from "@/lib/insights/compute-preview";
import type { PreviewResult } from "@/lib/insights/compute-preview";

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
      (viz: any) => viz.source.insightId === insightId,
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

  // Get DataFrame store
  const getDataFrame = useDataFramesStore((s) => s.get);

  // Compute selected fields for preview
  const selectedFields = useMemo(() => {
    if (!dataTableInfo) return [];
    return dataTableInfo.fields.filter(
      (f: any) =>
        insight?.baseTable?.selectedFields?.includes(f.id) && !f.name.startsWith("_")
    );
  }, [dataTableInfo, insight?.baseTable?.selectedFields]);

  // Compute aggregated preview for configured insights
  const aggregatedPreview = useMemo<PreviewResult | null>(() => {
    if (!isConfigured || !insight || !dataTableInfo) return null;
    const { dataTable, fields } = dataTableInfo;
    if (!dataTable?.dataFrameId) return null;

    const sourceDataFrameEnhanced = getDataFrame(dataTable.dataFrameId);
    if (!sourceDataFrameEnhanced) return null;

    try {
      const insightForCompute = {
        id: insightId,
        name: insight.name,
        baseTable: {
          tableId: dataTable.id,
          selectedFields: insight.baseTable?.selectedFields || [],
        },
        metrics: (insight.metrics || []).map((m: any) => ({
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

      const dataTableForCompute = {
        id: dataTable.id,
        name: dataTable.name,
        table: dataTable.table,
        dataFrameId: dataTable.dataFrameId,
        fields: fields.map((f: any) => ({
          id: f.id,
          name: f.name,
          columnName: f.columnName,
          type: f.type,
        })),
      };

      return computeInsightPreview(
        insightForCompute as any,
        dataTableForCompute as any,
        sourceDataFrameEnhanced.data
      );
    } catch (error) {
      console.error("Failed to compute preview:", error);
      return null;
    }
  }, [isConfigured, insight, insightId, dataTableInfo, getDataFrame]);

  // Handle name change
  const handleNameChange = (newName: string) => {
    setInsightName(newName);
    updateInsightName(insightId, { name: newName });
  };

  const isLoading = isInsightLoading || isSourcesLoading || isVizLoading;

  // Loading state during SSR/hydration
  // Wait for ALL stores to hydrate before rendering to avoid race conditions
  // where insight loads faster than data sources
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <LuLoader className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading insight...</p>
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
          <p className="text-sm text-muted-foreground mt-2">
            The insight you're looking for doesn't exist.
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
          <p className="text-sm text-muted-foreground mt-2">
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
              <LuArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <div className="flex-1 min-w-[220px]">
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
                  icon: <LuSettings />,
                  label: "Configure",
                },
                {
                  value: "preview",
                  icon: <LuEye />,
                  label: "Preview",
                  badge: visualizations.length > 0 ? visualizations.length : undefined,
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
      <div className="flex-1 flex flex-col overflow-hidden">
        {activeTab === "configure" && (
          <div className="flex-1 overflow-y-auto">
            <InsightConfigureTab
              insightId={insightId as any}
              insight={insight as any}
              dataTable={dataTable as any}
              fields={fields as any}
              tableMetrics={metrics as any}
              insightMetrics={insight.metrics as any}
              dataSource={dataSource as any}
              isConfigured={isConfigured}
            />
          </div>
        )}

        {activeTab === "preview" && (
          <div className="flex-1 overflow-y-auto">
            <InsightPreviewTab
              insightId={insightId as any}
              insight={insight as any}
              visualizations={visualizations as any}
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
