/**
 * VgplotRenderer
 *
 * ChartRenderer implementation using Mosaic vgplot for standard chart types.
 * Supports bar, line, area, and scatter charts with DuckDB query pushdown.
 *
 * ## Supported Chart Types
 * - bar: Vertical bar charts (vgplot barY)
 * - line: Line charts (vgplot lineY)
 * - area: Area charts (vgplot areaY)
 * - scatter: Scatter/dot plots (vgplot dot)
 *
 * ## Data Flow
 * ```
 * ChartConfig.tableName ──► vgplot from() ──► Mosaic SQL ──► DuckDB ──► SVG
 * ```
 *
 * @example
 * ```typescript
 * import { registerRenderer } from "@dashframe/visualization";
 * import { createVgplotRenderer } from "@dashframe/visualization/renderers";
 *
 * const { api } = useVisualization();
 * if (api) {
 *   registerRenderer(createVgplotRenderer(api));
 * }
 * ```
 */

import type { RenderFunction } from "@observablehq/plot";
import "./chart-styles.css";
import { quoteIdentifier } from "@dashframe/engine";
import type { ChartEncoding, VisualizationType } from "@dashframe/types";
import type {
  ChartCleanup,
  ChartConfig,
  ChartRenderer,
} from "../chart-renderers";

/**
 * vgplot API type from dynamic import.
 */
type VgplotAPI = ReturnType<typeof import("@uwdata/vgplot").createAPIContext>;

/**
 * Extended vgplot API with coordinator access (not in public types).
 * The coordinator provides direct DuckDB query access for data inspection.
 *
 * Note: The coordinator is at api.context.coordinator (not api.coordinator)
 * as set up by createAPIContext({ coordinator }).
 */
interface VgplotAPIExtended extends VgplotAPI {
  context?: {
    coordinator?: {
      query: (
        sql: string,
        options?: { type?: string; cache?: boolean },
      ) => Promise<unknown>;
    };
  };
  /**
   * vgplot's `colorDomain` is a directive factory — same shape as `colorRange`:
   * it returns a plot directive that must be passed into `api.plot(...directives)`
   * for the domain to take effect. It does not mutate anything by itself.
   */
  colorDomain?: (domain: unknown[]) => unknown;
}

// ============================================================================
// Color Conversion Utilities
// ============================================================================

/**
 * Convert any CSS color to hex format using Canvas API.
 * This works for lab, oklch, rgb, hsl, named colors, etc.
 *
 * @param color - CSS color string (e.g., "lab(57 64 89)", "oklch(0.6 0.2 41)", "steelblue")
 * @returns Hex color string (e.g., "#e97838") or fallback color
 */
function colorToHex(color: string): string {
  // Create a canvas to use browser's color parsing
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d");

  if (!ctx) return "#6b7280"; // Fallback to gray-500

  // Set the color and draw a pixel
  ctx.fillStyle = color;

  ctx.fillRect(0, 0, 1, 1);

  // Get the pixel data (RGBA)
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;

  // Convert to hex
  return `#${[r, g, b].map((x) => (x ?? 0).toString(16).padStart(2, "0")).join("")}`;
}

// ============================================================================
// Aggregation Expression Parsing
// ============================================================================

/**
 * Supported SQL function patterns.
 * - Aggregates: sum, avg, count, min, max, median, mode, first, last
 * - Date binning (legacy vgplot functions): dateMonth, dateDay, dateYear, dateMonthDay
 *
 * Note: New date transforms use DuckDB's date_trunc() which is passed through as-is.
 */
const SQL_FUNCTION_PATTERN =
  /^(sum|avg|count|min|max|median|mode|first|last|dateMonth|dateDay|dateYear|dateMonthDay)\((.+)\)$/i;

/**
 * Pattern for count_distinct(column) - handled specially via count(col).distinct()
 */
const COUNT_DISTINCT_PATTERN = /^count_distinct\((.+)\)$/i;

/**
 * Pattern for DuckDB date_trunc function.
 * Format: date_trunc('period', "column") or date_trunc('period', column)
 * These are passed through to DuckDB without vgplot transformation.
 */
