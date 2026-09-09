"use client";

import type * as duckdb from "@duckdb/duckdb-wasm";
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
   * registry is keyed only by visualization type, so a desktop page that
   * registers a native renderer globally would force every chart through the
   * native engine. By reading the renderer from context, a nested WASM-backed
   * provider (the per-insight fallback) routes its chart to WASM even while the
   * outer provider's native renderer is registered globally.
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

// ============================================================================
// Provider Props
// ============================================================================

/**
 * WASM-backed props: pass db + connection from DuckDB-WASM.
 *
 * The backup rung of the placement ladder. Nothing selects it implicitly and
 * nothing detects a platform to reach it — a caller reaches it only by handing
 * over a DuckDB-WASM database and connection.
 */
interface WasmProviderProps {
  /** DuckDB-WASM database instance */
  db: duckdb.AsyncDuckDB;
  /** DuckDB-WASM connection - MUST be the same connection used for creating views/tables */
  connection: duckdb.AsyncDuckDBConnection;
  /** When set, use this connector instead of the built-in wasmConnector. */
  connector?: never;
  /** Children to render */
  children: ReactNode;
}

/** Custom-connector props: pass a pre-built Mosaic Connector directly. */
interface ConnectorProviderProps {
  db?: never;
  connection?: never;
  /**
   * Pre-built Mosaic Connector — the first rung of the placement ladder. A host
   * that can reach a server engine supplies this, and all Mosaic queries route
   * to that engine over the Arrow IPC path instead of DuckDB-WASM.
   */
  connector: MosaicConnector;
  /** Children to render */
  children: ReactNode;
}

export type VisualizationProviderProps =
  | WasmProviderProps
  | ConnectorProviderProps;

// ============================================================================
// Provider Component
// ============================================================================

/**
 * VisualizationProvider - Initializes the visualization rendering system.
 *
 * This provider sets up Mosaic vgplot connected to a DuckDB instance,
 * enabling chart components to render visualizations with query pushdown.
 *
 * ## Placement
 *
 * The provider does not pick an engine by surface. It takes whichever rung the
 * caller resolved: a Mosaic connector onto a reachable server engine, or — only
 * when the caller explicitly hands over `db` + `connection` — the DuckDB-WASM
 * backup. There is no per-surface table and no platform detection here.
 *
 * ## Usage: server connector (both surfaces)
 *
 * ```tsx
 * // The host supplies a connector that routes to the server engine.
 * <VisualizationProvider connector={serverConnector}>
 *   <MyCharts />
 * </VisualizationProvider>
 * ```
 *
 * ## Usage: DuckDB-WASM backup rung
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
 *     <VisualizationProvider db={db} connection={connection}>
 *       <MyCharts />
 *     </VisualizationProvider>
 *   );
 * }
 * ```
 *
 * ## How It Works
 *
 * 1. Creates a Mosaic Coordinator
 * 2. Connects via the supplied connector, or wasmConnector on the backup rung
 * 3. Creates vgplot API context for building charts
 * 4. Provides context to child components
 *
 * ## Important: Connection Sharing (WASM path)
 *
 * The connection parameter MUST be the same connection used for creating DuckDB views
 * and tables. In DuckDB-WASM, views created on one connection are not visible to
 * queries on a different connection. By passing the shared connection, Mosaic can
 * query views created by useInsightView and other hooks.
 */
export function VisualizationProvider(props: VisualizationProviderProps) {
  const [state, setState] = useState<VisualizationContextValue>({
    coordinator: null,
    api: null,
    renderer: null,
    isReady: false,
    error: null,
  });

  // Stable references so the effect dependency array works correctly.
  const db = "db" in props ? props.db : undefined;
  const connection = "connection" in props ? props.connection : undefined;
  const connector = "connector" in props ? props.connector : undefined;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const vg = await import("@uwdata/vgplot");

        if (cancelled) return;

        const coordinator = new vg.Coordinator();

        if (connector) {
          // First rung: a server engine is reachable, so use the connector the
          // host resolved onto it. Queries go over the Arrow IPC endpoint.
          //
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
        } else if (db && connection) {
          // Backup rung, entered only because the caller handed over a
          // DuckDB-WASM database: connect using the SAME
          // connection. Views created on one connection are not visible to
          // queries on a different connection. By passing both db AND
          // connection, Mosaic reuses the existing connection.
          const wasmConn = vg.wasmConnector({ duckdb: db, connection });
          coordinator.databaseConnector(wasmConn);
        } else {
          throw new Error(
            "VisualizationProvider requires either (db + connection) or connector",
          );
        }

        const api = vg.createAPIContext({ coordinator });

        if (cancelled) return;

        // Build a renderer bound to THIS provider's api. Chart reads it from
        // context so the chart routes to this provider's engine, independent of
        // whatever renderer is registered in the global registry.
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
  }, [db, connection, connector]);

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
