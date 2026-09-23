import { fieldIdToColumnAlias, metricIdToColumnAlias } from "@dashframe/engine";
import type { Insight } from "@dashframe/types";
import type { CombinedField } from "./compute-combined-fields";

/** Aggregate predicates use result aliases, distinct from raw source columns. */
export function measureFilterFields(
  insight: Pick<Insight, "id" | "metrics">,
  fields: CombinedField[],
): CombinedField[] {
  return insight.metrics
    .filter((metric) => !metric.name.startsWith("_"))
    .map((metric) => {
      const sourceType =
        !metric.expression &&
        (metric.aggregation === "min" || metric.aggregation === "max")
          ? fields.find(
              (field) =>
                field.sourceTableId === metric.sourceTable &&
                ((field.columnName ?? field.name) === metric.columnName ||
                  fieldIdToColumnAlias(field.id) === metric.columnName),
            )?.type
          : undefined;
      const alias = metricIdToColumnAlias(metric.id);
      return {
        id: alias,
        tableId: insight.id,
        sourceTableId: metric.sourceTable,
        name: metric.name,
        columnName: alias,
        displayName: `${metric.name} (measure)`,
        type: sourceType ?? "number",
      };
    });
}