const DATE_TRUNC_PATTERN = /^date_trunc\([^)]+\)$/i;

/**
 * Pattern for DuckDB categorical date functions.
 * Format: monthname("column"), dayname("column"), quarter("column")
 */
const CATEGORICAL_DATE_PATTERN = /^(monthname|dayname|quarter)\([^)]+\)$/i;

/**
 * AggregateNode type with distinct() method for count distinct support.
 */
interface AggregateNode {
  distinct: () => unknown;
}

/**
 * Parse an encoding value and convert SQL expressions to vgplot API calls.
 * Converts strings like "sum(contractpeak)" to api.sum("contractpeak")
 * and "dateMonth(created)" to api.dateMonth("created").
 *
 * Special handling:
 * - "count_distinct(column)" → api.count("column").distinct()
 * - "date_trunc('period', column)" → passed through as SQL (DuckDB expression)
 * - "monthname(column)", "dayname(column)", "quarter(column)" → passed through as SQL
 *
 * @param api - vgplot API instance
 * @param value - Encoding value (string or undefined)
 * @returns Converted value (API call for SQL functions, original string for columns)
 */
function parseEncodingValue(
  api: VgplotAPI,
  value: string | undefined,
): unknown {
  if (!value) return undefined;

  // Special case: count_distinct(column) → count(column).distinct()
  const countDistinctMatch = value.match(COUNT_DISTINCT_PATTERN);
  if (countDistinctMatch) {
    const [, columnName] = countDistinctMatch;
    // Mosaic uses count(col).distinct() for COUNT(DISTINCT col)
    const countResult = api.count(columnName) as AggregateNode;
    if (countResult && typeof countResult.distinct === "function") {
      return countResult.distinct();
    }
    // Fallback: return regular count if .distinct() not available
    return api.count(columnName);
  }

  // DuckDB date_trunc expressions are passed through as-is
  // These are SQL expressions that get executed by DuckDB before vgplot sees the data
  if (DATE_TRUNC_PATTERN.test(value)) {
    // For vgplot/Mosaic, we use api.sql() to pass raw SQL expressions
    // This tells Mosaic to use the expression directly in the query
    return api.sql`${value}`;
  }

  // DuckDB categorical date functions (monthname, dayname, quarter)
  // Also passed through as SQL expressions
  if (CATEGORICAL_DATE_PATTERN.test(value)) {
    return api.sql`${value}`;
  }

  // Check if this is a SQL function expression like "sum(column)" or "dateMonth(column)"
  const match = value.match(SQL_FUNCTION_PATTERN);
  if (match) {
    const [, funcName, columnName] = match;
    if (funcName && columnName) {
      // vgplot API uses camelCase (dateMonth, not datemonth)
      const apiFunc = funcName as keyof VgplotAPI;

      // Call the appropriate vgplot function
      if (typeof api[apiFunc] === "function") {
        return (api[apiFunc] as (col: string) => unknown)(columnName);
      }
    }
  }

  // Return as-is (plain column reference)
  return value;
}

// ============================================================================
// Mark Building
// ============================================================================

/**
 * Plot's bar width is the categorical scale bandwidth, not a mark `width`.
 * Its synchronous render transform lets us inset each band before Plot draws
 * it, using the current layout on every render (including resize).
 */
type BarRenderState = {
  insetLeft: number;
  insetRight: number;
  insetTop: number;
  insetBottom: number;
  rx1y1: number;
  rx1y2: number;
  rx2y1: number;
  rx2y2: number;
};

function roundBarEnd(
  mark: BarRenderState,
  isHorizontal: boolean,
  reverse: boolean,
) {
  mark.rx1y1 = reverse ? 3 : 0;
  mark.rx1y2 = isHorizontal === reverse ? 3 : 0;
  mark.rx2y1 = isHorizontal !== reverse ? 3 : 0;
  mark.rx2y2 = reverse ? 0 : 3;
}

