import { useVisualizations } from "@/data";
import type { UUID } from "@dashframe/types";
import { Spinner } from "@wystack/ui-react";
import { useMemo } from "react";

import { VisualizationDisplay } from "./VisualizationDisplay";
import { VisualizationPreview } from "./VisualizationPreview";

interface VisualizationRendererProps {
  visualizationId: UUID;
  className?: string;
  width?: number | "container";
  height?: number | "container";
  preview?: boolean;
}

/**
 * Compatibility adapter for callers that need a visualization by id.
 * Rendering is delegated to the canonical insight-aware modules so this path
 * cannot bypass filters, joins, sorts, or instance-qualified fields.
 */
export function VisualizationRenderer({
  visualizationId,
  className,
  width = "container",
  height = "container",
  preview = false,
}: VisualizationRendererProps) {
  const { data: visualizations = [] } = useVisualizations();
  const visualization = useMemo(
    () => visualizations.find((candidate) => candidate.id === visualizationId),
    [visualizationId, visualizations],
  );
  const style = {
    width: width === "container" ? "100%" : width,
    height: height === "container" ? "100%" : height,
  };

  if (!visualization) {
    return (
      <div className={className} style={style}>
        <div className="flex h-full items-center justify-center">
          <Spinner size="sm" />
        </div>
      </div>
    );
  }

  if (preview) {
    return (
      <div className={className} style={style}>
        <VisualizationPreview visualization={visualization} height={height} />
      </div>
    );
  }

  return (
    <div className={className} style={style}>
      <VisualizationDisplay visualizationId={visualizationId} />
    </div>
  );
}
