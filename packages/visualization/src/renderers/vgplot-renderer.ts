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

import type { ChartConfig, ChartCleanup, ChartRenderer } from "@dashframe/core";
import type {
  VisualizationType,
  VisualizationEncoding,
} from "@dashframe/types";

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
 * - Date binning: dateMonth, dateDay, dateYear, dateMonthDay
 */
const SQL_FUNCTION_PATTERN =
  /^(sum|avg|count|min|max|median|mode|first|last|dateMonth|dateDay|dateYear|dateMonthDay)\((.+)\)$/i;

/**
 * Parse an encoding value and convert SQL expressions to vgplot API calls.
 * Converts strings like "sum(contractpeak)" to api.sum("contractpeak")
 * and "dateMonth(created)" to api.dateMonth("created").
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
 */
function getBarChartOptions(isStacked: boolean): Record<string, unknown> {
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
      options.ry1 = radiusInPx; // Round top corners only
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
  encoding: VisualizationEncoding,
  chartType?: VisualizationType,
) {
  const options: Record<string, unknown> = {};

  if (encoding.x) options.x = parseEncodingValue(api, encoding.x);
  if (encoding.y) options.y = parseEncodingValue(api, encoding.y);

  // Color encoding
  if (encoding.color) {
    options.fill = parseEncodingValue(api, encoding.color);
  } else {
    const defaultFill = getDefaultFillColor();
    if (defaultFill) options.fill = defaultFill;
  }

  if (encoding.size) options.r = parseEncodingValue(api, encoding.size);

  // Bar chart styling
  if (chartType === "bar") {
    Object.assign(options, getBarChartOptions(!!encoding.color));
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
 * Build margin and axis options for the plot.
 */
function buildAxisOptions(api: VgplotAPI, isPreview: boolean): unknown[] {
  if (isPreview) {
    return [api.axis(null), api.margin(4)];
  }

  return [
    api.marginRight(20),
    api.marginTop(20),
    api.yTickFormat("~s"),
    api.yGrid(true),
  ];
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
 */
function buildMark(
  api: VgplotAPI,
  type: VisualizationType,
  tableName: string,
  encoding: VisualizationEncoding,
) {
  const source = api.from(tableName);
  const options = buildEncodingOptions(api, encoding, type);

  switch (type) {
    case "bar":
      return api.barY(source, options);
    case "line":
      return api.lineY(source, options);
    case "area":
      return api.areaY(source, options);
    case "scatter":
      return api.dot(source, options);
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
    supportedTypes: ["bar", "line", "area", "scatter"] as const,

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
          ...buildAxisOptions(api, !!config.preview),
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
          type === "bar" &&
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
  "bar",
  "line",
  "area",
  "scatter",
] as const;
