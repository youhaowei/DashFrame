import { resolveEncodingToResultFrame } from "@dashframe/engine";
import { parseEncoding } from "@dashframe/types";
import type {
  DateTransform,
  Insight,
  InsightPresentation,
  VisualizationEncoding,
  VisualizationType,
} from "@dashframe/types";

function channelDateTransform(
  encoding: VisualizationEncoding,
  channel: "x" | "y" | "color" | "size",
): DateTransform | undefined {
  if (channel !== "x" && channel !== "y") return undefined;
  const transform = encoding[`${channel}Transform`]?.transform;
  return transform?.kind === "temporal" && transform.aggregation === "none"
    ? undefined
    : transform;
}

/** Ask the host to recompute measures at the dimensions actually drawn by a chart. */
export function buildChartPresentation(
  insight: Insight | null | undefined,
  encoding: VisualizationEncoding | undefined,
  chartType: VisualizationType = "dot",
): InsightPresentation | undefined {
  if (!insight?.metrics?.length || !encoding) return undefined;
  const dimensions: string[] = [];
  const transforms: Record<string, DateTransform> = {};
  const seen = new Map<string, string>();
  for (const channel of ["x", "y", "color", "size"] as const) {
    if (channel === "size" && chartType !== "dot") continue;
    const parsed = parseEncoding(encoding[channel]);
    if (parsed?.type !== "field") continue;
    const active = channelDateTransform(encoding, channel);
    const signature = JSON.stringify(active ?? null);
    if (seen.has(parsed.id) && seen.get(parsed.id) !== signature)
      throw new Error("Use one date grouping per field in a chart.");
    if (!seen.has(parsed.id)) dimensions.push(parsed.id);
    seen.set(parsed.id, signature);
    if (active) transforms[parsed.id] = active;
  }
  return {
    dimensions,
    ...(Object.keys(transforms).length ? { transforms } : {}),
  };
}

/** Presentation frames have already applied date transforms and source aggregations. */
export function resolveReportChartEncoding(
  encoding: VisualizationEncoding,
  context: Parameters<typeof resolveEncodingToResultFrame>[1],
  presentationApplied: boolean,
  chartType: VisualizationType = "dot",
) {
  const supported =
    chartType === "dot" ? encoding : { ...encoding, size: undefined };
  return resolveEncodingToResultFrame(
    presentationApplied
      ? { ...supported, xTransform: undefined, yTransform: undefined }
      : supported,
    context,
  );
}
