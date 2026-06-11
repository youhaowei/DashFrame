/**
 * PreviewDiff builder (YW-124) — the DashFrame Layer-B wrapper over
 * `@wystack/server`'s `applyCommands(batch, { mode: 'preview' })` MECHANISM.
 *
 * The mechanism (YW-122) is vocabulary-free: it runs the batch for real inside
 * one tracked transaction, rolls it back, and returns a `PreviewResult` (which
 * paths ran, their return values, the tables they touched). It knows nothing
 * about DashFrame artifacts. THIS module reads that generic result as the
 * artifact-grouped `PreviewDiff` a human reviews before publishing:
 *
 *   1. applyCommands(..., { mode: 'preview' })  — execute-then-rollback. Canonical
 *      DB is untouched on return (so every read below sees pre-batch state).
 *   2. directNodes  — group the batch by the artifact node each command targets;
 *      intent line per command, before-slice read from canonical, proposed-slice
 *      assembled from the COMMAND ARGS (the proposed value — NOT read back, the
 *      tx rolled the change away).
 *   3. affectedDownstream — walk the implicit artifact DAG (FKs + JSON-IR refs +
 *      parentArtifactId) outward from each touched node, flagging the blast
 *      radius. Flagged only — no compute (the spec rule).
 *
 * SPLIT-TIER (settled): this builder emits METADATA ONLY. `compute` on every
 * direct node is left `undefined`; the renderer fills it lazily on preview-open
 * from `proposedDefinition` against local DuckDB. The WyStack RPC boundary
 * carries metadata; row data rides its own (browser) path. Do not compute or
 * embed row data here.
 *
 * ── The DAG, made explicit (the single home for the traversal) ──────────────
 * There is no edge table. The artifact DAG is implicit in FKs, JSON-IR
 * references, and the cross-cutting parentArtifactId pointer. Downstream of a
 * touched node N means: nodes whose definition references N. The edges, by the
 * direction "touch N ⇒ these are affected":
 *
 *   dataSource  → dataTable     : FK data_tables.data_source_id
 *   dataTable   → insight       : insight.definition.baseTableId
 *                                 + insight.definition.joins[].rightTableId
 *   insight     → dataFrame     : FK data_frames.insight_id
 *   insight     → visualization : FK visualizations.insight_id
 *   visualization → dashboard   : dashboards.layout[].visualizationId
 *   <any node>  → <any artifact>: cross-cutting parent_artifact_id == N.id
 *
 * Traversal is transitive: a touched dataSource fans out to its dataTables, then
 * each dataTable to insights, then each insight to dataFrames + visualizations,
 * then each visualization to dashboards. parentArtifactId is checked at EVERY
 * touched/visited node (it can point anywhere). Visited-set guards re-flagging.
 */

import type { ArtifactDb } from "@dashframe/server-core";
import { schema } from "@dashframe/server-core";
import type {
  ArtifactKind,
  DownstreamEdge,
  DownstreamFlag,
  PreviewDiff,
  PreviewDirectNode,
  PreviewDownstreamNode,
  PreviewIntent,
  UUID,
} from "@dashframe/types";
import type { Command } from "@wystack/server";
import { applyCommands, type WyStackApp } from "@wystack/server";

import { commandFunctions } from "./commands";

const {
  dataSources,
  dataTables,
  dataFrames,
  insights,
  visualizations,
  dashboards,
} = schema;

// ---------------------------------------------------------------------------
// Command → target-node descriptor
//
// Each vocabulary command is dispatched by `applyCommands` under a registry
// PATH (the keys of `commandFunctions`). To group the batch by node we map each
// path to: the canonical artifact KIND it writes, and HOW to read the target id
// out of that command's args. This is the inverse face of COMMAND_PATHS in
// commands.ts — one table, kept beside the commands so a new command can't ship
// without declaring how the diff groups it.
// ---------------------------------------------------------------------------

type CommandPath = keyof typeof commandFunctions;

interface CommandDescriptor {
  kind: ArtifactKind;
  /** Pull the target node id out of this command's args. */
  targetId: (args: Record<string, unknown>) => string;
  /** Whether the command MINTS the node (create) or mutates an existing one. */
  change: "create" | "update";
  /** Human-readable intent summary from the args. */
  summary: (args: Record<string, unknown>) => string;
}

/** Args fields carry the target id under different keys per command. */
const byId = (args: Record<string, unknown>) => String(args.id);
const byNodeId = (args: Record<string, unknown>) => String(args.nodeId);

