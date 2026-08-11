/**
 * @dashframe/engine-server — the server-authoritative native execution path.
 *
 * Primary data plane for DashFrame: native DuckDB in the server process, shared
 * by desktop and web. The retained WASM implementation has no active product
 * mode.
 *
 * Five-stage pipeline (compile → place → execute → cache → transport):
 *
 *   - Stage 1 Compile   — `hashCompiledQuery` (content-addressing boundary)
 *   - Stage 2 Place     — `selectEngineBinding` (policy seam; active web and
 *                         desktop hosts both select the native server)
 *   - Stage 3 Execute   — `NativeDuckDBEngine` (native DuckDB QueryEngine)
 *   - Stage 4 Cache     — `ParquetCache` + `CacheWriteGate` seam (sensitivity gate, see #67)
 *   - Stage 5 Transport — `createArrowDataPath` (dedicated Arrow IPC HTTP path)
 *
 * Desktop constructs Stage 3+5 in Electron main; headless `serve` constructs
 * the same engine lazily at its runtime edge and injects it into the same path.
 *
 * Native module: this package depends on `@duckdb/node-api`, which must be
 * externalized from the Electron main bundle (and asar-unpacked if packaged).
 */

export { hashCompiledQuery, type CompiledQuery } from "./compile";

export {
  selectEngineBinding,
  type Deployment,
  type EngineBinding,
} from "./engine-selection";

export {
  NativeDuckDBEngine,
  type NativeDuckDBEngineOptions,
} from "./native-engine";

export {
  duckdbColumnsToArrowIpc,
  duckdbTypeIdToColumnType,
  type ResultColumn,
} from "./arrow-encode";

export {
  ParquetCache,
  identityCacheWriteGate,
  makeSensitivityCacheWriteGate,
  type CacheWriteGate,
  type ParquetCacheOptions,
} from "./parquet-cache";

export {
  ARROW_STREAM_CONTENT_TYPE,
  arrowIpcToJsonRows,
  createArrowDataPath,
  type ArrowDataPathOptions,
  type ArrowQueryRunner,
  type ArrowTableRegistrar,
} from "./arrow-data-path";

export { FileDataFrameStorage } from "./file-dataframe-storage";
