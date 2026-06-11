/**
 * Command VOCABULARY (YW-106 + YW-123) — Layer B over @wystack/server's
 * `applyCommands` MECHANISM (YW-122).
 *
 * `applyCommands` knows nothing about DashFrame. It dispatches a batch of
 * `{ path, args }` against the app's function registry inside one tracked
 * transaction. THIS module supplies the typed, intent-carrying commands that
 * batch travels as — the narrow waist both the human UI and the agent emit
 * through (capability-parity).
 *
 * Representation (chosen of the two viable seams): each command is backed by a
 * registered WyStack `mutation()` — path-addressable, validated by the same
 * cached Zod schema a plain RPC uses. A typed builder/registry
 * (`commandBuilders` below) maps a command NAME to the `{ path, args }` envelope
 * `applyCommands` dispatches. Rationale: the spec's traceability rule ("every
 * write op maps to a command, no escape hatch") wants the existing handlers to
 * BACK the commands so there is no duplicate logic — a command handler IS a
 * mutation handler. The builder layer is pure data-shaping (no DB access), so
 * the vocabulary stays a thin typed face over the mechanism.
 *
 * Decomposition:
 *
 *   YW-106 (DataSource/DataTable/Fields/Metrics — merged in main):
 *   getOrCreateDataSourceByType → GetOrCreateDataSource   (the reference atomic command)
 *   addDataSource              → CreateDataSource
 *   updateDataSource           → SetDataSourceConfig + RenameNode
 *   addDataTable               → CreateDataTable
 *   updateDataTable            → RenameNode + SetDataTableSchema + RefreshDataTable
 *   refreshDataTable           → RefreshDataTable
 *   patchDataTableArray        → AddField / UpdateField / RemoveField
 *                                + AddMetric / UpdateMetric / RemoveMetric
 *
 *   YW-123 (Insight/Visualization/Dashboard — this slice):
 *   createInsight              → CreateInsight
 *   updateInsight (baseTableId/source slice) → SetInsightSource
 *   updateInsight (selectedFields slice)     → SelectFields
 *   updateInsight (filters slice)            → SetInsightFilter
 *   updateInsight (sorts slice)              → SetInsightSort
 *   updateInsight (joins array)              → AddJoin / UpdateJoin / RemoveJoin
 *   patchInsight (fields/metrics)            → AddField / UpdateField / RemoveField
 *                                              AddMetric / UpdateMetric / RemoveMetric
 *                                              (same commands, now routed to Insight node)
 *   createVisualization        → CreateVisualization
 *   updateVisualization        → RenameNode + SetChartType + SetChartEncoding
 *   removeVisualization        → DeleteNode
 *   DashboardMutations.create  → CreateDashboard
 *   DashboardMutations.addItem → AddDashboardItem
 *   DashboardMutations.updateItem → UpdateDashboardItem
 *   DashboardMutations.update (layout) → SetDashboardLayout
 *   DashboardMutations.removeItem → RemoveDashboardItem
 *   removeInsight/removeVisualization/removeDashboard → DeleteNode
 *
 * Cross-cutting `RenameNode` is the one polymorphic rename — the `name` slice
 * carved out of every coarse update(blob). Now covers Insight + Visualization +
 * Dashboard nodes in addition to DataSource/DataTable.
 *
 * Fields & Metrics target the DataFrame-PRODUCING node polymorphically via
 * `{ nodeId }`. The YW-106 slice implemented the DataTable case; YW-123 wires
 * the Insight case so field/metric edits on a derived Insight work with the
 * same command shape.
 *
 * Operand encoding (YW-153 spike finding): value-bearing operands in
 * SetInsightFilter are a TAGGED union:
 *   { kind: 'value'; v: unknown }      (v: null is valid — means IS NULL)
 *   | { kind: 'lateBound'; ref: ... }  (column | category | placeholder)
 * NOT property-presence. This is the mechanism that reconciles capability-parity
 * with the privacy floor: the agent emits the same command verb, leaving only
 * the *value* unbound when the egress gate withheld it.
 *
 * Insight-on-Insight composition (SetInsightSource):
 * `source` is polymorphic — `{ sourceType: 'dataTable', sourceId }` OR
 * `{ sourceType: 'insight', sourceId }`. The handler detects cycles by
 * walking the source chain; it rejects a source that would make the Insight
 * transitively depend on itself.
 *
 * Backwards compatibility: the existing `InsightDefinition.baseTableId` field is
 * preserved in all writes so `rowToInsight` in `app-artifacts.ts` (which reads
 * `definition.baseTableId`) continues to work during the transition window
 * (YW-157). For a DataTable source, `baseTableId === source.sourceId`. For an
 * Insight source, `baseTableId` is left as the last known value (the read path
 * in app-artifacts will eventually be migrated to read `source` instead).
 */
import { schema } from "@dashframe/server-core";
import type {
  Field,
  InsightJoinConfig,
  InsightSort,
  Metric,
  SourceSchema,
  UUID,
  VegaLiteSpec,
  VisualizationEncoding,
  VisualizationType,
} from "@dashframe/types";
import { eq, jsonb, text, uuid } from "@wystack/db";
import type { Command } from "@wystack/server";
import { mutation } from "@wystack/server";

import { type DataSourceConfig, isRecord, requireRecordWithId } from "./utils";

const {
  dataSources,
  dataTables,
  dataFrames,
  insights,
  visualizations,
  dashboards,
} = schema;

type DataSourceRow = typeof dataSources.$inferSelect;
type DataTableRow = typeof dataTables.$inferSelect;
type InsightRow = typeof insights.$inferSelect;
type VisualizationRow = typeof visualizations.$inferSelect;
type DashboardRow = typeof dashboards.$inferSelect;

// ---------------------------------------------------------------------------
// Insight definition shape (stored in insights.definition jsonb)
// ---------------------------------------------------------------------------

/**
 * The full polymorphic source description stored in `insights.definition`.
 * `baseTableId` is kept for backwards compat with the existing `rowToInsight`
 * reader in `app-artifacts.ts` which pre-dates Insight-on-Insight composition.
 */
interface InsightSource {
  sourceType: "dataTable" | "insight";
  sourceId: UUID;
}

interface StoredInsightDefinition {
  /** Legacy field — kept for the app-artifacts.ts read path (YW-157 transition). */
  baseTableId: UUID;
  /** Polymorphic source (supersedes baseTableId for new writes). */
  source?: InsightSource;
  selectedFields: UUID[];
  metrics: unknown[];
  filters?: unknown[];
  sorts?: unknown[];
  joins?: unknown[];
}

/**
 * Load an Insight's stored definition. Throws if the row does not exist — the
 * same guard `requireDataTable` provides for DataTable commands.
 */
async function requireInsightDefinition(
  ctx: { db: import("@wystack/db").TrackedDb },
  insightId: string,
): Promise<{ row: InsightRow; definition: StoredInsightDefinition }> {
  const row = (await ctx.db
    .from(insights)
    .where(eq("id", insightId))
    .first()) as InsightRow | undefined;
  if (!row) throw new Error(`Insight ${insightId} not found`);
  return { row, definition: row.definition as StoredInsightDefinition };
}

/**
 * Walk the source chain starting from `startId` to detect whether `targetId`
 * is already reachable — i.e. whether setting `startId`'s source to `targetId`
 * would create a cycle. Stops as soon as it finds `targetId` or reaches a
 * DataTable (leaf).
 *
 * This is a simple linear walk (O(depth)); cycle detection could be done with
 * a visited set for diamond DAGs, but the typical chain depth is small and
 * diamonds are architecturally uncommon at authoring time.
 */
