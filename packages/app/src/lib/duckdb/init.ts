/**
 * Lazy DuckDB initialization module.
 *
 * Uses dynamic import to separate the ~10MB @duckdb/duckdb-wasm bundle from the
 * main chunk, so it only loads when first needed.
 *
 * Worker + wasm assets are bundled **locally** (via Vite `?url` imports below) —
 * never fetched from a CDN at runtime. This is required for the desktop
 * (Electron) build: the renderer loads from `file://`, and a runtime CDN
 * dependency would (a) fail entirely offline / behind a proxy and (b) stall the
 * duckdb-wasm worker handshake silently, because that protocol has no built-in
 * timeout. Local assets make init offline-correct, deterministic, and tighten
 * the supply chain.
 *
 * The worker is created from a **blob URL** that `importScripts()` the local
 * asset, rather than `new Worker(localUrl)` directly. On `file://` under COEP
 * `require-corp`, a worker loaded straight from a `file://` URL is blocked and
 * fails with an empty (untyped) error event — duckdb-wasm surfaces this as an
 * indefinite hang. A blob-URL worker inherits the document's origin and is
 * COEP-exempt, so it loads; pointing its `importScripts` at the local asset
 * keeps the whole thing same-origin and offline. This is the combination that
 * works in the sandboxed Electron renderer without weakening any boundary.
 *
 * `INIT_TIMEOUT_MS` caps a wedged instantiate so a stuck worker surfaces as an
 * error instead of hanging.
 */

import type * as duckdb from "@duckdb/duckdb-wasm";

// Local, same-origin worker + wasm assets. Vite rewrites each `?url` import to a
// hashed asset on the app's own origin (http(s):// in dev/web, file:// when
// packaged). selectBundle() picks the right variant from browser feature
// detection (coi → eh → mvp), exactly as it does for the CDN bundles.
import duckdbPthreadCoi from "@duckdb/duckdb-wasm/dist/duckdb-browser-coi.pthread.worker.js?url";
import duckdbWorkerCoi from "@duckdb/duckdb-wasm/dist/duckdb-browser-coi.worker.js?url";
import duckdbWorkerEh from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";
import duckdbWorkerMvp from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";
import duckdbWasmCoi from "@duckdb/duckdb-wasm/dist/duckdb-coi.wasm?url";
import duckdbWasmEh from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import duckdbWasmMvp from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";

/**
 * Hard cap on DuckDB instantiation. The duckdb-wasm worker handshake has no
 * internal timeout: if the worker wedges (corrupt asset, blocked Worker
 * construction, a wasm compile that never settles) `instantiate()` stays pending
 * forever, which is what made the failure silent on desktop. Reject past this
 * deadline so the caller can surface a real error state.
 */
const INIT_TIMEOUT_MS = 30_000;

/**
 * Locally-bundled DuckDB asset bundles, same shape as `getJsDelivrBundles()`
 * returns — but pointing at same-origin URLs instead of cdn.jsdelivr.net.
 */
function getLocalBundles(): duckdb.DuckDBBundles {
  return {
    mvp: {
      mainModule: duckdbWasmMvp,
      mainWorker: duckdbWorkerMvp,
    },
    eh: {
      mainModule: duckdbWasmEh,
      mainWorker: duckdbWorkerEh,
    },
    coi: {
      mainModule: duckdbWasmCoi,
      mainWorker: duckdbWorkerCoi,
      pthreadWorker: duckdbPthreadCoi,
    },
  };
}

/**
 * Custom DuckDB logger with cleaner console output.
 * Only logs warnings and errors by default to reduce console noise.
 * Set localStorage['dashframe:duckdb-verbose'] = 'true' for all logs.
 *
 * The module reference is set after dynamic import to avoid async delays
 * and ensure log entries are processed synchronously and in order.
 */
class DuckDBLogger implements duckdb.Logger {
  private _verbose: boolean | null = null;
  private duckdbModule: typeof duckdb | null = null;

