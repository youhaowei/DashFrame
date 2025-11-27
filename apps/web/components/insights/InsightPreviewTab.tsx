"use client";

import { useRouter } from "next/navigation";
import type { UUID, Field } from "@dashframe/dataframe";
import type { Insight, Visualization, InsightMetric } from "@/lib/stores/types";
import type { PreviewResult } from "@/lib/insights/compute-preview";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  Badge,
  Plus,
  LineChart,
  TableIcon,
  BarChart3,
} from "@dashframe/ui";
import { LuExternalLink, LuCircleDot } from "react-icons/lu";

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
  insightId,
  insight,
  visualizations,
  aggregatedPreview,
  selectedFields,
  metrics,
}: InsightPreviewTabProps) {
  const router = useRouter();

  // Get icon for visualization type
  const getVizIcon = (type: string) => {
    switch (type) {
      case "bar":
        return <BarChart3 className="h-5 w-5" />;
      case "line":
      case "area":
        return <LineChart className="h-5 w-5" />;
      case "scatter":
        return <LuCircleDot className="h-5 w-5" />;
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
      <div className="container mx-auto px-6 py-6 max-w-6xl space-y-6">
        {/* Result Data Table */}
        {aggregatedPreview && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">Result data</h3>
                  <p className="text-xs text-muted-foreground">
                    {aggregatedPreview.rowCount} rows • {selectedFields.length} fields • {visibleMetrics.length} metrics
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="relative overflow-hidden rounded-xl border bg-muted/20">
                <div className="overflow-auto" style={{ maxHeight: 300 }}>
                  <table className="w-full text-sm border-separate border-spacing-0">
                    <thead className="sticky top-0 z-10 bg-card">
                      <tr>
                        {selectedFields.map((field) => (
                          <th
                            key={field.id}
                            className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground"
                          >
                            {field.name}
                          </th>
                        ))}
                        {visibleMetrics.map((metric) => (
                          <th
                            key={metric.id}
                            className="px-3 py-2 text-left text-xs font-semibold text-primary"
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
                              className="px-3 py-2 text-xs whitespace-nowrap"
                            >
                              {formatCellValue(
                                (row as Record<string, unknown>)[field.columnName ?? field.name]
                              )}
                            </td>
                          ))}
                          {visibleMetrics.map((metric) => (
                            <td
                              key={metric.id}
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
            </CardContent>
          </Card>
        )}

        {/* Visualizations Section */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">Visualizations</h3>
              <p className="text-sm text-muted-foreground">
                {visualizations.length === 0
                  ? "No visualizations yet"
                  : `${visualizations.length} visualization${visualizations.length !== 1 ? "s" : ""}`}
              </p>
            </div>
            <Button variant="outline">
              <Plus className="h-4 w-4 mr-2" />
              Create visualization
            </Button>
          </div>

          {visualizations.length === 0 ? (
            <Card className="bg-muted/30 border-dashed">
              <CardContent className="p-8 text-center">
                <div className="h-12 w-12 mx-auto mb-3 rounded-full bg-muted flex items-center justify-center">
                  <BarChart3 className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">
                  Create a visualization to see your data come to life
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {visualizations.map((viz) => (
                <Card
                  key={viz.id}
                  className="hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => handleOpenVisualization(viz.id)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-4">
                      {/* Icon */}
                      <div className="h-12 w-12 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
                        {getVizIcon(viz.visualizationType)}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-medium truncate">{viz.name}</h4>
                          <Badge variant="secondary" className="text-xs">
                            {viz.visualizationType}
                          </Badge>
                        </div>
                        {viz.encoding && (
                          <p className="text-xs text-muted-foreground">
                            {viz.encoding.x && `X: ${viz.encoding.x}`}
                            {viz.encoding.x && viz.encoding.y && " • "}
                            {viz.encoding.y && `Y: ${viz.encoding.y}`}
                            {(viz.encoding.x || viz.encoding.y) &&
                              viz.encoding.color &&
                              " • "}
                            {viz.encoding.color && `Color: ${viz.encoding.color}`}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">
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
                        className="flex-shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenVisualization(viz.id);
                        }}
                      >
                        <LuExternalLink className="h-4 w-4 mr-1" />
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
