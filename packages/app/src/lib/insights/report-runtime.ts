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
  replacement: string | undefined,
  fields: Field[],
) {
  result[channel] = replacement ? fieldEncoding(replacement) : undefined;
  if (channel === "x" || channel === "y") {
    result[`${channel}Type`] = replacement
      ? axisType(fields.find((field) => field.id === replacement)?.type)
      : undefined;
    result[`${channel}Transform`] = undefined;
  }
}

function positionalReplacement(
  currentId: string,
  previousIds: readonly string[],
  nextIds: readonly string[],
  usedIds: ReadonlySet<string>,
): string | undefined {
  const position = previousIds.indexOf(currentId);
  const positional = position >= 0 ? nextIds[position] : undefined;
  if (positional && !usedIds.has(positional)) return positional;
  return nextIds.find((id) => !usedIds.has(id));
}

function rebindRemovedField(
  result: VisualizationEncoding,
  channel: Channel,
  currentId: string,
  dimensions: string[] | undefined,
  insight: Insight,
  fields: Field[],
  usedDimensions: Set<string>,
) {
  if (!dimensions || dimensions.includes(currentId)) return;
  const replacement = positionalReplacement(
    currentId,
    insight.selectedFields,
    dimensions,
    usedDimensions,
  );
  rebindField(result, channel, replacement, fields);
  if (replacement) usedDimensions.add(replacement);
}

function rebindRemovedMetric(
  result: VisualizationEncoding,
  channel: Channel,
  currentId: string,
  measures: string[] | undefined,
  previousMeasures: readonly string[],
  usedMeasures: Set<string>,
) {
  if (!measures || measures.includes(currentId)) return;
  const replacement = positionalReplacement(
    currentId,
    previousMeasures,
    measures,
    usedMeasures,
  );
  result[channel] = replacement ? metricEncoding(replacement) : undefined;
  if (replacement) usedMeasures.add(replacement);
}

/** Rebind removed encodings to the viewer's replacement without changing saved charts. */
export function reportEncoding(
  encoding: VisualizationEncoding,
  insight: Insight,
  runtime: InsightRuntimeInput | undefined,
  fields: Field[],
): VisualizationEncoding {
  const result = { ...encoding };
  const channels = ["x", "y", "color", "size"] as const;
  const parsedChannels = channels.map((channel) => ({
    channel,
    parsed: parseEncoding(encoding[channel]),
  }));
  const dimensions = runtime?.dimensions;
  const measures = runtime?.measures;
  const previousMeasures =
    insight.reporting?.measureIds ??
    insight.metrics?.map((metric) => metric.id) ??
    [];
  const usedDimensions = new Set(
    parsedChannels.flatMap(({ parsed }) =>
      parsed?.type === "field" && dimensions?.includes(parsed.id)
        ? [parsed.id]
        : [],
    ),
  );
  const usedMeasures = new Set(
    parsedChannels.flatMap(({ parsed }) =>
      parsed?.type === "metric" && measures?.includes(parsed.id)
        ? [parsed.id]
        : [],
    ),
  );
  for (const { channel, parsed } of parsedChannels) {
    if (!parsed) continue;
    if (parsed.type === "field") {
      rebindRemovedField(
        result,
        channel,
        parsed.id,
        dimensions,
        insight,
        fields,
        usedDimensions,
      );
    } else {
      rebindRemovedMetric(
        result,
        channel,
        parsed.id,
        measures,
        previousMeasures,
        usedMeasures,
      );
    }
  }
  return result;
}
