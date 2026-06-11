/**
 * @dashframe/engine-server — the server-authoritative native execution path.
 *
 * Implements the five-stage data pipeline (compile → place → execute → cache →
 * transport) for the Electron desktop / `dashframe serve` deployment:
 *
 *   - Stage 1 Compile   — `hashCompiledQuery` (content-addressing boundary)
 *   - Stage 2 Place     — `selectEngineBinding` (engine selection policy, one place)
 *   - Stage 3 Execute   — `NativeDuckDBEngine` (native DuckDB QueryEngine)
 *   - Stage 4 Cache     — `ParquetCache` + `CacheWriteGate` seam (YW-130 plugs in)
 *   - Stage 5 Transport — `createArrowDataPath` (dedicated Arrow IPC HTTP path)
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
  type CacheWriteGate,
  type ParquetCacheOptions,
} from "./parquet-cache";

export {
  ARROW_STREAM_CONTENT_TYPE,
  createArrowDataPath,
  type ArrowDataPathOptions,
  type ArrowQueryRunner,
} from "./arrow-data-path";