const COMMAND_DESCRIPTORS: Record<CommandPath, CommandDescriptor> = {
  getOrCreateDataSource: {
    kind: "dataSource",
    targetId: byId,
    change: "create",
    summary: (a) => `Get or create data source "${String(a.name)}"`,
  },
  createDataSource: {
    kind: "dataSource",
    targetId: byId,
    change: "create",
    summary: (a) => `Create data source "${String(a.name)}"`,
  },
  setDataSourceConfig: {
    kind: "dataSource",
    targetId: byId,
    change: "update",
    summary: () => "Update data source config",
  },
  createDataTable: {
    kind: "dataTable",
    targetId: byId,
    change: "create",
    summary: (a) => `Create data table "${String(a.name)}"`,
  },
  setDataTableSchema: {
    kind: "dataTable",
    targetId: byId,
    change: "update",
    summary: () => "Set data table schema",
  },
  refreshDataTableCmd: {
    kind: "dataTable",
    targetId: byId,
    change: "update",
    summary: () => "Refresh data table",
  },
  addField: {
    kind: "dataTable",
    targetId: byNodeId,
    change: "update",
    summary: (a) => `Add field "${fieldName(a.field)}"`,
  },
  updateField: {
    kind: "dataTable",
    targetId: byNodeId,
    change: "update",
    summary: (a) => `Update field ${String(a.fieldId)}`,
  },
  removeField: {
    kind: "dataTable",
    targetId: byNodeId,
    change: "update",
    summary: (a) => `Remove field ${String(a.fieldId)}`,
  },
  addMetric: {
    kind: "dataTable",
    targetId: byNodeId,
    change: "update",
    summary: (a) => `Add metric "${fieldName(a.metric)}"`,
  },
  updateMetric: {
    kind: "dataTable",
    targetId: byNodeId,
    change: "update",
    summary: (a) => `Update metric ${String(a.metricId)}`,
  },
  removeMetric: {
    kind: "dataTable",
    targetId: byNodeId,
    change: "update",
    summary: (a) => `Remove metric ${String(a.metricId)}`,
  },
  renameNode: {
    kind: "dataTable", // resolved at build time — rename is polymorphic (see resolveKind)
    targetId: byId,
    change: "update",
    summary: (a) => `Rename to "${String(a.name)}"`,
  },
};

/** Map a registry path back to the vocabulary command NAME for the intent line. */
const PATH_TO_NAME: Record<CommandPath, string> = {
  getOrCreateDataSource: "GetOrCreateDataSource",
  createDataSource: "CreateDataSource",
  setDataSourceConfig: "SetDataSourceConfig",
  createDataTable: "CreateDataTable",
  setDataTableSchema: "SetDataTableSchema",
  refreshDataTableCmd: "RefreshDataTable",
  addField: "AddField",
  updateField: "UpdateField",
  removeField: "RemoveField",
  addMetric: "AddMetric",
  updateMetric: "UpdateMetric",
  removeMetric: "RemoveMetric",
  renameNode: "RenameNode",
};

function fieldName(value: unknown): string {
  if (value && typeof value === "object" && "name" in value) {
    return String((value as { name: unknown }).name);
  }
  return "";
}

