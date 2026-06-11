/**
 * PreviewDiff builder — the DashFrame Layer-B wrapper over
 * `@wystack/server`'s `applyCommands(batch, { mode: 'preview' })` MECHANISM.
 *
 * The mechanism is vocabulary-free: it runs the batch for real inside
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
import type { Command, CommandResult } from "@wystack/server";
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
const byDashboardId = (args: Record<string, unknown>) =>
  String(args.dashboardId);

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
  // Field/metric commands are polymorphic over {dataTable, insight}: `nodeId`
  // resolves to either at write time. The handler reports the resolved kind on
  // `value.target.kind`, which buildDirectNodes reads (POLYMORPHIC_RESULT_KEY).
  // The `kind: "dataTable"` below is only the structural-absence fallback.
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
  createInsightCmd: {
    kind: "insight",
    targetId: byId,
    change: "create",
    summary: (a) => `Create insight "${String(a.name)}"`,
  },
  setInsightSource: {
    kind: "insight",
    targetId: byId,
    change: "update",
    summary: () => "Set insight source",
  },
  selectFields: {
    kind: "insight",
    targetId: byId,
    change: "update",
    summary: (a) =>
      `Select ${Array.isArray(a.fieldIds) ? a.fieldIds.length : 0} field(s)`,
  },
  setInsightFilter: {
    kind: "insight",
    targetId: byId,
    change: "update",
    summary: (a) =>
      `Set ${Array.isArray(a.filters) ? a.filters.length : 0} filter(s)`,
  },
  setInsightSort: {
    kind: "insight",
    targetId: byId,
    change: "update",
    summary: () => "Set insight sort",
  },
  addJoin: {
    kind: "insight",
    targetId: byId,
    change: "update",
    summary: () => "Add join",
  },
  updateJoin: {
    kind: "insight",
    targetId: byId,
    change: "update",
    summary: (a) => `Update join at index ${String(a.joinIndex)}`,
  },
  removeJoin: {
    kind: "insight",
    targetId: byId,
    change: "update",
    summary: (a) => `Remove join at index ${String(a.joinIndex)}`,
  },
  createVisualizationCmd: {
    kind: "visualization",
    targetId: byId,
    change: "create",
    summary: (a) => `Create visualization "${String(a.name)}"`,
  },
  setChartType: {
    kind: "visualization",
    targetId: byId,
    change: "update",
    summary: (a) => `Set chart type to "${String(a.visualizationType)}"`,
  },
  setChartEncoding: {
    kind: "visualization",
    targetId: byId,
    change: "update",
    summary: () => "Set chart encoding",
  },
  createDashboardCmd: {
    kind: "dashboard",
    targetId: byId,
    change: "create",
    summary: (a) => `Create dashboard "${String(a.name)}"`,
  },
  addDashboardItemCmd: {
    kind: "dashboard",
    targetId: byDashboardId,
    change: "update",
    summary: () => "Add dashboard item",
  },
  updateDashboardItemCmd: {
    kind: "dashboard",
    targetId: byDashboardId,
    change: "update",
    summary: (a) => `Update dashboard item ${String(a.itemId)}`,
  },
  setDashboardLayout: {
    kind: "dashboard",
    targetId: byDashboardId,
    change: "update",
    summary: () => "Set dashboard layout",
  },
  removeDashboardItemCmd: {
    kind: "dashboard",
    targetId: byDashboardId,
    change: "update",
    summary: (a) => `Remove dashboard item ${String(a.itemId)}`,
  },
  renameNode: {
    // Polymorphic — the real kind comes from the handler's reported `renamed`
    // target (read in buildDirectNodes), NOT from this declared value. This
    // placeholder is only the fallback when the handler result is somehow
    // unreadable (it never is for a command that didn't throw).
    kind: "dataTable",
    targetId: byId,
    change: "update",
    summary: (a) => `Rename to "${String(a.name)}"`,
  },
  deleteNode: {
    // Polymorphic like renameNode: the handler reports the resolved kind on
    // `value.deleted.kind`, which buildDirectNodes reads (POLYMORPHIC_RESULT_KEY)
    // so a previewed delete groups against the RIGHT canonical row and seeds the
    // DAG walk from the right kind. This placeholder is only the fallback. A
    // previewed delete still groups as an `update` effect (the preview machine has
    // no `delete` effect yet — the fourth column the state-machine note reserves),
    // so the walk does not yet emit `orphaned` (still RESERVED); the COMMIT path's
    // orphanedNodes is the authoritative warning surface.
    kind: "dataTable",
    targetId: byId,
    change: "update",
    summary: () => "Delete node (cascades owned children)",
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
  createInsightCmd: "CreateInsight",
  setInsightSource: "SetInsightSource",
  selectFields: "SelectFields",
  setInsightFilter: "SetInsightFilter",
  setInsightSort: "SetInsightSort",
  addJoin: "AddJoin",
  updateJoin: "UpdateJoin",
  removeJoin: "RemoveJoin",
  createVisualizationCmd: "CreateVisualization",
  setChartType: "SetChartType",
  setChartEncoding: "SetChartEncoding",
  createDashboardCmd: "CreateDashboard",
  addDashboardItemCmd: "AddDashboardItem",
  updateDashboardItemCmd: "UpdateDashboardItem",
  setDashboardLayout: "SetDashboardLayout",
  removeDashboardItemCmd: "RemoveDashboardItem",
  renameNode: "RenameNode",
  deleteNode: "DeleteNode",
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
  // 1. Execute-then-rollback. The proposed slice still comes from args, but for
  //    polymorphic RenameNode we READ the handler's reported resolution out of
  //    `result.results` — the preview must not re-derive which artifact a rename
  //    hit (public issue #64). We also echo tablesWritten.
  const result = await applyCommands(app, batch, { mode: "preview" });

  // 2. Group the batch by the artifact node each command targets. `result.results`
  //    is positional with `batch` (results[i] ↔ batch[i]); the builder reads it
  //    to learn what each RenameNode actually renamed.
  const direct = await buildDirectNodes(db, batch, result.results);

  // 3. Walk the implicit DAG outward from every node the batch actually CHANGES.
  //    `noop` nodes (idempotent get-or-create that hit an existing row and wrote
  //    nothing) are shown in directNodes for transparency but must not seed the
  //    blast radius — an unchanged upstream changes nothing downstream. Excluding
  //    them keeps a no-op import batch's affectedDownstream honestly empty.
  const changed = direct.filter((node) => node.change !== "noop");
  const affectedDownstream = await walkDownstream(db, changed);

  return {
    mode: "preview",
    directNodes: direct,
    affectedDownstream,
    tablesWritten: [...result.tablesWritten],
  };
}

// ---------------------------------------------------------------------------
// The node-merge state machine
//
// FOUR consecutive review findings landed on this merge logic, every one a hole
// in an implicit, ad-hoc state space. This is the explicit enumeration so the
// next one has nowhere to hide.
//
// A command's RESOLVED EFFECT on its target node is one of three — NOT the same
// as the descriptor's declared `change`. A declared-`create` (get-or-create) is
// only a real create when the row does not already exist; otherwise it writes
// nothing (the handler returns the existing row and ignores args — frozen by
// commands.test.ts "existing row wins"). The vocabulary has no node-delete yet,
// so `delete` is not in the domain; if one is added, it joins here as a fourth
// effect with its own column and the machine stays total.
//
//   CommandEffect:
//     "create"  declared-create, row ABSENT (in batch + canonical)  → mints
//     "update"  declared-update                                     → mutates
//     "noop"    declared-create, row PRESENT (in batch OR canonical) → writes ∅
//
// Each command folds into the node's ACCUMULATED state via `foldCommand`, a
// total function over (accumulated change × incoming effect). The accumulated
// `change` carried on the node IS the state; `absent` is "no node in the map
// yet". The table:
//
//   acc \ effect │ create               │ update               │ noop
//   ─────────────┼──────────────────────┼──────────────────────┼─────────────────────
//   absent       │ create  before=null  │ update  before=canon │ noop  before=canon
//                │ propose=args         │ propose=args         │ propose=∅
//   create       │ create  merge args   │ create  merge args   │ create  (ignore args)
//   update       │ update  merge args † │ update  merge args   │ update  (ignore args)
//   noop         │ update  merge args † │ update  merge args   │ noop    (ignore args)
//
//   † A create-effect can only reach an already-grouped node if the row was
//     ABSENT at first contact (else this command resolves to `noop`, not
//     `create`). So "acc=update/noop + effect=create" means the node was first
//     seen as a canonical row, then a genuine mint arrived — impossible without
//     applyCommands having already thrown. We model it conservatively as an
//     update-merge (never regress a resolved canonical node back to create with
//     a wiped before — finding #1/#2), and it is unreachable in practice.
//
// `proposedDefinition`: only `create`/`update` commands contribute args; `noop`
// commands contribute nothing (finding #3/#4 — get-or-create args that provably
// never become writes must not masquerade as a proposed change). A node whose
// FINAL state is `noop` is excluded from the downstream walk (finding #4 —
// see buildPreviewDiff).
// ---------------------------------------------------------------------------

type CommandEffect = "create" | "update" | "noop";

/**
 * Resolve a single command's effect on its target node, given whether the node
 * already exists either earlier in THIS batch or in canonical DB. This is the
 * only place declared-`change` meets reality.
 */
