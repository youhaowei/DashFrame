import type { Dashboard, Visualization } from "@dashframe/types";

export function indexReportContents(visualizations: readonly Visualization[]) {
  return {
    visualizationById: new Map(
      visualizations.map((visualization) => [visualization.id, visualization]),
    ),
  };
}

/** Resolve saved views, and the ids of their questions, in first-widget order. */
export function resolveReportContents(
  report: Dashboard,
  indexes: ReturnType<typeof indexReportContents>,
) {
  const savedViews: Visualization[] = [];
  const savedViewIds = new Set<string>();

  for (const item of report.items) {
    if (item.type !== "visualization" || !item.visualizationId) continue;
    const visualization = indexes.visualizationById.get(item.visualizationId);
    if (!visualization || savedViewIds.has(visualization.id)) continue;
    savedViewIds.add(visualization.id);
    savedViews.push(visualization);
  }

  const questionIds = [...new Set(savedViews.map((view) => view.insightId))];

  return { savedViews, questionIds };
}