async function wouldCreateCycle(
  ctx: { db: import("@wystack/db").TrackedDb },
  startId: string,
  targetId: string,
): Promise<boolean> {
  // If the target IS the start, setting self as source is already a 1-cycle.
  if (startId === targetId) return true;
  // Walk the existing source chain from targetId upward — if we reach startId
  // then adding the edge targetId → startId would close a cycle.
  let currentId: string = targetId;
  const visited = new Set<string>();
  for (;;) {
    if (visited.has(currentId)) break; // already explored (shared prefix)
    visited.add(currentId);
    const row = (await ctx.db
      .from(insights)
      .where(eq("id", currentId))
      .first()) as InsightRow | undefined;
    if (!row) break; // reached a leaf (DataTable or unknown)
    const def = row.definition as StoredInsightDefinition;
    const src = def.source;
    if (!src || src.sourceType !== "insight") break; // leaf
    if (src.sourceId === startId) return true; // cycle found
    currentId = src.sourceId;
  }
  return false;
}

// ---------------------------------------------------------------------------
// DataSource commands
// ---------------------------------------------------------------------------

/**
 * GetOrCreateDataSource — THE reference atomic command. Replaces the racy
 * check-then-insert `getOrCreateDataSourceByType` (PR #46 Greptile P1:
 * concurrent CSV ingests double-insert).
 *
 * The fix is the client-minted id. The old command keyed idempotency on `kind`
 * (no DB unique constraint → two transactions both pass the existence check and
 * both insert). This keys idempotency on the PRIMARY KEY: the caller mints a
 * stable id once and reuses it, so a concurrent second ingest finds the row by
 * id (PK is unique) and returns it. Run inside `applyCommands`' transaction the
 * lookup→insert is atomic within a batch; across concurrent batches the PK
 * constraint is the backstop (the loser's insert conflicts and its batch rolls
 * back — one source, never two).
 */
const getOrCreateDataSource = mutation({
  args: { id: uuid, type: text, name: text },
  handler: async (ctx, { id, type, name }): Promise<{ id: string }> => {
    const existing = (await ctx.db
      .from(dataSources)
      .where(eq("id", id))
      .first()) as DataSourceRow | undefined;
    // On the get path `type` and `name` are IGNORED — the existing row wins,
    // even if the caller passed a different type for the same id. The canonical
    // caller derives the id FROM the type so a mismatch can't happen there; the
    // spec leaves conflict semantics open for other callers (Spec Open Q).
    if (existing) return { id: existing.id };

    const [row] = (await ctx.db.into(dataSources).insert({
      id,
      name,
      kind: type,
      storage: "live",
      config: {},
      createdBy: { kind: "user" },
    })) as DataSourceRow[];
    if (!row) throw new Error("insert returned no row");
    return { id: row.id };
  },
});

/** CreateDataSource — mints a DataSource with a client-supplied id + config. */
const createDataSource = mutation({
  args: {
    id: uuid,
    type: text,
    name: text,
    apiKey: text.optional(),
    connectionString: text.optional(),
  },
  handler: async (
    ctx,
    { id, type, name, apiKey, connectionString },
  ): Promise<{ id: string }> => {
    const [row] = (await ctx.db.into(dataSources).insert({
      id,
      name,
      kind: type,
      storage: "live",
      config: { apiKey, connectionString },
      createdBy: { kind: "user" },
    })) as DataSourceRow[];
    if (!row) throw new Error("insert returned no row");
    return { id: row.id };
  },
});

/**
 * SetDataSourceConfig — replaces the config slice of a DataSource (the connector
 * secrets). The `name` slice is NOT here — renaming is `RenameNode`. This is the
 * config half decomposed out of the coarse `updateDataSource`.
 */
