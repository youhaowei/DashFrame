/**
 * Stage 2 — Place: engine selection policy, in exactly one place.
 *
 * **Direction (unified data plane):** native DuckDB in the server process is the
 * primary engine for both desktop and web. WASM stays as an explicit backup /
 * local-first mode, not the silent web default. Cloud remote compute is a later
 * binding that reuses the same server-side engine seam.
 *
 * **What this function returns today** (current wiring, not the end state):
 *
 *   - desktop → `native` (loopback server process; this package).
 *   - web     → `wasm` (renderer still plays the server role — transitional).
 *   - cloud   → `cloud` (not implemented yet).
 *
 * Flipping web to `native` (headless serve + Arrow data path) is unified-plane
 * work; until then this table documents the live default so call sites stay
 * honest. Prefer an explicit engine-mode config over re-deriving policy at
 * every call site.
 *
 * Per-query cost-based engine routing is explicitly OUT of scope. Placement is
 * a deployment / config fact, not a per-query decision.
 */

/** Which surface DashFrame is running on. */
export type Deployment = "desktop" | "web" | "cloud";

/**
 * The resolved engine backing for the engine service.
 *
 * - `native`  — native DuckDB over `@duckdb/node-api`, in the server process
 *               (primary path for desktop today; intended primary for web too).
 * - `wasm`    — DuckDB-WASM backup / transitional web path in the renderer.
 * - `cloud`   — future remote compute (not yet implemented).
 */
export type EngineBinding = "native" | "wasm" | "cloud";

/**
 * Resolve the engine backing for a deployment. Total over `Deployment` —
 * exhaustive switch is the current default policy. No inputs other than the
 * deployment: there is no per-query branch here, by design.
 *
 * Returns today's defaults (web still `wasm`). Callers that need the unified
 * server path for web must use explicit engine-mode config once that lands —
 * do not treat this map as the product end-state.
 */
export function selectEngineBinding(deployment: Deployment): EngineBinding {
  switch (deployment) {
    case "desktop":
      return "native";
    case "web":
      return "wasm";
    case "cloud":
      return "cloud";
  }
}
