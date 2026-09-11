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
 *                 ownership check. The frame route registers each frame under
 *                 its canonical table name (`frameTableName(id)`) and passes
 *                 the caller's SQL to the engine unchanged; callers must
 *                 reference that canonical name themselves.
 *                 `createServerFrameConnector` does the UUID-to-table-name
 *                 substitution before it sends a request down this path.
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
 * The frame naming contract, re-exported from `@dashframe/engine`, which owns
 * the only definition. Consumers of the transport need the name the transport
 * registers under, and this saves them a second dependency for one function.
 */
export { frameTableName } from "@dashframe/engine";

export {
  ARROW_STREAM_CONTENT_TYPE,
  arrowIpcToJsonRows,
  createArrowDataPath,
  type ArrowDataPathOptions,
} from "./arrow-data-path";

export { FileDataFrameStorage } from "./file-dataframe-storage";
