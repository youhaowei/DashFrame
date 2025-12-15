"use client";

import { useEffect, useRef } from "react";
import type {
  ChartConfig,
  ChartTheme,
  VisualizationEncoding,
  VisualizationType,
} from "@dashframe/core";
import { getRenderer, hasRenderer } from "../registry";

// ============================================================================
// Component Props
// ============================================================================

export interface ChartProps {
  /** DuckDB table name to render data from */
  tableName: string;

  /** Type of visualization */
  visualizationType: VisualizationType;

  /** Column encoding configuration */
  encoding: VisualizationEncoding;

  /** Optional CSS class name */
  className?: string;

  /** Chart width - "container" for responsive, or fixed pixels */
  width?: number | "container";

  /** Chart height - "container" for responsive, or fixed pixels */
  height?: number | "container";

  /** Enable preview mode (minimal chrome, optimized for thumbnails) */
  preview?: boolean;

  /** Optional theme configuration */
  theme?: ChartTheme;

  /**
   * Fallback component for unsupported types or missing renderers.
   * If not provided, shows a default message.
   */
  fallback?: React.ReactNode;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Chart - Single entry point for all chart visualization rendering.
 *
 * This component dispatches to the appropriate registered ChartRenderer
 * based on the visualization type. It's the primary way to render charts
 * in DashFrame.
 *
 * ## Prerequisites
 *
 * 1. Wrap your app with VisualizationProvider
 * 2. Register renderers (e.g., createVgplotRenderer) before rendering charts
 *
 * ## Usage
 *
 * ```tsx
 * import { Chart } from "@dashframe/visualization";
 *
 * function MyChart() {
 *   return (
 *     <Chart
 *       tableName="my_dataframe_id"
 *       visualizationType="bar"
 *       encoding={{ x: "category", y: "revenue" }}
 *       width="container"
 *       height="container"
 *     />
 *   );
 * }
 * ```
 *
 * ## Preview Mode
 *
 * For thumbnail/card previews, use the preview prop:
 *
 * ```tsx
 * <Chart
 *   tableName={dataFrameId}
 *   visualizationType="line"
 *   encoding={encoding}
 *   preview
 *   height={160}
 * />
 * ```
 *
 * ## Data Flow
 *
 * ```
 * Chart
 *     │
 *     ├── visualizationType
 *     │         │
 *     ▼         ▼
 *   registry.get(type) ──► ChartRenderer
 *                              │
 *                              ▼
 *                     renderer.render(container, type, config)
 *                              │
 *                              ▼
 *                     DOM (SVG/Canvas)
 * ```
 *
 * ## Note on Table Type
 *
 * The "table" visualization type is NOT a chart and should be handled
 * separately with a table component. Chart will show a fallback
 * for table type.
 */
export function Chart({
  tableName,
  visualizationType,
  encoding,
  className,
  width = "container",
  height = "container",
  preview = false,
  theme,
  fallback,
}: ChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Handle table type separately
    if (visualizationType === "table") {
      return;
    }

    // Get renderer for this type
    const renderer = getRenderer(visualizationType);
    if (!renderer) {
      console.warn(
        `[Chart] No renderer registered for type: ${visualizationType}`,
      );
      return;
    }

    // Build config
    const config: ChartConfig = {
      tableName,
      encoding,
      width,
      height,
      preview,
      theme,
    };

    // Cleanup previous render
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }

    // Render chart
    try {
      cleanupRef.current = renderer.render(
        container,
        visualizationType,
        config,
      );
    } catch (error) {
      console.error("[Chart] Render error:", error);
    }

    // Cleanup on unmount or deps change
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, [tableName, visualizationType, encoding, width, height, preview, theme]);

  // Handle table type
  if (visualizationType === "table") {
    return (
      fallback ?? (
        <div className={className} style={{ padding: 16, textAlign: "center" }}>
          <p>Table visualization - use VirtualTable component</p>
        </div>
      )
    );
  }

  // Handle unregistered type
  if (!hasRenderer(visualizationType)) {
    return (
      fallback ?? (
        <div className={className} style={{ padding: 16, textAlign: "center" }}>
          <p>No renderer for: {visualizationType}</p>
          <p style={{ fontSize: "0.875rem", opacity: 0.7 }}>
            Register a renderer with registerRenderer()
          </p>
        </div>
      )
    );
  }

  // Container for chart rendering
  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        width: width === "container" ? "100%" : width,
        height: height === "container" ? "100%" : height,
        minHeight: 0,
        overflow: "hidden",
      }}
    />
  );
}
