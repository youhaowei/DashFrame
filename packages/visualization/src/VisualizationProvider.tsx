"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { ChartRenderer } from "./chart-renderers";
import { createVgplotRenderer } from "./renderers";

/**
 * Mosaic types - using dynamic import to avoid SSR issues.
 */
type MosaicCoordinator = import("@uwdata/vgplot").Coordinator;
type MosaicAPI = ReturnType<typeof import("@uwdata/vgplot").createAPIContext>;

/**
 * Structural Mosaic Connector interface — matches `@uwdata/mosaic-core`'s
 * `Connector` without adding a direct dep on that package.
 *
 * The three overloads mirror the three query types Mosaic issues:
 * - `arrow`  — returns Arrow IPC as a flechette Table
 * - `exec`   — runs a statement, returns void
 * - `json`   — returns rows as plain objects
 */
export interface MosaicConnector {
  query(query: { type?: "arrow"; sql: string }): Promise<unknown>;
  query(query: { type: "exec"; sql: string }): Promise<void>;
  query(query: {
    type: "json";
    sql: string;
  }): Promise<Record<string, unknown>[]>;
}

// ============================================================================
// Context Types
// ============================================================================

interface VisualizationContextValue {
  /** Mosaic coordinator (internal, exposed for advanced use cases) */
  coordinator: MosaicCoordinator | null;
  /** vgplot API for building charts */
  api: MosaicAPI | null;
  /**
   * Renderer bound to THIS provider's `api` (and therefore its coordinator and
   * connector). Chart prefers this over the global registry so each provider
   * routes chart queries to its own engine.
   *
   * This is the seam that makes per-insight engine routing work: the global
   * registry is keyed only by visualization type, so a page that registers a
   * renderer globally would force every chart through that engine. Chart reads
   * the renderer from this provider instead.
   */
  renderer: ChartRenderer | null;
  /** Whether the visualization system is ready */
  isReady: boolean;
  /** Initialization error, if any */
  error: Error | null;
}

const VisualizationContext = createContext<VisualizationContextValue>({
  coordinator: null,
  api: null,
  renderer: null,
  isReady: false,
  error: null,
});

export interface VisualizationProviderProps {
  /**
   * Mosaic Connector onto the server DuckDB engine. Both hosts supply this;
   * chart SQL goes over the Arrow IPC path.
   */
  connector: MosaicConnector;
  children: ReactNode;
}

// ============================================================================
// Provider Component
// ============================================================================

/**
 * VisualizationProvider — Mosaic vgplot on the server DuckDB engine.
 *
 * Both hosts pass a connector that posts chart SQL to the Arrow IPC path.
 *
 * ```tsx
 * <VisualizationProvider connector={serverConnector}>
 *   <MyCharts />
 * </VisualizationProvider>
 * ```
 */
export function VisualizationProvider(props: VisualizationProviderProps) {
  const [state, setState] = useState<VisualizationContextValue>({
    coordinator: null,
    api: null,
    renderer: null,
    isReady: false,
    error: null,
  });

  const { connector } = props;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const vg = await import("@uwdata/vgplot");

        if (cancelled) return;

        const coordinator = new vg.Coordinator();
        // Cast required: our structural MosaicConnector declares `query` for
        // the arrow case as `Promise<unknown>` to avoid a direct dep on
        // @uwdata/flechette, whereas mosaic-core's Connector interface
        // declares it as `Promise<Table<TypeMap>>`. At runtime the connector
        // returns a decoded flechette Table — the cast is safe.
        coordinator.databaseConnector(
          connector as unknown as Parameters<
            typeof coordinator.databaseConnector
          >[0],
        );

        const api = vg.createAPIContext({ coordinator });

        if (cancelled) return;

        const renderer = createVgplotRenderer(api);

        setState({
          coordinator,
          api,
          renderer,
          isReady: true,
          error: null,
        });
      } catch (err) {
        if (cancelled) return;

        console.error("[Visualization] Failed to initialize:", err);
        setState({
          coordinator: null,
          api: null,
          renderer: null,
          isReady: false,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connector]);

  return (
    <VisualizationContext.Provider value={state}>
      {props.children}
    </VisualizationContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook to access the visualization context.
 *
 * @returns Visualization context with api, isReady, and error
 *
 * @example
 * ```tsx
 * function MyChart({ tableName, encoding }) {
 *   const { api, isReady, error } = useVisualization();
 *
 *   if (error) return <ErrorDisplay error={error} />;
 *   if (!isReady) return <Loading />;
 *
 *   // Use api to build chart
 *   const chart = api.plot(
 *     api.barY(api.from(tableName), {
 *       x: encoding.x,
 *       y: encoding.y,
 *     })
 *   );
 * }
 * ```
 */
export function useVisualization() {
  return useContext(VisualizationContext);
}
