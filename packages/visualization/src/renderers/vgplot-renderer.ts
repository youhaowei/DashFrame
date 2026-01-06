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

import type { ChartCleanup, ChartConfig, ChartRenderer } from "@dashframe/core";
import type { ChartEncoding, VisualizationType } from "@dashframe/types";

/**
 * vgplot API type from dynamic import.
 */
type VgplotAPI = ReturnType<typeof import("@uwdata/vgplot").createAPIContext>;

/**
 * Extended vgplot API with coordinator access (not in public types).
 * The coordinator provides direct DuckDB query access for data inspection.
 */
interface VgplotAPIExtended extends VgplotAPI {
  coordinator?: {
    query: (sql: string) => Promise<{ toArray: () => { val: unknown }[] }>;
  };
  colorDomain?: (domain: string[]) => void;
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

  // Check if color was successfully set (invalid colors result in black or unchanged)
  const appliedColor = ctx.fillStyle;
  if (appliedColor === "#000000" || appliedColor === "#000") {
    console.warn(`[colorToHex] Color conversion failed for: "${color}"`);
    return "#64748b"; // Fallback to slate-500
  }

  ctx.fillRect(0, 0, 1, 1);

  // Get the pixel data (RGBA)
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;

  // Convert to hex
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
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
    // vgplot API uses camelCase (dateMonth, not datemonth)
    const apiFunc = funcName as keyof VgplotAPI;

    // Call the appropriate vgplot function
    if (typeof api[apiFunc] === "function") {
      return (api[apiFunc] as (col: string) => unknown)(columnName);
    }
  }

  // Return as-is (plain column reference)
  return value;
}

// ============================================================================
// Mark Building
// ============================================================================

/**
 * Get the default fill color from CSS variables.
 */
function getDefaultFillColor(): string | undefined {
  const styles = getComputedStyle(document.documentElement);
  const chart1Color = styles.getPropertyValue("--chart-1").trim();
  return chart1Color ? colorToHex(chart1Color) : undefined;
}

/**
 * Get bar chart styling options (width, padding, rounded corners).
 *
 * @param isStacked - Whether the chart has color encoding (stacked bars)
 * @param isHorizontal - Whether this is a horizontal bar chart
 */
function getBarChartOptions(
  isStacked: boolean,
  isHorizontal: boolean,
): Record<string, unknown> {
  const options: Record<string, unknown> = {
    width: 0.6, // Bar width as fraction of band (60% of available space)
    padding: 0.2, // Padding between bars (20% of band)
  };

  // Read border radius from CSS variable to match app theme
  const styles = getComputedStyle(document.documentElement);
  const radiusValue = styles.getPropertyValue("--radius").trim();
  if (radiusValue) {
    // Parse rem value (e.g., "0.625rem" → 10px at 16px base)
    const radiusInPx = parseFloat(radiusValue) * 16 * 0.6;

    if (!isStacked) {
      // Round only the outer end of the bar (where the value terminates)
      // - Vertical bars (barY): round top corners (ry1)
      // - Horizontal bars (barX): round right corners (rx2)
      if (isHorizontal) {
        options.rx2 = radiusInPx;
      } else {
        options.ry1 = radiusInPx;
      }
    } else {
      options.rx = radiusInPx; // Round all corners
      options.ry = radiusInPx;
    }
  }

  return options;
}

/**
 * Build encoding options for vgplot marks.
 * Parses aggregation expressions and converts them to vgplot API calls.
 */
function buildEncodingOptions(
  api: VgplotAPI,
  encoding: ChartEncoding,
  chartType?: VisualizationType,
) {
  const options: Record<string, unknown> = {};

  if (encoding.x) options.x = parseEncodingValue(api, encoding.x);
  if (encoding.y) options.y = parseEncodingValue(api, encoding.y);

  // Color encoding - line charts use stroke, others use fill
  const isLineChart = chartType === "line";
  const colorProperty = isLineChart ? "stroke" : "fill";

  if (encoding.color) {
    options[colorProperty] = parseEncodingValue(api, encoding.color);
  } else {
    const defaultColor = getDefaultFillColor();
    if (defaultColor) options[colorProperty] = defaultColor;
  }

  // Line chart styling
  if (isLineChart) {
    options.strokeWidth = 2; // Reasonable line thickness
  }

  if (encoding.size) options.r = parseEncodingValue(api, encoding.size);

  // Bar chart styling (both vertical and horizontal)
  if (chartType === "barY" || chartType === "barX") {
    const isHorizontal = chartType === "barX";
    Object.assign(options, getBarChartOptions(!!encoding.color, isHorizontal));
  }

  return options;
}

