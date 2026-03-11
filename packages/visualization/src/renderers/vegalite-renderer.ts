/**
 * Vega-Lite Renderer
 *
 * ChartRenderer implementation using Vega-Lite for all chart types.
 * Receives inline data arrays — no DuckDB dependency.
 *
 * ## Data Flow
 * ```
 * ChartConfig.data[] ──► buildSpec() ──► Vega-Lite spec ──► vega-embed ──► SVG
 * ```
 *
 * ## Encoding Translation
 * Converts SQL expression strings (from ChartEncoding) to Vega-Lite encoding:
 * - "column" → { field: "column" }
 * - "sum(revenue)" → { aggregate: "sum", field: "revenue" }
 * - "dateMonth(created)" → { timeUnit: "month", field: "created" }
 * - "date_trunc('month', col)" → { timeUnit: "yearmonth", field: "col" }
 */

import type { ChartCleanup, ChartConfig, ChartRenderer } from "@dashframe/core";
import type {
  AxisType,
  ChartEncoding,
  VisualizationType,
} from "@dashframe/types";

// ============================================================================
// Types
// ============================================================================

/** Vega-Lite encoding channel definition */
interface VegaLiteChannelDef {
  field?: string;
  type?: string;
  aggregate?: string;
  timeUnit?: string;
  title?: string;
  axis?: Record<string, unknown> | null;
  legend?: Record<string, unknown> | null;
  scale?: Record<string, unknown>;
  format?: string;
  bin?: boolean | Record<string, unknown>;
  value?: unknown;
}

/** Vega-Lite top-level spec (simplified) */
interface VegaLiteSpec {
  $schema: string;
  data: { values: Record<string, unknown>[] };
  mark: string | Record<string, unknown>;
  encoding: Record<string, VegaLiteChannelDef>;
  width?: number | string;
  height?: number | string;
  autosize?: Record<string, unknown>;
  config?: Record<string, unknown>;
  title?: string;
}

// ============================================================================
// Encoding Expression Parsing
// ============================================================================

/** SQL aggregate function pattern: sum(col), avg(col), count(col), etc. */
const AGG_PATTERN = /^(sum|avg|count|min|max|median|mode|first|last)\((.+)\)$/i;

/** count_distinct(col) pattern */
const COUNT_DISTINCT_PATTERN = /^count_distinct\((.+)\)$/i;

/** Legacy vgplot date functions: dateMonth(col), dateDay(col), etc. */
const DATE_FUNC_PATTERN =
  /^(dateMonth|dateDay|dateYear|dateMonthDay)\((.+)\)$/i;

/** DuckDB date_trunc('period', col) pattern — input is bounded encoding strings */
// eslint-disable-next-line sonarjs/slow-regex
const DATE_TRUNC_PATTERN = /^date_trunc\( *'(\w+)' *, *"?([^")]+)"? *\)$/i;

/** DuckDB categorical functions: monthname(col), dayname(col), quarter(col) */
// eslint-disable-next-line sonarjs/slow-regex
const CATEGORICAL_DATE_PATTERN =
  /^(monthname|dayname|quarter)\( *"?([^")]+)"? *\)$/i;

/** Map vgplot date functions to Vega-Lite timeUnit */
const DATE_FUNC_TO_TIME_UNIT: Record<string, string> = {
  datemonth: "month",
  dateday: "day",
  dateyear: "year",
  datemonthday: "monthdate",
};

/** Map date_trunc periods to Vega-Lite timeUnit */
const TRUNC_TO_TIME_UNIT: Record<string, string> = {
  month: "yearmonth",
  week: "yearweek",
  year: "year",
  quarter: "yearquarter",
  day: "yearmonthdate",
};

/**
 * Parse an encoding value (column name or SQL expression) into a
 * Vega-Lite channel definition.
 *
 * Handles:
 * - Plain column names: "revenue" → { field: "revenue" }
 * - SQL aggregates: "sum(revenue)" → { aggregate: "sum", field: "revenue" }
 * - Count distinct: "count_distinct(cat)" → { aggregate: "distinct", field: "cat" }
 * - Date functions: "dateMonth(created)" → { timeUnit: "month", field: "created" }
 * - date_trunc: "date_trunc('month', col)" → { timeUnit: "yearmonth", field: "col" }
 * - Categorical dates: "monthname(col)" → { field: "monthname(col)" } (pre-computed)
 */