function resolveEffect(
  declared: "create" | "update",
  rowExistsAlready: boolean,
): CommandEffect {
  if (declared === "update") return "update";
  // declared create: a real mint only when no row exists yet; otherwise the
  // get-or-create handler returns the existing row and writes nothing.
  return rowExistsAlready ? "noop" : "create";
}

/**
 * Fold one command (its resolved effect + args) into the node's accumulated
 * state. Total over (node.change × effect) per the table above. Mutates `node`
 * in place; the intent line is appended by the caller so this stays pure over
 * the change/before/proposed triple.
 */
function foldCommand(
  node: PreviewDirectNode,
  effect: CommandEffect,
  args: Record<string, unknown>,
): void {
  if (effect === "noop") return; // writes nothing — no change, no proposed args
  if (effect === "create" && node.change === "create") {
    // already minting; merge args. (create→create is the only create-merge that
    // genuinely happens, e.g. CreateDataSource then RenameNode on a fresh id.)
    Object.assign(node.proposedDefinition, args);
    return;
  }
  if (effect === "create") {
    // create-effect onto an update/noop node — unreachable in practice (the row
    // existed at first contact, so this would resolve to noop, not create). Stay
    // an update: never regress a resolved canonical node to a before:null create.
    node.change = "update";
    Object.assign(node.proposedDefinition, args);
    return;
  }
  // effect === "update": a noop node becomes a real update; a create stays a
  // create (a create + later update is still a mint). Either way, merge args.
  if (node.change === "noop") node.change = "update";
  Object.assign(node.proposedDefinition, args);
}