/**
 * Get chart colors from CSS variables and convert to hex.
 */
function getChartColors(): string[] {
  const styles = getComputedStyle(document.documentElement);
  const rawColors = [
    styles.getPropertyValue("--chart-1").trim(),
    styles.getPropertyValue("--chart-2").trim(),
    styles.getPropertyValue("--chart-3").trim(),
    styles.getPropertyValue("--chart-4").trim(),
    styles.getPropertyValue("--chart-5").trim(),
  ].filter(Boolean);

  return rawColors.map((color) => colorToHex(color));
}

/**
 * Build sizing options for the plot.
 */
function buildSizingOptions(api: VgplotAPI, config: ChartConfig): unknown[] {
  const options: unknown[] = [];

  if (config.width === "container") {
    options.push(api.width("container"));
  } else if (typeof config.width === "number") {
    options.push(api.width(config.width));
  }

  if (config.height === "container") {
    options.push(api.height("container"));
  } else if (typeof config.height === "number") {
    options.push(api.height(config.height));
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
): unknown[] {
  const options: unknown[] = [];
  // Apply SI notation formatting to the metric axis
  // For horizontal bar charts, the metric (value) is on the X-axis
  // For vertical bar/line/area charts, the metric is on the Y-axis
  if (chartType === "barX") {
    options.push(api.xTickFormat("~s"));
    options.push(api.xGrid(true));
  } else {
    options.push(api.yTickFormat("~s"));
    options.push(api.yGrid(true));
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
  encoding?: ChartEncoding,
): unknown[] {
  if (isPreview) {
    return buildPreviewAxisOptions(api, chartType, encoding);
  }

  const options: unknown[] = [
    api.marginRight(20),
    api.marginTop(20),
    ...buildMetricAxisOptions(api, chartType),
    ...buildScaleOptions(api, chartType, encoding),
    ...buildLabelOptions(api, encoding),
  ];

  return options;
}

/**
 * Set up color domain for stacked bar charts (async).
 * Queries distinct values and sets them in alphabetical order for consistent colors.
 */
function setupColorDomain(
  api: VgplotAPIExtended,
  colorColumn: string,
  tableName: string,
): void {
  const { coordinator } = api;
  if (!coordinator?.query) return;

  coordinator
    .query(
      `SELECT DISTINCT "${colorColumn}" as val FROM ${tableName} ORDER BY "${colorColumn}"`,
    )
    .then((result) => {
      if (!result?.toArray) return;

      const rows = result.toArray();
      const domain = rows.map((row) => String(row.val));

      if (domain.length > 0 && api.colorDomain) {
        api.colorDomain(domain);
      }
    })
    .catch((e: unknown) => {
      console.warn("[VgplotRenderer] Could not set color domain:", e);
    });
}

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
) {
  const source = api.from(tableName);
  const options = buildEncodingOptions(api, encoding, type);

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
      try {
        // Build plot options
        const mark = buildMark(api, type, config.tableName, config.encoding);
        const chartColors = getChartColors();

        const plotOptions: unknown[] = [
          mark,
          ...buildSizingOptions(api, config),
          ...buildAxisOptions(api, !!config.preview, type, config.encoding),
        ];

        // Apply color scheme
        if (chartColors.length > 0) {
          plotOptions.push(api.colorRange(chartColors));
        }

        // Theme background
        if (config.theme?.backgroundColor) {
          container.style.backgroundColor = config.theme.backgroundColor;
        }

        // Create and mount the plot
        const plot = api.plot(...plotOptions);
        container.appendChild(plot);

        // Set up color domain for stacked bar charts
        if (
          type === "barY" &&
          config.encoding?.color &&
          chartColors.length > 0
        ) {
          setupColorDomain(
            extendedApi,
            config.encoding.color,
            config.tableName,
          );
        }

        return () => {
          container.innerHTML = "";
        };
      } catch (error) {
        console.error("[VgplotRenderer] Error rendering chart:", error);

        container.innerHTML = `
          <div style="color: red; padding: 16px; text-align: center; font-size: 12px;">
            Failed to render chart: ${error instanceof Error ? error.message : "Unknown error"}
          </div>
        `;

        return () => {
          container.innerHTML = "";
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
