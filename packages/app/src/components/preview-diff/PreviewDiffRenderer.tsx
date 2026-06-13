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
      </div>
    </div>
  );
}

function DownstreamNodeRow({ node }: { node: PreviewDownstreamNode }) {
  const kindLabel = KIND_LABELS[node.kind];
  const flagColor = FLAG_COLORS[node.flag];
  const flagLabel = FLAG_LABELS[node.flag];

  return (
    <div className="flex items-center gap-2 py-1">
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
          <div className="rounded-[var(--surface-radius)] bg-neutral-bg/60 px-3 py-2">
            <div className="flex flex-col divide-y divide-neutral-border/30">
              {diff.affectedDownstream.map((node) => (
                <DownstreamNodeRow
                  key={`${node.kind}:${node.nodeId}`}
                  node={node}
                />
              ))}
            </div>
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
