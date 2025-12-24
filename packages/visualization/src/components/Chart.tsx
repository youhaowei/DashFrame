"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import type { ChartConfig, ChartTheme } from "@dashframe/core";
import type { ChartEncoding, VisualizationType } from "@dashframe/types";
import { getRenderer, hasRenderer, useRegistryVersion } from "../registry";
import { useContainerDimensions } from "@dashframe/ui";

// ============================================================================
// Theme Detection
// ============================================================================

/**
 * Subscribe to CSS variable changes by watching for class changes on documentElement.
 * This detects when the theme changes (e.g., light/dark mode toggle).
 */
function subscribeToThemeChanges(callback: () => void) {
  const observer = new MutationObserver((mutations) => {
    // Check if class attribute changed (theme providers typically toggle classes)
    const hasClassChange = mutations.some(
      (mutation) =>
        mutation.type === "attributes" && mutation.attributeName === "class",
    );
    if (hasClassChange) {
      callback();
    }
  });

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });

  return () => observer.disconnect();
}

/**
 * Read chart color CSS variables to detect theme changes.
 * Returns a hash of the current chart colors.
 */
function getChartColorsSnapshot(): string {
  if (typeof window === "undefined") return "";

  const styles = getComputedStyle(document.documentElement);
  const colors = [
    styles.getPropertyValue("--chart-1").trim(),
    styles.getPropertyValue("--chart-2").trim(),
    styles.getPropertyValue("--chart-3").trim(),
    styles.getPropertyValue("--chart-4").trim(),
    styles.getPropertyValue("--chart-5").trim(),
  ];

  // Simple hash: join colors into a string
  return colors.join("|");
}

/**
 * Hook to track chart color changes.
 * Returns a stable string that changes when theme colors change.
 */
function useChartColors(): string {
  return useSyncExternalStore(
    subscribeToThemeChanges,
    getChartColorsSnapshot,
    () => "", // Server-side snapshot
  );
}

// ============================================================================
// Component Props
// ============================================================================

export interface ChartProps {
  /** DuckDB table name to render data from */
  tableName: string;

  /** Type of visualization */
  visualizationType: VisualizationType;

  /** Column encoding configuration - uses plain strings (column names or SQL expressions) */
  encoding: ChartEncoding;

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

  // Track chart colors to detect theme changes
  const chartColors = useChartColors();

  // Track registry version to detect renderer updates (for hot reload)
  const registryVersion = useRegistryVersion();

  // Determine if we need container dimensions
  const needsContainerDimensions =
    width === "container" || height === "container";

  // Track container dimensions when needed
  const {
    ref: dimensionRef,
    width: containerWidth,
    height: containerHeight,
    isReady: areDimensionsReady,
  } = useContainerDimensions({
    minSize: 10, // Require at least 10x10px
    debounce: 50, // Debounce to prevent multiple re-renders during layout stabilization
  });

  // Merge refs if we need dimension tracking
  useEffect(() => {
    if (needsContainerDimensions && containerRef.current) {
      // Assign containerRef element to dimensionRef for measurement
      (dimensionRef as React.MutableRefObject<HTMLDivElement | null>).current =
        containerRef.current;
    }
  }, [needsContainerDimensions, dimensionRef]);

  // Resolve final dimensions
  const resolvedWidth = width === "container" ? containerWidth : width;
  const resolvedHeight = height === "container" ? containerHeight : height;

  // Only render when dimensions are ready (if using container sizing)
  const canRender = !needsContainerDimensions || areDimensionsReady;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Wait for dimensions if using container sizing
    if (!canRender) {
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

    // Build config with resolved dimensions
    const config: ChartConfig = {
      tableName,
      encoding,
      width: resolvedWidth,
      height: resolvedHeight,
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
  }, [
    tableName,
    visualizationType,
    encoding,
    resolvedWidth,
    resolvedHeight,
    preview,
    theme,
    chartColors, // Re-render when theme changes
    canRender,
    registryVersion, // Re-render when renderer is updated (hot reload)
  ]);

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

  // Show loading placeholder while waiting for dimensions
  if (!canRender) {
    return (
      <div
        ref={containerRef}
        className={className}
        style={{
          width: width === "container" ? "100%" : width,
          height: height === "container" ? "100%" : height,
          minHeight: 0,
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ fontSize: "0.75rem", opacity: 0.5 }}>
          Loading chart...
        </div>
      </div>
    );
  }

  // Container for chart rendering
  // In preview mode, disable pointer events to prevent Vega-Lite's
  // interactive features (tooltips, crosshairs) from causing lag on hover
  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        width: width === "container" ? "100%" : width,
        height: height === "container" ? "100%" : height,
        minHeight: 0,
        overflow: "hidden",
        pointerEvents: preview ? "none" : "auto",
      }}
    />
  );
}