function renderRoundedBars(
  mark: BarRenderState,
  isHorizontal: boolean,
  ...[
    index,
    scales,
    values,
    dimensions,
    context,
    next,
  ]: Parameters<RenderFunction>
) {
  if (!next) return null;
  const start = values[isHorizontal ? "x1" : "y1"];
  const end = values[isHorizontal ? "x2" : "y2"];
  if (!start || !end) return next(index, scales, values, dimensions, context);
  const towardsStart = index.filter((i) => end[i] < start[i]);
  const towardsEnd = index.filter((i) => end[i] >= start[i]);
  const group = context.document.createElementNS(
    "http://www.w3.org/2000/svg",
    "g",
  );
  for (const [indices, reverse] of [
    [towardsStart, true],
    [towardsEnd, false],
  ] as const) {
    if (!indices.length) continue;
    roundBarEnd(mark, isHorizontal, reverse);
    const node = next(indices, scales, values, dimensions, context);
    if (node) group.appendChild(node);
  }
  return group;
}

function barRenderTransform(
  isHorizontal: boolean,
  isStacked: boolean,
): RenderFunction {
  return function (this: BarRenderState, ...args) {
    const [index, scales, values, dimensions, context, next] = args;
    if (!next) return null;
    const scale = scales[isHorizontal ? "y" : "x"];
    if (
      !scale ||
      !("bandwidth" in scale) ||
      typeof scale.bandwidth !== "function"
    ) {
      return next(index, scales, values, dimensions, context);
    }
    const bandwidth = Number(scale.bandwidth());
    // Preserve a gap in dense charts and cap sparse charts at 48px.
    const inset = (bandwidth - Math.min(48, bandwidth * 0.8)) / 2;
    const previous = {
      insetLeft: this.insetLeft,
      insetRight: this.insetRight,
      insetTop: this.insetTop,
      insetBottom: this.insetBottom,
      rx1y1: this.rx1y1,
      rx1y2: this.rx1y2,
      rx2y1: this.rx2y1,
      rx2y2: this.rx2y2,
    };
    if (isHorizontal) this.insetTop = this.insetBottom = inset;
    else this.insetLeft = this.insetRight = inset;
    try {
      // Stack joints remain square and contiguous. For a single series, round
      // only the value end; screen direction reverses for negative values.
      return isStacked
        ? next(index, scales, values, dimensions, context)
        : renderRoundedBars(this, isHorizontal, ...args);
    } finally {
      Object.assign(this, previous);
    }
  };
}

function barCategorySort(chartType: "barY" | "barX", encoding: ChartEncoding) {
  // Non-temporal insight results are materialized in their requested sort
  // order. Preserve the category channel's first-seen order instead of
  // letting Plot infer an alphabetical ordinal domain. Transformed temporal
  // categories retain Plot's chronological domain inference.
  const categoryTransform =
    chartType === "barX" ? encoding.yTransform : encoding.xTransform;
  const isTemporal = categoryTransform?.transform.kind === "temporal";
  if (chartType === "barX") return isTemporal ? {} : { sort: { y: null } };
  return isTemporal ? {} : { sort: { x: null } };
}

/**
 * Build encoding options for vgplot marks.
 * Parses aggregation expressions and converts them to vgplot API calls.
 */
function buildEncodingOptions(
  api: VgplotAPI,
  encoding: ChartEncoding,
  chartType?: VisualizationType,
  theme?: ChartConfig["theme"],
) {
  const options: Record<string, unknown> = {};

  if (encoding.x) options.x = parseEncodingValue(api, encoding.x);
  if (encoding.y) options.y = parseEncodingValue(api, encoding.y);

  // Color encoding - line charts use stroke, others use fill
  const isLineChart = chartType === "line";
  const colorProperty = isLineChart ? "stroke" : "fill";

  if (encoding.color) {
    const color = parseEncodingValue(api, encoding.color);
    options[colorProperty] = color;
    // Observable Plot groups connected marks by z, not by stroke. Without an
    // explicit series channel, differently colored rows at the same x value
    // are still joined into one path, producing vertical jumps between series.
    if (isLineChart && !isExpressionBoundColor(encoding.color)) {
      options.z = color;
    }
  } else {
    options[colorProperty] = theme?.accentColor
      ? colorToHex(theme.accentColor)
      : "var(--dashframe-chart-accent)";
  }

  // Line chart styling
  if (isLineChart) {
    options.strokeWidth = 2; // Reasonable line thickness
  }

  if (encoding.size) options.r = parseEncodingValue(api, encoding.size);

  // Bar chart styling (both vertical and horizontal)
  if (chartType === "barY" || chartType === "barX") {
    const isHorizontal = chartType === "barX";
    Object.assign(options, barCategorySort(chartType, encoding));
    options.render = barRenderTransform(isHorizontal, !!encoding.color);
  }

  return options;
}

