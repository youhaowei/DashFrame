"use client";

import type {
  ChartEncoding,
  VisualizationType,
  MeasureFormat,
} from "@dashframe/types";
import { useContainerDimensions } from "@dashframe/ui";
import { Spinner, cn } from "@wystack/ui-react";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useVisualization } from "../VisualizationProvider";
import type { ChartConfig, ChartTheme } from "../chart-renderers";
import { getRenderer, hasRenderer, useRegistryVersion } from "../registry";

// ============================================================================
// Theme Detection
// ============================================================================

/**
 * Root-level tokens the renderer reads when it draws: the chart palette, plus
 * the inputs of `--dashframe-chart-accent` (see chart-styles.css), which is
 * resolved once per render for continuous scales.
 */
const CHART_COLOR_TOKENS = [
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--palette-info",
  "--neutral-fg-subtle",
];

/**
 * Subscribe to theme changes on documentElement. The mode toggles its `class`;
 * a theme preset writes token overrides into its inline `style`.
 */
function subscribeToThemeChanges(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style"],
  });
  return () => observer.disconnect();
}

/**
 * Read the chart colour tokens to detect theme changes.
 * Returns a string that changes when any of them changes.
 */
function getChartColorsSnapshot(): string {
  if (typeof window === "undefined") return "";
  const styles = getComputedStyle(document.documentElement);
  return CHART_COLOR_TOKENS.map((token) =>
    styles.getPropertyValue(token).trim(),
  ).join("|");
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
  /** Exclude canonical subtotal rows from chart marks and domains. */
  detailRowsOnly?: boolean;
  /** Saved measure formats keyed by canonical result column. */
  measureFormats?: Record<string, MeasureFormat>;
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
  detailRowsOnly = false,
  measureFormats,
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
  const cleanupRef = useRef<(() => void) | null>(null);

  // Suggestions and persisted visualizations can recreate an equivalent
  // encoding object during unrelated store updates. Key renderer lifecycle to
  // the serialized value instead of object identity so those renders do not
  // tear down a healthy chart and briefly leave its container empty.
  const serializedEncoding = JSON.stringify(encoding);
  const serializedMeasureFormats = JSON.stringify(measureFormats ?? {});

  // Track chart colors to detect theme changes
  const chartColors = useChartColors();

  // Track registry version to detect renderer updates (for hot reload)
  const registryVersion = useRegistryVersion();

  // Renderer bound to the enclosing VisualizationProvider's engine. Preferred
  // over the global registry so this Chart routes to ITS provider's connector.
  // Provider shadowing remains a general capability, but v0.3 hosts inject the
  // shared native-server connector and do not mount a WASM fallback provider.
  const {
    renderer: contextRenderer,
    isReady: providerReady,
    error: providerError,
  } = useVisualization();

  // The enclosing provider is still spinning up its engine: it has no renderer
  // yet but hasn't failed. We must NOT fall through to the global registry in
  // this window — on desktop the global renderer is the native one, so a nested
  // WASM-fallback chart would briefly query the native engine for a table it
  // intentionally never created. Wait for the provider's own renderer instead.
  const providerInitializing =
    !contextRenderer && !providerReady && !providerError;

  // Resolve the renderer for this type: provider context first, global second.
  const resolveRenderer = useCallback(
    (type: VisualizationType) => {
      if (contextRenderer?.supportedTypes.includes(type)) {
        return contextRenderer;
      }
      return getRenderer(type);
    },
    [contextRenderer],
  );

  const typeIsRenderable =
    (contextRenderer?.supportedTypes.includes(visualizationType) ?? false) ||
    hasRenderer(visualizationType);

  // Determine if we need container dimensions
  const needsContainerDimensions =
    width === "container" || height === "container";

  // Track container dimensions when needed
  // The hook returns its own ref which we use for dimension tracking
  const {
    ref: containerRef,
    width: containerWidth,
    height: containerHeight,
    isReady: areDimensionsReady,
  } = useContainerDimensions({
    minSize: 10, // Require at least 10x10px
    debounce: 50, // Debounce to prevent multiple re-renders during layout stabilization
  });

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

    // Don't render against the global renderer while the enclosing provider is
    // still bringing up its own engine — that would route to the wrong engine.
    if (providerInitializing) {
      return;
    }

    // Get renderer for this type — provider context first, global registry
    // second. The context renderer is bound to the enclosing provider's engine.
    const renderer = resolveRenderer(visualizationType);
    if (!renderer) {
      console.warn(
        `[Chart] No renderer registered for type: ${visualizationType}`,
      );
      return;
    }

    // Build config with resolved dimensions
    const config: ChartConfig = {
      detailRowsOnly,
      measureFormats: JSON.parse(serializedMeasureFormats) as Record<
        string,
        MeasureFormat
      >,
      tableName,
      encoding: JSON.parse(serializedEncoding) as ChartEncoding,
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
    serializedEncoding,
    serializedMeasureFormats,
    resolvedWidth,
    resolvedHeight,
    preview,
    detailRowsOnly,
    theme,
    chartColors, // Re-render when theme changes
    canRender,
    containerRef,
    resolveRenderer,
    registryVersion, // Re-render when renderer is updated (hot reload)
    contextRenderer, // Re-render when the enclosing provider's renderer changes
    providerInitializing, // Re-render once the provider's engine is ready
  ]);

  // One sizing convention for the loading box and the rendered box: the
  // loading box is what useContainerDimensions measures, so it must fill the
  // same space the chart is finally drawn into.
  const containerStyle = {
    width: width === "container" ? "100%" : width,
    height: height === "container" ? "100%" : height,
  };

  // Shared loading state component with spinner
  const renderLoading = () => (
    <div
      ref={containerRef}
      data-testid="visualization-chart"
      className={cn(
        "flex min-h-0 items-center justify-center overflow-hidden bg-neutral-bg-muted/30",
        className,
      )}
      style={containerStyle}
    >
      <Spinner size="lg" className="text-neutral-fg-subtle" />
    </div>
  );

  // Handle unrenderable type.
  // A type is renderable if the enclosing provider's renderer supports it OR
  // the global registry has it. When neither is available yet (provider still
  // initializing AND nothing registered globally), show loading rather than the
  // "no renderer" fallback — this covers the race where Chart mounts before the
  // provider's renderer is ready or RendererRegistration's effect has run.
  if (!typeIsRenderable) {
    // Provider renderer not ready yet, or renderers not registered yet — wait.
    if (providerInitializing || (!contextRenderer && registryVersion === 0)) {
      return renderLoading();
    }
    // Renderers are registered but this type isn't supported - show fallback
    return (
      fallback ?? (
        <div className={cn("p-4 text-center", className)}>
          <p>No renderer for: {visualizationType}</p>
          <p className="text-sm opacity-70">
            Register a renderer with registerRenderer()
          </p>
        </div>
      )
    );
  }

  // Show loading placeholder while waiting for dimensions
  if (!canRender) {
    return renderLoading();
  }

  // Container for chart rendering
  // In preview mode, disable pointer events to prevent Vega-Lite's
  // interactive features (tooltips, crosshairs) from causing lag on hover
  return (
    <div
      ref={containerRef}
      data-testid="visualization-chart"
      className={cn(
        "min-h-0 overflow-hidden",
        preview ? "pointer-events-none" : "pointer-events-auto",
        className,
      )}
      style={containerStyle}
    />
  );
}
