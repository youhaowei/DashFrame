"use client";

import type * as duckdb from "@duckdb/duckdb-wasm";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { debugLog } from "./debug";

/**
 * Mosaic types - using dynamic import to avoid SSR issues.
 */
type MosaicCoordinator = import("@uwdata/vgplot").Coordinator;
type MosaicAPI = ReturnType<typeof import("@uwdata/vgplot").createAPIContext>;

// ============================================================================
// Context Types
// ============================================================================

interface VisualizationContextValue {
  /** Mosaic coordinator (internal, exposed for advanced use cases) */
  coordinator: MosaicCoordinator | null;
  /** vgplot API for building charts */
  api: MosaicAPI | null;
  /** Whether the visualization system is ready */
  isReady: boolean;
  /** Initialization error, if any */
  error: Error | null;
}

const VisualizationContext = createContext<VisualizationContextValue>({
  coordinator: null,
  api: null,
  isReady: false,
  error: null,
});

// ============================================================================
// Provider Props
// ============================================================================

export interface VisualizationProviderProps {
  /** DuckDB-WASM database instance */
  db: duckdb.AsyncDuckDB;
  /** Children to render */
  children: ReactNode;
}

// ============================================================================
// Provider Component
// ============================================================================

/**
 * VisualizationProvider - Initializes the visualization rendering system.
 *
 * This provider sets up Mosaic vgplot connected to a DuckDB instance,
 * enabling chart components to render visualizations with query pushdown.
 *
 * ## Usage
 *
 * ```tsx
 * import { VisualizationProvider, useVisualization } from "@dashframe/visualization";
 *
 * // Wrap your app (db comes from DuckDB-WASM initialization)
 * function App() {
 *   const { db } = useDuckDB();
 *   if (!db) return <Loading />;
 *
 *   return (
 *     <VisualizationProvider db={db}>
 *       <MyCharts />
 *     </VisualizationProvider>
 *   );
 * }
 *
 * // In chart components
 * function MyChart() {
 *   const { api, isReady } = useVisualization();
 *   if (!isReady) return <Loading />;
 *   // Use api to build charts...
 * }
 * ```
 *
 * ## How It Works
 *
 * 1. Creates a Mosaic Coordinator
 * 2. Connects to the provided DuckDB instance via wasmConnector
 * 3. Creates vgplot API context for building charts
 * 4. Provides context to child components
 *
 * ## Data Flow
 *
 * ```
 * DuckDB (tables) ─┐
 *                  ├─► VisualizationProvider
 * App config ──────┘        │
 *                           ▼
 *                    Mosaic Coordinator
 *                           │
 *                           ▼
 *                    vgplot API Context
 *                           │
 *                           ▼
 *                    Chart Components
 * ```
 */
export function VisualizationProvider({
  db,
  children,
}: VisualizationProviderProps) {
  const [state, setState] = useState<VisualizationContextValue>({
    coordinator: null,
    api: null,
    isReady: false,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Dynamically import vgplot to avoid SSR issues
        const vg = await import("@uwdata/vgplot");

        if (cancelled) return;

        // Create Mosaic coordinator
        const coordinator = new vg.Coordinator();

        // Connect to the provided DuckDB instance
        const connector = vg.wasmConnector({ duckdb: db });
        coordinator.databaseConnector(connector);

        // Create vgplot API context bound to this coordinator
        const api = vg.createAPIContext({ coordinator });

        if (cancelled) return;

        setState({
          coordinator,
          api,
          isReady: true,
          error: null,
        });

        debugLog("visualization", "Provider initialized");
      } catch (err) {
        if (cancelled) return;

        console.error("[Visualization] Failed to initialize:", err);
        setState({
          coordinator: null,
          api: null,
          isReady: false,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [db]);

  return (
    <VisualizationContext.Provider value={state}>
      {children}
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
