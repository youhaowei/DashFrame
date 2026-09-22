import { fieldEncoding, metricEncoding, parseEncoding } from "@dashframe/types";
import type {
  Field,
  Insight,
  InsightRuntimeInput,
  VisualizationEncoding,
} from "@dashframe/types";

/** Presentation metadata for a server-executed selection; never a new query. */
export function reportPresentation(
  insight: Insight,
  runtime?: InsightRuntimeInput,
): Insight {
  if (!runtime?.dimensions && !runtime?.measures) return insight;
  const selectedFields = runtime.dimensions ?? insight.selectedFields;
  const reporting = { ...insight.reporting };
  reporting.pivotFields = reporting.pivotFields?.filter((id) =>
    selectedFields.includes(id),
  );
  if (runtime.measures) reporting.measureIds = runtime.measures;
  if (reporting.topN && !selectedFields.includes(reporting.topN.fieldId))
    delete reporting.topN;
  return { ...insight, selectedFields, reporting };
}
type Channel = "x" | "y" | "color" | "size";
function axisType(
  type: Field["type"] | undefined,
): VisualizationEncoding["xType"] {
  if (type === "date") return "temporal";
  if (type === "number") return "quantitative";
  return "nominal";
}
function rebindField(
  result: VisualizationEncoding,
  channel: Channel,
  dimensions: string[],
  insight: Insight,
  fields: Field[],
) {
  const newDimension = dimensions.find(
    (id) => !insight.selectedFields.includes(id),
  );
  const isAxis = channel === "x" || channel === "y";
  const replacement = newDimension ?? (isAxis ? dimensions[0] : undefined);
  result[channel] = replacement ? fieldEncoding(replacement) : undefined;
  if (channel === "x" || channel === "y") {
    result[`${channel}Type`] = axisType(
      fields.find((field) => field.id === replacement)?.type,
    );
    result[`${channel}Transform`] = undefined;
  }
}

/** Rebind removed encodings to the viewer's replacement without changing saved charts. */
export function reportEncoding(
  encoding: VisualizationEncoding,
  insight: Insight,
  runtime: InsightRuntimeInput | undefined,
  fields: Field[],
): VisualizationEncoding {
  const result = { ...encoding };
  for (const channel of ["x", "y", "color", "size"] as const) {
    const parsed = parseEncoding(encoding[channel]);
    if (!parsed) continue;
    if (
      parsed.type === "field" &&
      runtime?.dimensions &&
      !runtime.dimensions.includes(parsed.id)
    ) {
      rebindField(result, channel, runtime.dimensions, insight, fields);
    }
    if (
      parsed.type === "metric" &&
      runtime?.measures &&
      !runtime.measures.includes(parsed.id)
    ) {
      result[channel] = runtime.measures[0]
        ? metricEncoding(runtime.measures[0])
        : undefined;
    }
  }
  return result;
}
