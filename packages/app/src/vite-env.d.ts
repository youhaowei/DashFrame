// Vite `?url` asset imports resolve to a string URL on the app's own origin.
// Declared locally (the package doesn't depend on `vite`, so we can't reference
// `vite/client`) so DuckDB's local worker/wasm asset imports typecheck in any
// consumer of @dashframe/app (desktop renderer + web) — both Vite builds.
declare module "*?url" {
  const src: string;
  export default src;
}
