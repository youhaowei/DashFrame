/**
 * @dashframe/engine-server — the server-authoritative native execution path.
 *
 * Primary data plane for DashFrame: native DuckDB in the server process, shared
 * by desktop and web.
 *
 * Two things run here:
 *
 *   - Execute   — `NativeDuckDBEngine`, an Arrow-native `QueryEngine` backing
 *                 over `@duckdb/node-api`, plus the DuckDB-to-Arrow encoding it
 *                 returns results in.
 *   - Transport — `createArrowDataPath`, the HTTP Arrow IPC door onto that same
 *                 engine. It owns authentication, request shape and the frame
 *                 ownership check; it never inspects or rewrites SQL.
 *
 * Placement is not decided here. The engine is bound where it is constructed,
 * by availability: a host that can reach a server engine uses it, and the WASM
 * backing is the explicit backup rung a caller opts into. There is no
 * per-surface table and nothing platform-detects.
 *
 * Desktop constructs the engine and the data path in Electron main; headless
 * `serve` constructs the same engine lazily at its runtime edge and injects it
 * into the same path.
 *
 * Native module: this package depends on `@duckdb/node-api`, which must be
 * externalized from the Electron main bundle (and asar-unpacked if packaged).
 */

export {
  NativeDuckDBEngine,
  type NativeDuckDBEngineOptions,
} from "./native-engine";

export {
  duckdbColumnsToArrowIpc,
  duckdbTypeIdToColumnType,
  type ResultColumn,
} from "./arrow-encode";

/**
 * The frame naming contract, re-exported from `@dashframe/engine` where it is
 * defined. Consumers of the transport need the name the transport registers
 * under; there is still exactly one definition.
 */
export { frameTableName } from "@dashframe/engine";

export {
  ARROW_STREAM_CONTENT_TYPE,
  arrowIpcToJsonRows,
  createArrowDataPath,
  type ArrowDataPathOptions,
} from "./arrow-data-path";

export { FileDataFrameStorage } from "./file-dataframe-storage";
