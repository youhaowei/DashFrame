"use client";

import type * as duckdb from "@duckdb/duckdb-wasm";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

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
  /** DuckDB-WASM connection - MUST be the same connection used for creating views/tables */
  connection: duckdb.AsyncDuckDBConnection;
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
 * 2. Connects to the provided DuckDB instance via wasmConnector using the SAME connection
 * 3. Creates vgplot API context for building charts
 * 4. Provides context to child components
 *
 * ## Important: Connection Sharing
 *
 * The connection parameter MUST be the same connection used for creating DuckDB views
 * and tables. In DuckDB-WASM, views created on one connection are not visible to
 * queries on a different connection. By passing the shared connection, Mosaic can
 * query views created by useInsightView and other hooks.
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
  connection,
  children,
}: VisualizationProviderProps) {
  const [state, setState] = useState<VisualizationContextValue>({
    coordinator: null,
    api: null,
    isReady: false,
    error: null,
  });

  useEffect(() => {
    console.log(
      "[Visualization] useEffect started, db:",
      !!db,
      "connection:",
      !!connection,
    );
    let cancelled = false;

    (async () => {
      try {
        console.log("[Visualization] About to import vgplot");
        // Dynamically import vgplot to avoid SSR issues
        const vg = await import("@uwdata/vgplot");
        console.log(
          "[Visualization] vgplot imported, wasmConnector:",
          typeof vg.wasmConnector,
        );

        if (cancelled) return;

        // Create Mosaic coordinator
        const coordinator = new vg.Coordinator();

        // Connect to the provided DuckDB instance using the SAME connection
        // This is critical: views created on one connection are not visible
        // to queries on a different connection. By passing both db AND connection,
        // Mosaic will reuse the existing connection instead of creating a new one.
        console.log(
          "[Visualization] Creating wasmConnector with shared connection",
          {
            hasDb: !!db,
            hasConnection: !!connection,
          },
        );
        const connector = vg.wasmConnector({ duckdb: db, connection });
        coordinator.databaseConnector(connector);

        // Verify the connector has both db and connection
        const connectorDb = await connector.getDuckDB();
        const connectorCon = await connector.getConnection();
        console.log("[Visualization] Connector verified:", {
          connectorHasDb: !!connectorDb,
          connectorHasCon: !!connectorCon,
          sameDb: connectorDb === db,
          sameCon: connectorCon === connection,
        });

        // Create vgplot API context bound to this coordinator
        const api = vg.createAPIContext({ coordinator });

        if (cancelled) return;

        setState({
          coordinator,
          api,
          isReady: true,
          error: null,
        });

        console.log(
          "[Visualization] Provider initialized with shared connection",
        );
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
  }, [db, connection]);

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