function parseEncodingValue(
  value: string,
  axisType?: AxisType,
  data?: Record<string, unknown>[],
): VegaLiteChannelDef {
  // If the value exactly matches a column name in the data, use it directly.
  // This handles cases where the DuckDB view has already computed the expression.
  if (data?.length && data[0] !== undefined && value in data[0]) {
    return {
      field: value,
      type: axisType ?? inferVegaType(data[0][value]),
    };
  }

  // SQL aggregate: sum(col), avg(col), etc.
  const aggMatch = value.match(AGG_PATTERN);
  if (aggMatch) {
    const [, func, col] = aggMatch;
    return {
      aggregate: func.toLowerCase(),
      field: col,
      type: "quantitative",
    };
  }

  // count_distinct(col) → Vega-Lite "distinct" aggregate
  const cdMatch = value.match(COUNT_DISTINCT_PATTERN);
  if (cdMatch) {
    return {
      aggregate: "distinct",
      field: cdMatch[1],
      type: "quantitative",
    };
  }

  // Legacy vgplot date functions: dateMonth(col)
  const dateMatch = value.match(DATE_FUNC_PATTERN);
  if (dateMatch) {
    const [, func, col] = dateMatch;
    return {
      timeUnit: DATE_FUNC_TO_TIME_UNIT[func.toLowerCase()] ?? "month",
      field: col,
      type: "temporal",
    };
  }

  // DuckDB date_trunc('period', col)
  const truncMatch = value.match(DATE_TRUNC_PATTERN);
  if (truncMatch) {
    const [, period, col] = truncMatch;
    return {
      timeUnit: TRUNC_TO_TIME_UNIT[period.toLowerCase()] ?? "yearmonth",
      field: col,
      type: "temporal",
    };
  }

  // Categorical date functions (monthname, dayname, quarter)
  // These produce pre-computed string values, treat as nominal
  const catMatch = value.match(CATEGORICAL_DATE_PATTERN);
  if (catMatch) {
    // The data column is named by the full expression
    return {
      field: value,
      type: "nominal",
    };
  }

  // Plain column reference
  return {
    field: value,
    type: axisType ?? "nominal",
  };
}

/** Infer Vega-Lite type from a sample value */
function inferVegaType(value: unknown): string {
  if (typeof value === "number" || typeof value === "bigint") {
    return "quantitative";
  }
  if (value instanceof Date) return "temporal";
  if (typeof value === "string") {
    // Check if it looks like an ISO date
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return "temporal";
    return "nominal";
  }
  return "nominal";
}

// ============================================================================
// Chart Type Mapping
// ============================================================================

interface MarkConfig {
  mark: string | Record<string, unknown>;
  /** If true, swap x/y in encoding (for horizontal charts) */
  swapAxes?: boolean;
}

/** Map DashFrame visualization types to Vega-Lite mark configs */
function getMarkConfig(type: VisualizationType): MarkConfig {
  switch (type) {
    case "barY":
      return { mark: { type: "bar", cornerRadiusEnd: 4 } };
    case "barX":
      return { mark: { type: "bar", cornerRadiusEnd: 4 }, swapAxes: true };
    case "line":
      return { mark: { type: "line", strokeWidth: 2, point: false } };
    case "areaY":
      return { mark: { type: "area", opacity: 0.7, line: true } };
    case "dot":
      return { mark: { type: "point", filled: true, size: 60 } };
    case "hexbin":
      return { mark: { type: "rect", tooltip: true } };
    case "heatmap":
      return { mark: { type: "rect", opacity: 0.8 } };
    case "raster":
      return { mark: { type: "rect" } };
    default:
      return { mark: "bar" };
  }
}

// ============================================================================
// CSS Theme Integration
// ============================================================================

/** Read chart colors from CSS custom properties */
function getChartColors(): string[] {
  if (typeof document === "undefined") return [];

  const styles = getComputedStyle(document.documentElement);
  return [
    styles.getPropertyValue("--chart-1").trim(),
    styles.getPropertyValue("--chart-2").trim(),
    styles.getPropertyValue("--chart-3").trim(),
    styles.getPropertyValue("--chart-4").trim(),
    styles.getPropertyValue("--chart-5").trim(),
  ].filter(Boolean);
}

