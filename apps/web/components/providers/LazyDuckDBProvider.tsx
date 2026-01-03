"use client";

import {
  createContext,
  useContext,
  useCallback,
  useState,
  useRef,
  useEffect,
} from "react";
import type * as duckdb from "@duckdb/duckdb-wasm";
import { initializeDuckDB } from "@/lib/duckdb/init";
import { clearAllTableCaches } from "@dashframe/engine-browser";
import { clearInsightViewCache } from "@/hooks/useInsightView";

interface LazyDuckDBContextValue {
  db: duckdb.AsyncDuckDB | null;
  connection: duckdb.AsyncDuckDBConnection | null;
  isInitialized: boolean;
  isLoading: boolean;
  error: Error | null;
  initDuckDB: () => Promise<void>;
}

const LazyDuckDBContext = createContext<LazyDuckDBContextValue>({
  db: null,
  connection: null,
  isInitialized: false,
  isLoading: false,
  error: null,
  initDuckDB: async () => {},
});

/**
 * Lazy DuckDB Provider that doesn't load DuckDB on mount.
 * Components trigger initialization by calling initDuckDB() from context.
 * This improves initial page load time by deferring the ~10MB WASM bundle
 * until it's actually needed.
 */
export function LazyDuckDBProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, setState] = useState<
    Omit<LazyDuckDBContextValue, "initDuckDB">
  >({
    db: null,
    connection: null,
    isInitialized: false,
    isLoading: false,
    error: null,
  });

  /** Prevent duplicate initialization attempts */
  const initRef = useRef(false);
  /** Ref to track live connection for cleanup */
  const connectionRef = useRef<duckdb.AsyncDuckDBConnection | null>(null);
  /** Ref to track live db instance for cleanup */
  const dbRef = useRef<duckdb.AsyncDuckDB | null>(null);

  /**
   * Initialize DuckDB on-demand.
   * Safe to call multiple times - will only initialize once.
   */
  const initDuckDB = useCallback(async () => {
    // Already initialized or currently initializing
    if (initRef.current || state.isInitialized || state.isLoading) {
      return;
    }

    initRef.current = true;

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const { db, connection } = await initializeDuckDB();

      // Clear table caches since this is a fresh DuckDB instance
      // Any previously cached tables no longer exist
      clearAllTableCaches();
      clearInsightViewCache();

      // Store in refs for cleanup access
      dbRef.current = db;
      connectionRef.current = connection;

      setState({
        db,
        connection,
        isInitialized: true,
        isLoading: false,
        error: null,
      });
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
  }, [state.isInitialized, state.isLoading]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Cleanup using refs to get live values
      connectionRef.current?.close();
      dbRef.current?.terminate();
      // Clear table caches since DuckDB instance is being destroyed
      clearAllTableCaches();
      clearInsightViewCache();
    };
  }, []);

  const contextValue: LazyDuckDBContextValue = {
    ...state,
    initDuckDB,
  };

  // Graceful error UI
  if (state.error) {
    return (
      <div className="border-destructive/50 bg-destructive/10 rounded-lg border p-6">
        <h2 className="text-destructive mb-2 text-lg font-semibold">
          Failed to initialize DuckDB engine
        </h2>
        <p className="text-muted-foreground mb-4 text-sm">
          {state.error.message}
        </p>
        <p className="text-muted-foreground text-xs">
          DashFrame will fall back to array-based processing. Try refreshing.
        </p>
      </div>
    );
  }

  return (
    <LazyDuckDBContext.Provider value={contextValue}>
      {children}
    </LazyDuckDBContext.Provider>
  );
}

/**
 * Hook to access lazy DuckDB context.
 * Provides db, connection, loading/error states, and initDuckDB() function.
 * Does NOT automatically trigger initialization - use useLazyDuckDB() for that.
 */
export const useDuckDBContext = () => useContext(LazyDuckDBContext);

/**
 * Hook that auto-initializes DuckDB on first call.
 * Components that need DuckDB should use this hook instead of useDuckDBContext.
 *
 * @returns DuckDB instance with { db, connection, isLoading, error }
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { db, connection, isLoading } = useLazyDuckDB();
 *
 *   if (isLoading) return <div>Loading DuckDB...</div>;
 *   if (!connection) return <div>DuckDB not available</div>;
 *
 *   // Use connection...
 * }
 * ```
 */
export function useLazyDuckDB() {
  const context = useContext(LazyDuckDBContext);
  const initCalledRef = useRef(false);

  // Auto-initialize on first call
  useEffect(() => {
    if (!initCalledRef.current && !context.isInitialized && !context.isLoading) {
      initCalledRef.current = true;
      context.initDuckDB();
    }
  }, [context]);

  return {
    db: context.db,
    connection: context.connection,
    isLoading: context.isLoading,
    isInitialized: context.isInitialized,
    error: context.error,
  };
}