/**
 * Get chart colors from CSS variables and convert to hex.
 */
function getChartColors(container: HTMLElement): string[] {
  const styles = getComputedStyle(document.documentElement);
  const rawColors = [
    styles.getPropertyValue("--chart-1").trim(),
    styles.getPropertyValue("--chart-2").trim(),
    styles.getPropertyValue("--chart-3").trim(),
    styles.getPropertyValue("--chart-4").trim(),
    styles.getPropertyValue("--chart-5").trim(),
  ].filter(Boolean);

  if (rawColors.length > 0) {
    // Continuous color scales need a concrete color to interpolate. Resolve the
    // same scoped token used by single-series marks before handing it to Plot.
    const swatch = document.createElement("span");
    swatch.className = "dashframe-chart";
    swatch.hidden = true;
    swatch.style.color = "var(--dashframe-chart-accent)";
    container.appendChild(swatch);
    try {
      const computed = getComputedStyle(swatch);
      if (computed.getPropertyValue("--dashframe-chart-accent").trim()) {
        rawColors[0] = computed.color;
      }
    } finally {
      swatch.remove();
    }
  }
  return rawColors.map(colorToHex);
}

/**
 * Build sizing options for the plot.
 */
const COLOR_LEGEND_HEIGHT = 36;

function hasColorLegend(type: VisualizationType, config: ChartConfig): boolean {
  return (
    !config.preview &&
    !!config.encoding.color &&
    ["barY", "barX", "line", "areaY", "dot"].includes(type)
  );
}

function buildSizingOptions(
  api: VgplotAPI,
  config: ChartConfig,
  legend: boolean,
): unknown[] {
  const options: unknown[] = [];

  if (config.width === "container") {
    options.push(api.width("container"));
  } else if (typeof config.width === "number") {
    options.push(api.width(config.width));
  }

  if (config.height === "container") {
    options.push(api.height("container"));
  } else if (typeof config.height === "number") {
    options.push(
      api.height(
        Math.max(1, config.height - (legend ? COLOR_LEGEND_HEIGHT : 0)),
      ),
    );
  }

  return options;
}

/**
 * Build preview axis options (minimal for preview mode)
 */
function buildPreviewAxisOptions(
  api: VgplotAPI,
  chartType: VisualizationType,
  encoding?: ChartEncoding,
): unknown[] {
  const previewOptions: unknown[] = [api.axis(null), api.margin(4)];

  if (chartType === "barY" && encoding?.xTransform) {
    previewOptions.push(api.xScale("band"));
  }
  if (chartType === "barX" && encoding?.yTransform) {
    previewOptions.push(api.yScale("band"));
  }

  return previewOptions;
}

/**
 * Build metric axis options (SI notation and grid)
 */
function buildMetricAxisOptions(
  api: VgplotAPI,
  chartType: VisualizationType,
  config: ChartConfig,
): unknown[] {
  const options: unknown[] = [];
  const extent = chartType === "barX" ? config.width : config.height;
  const pixelsPerTick = chartType === "barX" ? 100 : 70;
  const ticks =
    typeof extent === "number"
      ? Math.max(2, Math.min(4, Math.floor((extent - 72) / pixelsPerTick)))
      : 4;
  // Apply SI notation formatting to the metric axis
  // For horizontal bar charts, the metric (value) is on the X-axis
  // For vertical bar/line/area charts, the metric is on the Y-axis
  if (chartType === "barX") {
    options.push(api.xTickFormat("~s"));
    options.push(api.xGrid(true), api.xTicks(ticks), api.xZero(true));
  } else {
    options.push(api.yTickFormat("~s"));
    options.push(api.yGrid(true), api.yTicks(ticks));
    if (chartType === "barY") options.push(api.yZero(true));
  }
  return options;
}

