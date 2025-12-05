"use client";

import { createContext, useContext, useEffect, useState, useRef } from "react";
import * as duckdb from "@duckdb/duckdb-wasm";
import { clearAllTableCaches } from "@dashframe/dataframe";

/**
 * Custom DuckDB logger with cleaner console output.
 * Formats log entries as readable strings instead of raw objects.
 */
class DuckDBLogger implements duckdb.Logger {
  log(entry: duckdb.LogEntryVariant): void {
    const level = duckdb.getLogLevelLabel(entry.level);
    const topic = duckdb.getLogTopicLabel(entry.topic);
    const event = duckdb.getLogEventLabel(entry.event);
    const value = entry.value ? `: ${entry.value}` : "";

    const message = `[DuckDB] ${topic} ${event}${value}`;

    switch (entry.level) {
      case duckdb.LogLevel.ERROR:
        console.error(message);
        break;
      case duckdb.LogLevel.WARNING:
        console.warn(message);
        break;
      case duckdb.LogLevel.DEBUG:
        console.debug(message);
        break;
      default:
        console.log(message);
    }
  }
}

interface DuckDBContextValue {
  db: duckdb.AsyncDuckDB | null;
  connection: duckdb.AsyncDuckDBConnection | null;
  isInitialized: boolean;
  error: Error | null;
}

const DuckDBContext = createContext<DuckDBContextValue>({
  db: null,
  connection: null,
  isInitialized: false,
  error: null,
});

/**
 * Creates a worker from a CDN URL using blob URL workaround.
 * Bypasses CORS restrictions by creating a same-origin script
 * that uses importScripts() to load the actual worker code.
 */
function createWorkerFromCDN(workerUrl: string): {
  worker: Worker;
  blobUrl: string;
} {
  const blobUrl = URL.createObjectURL(
    new Blob([`importScripts("${workerUrl}");`], { type: "text/javascript" }),
  );
  return { worker: new Worker(blobUrl), blobUrl };
}

export function DuckDBProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DuckDBContextValue>({
    db: null,
    connection: null,
    isInitialized: false,
    error: null,
  });
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    let cancelled = false;
    const blobUrls: string[] = [];

    (async () => {
      try {
        // Select DuckDB bundle
        const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
        const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);

        // Create main worker via blob URL to avoid CORS
        const { worker, blobUrl } = createWorkerFromCDN(bundle.mainWorker!);
        blobUrls.push(blobUrl);

        // Handle pthread worker if present (for SharedArrayBuffer multithreading)
        let pthreadWorkerUrl = bundle.pthreadWorker;
        if (bundle.pthreadWorker) {
          const pthreadBlobUrl = URL.createObjectURL(
            new Blob([`importScripts("${bundle.pthreadWorker}");`], {
              type: "text/javascript",
            }),
          );
          blobUrls.push(pthreadBlobUrl);
          pthreadWorkerUrl = pthreadBlobUrl;
        }

        const logger = new DuckDBLogger();
        const db = new duckdb.AsyncDuckDB(logger, worker);
        await db.instantiate(bundle.mainModule, pthreadWorkerUrl);

        // Clean up blob URLs to prevent memory leaks
        blobUrls.forEach((url) => URL.revokeObjectURL(url));

        if (cancelled) return;

        // Create connection
        const conn = await db.connect();

        // Test query
        await conn.query("SELECT 1 as test");

        // Clear table caches since this is a fresh DuckDB instance
        // Any previously cached tables no longer exist
        clearAllTableCaches();

        if (cancelled) return;

        setState({
          db,
          connection: conn,
          isInitialized: true,
          error: null,
        });
      } catch (err) {
        // Clean up blob URLs on error
        blobUrls.forEach((url) => URL.revokeObjectURL(url));

        if (cancelled) return;

        console.error("Failed to initialize DuckDB:", err);
        setState({
          db: null,
          connection: null,
          isInitialized: false,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    })();

    return () => {
      cancelled = true;
      // Cleanup on unmount
      state.connection?.close();
    };
  }, []);

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
    <DuckDBContext.Provider value={state}>{children}</DuckDBContext.Provider>
  );
}

export const useDuckDB = () => useContext(DuckDBContext);
