"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { useInsightsStore } from "@/lib/stores/insights-store";
import { useDataSourcesStore } from "@/lib/stores/data-sources-store";
import { useDataFramesStore } from "@/lib/stores/dataframes-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Simple arrow left icon
const ArrowLeft = ({ className }: { className?: string }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>
  </svg>
);
import { useState, useEffect, useMemo } from "react";
import { computeInsightPreview, computeInsightDataFrame } from "@/lib/insights/compute-preview";
import type { PreviewResult } from "@/lib/insights/compute-preview";
import { suggestCharts } from "@/lib/visualizations/suggest-charts";
import type { ChartSuggestion } from "@/lib/visualizations/suggest-charts";
import { SuggestedInsights } from "@/components/visualization-preview/SuggestedInsights";
import { useVisualizationsStore } from "@/lib/stores/visualizations-store";
import type { Field } from "@dashframe/dataframe";

// Utility to format dates consistently
function formatDate(value: unknown): string | null {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!isNaN(parsed)) {
      const date = new Date(parsed);
      return date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    }
  }
  return null;
}

// Format cell value for display
function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  const dateStr = formatDate(value);
  if (dateStr) return dateStr;
  if (typeof value === "number") return value.toLocaleString();
  return String(value);
}

interface PageProps {
  params: Promise<{ insightId: string }>;
}

