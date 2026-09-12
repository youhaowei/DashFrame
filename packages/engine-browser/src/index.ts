/**
 * @dashframe/engine-browser
 *
 * Browser-side Arrow helpers for local file ingest. Query execution lives on
 * the server native engine; this package does not instantiate DuckDB.
 *
 * Re-exports `@dashframe/engine` so CSV/JSON parsers can import types and
 * field helpers from one place.
 */

export * from "@dashframe/engine";

export { createArrowIPCBufferFromRows } from "./arrow";
export type { ArrowColumn } from "./arrow";
