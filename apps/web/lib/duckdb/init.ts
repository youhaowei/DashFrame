/**
 * Lazy DuckDB initialization module.
 * Uses dynamic import to separate the ~10MB @duckdb/duckdb-wasm bundle from the main chunk.
 * This improves initial page load time by only loading DuckDB when needed.
 */

import type * as duckdb from "@duckdb/duckdb-wasm";

/**
 * Custom DuckDB logger with cleaner console output.
 * Only logs warnings and errors by default to reduce console noise.
 * Set localStorage['dashframe:duckdb-verbose'] = 'true' for all logs.
 *
 * The module reference is set after dynamic import to avoid async delays
 * and ensure log entries are processed synchronously and in order.
 */
class DuckDBLogger implements duckdb.Logger {
  private verbose =
    typeof window !== "undefined" &&
    localStorage.getItem("dashframe:duckdb-verbose") === "true";

  private duckdbModule: typeof duckdb | null = null;

  /** Set the DuckDB module reference after dynamic import */
  setModule(module: typeof duckdb): void {
    this.duckdbModule = module;
  }

  log(entry: duckdb.LogEntryVariant): void {
    // Skip logging if module not yet loaded (shouldn't happen in practice)
    if (!this.duckdbModule) return;

    const level = this.duckdbModule.getLogLevelLabel(entry.level);
    const topic = this.duckdbModule.getLogTopicLabel(entry.topic);
    const event = this.duckdbModule.getLogEventLabel(entry.event);
    const value = entry.value ? `: ${entry.value}` : "";

    const message = `[DuckDB][${level}] ${topic} ${event}${value}`;

    switch (entry.level) {
      case this.duckdbModule.LogLevel.ERROR:
        console.error(message);
        break;
      case this.duckdbModule.LogLevel.WARNING:
        console.warn(message);
        break;
      case this.duckdbModule.LogLevel.DEBUG:
      default:
        if (this.verbose) console.debug(message);
        break;
    }
  }
}

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

export interface DuckDBInstance {
  db: duckdb.AsyncDuckDB;
  connection: duckdb.AsyncDuckDBConnection;
}

/**
 * Initialize DuckDB with lazy loading.
 * Uses dynamic import to load @duckdb/duckdb-wasm only when called.
 *
 * @returns Promise that resolves to initialized DuckDB instance
 * @throws Error if initialization fails
 */
export async function initializeDuckDB(): Promise<DuckDBInstance> {
  // Dynamic import - this is where the code splitting happens
  const duckdb = await import("@duckdb/duckdb-wasm");

  const blobUrls: string[] = [];

  try {
    // Select DuckDB bundle
    const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
    const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);

    // Defensive check for mainWorker URL
    if (!bundle.mainWorker) {
      throw new Error("Selected DuckDB bundle is missing mainWorker URL");
    }

    // Create main worker via blob URL to avoid CORS
    const { worker, blobUrl } = createWorkerFromCDN(bundle.mainWorker);
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

    // Create logger and set module reference for synchronous logging
    const logger = new DuckDBLogger();
    logger.setModule(duckdb);

    const db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule, pthreadWorkerUrl);

    // Clean up blob URLs to prevent memory leaks
    blobUrls.forEach((url) => URL.revokeObjectURL(url));

    // Create connection
    const connection = await db.connect();

    // Test query to ensure connection works
    await connection.query("SELECT 1 as test");

    return { db, connection };
  } catch (err) {
    // Clean up blob URLs on error
    blobUrls.forEach((url) => URL.revokeObjectURL(url));
    throw err;
  }
}
