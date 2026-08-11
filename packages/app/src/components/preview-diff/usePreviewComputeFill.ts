import type { PreviewDiff } from "@dashframe/types";

/**
 * Preview diffs are metadata-only in the renderer. Computing speculative rows
 * locally would reintroduce a browser DuckDB data plane; the server publishes
 * immutable DataFrames only after the command is run.
 */
export function usePreviewComputeFill(diff: PreviewDiff | null): {
  diff: PreviewDiff | null;
  allResolved: boolean;
} {
  return { diff, allResolved: true };
}
