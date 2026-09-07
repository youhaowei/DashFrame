import type { Dashboard, Insight, Visualization } from "@dashframe/types";

export function indexReportContents(
  visualizations: readonly Visualization[],
  insights: readonly Insight[],
) {
  return {
    visualizationById: new Map(
      visualizations.map((visualization) => [visualization.id, visualization]),
    ),
    insightById: new Map(insights.map((insight) => [insight.id, insight])),
  };
}

/** Resolve saved views and their questions in first-widget order. */
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
  const questions = questionIds.flatMap((id) => {
    const insight = indexes.insightById.get(id);
    return insight ? [insight] : [];
  });

  return { savedViews, questionIds, questions };
}