const setDataSourceConfig = mutation({
  args: {
    id: uuid,
    apiKey: text.optional(),
    connectionString: text.optional(),
  },
  handler: async (
    ctx,
    { id, apiKey, connectionString },
  ): Promise<{ ok: true }> => {
    const current = (await ctx.db
      .from(dataSources)
      .where(eq("id", id))
      .first()) as DataSourceRow | undefined;
    if (!current) throw new Error(`Data source ${id} not found`);
    const config = { ...((current.config ?? {}) as DataSourceConfig) };
    if (apiKey !== undefined) config.apiKey = apiKey;
    if (connectionString !== undefined)
      config.connectionString = connectionString;
    await ctx.db.from(dataSources).where(eq("id", id)).update({ config });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// DataTable commands
// ---------------------------------------------------------------------------

/**
 * CreateDataTable — mints a DataTable with a client-supplied id, referencing a
 * DataSource (which an earlier command in the same batch may have created — the
 * shared tx handle makes that insert visible here).
 */
const createDataTable = mutation({
  args: {
    id: uuid,
    dataSourceId: uuid,
    name: text,
    table: text,
    sourceSchema: jsonb.optional(),
    fields: jsonb.optional(),
    metrics: jsonb.optional(),
    dataFrameId: uuid.optional(),
  },
  handler: async (ctx, args): Promise<{ id: string }> => {
    const [row] = (await ctx.db.into(dataTables).insert({
      id: args.id,
      dataSourceId: args.dataSourceId,
      name: args.name,
      table: args.table,
      sourceSchema: (args.sourceSchema as SourceSchema | undefined) ?? null,
      fields: (args.fields as Field[] | undefined) ?? [],
      metrics: (args.metrics as Metric[] | undefined) ?? [],
      dataFrameId: args.dataFrameId ?? null,
    })) as DataTableRow[];
    if (!row) throw new Error("insert returned no row");
    return { id: row.id };
  },
});

/**
 * Throw if no DataTable with `id` exists. An UPDATE on a missing id touches 0
 * rows and would otherwise return `{ ok: true }` — a silent no-op the caller
 * reads as success. This matches the by-id invariant every other handler here
 * enforces (`setDataSourceConfig`, `renameNode`, `patchDataTableCollection`).
 */
async function requireDataTable(
  ctx: { db: import("@wystack/db").TrackedDb },
  id: string,
): Promise<void> {
  const row = await ctx.db.from(dataTables).where(eq("id", id)).first();
  if (!row) throw new Error(`Data table ${id} not found`);
}

/** SetDataTableSchema — replaces the discovered source schema slice. */
const setDataTableSchema = mutation({
  args: { id: uuid, sourceSchema: jsonb },
  handler: async (ctx, { id, sourceSchema }): Promise<{ ok: true }> => {
    await requireDataTable(ctx, id);
    await ctx.db
      .from(dataTables)
      .where(eq("id", id))
      .update({ sourceSchema: sourceSchema as SourceSchema });
    return { ok: true };
  },
});

/** RefreshDataTable — points the table at a new DataFrame and stamps the fetch. */
const refreshDataTable = mutation({
  args: { id: uuid, dataFrameId: uuid },
  handler: async (ctx, { id, dataFrameId }): Promise<{ ok: true }> => {
    await requireDataTable(ctx, id);
    await ctx.db
      .from(dataTables)
      .where(eq("id", id))
      .update({ dataFrameId, lastFetchedAt: new Date() });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Insight commands
// ---------------------------------------------------------------------------

/**
 * CreateInsight — mints a new transform node over a DataFrame-producing input
 * (DataTable or another Insight). The `source.sourceId` is written into both
 * the new polymorphic `source` field AND the legacy `baseTableId` so the
 * existing `rowToInsight` reader in `app-artifacts.ts` continues to work.
 * When `sourceType === 'insight'` the `baseTableId` carries the source insight
 * id — the legacy reader will treat it as a table id, but that is harmless
 * until the read path is migrated (YW-157).
 */
const createInsight = mutation({
  args: {
    id: uuid,
    name: text,
    source: jsonb,
    selectedFields: jsonb.optional(),
    metrics: jsonb.optional(),
  },
  handler: async (ctx, args): Promise<{ id: string }> => {
    const source = args.source as InsightSource;
    if (source.sourceType !== "dataTable" && source.sourceType !== "insight") {
      throw new Error(
        `CreateInsight: source.sourceType must be 'dataTable' or 'insight'`,
      );
    }
    const definition: StoredInsightDefinition = {
      baseTableId: source.sourceId,
      source,
      selectedFields: (args.selectedFields as UUID[] | undefined) ?? [],
      metrics: (args.metrics as unknown[] | undefined) ?? [],
    };
    const [row] = (await ctx.db.into(insights).insert({
      id: args.id,
      name: args.name,
      definition,
      createdBy: { kind: "user" },
    })) as InsightRow[];
    if (!row) throw new Error("insert returned no row");
    return { id: row.id };
  },
});

/**
 * SetInsightSource — re-points an Insight's input to a DataTable or another
 * Insight's DataFrame (Insight-on-Insight composition). Rejects a source that
 * would create a cycle — i.e. if the proposed source already depends on this
 * Insight transitively.
 */
const setInsightSource = mutation({
  args: { id: uuid, source: jsonb },
  handler: async (ctx, { id, source: rawSource }): Promise<{ ok: true }> => {
    const source = rawSource as InsightSource;
    if (source.sourceType !== "dataTable" && source.sourceType !== "insight") {
      throw new Error(
        `SetInsightSource: source.sourceType must be 'dataTable' or 'insight'`,
      );
    }
    const { definition } = await requireInsightDefinition(ctx, id);

    // Cycle detection: only needed when the new source is another Insight.
    if (source.sourceType === "insight") {
      if (await wouldCreateCycle(ctx, id, source.sourceId)) {
        throw new Error(
          `SetInsightSource: source ${source.sourceId} would create a cycle`,
        );
      }
    }

    const next: StoredInsightDefinition = {
      ...definition,
      baseTableId: source.sourceId,
      source,
    };
    await ctx.db
      .from(insights)
      .where(eq("id", id))
      .update({ definition: next });
    return { ok: true };
  },
});

/**
 * SelectFields — replace-all set of selected dimension field ids on an Insight.
 * Replace-all semantics: the caller supplies the desired final set; incremental
 * add/remove is done client-side before calling this command.
 */
const selectFields = mutation({
  args: { id: uuid, fieldIds: jsonb },
  handler: async (ctx, { id, fieldIds }): Promise<{ ok: true }> => {
    const { definition } = await requireInsightDefinition(ctx, id);
    const next: StoredInsightDefinition = {
      ...definition,
      selectedFields: fieldIds as UUID[],
    };
    await ctx.db
      .from(insights)
      .where(eq("id", id))
      .update({ definition: next });
    return { ok: true };
  },
});

/**
 * SetInsightFilter — replace-all filter predicates. Each filter value operand
 * is a tagged union `{ kind: 'value', v } | { kind: 'lateBound', ref }` per
 * the YW-153 spike finding (discriminant required, no property-presence).
 * The command stores operands opaquely — validation of the union discriminant
 * is shape-only here; unknown handles fail at publish binding (Draft spec).
 */
const setInsightFilter = mutation({
  args: { id: uuid, filters: jsonb },
  handler: async (ctx, { id, filters }): Promise<{ ok: true }> => {
    const { definition } = await requireInsightDefinition(ctx, id);
    const next: StoredInsightDefinition = {
      ...definition,
      filters: filters as unknown[],
    };
    await ctx.db
      .from(insights)
      .where(eq("id", id))
      .update({ definition: next });
    return { ok: true };
  },
});

/**
 * SetInsightSort — replace-all sort order. Replace-all semantics mirror
 * SetInsightFilter: the complete desired sort list replaces the existing one.
 */
const setInsightSort = mutation({
  args: { id: uuid, sorts: jsonb },
  handler: async (ctx, { id, sorts }): Promise<{ ok: true }> => {
    const { definition } = await requireInsightDefinition(ctx, id);
    const next: StoredInsightDefinition = {
      ...definition,
      sorts: sorts as unknown[],
    };
    await ctx.db
      .from(insights)
      .where(eq("id", id))
      .update({ definition: next });
    return { ok: true };
  },
});

/**
 * Apply one incremental edit to the `joins` collection in an Insight definition.
 * Mirrors `patchDataTableCollection`'s guard symmetry:
 * - Add: rejects a duplicate joinIndex (we use array-position indexing, so the
 *   guard is that the array is not already longer than `joinIndex` would imply
 *   — AddJoin appends so there is no index collision; the spec uses array
 *   indices for Update/Remove because joins are ordered and anonymous).
 * - Update: rejects a missing index. Pins the structure so updates cannot
 *   rewrite the whole join object in ways that clobber unrelated keys.
 * - Remove: rejects a missing index.
 */
function patchJoinsCollection(
  joins: unknown[],
  op:
    | { mode: "add"; join: InsightJoinConfig }
    | { mode: "update"; joinIndex: number; updates: Record<string, unknown> }
    | { mode: "remove"; joinIndex: number },
): unknown[] {
  if (op.mode === "add") {
    return [...joins, op.join];
  } else if (op.mode === "update") {
    if (op.joinIndex < 0 || op.joinIndex >= joins.length) {
      throw new Error(`Join at index ${op.joinIndex} not found`);
    }
    // Pin the join by spreading updates then overwriting the whole element —
    // the same id-pin semantics that patchDataTableCollection provides.
    return joins.map((j, i) =>
      i === op.joinIndex ? { ...(j as object), ...op.updates } : j,
    );
  } else {
    if (op.joinIndex < 0 || op.joinIndex >= joins.length) {
      throw new Error(`Join at index ${op.joinIndex} not found`);
    }
    return joins.filter((_, i) => i !== op.joinIndex);
  }
}

/** AddJoin — append an inline join to an Insight. */
const addJoin = mutation({
  args: { id: uuid, join: jsonb },
  handler: async (ctx, { id, join }): Promise<{ ok: true }> => {
    const { definition } = await requireInsightDefinition(ctx, id);
    const next: StoredInsightDefinition = {
      ...definition,
      joins: patchJoinsCollection(definition.joins ?? [], {
        mode: "add",
        join: join as InsightJoinConfig,
      }),
    };
    await ctx.db
      .from(insights)
      .where(eq("id", id))
      .update({ definition: next });
    return { ok: true };
  },
});

/** UpdateJoin — edit a join's keys/type at the given array index. */
const updateJoin = mutation({
  args: { id: uuid, joinIndex: jsonb, updates: jsonb },
  handler: async (ctx, { id, joinIndex, updates }): Promise<{ ok: true }> => {
    if (!isRecord(updates) || Object.keys(updates).length === 0) {
      throw new Error("updates are required for UpdateJoin");
    }
    if (
      typeof joinIndex !== "number" ||
      !Number.isInteger(joinIndex) ||
      joinIndex < 0
    ) {
      throw new Error(
        `UpdateJoin: joinIndex must be a non-negative integer, got ${JSON.stringify(joinIndex)}`,
      );
    }
    const { definition } = await requireInsightDefinition(ctx, id);
    const next: StoredInsightDefinition = {
      ...definition,
      joins: patchJoinsCollection(definition.joins ?? [], {
        mode: "update",
        joinIndex,
        updates,
      }),
    };
    await ctx.db
      .from(insights)
      .where(eq("id", id))
      .update({ definition: next });
    return { ok: true };
  },
});

/** RemoveJoin — drop the join at the given array index. */
const removeJoin = mutation({
  args: { id: uuid, joinIndex: jsonb },
  handler: async (ctx, { id, joinIndex }): Promise<{ ok: true }> => {
    if (
      typeof joinIndex !== "number" ||
      !Number.isInteger(joinIndex) ||
      joinIndex < 0
    ) {
      throw new Error(
        `RemoveJoin: joinIndex must be a non-negative integer, got ${JSON.stringify(joinIndex)}`,
      );
    }
    const { definition } = await requireInsightDefinition(ctx, id);
    const next: StoredInsightDefinition = {
      ...definition,
      joins: patchJoinsCollection(definition.joins ?? [], {
        mode: "remove",
        joinIndex,
      }),
    };
    await ctx.db
      .from(insights)
      .where(eq("id", id))
      .update({ definition: next });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Fields & Metrics commands — target a DataFrame-producing node via {nodeId}
// ---------------------------------------------------------------------------

type ResolvedNode =
  | { kind: "dataTable"; row: DataTableRow }
  | { kind: "insight"; row: InsightRow };

/**
 * Resolve which kind of node `nodeId` is, returning the row it already fetched
 * so callers don't pay a second lookup. A leaf node is a DataTable (fields and
 * metrics live in its jsonb columns); a derived node is an Insight (fields and
 * metrics live in its `definition` jsonb). One lookup decides the dispatch so
 * the command shape (`{ nodeId, ... }`) never needs to know the kind up front.
 */
async function resolveNode(
  ctx: { db: import("@wystack/db").TrackedDb },
  nodeId: string,
): Promise<ResolvedNode> {
  const table = (await ctx.db
    .from(dataTables)
    .where(eq("id", nodeId))
    .first()) as DataTableRow | undefined;
  if (table) return { kind: "dataTable", row: table };
  const insight = (await ctx.db
    .from(insights)
    .where(eq("id", nodeId))
    .first()) as InsightRow | undefined;
  if (insight) return { kind: "insight", row: insight };
  throw new Error(`Node ${nodeId} not found`);
}

/**
 * Apply one incremental collection edit to a node's fields or metrics array.
 * For DataTable nodes the array lives in the row's `fields`/`metrics` columns.
 * For Insight nodes the array lives inside `definition.fields`/`definition.metrics`
 * (not the top-level jsonb `definition` structure — the Insight's own-definitions
 * section, distinct from the inherited ones from its source).
 *
 * Guard symmetry (mirrors patchDataTableCollection's contract from YW-106):
 * - Add: rejects duplicate id (no illegal two-items-one-id state)
 * - Update: rejects missing id; pins `id` last so updates cannot rebind the key
 * - Remove: rejects missing id
 *
 * Concurrency: read-modify-write is safe on PGLite (single-connection —
 * batches serialize at the event loop). A future multi-connection Postgres
 * backend needs SELECT FOR UPDATE or jsonb-native append.
 */
async function patchDataTableCollection(
  ctx: { db: import("@wystack/db").TrackedDb },
  nodeId: string,
  kind: "fields" | "metrics",
  op:
    | { mode: "add"; item: Field | Metric }
    | { mode: "update"; itemId: string; updates: Record<string, unknown> }
    | { mode: "remove"; itemId: string },
): Promise<void> {
  const node = await resolveNode(ctx, nodeId);

  if (node.kind === "insight") {
    // Insight fields/metrics live inside the definition jsonb under the same
    // key names ("fields"/"metrics") as an extension to the InsightDefinition.
    const definition = node.row.definition as StoredInsightDefinition & {
      fields?: { id: string }[];
      metrics?: { id: string }[];
    };
    const items = ((definition[kind] ?? []) as { id: string }[]).slice();
    const next = applyCollectionOp(items, kind, op);
    const nextDefinition = { ...definition, [kind]: next };
    await ctx.db
      .from(insights)
      .where(eq("id", nodeId))
      .update({ definition: nextDefinition });
    return;
  }

  // DataTable path: items live in the top-level row columns.
  const items = ((node.row[kind] ?? []) as { id: string }[]).slice();
  const next = applyCollectionOp(items, kind, op);

  await ctx.db
    .from(dataTables)
    .where(eq("id", nodeId))
    .update({ [kind]: next });
}

/**
 * Pure helper: apply one add/update/remove op to a `{ id: string }[]` array,
 * enforcing the guard symmetry. Extracted so both the DataTable and Insight
 * paths share identical mutation logic.
 */
function applyCollectionOp(
  items: { id: string }[],
  kind: string,
  op:
    | { mode: "add"; item: Field | Metric }
    | { mode: "update"; itemId: string; updates: Record<string, unknown> }
    | { mode: "remove"; itemId: string },
): { id: string }[] {
  if (op.mode === "add") {
    // Guard id uniqueness symmetrically with Update/Remove. Without it a second
    // Add of the same id would make an illegal state representable (two items,
    // one id) that Update/Remove then mutate/drop together — silently
    // un-addressable individually.
    if (items.some((item) => item.id === op.item.id)) {
      throw new Error(`${kind} item ${op.item.id} already exists`);
    }
    return [...items, op.item];
  } else if (op.mode === "update") {
    if (!items.some((item) => item.id === op.itemId)) {
      throw new Error(`${kind} item ${op.itemId} not found`);
    }
    // Pin `id` last so a stray `updates.id` cannot rebind the item — that would
    // recreate the un-addressable two-items-one-id state the Add-guard prevents.
    return items.map((item) =>
      item.id === op.itemId ? { ...item, ...op.updates, id: item.id } : item,
    );
  } else {
    if (!items.some((item) => item.id === op.itemId)) {
      throw new Error(`${kind} item ${op.itemId} not found`);
    }
    return items.filter((item) => item.id !== op.itemId);
  }
}

const addField = mutation({
  args: { nodeId: uuid, field: jsonb },
  handler: async (ctx, { nodeId, field }): Promise<{ ok: true }> => {
    await patchDataTableCollection(ctx, nodeId, "fields", {
      mode: "add",
      item: requireRecordWithId(field, "field") as unknown as Field,
    });
    return { ok: true };
  },
});

const updateField = mutation({
  args: { nodeId: uuid, fieldId: uuid, updates: jsonb },
  handler: async (ctx, { nodeId, fieldId, updates }): Promise<{ ok: true }> => {
    if (!isRecord(updates) || Object.keys(updates).length === 0) {
      throw new Error("updates are required for UpdateField");
    }
    await patchDataTableCollection(ctx, nodeId, "fields", {
      mode: "update",
      itemId: fieldId,
      updates,
    });
    return { ok: true };
  },
});

const removeField = mutation({
  args: { nodeId: uuid, fieldId: uuid },
  handler: async (ctx, { nodeId, fieldId }): Promise<{ ok: true }> => {
    await patchDataTableCollection(ctx, nodeId, "fields", {
      mode: "remove",
      itemId: fieldId,
    });
    return { ok: true };
  },
});

const addMetric = mutation({
  args: { nodeId: uuid, metric: jsonb },
  handler: async (ctx, { nodeId, metric }): Promise<{ ok: true }> => {
    await patchDataTableCollection(ctx, nodeId, "metrics", {
      mode: "add",
      item: requireRecordWithId(metric, "metric") as unknown as Metric,
    });
    return { ok: true };
  },
});

const updateMetric = mutation({
  args: { nodeId: uuid, metricId: uuid, updates: jsonb },
  handler: async (
    ctx,
    { nodeId, metricId, updates },
  ): Promise<{ ok: true }> => {
    if (!isRecord(updates) || Object.keys(updates).length === 0) {
      throw new Error("updates are required for UpdateMetric");
    }
    await patchDataTableCollection(ctx, nodeId, "metrics", {
      mode: "update",
      itemId: metricId,
      updates,
    });
    return { ok: true };
  },
});

const removeMetric = mutation({
  args: { nodeId: uuid, metricId: uuid },
  handler: async (ctx, { nodeId, metricId }): Promise<{ ok: true }> => {
    await patchDataTableCollection(ctx, nodeId, "metrics", {
      mode: "remove",
      itemId: metricId,
    });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Visualization commands
// ---------------------------------------------------------------------------

/**
 * Remove the `data` key from a Vega-Lite spec before persisting.
 * Keeps storage/privacy behaviour consistent with the legacy
 * createVisualization/updateVisualization handlers in app-artifacts.ts.
 */
function stripDataFromSpec(spec: VegaLiteSpec): VegaLiteSpec {
  const next = { ...spec };
  delete next.data;
  return next;
}

/**
 * CreateVisualization — mints a chart over an Insight's DataFrame with a
 * client-supplied id. Insight and Visualization stay 1:many (spec decision):
 * the UI creates a 1:1 feel by batching CreateInsight + CreateVisualization in
 * one envelope, but the model keeps one-query-many-charts open.
 */
const createVisualization = mutation({
  args: {
    id: uuid,
    name: text,
    insightId: uuid,
    visualizationType: text,
    spec: jsonb,
    encoding: jsonb.optional(),
  },
  handler: async (ctx, args): Promise<{ id: string }> => {
    const [row] = (await ctx.db.into(visualizations).insert({
      id: args.id,
      name: args.name,
      insightId: args.insightId,
      chartType: args.visualizationType,
      encoding: (args.encoding ?? {}) as VisualizationEncoding,
      options: { spec: stripDataFromSpec(args.spec as VegaLiteSpec) },
      createdBy: { kind: "user" },
    })) as VisualizationRow[];
    if (!row) throw new Error("insert returned no row");
    return { id: row.id };
  },
});

async function requireVisualization(
  ctx: { db: import("@wystack/db").TrackedDb },
  id: string,
): Promise<void> {
  const row = await ctx.db.from(visualizations).where(eq("id", id)).first();
  if (!row) throw new Error(`Visualization ${id} not found`);
}

/**
 * SetChartType — change the chart type for an existing Visualization.
 * Decomposed out of the coarse `updateVisualization` blob handler.
 */
const setChartType = mutation({
  args: { id: uuid, visualizationType: text },
  handler: async (ctx, { id, visualizationType }): Promise<{ ok: true }> => {
    await requireVisualization(ctx, id);
    await ctx.db
      .from(visualizations)
      .where(eq("id", id))
      .update({ chartType: visualizationType });
    return { ok: true };
  },
});

/**
 * SetChartEncoding — set the field→channel encoding (and resulting Vega-Lite
 * spec) for a Visualization. `spec` is optional — omitting it leaves the
 * existing spec untouched.
 */
const setChartEncoding = mutation({
  args: { id: uuid, encoding: jsonb, spec: jsonb.optional() },
  handler: async (ctx, { id, encoding, spec }): Promise<{ ok: true }> => {
    await requireVisualization(ctx, id);
    const patch: Partial<VisualizationRow> = {
      encoding: encoding as VisualizationEncoding,
    };
    if (spec !== undefined) {
      patch.options = { spec: stripDataFromSpec(spec as VegaLiteSpec) };
    }
    await ctx.db.from(visualizations).where(eq("id", id)).update(patch);
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Dashboard commands (net-new in the server vocabulary — YW-123)
// ---------------------------------------------------------------------------

// Re-use the DashboardItem interface from dashboards.ts inline (no re-export).
interface DashboardItem {
  id: string;
  type: "visualization" | "markdown";
  visualizationId?: string;
  content?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Load a dashboard's layout array, throwing if the dashboard does not exist. */
async function requireDashboardItems(
  ctx: { db: import("@wystack/db").TrackedDb },
  dashboardId: string,
): Promise<DashboardItem[]> {
  const row = (await ctx.db
    .from(dashboards)
    .where(eq("id", dashboardId))
    .first()) as DashboardRow | undefined;
  if (!row) throw new Error(`Dashboard ${dashboardId} not found`);
  return ((row.layout as DashboardItem[]) ?? []).slice();
}

/**
 * CreateDashboard — mints an empty dashboard with a client-supplied id.
 */
const createDashboard = mutation({
  args: { id: uuid, name: text, description: text.optional() },
  handler: async (ctx, { id, name, description }): Promise<{ id: string }> => {
    const [row] = (await ctx.db.into(dashboards).insert({
      id,
      name,
      description: description ?? null,
      layout: [],
      createdBy: { kind: "user" },
    })) as DashboardRow[];
    if (!row) throw new Error("insert returned no row");
    return { id: row.id };
  },
});

/**
 * AddDashboardItem — place a viz panel or markdown block on a dashboard.
 *
 * Guard symmetry: the item's `id` is caller-supplied (client-generated, same
 * client-id invariant as every Create command). Duplicate ids are rejected so
 * UpdateDashboardItem and RemoveDashboardItem always address exactly one item.
 */
const addDashboardItem = mutation({
  args: { dashboardId: uuid, item: jsonb },
  handler: async (
    ctx,
    { dashboardId, item: rawItem },
  ): Promise<{ ok: true }> => {
    const item = rawItem as DashboardItem;
    if (typeof item.id !== "string") {
      throw new Error("AddDashboardItem: item.id must be a string");
    }
    const items = await requireDashboardItems(ctx, dashboardId);
    if (items.some((it) => it.id === item.id)) {
      throw new Error(`Dashboard item ${item.id} already exists`);
    }
    items.push(item);
    await ctx.db
      .from(dashboards)
      .where(eq("id", dashboardId))
      .update({ layout: items });
    return { ok: true };
  },
});

/**
 * UpdateDashboardItem — move/resize/edit one item.
 *
 * Guard: rejects a missing itemId. Pins `id` and `type` so updates cannot
 * change structural container keys (mirrors UpdateField's id-pin contract).
 */
const updateDashboardItem = mutation({
  args: { dashboardId: uuid, itemId: uuid, updates: jsonb },
  handler: async (
    ctx,
    { dashboardId, itemId, updates },
  ): Promise<{ ok: true }> => {
    if (!isRecord(updates) || Object.keys(updates).length === 0) {
      throw new Error("updates are required for UpdateDashboardItem");
    }
    const items = await requireDashboardItems(ctx, dashboardId);
    if (!items.some((it) => it.id === itemId)) {
      throw new Error(`Dashboard item ${itemId} not found`);
    }
    // Pin `id` and `type` last — type is a structural key (determines which
    // optional fields are valid), so callers cannot rebind it via updates.
    const next = items.map((it) =>
      it.id === itemId
        ? {
            ...it,
            ...(updates as Partial<DashboardItem>),
            id: it.id,
            type: it.type,
          }
        : it,
    );
    await ctx.db
      .from(dashboards)
      .where(eq("id", dashboardId))
      .update({ layout: next });
    return { ok: true };
  },
});

/**
 * SetDashboardLayout — replace the whole layout at once (bulk drag-rearrange).
 * Replace-all counterpart to per-item UpdateDashboardItem. Unlike the
 * replace-all SetInsightFilter/SetInsightSort, dashboard items are id-keyed:
 * UpdateDashboardItem and RemoveDashboardItem both rely on id uniqueness, so a
 * duplicate in the incoming list would corrupt those operations. Guard it.
 */
const setDashboardLayout = mutation({
  args: { dashboardId: uuid, items: jsonb },
  handler: async (ctx, { dashboardId, items }): Promise<{ ok: true }> => {
    // Guard existence first — a missing dashboard would silently do nothing.
    await requireDashboardItems(ctx, dashboardId);
    const parsed = items as DashboardItem[];
    const ids = parsed.map((it) => it.id);
    if (new Set(ids).size !== ids.length) {
      throw new Error("SetDashboardLayout: items contains duplicate ids");
    }
    await ctx.db
      .from(dashboards)
      .where(eq("id", dashboardId))
      .update({ layout: parsed });
    return { ok: true };
  },
});

/**
 * RemoveDashboardItem — remove one panel by id.
 * Guard: rejects a missing itemId (no silent no-op).
 */
const removeDashboardItem = mutation({
  args: { dashboardId: uuid, itemId: uuid },
  handler: async (ctx, { dashboardId, itemId }): Promise<{ ok: true }> => {
    const items = await requireDashboardItems(ctx, dashboardId);
    if (!items.some((it) => it.id === itemId)) {
      throw new Error(`Dashboard item ${itemId} not found`);
    }
    await ctx.db
      .from(dashboards)
      .where(eq("id", dashboardId))
      .update({ layout: items.filter((it) => it.id !== itemId) });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Cross-cutting: RenameNode (one polymorphic rename)
// ---------------------------------------------------------------------------

/**
 * RenameNode — the single `name` mutation, carved out of every coarse
 * update(blob). Polymorphic over all artifact node kinds that carry a `name`
 * column. One lookup per table decides the target; the SET is identical.
 */
const renameNode = mutation({
  args: { id: uuid, name: text },
  handler: async (ctx, { id, name }): Promise<{ ok: true }> => {
    const table = await ctx.db.from(dataTables).where(eq("id", id)).first();
    if (table) {
      await ctx.db.from(dataTables).where(eq("id", id)).update({ name });
      return { ok: true };
    }
    const source = await ctx.db.from(dataSources).where(eq("id", id)).first();
    if (source) {
      await ctx.db.from(dataSources).where(eq("id", id)).update({ name });
      return { ok: true };
    }
    const insight = await ctx.db.from(insights).where(eq("id", id)).first();
    if (insight) {
      await ctx.db.from(insights).where(eq("id", id)).update({ name });
      return { ok: true };
    }
    const viz = await ctx.db.from(visualizations).where(eq("id", id)).first();
    if (viz) {
      await ctx.db.from(visualizations).where(eq("id", id)).update({ name });
      return { ok: true };
    }
    const dash = await ctx.db.from(dashboards).where(eq("id", id)).first();
    if (dash) {
      await ctx.db.from(dashboards).where(eq("id", id)).update({ name });
      return { ok: true };
    }
    throw new Error(`Node ${id} not found`);
  },
});

// ---------------------------------------------------------------------------
// Cross-cutting: DeleteNode (one polymorphic delete — typed-edge cascade rule)
// ---------------------------------------------------------------------------

/**
 * An orphaned node description returned by DeleteNode when a delete stops at a
 * reference edge. The caller (UI or agent) routes these into the Data-Drift
 * Repair flow — from a reference child's perspective, a deleted parent is
 * indistinguishable from drift.
 */
export interface OrphanedNode {
  /** The id of the now-orphaned artifact. */
  id: string;
  /** The kind of artifact: 'insight' | 'visualization' | 'dashboard'. */
  kind: "insight" | "visualization" | "dashboard";
}

/**
 * Walk all Insights whose primary source OR any join dependency equals
 * `sourceId`. These are the reference-boundary nodes that must be routed to
 * drift-repair when `sourceId` is deleted.
 *
 * The check covers:
 *   • The new `source.sourceId` field (CreateInsight / SetInsightSource).
 *   • The legacy `baseTableId` field for pre-composition rows (YW-157).
 *   • Any `joins[*].rightTableId` — an Insight that JOINs against the deleted
 *     node is just as broken as one that sources it directly.
 *
 * Because insights.definition is a jsonb column with no stored FK, this is a
 * full-table scan filtered in application code (PGLite single-connection, the
 * table is small in practice). A future index on a promoted column would speed
 * this up; the read is intentionally bounded to the delete path.
 */
function isOrphanedBy(row: InsightRow, sourceId: string): boolean {
  const def = row.definition as StoredInsightDefinition;
  // Primary source check.
  const primaryMatch = def.source
    ? def.source.sourceId === sourceId
    : def.baseTableId === sourceId;
  if (primaryMatch) return true;
  // Join-dependency check — an Insight JOINing against the deleted node
  // is also orphaned (its rightTableId no longer resolves).
  const joins = (def.joins ?? []) as { rightTableId?: string }[];
  return joins.some((j) => j.rightTableId === sourceId);
}

async function findOrphanedInsights(
  ctx: { db: import("@wystack/db").TrackedDb },
  sourceId: string,
): Promise<{ id: string }[]> {
  const allInsights = (await ctx.db.from(insights).all()) as InsightRow[];
  return allInsights.filter((row) => isOrphanedBy(row, sourceId));
}

/**
 * Delete all DataFrame metadata rows linked to the given node id (by
 * `insightId` column) and return their storage locations so the caller can
 * signal Arrow/IndexedDB cleanup. DataTable rows link via `dataFrameId` (a
 * nullable FK on the DataTable row itself), not a column on the DataFrame —
 * so DataTable cleanup is handled by the caller passing the DataTable's
 * `dataFrameId` directly.
 *
 * The `dataFrames` table stores metadata only; the actual Arrow bytes live in
 * the renderer's IndexedDB. Deleting the metadata row here is the signal the
 * client-side `removeDataFrame` hook needs to clean up the Arrow bytes via
 * `deleteArrowData(storage.key)` (see `packages/app-data/src/data-frames.ts`).
 */
async function deleteInsightDataFrames(
  ctx: { db: import("@wystack/db").TrackedDb },
  insightId: string,
): Promise<void> {
  // Delete all DataFrame rows whose insightId matches — there should be at
  // most one per Insight in practice, but the schema allows N.
  await ctx.db.from(dataFrames).where(eq("insightId", insightId)).delete();
}

/**
 * Collect all orphaned Insights and clean up DataFrame metadata for a
 * DataSource delete. Extracted to keep `deleteNode`'s handler within the
 * cognitive-complexity budget.
 *
 * Returns the deduplicated set of Insights that SOURCE or JOIN any of
 * `ownedTables` (these are the reference-boundary orphans). As a side-effect,
 * deletes the DataFrame metadata rows for each DataTable's Arrow result so the
 * client-side `removeDataFrame` hook can clean up Arrow bytes.
 *
 * The full insights table is fetched once (not once-per-table) so that N owned
 * tables do not produce N round-trips.
 */
async function deleteDataSourceDependents(
  ctx: { db: import("@wystack/db").TrackedDb },
  ownedTables: (typeof dataTables.$inferSelect)[],
): Promise<OrphanedNode[]> {
  // Fetch all insights once — avoids O(N) full-table scans inside the loop.
  const allInsights = (await ctx.db.from(insights).all()) as InsightRow[];
  const ownedTableIds = new Set(ownedTables.map((t) => t.id));

  // Detect reference-boundary Insights across ALL owned tables (deduplicated).
  const seen = new Set<string>();
  const orphanedNodes: OrphanedNode[] = [];
  for (const row of allInsights) {
    if (seen.has(row.id)) continue;
    // Check primary source and all join dependencies against every owned table.
    const orphaned = [...ownedTableIds].some((tableId) =>
      isOrphanedBy(row, tableId),
    );
    if (orphaned) {
      seen.add(row.id);
      orphanedNodes.push({ id: row.id, kind: "insight" });
    }
  }

  // Clean up DataFrame metadata for each owned DataTable's Arrow result.
  for (const t of ownedTables) {
    if (t.dataFrameId) {
      await ctx.db.from(dataFrames).where(eq("id", t.dataFrameId)).delete();
    }
  }

  return orphanedNodes;
}

/**
 * DeleteNode — one polymorphic delete that implements the Artifact Model's
 * typed-edge cascade rule (Spec — DashFrame Artifact Model, "Edge types and
 * the delete cascade"):
 *
 *   Ownership edges (cascade through): DataSource → DataTable.
 *   Reference edges (stop at): DataTable → Insight, Insight → Insight,
 *     Insight → Visualization (owned by schema FK — kept because Viz has no
 *     independent value without its Insight).
 *
 * **Cascade path:**
 *   - Deleting a Visualization: only the Visualization is removed.
 *   - Deleting a Dashboard: only the Dashboard is removed.
 *   - Deleting an Insight:
 *       • Owned Visualizations cascade-delete via the DB schema FK.
 *       • The Insight's DataFrame metadata row is deleted (triggers Arrow
 *         cleanup on the client via `removeDataFrame`).
 *       • Insights that SOURCE this Insight are detected and returned as
 *         `orphanedNodes` (reference-boundary → drift-repair, not auto-delete).
 *   - Deleting a DataTable:
 *       • The DataTable's DataFrame metadata row is deleted.
 *       • Insights that SOURCE this DataTable are returned as `orphanedNodes`.
 *   - Deleting a DataSource:
 *       • Owned DataTables cascade-delete via the DB schema FK.
 *       • DataFrame metadata rows for each owned DataTable are deleted.
 *       • Insights that SOURCE any of those DataTables are returned as
 *         `orphanedNodes`.
 *
 * The returned `orphanedNodes` list is the "warning surface" the ticket
 * describes — the UI/agent routes these into the Data-Drift Repair flow.
 * Nothing is silently orphaned and no authored artifact is silently destroyed.
 */
const deleteNode = mutation({
  args: { id: uuid },
  handler: async (
    ctx,
    { id },
  ): Promise<{ ok: true; orphanedNodes: OrphanedNode[] }> => {
    // --- Visualization (leaf — no owned children, no reference children) ----
    const viz = await ctx.db.from(visualizations).where(eq("id", id)).first();
    if (viz) {
      await ctx.db.from(visualizations).where(eq("id", id)).delete();
      return { ok: true, orphanedNodes: [] };
    }

    // --- Dashboard (leaf — no owned children, no reference children) --------
    const dash = await ctx.db.from(dashboards).where(eq("id", id)).first();
    if (dash) {
      await ctx.db.from(dashboards).where(eq("id", id)).delete();
      return { ok: true, orphanedNodes: [] };
    }

    // --- Insight ------------------------------------------------------------
    // Owned visualizations cascade-delete via the DB schema FK
    // (visualizations.insight_id references insights.id ON DELETE CASCADE).
    // Reference-boundary: Insights that SOURCE this Insight enter drift-repair.
    const insight = (await ctx.db
      .from(insights)
      .where(eq("id", id))
      .first()) as InsightRow | undefined;
    if (insight) {
      // Detect reference-boundary orphans BEFORE the delete (so the rows exist).
      const derivedInsights = await findOrphanedInsights(ctx, id);
      // Clean up DataFrame metadata so the client-side Arrow cleanup hook fires.
      await deleteInsightDataFrames(ctx, id);
      // Delete the Insight — schema FK cascade removes its Visualizations.
      await ctx.db.from(insights).where(eq("id", id)).delete();
      return {
        ok: true,
        orphanedNodes: derivedInsights.map((r) => ({
          id: r.id,
          kind: "insight" as const,
        })),
      };
    }

    // --- DataTable ----------------------------------------------------------
    // No owned children (DataTable is owned by DataSource, not by DataTable).
    // Reference-boundary: Insights that SOURCE this DataTable enter drift-repair.
    // Arrow cleanup: delete the DataTable's DataFrame metadata if it has one.
    const table = (await ctx.db
      .from(dataTables)
      .where(eq("id", id))
      .first()) as typeof dataTables.$inferSelect | undefined;
    if (table) {
      const orphanedInsights = await findOrphanedInsights(ctx, id);
      if (table.dataFrameId) {
        await ctx.db
          .from(dataFrames)
          .where(eq("id", table.dataFrameId))
          .delete();
      }
      await ctx.db.from(dataTables).where(eq("id", id)).delete();
      return {
        ok: true,
        orphanedNodes: orphanedInsights.map((r) => ({
          id: r.id,
          kind: "insight" as const,
        })),
      };
    }

    // --- DataSource ---------------------------------------------------------
    // Owned DataTables cascade-delete via the DB schema FK
    // (data_tables.data_source_id references data_sources.id ON DELETE CASCADE).
    // Collect owned tables before the delete (FK cascade would remove them).
    const source = await ctx.db.from(dataSources).where(eq("id", id)).first();
    if (source) {
      const ownedTables = (await ctx.db
        .from(dataTables)
        .where(eq("dataSourceId", id))
        .all()) as (typeof dataTables.$inferSelect)[];
      const orphanedNodes = await deleteDataSourceDependents(ctx, ownedTables);
      // Delete the DataSource — schema FK cascade removes its DataTables.
      await ctx.db.from(dataSources).where(eq("id", id)).delete();
      return { ok: true, orphanedNodes };
    }

    throw new Error(`Node ${id} not found`);
  },
});

/**
 * The command-backing mutation registry. Spread into the app's `functions` so
 * `applyCommands` can dispatch each by path. Keys are the wire paths the
 * builders below reference.
 */
export const commandFunctions = {
  // DataSource (YW-106)
  getOrCreateDataSource,
  createDataSource,
  setDataSourceConfig,
  // DataTable (YW-106)
  createDataTable,
  setDataTableSchema,
  refreshDataTableCmd: refreshDataTable,
  // Fields & Metrics (YW-106, now also handles Insight nodes via YW-123)
  addField,
  updateField,
  removeField,
  addMetric,
  updateMetric,
  removeMetric,
  // Insight (YW-123)
  createInsightCmd: createInsight,
  setInsightSource,
  selectFields,
  setInsightFilter,
  setInsightSort,
  addJoin,
  updateJoin,
  removeJoin,
  // Visualization (YW-123)
  createVisualizationCmd: createVisualization,
  setChartType,
  setChartEncoding,
  // Dashboard (YW-123)
  createDashboardCmd: createDashboard,
  addDashboardItemCmd: addDashboardItem,
  updateDashboardItemCmd: updateDashboardItem,
  setDashboardLayout,
  removeDashboardItemCmd: removeDashboardItem,
  // Cross-cutting (YW-106 + extended in YW-123)
  renameNode,
  deleteNode,
};

// ---------------------------------------------------------------------------
// Typed command builders — the VOCABULARY face
// ---------------------------------------------------------------------------

/**
 * The polymorphic source for Insight commands (DataTable or another Insight's
 * DataFrame). Exported so callers can construct it without knowing the union
 * shape inline.
 */
export type InsightSourceInput =
  | { sourceType: "dataTable"; sourceId: UUID }
  | { sourceType: "insight"; sourceId: UUID };

/**
 * A filter predicate value operand — tagged union per YW-153 spike.
 * `kind: 'value'`    → the author supplied the literal (v: null = IS NULL).
 * `kind: 'lateBound'` → the egress gate withheld the value; bound at publish.
 */
export type FilterOperandValue =
  | { kind: "value"; v: unknown }
  | { kind: "lateBound"; ref: LateBoundRef };

/**
 * Late-bound reference forms (spec: Artifact API, Operand value-binding).
 * column    → operand IS another column; no literal needed.
 * category  → opaque handle for a value the gate minted; resolved at publish.
 * placeholder → human supplies at publish.
 */
export type LateBoundRef =
  | { type: "column"; fieldId: UUID }
  | { type: "category"; handle: string }
  | { type: "placeholder"; prompt: string };

/**
 * A filter predicate where the value operand is a FilterOperandValue.
 * Mirrors InsightFilter from @dashframe/types but with the typed operand.
 */
export interface TypedInsightFilter {
  field: string;
  operator: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "contains" | "in";
  value: FilterOperandValue;
}

/** A Dashboard item as supplied in AddDashboardItem / SetDashboardLayout. */
export interface DashboardItemInput {
  id: UUID;
  type: "visualization" | "markdown";
  visualizationId?: UUID;
  content?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Typed payloads for each command. These are the intent-carrying messages the
 * human UI and the agent both construct; `COMMAND_PATHS` lowers them to the
 * `{ path, args }` envelope `applyCommands` dispatches. Keeping the builder pure
 * (no DB) means the only place command logic lives is the backing mutation.
 */
export interface CommandPayloads {
  // DataSource (YW-106)
  GetOrCreateDataSource: { id: UUID; type: string; name: string };
  CreateDataSource: {
    id: UUID;
    type: string;
    name: string;
    apiKey?: string;
    connectionString?: string;
  };
  SetDataSourceConfig: {
    id: UUID;
    apiKey?: string;
    connectionString?: string;
  };
  // DataTable (YW-106)
  CreateDataTable: {
    id: UUID;
    dataSourceId: UUID;
    name: string;
    table: string;
    sourceSchema?: SourceSchema;
    fields?: Field[];
    metrics?: Metric[];
    dataFrameId?: UUID;
  };
  SetDataTableSchema: { id: UUID; sourceSchema: SourceSchema };
  RefreshDataTable: { id: UUID; dataFrameId: UUID };
  // Fields & Metrics (YW-106, targets DataTable or Insight via nodeId)
  AddField: { nodeId: UUID; field: Field };
  UpdateField: { nodeId: UUID; fieldId: UUID; updates: Partial<Field> };
  RemoveField: { nodeId: UUID; fieldId: UUID };
  AddMetric: { nodeId: UUID; metric: Metric };
  UpdateMetric: { nodeId: UUID; metricId: UUID; updates: Partial<Metric> };
  RemoveMetric: { nodeId: UUID; metricId: UUID };
  // Insight (YW-123)
  CreateInsight: {
    id: UUID;
    name: string;
    source: InsightSourceInput;
    selectedFields?: UUID[];
    metrics?: Metric[];
  };
  SetInsightSource: { id: UUID; source: InsightSourceInput };
  SelectFields: { id: UUID; fieldIds: UUID[] };
  SetInsightFilter: { id: UUID; filters: TypedInsightFilter[] };
  SetInsightSort: { id: UUID; sorts: InsightSort[] };
  AddJoin: { id: UUID; join: InsightJoinConfig };
  UpdateJoin: {
    id: UUID;
    joinIndex: number;
    updates: Partial<InsightJoinConfig>;
  };
  RemoveJoin: { id: UUID; joinIndex: number };
  // Visualization (YW-123)
  CreateVisualization: {
    id: UUID;
    name: string;
    insightId: UUID;
    visualizationType: VisualizationType;
    spec: VegaLiteSpec;
    encoding?: VisualizationEncoding;
  };
  SetChartType: { id: UUID; visualizationType: VisualizationType };
  SetChartEncoding: {
    id: UUID;
    encoding: VisualizationEncoding;
    spec?: VegaLiteSpec;
  };
  // Dashboard (YW-123)
  CreateDashboard: { id: UUID; name: string; description?: string };
  AddDashboardItem: { dashboardId: UUID; item: DashboardItemInput };
  UpdateDashboardItem: {
    dashboardId: UUID;
    itemId: UUID;
    updates: Partial<Omit<DashboardItemInput, "id" | "type">>;
  };
  SetDashboardLayout: { dashboardId: UUID; items: DashboardItemInput[] };
  RemoveDashboardItem: { dashboardId: UUID; itemId: UUID };
  // Cross-cutting (YW-106 + extended in YW-123)
  RenameNode: { id: UUID; name: string };
  DeleteNode: { id: UUID };
}

export type CommandName = keyof CommandPayloads;

/**
 * Map a command name to the registry path its backing mutation is registered
 * under in the app `functions`. The single source of truth tying the typed
 * vocabulary to the dispatched path.
 */
const COMMAND_PATHS: { [K in CommandName]: keyof typeof commandFunctions } = {
  GetOrCreateDataSource: "getOrCreateDataSource",
  CreateDataSource: "createDataSource",
  SetDataSourceConfig: "setDataSourceConfig",
  CreateDataTable: "createDataTable",
  SetDataTableSchema: "setDataTableSchema",
  RefreshDataTable: "refreshDataTableCmd",
  AddField: "addField",
  UpdateField: "updateField",
  RemoveField: "removeField",
  AddMetric: "addMetric",
  UpdateMetric: "updateMetric",
  RemoveMetric: "removeMetric",
  CreateInsight: "createInsightCmd",
  SetInsightSource: "setInsightSource",
  SelectFields: "selectFields",
  SetInsightFilter: "setInsightFilter",
  SetInsightSort: "setInsightSort",
  AddJoin: "addJoin",
  UpdateJoin: "updateJoin",
  RemoveJoin: "removeJoin",
  CreateVisualization: "createVisualizationCmd",
  SetChartType: "setChartType",
  SetChartEncoding: "setChartEncoding",
  CreateDashboard: "createDashboardCmd",
  AddDashboardItem: "addDashboardItemCmd",
  UpdateDashboardItem: "updateDashboardItemCmd",
  SetDashboardLayout: "setDashboardLayout",
  RemoveDashboardItem: "removeDashboardItemCmd",
  RenameNode: "renameNode",
  DeleteNode: "deleteNode",
};

/**
 * Build one `Command` envelope from a typed payload. `cmd("AddField", {...})`
 * gives compile-time checking of the payload AND the right dispatch path — the
 * capability-parity seam: the same builder the UI and agent call.
 */
export function cmd<K extends CommandName>(
  name: K,
  payload: CommandPayloads[K],
): Command {
  return { path: COMMAND_PATHS[name], args: payload };
}
