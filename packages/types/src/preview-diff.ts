/**
 * PreviewDiff — the renderable, artifact-grouped diff a human reviews
 * before publishing a command batch.
 *
 * Produced by the Layer-B `buildPreviewDiff` wrapper (apps/server) over
 * `@wystack/server`'s `applyCommands(batch, { mode: 'preview' })` MECHANISM
 * (execute-then-rollback). The mechanism returns a vocabulary-free
 * `PreviewResult` (which paths ran, what tables they touched); THIS type is the
 * DashFrame-specific reading: grouped by the artifact node each command touches,
 * carrying intent lines + the proposed definition, plus the downstream blast
 * radius walked from the implicit artifact DAG.
 *
 * SPLIT-TIER (settled architecture — do not re-embed data here): the server
 * assembles and returns this skeleton METADATA ONLY — direct nodes with their
 * proposed definitions + affected-downstream flags. It does NOT compute or
 * embed row data. The WyStack RPC boundary carries metadata; data rides its own
 * path. The renderer fills the `compute` slot lazily on preview-open via local
 * DuckDB, resolving from the proposed definition VALUE (the insight IR→SQL path
 * takes a definition value, not a persisted id — so it works AFTER the preview
 * transaction has rolled the canonical graph back). Hence `compute` is typed as
 * an explicitly-deferred slot: `undefined` everywhere the server produces, a
 * `PreviewCompute` once the client has filled it.
 */

import type { UUID } from "./uuid";

/**
 * The artifact node kinds the diff distinguishes. Mirrors the persisted artifact
 * tables (`data_sources`, `data_tables`, `insights`, `data_frames`,
 * `visualizations`, `dashboards`). A command's target id resolves to exactly one
 * of these.
 */
export type ArtifactKind =
  | "dataSource"
  | "dataTable"
  | "insight"
  | "dataFrame"
  | "visualization"
  | "dashboard";

/**
 * What a polymorphic `RenameNode` ACTUALLY resolved to, reported by the handler
 * itself. The `renameNode` mutation probes the live transaction (canonical rows
 * UNIONed with anything earlier commands in the same batch created) in a fixed
 * kind order and renames the first hit. That resolution is data the preview
 * MUST read rather than re-derive: the preview reads canonical and in-batch
 * state through separate lookups and can never reproduce a single merged-tx
 * probe (public issue #64 — every mirroring attempt diverged). The handler
 * surfaces this on its result so the preview builder reads the decision instead
 * of guessing it.
 */
export interface RenamedTarget {
  kind: ArtifactKind;
  id: UUID;
}

/**
 * One intent line on a direct node — the human-legible "what this command does",
 * derived from the command name + the slice of args that changed. The renderer
 * shows these verbatim above the before/after drill-down. `command` is the
 * vocabulary command NAME (e.g. "RenameNode") so the UI can group/icon by op.
 */
export interface PreviewIntent {
  /** The vocabulary command name that produced this intent (e.g. "AddField"). */
  command: string;
  /** Human-readable summary of the change ("Rename to \"Q1 Revenue\""). */
  summary: string;
}

/**
 * The deferred compute slot — filled CLIENT-SIDE on preview-open, never by the
 * server. Encodes the verifiability layer the spec calls for: a row count
 * before/after the change plus a `head(n)` sample so a plausibly-wrong edit is
 * caught by eye, not just read as legible. The server always emits `undefined`
 * here; the renderer resolves it from `proposedDefinition` against local DuckDB.
 */
export interface PreviewCompute {
  /** Canonical (pre-change) row count, or null if the node produced no rows before. */
  rowCountBefore: number | null;
  /** Proposed (post-change) row count computed from the proposed definition. */
  rowCountAfter: number | null;
  /** A `head(n)` sample of the proposed result — column-major rows for the renderer. */
  head: Array<Record<string, unknown>>;
}

/**
 * A node a command DIRECTLY touches — fully shown. Carries the intent lines, the
 * before/after definition slices for drill-down, and the (deferred) compute
 * slot. `proposedDefinition` is the metadata the client needs to fill `compute`
 * lazily — for an Insight it is the IR the renderer lowers to SQL; for a
 * DataTable it is the field/metric/schema metadata. It is captured from the
 * COMMAND ARGS (the proposed value), not read back from the DB (the preview
 * transaction has rolled back — canonical is untouched).
 */
export interface PreviewDirectNode {
  nodeId: UUID;
  kind: ArtifactKind;
  /**
   * Human-readable artifact name for the consent surface. For `create` nodes
   * this is the proposed name from the command args. For `update` and `noop`
   * nodes it is the canonical name from the `before` slice. Never a bare UUID —
   * the reviewer must be able to identify the artifact without cross-referencing
   * the DB. See #65.
   */
  name: string;
  /**
   * What the batch does to this node's canonical row:
   * - `create`  — the node is minted by this batch (no canonical row before).
   * - `update`  — an existing canonical row is mutated.
   * - `noop`    — a get-or-create resolved to an existing row and wrote nothing.
   *   The node is shown for transparency (e.g. an idempotent import touched it)
   *   but contributes NO change: `proposedDefinition` is empty and it does not
   *   seed the downstream blast-radius walk. The renderer renders it "unchanged".
   */
  change: "create" | "update" | "noop";
  /** One line per command targeting this node, in batch order. */
  intent: PreviewIntent[];
  /**
   * The canonical (pre-batch) definition slice. `null` only for `create` (no row
   * existed). For `update` and `noop` it is the existing canonical row. Read from
   * the untouched canonical DB.
   */
  before: Record<string, unknown> | null;
  /**
   * The proposed (post-batch) definition slice, assembled from the command args.
   * The client resolves `compute` from this VALUE. Empty `{}` for a `noop` node
   * (the get-or-create wrote nothing, so there is no proposed change).
   */
  proposedDefinition: Record<string, unknown>;
  /**
   * Deferred compute — `undefined` from the server, filled client-side on
   * preview-open. The split-tier boundary: metadata over RPC, data over DuckDB.
   */
  compute?: PreviewCompute | undefined;
}

