/**
 * PreviewDiffRenderer — the consent surface for a PreviewDiff.
 *
 * Renders the artifact-grouped diff a human reviews before publishing a command
 * batch. The renderer is the structural consumer of the two additions from #65:
 *   - `name` on every direct + downstream node — no bare UUIDs in the blast-radius
 *     list; the reviewer sees recognizable artifact names.
 *   - `error` slot on the diff — when a command in the batch fails during preview,
 *     the reviewer sees which commands would apply and which one fails, so they can
 *     fix the batch before publishing. Batches stay all-or-nothing.
 *
 * SPLIT-TIER: this component never initiates data fetches. The `compute` slot on
 * direct nodes is filled lazily by the caller (client-side DuckDB); this component
 * renders whatever is present and leaves the slot empty when absent.
 */

import type {
  ArtifactKind,
  PreviewCompute,
  PreviewDiff,
  PreviewDirectNode,
  PreviewDownstreamNode,
} from "@dashframe/types";
import { Badge, cn } from "@wystack/ui";

// ---------------------------------------------------------------------------
// Kind labels — human-readable kind names for the consent surface
// ---------------------------------------------------------------------------

const KIND_LABELS: Record<ArtifactKind, string> = {
  dataSource: "Data Source",
  dataTable: "Data Table",
  insight: "Insight",
  dataFrame: "Data Frame",
  visualization: "Visualization",
  dashboard: "Dashboard",
};

const CHANGE_LABELS: Record<PreviewDirectNode["change"], string> = {
  create: "New",
  update: "Changed",
  noop: "Unchanged",
};

const CHANGE_COLORS: Record<
  PreviewDirectNode["change"],
  "success" | "primary" | "secondary"
> = {
  create: "success",
  update: "primary",
  noop: "secondary",
};

const FLAG_COLORS: Record<
  PreviewDownstreamNode["flag"],
  "warning" | "secondary" | "danger"
> = {
  recompute: "warning",
  stale: "secondary",
  orphaned: "danger",
};

const FLAG_LABELS: Record<PreviewDownstreamNode["flag"], string> = {
  recompute: "Will recompute",
  stale: "Stale",
  orphaned: "Orphaned",
};

// ---------------------------------------------------------------------------
// Compute display helpers
// ---------------------------------------------------------------------------

/**
 * Row count delta summary — "+12 rows" / "−3 rows" / "unchanged".
 * Only emitted when both before and after counts are non-null.
 */
function RowCountDelta({
  before,
  after,
}: {
  before: number | null;
  after: number | null;
}) {
  if (after === null) return null;

  if (before === null) {
    // Create node: no before count.
    return (
      <span className="text-xs text-palette-success">
        {after.toLocaleString()} rows
      </span>
    );
  }

  const delta = after - before;
  if (delta === 0) {
    return (
      <span className="text-xs text-neutral-fg/60">
        {after.toLocaleString()} rows (unchanged)
      </span>
    );
  }
  const sign = delta > 0 ? "+" : "−";
  const absStr = Math.abs(delta).toLocaleString();
  const colorClass = delta > 0 ? "text-palette-success" : "text-palette-danger";
  return (
    <span className={cn("text-xs", colorClass)}>
      {after.toLocaleString()} rows ({sign}
      {absStr})
    </span>
  );
}

/**
 * A head-rows sample table for the compute display.
 * Renders the first N rows of the proposed result as a compact table.
 */
