import {
  fieldEncoding,
  fixedRuntimeIds,
  metricEncoding,
  parseEncoding,
} from "@dashframe/types";
import type {
  Field,
  Insight,
  InsightRuntimeInput,
  UUID,
  VisualizationEncoding,
} from "@dashframe/types";

/**
 * The viewer's picks plus everything the saved report always shows, in the
 * saved order, with picks the report doesn't show by default appended.
 */
export function withFixedIds(
  saved: readonly UUID[],
  fixed: readonly UUID[],
  picked: readonly string[],
): UUID[] {
  const keep = new Set<string>([...fixed, ...picked]);
  return [
    ...saved.filter((id) => keep.has(id)),
    ...(picked.filter((id) => !saved.includes(id as UUID)) as UUID[]),
  ];
}

/**
 * Rebuilds a viewer's field and measure picks against the insight as it is
 * now. The fixed part of a selection comes from the saved insight, so an
 * author edit made after the viewer chose would otherwise leave a request the
 * host refuses. Picks that are no longer viewer choices are dropped.
 */
export function currentViewerRuntime(
  insight: Insight,
  runtime: InsightRuntimeInput | undefined,
): InsightRuntimeInput | undefined {
  if (!runtime?.dimensions && !runtime?.measures) return runtime;
  const next = { ...runtime };
  const savedMeasures =
    insight.reporting?.measureIds ?? insight.metrics.map((metric) => metric.id);
  const kinds = [
    ["dimensions", insight.selectedFields],
    ["measures", savedMeasures],
  ] as const;
  for (const [kind, saved] of kinds) {
    const picks = runtime[kind];
    if (!picks) continue;
    const control = insight.runtimeControls?.[kind];
    if (!control) {
      delete next[kind];
      continue;
    }
    const fixed = fixedRuntimeIds(insight, kind);
    // The author may have lowered the cap, or turned a fixed field the viewer
    // kept into a choice, since the viewer picked.
    const optional = picks
      .filter((id) => control.allowedIds.includes(id) && !fixed.includes(id))
      .slice(0, control.maxSelected);
    const rebuilt = withFixedIds(saved, fixed, optional);
    // A viewer who hid every field sees the metrics alone. Otherwise nothing
    // the viewer picked is left, so fall back to the saved report.
    const hidAllFields = kind === "dimensions" && picks.length === 0;
    if (rebuilt.length === 0 && !hidAllFields) delete next[kind];
    else next[kind] = rebuilt;
  }
  return next;
}

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
  // Only viewer choices come and go, so a replacement is matched among them;
  // fixed fields would otherwise shift the positions.
  const fixed = fixedRuntimeIds(insight, "dimensions");
  const replacement = positionalReplacement(
    currentId,
    insight.selectedFields.filter((id) => !fixed.includes(id)),
    dimensions.filter((id) => !fixed.includes(id as UUID)),
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
  fixedMeasures: readonly string[],
  usedMeasures: Set<string>,
) {
  if (!measures || measures.includes(currentId)) return;
  const replacement = positionalReplacement(
    currentId,
    previousMeasures.filter((id) => !fixedMeasures.includes(id)),
    measures.filter((id) => !fixedMeasures.includes(id)),
    usedMeasures,
  );
  result[channel] = replacement ? metricEncoding(replacement) : undefined;
  if (replacement) usedMeasures.add(replacement);
}

/**
 * Splits the chart by the first pivoted field when the chart leaves color
 * free, so the chart shows the same breakdown as the pivoted table.
 */
function withPivotColor(
  result: VisualizationEncoding,
  insight: Insight,
  runtime: InsightRuntimeInput | undefined,
) {
  if (result.color) return;
  const selected = runtime?.dimensions ?? insight.selectedFields;
  const drawn = new Set(
    [result.x, result.y, result.size].map((value) => parseEncoding(value)?.id),
  );
  // Selected order, which is how the table nests its pivot columns.
  const pivots = new Set(insight.reporting?.pivotFields);
  const pivot = selected.find((id) => pivots.has(id) && !drawn.has(id));
  if (pivot) result.color = fieldEncoding(pivot);
}

/**
 * The encoding a report chart draws for this run: removed fields rebound to
 * the viewer's replacement, and a pivot shown as color. Saved charts stay as
 * they are.
 */
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
  const fixedMeasures = fixedRuntimeIds(insight, "measures");
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
        fixedMeasures,
        usedMeasures,
      );
    }
  }
  withPivotColor(result, insight, runtime);
  return result;
}

/** The field a saved chart takes its color from because of a pivot, if any. */
export function reportPivotColor(
  encoding: VisualizationEncoding | undefined,
  insight: Insight,
  runtime: InsightRuntimeInput | undefined,
  fields: Field[],
): string | undefined {
  if (!encoding || encoding.color) return undefined;
  return reportEncoding(encoding, insight, runtime, fields).color;
}
