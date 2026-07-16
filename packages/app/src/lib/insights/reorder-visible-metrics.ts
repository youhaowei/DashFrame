import type { InsightMetric } from "@dashframe/types";

const isVisibleMetric = (metric: InsightMetric) => !metric.name.startsWith("_");

/**
 * Reorder the visible projection while preserving hidden metrics in their
 * canonical slots. Missing or duplicate visible entries cannot delete data.
 */
export function reorderVisibleMetrics(
  allMetrics: InsightMetric[],
  requestedOrder: InsightMetric[],
): InsightMetric[] {
  const originalVisible = allMetrics.filter(isVisibleMetric);
  const visibleById = new Map(
    originalVisible.map((metric) => [metric.id, metric]),
  );
  const seen = new Set<string>();
  const orderedVisible: InsightMetric[] = [];

  for (const requested of requestedOrder) {
    const metric = visibleById.get(requested.id);
    if (metric && !seen.has(metric.id)) {
      seen.add(metric.id);
      orderedVisible.push(metric);
    }
  }
  for (const metric of originalVisible) {
    if (!seen.has(metric.id)) orderedVisible.push(metric);
  }

  let visibleIndex = 0;
  return allMetrics.map((metric) =>
    isVisibleMetric(metric) ? orderedVisible[visibleIndex++]! : metric,
  );
}
