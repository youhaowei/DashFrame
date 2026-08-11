/**
 * ChartEngineProvider — surface-scoped chart compute injection point.
 *
 * The visualization system (Mosaic + vgplot) needs a DuckDB connection to run
 * chart queries. Web and desktop hosts both inject a Mosaic Connector that
 * routes those queries to native DuckDB through the server Arrow endpoint.
 *
 * The connector is injected here via context rather than via an `isElectron`
 * branch in components (see DESIGN.md anti-patterns).
 *
 * The MosaicConnector shape mirrors `@uwdata/mosaic-core`'s `Connector`
 * interface, kept inline here so this package has no direct dep on mosaic-core.
 */
import type { MosaicConnector } from "@dashframe/visualization";
import { createContext, useContext, useMemo, type ReactNode } from "react";

/**
 * Structural Mosaic Connector — subset of `@uwdata/mosaic-core` Connector.
 * The three query types Mosaic issues through a Coordinator:
 *   - default / 'arrow'  — chart-data query, returns Arrow IPC Table
 *   - 'exec'             — statement with no result (SET, CREATE TEMP ...)
 *   - 'json'             — query-planner call, returns row objects
 */
export type { MosaicConnector } from "@dashframe/visualization";

interface ChartEngineContextValue {
  /**
   * Server-native connector wired into the Mosaic Coordinator.
   */
  connector: MosaicConnector | null;
  /**
   * Error surfaced when the native engine connector is unavailable.
   * Shown as a visible banner — never a raw engine string.
   */
  engineError: string | null;
}

const ChartEngineContext = createContext<ChartEngineContextValue>({
  connector: null,
  engineError: null,
});

export interface ChartEngineProviderProps {
  connector: MosaicConnector | null;
  engineError?: string | null;
  children: ReactNode;
}

/**
 * Provide a custom Mosaic Connector for chart compute.
 * Both hosts supply a native-engine-backed connector here.
 */
export function ChartEngineProvider({
  connector,
  engineError = null,
  children,
}: ChartEngineProviderProps) {
  // Memoize the context value. Without this, a fresh object literal every render
  // would change the context identity, forcing every useChartEngine() consumer
  // to re-render. Hosts pass stable connector references, so this memo holds
  // steady once mounted.
  const value = useMemo(
    () => ({ connector, engineError }),
    [connector, engineError],
  );

  return (
    <ChartEngineContext.Provider value={value}>
      {children}
    </ChartEngineContext.Provider>
  );
}

/**
 * Read the server chart connector.
 */
export function useChartEngine(): ChartEngineContextValue {
  return useContext(ChartEngineContext);
}
