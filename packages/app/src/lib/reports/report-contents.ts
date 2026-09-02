import type { Dashboard, Insight, Visualization } from "@dashframe/types";

/** Resolve saved views and their questions in first-widget order. */
export function resolveReportContents(
  report: Dashboard,
  visualizations: readonly Visualization[],
  insights: readonly Insight[],
) {
  const visualizationById = new Map(
    visualizations.map((visualization) => [visualization.id, visualization]),
  );
  const savedViews: Visualization[] = [];
  const savedViewIds = new Set<string>();

  for (const item of report.items) {
    if (item.type !== "visualization" || !item.visualizationId) continue;
    const visualization = visualizationById.get(item.visualizationId);
    if (!visualization || savedViewIds.has(visualization.id)) continue;
    savedViewIds.add(visualization.id);
    savedViews.push(visualization);
  }

  const questionIds = [...new Set(savedViews.map((view) => view.insightId))];
  const insightById = new Map(insights.map((insight) => [insight.id, insight]));
  const questions = questionIds.flatMap((id) => {
    const insight = insightById.get(id);
    return insight ? [insight] : [];
  });

  return { savedViews, questionIds, questions };
}
