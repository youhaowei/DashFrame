/**
 * Pipeline stage taxonomy for performance instrumentation.
 *
 * Stages name the boundaries we measure so that latency is *legible*: the goal
 * is not just "how slow" but "slow where". Friction in a BI tool is rarely raw
 * slowness — it is not knowing *why* something is slow. Stages exist so that
 * unowned waits (a connector fetch, a source-system query) can later carry
 * attributed progress ("fetching 40k rows from Notion…") instead of a generic
 * spinner.
 *
 * The data-execution stages mirror the Data Execution Pipeline:
 *   compile → place → execute → cache → transport
 * Shell stages (command-apply, render boundaries) are owned mechanics with
 * strict budgets. Connector/query stages are *unowned* waits — they carry no
 * budget, only attribution.
 */
export const PerfStage = {
  // --- Owned shell mechanics (strict budgets) ---
  /** A command dispatched against an artifact (optimistic apply). */
  CommandApply: "command-apply",
  /** A React render boundary in the shared renderer. */
  Render: "render",
  /** Input echo — keystroke, selection, hover acknowledgement. */
  InputEcho: "input-echo",

  // --- Data Execution Pipeline (compile → place → execute → cache → transport) ---
  /** Lowering an artifact definition into an executable query plan. */
  Compile: "compile",
  /** Routing/placement of the plan onto an execution engine. */
  Place: "place",
  /** Running the query against the engine. */
  Execute: "execute",
  /** Cache lookup / population around an execution. */
  Cache: "cache",
  /** Moving result rows across a process/network boundary. */
  Transport: "transport",

  // --- Unowned waits (attribution, not budgets) ---
  /** Fetching from an external connector (Notion, Postgres, …). */
  ConnectorFetch: "connector-fetch",
} as const;

export type PerfStage = (typeof PerfStage)[keyof typeof PerfStage];

/**
 * Latency budgets, in milliseconds. These are *measurement anchors* surfaced in
 * the dev HUD (green/amber/red), not hard failures — instrumentation never
 * throws or blocks on a budget. Strict budgets apply only to mechanics we own.
 *
 * Recorded from the v0.3 UI spec:
 *   - input echo → next frame (~16ms)
 *   - artifact mutation (command apply, optimistic) → <100ms perceived
 *   - data-backed update (re-render after definition change) → <500ms,
 *     progressive feedback beyond
 *
 * Agent turnaround carries NO budget — a *presence rule* applies instead
 * (streaming visible activity, never a dead spinner). Unowned connector/query
 * waits also carry no budget; the deliverable there is attribution.
 */
export const STAGE_BUDGET_MS: Partial<Record<PerfStage, number>> = {
  [PerfStage.InputEcho]: 16,
  [PerfStage.CommandApply]: 100,
  [PerfStage.Render]: 100,
  // Data-backed update: the full compile→transport chain has a 500ms anchor.
  // Attributed to Execute as the dominant owned segment; Connector/query stages
  // below are deliberately omitted (unowned → attribution, not a budget).
  [PerfStage.Compile]: 500,
  [PerfStage.Place]: 500,
  [PerfStage.Execute]: 500,
  [PerfStage.Cache]: 500,
  [PerfStage.Transport]: 500,
};

/**
 * Stages that are *unowned waits*: they get attributed progress in the UI, never
 * a budget-driven verdict. The HUD renders these neutrally (no green/amber/red).
 */
export const UNOWNED_STAGES: ReadonlySet<PerfStage> = new Set([
  PerfStage.ConnectorFetch,
]);

export type BudgetVerdict = "ok" | "warn" | "over" | "unowned";

/**
 * Classify a measured duration against its stage budget.
 * - `unowned` — stage has no budget (attribution-only).
 * - `ok` — within budget.
 * - `warn` — within 1.5× budget (approaching).
 * - `over` — beyond 1.5× budget.
 */
export function classifyDuration(
  stage: PerfStage,
  durationMs: number,
): BudgetVerdict {
  if (UNOWNED_STAGES.has(stage)) return "unowned";
  const budget = STAGE_BUDGET_MS[stage];
  if (budget == null) return "unowned";
  if (durationMs <= budget) return "ok";
  if (durationMs <= budget * 1.5) return "warn";
  return "over";
}