/**
 * Seed a node on FIRST contact from the absent state. The `absent` row of the
 * transition table: effect picks (change, before, proposed) directly.
 */
function seedNode(
  nodeId: UUID,
  kind: ArtifactKind,
  effect: CommandEffect,
  before: Record<string, unknown> | null,
  intent: PreviewIntent,
  args: Record<string, unknown>,
): PreviewDirectNode {
  return {
    nodeId,
    kind,
    change: effect,
    intent: [intent],
    // create: no canonical row. update/noop: the existing canonical row.
    before: effect === "create" ? null : before,
    // noop writes nothing, so no proposed change; create/update carry args.
    proposedDefinition: effect === "noop" ? {} : { ...args },
    // SPLIT-TIER: never filled server-side. The renderer resolves it lazily.
    compute: undefined,
  };
}

/**
 * The polymorphic commands whose descriptor `kind` is a PLACEHOLDER: the real
 * target kind is decided by the handler at write time (`nodeId` can resolve to a
 * DataTable or an Insight; `id` can resolve to any of five artifacts). For each,
 * the handler reports the resolution on its result; this maps the command path to
 * the path on `result.value` that carries the resolved `{ kind }`.
 *
 *   renameNode                          → value.renamed.kind
 *   deleteNode                          → value.deleted.kind
 *   add/update/removeField/Metric       → value.target.kind
 *
 * Every other command's kind is FIXED by its descriptor.
 */
const POLYMORPHIC_RESULT_KEY: Partial<Record<CommandPath, string>> = {
  renameNode: "renamed",
  deleteNode: "deleted",
  addField: "target",
  updateField: "target",
  removeField: "target",
  addMetric: "target",
  updateMetric: "target",
  removeMetric: "target",
};