function HeadTable({ head }: { head: Array<Record<string, unknown>> }) {
  if (head.length === 0) return null;
  const columns = Object.keys(head[0] ?? {});
  if (columns.length === 0) return null;

  return (
    <div className="mt-2 overflow-x-auto rounded-[var(--surface-radius)] bg-neutral-bg/40">
      <table className="w-full text-[11px]">
        <thead>
          {/* Header band — a slightly stronger surface tint separates it from
              the body rows. No borders (surface system: elevation/tint only). */}
          <tr className="bg-neutral-bg/70">
            {columns.map((col) => (
              <th
                key={col}
                className="px-2 py-1 text-left font-semibold text-neutral-fg/60"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {head.map((row, rowIdx) => (
            // Zebra banding via background tint — readable row separation with
            // no borders (surface system).
            <tr
              key={rowIdx}
              className={rowIdx % 2 === 1 ? "bg-neutral-bg/30" : undefined}
            >
              {columns.map((col) => (
                <td key={col} className="px-2 py-1 text-neutral-fg/80">
                  {row[col] === null || row[col] === undefined ? (
                    <span className="text-neutral-fg/30">null</span>
                  ) : (
                    String(row[col])
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The compute display for a direct node — shows row counts and head rows.
 * When compute is `undefined` (pending), shows a pending indicator.
 * Only rendered for insight nodes (the only kind with computable DuckDB views).
 */
function ComputeDisplay({
  compute,
  change,
  kind,
}: {
  compute: PreviewCompute | undefined;
  change: PreviewDirectNode["change"];
  kind: ArtifactKind;
}) {
  // Only insight nodes have compute — other kinds have no DuckDB view.
  if (kind !== "insight") return null;
  // noop nodes don't change — no compute display.
  if (change === "noop") return null;

  if (compute === undefined) {
    return (
      <div className="mt-2 flex items-center gap-1.5 text-xs text-neutral-fg/50">
        <span
          className="inline-block h-2 w-2 animate-pulse rounded-full bg-neutral-fg/30"
          aria-label="Computing..."
        />
        Computing row counts…
      </div>
    );
  }

  // RESOLVED-but-empty: compute ran but couldn't produce a result (missing base
  // table, un-resolvable proposed source, or SQL build failure). Distinguish
  // this from PENDING so the reviewer isn't stuck on an infinite spinner. Calm,
  // on-token, no raw error string (DESIGN.md "raw runtime errors" anti-pattern).
  if (compute.rowCountAfter === null && compute.head.length === 0) {
    return (
      <div className="mt-2 text-xs text-neutral-fg/50">
        Preview unavailable — couldn't compute row counts for this change.
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-1">
      <RowCountDelta
        before={compute.rowCountBefore}
        after={compute.rowCountAfter}
      />
      <HeadTable head={compute.head} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PreviewDiffRendererProps {
  diff: PreviewDiff;
  className?: string;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DirectNodeRow({ node }: { node: PreviewDirectNode }) {
  const changeLabel = CHANGE_LABELS[node.change];
  const kindLabel = KIND_LABELS[node.kind];

  return (
    <div className="flex items-start gap-3 rounded-[var(--surface-radius)] bg-neutral-bg/60 px-3 py-2">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {/* Name + kind badge — no bare UUID */}
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-neutral-fg">
            {node.name || node.nodeId}
          </span>
          <Badge variant="soft" color="secondary" className="shrink-0 text-xs">
            {kindLabel}
          </Badge>
          <Badge
            variant="soft"
            color={CHANGE_COLORS[node.change]}
            className="shrink-0 text-xs"
          >
            {changeLabel}
          </Badge>
        </div>
        {/* Intent lines */}
        {node.intent.length > 0 && (
          <ul className="ml-0 list-none space-y-0.5">
            {node.intent.map((intent, i) => (
              <li
                key={`${intent.command}-${i}`}
                className="text-xs text-neutral-fg/70"
                title={intent.command}
              >
                {intent.summary}
              </li>
            ))}
          </ul>
        )}
        {/* Compute display — row counts + head sample (insight nodes only) */}
        <ComputeDisplay
          compute={node.compute}
          change={node.change}
          kind={node.kind}
        />
      </div>
    </div>
  );
}

function DownstreamNodeRow({ node }: { node: PreviewDownstreamNode }) {
  const kindLabel = KIND_LABELS[node.kind];
  const flagColor = FLAG_COLORS[node.flag];
  const flagLabel = FLAG_LABELS[node.flag];

  return (
    <div className="flex items-center gap-2 rounded-[var(--surface-radius)] bg-neutral-bg/60 px-3 py-1.5">
      <span className="min-w-0 flex-1 truncate text-sm text-neutral-fg/80">
        {node.name || node.nodeId}
      </span>
      <Badge variant="soft" color="secondary" className="shrink-0 text-xs">
        {kindLabel}
      </Badge>
      <Badge variant="soft" color={flagColor} className="shrink-0 text-xs">
        {flagLabel}
      </Badge>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Renders a PreviewDiff as a consent surface — direct nodes (what the batch
 * changes) and downstream blast radius (what would be affected). When the diff
 * carries a partial-failure `error`, it is shown prominently so the reviewer
 * knows which command fails and what to fix before publishing.
 */
export function PreviewDiffRenderer({
  diff,
  className,
}: PreviewDiffRendererProps) {
  const hasDirectNodes = diff.directNodes.length > 0;
  const hasDownstream = diff.affectedDownstream.length > 0;
  const hasError = diff.error !== undefined;

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {/* Partial-failure banner — shown first so the reviewer can't miss it */}
      {hasError && (
        <div
          role="alert"
          className="rounded-[var(--surface-radius)] bg-neutral-bg/80 px-4 py-3 shadow-[var(--surface-shadow)]"
        >
          <p className="text-sm font-semibold text-palette-danger">
            Command {diff.error!.commandIndex + 1} failed
          </p>
          <p className="mt-1 text-xs text-neutral-fg/70">
            {diff.error!.message}
          </p>
          {hasDirectNodes && (
            <p className="mt-2 text-xs text-neutral-fg/60">
              The commands below would apply before the failure. Batches are
              all-or-nothing — nothing persists until the batch is fixed.
            </p>
          )}
        </div>
      )}

      {/* Direct nodes — what the batch touches */}
      {hasDirectNodes && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-fg/50">
            {hasError ? "Would change" : "Changes"}
          </h3>
          <div className="flex flex-col gap-1.5">
            {diff.directNodes.map((node) => (
              <DirectNodeRow key={`${node.kind}:${node.nodeId}`} node={node} />
            ))}
          </div>
        </section>
      )}

      {/* Downstream blast radius — flagged only, no compute */}
      {hasDownstream && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-fg/50">
            Also affected
          </h3>
          {/* Row separation via surface tint, not borders/divide-y (surface
              system: elevation + tint only, no borders). */}
          <div className="flex flex-col gap-0.5">
            {diff.affectedDownstream.map((node) => (
              <DownstreamNodeRow
                key={`${node.kind}:${node.nodeId}`}
                node={node}
              />
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {!hasDirectNodes && !hasError && (
        <p className="text-sm text-neutral-fg/50">No changes in this batch.</p>
      )}
    </div>
  );
}
