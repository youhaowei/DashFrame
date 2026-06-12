/**
 * Stage 2 — Place: engine selection policy, in exactly one place.
 *
 * The "server DuckDB" binding resolves per deployment to a concrete engine
 * backing. This is the single policy seam the spec pins down:
 *
 *   - desktop → native DuckDB in the loopback server process (this package).
 *   - web     → DuckDB-WASM playing the server role in-browser (no-server
 *               degenerate case; the renderer is the server).
 *   - cloud   → future, not yet a binding.
 *
 * Per-query cost-based engine routing is explicitly OUT of scope. Placement is
 * a deployment fact, not a per-query decision — so this is a pure function of
 * the deployment, nothing else. Keeping it here, and only here, is what makes
 * "where does a query run" a single legible seam instead of a hardcoded branch
 * re-decided at every call site.
 */

/** Which surface DashFrame is running on. */
export type Deployment = "desktop" | "web" | "cloud";

/**
 * The resolved engine backing for the server-authoritative engine service.
 *
 * - `native`  — native DuckDB over `@duckdb/node-api`, in the loopback server.
 * - `wasm`    — DuckDB-WASM in the renderer, playing the server role.
 * - `cloud`   — future remote compute (not yet implemented).
 */
export type EngineBinding = "native" | "wasm" | "cloud";

/**
 * Resolve the engine backing for a deployment. Total over `Deployment` — the
 * exhaustive switch is the policy. No inputs other than the deployment: there
 * is no per-query branch here, by design.
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
