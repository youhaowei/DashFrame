import { clearInsightViewCache } from "@/hooks/useInsightView";
import { getServerDataPlane } from "@/lib/server-data-plane";
import {
  clearAllTableCaches,
  type DuckDBConnection,
} from "@dashframe/engine-browser";
import type * as duckdb from "@duckdb/duckdb-wasm";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

interface DuckDBContextValue {
  db: duckdb.AsyncDuckDB | null;
  connection: DuckDBConnection | null;
  isInitialized: boolean;
  isLoading: boolean;
  error: Error | null;
  initDuckDB: () => Promise<void>;
}

const DuckDBContext = createContext<DuckDBContextValue>({
  db: null,
  connection: null,
  isInitialized: false,
  isLoading: false,
  error: null,
  initDuckDB: async () => {},
});

/**
 * DuckDB Provider for the sole active v0.3 server-native data plane.
 * The retained WASM implementation is deliberately not selected here.
 */
export function DuckDBProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<Omit<DuckDBContextValue, "initDuckDB">>({
    db: null,
    connection: null,
    isInitialized: false,
    isLoading: false,
    error: null,
  });

  /** Prevent duplicate initialization attempts */
  const initRef = useRef(false);
  /** Ref to track live connection for cleanup */
  const connectionRef = useRef<DuckDBConnection | null>(null);
  /** Ref to read current state values without triggering callback re-creation */
  const stateRef = useRef(state);

  // Sync state to ref after every render to keep it current for stable callbacks.
  // Intentionally omits dependency array - this runs after every render to ensure
  // stateRef always has the latest state values for use in initDuckDB callback.
  useEffect(() => {
    stateRef.current = state;
  });

  /**
   * Initialize DuckDB on-demand.
   * Safe to call multiple times - will only initialize once.
   *
   * Uses refs to read state values to avoid recreating the callback when state changes,
   * which prevents unnecessary requestIdleCallback cleanup/re-registration cycles.
   */
  const initDuckDB = useCallback(async () => {
    // Already initialized or currently initializing
    // Read from ref to avoid callback dependency on state
    if (
      initRef.current ||
      stateRef.current.isInitialized ||
      stateRef.current.isLoading
    ) {
      return;
    }

    initRef.current = true;

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const serverConnection = getServerDataPlane();
      if (serverConnection) {
        clearAllTableCaches();
        clearInsightViewCache();
        const connection = serverConnection;
        connectionRef.current = connection;
        setState({
          db: null,
          connection,
          isInitialized: true,
          isLoading: false,
          error: null,
        });
        return;
      }
      throw new Error(
        "Native server data plane is not configured; DuckDB-WASM is suspended",
      );
    } catch (err) {
      console.error("Failed to initialize DuckDB:", err);
      setState({
        db: null,
        connection: null,
        isInitialized: false,
        isLoading: false,
        error: err instanceof Error ? err : new Error(String(err)),
      });
      // Reset ref so retry is possible
      initRef.current = false;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Cleanup using refs to get live values.
      // Wrap in try/catch to prevent unhandled errors if DuckDB is in an unexpected state.
      try {
        connectionRef.current?.close();
      } catch (err) {
        console.warn("Failed to close DuckDB connection during cleanup:", err);
      }
      // Clear table caches since DuckDB instance is being destroyed
      clearAllTableCaches();
      clearInsightViewCache();
    };
  }, []);

  // Bind the server connection during browser idle time so initial rendering
  // stays non-blocking while never activating the retained WASM engine.
  useEffect(() => {
    const startInit = () => {
      if (!initRef.current) {
        initDuckDB();
      }
    };

    if ("requestIdleCallback" in window) {
      const idleId = requestIdleCallback(startInit, { timeout: 2000 });
      return () => cancelIdleCallback(idleId);
    } else {
      // Fallback for browsers without requestIdleCallback
      const timeoutId = setTimeout(startInit, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [initDuckDB]);

  const contextValue: DuckDBContextValue = {
    ...state,
    initDuckDB,
  };

  // Always render children - DuckDB loads in background
  // Components that need DuckDB handle their own loading states
  return (
    <DuckDBContext.Provider value={contextValue}>
      {children}
    </DuckDBContext.Provider>
  );
}

/**
 * Hook to access DuckDB context with all fields including initDuckDB().
 * Most components should use useDuckDB() instead.
 */
export const useDuckDBContext = () => useContext(DuckDBContext);

/**
 * Hook to access DuckDB connection and state.
 * The server connection initializes eagerly when DuckDBProvider mounts.
 *
 * @returns DuckDB instance with { db, connection, isLoading, isInitialized, error }
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { connection, isLoading, isInitialized } = useDuckDB();
 *
 *   if (isLoading || !isInitialized) return <div>Loading DuckDB...</div>;
 *   if (!connection) return <div>DuckDB not available</div>;
 *
 *   // Use connection...
 * }
 * ```
 */
export function useDuckDB() {
  const context = useContext(DuckDBContext);

  return {
    db: context.db,
    connection: context.connection,
    isLoading: context.isLoading,
    isInitialized: context.isInitialized,
    error: context.error,
  };
}
