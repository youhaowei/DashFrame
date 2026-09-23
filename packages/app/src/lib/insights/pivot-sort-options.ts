import { fieldIdToColumnAlias, metricIdToColumnAlias } from "@dashframe/engine";
import type { Insight, InsightSort } from "@dashframe/types";

export interface PivotSortOption {
  field: string;
  measureId: string;
  label: string;
  pivotValues: NonNullable<InsightSort["pivotValues"]>;
}
export function reportSortKey(
  sort: Pick<InsightSort, "field" | "pivotValues">,
): string {
  return JSON.stringify([sort.field, sort.pivotValues ?? []]);
}
export function buildPivotSortOptions(
  insight: Insight | undefined,
  rows: readonly Record<string, unknown>[],
): PivotSortOption[] {
  if (!insight) return [];
  const pivotIds = insight.selectedFields.filter((id) =>
    insight.reporting?.pivotFields?.includes(id),
  );
  if (!pivotIds.length) return [];
  const tuples = new Map<string, NonNullable<InsightSort["pivotValues"]>>();
  for (const row of rows) {
    if (Number(row.__report_grouping ?? 0) !== 0) continue;
    const values = pivotTuple(insight, row, pivotIds);
    if (values.length === pivotIds.length)
      tuples.set(JSON.stringify(values), values);
  }
  const measureIds =
    insight.reporting?.measureIds ?? insight.metrics.map((metric) => metric.id);
  return insight.metrics
    .filter((metric) => measureIds.includes(metric.id))
    .flatMap((metric) =>
      [...tuples.values()].map((pivotValues) => ({
        field: metricIdToColumnAlias(metric.id),
        measureId: metric.id,
        label: [
          metric.name,
          ...pivotValues.map(({ fieldId, value }) => {
            const grain = insight.reporting?.dateGrains?.[fieldId];
            if (value === null) return "(empty)";
            if (typeof value === "string" && grain) {
              if (grain === "month") return value.slice(0, 7);
              if (grain === "year") return value.slice(0, 4);
              if (grain === "quarter")
                return `${value.slice(0, 4)} Q${Math.floor(new Date(value).getUTCMonth() / 3) + 1}`;
              return value.slice(0, 10);
            }
            return String(value);
          }),
        ].join(" · "),
        pivotValues,
      })),
    );
}

function pivotTuple(
  insight: Insight,
  row: Record<string, unknown>,
  pivotIds: string[],
) {
  const values: NonNullable<InsightSort["pivotValues"]> = [];
  for (const fieldId of pivotIds) {
    let value = row[fieldIdToColumnAlias(fieldId)];
    if (
      value instanceof Date ||
      (insight.reporting?.dateGrains?.[fieldId] && typeof value === "number")
    ) {
      value = new Date(value).toISOString();
    }
    if (
      value !== null &&
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    )
      break;
    values.push({ fieldId, value });
  }

  return values;
}