/**
 * Build scale options for temporal bar charts
 */
function buildScaleOptions(
  api: VgplotAPI,
  chartType: VisualizationType,
  encoding?: ChartEncoding,
): unknown[] {
  const options: unknown[] = [];
  // For bar charts with pre-aggregated temporal data, explicitly use band scale
  // This suppresses vgplot warning about dates with bar marks and treats
  // date_trunc'd values (e.g., "2020-01-01") as discrete categories
  if (chartType === "barY" && encoding?.xTransform) {
    options.push(api.xScale("band"));
  }
  if (chartType === "barX" && encoding?.yTransform) {
    options.push(api.yScale("band"));
  }
  return options;
}

/**
 * Build label options from encoding
 */
function buildLabelOptions(
  api: VgplotAPI,
  encoding?: ChartEncoding,
): unknown[] {
  const options: unknown[] = [];
  // Apply human-readable axis labels when provided
  // These override the UUID column names in the chart display
  if (encoding?.xLabel) {
    options.push(api.xLabel(encoding.xLabel));
  }
  if (encoding?.yLabel) {
    options.push(api.yLabel(encoding.yLabel));
  }
  if (encoding?.colorLabel) {
    options.push(api.colorLabel(encoding.colorLabel));
  }
  return options;
}

/**
 * Build margin and axis options for the plot.
 * Applies SI notation formatting to the metric axis (Y for vertical, X for horizontal).
 * Uses human-readable axis labels from encoding when available.
 */
function buildAxisOptions(
  api: VgplotAPI,
  isPreview: boolean,
  chartType: VisualizationType,
  config: ChartConfig,
): unknown[] {
  const encoding = config.encoding;
  if (isPreview) {
    return buildPreviewAxisOptions(api, chartType, encoding);
  }

  const options: unknown[] = [
    api.marginRight(20),
    api.marginTop(24),
    api.marginBottom(48),
    api.marginLeft(56),
    api.xLabelArrow(false),
    api.yLabelArrow(false),
    api.xTickSize(0),
    api.yTickSize(0),
    ...buildMetricAxisOptions(api, chartType, config),
    ...buildScaleOptions(api, chartType, encoding),
    ...buildLabelOptions(api, encoding),
  ];

  return options;
}

/**
 * True when the color channel is bound to a SQL aggregation/expression
 * (e.g. `sum(amount)`) rather than a plain column name. Domain queries quote
 * the value as one identifier, which DuckDB rejects for expressions.
 */
export function isExpressionBoundColor(color: string): boolean {
  return (
    COUNT_DISTINCT_PATTERN.test(color) ||
    DATE_TRUNC_PATTERN.test(color) ||
    CATEGORICAL_DATE_PATTERN.test(color) ||
    SQL_FUNCTION_PATTERN.test(color)
  );
}

/**
 * Resolve a color-domain plot directive for stacked bar charts.
 *
 * Queries distinct values for a plain color column and returns the directive
 * produced by `api.colorDomain(domain)`. Callers must push the result into the
 * options passed to `api.plot(...)` — the factory alone does not apply the domain.
 *
 * Metric/expression-bound color channels skip the query (returns undefined;
 * colors stay unordered). Query failures are logged and return undefined so
 * the chart still renders without a domain.
 *
 * Identifier quoting: both the color column and tableName are passed through
 * `quoteIdentifier` as single identifiers. That matches plain table names, but
 * diverges from `api.from(tableName)` for schema-qualified names (e.g.
 * `schema.table`): the domain query treats the whole string as one identifier
 * (`"schema.table"`), while Mosaic's `from()` splits schema and table
 * structurally. Pin the single-identifier behavior until a coordinated
 * redesign; do not "fix" one side without the other.
 */
