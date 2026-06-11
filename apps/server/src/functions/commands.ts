/**
 * Command VOCABULARY (YW-106) — Layer B over @wystack/server's `applyCommands`
 * MECHANISM (YW-122).
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
 * Decomposition: each coarse handler in `app-artifacts.ts` is split into
 * intent-carrying ops (the diffability the draft→publish trust model needs).
 * The traceability table:
 *
 *   getOrCreateDataSourceByType → GetOrCreateDataSource   (the reference atomic command)
 *   addDataSource              → CreateDataSource
 *   updateDataSource           → SetDataSourceConfig + RenameNode
 *   addDataTable               → CreateDataTable
 *   updateDataTable            → RenameNode + SetDataTableSchema + RefreshDataTable
 *   refreshDataTable           → RefreshDataTable
 *   patchDataTableArray        → AddField / UpdateField / RemoveField
 *                                + AddMetric / UpdateMetric / RemoveMetric
 *
 * Cross-cutting `RenameNode` is the one polymorphic rename — the `name` slice
 * carved out of every coarse update(blob).
 *
 * Fields & Metrics target the DataFrame-PRODUCING node polymorphically via
 * `{ nodeId }`, NOT a DataTable id — a leaf node is a DataTable (fields/metrics
 * live in its `fields`/`metrics` jsonb columns); a derived node is an Insight
 * (YW-123). This slice implements the DataTable case and dispatches on node kind
 * so the Insight case slots in without changing the command shape.
 *
 * Operand encoding (YW-153 spike finding): when a value-bearing operand type is
 * introduced (filters, YW-123), it MUST be a TAGGED union
 *   { kind: 'value'; v } | { kind: 'deferred'; ref }   (v: null means IS NULL)
 * NOT property-presence. The YW-106 commands here carry only concrete values
 * (ids, names, schemas, whole Field/Metric records), so no operand type is
 * introduced — adding one speculatively would violate "don't gold-plate". This
 * comment records that the tagged-union convention is established for YW-123.
 */
import { schema } from "@dashframe/server-core";
import type {
  Field,
  Metric,
  RenamedTarget,
  SourceSchema,
  UUID,
} from "@dashframe/types";
import { eq, jsonb, text, uuid } from "@wystack/db";
import type { Command } from "@wystack/server";
import { mutation } from "@wystack/server";

import { type DataSourceConfig, isRecord, requireRecordWithId } from "./utils";

const { dataSources, dataTables, insights } = schema;

