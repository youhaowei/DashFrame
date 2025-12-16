"use client";

import { memo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Section, Card, CardContent, Badge, Button } from "@dashframe/ui";
import {
  BarChart3,
  CircleDot,
  ExternalLink,
  LineChart,
  Plus,
  TableIcon,
} from "@dashframe/ui/icons";
import type { Visualization } from "@dashframe/types";

interface VisualizationsSectionProps {
  visualizations: Visualization[];
  insightId: string;
}

/**
 * Extract chart type from Vega-Lite spec mark property
 */
function getChartTypeFromSpec(spec: Visualization["spec"]): string {
  if (!spec?.mark) return "table";

  const mark = spec.mark as unknown;
  if (typeof mark === "string") {
    return mark;
  }
  if (typeof mark === "object" && mark !== null && "type" in mark) {
    return String((mark as { type: unknown }).type);
  }
  return "table";
}

// Type for Vega-Lite encoding channel with field
interface EncodingChannel {
  field?: string;
  [key: string]: unknown;
}

/**
 * Extract encoding fields from Vega-Lite spec
 */
function getEncodingFromSpec(spec: Visualization["spec"]): {
  x?: string;
  y?: string;
  color?: string;
} {
  const encoding = spec?.encoding as
    | Record<string, EncodingChannel | unknown>
    | undefined;
  if (!encoding) return {};

  const result: { x?: string; y?: string; color?: string } = {};

  const xEnc = encoding.x as EncodingChannel | undefined;
  const yEnc = encoding.y as EncodingChannel | undefined;
  const colorEnc = encoding.color as EncodingChannel | undefined;

  if (xEnc && typeof xEnc === "object" && "field" in xEnc) {
    result.x = String(xEnc.field);
  }
  if (yEnc && typeof yEnc === "object" && "field" in yEnc) {
    result.y = String(yEnc.field);
  }
  if (colorEnc && typeof colorEnc === "object" && "field" in colorEnc) {
    result.color = String(colorEnc.field);
  }

  return result;
}

/**
 * Get icon for visualization type
 */
function getVizIcon(type: string) {
  switch (type) {
    case "bar":
      return <BarChart3 className="h-5 w-5" />;
    case "line":
    case "area":
      return <LineChart className="h-5 w-5" />;
    case "point":
    case "scatter":
      return <CircleDot className="h-5 w-5" />;
    case "table":
    default:
      return <TableIcon className="h-5 w-5" />;
  }
}

/**
 * VisualizationsSection - Shows list of created visualizations
 *
 * Displays all visualizations created from this insight.
 * Each card shows the chart type, encoding fields, and creation date.
 * Clicking a visualization navigates to its detail page.
 *
 * Memoized to prevent re-renders when unrelated data changes.
 */
export const VisualizationsSection = memo(function VisualizationsSection({
  visualizations,
  insightId,
}: VisualizationsSectionProps) {
  const router = useRouter();

  const handleOpenVisualization = useCallback(
    (vizId: string) => {
      router.push(`/visualizations/${vizId}`);
    },
    [router],
  );

  const handleCreateVisualization = useCallback(() => {
    // TODO: Implement create visualization flow
    console.log("Create visualization for insight:", insightId);
  }, [insightId]);

  const getVisualizationCountText = (count: number): string => {
    if (count === 0) return "No visualizations yet";
    return `${count} visualization${count !== 1 ? "s" : ""}`;
  };

  return (
    <Section
      title="Visualizations"
      description={getVisualizationCountText(visualizations.length)}
      action={
        <Button variant="outline" onClick={handleCreateVisualization}>
          <Plus className="mr-2 h-4 w-4" />
          Create visualization
        </Button>
      }
    >
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
          {visualizations.map((viz) => {
            const chartType = getChartTypeFromSpec(viz.spec);
            const encoding = getEncodingFromSpec(viz.spec);

            return (
              <Card
                key={viz.id}
                className="cursor-pointer transition-shadow hover:shadow-md"
                onClick={() => handleOpenVisualization(viz.id)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    {/* Icon */}
                    <div className="bg-muted flex h-12 w-12 shrink-0 items-center justify-center rounded-xl">
                      {getVizIcon(chartType)}
                    </div>

                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-2">
                        <h4 className="truncate font-medium">{viz.name}</h4>
                        <Badge variant="secondary" className="text-xs">
                          {chartType}
                        </Badge>
                      </div>
                      {(encoding.x || encoding.y || encoding.color) && (
                        <p className="text-muted-foreground text-xs">
                          {encoding.x && `X: ${encoding.x}`}
                          {encoding.x && encoding.y && " • "}
                          {encoding.y && `Y: ${encoding.y}`}
                          {(encoding.x || encoding.y) &&
                            encoding.color &&
                            " • "}
                          {encoding.color && `Color: ${encoding.color}`}
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

                    {/* Open Icon */}
                    <div className="shrink-0">
                      <ExternalLink className="text-muted-foreground h-4 w-4" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </Section>
  );
});
