/**
 * Static Chart Icons
 *
 * Decorative SVG icons representing each chart type visually.
 * These are NOT data-driven - they show the chart shape/silhouette
 * to help users understand what each chart type looks like.
 *
 * Used in the chart type picker for the compact grid of all types.
 */

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & {
  /** Icon size in pixels (default: 24) */
  size?: number;
};

/**
 * Vertical bar chart icon - barY
 */
export function BarYIcon({ size = 24, className, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      {...props}
    >
      {/* Three vertical bars of different heights */}
      <rect x="4" y="10" width="4" height="10" rx="1" fill="currentColor" />
      <rect x="10" y="6" width="4" height="14" rx="1" fill="currentColor" />
      <rect x="16" y="12" width="4" height="8" rx="1" fill="currentColor" />
    </svg>
  );
}

/**
 * Horizontal bar chart icon - barX
 */
export function BarXIcon({ size = 24, className, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      {...props}
    >
      {/* Three horizontal bars of different widths */}
      <rect x="4" y="4" width="14" height="4" rx="1" fill="currentColor" />
      <rect x="4" y="10" width="10" height="4" rx="1" fill="currentColor" />
      <rect x="4" y="16" width="16" height="4" rx="1" fill="currentColor" />
    </svg>
  );
}

/**
 * Line chart icon
 */
export function LineIcon({ size = 24, className, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      {...props}
    >
      {/* Trend line going up with dots */}
      <polyline
        points="4,18 8,14 12,16 16,8 20,6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="4" cy="18" r="2" fill="currentColor" />
      <circle cx="8" cy="14" r="2" fill="currentColor" />
      <circle cx="12" cy="16" r="2" fill="currentColor" />
      <circle cx="16" cy="8" r="2" fill="currentColor" />
      <circle cx="20" cy="6" r="2" fill="currentColor" />
    </svg>
  );
}

/**
 * Area chart icon - areaY
 */