type DataSourceRow = typeof dataSources.$inferSelect;
type DataTableRow = typeof dataTables.$inferSelect;

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
    const config: DataSourceConfig = {};
    if (apiKey !== undefined) config.apiKey = apiKey;
    if (connectionString !== undefined)
      config.connectionString = connectionString;
    const [row] = (await ctx.db.into(dataSources).insert({
      id,
      name,
      kind: type,
      storage: "live",
      config,
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
// Fields & Metrics commands — target a DataFrame-producing node via {nodeId}
// ---------------------------------------------------------------------------

type ResolvedNode =
  | { kind: "dataTable"; row: DataTableRow }
  | { kind: "insight" };

/**
 * Resolve which kind of node `nodeId` is, returning the row it already fetched
 * for the DataTable case so callers don't pay a second lookup. A leaf node is a
 * DataTable (fields and metrics live in its jsonb columns); a derived node is
 * an Insight (YW-123, not yet wired for collection edits). One lookup decides
 * the dispatch so the command shape (`{ nodeId, ... }`) never needs to know the
 * kind up front.
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
  const insight = await ctx.db.from(insights).where(eq("id", nodeId)).first();
  if (insight) return { kind: "insight" };
  throw new Error(`Node ${nodeId} not found`);
}

/**
 * Apply one incremental collection edit ("fields" | "metrics") to a DataTable's
 * jsonb array and persist it. Add appends; Update merges by id; Remove drops by
 * id. Update/Remove on a missing id throw so a bad batch fails loudly (and rolls
 * back). Insight nodes are rejected until YW-123 wires their definition arrays.
 *
 * Concurrency: this read-modify-write is safe on PGLite (single-connection —
 * batches serialize at the event loop). A future multi-connection Postgres
 * backend makes it a lost-update vector (two batches read the same array, the
 * later write clobbers the earlier); that tier needs SELECT FOR UPDATE, a
 * raised transaction isolation level at the `applyCommands` call, or a
 * jsonb-native append.
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
    throw new Error(
      `Field/metric edits on Insight node ${nodeId} are not supported yet (YW-123)`,
    );
  }
  const items = ((node.row[kind] ?? []) as { id: string }[]).slice();

  let next: { id: string }[];
  if (op.mode === "add") {
    // Guard id uniqueness symmetrically with Update/Remove. Without it a second
    // Add of the same id would make an illegal state representable (two items,
    // one id) that Update/Remove then mutate/drop together — silently
    // un-addressable individually.
    if (items.some((item) => item.id === op.item.id)) {
      throw new Error(`${kind} item ${op.item.id} already exists`);
    }
    next = [...items, op.item];
  } else if (op.mode === "update") {
    if (!items.some((item) => item.id === op.itemId)) {
      throw new Error(`${kind} item ${op.itemId} not found`);
    }
    // Pin `id` last so a stray `updates.id` cannot rebind the item — that would
    // recreate the un-addressable two-items-one-id state the Add-guard prevents.
    next = items.map((item) =>
      item.id === op.itemId ? { ...item, ...op.updates, id: item.id } : item,
    );
  } else {
    if (!items.some((item) => item.id === op.itemId)) {
      throw new Error(`${kind} item ${op.itemId} not found`);
    }
    next = items.filter((item) => item.id !== op.itemId);
  }

  await ctx.db
    .from(dataTables)
    .where(eq("id", nodeId))
    .update({ [kind]: next });
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
// Cross-cutting: RenameNode (one polymorphic rename)
// ---------------------------------------------------------------------------

/**
 * The `renameNode` handler's result. `renamed` reports the artifact the rename
 * actually resolved to — which table the SET ran against. The preview builder
 * reads this instead of re-deriving the resolution (public issue #64). `value`
 * on the matching `CommandResult` carries this through `applyCommands` verbatim.
 */
export interface RenameNodeResult {
  ok: true;
  renamed: RenamedTarget;
}

/**
 * RenameNode — the single `name` mutation, carved out of every coarse
 * update(blob). Polymorphic over the three artifact NODE kinds
 * (DataSource / DataTable / Insight); presentation artifacts (e.g. views)
 * rename through their own surfaces. One lookup decides the table; the SET
 * is identical across them. The result reports the resolved target so the
 * preview reads the decision rather than re-deriving it.
 */
const renameNode = mutation({
  args: { id: uuid, name: text },
  handler: async (ctx, { id, name }): Promise<RenameNodeResult> => {
    // Probe order (dataTables → dataSources → insights) is load-bearing: the
    // preview builder reads `renamed` to learn which artifact this rename hit
    // rather than re-deriving the resolution (public issue #64). The reported
    // `kind` is the table the SET actually ran against — the single source of
    // truth the preview consumes.
    const table = await ctx.db.from(dataTables).where(eq("id", id)).first();
    if (table) {
      await ctx.db.from(dataTables).where(eq("id", id)).update({ name });
      return { ok: true, renamed: { kind: "dataTable", id } };
    }
    const source = await ctx.db.from(dataSources).where(eq("id", id)).first();
    if (source) {
      await ctx.db.from(dataSources).where(eq("id", id)).update({ name });
      return { ok: true, renamed: { kind: "dataSource", id } };
    }
    const insight = await ctx.db.from(insights).where(eq("id", id)).first();
    if (insight) {
      await ctx.db.from(insights).where(eq("id", id)).update({ name });
      return { ok: true, renamed: { kind: "insight", id } };
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
  getOrCreateDataSource,
  createDataSource,
  setDataSourceConfig,
  createDataTable,
  setDataTableSchema,
  refreshDataTableCmd: refreshDataTable,
  addField,
  updateField,
  removeField,
  addMetric,
  updateMetric,
  removeMetric,
  renameNode,
};

// ---------------------------------------------------------------------------
// Typed command builders — the VOCABULARY face
// ---------------------------------------------------------------------------

/**
 * Typed payloads for each command. These are the intent-carrying messages the
 * human UI and the agent both construct; `commandBuilders` lowers them to the
 * `{ path, args }` envelope `applyCommands` dispatches. Keeping the builder pure
 * (no DB) means the only place command logic lives is the backing mutation.
 */
export interface CommandPayloads {
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
  AddField: { nodeId: UUID; field: Field };
  UpdateField: { nodeId: UUID; fieldId: UUID; updates: Partial<Field> };
  RemoveField: { nodeId: UUID; fieldId: UUID };
  AddMetric: { nodeId: UUID; metric: Metric };
  UpdateMetric: { nodeId: UUID; metricId: UUID; updates: Partial<Metric> };
  RemoveMetric: { nodeId: UUID; metricId: UUID };
  RenameNode: { id: UUID; name: string };
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
  RenameNode: "renameNode",
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