/**
 * How a downstream node is affected — the flag carried on each
 * `PreviewDownstreamNode`, not the compute itself.
 *
 * - `recompute`: an upstream definition changed, so this node's result would
 *   change on the next evaluation. The most severe flag; the renderer should
 *   prompt the user to re-run.
 * - `stale`: an upstream change leaves this node's cached/derived data out of
 *   date but still structurally valid. The renderer shows it as stale.
 * - `orphaned`: an upstream node this node depends on is being REMOVED. The
 *   reference will dangle after commit. **RESERVED — not yet emitted.** The
 *   preview vocabulary has no delete command yet, so no path through
 *   `buildPreviewDiff` currently produces `orphaned`. Renderer authors MUST
 *   NOT build UI affordances that only fire on `orphaned` — they will never
 *   trigger until a delete command is added to the vocabulary and the DAG walk
 *   is extended to emit this flag.
 */
export type DownstreamFlag = "recompute" | "orphaned" | "stale";

/**
 * The implicit DAG edge by which a downstream node was reached from a touched
 * node. Named so the renderer can explain the lineage ("affected because it
 * queries the changed table") and so the traversal is auditable, not magic.
 */
export type DownstreamEdge =
  | "dataSource->dataTable" // FK data_tables.data_source_id
  | "dataTable->insight" // insight.definition baseTableId / joins[].rightTableId
  | "insight->insight" // insight.definition baseTableId (source.sourceType 'insight')
  | "insight->dataFrame" // FK data_frames.insight_id
  | "insight->visualization" // FK visualizations.insight_id
  | "visualization->dashboard" // dashboards.layout[].visualizationId
  | "parentArtifact"; // cross-cutting parent_artifact_id lineage pointer

/**
 * A node downstream of a touched node — FLAGGED ONLY, never computed (the spec's
 * "affectedDownstream[] flagged, not computed" rule). The renderer surfaces the
 * blast radius without paying compute for every transitively-affected node.
 */
export interface PreviewDownstreamNode {
  nodeId: UUID;
  kind: ArtifactKind;
  /**
   * Human-readable artifact name for the consent surface. Read from the
   * canonical DB row at DAG-walk time — the reviewer must be able to identify
   * the affected artifact without cross-referencing the DB. See #65.
   */
  name: string;
  /** The edge by which this node was reached from the directly-touched node. */
  edge: DownstreamEdge;
  /**
   * The direct node whose change propagated to this one — identified by both
   * kind AND id. A batch can legitimately create two artifacts that share a
   * client-minted UUID under different kinds (e.g. CreateDataSource(X) +
   * CreateDataTable(X)); the preview builder keys direct nodes as
   * `${kind}:${id}` for exactly this reason. Carrying only `id` here would
   * leave a renderer unable to resolve which of those two direct nodes owns
   * the blast radius. The structural identity mirrors the key the builder
   * already uses internally.
   */
  via: { kind: ArtifactKind; id: UUID };
  flag: DownstreamFlag;
}

/**
 * Partial-failure slot on the PreviewDiff. Set when command `commandIndex` of
 * the batch threw during preview. Batches stay all-or-nothing (no change to
 * the canonical DB); this is purely representational — the reviewer sees which
 * commands would apply and which one fails, so they can fix the batch before
 * publishing. See #65.
 */
export interface PreviewError {
  /** 0-based index of the first command that threw. */
  commandIndex: number;
  /** The error message from the thrown exception. */
  message: string;
}

/**
 * The full preview — the artifact-grouped diff the renderer paints. Discriminated
 * `mode: 'preview'` mirrors the underlying `PreviewResult`. `tablesWritten` is
 * echoed from the mechanism (the set that WOULD have flushed to invalidation had
 * the batch committed) so the renderer can scope its lazy compute / refresh.
 *
 * When `error` is present, command `error.commandIndex` threw during preview.
 * `directNodes` contains the nodes built from commands 0..commandIndex-1 (the
 * commands that would have applied). `affectedDownstream` is the DAG walk over
 * those pre-failure nodes. Batches stay all-or-nothing; `error` is purely
 * representational. See #65.
 */
export interface PreviewDiff {
  mode: "preview";
  /** Nodes commands directly touched — fully shown, compute deferred to client. */
  directNodes: PreviewDirectNode[];
  /** Nodes downstream of the touched nodes — flagged only. */
  affectedDownstream: PreviewDownstreamNode[];
  /** Echo of the mechanism's tablesWritten — what a commit would have invalidated. */
  tablesWritten: string[];
  /**
   * Partial-failure slot — present when a command threw during preview. The diff
   * is still renderable (pre-failure nodes + their blast radius); the reviewer
   * sees which commands would apply and which one fails. Absent on a fully
   * successful preview. See #65.
   */
  error?: PreviewError;
}
