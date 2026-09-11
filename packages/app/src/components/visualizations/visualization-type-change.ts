import type {
  Visualization,
  VisualizationEncoding,
  VisualizationType,
} from "@dashframe/types";

export type VisualizationTypeChange = {
  visualizationType: VisualizationType;
  encoding?: VisualizationEncoding;
};

/** Preserve the visualization page's bar-orientation axis swap contract. */
export function getVisualizationTypeChange(
  visualization: Pick<Visualization, "visualizationType" | "encoding">,
  nextType: VisualizationType,
): VisualizationTypeChange | null {
  if (visualization.visualizationType === nextType) return null;

  const swapsBarOrientation =
    (visualization.visualizationType === "barY" && nextType === "barX") ||
    (visualization.visualizationType === "barX" && nextType === "barY");
  if (!swapsBarOrientation || !visualization.encoding) {
    return { visualizationType: nextType };
  }

  return {
    visualizationType: nextType,
    encoding: {
      ...visualization.encoding,
      x: visualization.encoding.y,
      y: visualization.encoding.x,
      xType: visualization.encoding.yType,
      yType: visualization.encoding.xType,
    },
  };
}