export async function setupColorDomain(
  api: VgplotAPIExtended,
  colorColumn: string,
  tableName: string,
): Promise<unknown | undefined> {
  // Aggregation/expression-bound color: skip domain query entirely.
  if (isExpressionBoundColor(colorColumn)) {
    return undefined;
  }

  const coordinator = api.context?.coordinator;
  if (!coordinator?.query || !api.colorDomain) return undefined;

  try {
    // Single-identifier quoting for tableName (see function doc): schema-qualified
    // names are quoted as one identifier, not split into schema.table.
    const result = await coordinator.query(
      `SELECT DISTINCT ${quoteIdentifier(colorColumn)} as val FROM ${quoteIdentifier(tableName)} ORDER BY ${quoteIdentifier(colorColumn)}`,
      { type: "json" },
    );

    if (!Array.isArray(result)) return undefined;

    // Keep the value's own type: the plot's color channel carries raw column
    // values, so a string domain would not match a numeric color column and the
    // palette mapping would silently fall through. BigInt (DuckDB's integer
    // JSON representation) is narrowed to number for the same reason.
    //
    // Past Number.MAX_SAFE_INTEGER that narrowing is lossy, and distinct
    // categories can collapse onto one another — an explicit domain that is
    // silently wrong. Bail out instead and let vgplot pick its own palette: a
    // missing ordering is recoverable, a wrong colour-to-value mapping is not.
    const domain: unknown[] = [];
    for (const row of result) {
      const value = (row as { val: unknown }).val;
      if (typeof value !== "bigint") {
        domain.push(value);
        continue;
      }
      const narrowed = Number(value);
      if (!Number.isSafeInteger(narrowed)) return undefined;
      domain.push(narrowed);
    }

    if (domain.length === 0) return undefined;

    // Return the directive — caller must pass it to api.plot(...).
    return api.colorDomain(domain);
  } catch (e: unknown) {
    console.warn("[VgplotRenderer] Could not set color domain:", e);
    return undefined;
  }
}

// ============================================================================
// Encoding Validation
// ============================================================================

/**
 * Validation result for chart encoding.
 */
interface EncodingValidation {
  valid: boolean;
  missingChannels: string[];
}

/**
 * Validate that required encoding channels are present for a chart type.
 * All vgplot marks require at least x and y channels.
 *
 * @param encoding - The chart encoding to validate
 * @param _chartType - The visualization type (unused, all types require x/y)
 * @returns Validation result with missing channel names
 */
function validateEncoding(
  encoding: ChartEncoding,
  _chartType: VisualizationType,
): EncodingValidation {
  const missingChannels: string[] = [];

  // All supported chart types require both x and y
  if (!encoding.x) {
    missingChannels.push("x");
  }
  if (!encoding.y) {
    missingChannels.push("y");
  }

  return {
    valid: missingChannels.length === 0,
    missingChannels,
  };
}

/**
 * Render an "incomplete encoding" message in the container using safe DOM methods.
 */
function renderIncompleteEncoding(
  container: HTMLElement,
  missingChannels: string[],
): void {
  // Clear container safely
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  const channelList = missingChannels.map((c) => c.toUpperCase()).join(" and ");

  // Create wrapper div
  const wrapper = document.createElement("div");
  wrapper.style.cssText = `
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 24px;
    text-align: center;
    color: var(--muted-foreground, #6b7280);
  `;

  // Create SVG icon
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.style.cssText =
    "width: 48px; height: 48px; margin-bottom: 12px; opacity: 0.5;";

  const path1 = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path1.setAttribute("d", "M3 3v18h18");
  path1.setAttribute("stroke-linecap", "round");
  path1.setAttribute("stroke-linejoin", "round");

  const path2 = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path2.setAttribute("d", "M18.7 8l-5.1 5.2-2.8-2.7L7 14.3");
  path2.setAttribute("stroke-linecap", "round");
  path2.setAttribute("stroke-linejoin", "round");

  svg.appendChild(path1);
  svg.appendChild(path2);

  // Create title text
  const title = document.createElement("p");
  title.style.cssText = "font-size: 14px; font-weight: 500; margin: 0 0 4px 0;";
  title.textContent = `Select ${channelList} axis`;

  // Create description text
  const desc = document.createElement("p");
  desc.style.cssText = "font-size: 12px; opacity: 0.7; margin: 0;";
  desc.textContent = "Configure the encoding to render this chart";

  wrapper.appendChild(svg);
  wrapper.appendChild(title);
  wrapper.appendChild(desc);
  container.appendChild(wrapper);
}