export function AreaYIcon({ size = 24, className, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      {...props}
    >
      {/* Filled area under a trend line */}
      <path
        d="M4 20 L4 16 L8 12 L12 14 L16 8 L20 10 L20 20 Z"
        fill="currentColor"
        opacity="0.3"
      />
      <polyline
        points="4,16 8,12 12,14 16,8 20,10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

/**
 * Scatter plot icon - dot
 */
export function DotIcon({ size = 24, className, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      {...props}
    >
      {/* Scattered dots pattern */}
      <circle cx="6" cy="16" r="2" fill="currentColor" />
      <circle cx="10" cy="8" r="2" fill="currentColor" />
      <circle cx="8" cy="12" r="2" fill="currentColor" />
      <circle cx="14" cy="14" r="2" fill="currentColor" />
      <circle cx="16" cy="6" r="2" fill="currentColor" />
      <circle cx="18" cy="10" r="2" fill="currentColor" />
      <circle cx="12" cy="18" r="2" fill="currentColor" />
    </svg>
  );
}

/**
 * Hexbin chart icon
 */
export function HexbinIcon({ size = 24, className, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      {...props}
    >
      {/* Hexagonal grid pattern */}
      <path
        d="M12 4 L16 6.5 L16 11.5 L12 14 L8 11.5 L8 6.5 Z"
        fill="currentColor"
        opacity="0.7"
      />
      <path
        d="M6 10 L10 12.5 L10 17.5 L6 20 L2 17.5 L2 12.5 Z"
        fill="currentColor"
        opacity="0.4"
      />
      <path
        d="M18 10 L22 12.5 L22 17.5 L18 20 L14 17.5 L14 12.5 Z"
        fill="currentColor"
        opacity="0.5"
      />
    </svg>
  );
}

/**
 * Heatmap chart icon
 */
export function HeatmapIcon({ size = 24, className, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      {...props}
    >
      {/* Grid of cells with varying opacity */}
      <rect
        x="4"
        y="4"
        width="5"
        height="5"
        fill="currentColor"
        opacity="0.8"
      />
      <rect
        x="10"
        y="4"
        width="5"
        height="5"
        fill="currentColor"
        opacity="0.3"
      />
      <rect
        x="16"
        y="4"
        width="5"
        height="5"
        fill="currentColor"
        opacity="0.5"
      />
      <rect
        x="4"
        y="10"
        width="5"
        height="5"
        fill="currentColor"
        opacity="0.4"
      />
      <rect
        x="10"
        y="10"
        width="5"
        height="5"
        fill="currentColor"
        opacity="0.9"
      />
      <rect
        x="16"
        y="10"
        width="5"
        height="5"
        fill="currentColor"
        opacity="0.6"
      />
      <rect
        x="4"
        y="16"
        width="5"
        height="5"
        fill="currentColor"
        opacity="0.2"
      />
      <rect
        x="10"
        y="16"
        width="5"
        height="5"
        fill="currentColor"
        opacity="0.5"
      />
      <rect
        x="16"
        y="16"
        width="5"
        height="5"
        fill="currentColor"
        opacity="0.7"
      />
    </svg>
  );
}

/**
 * Raster chart icon
 */
export function RasterIcon({ size = 24, className, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      {...props}
    >
      {/* Pixel grid pattern - smaller squares for raster effect */}
      {/* Row 1 */}
      <rect
        x="4"
        y="4"
        width="3"
        height="3"
        fill="currentColor"
        opacity="0.3"
      />
      <rect
        x="8"
        y="4"
        width="3"
        height="3"
        fill="currentColor"
        opacity="0.5"
      />
      <rect
        x="12"
        y="4"
        width="3"
        height="3"
        fill="currentColor"
        opacity="0.7"
      />
      <rect
        x="16"
        y="4"
        width="3"
        height="3"
        fill="currentColor"
        opacity="0.4"
      />
      {/* Row 2 */}
      <rect
        x="4"
        y="8"
        width="3"
        height="3"
        fill="currentColor"
        opacity="0.6"
      />
      <rect
        x="8"
        y="8"
        width="3"
        height="3"
        fill="currentColor"
        opacity="0.9"
      />
      <rect
        x="12"
        y="8"
        width="3"
        height="3"
        fill="currentColor"
        opacity="0.8"
      />
      <rect
        x="16"
        y="8"
        width="3"
        height="3"
        fill="currentColor"
        opacity="0.5"
      />
      {/* Row 3 */}
      <rect
        x="4"
        y="12"
        width="3"
        height="3"
        fill="currentColor"
        opacity="0.4"
      />
      <rect
        x="8"
        y="12"
        width="3"
        height="3"
        fill="currentColor"
        opacity="0.7"
      />
      <rect
        x="12"
        y="12"
        width="3"
        height="3"
        fill="currentColor"
        opacity="0.6"
      />
      <rect
        x="16"
        y="12"
        width="3"
        height="3"
        fill="currentColor"
        opacity="0.8"
      />
      {/* Row 4 */}
      <rect
        x="4"
        y="16"
        width="3"
        height="3"
        fill="currentColor"
        opacity="0.2"
      />
      <rect
        x="8"
        y="16"
        width="3"
        height="3"
        fill="currentColor"
        opacity="0.4"
      />
      <rect
        x="12"
        y="16"
        width="3"
        height="3"
        fill="currentColor"
        opacity="0.5"
      />
      <rect
        x="16"
        y="16"
        width="3"
        height="3"
        fill="currentColor"
        opacity="0.3"
      />
    </svg>
  );
}

/**
 * Map of chart type to its icon component.
 */
export const CHART_ICONS = {
  barY: BarYIcon,
  barX: BarXIcon,
  line: LineIcon,
  areaY: AreaYIcon,
  dot: DotIcon,
  hexbin: HexbinIcon,
  heatmap: HeatmapIcon,
  raster: RasterIcon,
} as const;

/**
 * Get the icon component for a chart type.
 *
 * @param chartType - The visualization type
 * @returns The icon component for rendering
 */
export function getChartIcon(
  chartType: keyof typeof CHART_ICONS,
): (typeof CHART_ICONS)[keyof typeof CHART_ICONS] {
  return CHART_ICONS[chartType];
}