export default function CreateVisualizationPage({ params }: PageProps) {
  const { insightId } = use(params);
  const router = useRouter();

  const getInsight = useInsightsStore((state) => state.getInsight);
  const updateInsight = useInsightsStore((state) => state.updateInsight);
  const setInsightDataFrame = useInsightsStore((state) => state.setInsightDataFrame);
  const getAllDataSources = useDataSourcesStore((state) => state.getAll);
  const getDataFrame = useDataFramesStore((state) => state.get);
  const createDataFrameFromInsight = useDataFramesStore(
    (state) => state.createFromInsight
  );
  const createVisualization = useVisualizationsStore((state) => state.create);
  const setActiveVisualization = useVisualizationsStore((state) => state.setActive);

  const [insight, setInsight] = useState(() => getInsight(insightId));
  const [insightName, setInsightName] = useState(insight?.name || "");

  // Hydration
  useEffect(() => {
    const hydrated = getInsight(insightId);
    setInsight(hydrated);
    setInsightName(hydrated?.name || "");
  }, [insightId, getInsight]);

  if (!insight) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold">Insight not found</h2>
          <p className="text-sm text-muted-foreground mt-2">
            The insight you're looking for doesn't exist.
          </p>
          <Button onClick={() => router.push("/")} className="mt-4">
            Go back
          </Button>
        </div>
      </div>
    );
  }

  // Get data table info
  const dataSources = getAllDataSources();
  let dataTable: any = null;
  let sourceDataSource: any = null;
  for (const source of dataSources) {
    const table = source.dataTables.get(insight.baseTable.tableId);
    if (table) {
      dataTable = table;
      sourceDataSource = source;
      break;
    }
  }

  if (!dataTable) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold">Data table not found</h2>
          <p className="text-sm text-muted-foreground mt-2">
            The data table for this insight no longer exists.
          </p>
          <Button onClick={() => router.push("/")} className="mt-4">
            Go back
          </Button>
        </div>
      </div>
    );
  }

  const handleNameChange = (newName: string) => {
    setInsightName(newName);
    updateInsight(insightId, { name: newName });
  };

  const selectedFields = dataTable.fields.filter((f: any) =>
    insight.baseTable.selectedFields.includes(f.id) && !f.name.startsWith("_")
  );

  // Also filter out internal columns from metrics display
  const visibleMetrics = insight.metrics.filter((m) => !m.name.startsWith("_"));

  // Compute preview data
  const preview = useMemo<PreviewResult | null>(() => {
    if (!dataTable.dataFrameId) {
      return null; // No data available yet
    }

    const sourceDataFrameEnhanced = getDataFrame(dataTable.dataFrameId);
    if (!sourceDataFrameEnhanced) {
      return null;
    }

    try {
      return computeInsightPreview(
        insight,
        dataTable,
        sourceDataFrameEnhanced.data
      );
    } catch (error) {
      console.error("Failed to compute preview:", error);
      return null;
    }
  }, [insight, dataTable, getDataFrame]);

  const rowCount = preview?.rowCount ?? 0;
  const sampleSize = preview?.sampleSize ?? 0;
  const columnCount = selectedFields.length + visibleMetrics.length;
  const dataSourceTypeLabel = (() => {
    if (!sourceDataSource?.type) return "unknown source";
    switch (sourceDataSource.type) {
      case "notion":
        return "notion database";
      case "local":
        return "uploaded csv";
      case "postgresql":
        return "postgresql source";
      default:
        return sourceDataSource.type;
    }
  })();

  // Build field map for analysis
  const fieldMap = useMemo<Record<string, Field>>(() => {
    const map: Record<string, Field> = {};
    selectedFields.forEach((f: Field) => {
      map[f.name] = f;
    });
    return map;
  }, [selectedFields]);

  // Generate chart suggestions
  const suggestions = useMemo<ChartSuggestion[]>(() => {
    if (!preview) return [];

    try {
      const previewEnhanced = {
        metadata: {
          id: "preview",
          name: insight.name,
          source: { insightId },
          timestamp: Date.now(),
          rowCount: preview.rowCount,
          columnCount: preview.dataFrame.fieldIds.length,
        },
        data: preview.dataFrame,
      };

      return suggestCharts(insight, previewEnhanced, fieldMap, 3);
    } catch (error) {
      console.error("Failed to generate suggestions:", error);
      return [];
    }
  }, [preview, insight, insightId, fieldMap]);

  // Handle creating a chart from suggestion
  const handleCreateChart = async (suggestion: ChartSuggestion) => {
    if (!dataTable.dataFrameId) return;

    const sourceDataFrameEnhanced = getDataFrame(dataTable.dataFrameId);
    if (!sourceDataFrameEnhanced) return;

    // Compute full DataFrame
    const fullDataFrame = computeInsightDataFrame(
      insight,
      dataTable,
      sourceDataFrameEnhanced.data
    );

    // Create or update cached DataFrame
    let dataFrameId = insight.dataFrameId;
    if (!dataFrameId) {
      dataFrameId = createDataFrameFromInsight(insightId, insight.name, fullDataFrame);
      setInsightDataFrame(insightId, dataFrameId);
    }

    // Create visualization
    const vizId = createVisualization(
      { dataFrameId, insightId },
      suggestion.title,
      suggestion.spec,
      suggestion.chartType,
      suggestion.encoding
    );

    // Navigate to workbench
    setActiveVisualization(vizId);
    router.push("/");
  };

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Sticky Header */}
    <div className="sticky top-0 z-10 border-b bg-card/90 backdrop-blur-sm">
      <div className="container mx-auto px-6 py-5">
        <div className="flex flex-wrap items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/")}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
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
        </div>
        {/* Quick Stats */}
        <p className="text-xs text-muted-foreground mt-3">
          {dataTable.name} • {rowCount} rows
          {sampleSize > 0 && sampleSize < rowCount && ` (showing ${sampleSize})`} •{" "}
          {columnCount} fields • {visibleMetrics.length} metrics
        </p>
      </div>
    </div>

      {/* Scrollable Main Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="container mx-auto px-6 py-6 max-w-6xl">
          {/* Data Preview - Scrollable with themed background */}
          <div className="bg-card rounded-lg border p-4 mb-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h3 className="text-sm font-semibold text-muted-foreground">
                Data preview
              </h3>
              <span className="text-xs text-muted-foreground">
                {dataSourceTypeLabel}
              </span>
            </div>
            {preview ? (
              <div className="relative rounded border bg-muted/30" style={{ maxHeight: "240px", overflow: "auto" }}>
                <table className="w-full text-sm border-separate border-spacing-0">
                  <thead className="sticky top-0 z-10 bg-card">
                    <tr>
                      {selectedFields.map((field: any) => (
                        <th
                          key={field.id}
                          className="px-3 py-2 text-left font-medium text-xs border-b bg-card"
                        >
                          {field.name}
                        </th>
                      ))}
                      {visibleMetrics.map((metric) => (
                        <th
                          key={metric.id}
                          className="px-3 py-2 text-left font-medium text-xs text-primary border-b bg-card"
                        >
                          {metric.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.dataFrame.rows.map((row, idx) => (
                      <tr key={idx} className="border-b last:border-0">
                        {selectedFields.map((field: any) => (
                          <td key={field.id} className="px-3 py-2 text-xs whitespace-nowrap">
                            {formatCellValue((row as Record<string, unknown>)[field.name])}
                          </td>
                        ))}
                        {visibleMetrics.map((metric) => {
                          const value = (row as Record<string, unknown>)[metric.name];
                          return (
                            <td key={metric.id} className="px-3 py-2 text-xs text-primary whitespace-nowrap">
                              {formatCellValue(value)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No data available. The data source may not have been loaded yet.
              </p>
            )}
          </div>

          {/* Suggested Insights */}
          <SuggestedInsights
            suggestions={suggestions}
            onCreateChart={handleCreateChart}
          />
        </div>
      </div>

      {/* Sticky Bottom Actions */}
      <div className="sticky bottom-0 border-t bg-card/90 backdrop-blur-sm shadow-sm px-6 py-4">
        <div className="container mx-auto max-w-6xl flex justify-end">
          <Button variant="outline" size="sm">
            Create custom visualization
          </Button>
        </div>
      </div>
    </div>
  );
}