// ============================================================================
// Mark Building
// ============================================================================

/**
 * Build a vgplot mark for the given chart type.
 *
 * Note on temporal bar charts:
 * Our data is pre-aggregated via SQL (date_trunc), so X values are already
 * discrete dates (e.g., Jan 1 2020, Jan 1 2021). We use regular barY which
 * treats these as categorical values with band scale. This is simpler and
 * avoids the complexity of rectY+interval which expects raw unaggregated dates.
 */
function buildMark(
  api: VgplotAPI,
  type: VisualizationType,
  tableName: string,
  encoding: ChartEncoding,
  theme?: ChartConfig["theme"],
) {
  const source = api.from(tableName);
  const options = buildEncodingOptions(api, encoding, type, theme);

  switch (type) {
    case "barY":
      return api.barY(source, options);
    case "barX":
      return api.barX(source, options);
    case "line":
      return api.lineY(source, options);
    case "areaY":
      return api.areaY(source, options);
    case "dot":
      return api.dot(source, options);
    case "hexbin":
      // Hexagonal binning - aggregates points into hex cells
      // Color intensity shows point density (count per cell)
      return api.hexbin(source, {
        ...options,
        binWidth: 20, // Hex cell size in pixels
        fill: api.count(), // Color by density
      });
    case "heatmap":
      // Density heatmap - smooth color gradient
      // Uses kernel density estimation with linear interpolation
      return api.heatmap(source, {
        ...options,
        fill: "density",
        bandwidth: 20, // Smoothing kernel size
        pixelSize: 2, // Grid resolution
      });
    case "raster":
      // Pixel-based aggregation - fastest for huge datasets
      // Each pixel shows aggregate value for that region
      return api.raster(source, {
        ...options,
        fill: "density",
        pixelSize: 1, // 1:1 pixel mapping
      });
    default:
      throw new Error(`Unsupported chart type: ${type}`);
  }
}

// ============================================================================
// Renderer Factory
// ============================================================================

/**
 * Create a VgplotRenderer with the given vgplot API.
 *
 * The renderer must be created with an API instance from VisualizationProvider.
 * This ensures charts are connected to the Mosaic coordinator and DuckDB.
 *
 * @param api - vgplot API from useVisualization()
 * @returns ChartRenderer implementation
 *
 * @example
 * ```typescript
 * function ChartSetup() {
 *   const { api, isReady } = useVisualization();
 *
 *   useEffect(() => {
 *     if (isReady && api) {
 *       registerRenderer(createVgplotRenderer(api));
 *     }
 *   }, [api, isReady]);
 *
 *   return null;
 * }
 * ```
 */
