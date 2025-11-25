"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "@dashframe/convex";
import type { Id, Doc } from "@dashframe/convex/dataModel";
import { useDataFramesStore } from "@/lib/stores/dataframes-store";
import { Button, Card, CardContent, CardHeader, Checkbox } from "@dashframe/ui";
import { LuPlus } from "react-icons/lu";
import {
  computeInsightPreview,
  computeInsightDataFrame,
} from "@/lib/insights/compute-preview";
import type { PreviewResult } from "@/lib/insights/compute-preview";
import { suggestCharts } from "@/lib/visualizations/suggest-charts";
import type { ChartSuggestion } from "@/lib/visualizations/suggest-charts";
import { SuggestedInsights } from "@/components/visualization-preview/SuggestedInsights";
import { JoinFlowModal } from "@/components/visualizations/JoinFlowModal";

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

interface InsightConfigureTabProps {
  insightId: Id<"insights">;
  insight: Doc<"insights">;
  dataTable: Doc<"dataTables">;
  fields: Doc<"fields">[];
  tableMetrics: Doc<"metrics">[];
  insightMetrics: Doc<"insightMetrics">[];
  dataSource: Doc<"dataSources"> | null;
  isConfigured: boolean;
}

/**
 * Configure Tab Content
 *
 * Shows different content based on configuration state:
 * - Unconfigured: Data preview + chart suggestions (like current create-visualization)
 * - Configured: Field/metric/filter/join editor
 */
