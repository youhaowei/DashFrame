/// <reference types="vite/client" />

// Brings in Vite's ambient module declarations (notably `*?url` asset imports)
// so shared @dashframe/app code typechecks here. @dashframe/app introduces
// `?url` imports for DuckDB's local worker/wasm assets; web compiles that source
// via the `@/*` path map, so the declarations must be visible in this project.