export function createVgplotRenderer(api: VgplotAPI): ChartRenderer {
  const extendedApi = api as VgplotAPIExtended;

  return {
    supportedTypes: [
      "barY",
      "barX",
      "line",
      "areaY",
      "dot",
      "hexbin",
      "heatmap",
      "raster",
    ] as const,

    render(
      container: HTMLElement,
      type: VisualizationType,
      config: ChartConfig,
    ): ChartCleanup {
      // Validate encoding has required channels before attempting to render
      const validation = validateEncoding(config.encoding, type);
      if (!validation.valid) {
        renderIncompleteEncoding(container, validation.missingChannels);
        return () => {
          while (container.firstChild) {
            container.removeChild(container.firstChild);
          }
        };
      }

      let cancelled = false;

      const showRenderError = (error: unknown) => {
        console.error("[VgplotRenderer] Error rendering chart:", error);

        const message =
          error instanceof Error ? error.message : "Unknown error";
        container.replaceChildren();
        const errDiv = document.createElement("div");
        errDiv.style.cssText =
          "color: red; padding: 16px; text-align: center; font-size: 12px;";
        errDiv.textContent = `Failed to render chart: ${message}`;
        container.appendChild(errDiv);
      };

      const mountPlot = (plotOptions: unknown[]) => {
        if (cancelled) return;

        // Theme background
        if (config.theme?.backgroundColor) {
          container.style.backgroundColor = config.theme.backgroundColor;
        }

        // Create and mount the plot
        const plot = api.plot(...plotOptions);
        plot.classList.add("dashframe-chart");
        if (hasColorLegend(type, config)) {
          plot.classList.add("dashframe-chart-with-legend");
        }
        if (config.theme?.borderColor) {
          plot.style.setProperty(
            "--dashframe-chart-grid",
            config.theme.borderColor,
          );
        }
        container.appendChild(plot);
      };

      try {
        // Build plot options
        const mark = buildMark(
          api,
          type,
          config.tableName,
          config.encoding,
          config.theme,
        );
        const chartColors = getChartColors(container);
        const legend = hasColorLegend(type, config);

        const plotOptions: unknown[] = [
          mark,
          api.style({
            fontFamily: config.theme?.fontFamily ?? "inherit",
            fontSize: `${config.theme?.fontSize ?? 12}px`,
            color: config.theme?.textColor ?? "var(--neutral-fg-subtle)",
            background: config.theme?.backgroundColor ?? "transparent",
          }),
          ...buildSizingOptions(api, config, legend),
          ...buildAxisOptions(api, !!config.preview, type, config),
        ];

        if (legend) {
          plotOptions.push(
            api.colorLegend({
              swatchSize: 10,
              style: {
                fontFamily: config.theme?.fontFamily ?? "inherit",
                fontSize: `${config.theme?.fontSize ?? 12}px`,
                color: config.theme?.textColor ?? "var(--neutral-fg-subtle)",
                flexWrap: "nowrap",
                whiteSpace: "nowrap",
                minHeight: "24px",
                marginBottom: "0",
              },
            }),
          );
        }

        // Apply color scheme
        if (chartColors.length > 0) {
          plotOptions.push(api.colorRange(chartColors));
        }

        // Color domain for stacked bar charts: resolve BEFORE api.plot so the
        // directive is included in plot options (mirrors colorRange above).
        const colorColumn = config.encoding?.color;
        const needsColorDomain =
          type === "barY" &&
          !!colorColumn &&
          chartColors.length > 0 &&
          !isExpressionBoundColor(colorColumn);

        if (needsColorDomain && colorColumn) {
          // Async path: await DISTINCT domain query, then mount with directive.
          void (async () => {
            try {
              const colorDomainDirective = await setupColorDomain(
                extendedApi,
                colorColumn,
                config.tableName,
              );
              if (cancelled) return;
              if (colorDomainDirective !== undefined) {
                plotOptions.push(colorDomainDirective);
              }
              mountPlot(plotOptions);
            } catch (error) {
              if (!cancelled) showRenderError(error);
            }
          })();
        } else {
          // Sync path: no domain query needed (or expression-bound color).
          mountPlot(plotOptions);
        }

        return () => {
          cancelled = true;
          container.innerHTML = "";
        };
      } catch (error) {
        showRenderError(error);

        return () => {
          container.replaceChildren();
        };
      }
    },
  };
}

// ============================================================================
// Supported Types Export
// ============================================================================

/**
 * Chart types supported by VgplotRenderer.
 */
export const VGPLOT_SUPPORTED_TYPES: readonly VisualizationType[] = [
  "barY",
  "barX",
  "line",
  "areaY",
  "dot",
  "hexbin",
  "heatmap",
  "raster",
] as const;