export function InsightConfigureTab({
  insightId,
  insight,
  dataTable,
  fields,
  tableMetrics,
  insightMetrics,
  dataSource,
  isConfigured,
}: InsightConfigureTabProps) {
  const router = useRouter();

  // Convex mutations
  const updateInsight = useMutation(api.insights.update);
  const createVisualization = useMutation(api.visualizations.create);
  const addInsightMetric = useMutation(api.insights.addMetric);

  // DataFrame store (stays local)
  const getDataFrame = useDataFramesStore((state) => state.get);
  const createDataFrameFromInsight = useDataFramesStore(
    (state) => state.createFromInsight
  );

  // Local state
  const [isJoinFlowOpen, setIsJoinFlowOpen] = useState(false);

  // All visible fields from the table (for unconfigured preview)
  const allTableFields = useMemo(() => {
    return fields.filter((f) => !f.name.startsWith("_"));
  }, [fields]);

  // Compute selected fields (for configured state)
  const selectedFields = useMemo(() => {
    return fields.filter(
      (f) =>
        insight.selectedFieldIds.includes(f._id) && !f.name.startsWith("_")
    );
  }, [fields, insight.selectedFieldIds]);

  // Fields to display in preview - all fields when unconfigured, selected fields when configured
  const previewFields = isConfigured ? selectedFields : allTableFields;

  // Compute visible metrics
  const visibleMetrics = useMemo(() => {
    return insightMetrics.filter((m) => !m.name.startsWith("_"));
  }, [insightMetrics]);

  // Raw preview for unconfigured state (shows source data directly)
  const rawPreview = useMemo(() => {
    if (isConfigured) return null;
    if (!dataTable?.dataFrameId) return null;

    const sourceFrame = getDataFrame(dataTable.dataFrameId);
    if (!sourceFrame) return null;

    // Return first 50 rows of raw data
    return {
      dataFrame: {
        ...sourceFrame.data,
        rows: sourceFrame.data.rows.slice(0, 50),
      },
      rowCount: sourceFrame.data.rows.length,
      sampleSize: Math.min(50, sourceFrame.data.rows.length),
    };
  }, [isConfigured, dataTable, getDataFrame]);

  // Aggregated preview for configured state
  const aggregatedPreview = useMemo<PreviewResult | null>(() => {
    if (!isConfigured) return null;
    if (!dataTable?.dataFrameId) return null;

    const sourceDataFrameEnhanced = getDataFrame(dataTable.dataFrameId);
    if (!sourceDataFrameEnhanced) return null;

    try {
      // Convert Convex types to expected format for compute function
      const insightForCompute = {
        id: insightId,
        name: insight.name,
        baseTable: {
          tableId: dataTable._id,
          selectedFields: insight.selectedFieldIds.map((id) => id.toString()),
        },
        metrics: insightMetrics.map((m) => ({
          id: m._id,
          name: m.name,
          sourceTable: m.sourceTableId,
          columnName: m.columnName,
          aggregation: m.aggregation,
        })),
        filters: insight.filters,
        createdAt: insight.createdAt,
        updatedAt: insight.updatedAt,
      };

      const dataTableForCompute = {
        id: dataTable._id,
        name: dataTable.name,
        table: dataTable.table,
        dataFrameId: dataTable.dataFrameId,
        fields: fields.map((f) => ({
          id: f._id,
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
  }, [isConfigured, insight, insightId, dataTable, fields, insightMetrics, getDataFrame]);

  // Use appropriate preview based on state
  const preview = isConfigured ? aggregatedPreview : rawPreview;

  const rowCount = preview?.rowCount ?? 0;
  const sampleSize = preview?.sampleSize ?? 0;
  const columnCount = previewFields.length + visibleMetrics.length;

  // Build field map from ALL table fields (for chart suggestions)
  const fieldMap = useMemo<Record<string, { id: string; name: string; type: string }>>(() => {
    const map: Record<string, { id: string; name: string; type: string }> = {};
    allTableFields.forEach((f) => {
      map[f.name] = { id: f._id, name: f.name, type: f.type };
    });
    return map;
  }, [allTableFields]);

  // Generate chart suggestions (only for unconfigured state)
  const suggestions = useMemo<ChartSuggestion[]>(() => {
    if (isConfigured || !rawPreview) return [];

    const sourceFrame = getDataFrame(dataTable?.dataFrameId ?? "");
    if (!sourceFrame) return [];

    try {
      const previewEnhanced = {
        metadata: {
          id: "preview",
          name: insight.name,
          source: { insightId: insightId.toString() },
          timestamp: Date.now(),
          rowCount: sourceFrame.metadata.rowCount,
          columnCount: sourceFrame.metadata.columnCount,
        },
        data: rawPreview.dataFrame,
      };

      // Create a minimal insight object for suggestions
      const insightForSuggestions = {
        id: insightId,
        name: insight.name,
        baseTable: {
          tableId: dataTable._id,
          selectedFields: [] as string[],
        },
        metrics: [] as any[],
        createdAt: insight.createdAt,
        updatedAt: insight.updatedAt,
      };

      return suggestCharts(insightForSuggestions as any, previewEnhanced, fieldMap as any, 3);
    } catch (error) {
      console.error("Failed to generate suggestions:", error);
      return [];
    }
  }, [isConfigured, rawPreview, insight, insightId, fieldMap, dataTable, getDataFrame]);

  // Get data source type label
  const dataSourceTypeLabel = useMemo(() => {
    if (!dataSource?.type) return "unknown source";
    switch (dataSource.type) {
      case "notion":
        return "Notion database";
      case "local":
        return "Uploaded CSV";
      case "postgresql":
        return "PostgreSQL source";
      default:
        return "unknown source";
    }
  }, [dataSource]);

  // Handle creating a chart from suggestion
  const handleCreateChart = async (suggestion: ChartSuggestion) => {
    if (!dataTable.dataFrameId) return;

    const sourceDataFrameEnhanced = getDataFrame(dataTable.dataFrameId);
    if (!sourceDataFrameEnhanced) return;

    // Derive metrics from suggestion encoding if needed
    let metricsToAdd: { name: string; columnName?: string; aggregation: string }[] = [];

    if (suggestion.encoding.y) {
      const yColumnName = suggestion.encoding.y;
      const metricPattern = /^(sum|avg|count|min|max|count_distinct)\((.+)\)$/i;
      const match = yColumnName.match(metricPattern);

      if (match) {
        const [, aggregation, columnName] = match;
        metricsToAdd.push({
          name: yColumnName,
          columnName: columnName,
          aggregation: aggregation.toLowerCase(),
        });
      }
    }

    // Determine fields to select based on chart encoding
    const fieldsToSelect: Id<"fields">[] = [];

    if (suggestion.encoding.x) {
      const xField = fields.find((f) => f.name === suggestion.encoding.x);
      if (xField) fieldsToSelect.push(xField._id);
    }

    if (suggestion.encoding.color) {
      const colorField = fields.find((f) => f.name === suggestion.encoding.color);
      if (colorField) fieldsToSelect.push(colorField._id);
    }

    // Update the insight with selected fields
    await updateInsight({
      id: insightId,
      selectedFieldIds: fieldsToSelect,
    });

    // Add metrics to the insight
    for (const metric of metricsToAdd) {
      await addInsightMetric({
        insightId,
        name: metric.name,
        sourceTableId: dataTable._id,
        columnName: metric.columnName,
        aggregation: metric.aggregation as any,
      });
    }

    // Create or get DataFrame ID for the visualization
    let vizDataFrameId = insight.dataFrameId;
    if (!vizDataFrameId) {
      // For now, use the source DataFrame directly
      // TODO: Compute aggregated DataFrame
      vizDataFrameId = dataTable.dataFrameId;
    }

    // Create visualization in Convex
    const vizId = await createVisualization({
      name: suggestion.title,
      dataFrameId: vizDataFrameId!,
      insightId,
      spec: suggestion.spec,
      visualizationType: suggestion.chartType as any,
      encoding: {
        x: suggestion.encoding.x,
        y: suggestion.encoding.y,
        color: suggestion.encoding.color,
      },
    });

    // Navigate to the visualization using route-based navigation
    router.push(`/visualizations/${vizId}`);
  };

  // Handle field toggle (for configured view)
  const handleFieldToggle = async (fieldId: Id<"fields">, checked: boolean) => {
    const currentFields = insight.selectedFieldIds;
    const newFields = checked
      ? [...currentFields, fieldId]
      : currentFields.filter((id) => id !== fieldId);

    await updateInsight({
      id: insightId,
      selectedFieldIds: newFields,
    });
  };

  // Handle filter toggle
  const handleExcludeNullsToggle = async (checked: boolean) => {
    await updateInsight({
      id: insightId,
      filters: {
        ...insight.filters,
        excludeNulls: checked,
      },
    });
  };

  const dataSummary = `${rowCount.toLocaleString()} rows • ${columnCount} fields • ${visibleMetrics.length} metrics`;

  // Render unconfigured state (draft insight)
  if (!isConfigured) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="container mx-auto px-6 py-6 max-w-6xl space-y-6">
          {/* Data Preview Section */}
          <section className="space-y-4 rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-muted-foreground">
                  Data preview
                </p>
                <p className="text-sm text-foreground">
                  First {sampleSize || rowCount} rows
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{dataSummary}</span>
                <span>•</span>
                <span>{dataSourceTypeLabel}</span>
              </div>
            </div>
            {preview ? (
              <div className="relative overflow-hidden rounded-xl border bg-muted/20">
                <div className="overflow-auto" style={{ maxHeight: 260 }}>
                  <table className="w-full text-sm border-separate border-spacing-0">
                    <thead className="sticky top-0 z-10 bg-card">
                      <tr>
                        {previewFields.map((field) => (
                          <th
                            key={field._id}
                            className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground"
                          >
                            {field.name}
                          </th>
                        ))}
                        {visibleMetrics.map((metric) => (
                          <th
                            key={metric._id}
                            className="px-3 py-2 text-left text-xs font-semibold text-primary"
                          >
                            {metric.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.dataFrame.rows.map((row, idx) => (
                        <tr key={idx} className="border-b last:border-0">
                          {previewFields.map((field) => (
                            <td
                              key={field._id}
                              className="px-3 py-2 text-xs whitespace-nowrap"
                            >
                              {formatCellValue(
                                (row as Record<string, unknown>)[field.columnName ?? field.name]
                              )}
                            </td>
                          ))}
                          {visibleMetrics.map((metric) => (
                            <td
                              key={metric._id}
                              className="px-3 py-2 text-xs font-medium text-primary whitespace-nowrap"
                            >
                              {formatCellValue(
                                (row as Record<string, unknown>)[metric.name]
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No data available. The data source may not have been loaded yet.
              </p>
            )}
          </section>

          {/* Suggested Charts Section */}
          <section className="space-y-4">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-xs font-semibold text-muted-foreground">
                  Action hub
                </p>
                <h3 className="text-lg font-semibold text-foreground">
                  Suggested charts
                </h3>
              </div>
              <p className="text-xs text-muted-foreground">
                Click a suggestion to create a visualization
              </p>
            </div>
            <SuggestedInsights
              suggestions={suggestions}
              onCreateChart={handleCreateChart}
            />
          </section>
        </div>

        {/* Sticky Footer Actions */}
        <div className="sticky bottom-0 border-t bg-card/90 backdrop-blur-sm px-6 py-4">
          <div className="container mx-auto max-w-6xl">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Need something custom? Build from scratch or join another
                dataset.
              </p>
              <div className="flex gap-3">
                <Button variant="outline" size="sm">
                  Create custom visualization
                </Button>
                <Button size="sm" onClick={() => setIsJoinFlowOpen(true)}>
                  Join with another dataset
                </Button>
              </div>
            </div>
          </div>
        </div>

        <JoinFlowModal
          insight={insight as any}
          dataTable={dataTable as any}
          isOpen={isJoinFlowOpen}
          onOpenChange={setIsJoinFlowOpen}
        />
      </div>
    );
  }

  // Render configured state (edit fields, metrics, filters, joins)
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="container mx-auto px-6 py-6 max-w-4xl space-y-6">
        {/* Fields (Dimensions) */}
        <Card>
          <CardHeader className="pb-3">
            <h3 className="text-sm font-semibold">Fields (Dimensions)</h3>
            <p className="text-xs text-muted-foreground">
              Select fields to group by in your visualization
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {fields
                .filter((f) => !f.name.startsWith("_"))
                .map((field) => (
                  <label
                    key={field._id}
                    className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50 cursor-pointer"
                  >
                    <Checkbox
                      checked={insight.selectedFieldIds.includes(field._id)}
                      onCheckedChange={(checked) =>
                        handleFieldToggle(field._id, checked as boolean)
                      }
                    />
                    <span className="text-sm">{field.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {field.type}
                    </span>
                  </label>
                ))}
            </div>
          </CardContent>
        </Card>

        {/* Metrics */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Metrics</h3>
                <p className="text-xs text-muted-foreground">
                  Aggregations applied to your data
                </p>
              </div>
              <Button variant="outline" size="sm">
                <LuPlus className="h-4 w-4 mr-1" />
                Add metric
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {visibleMetrics.length > 0 ? (
              <div className="space-y-2">
                {visibleMetrics.map((metric) => (
                  <div
                    key={metric._id}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/30"
                  >
                    <div>
                      <p className="text-sm font-medium">{metric.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {metric.aggregation}({metric.columnName || "count"})
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No metrics configured. Add a metric to aggregate your data.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Filters */}
        <Card>
          <CardHeader className="pb-3">
            <h3 className="text-sm font-semibold">Filters</h3>
            <p className="text-xs text-muted-foreground">
              Control which data is included
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={insight.filters?.excludeNulls ?? false}
                  onCheckedChange={(checked) =>
                    handleExcludeNullsToggle(checked as boolean)
                  }
                />
                <span className="text-sm">Exclude null values</span>
              </label>
            </div>
          </CardContent>
        </Card>

        {/* Joins - placeholder for now */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Joins</h3>
                <p className="text-xs text-muted-foreground">
                  Combine with other data sources
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsJoinFlowOpen(true)}
              >
                <LuPlus className="h-4 w-4 mr-1" />
                Add join
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              No joins configured. Add a join to combine data from multiple
              sources.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Sticky Footer */}
      <div className="sticky bottom-0 border-t bg-card/90 backdrop-blur-sm px-6 py-4">
        <div className="container mx-auto max-w-4xl">
          <div className="flex justify-end">
            <Button>Create Visualization</Button>
          </div>
        </div>
      </div>

      <JoinFlowModal
        insight={insight as any}
        dataTable={dataTable as any}
        isOpen={isJoinFlowOpen}
        onOpenChange={setIsJoinFlowOpen}
      />
    </div>
  );
}
