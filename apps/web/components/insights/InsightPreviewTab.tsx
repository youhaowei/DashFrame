"use client";

import { useRouter } from "next/navigation";
import type { UUID, Field } from "@dashframe/core";
import type { Insight, Visualization, InsightMetric } from "@/lib/stores/types";
import type { PreviewResult } from "@/lib/insights/compute-preview";
import { Button, Card, CardContent, CardHeader, Badge } from "@dashframe/ui";
import {
  BarChart3,
  CircleDot,
  ExternalLink,
  LineChart,
  Plus,
  TableIcon,
} from "@dashframe/ui/icons";

// Format cell value for display
function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return value.toLocaleString();
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }
  return String(value);
}

interface InsightPreviewTabProps {
  insightId: UUID;
  insight: Insight;
  visualizations: Visualization[];
  aggregatedPreview: PreviewResult | null;
  selectedFields: Field[];
  metrics: InsightMetric[];
}

/**
 * Preview Tab Content
 *
 * Shows:
 * 1. Aggregated result table (computed insight data)
 * 2. Visualizations that use this insight
 */
export function InsightPreviewTab({
  insightId: _insightId,
  insight: _insight,
  visualizations,
  aggregatedPreview,
  selectedFields,
  metrics,
}: InsightPreviewTabProps) {
  const router = useRouter();

  // Helper to get visualization count text
  const getVisualizationCountText = (count: number): string => {
    if (count === 0) return "No visualizations yet";
    return `${count} visualization${count !== 1 ? "s" : ""}`;
  };

  // Get icon for visualization type
  const getVizIcon = (type: string) => {
    switch (type) {
      case "bar":
        return <BarChart3 className="h-5 w-5" />;
      case "line":
      case "area":
        return <LineChart className="h-5 w-5" />;
      case "scatter":
        return <CircleDot className="h-5 w-5" />;
      case "table":
      default:
        return <TableIcon className="h-5 w-5" />;
    }
  };

  // Handle opening visualization - uses route-based navigation
  const handleOpenVisualization = (vizId: UUID) => {
    router.push(`/visualizations/${vizId}`);
  };

  // Filter visible metrics (not starting with _)
  const visibleMetrics = metrics.filter((m) => !m.name.startsWith("_"));

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="container mx-auto max-w-6xl space-y-6 px-6 py-6">
        {/* Result Data Table */}
        {aggregatedPreview && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">Result data</h3>
                  <p className="text-muted-foreground text-xs">
                    {aggregatedPreview.rowCount} rows • {selectedFields.length}{" "}
                    fields • {visibleMetrics.length} metrics
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="bg-muted/20 relative overflow-hidden rounded-xl border">
                <div className="overflow-auto" style={{ maxHeight: 300 }}>
                  <table className="w-full border-separate border-spacing-0 text-sm">
                    <thead className="bg-card sticky top-0 z-10">
                      <tr>
                        {selectedFields.map((field) => (
                          <th
                            key={field.id}
                            className="text-muted-foreground px-3 py-2 text-left text-xs font-semibold"
                          >
                            {field.name}
                          </th>
                        ))}
                        {visibleMetrics.map((metric) => (
                          <th
                            key={metric.id}
                            className="text-primary px-3 py-2 text-left text-xs font-semibold"
                          >
                            {metric.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {aggregatedPreview.dataFrame.rows.map((row, idx) => (
                        <tr key={idx} className="border-b last:border-0">
                          {selectedFields.map((field) => (
                            <td
                              key={field.id}
                              className="whitespace-nowrap px-3 py-2 text-xs"
                            >
                              {formatCellValue(
                                (row as Record<string, unknown>)[
                                  field.columnName ?? field.name
                                ],
                              )}
                            </td>
                          ))}
                          {visibleMetrics.map((metric) => (
                            <td
                              key={metric.id}
                              className="text-primary whitespace-nowrap px-3 py-2 text-xs font-medium"
                            >
                              {formatCellValue(
                                (row as Record<string, unknown>)[metric.name],
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Visualizations Section */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">Visualizations</h3>
              <p className="text-muted-foreground text-sm">
                {getVisualizationCountText(visualizations.length)}
              </p>
            </div>
            <Button variant="outline">
              <Plus className="mr-2 h-4 w-4" />
              Create visualization
            </Button>
          </div>

          {visualizations.length === 0 ? (
            <Card className="bg-muted/30 border-dashed">
              <CardContent className="p-8 text-center">
                <div className="bg-muted mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full">
                  <BarChart3 className="text-muted-foreground h-6 w-6" />
                </div>
                <p className="text-muted-foreground text-sm">
                  Create a visualization to see your data come to life
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {visualizations.map((viz) => (
                <Card
                  key={viz.id}
                  className="cursor-pointer transition-shadow hover:shadow-md"
                  onClick={() => handleOpenVisualization(viz.id)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-4">
                      {/* Icon */}
                      <div className="bg-muted flex h-12 w-12 shrink-0 items-center justify-center rounded-xl">
                        {getVizIcon(viz.visualizationType)}
                      </div>

                      {/* Info */}
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex items-center gap-2">
                          <h4 className="truncate font-medium">{viz.name}</h4>
                          <Badge variant="secondary" className="text-xs">
                            {viz.visualizationType}
                          </Badge>
                        </div>
                        {viz.encoding && (
                          <p className="text-muted-foreground text-xs">
                            {viz.encoding.x && `X: ${viz.encoding.x}`}
                            {viz.encoding.x && viz.encoding.y && " • "}
                            {viz.encoding.y && `Y: ${viz.encoding.y}`}
                            {(viz.encoding.x || viz.encoding.y) &&
                              viz.encoding.color &&
                              " • "}
                            {viz.encoding.color &&
                              `Color: ${viz.encoding.color}`}
                          </p>
                        )}
                        <p className="text-muted-foreground mt-1 text-xs">
                          Created{" "}
                          {new Date(viz.createdAt).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </p>
                      </div>

                      {/* Action */}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenVisualization(viz.id);
                        }}
                      >
                        <ExternalLink className="mr-1 h-4 w-4" />
                        Open
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
