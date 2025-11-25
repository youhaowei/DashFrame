"use client";

import { useRouter } from "next/navigation";
import type { Id, Doc } from "@dashframe/convex/dataModel";
import {
  Button,
  Card,
  CardContent,
  Badge,
  Plus,
  LineChart,
  TableIcon,
  BarChart3,
} from "@dashframe/ui";
import { LuExternalLink, LuCircleDot } from "react-icons/lu";

interface InsightPreviewTabProps {
  insightId: Id<"insights">;
  insight: Doc<"insights">;
  visualizations: Doc<"visualizations">[];
}

/**
 * Preview Tab Content
 *
 * Shows visualizations that use this insight.
 * Allows users to:
 * - View existing visualizations
 * - Open visualization in its dedicated page
 * - Create new visualizations from this insight
 */
export function InsightPreviewTab({
  insightId,
  insight,
  visualizations,
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
  const handleOpenVisualization = (vizId: Id<"visualizations">) => {
    router.push(`/visualizations/${vizId}`);
  };

  // No visualizations yet
  if (visualizations.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <div className="h-16 w-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
            <BarChart3 className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-2">No visualizations yet</h3>
          <p className="text-sm text-muted-foreground mb-4">
            This insight doesn't have any visualizations. Create one to see your
            data come to life.
          </p>
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            Create Visualization
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="container mx-auto px-6 py-6 max-w-4xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">
              Visualizations using this insight
            </h3>
            <p className="text-sm text-muted-foreground">
              {visualizations.length} visualization
              {visualizations.length !== 1 ? "s" : ""} created from this insight
            </p>
          </div>
          <Button variant="outline">
            <Plus className="h-4 w-4 mr-2" />
            Create Another
          </Button>
        </div>

        {/* Visualization Cards */}
        <div className="grid gap-4">
          {visualizations.map((viz) => (
            <Card
              key={viz._id}
              className="hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => handleOpenVisualization(viz._id)}
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
                      handleOpenVisualization(viz._id);
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

        {/* Info about insight configuration */}
        <Card className="bg-muted/30 border-dashed">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <span className="text-primary text-sm font-semibold">i</span>
              </div>
              <div>
                <p className="text-sm font-medium mb-1">
                  About insight configuration
                </p>
                <p className="text-xs text-muted-foreground">
                  Changes to this insight's fields, metrics, or filters will
                  affect all visualizations that use it. Each visualization has
                  its own appearance settings (chart type, colors) that can be
                  customized independently.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