function isKnownPath(path: string): path is CommandPath {
  return path in COMMAND_DESCRIPTORS;
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

/**
 * Run a batch in preview mode and assemble the artifact-grouped PreviewDiff.
 *
 * @param app   the WyStack app whose registry resolves the command paths
 * @param db    the canonical artifact DB handle — read for before-slices and the
 *              downstream DAG walk. Safe to read AFTER applyCommands returns: the
 *              preview transaction has rolled back, so this is pre-batch state.
 * @param batch the ordered command envelopes (built via `cmd(...)`)
 */
export async function buildPreviewDiff(
  app: WyStackApp,
  db: ArtifactDb,
  batch: Command[],
): Promise<PreviewDiff> {
  // 1. Execute-then-rollback. We don't read the preview's row-level output here
  //    (the proposed slice comes from args); we DO echo its tablesWritten.
  const result = await applyCommands(app, batch, { mode: "preview" });

  // 2. Group the batch by the artifact node each command targets.
  const direct = await buildDirectNodes(db, batch);

  // 3. Walk the implicit DAG outward from every touched node.
  const affectedDownstream = await walkDownstream(db, direct);

  return {
    mode: "preview",
    directNodes: direct,
    affectedDownstream,
    tablesWritten: [...result.tablesWritten],
  };
}

/**
 * Group the batch by target node. Multiple commands targeting the same node
 * merge into one direct node (their intents accumulate in batch order). The
 * before-slice is read from canonical DB; the proposed slice is the merged args.
 */
async function buildDirectNodes(
  db: ArtifactDb,
  batch: Command[],
): Promise<PreviewDirectNode[]> {
  // node key = `${kind}:${id}` so two kinds sharing an id can't collide.
  const byKey = new Map<string, PreviewDirectNode>();
  const order: string[] = [];
  // Kind already established for an id by an EARLIER command in this batch. A
  // create command fixes its target's kind; a later polymorphic RenameNode on
  // that same id (created in-batch, so not yet in canonical state — preview
  // rolled back) reuses it instead of mis-defaulting to the descriptor kind.
  const idToKind = new Map<string, ArtifactKind>();

  for (const command of batch) {
    if (!isKnownPath(command.path)) continue; // non-vocabulary path — not grouped
    const descriptor = COMMAND_DESCRIPTORS[command.path];
    const args = (command.args ?? {}) as Record<string, unknown>;
    const nodeId = descriptor.targetId(args) as UUID;
    const kind =
      idToKind.get(nodeId) ??
      (await resolveKind(db, command.path, descriptor, nodeId));
    idToKind.set(nodeId, kind);
    const key = `${kind}:${nodeId}`;

    const intent: PreviewIntent = {
      command: PATH_TO_NAME[command.path],
      summary: descriptor.summary(args),
    };

    const existing = byKey.get(key);
    if (existing) {
      existing.intent.push(intent);
      // A later create dominates: if any command in the group mints the node,
      // the node is new to this batch — clear the before-slice too.
      if (descriptor.change === "create") {
        existing.change = "create";
        existing.before = null;
      }
      Object.assign(existing.proposedDefinition, args);
      continue;
    }

    // Idempotent commands (e.g. getOrCreateDataSource) are declared as
    // "create" but may hit an existing row. Read before-slice in that case so
    // the preview shows the canonical row rather than a misleading null.
    let change = descriptor.change;
    let before: Record<string, unknown> | null;
    if (descriptor.change === "create") {
      const existingRow = await readBefore(db, kind, nodeId);
      if (existingRow !== null) {
        // Row exists — this is a no-op / idempotent get: show as update.
        change = "update";
        before = existingRow;
      } else {
        before = null;
      }
    } else {
      before = await readBefore(db, kind, nodeId);
    }

    order.push(key);
    byKey.set(key, {
      nodeId,
      kind,
      change,
      intent: [intent],
      before,
      proposedDefinition: { ...args },
      // SPLIT-TIER: never filled server-side. The renderer resolves it lazily.
      compute: undefined,
    });
  }

  return order.map((key) => byKey.get(key)!);
}

/**
 * RenameNode is polymorphic — its descriptor kind ("dataTable") is a default.
 * Resolve the real kind by probing the canonical tables in the same order the
 * `renameNode` handler does (dataTable → dataSource → insight). Every other
 * command's kind is fixed by its descriptor.
 */
async function resolveKind(
  db: ArtifactDb,
  path: CommandPath,
  descriptor: CommandDescriptor,
  nodeId: string,
): Promise<ArtifactKind> {
  if (path !== "renameNode") return descriptor.kind;
  if (await rowExists(db, "dataTable", nodeId)) return "dataTable";
  if (await rowExists(db, "dataSource", nodeId)) return "dataSource";
  if (await rowExists(db, "insight", nodeId)) return "insight";
  // Not yet persisted (created earlier in the same batch but rolled back, or a
  // bad id). Fall back to the descriptor default; the batch would have thrown.
  return descriptor.kind;
}

// ---------------------------------------------------------------------------
// Canonical reads (pre-batch state — the preview tx rolled back)
//
// Reads go through the raw Drizzle handle and filter in JS, matching the
// commands.test.ts convention: the server package has no direct drizzle-orm
// `where()` operator dep, and a single-project artifact DB holds few rows.
// ---------------------------------------------------------------------------

async function readBefore(
  db: ArtifactDb,
  kind: ArtifactKind,
  id: string,
): Promise<Record<string, unknown> | null> {
  const row = await findRow(db, kind, id);
  return (row as Record<string, unknown> | undefined) ?? null;
}

async function rowExists(
  db: ArtifactDb,
  kind: ArtifactKind,
  id: string,
): Promise<boolean> {
  return (await findRow(db, kind, id)) !== undefined;
}

async function findRow(
  db: ArtifactDb,
  kind: ArtifactKind,
  id: string,
): Promise<unknown> {
  switch (kind) {
    case "dataSource":
      return (await db.select().from(dataSources)).find((r) => r.id === id);
    case "dataTable":
      return (await db.select().from(dataTables)).find((r) => r.id === id);
    case "insight":
      return (await db.select().from(insights)).find((r) => r.id === id);
    case "dataFrame":
      return (await db.select().from(dataFrames)).find((r) => r.id === id);
    case "visualization":
      return (await db.select().from(visualizations)).find((r) => r.id === id);
    case "dashboard":
      return (await db.select().from(dashboards)).find((r) => r.id === id);
  }
}

// ---------------------------------------------------------------------------
// The DAG walk
// ---------------------------------------------------------------------------

/**
 * One row of the canonical artifact graph, normalized to the fields the walk
 * needs: identity, the typed FK/IR back-references, and the cross-cutting
 * parent pointer. Built once from the table snapshots so the traversal reads a
 * uniform shape instead of branching per table.
 */
interface GraphRow {
  id: string;
  kind: ArtifactKind;
  /** ids of the nodes this row directly DEPENDS ON (its upstream). */
  dependsOn: string[];
  parentArtifactId: string | null;
}

/**
 * The single home for the implicit-DAG edge semantics. Each edge declares the
 * dependency direction ("a GraphRow of `to` kind depends on a node of `from`
 * kind"), the label, and the flag a downstream hit carries. `dataFrame`/
 * `dashboard` are sinks (no row downstream of them), so they appear only as
 * `to`. Adding an artifact relationship means adding one row here — the walk
 * itself never changes. parentArtifactId is handled separately (it is
 * cross-cutting, not kind-specific).
 */
const DOWNSTREAM_EDGES: ReadonlyArray<{
  edge: DownstreamEdge;
  flag: DownstreamFlag;
}> = [
  { edge: "dataSource->dataTable", flag: "recompute" },
  { edge: "dataTable->insight", flag: "recompute" },
  { edge: "insight->dataFrame", flag: "stale" },
  { edge: "insight->visualization", flag: "recompute" },
  { edge: "visualization->dashboard", flag: "stale" },
];

/**
 * Normalize every artifact row into a `GraphRow` with its upstream dependency
 * ids resolved from the typed FK/IR edges. This is where the schema-specific
 * reference extraction lives (FKs, the insight IR, the dashboard layout); the
 * walk below is schema-agnostic over the result.
 */
async function loadGraph(db: ArtifactDb): Promise<GraphRow[]> {
  const allSources = await db.select().from(dataSources);
  const allTables = await db.select().from(dataTables);
  const allInsights = await db.select().from(insights);
  const allFrames = await db.select().from(dataFrames);
  const allVis = await db.select().from(visualizations);
  const allDashboards = await db.select().from(dashboards);

  const rows: GraphRow[] = [];
  for (const r of allSources)
    rows.push({
      id: r.id,
      kind: "dataSource",
      dependsOn: [],
      parentArtifactId: r.parentArtifactId,
    });
  for (const r of allTables)
    rows.push({
      id: r.id,
      kind: "dataTable",
      dependsOn: [r.dataSourceId],
      parentArtifactId: null,
    });
  for (const r of allInsights)
    rows.push({
      id: r.id,
      kind: "insight",
      dependsOn: insightTableRefs(r.definition),
      parentArtifactId: r.parentArtifactId,
    });
  for (const r of allFrames)
    rows.push({
      id: r.id,
      kind: "dataFrame",
      dependsOn: r.insightId ? [r.insightId] : [],
      parentArtifactId: null,
    });
  for (const r of allVis)
    rows.push({
      id: r.id,
      kind: "visualization",
      dependsOn: [r.insightId],
      parentArtifactId: r.parentArtifactId,
    });
  for (const r of allDashboards)
    rows.push({
      id: r.id,
      kind: "dashboard",
      dependsOn: dashboardVisRefs(r.layout),
      parentArtifactId: r.parentArtifactId,
    });
  return rows;
}

/**
 * Numeric ordering for downstream flags — higher = stronger impact.
 * recompute (active work needed) > stale (cached result out of date) >
 * orphaned (reference dangling, no recompute path).
 */
function flagStrength(flag: DownstreamFlag): number {
  if (flag === "recompute") return 3;
  if (flag === "stale") return 2;
  if (flag === "orphaned") return 1;
  return 0;
}

/**
 * Walk the implicit artifact DAG outward from every directly-touched node,
 * flagging the blast radius. Breadth-first over a frontier; a global
 * visited-map (keyed by kind:id) guards re-flagging when two paths reach one
 * node, but allows upgrading the recorded flag when a stronger path arrives
 * (recompute > stale). The edge semantics live in `DOWNSTREAM_EDGES`; this
 * loop is generic.
 */
async function walkDownstream(
  db: ArtifactDb,
  direct: PreviewDirectNode[],
): Promise<PreviewDownstreamNode[]> {
  const graph = await loadGraph(db);

  const out: PreviewDownstreamNode[] = [];
  // visited maps kind:id to the emitted out-entry so we can upgrade its flag if
  // a later path reaches it via a stronger edge (recompute > stale).
  const visited = new Map<string, PreviewDownstreamNode>();
  for (const node of direct) visited.set(`${node.kind}:${node.nodeId}`, null!);

  // Frontier of touched nodes — id + kind so classifyDownstream can exact-match
  // the edge label (e.g. "dataSource->dataTable") without ambiguity, and `via`
  // echoed so the renderer can explain the lineage chain.
  const frontier: Array<{ id: string; kind: ArtifactKind; via: UUID }> =
    direct.map((d) => ({ id: d.nodeId, kind: d.kind, via: d.nodeId }));

  while (frontier.length > 0) {
    const current = frontier.shift()!;
    // A node is downstream of `current` if it DEPENDS ON current (FK/IR) or its
    // parentArtifactId points at current. One pass over the graph finds both.
    for (const row of graph) {
      const hit = classifyDownstream(row, current.id, current.kind);
      if (!hit) continue;
      const key = `${row.kind}:${row.id}`;
      const existing = visited.get(key);
      if (existing !== undefined) {
        // Already emitted — upgrade the flag if this path is stronger.
        if (
          existing !== null &&
          flagStrength(hit.flag) > flagStrength(existing.flag)
        ) {
          existing.flag = hit.flag;
          existing.edge = hit.edge;
        }
        continue;
      }
      const emitted: PreviewDownstreamNode = {
        nodeId: row.id as UUID,
        kind: row.kind,
        edge: hit.edge,
        via: current.via,
        flag: hit.flag,
      };
      visited.set(key, emitted);
      out.push(emitted);
      frontier.push({ id: row.id, kind: row.kind, via: current.via });
    }
  }

  return out;
}

/**
 * Is `row` downstream of `parentId` (of kind `parentKind`), and by which edge?
 * Prefers the typed FK/IR edge (it carries the kind-specific flag); falls back
 * to the cross-cutting parentArtifactId pointer (always `stale` lineage).
 * Returns null when unrelated.
 *
 * `parentKind` is required for exact edge matching: we look up
 * `${parentKind}->${row.kind}` so that a future second incoming edge to an
 * existing target kind doesn't silently resolve to the wrong label.
 */
function classifyDownstream(
  row: GraphRow,
  parentId: string,
  parentKind: ArtifactKind,
): { edge: DownstreamEdge; flag: DownstreamFlag } | null {
  if (row.dependsOn.includes(parentId)) {
    const edge = DOWNSTREAM_EDGES.find(
      (e) => e.edge === `${parentKind}->${row.kind}`,
    );
    if (edge) return edge;
  }
  if (row.parentArtifactId === parentId) {
    return { edge: "parentArtifact", flag: "stale" };
  }
  return null;
}

/**
 * The dataTable ids an insight's stored `definition` IR references — the base
 * table (`baseTableId`) plus each join's right side (`joins[].rightTableId`).
 * Defensive about the JSON shape: the column is `jsonb` and old rows may predate
 * fields. These are the insight's upstream-table dependencies.
 */
function insightTableRefs(definition: unknown): string[] {
  if (!definition || typeof definition !== "object") return [];
  const def = definition as { baseTableId?: unknown; joins?: unknown };
  const refs: string[] = [];
  if (typeof def.baseTableId === "string") refs.push(def.baseTableId);
  if (Array.isArray(def.joins)) {
    for (const join of def.joins) {
      const right = (join as { rightTableId?: unknown } | null)?.rightTableId;
      if (typeof right === "string") refs.push(right);
    }
  }
  return refs;
}

/**
 * The visualization ids a dashboard's `layout` (domain DashboardItem[]) embeds —
 * items of type "visualization" carry `visualizationId`. These are the
 * dashboard's upstream-visualization dependencies.
 */
function dashboardVisRefs(layout: unknown): string[] {
  if (!Array.isArray(layout)) return [];
  const refs: string[] = [];
  for (const item of layout) {
    const vis = (item as { visualizationId?: unknown } | null)?.visualizationId;
    if (typeof vis === "string") refs.push(vis);
  }
  return refs;
}