  /** Lazy-evaluated verbose flag to avoid localStorage access during SSR */
  private get verbose(): boolean {
    if (this._verbose === null) {
      this._verbose =
        typeof window !== "undefined" &&
        localStorage.getItem("dashframe:duckdb-verbose") === "true";
    }
    return this._verbose;
  }

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

export interface DuckDBInstance {
  db: duckdb.AsyncDuckDB;
  connection: duckdb.AsyncDuckDBConnection;
}

/**
 * Build a worker from a same-origin blob that `importScripts()` the given local
 * asset URL. See the module header for why the blob indirection is required on
 * `file://` under COEP. Returns the worker plus its blob URL so the caller can
 * revoke it after the worker has loaded.
 */
function createBlobWorker(localAssetUrl: string): {
  worker: Worker;
  blobUrl: string;
} {
  const blobUrl = makeImportScriptsBlobUrl(localAssetUrl);
  return { worker: new Worker(blobUrl), blobUrl };
}

/**
 * A same-origin blob URL whose script `importScripts()` the given local asset.
 * Used both for the main worker and as the pthread worker URL handed to
 * AsyncDuckDB (which spawns its own pthread workers from it).
 *
 * The asset URL is absolutized against the document base first: Vite's `?url`
 * imports yield a path relative to the document origin (e.g. `/assets/x.js` in a
 * build, `/@fs/…` in dev), but `importScripts()` inside a blob worker resolves
 * its argument against the *blob* URL — where a root-relative path is invalid
 * ("The URL '…' is invalid"). An absolute URL resolves correctly from any
 * worker context.
 */
function makeImportScriptsBlobUrl(localAssetUrl: string): string {
  const absoluteUrl = new URL(localAssetUrl, document.baseURI).href;
  return URL.createObjectURL(
    new Blob([`importScripts(${JSON.stringify(absoluteUrl)});`], {
      type: "text/javascript",
    }),
  );
}

/**
 * Initialize DuckDB with lazy loading.
 *
 * Loads @duckdb/duckdb-wasm and its worker + wasm assets from the app's own
 * origin (no CDN), then instantiates under {@link INIT_TIMEOUT_MS} so a wedged
 * worker rejects instead of hanging forever.
 *
 * @returns Promise that resolves to an initialized DuckDB instance
 * @throws Error if initialization fails or exceeds the timeout
 */
export async function initializeDuckDB(): Promise<DuckDBInstance> {
  // Dynamic import - this is where the code splitting happens
  const duckdb = await import("@duckdb/duckdb-wasm");

  // selectBundle does feature detection (SIMD, exceptions, cross-origin
  // isolation) and returns same-origin URLs from our local bundles.
  const bundle = await duckdb.selectBundle(getLocalBundles());

  if (!bundle.mainWorker) {
    throw new Error("Selected DuckDB bundle is missing mainWorker URL");
  }

  // Blob-URL worker over the local asset (see createBlobWorker / module header).
  // Revoked after the worker has constructed; the Worker keeps its own copy.
  const { worker, blobUrl: mainWorkerBlobUrl } = createBlobWorker(
    bundle.mainWorker,
  );

  // The coi (multithreaded) bundle ships a pthread worker; eh/mvp don't.
  // AsyncDuckDB spawns pthread workers from this URL lazily, for the lifetime of
  // the DB, so its blob URL is intentionally NOT revoked here.
  const pthreadWorkerUrl = bundle.pthreadWorker
    ? makeImportScriptsBlobUrl(bundle.pthreadWorker)
    : undefined;

  // Create logger and set module reference for synchronous logging
  const logger = new DuckDBLogger();
  logger.setModule(duckdb);

  const db = new duckdb.AsyncDuckDB(logger, worker);

  // The worker fetches the wasm module by URL. `?url` yields a document-relative
  // path; the worker resolves it against its own (blob) origin, so it must be
  // absolutized — same reasoning as the importScripts URLs above.
  const mainModuleUrl = new URL(bundle.mainModule, document.baseURI).href;

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const instantiation = db.instantiate(mainModuleUrl, pthreadWorkerUrl);
    // If the timeout wins the race we abandon this promise; terminating the DB
    // below makes the worker handshake reject. Swallow that losing-side
    // rejection so it doesn't surface as an unhandled rejection (which Electron
    // reports as a visible error in the renderer and main process).
    instantiation.catch(() => {});

    await Promise.race([
      instantiation,
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () =>
            reject(
              new Error(
                `DuckDB failed to initialize within ${INIT_TIMEOUT_MS / 1000}s`,
              ),
            ),
          INIT_TIMEOUT_MS,
        );
      }),
    ]);

    // Create connection
    const connection = await db.connect();

    // Test query to ensure connection works
    await connection.query("SELECT 1 as test");

    return { db, connection };
  } catch (err) {
    // Tear the worker down so a failed attempt doesn't leak a wedged worker.
    // db.terminate() is async; await it and swallow any rejection so cleanup
    // never masks the original error.
    await db.terminate().catch(() => {});
    // The pthread blob URL is only kept alive for a *successful* coi init (the
    // running DB spawns from it). On failure it's revoked here so retries don't
    // accumulate leaked blob URLs.
    if (pthreadWorkerUrl) URL.revokeObjectURL(pthreadWorkerUrl);
    throw err;
  } finally {
    // The main worker has captured its script; the blob URL can go. (On the
    // success path the pthread blob URL is kept alive — duckdb spawns from it on
    // demand; the failure path revokes it in the catch above.)
    URL.revokeObjectURL(mainWorkerBlobUrl);
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}