/**
 * Read the kind a polymorphic command ACTUALLY resolved to from the handler's
 * reported result — never re-derived. `applyCommands` echoes each handler's return
 * value onto `results[i].value` (positional with the batch), so the resolved
 * `{ kind }` under the command's result key is exactly the table the handler's SET
 * / DELETE ran against. This is the whole fix for public issue #64 generalized to
 * every polymorphic command: the handler probes the LIVE transaction (canonical
 * rows UNIONed with anything earlier commands minted) in one kind order; the
 * preview reads that decision instead of re-deriving it from separate
 * canonical/in-batch lookups that can never reproduce a single merged-tx probe.
 *
 * Falls back to the descriptor kind only if the result is structurally absent
 * — which never happens for a command that didn't throw (a throw would have
 * propagated out of `applyCommands` and never reached here).
 */
function readResolvedKind(
  path: CommandPath,
  result: CommandResult | undefined,
  fallback: ArtifactKind,
): ArtifactKind {
  const resultKey = POLYMORPHIC_RESULT_KEY[path];
  if (!resultKey) return fallback;
  const value = result?.value as Record<string, unknown> | undefined;
  const resolved = value?.[resultKey] as { kind?: ArtifactKind } | undefined;
  return resolved?.kind ?? fallback;
}

/**
 * Group the batch by target node. Multiple commands targeting the same node
 * merge into one direct node (their intents accumulate in batch order). Each
 * command resolves to an EFFECT (create/update/noop) against the node's state
 * so far, then folds into the group via the explicit transition machine above.
 *
 * `results` is the handler-result array from `applyCommands` (positional with
 * `batch`: `results[i]` ↔ `batch[i]`). For polymorphic `RenameNode` the target
 * kind is READ from `results[i].value.renamed.kind` — the handler's own
 * resolution — rather than re-derived. Every other command's kind is FIXED by
 * its descriptor: two kinds legitimately sharing one client-minted id (PKs are
 * per table) land in two distinct `${kind}:${id}` nodes, never collapsing into
 * whichever came first.
 */
