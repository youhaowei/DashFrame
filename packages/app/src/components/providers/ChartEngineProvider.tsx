/**
 * ChartEngineProvider — surface-scoped chart compute injection point.
 *
 * The visualization system (Mosaic + vgplot) needs a DuckDB connection to run
 * chart queries. Which DuckDB it talks to is surface-scoped:
 *   - web tier / WASM  — no override; VisualizationSetup uses the WASM engine.
 *   - desktop tier     — the host supplies a Mosaic Connector that routes
 *                        chart queries to the native DuckDB engine via the
 *                        loopback Arrow IPC endpoint.
 *
 * The connector is injected here via context rather than via an `isElectron`
 * branch in components (see DESIGN.md anti-patterns). The desktop renderer
 * supplies a connector through its ProviderWrapper; the web host provides
 * nothing and VisualizationSetup falls back to WASM.
 *
 * The MosaicConnector shape mirrors `@uwdata/mosaic-core`'s `Connector`
 * interface, kept inline here so this package has no direct dep on mosaic-core.
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";

/**
 * Structural Mosaic Connector — subset of `@uwdata/mosaic-core` Connector.
 * The three query types Mosaic issues through a Coordinator:
 *   - default / 'arrow'  — chart-data query, returns Arrow IPC Table
 *   - 'exec'             — statement with no result (SET, CREATE TEMP ...)
 *   - 'json'             — query-planner call, returns row objects
 */
export interface MosaicConnector {
  query(query: { type?: "arrow"; sql: string }): Promise<unknown>;
  query(query: { type: "exec"; sql: string }): Promise<void>;
  query(query: {
    type: "json";
    sql: string;
  }): Promise<Record<string, unknown>[]>;
}

interface ChartEngineContextValue {
  /**
   * When set, VisualizationSetup bypasses DuckDB-WASM and wires this
   * connector into the Mosaic Coordinator instead.
   */
  connector: MosaicConnector | null;
  /**
   * Error surfaced when the native engine connector is unavailable.
   * Shown as a visible banner — never a raw engine string.
   */
  engineError: string | null;
  /**
   * Upload a named Arrow IPC table to the native engine's in-memory store.
   * Called by useInsightView before issuing chart queries that reference a
   * DataFrame table — ensures the native engine has the same tables the
   * renderer's WASM engine has.
   *
   * Only provided when a native connector is active; null on the WASM path.
   */
  uploadArrowTable:
    | ((name: string, arrowBytes: Uint8Array) => Promise<void>)
    | null;
}

const ChartEngineContext = createContext<ChartEngineContextValue>({
  connector: null,
  engineError: null,
  uploadArrowTable: null,
});

export interface ChartEngineProviderProps {
  connector: MosaicConnector | null;
  engineError?: string | null;
  /**
   * Upload function for Arrow IPC table registration on the native engine.
   * Should be provided alongside `connector` on the desktop path.
   * Omit (or pass null) on the web/WASM path.
   */
  uploadArrowTable?:
    | ((name: string, arrowBytes: Uint8Array) => Promise<void>)
    | null;
  children: ReactNode;
}

/**
 * Provide a custom Mosaic Connector for chart compute.
 * Desktop hosts supply a native-engine-backed connector here.
 * Web hosts do not mount this provider; VisualizationSetup falls back to WASM.
 */
export function ChartEngineProvider({
  connector,
  engineError = null,
  uploadArrowTable = null,
  children,
}: ChartEngineProviderProps) {
  // Memoize the context value. Without this, a fresh object literal every render
  // would change the context identity, forcing every useChartEngine() consumer
  // to re-render. In useInsightView that re-render re-runs the chart-query
  // effect (connector/uploadArrowTable are in its dep array) → setState →
  // re-render → infinite loop, which crashes the renderer on the visualization
  // route. The desktop host passes stable connector/uploadArrowTable references,
  // so this memo holds steady once mounted.
  const value = useMemo(
    () => ({ connector, engineError, uploadArrowTable }),
    [connector, engineError, uploadArrowTable],
  );

  return (
    <ChartEngineContext.Provider value={value}>
      {children}
    </ChartEngineContext.Provider>
  );
}

/**
 * Read the surface-scoped chart engine connector (or null for WASM default).
 */
export function useChartEngine(): ChartEngineContextValue {
  return useContext(ChartEngineContext);
}