/** Convert CSS color to hex using Canvas API */
function cssColorToHex(color: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "#6b7280";

  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** Build Vega-Lite config from CSS theme */
function buildVegaConfig(
  theme?: ChartConfig["theme"],
): Record<string, unknown> {
  const colors = getChartColors().map(cssColorToHex);

  const config: Record<string, unknown> = {
    background: "transparent",
    font: theme?.fontFamily ?? "inherit",
    axis: {
      labelColor: theme?.textColor ?? "var(--color-neutral-fg-subtle)",
      titleColor: theme?.textColor ?? "var(--color-neutral-fg)",
      gridColor: theme?.borderColor ?? "var(--color-border)",
      domainColor: theme?.borderColor ?? "var(--color-border)",
      labelFontSize: theme?.fontSize ?? 11,
      titleFontSize: (theme?.fontSize ?? 11) + 1,
    },
    legend: {
      labelColor: theme?.textColor ?? "var(--color-neutral-fg-subtle)",
      titleColor: theme?.textColor ?? "var(--color-neutral-fg)",
      labelFontSize: theme?.fontSize ?? 11,
    },
    view: {
      stroke: "transparent",
    },
  };

  if (colors.length > 0) {
    config.range = { category: colors };
  }

  return config;
}

// ============================================================================
// Spec Building
// ============================================================================

/** Build an axis channel definition with optional binning and SI formatting */
function buildAxisChannel(
  value: string,
  axisType: AxisType | undefined,
  label: string | undefined,
  data: Record<string, unknown>[],
  isBinType: boolean,
  isMetricAxis: boolean,
): VegaLiteChannelDef {
  const def = parseEncodingValue(value, axisType, data);
  if (label) def.title = label;
  if (isBinType && def.type === "quantitative") {
    def.bin = { maxbins: 30 };
  }
  if (isMetricAxis && def.type === "quantitative") {
    def.axis = { format: "~s", grid: true };
  }
  return def;
}

/** Build color encoding for the spec */
function buildColorEncoding(
  chartEncoding: ChartEncoding,
  data: Record<string, unknown>[],
  isBinType: boolean,
): VegaLiteChannelDef | undefined {
  if (isBinType) {
    return { aggregate: "count", type: "quantitative", title: "Count" };
  }
  if (chartEncoding.color) {
    const colorDef = parseEncodingValue(chartEncoding.color, undefined, data);
    if (chartEncoding.colorLabel) colorDef.title = chartEncoding.colorLabel;
    return colorDef;
  }
  const colors = getChartColors();
  if (colors.length > 0) {
    return { value: cssColorToHex(colors[0]) };
  }
  return undefined;
}

/** Strip axes and legends for preview mode */
function applyPreviewMode(vlEnc: Record<string, VegaLiteChannelDef>) {
  for (const channel of Object.values(vlEnc)) {
    if (channel.field || channel.aggregate) {
      channel.axis = null;
      channel.legend = null;
    }
  }
}

/** Build the full Vega-Lite encoding from ChartEncoding */
function buildVegaLiteEncoding(
  type: VisualizationType,
  config: ChartConfig,
  markConfig: MarkConfig,
): Record<string, VegaLiteChannelDef> {
  const { data, encoding: enc, preview } = config;
  const vlEnc: Record<string, VegaLiteChannelDef> = {};
  const isBinType =
    type === "hexbin" || type === "heatmap" || type === "raster";

  if (enc.x) {
    const xChannel = markConfig.swapAxes ? "y" : "x";
    vlEnc[xChannel] = buildAxisChannel(
      enc.x,
      enc.xType,
      enc.xLabel,
      data,
      isBinType,
      type === "barX",
    );
  }

  if (enc.y) {
    const yChannel = markConfig.swapAxes ? "x" : "y";
    vlEnc[yChannel] = buildAxisChannel(
      enc.y,
      enc.yType,
      enc.yLabel,
      data,
      isBinType,
      type !== "barX",
    );
  }

  const colorDef = buildColorEncoding(enc, data, isBinType);
  if (colorDef) vlEnc.color = colorDef;

  if (enc.size) {
    vlEnc.size = parseEncodingValue(enc.size, undefined, data);
    if (enc.sizeLabel) vlEnc.size.title = enc.sizeLabel;
  }

  if (preview) applyPreviewMode(vlEnc);

  return vlEnc;
}

/**
 * Build a Vega-Lite spec from ChartConfig.
 */
function buildSpec(type: VisualizationType, config: ChartConfig): VegaLiteSpec {
  const { data, preview, theme } = config;
  const markConfig = getMarkConfig(type);
  const vlEncoding = buildVegaLiteEncoding(type, config, markConfig);

  // Build spec
  const spec: VegaLiteSpec = {
    $schema: "https://vega.github.io/schema/vega-lite/v5.json",
    data: { values: data },
    mark: markConfig.mark,
    encoding: vlEncoding,
    config: buildVegaConfig(theme),
  };

  // Sizing
  if (config.width === "container") {
    spec.width = "container";
  } else if (typeof config.width === "number") {
    spec.width = config.width;
  }

  if (config.height === "container") {
    spec.height = "container";
  } else if (typeof config.height === "number") {
    spec.height = config.height;
  }

  spec.autosize = { type: "fit", contains: "padding" };

  // Preview mode: minimal padding
  if (preview) {
    spec.config = {
      ...spec.config,
      padding: 4,
      view: { stroke: "transparent" },
    };
  }

  return spec;
}

// ============================================================================
// Encoding Validation
// ============================================================================

function validateEncoding(encoding: ChartEncoding): string[] {
  const missing: string[] = [];
  if (!encoding.x) missing.push("x");
  if (!encoding.y) missing.push("y");
  return missing;
}

function renderIncompleteEncoding(
  container: HTMLElement,
  missingChannels: string[],
) {
  const channelList = missingChannels.map((c) => c.toUpperCase()).join(" and ");

  const wrapper = document.createElement("div");
  wrapper.style.cssText = `
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; height: 100%; padding: 24px;
    text-align: center; color: var(--color-neutral-fg-subtle, #6b7280);
  `;

  const title = document.createElement("p");
  title.style.cssText = "font-size: 14px; font-weight: 500; margin: 0 0 4px 0;";
  title.textContent = `Select ${channelList} axis`;

  const desc = document.createElement("p");
  desc.style.cssText = "font-size: 12px; opacity: 0.7; margin: 0;";
  desc.textContent = "Configure the encoding to render this chart";

  wrapper.appendChild(title);
  wrapper.appendChild(desc);
  container.appendChild(wrapper);
}

// ============================================================================
// Supported Types
// ============================================================================

export const VEGALITE_SUPPORTED_TYPES: readonly VisualizationType[] = [
  "barY",
  "barX",
  "line",
  "areaY",
  "dot",
  "hexbin",
  "heatmap",
  "raster",
] as const;

// ============================================================================
// Renderer Factory
// ============================================================================

/**
 * Create a Vega-Lite renderer.
 *
 * Unlike the vgplot renderer, this renderer:
 * - Takes no constructor arguments (self-contained, no API context needed)
 * - Expects `config.data` to be populated (Chart component handles data fetching)
 * - Uses vega-embed for rendering (dynamically imported for code splitting)
 *
 * @example
 * ```typescript
 * import { registerRenderer } from "@dashframe/visualization";
 * import { createVegaLiteRenderer } from "@dashframe/visualization/renderers";
 *
 * registerRenderer(createVegaLiteRenderer());
 * ```
 */
export function createVegaLiteRenderer(): ChartRenderer {
  // Cache the vega-embed import
  let embedPromise: Promise<typeof import("vega-embed")> | null = null;

  function getEmbed() {
    if (!embedPromise) {
      embedPromise = import("vega-embed");
    }
    return embedPromise;
  }

  return {
    supportedTypes: VEGALITE_SUPPORTED_TYPES,

    render(
      container: HTMLElement,
      type: VisualizationType,
      config: ChartConfig,
    ): ChartCleanup {
      // Validate encoding
      const missingChannels = validateEncoding(config.encoding);
      if (missingChannels.length > 0) {
        renderIncompleteEncoding(container, missingChannels);
        return () => {
          container.replaceChildren();
        };
      }

      // No data yet — nothing to render
      if (!config.data || config.data.length === 0) {
        return () => {};
      }

      // Build and render spec
      let disposed = false;
      let vegaView: { finalize: () => void } | null = null;

      const spec = buildSpec(type, config);

      getEmbed()
        .then(({ default: vegaEmbed }) => {
          if (disposed) return;

          return vegaEmbed(container, spec as never, {
            actions: false,
            renderer: "svg",
            // Disable hover for preview mode (performance)
            hover: !config.preview,
          });
        })
        .then((result) => {
          if (disposed) {
            result?.view.finalize();
            return;
          }
          vegaView = result?.view ?? null;
        })
        .catch((err) => {
          if (disposed) return;
          console.error("[VegaLiteRenderer] Render error:", err);
          const errDiv = document.createElement("div");
          errDiv.style.cssText =
            "color: red; padding: 16px; text-align: center; font-size: 12px;";
          errDiv.textContent = `Failed to render chart: ${err instanceof Error ? err.message : "Unknown error"}`;
          container.replaceChildren(errDiv);
        });

      return () => {
        disposed = true;
        if (vegaView) {
          vegaView.finalize();
          vegaView = null;
        }
        container.replaceChildren();
      };
    },
  };
}
