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
 * Build encoding options for vgplot marks.
 * Parses aggregation expressions and converts them to vgplot API calls.
 *
 * @param api - vgplot API instance for creating aggregate expressions
 * @param encoding - Visualization encoding configuration
 */
function buildEncodingOptions(
  api: VgplotAPI,
  encoding: VisualizationEncoding,
  chartType?: VisualizationType,
) {
  const options: Record<string, unknown> = {};

  if (encoding.x) options.x = parseEncodingValue(api, encoding.x);
  if (encoding.y) options.y = parseEncodingValue(api, encoding.y);

  // Color encoding: vgplot automatically applies categorical color scale when fill is set
  // Ensure column name is passed correctly (not aggregated function)
  if (encoding.color) {
    const colorValue = parseEncodingValue(api, encoding.color);
    options.fill = colorValue;
    // vgplot will automatically use a categorical color scale for nominal data
    // No need to explicitly set color scale - vgplot handles it
  } else {
    // For charts without color encoding, use chart-1
    // Chart colors are defined in globals.css (slate palette for neutral, professional look)
    const styles = getComputedStyle(document.documentElement);
    const chart1Color = styles.getPropertyValue("--chart-1").trim();

    if (chart1Color) {
      // Convert oklch color to hex that vgplot recognizes as a constant color
      const hexColor = colorToHex(chart1Color);
      options.fill = hexColor;
    }
  }

  if (encoding.size) options.r = parseEncodingValue(api, encoding.size);

  // For bar charts, set consistent bar width, padding, and rounded corners
  // This ensures bars have uniform width regardless of data distribution
  if (chartType === "bar") {
    options.width = 0.8; // Bar width as fraction of band (80% of available space)
    options.padding = 0.1; // Padding between bars (10% of band)

    // Read border radius from CSS variable to match app theme
    const styles = getComputedStyle(document.documentElement);
    const radiusValue = styles.getPropertyValue("--radius").trim();
    if (radiusValue) {
      // Parse rem value (e.g., "0.625rem" → 10px at 16px base)
      // Scale down for charts (about 60% of full radius looks good)
      const radiusInPx = parseFloat(radiusValue) * 16 * 0.6;

      // Apply rounded corners to bars
      // For single bars: round the top
      // For stacked bars: round top + curve bottom inward for seamless fit
      options.ry1 = radiusInPx; // Round the top corners

      // If this is a stacked bar chart (has color encoding), use negative radius
      // on bottom to make bars curve toward the ones they're stacked on
      if (encoding.color) {
        options.ry2 = -radiusInPx; // Negative value curves inward at bottom
      }
    }
  }

  return options;
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
  return {
    supportedTypes: ["bar", "line", "area", "scatter"] as const,

    render(
      container: HTMLElement,
      type: VisualizationType,
      config: ChartConfig,
    ): ChartCleanup {
      try {
        // Build the mark
        const mark = buildMark(api, type, config.tableName, config.encoding);

        // Build plot options
        const plotOptions: unknown[] = [mark];

        // Responsive sizing
        if (config.width === "container") {
          plotOptions.push(api.width("container"));
        } else if (typeof config.width === "number") {
          plotOptions.push(api.width(config.width));
        }

        if (config.height === "container") {
          plotOptions.push(api.height("container"));
        } else if (typeof config.height === "number") {
          plotOptions.push(api.height(config.height));
        }

        // Apply shadcn chart colors from CSS variables
        // Use computed styles to get CSS variable values
        const styles = getComputedStyle(document.documentElement);

        // Read chart colors from --chart-1 through --chart-5
        // Note: Tailwind v4's @theme inline creates --color-chart-* for Tailwind utilities,
        // but only --chart-* are available at runtime via getComputedStyle
        const rawColors = [
          styles.getPropertyValue("--chart-1").trim(),
          styles.getPropertyValue("--chart-2").trim(),
          styles.getPropertyValue("--chart-3").trim(),
          styles.getPropertyValue("--chart-4").trim(),
          styles.getPropertyValue("--chart-5").trim(),
        ].filter(Boolean);

        // Convert colors to hex format using Canvas API
        // This ensures vgplot recognizes them as constant colors, not column names
        // CSS variables contain oklch() color strings, so pass them directly
        const chartColors = rawColors.map((color) => {
          const hex = colorToHex(color);
          return hex;
        });

        // Apply color scheme to plot
        if (chartColors.length > 0) {
          plotOptions.push(api.colorRange(chartColors));
        }

        // Preview mode - minimal chrome
        if (config.preview) {
          plotOptions.push(
            api.axis(null), // No axes
            // Note: vgplot has no generic legend() - legends are auto-generated
            // based on encoding channels. For small previews, the CSS container
            // overflow:hidden typically clips any legend that would appear.
            api.margin(4), // Minimal margin
          );
        }

        // Theme colors (if provided)
        if (config.theme) {
          // Note: vgplot theming is done via CSS variables
          // We can set styles on the container
          if (config.theme.backgroundColor) {
            container.style.backgroundColor = config.theme.backgroundColor;
          }
        }

        // Create the plot
        const plot = api.plot(...plotOptions);

        // Mount to container
        container.appendChild(plot);

        // Monitor for NaN errors in SVG attributes (common when data query fails)
        // Use MutationObserver to catch SVG attribute errors
        const observer = new MutationObserver((_mutations) => {
          const svg = container.querySelector("svg");
          if (svg) {
            const width = svg.getAttribute("width");
            const viewBox = svg.getAttribute("viewBox");
            if (width === "NaN" || viewBox?.includes("NaN")) {
              console.warn(
                "[VgplotRenderer] Detected NaN in SVG attributes, data query may have failed",
              );
              container.innerHTML = `
                <div style="padding: 16px; text-align: center; color: #666; font-size: 12px;">
                  Chart preview unavailable
                </div>
              `;
              observer.disconnect();
            }
          }
        });

        // Start observing after a short delay to allow SVG to render
        setTimeout(() => {
          observer.observe(container, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["width", "viewBox"],
          });
        }, 100);

        // Return cleanup function
        return () => {
          observer.disconnect();
          container.innerHTML = "";
        };
      } catch (error) {
        console.error("[VgplotRenderer] Error rendering chart:", error);

        // Show error message in container
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