async function buildDirectNodes(
  db: ArtifactDb,
  batch: Command[],
  results: CommandResult[],
): Promise<PreviewDirectNode[]> {
  // node key = `${kind}:${id}` so two kinds sharing an id can't collide.
  const byKey = new Map<string, PreviewDirectNode>();
  const order: string[] = [];

  for (let i = 0; i < batch.length; i++) {
    const command = batch[i]!;
    if (!isKnownPath(command.path)) continue; // non-vocabulary path — not grouped
    const descriptor = COMMAND_DESCRIPTORS[command.path];
    const args = (command.args ?? {}) as Record<string, unknown>;
    const nodeId = descriptor.targetId(args) as UUID;
    // Polymorphic commands (renameNode, deleteNode, field/metric edits) read the
    // handler's reported resolution from the positionally-matched result. Every
    // other command's kind is its descriptor kind. No re-derivation — share the
    // handler's decision, never mirror it.
    const kind: ArtifactKind = readResolvedKind(
      command.path,
      results[i],
      descriptor.kind,
    );
    const key = `${kind}:${nodeId}`;

    const intent: PreviewIntent = {
      command: PATH_TO_NAME[command.path],
      summary: descriptor.summary(args),
    };

    const existing = byKey.get(key);
    if (existing) {
      // The node already exists in this batch (earlier command grouped it). A
      // declared-create against it is therefore an idempotent get — effect noop.
      const effect = resolveEffect(descriptor.change, true);
      existing.intent.push(intent);
      foldCommand(existing, effect, args);
      continue;
    }

    // First contact: existence is canonical-only. Read the row once; it serves
    // as both the effect oracle and the before-slice.
    const before = await readBefore(db, kind, nodeId);
    const effect = resolveEffect(descriptor.change, before !== null);
    order.push(key);
    byKey.set(key, seedNode(nodeId, kind, effect, before, intent, args));
  }

  return order.map((key) => byKey.get(key)!);
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
  // Insight-on-Insight composition: B sourcing A depends on A via baseTableId
  // (source.sourceType 'insight'). A change to A must recompute B and fan out to
  // B's own DataFrames/Visualizations/Dashboards through the rest of the walk.
  { edge: "insight->insight", flag: "recompute" },
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
/**
 * Attempt to upgrade an already-emitted downstream node to a stronger path.
 * Returns true when an upgrade was applied (so the caller can also update viaOf).
 */
function tryUpgrade(
  existing: PreviewDownstreamNode,
  hit: { edge: DownstreamEdge; flag: DownstreamFlag },
  via: UUID,
): boolean {
  if (flagStrength(hit.flag) <= flagStrength(existing.flag)) return false;
  existing.flag = hit.flag;
  existing.edge = hit.edge;
  existing.via = via;
  return true;
}

/**
 * Seed the BFS state maps for the direct (touched) nodes before the walk begins.
 * Direct nodes are their own `via` — they ARE the provenance root for their
 * subtrees. Returns the initial frontier (identifier-only entries).
 */
function seedWalkState(
  direct: PreviewDirectNode[],
  visited: Map<string, PreviewDownstreamNode | null>,
  viaOf: Map<string, UUID>,
): Array<{ id: string; kind: ArtifactKind }> {
  for (const node of direct) {
    const key = `${node.kind}:${node.nodeId}`;
    // `null` is an honest sentinel: the direct (touched) node is in `visited` so
    // the walk dedupes it, but it has no emitted downstream entry of its own.
    // Typing the map `| null` makes the `existing !== null` guard below
    // type-visible — a future edit can't treat the sentinel as a node.
    visited.set(key, null);
    viaOf.set(key, node.nodeId);
  }
  return direct.map((d) => ({ id: d.nodeId, kind: d.kind }));
}

async function walkDownstream(
  db: ArtifactDb,
  direct: PreviewDirectNode[],
): Promise<PreviewDownstreamNode[]> {
  const graph = await loadGraph(db);

  const out: PreviewDownstreamNode[] = [];
  // visited maps kind:id to the emitted out-entry so we can upgrade its flag if
  // a later path reaches it via a stronger edge (recompute > stale). Direct
  // (touched) nodes are seeded with a `null` sentinel — present for dedup, but
  // no emitted downstream entry — so the value is `PreviewDownstreamNode | null`.
  const visited = new Map<string, PreviewDownstreamNode | null>();

  // viaOf maps kind:id to the node's current `via` value — the single source of
  // truth for lineage provenance. Direct seeds are their own via. Downstream
  // nodes record the via of the frontier node that first reached them; upgrades
  // (stronger path) update this map, NOT a stale frontier copy.
  //
  // The frontier carries only identifiers (id + kind). Reading viaOf at dequeue
  // time (not at enqueue time) guarantees that any upgrade that arrived while the
  // node was queued is visible to its descendants — fixing the stale-provenance
  // bug where the already-queued frontier entry carried an old via after an
  // upgrade mutated the emitted object.
  const viaOf = new Map<string, UUID>();
  const frontier = seedWalkState(direct, visited, viaOf);

  while (frontier.length > 0) {
    const current = frontier.shift()!;
    // Read the current via from the single source of truth, not from a snapshot
    // that may have been captured before a stronger path upgraded it.
    const currentVia = viaOf.get(`${current.kind}:${current.id}`)!;

    // A node is downstream of `current` if it DEPENDS ON current (FK/IR) or its
    // parentArtifactId points at current. One pass over the graph finds both.
    for (const row of graph) {
      const hit = classifyDownstream(row, current.id, current.kind);
      if (!hit) continue;
      const key = `${row.kind}:${row.id}`;
      const existing = visited.get(key);
      if (existing !== undefined) {
        // Already emitted — upgrade if this path is stronger. Updating viaOf
        // ensures that when this node is dequeued, it propagates the upgraded
        // via to its own descendants (one source of truth, not a stale copy).
        if (existing !== null && tryUpgrade(existing, hit, currentVia)) {
          viaOf.set(key, currentVia);
        }
        continue;
      }
      const emitted: PreviewDownstreamNode = {
        nodeId: row.id as UUID,
        kind: row.kind,
        edge: hit.edge,
        via: currentVia,
        flag: hit.flag,
      };
      visited.set(key, emitted);
      viaOf.set(key, currentVia);
      out.push(emitted);
      // Queue the identifier only — via is resolved from viaOf at dequeue time.
      frontier.push({ id: row.id, kind: row.kind });
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
 * The upstream-node ids an insight's stored `definition` IR references — the base
 * source (`baseTableId`) plus each join's right side (`joins[].rightTableId`).
 * `baseTableId` carries a DataTable id when `source.sourceType` is 'dataTable' and
 * an upstream Insight id when it is 'insight' (Insight-on-Insight composition); the
 * walk classifies the edge by the parent node's actual kind, so the same id under
 * `baseTableId` resolves to either `dataTable->insight` or `insight->insight`.
 * Defensive about the JSON shape: the column is `jsonb` and old rows may predate
 * fields.
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
