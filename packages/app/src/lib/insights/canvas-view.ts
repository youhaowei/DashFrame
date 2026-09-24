/** What the insight workbench's canvas shows: the data, or one saved chart. */
export type InsightCanvasView =
  | { kind: "table" }
  | { kind: "visualization"; visualizationId: string };

export const TABLE_CANVAS_VIEW: InsightCanvasView = { kind: "table" };

/** A chart that no longer exists shows the data instead. */
export function sanitizeInsightCanvasView(
  view: InsightCanvasView | undefined,
  existingVisualizationIds: ReadonlySet<string>,
): InsightCanvasView {
  if (view?.kind === "visualization") {
    return existingVisualizationIds.has(view.visualizationId)
      ? view
      : TABLE_CANVAS_VIEW;
  }
  return view ?? TABLE_CANVAS_VIEW;
}
