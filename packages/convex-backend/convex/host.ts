import { operation, runHostCommit, runHostDraft } from "./hostCommands";
import {
  assertResourcesWritable,
  enqueueCleanup,
  enqueueRemovedResources,
  resources,
  secretResources,
} from "./cleanup";
import { hostPrincipal } from "./lifecycleValues";
import {
  stable,
  object,
  json,
  command,
  typed,
  record,
  clean,
  dataFramePage,
  dataTableResourcePage,
  type Json,
  type ObjectValue,
} from "./values";
import { publicationMetadata } from "./publication";
import { artifactTables } from "./model";
import { byFreshness, frameHistory, pruneFrames } from "./frameRetention";
import { LIMIT } from "./graph";
import { validateMetric } from "./engine";
import type { Doc } from "./_generated/dataModel";
import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internal } from "./_generated/api";
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { localImportClaimKind, localImportState } from "./schema";
import { find, rowValue } from "./store";
import type {
  ArtifactRow,
  DataSourceRow,
  DataTableRow,
  DataFrameRow,
  DataFramePage,
  InsightRow,
} from "./model";
import { parseStoredDataTableState, parseTableOrigin } from "./tableCodec";
const workspace = { workspaceId: v.string() };
/**
 * What one bulk write may handle per transaction before it schedules the
 * rest: rows, and the bytes read while reaching them. Each row costs one
 * write plus a few reads and writes for its cleanup records, so a batch this
 * size stays an order of magnitude inside Convex's per-transaction limits
 * (16,000 documents written, 32,000 scanned, 16 MiB read). Rows are read a
 * small chunk at a time and each chunk is charged against the byte budget, so
 * a batch of large rows ends early instead of failing on the read limit; a
 * chunk can overshoot the budget by at most its own rows. Convex allows one
 * `paginate` per function, so these reads are plain `take`s.
 */
export const BULK_WRITE_BATCH = 250;
export const BULK_READ_BYTES = 4 * 1024 * 1024;
const BULK_READ_CHUNK = 10;
/** Tests shrink the batch to exercise continuation without seeding thousands of rows. */
const batchSizeArg = { batchSize: v.optional(v.number()) };
function bulkBatch(size: number | undefined): number {
  if (size === undefined) return BULK_WRITE_BATCH;
  if (!Number.isInteger(size) || size < 1 || size > BULK_WRITE_BATCH)
    throw new Error("Invalid bulk batch size");
  return size;
}
/** The rows and bytes a bulk batch may still read in this transaction. */
class BulkBudget {
  rows: number;
  bytes = BULK_READ_BYTES;
  constructor(rows: number) {
    this.rows = rows;
  }
  get exhausted(): boolean {
    return this.rows <= 0 || this.bytes <= 0;
  }
  /** How many rows the next read may take. */
  get chunk(): number {
    return Math.min(this.rows, BULK_READ_CHUNK);
  }
  charge(rows: readonly unknown[]): void {
    this.rows -= rows.length;
    for (const row of rows)
      this.bytes -= utf8.encode(JSON.stringify(row)).length;
  }
  /** A point read made while handling a row counts against the bytes, not the rows. */
  chargeLookup(doc: unknown): void {
    if (doc) this.bytes -= utf8.encode(JSON.stringify(doc)).length;
  }
}
const utf8 = new TextEncoder();
/**
 * An exact position in an index whose last field is `_creationTime`. Creation
 * times are not unique, so the rows already handled at the boundary time are
 * named and skipped by id when the range is read again from `after`.
 */
type CreationKeyset = { after?: number; seen: string[] };
function advance(
  keyset: CreationKeyset,
  rows: readonly { id: string; _creationTime: number }[],
): CreationKeyset {
  const last = rows[rows.length - 1];
  if (!last) return keyset;
  const after = last._creationTime;
  return {
    after,
    seen: [
      ...(keyset.after === after ? keyset.seen : []),
      ...rows.filter((row) => row._creationTime === after).map((row) => row.id),
    ],
  };
}
type ClearedTable =
  (typeof artifactTables)[number] | "draftLog" | "draftChanges";
/**
 * A bulk write's continuation is only valid for the run that scheduled it.
 * The current run of each operation is recorded in `hostSettings`; a call
 * without `runId` starts a new run and retires whatever continuation the
 * previous one still has queued, and a continuation whose run is no longer
 * current does nothing. Completing a run removes the record, so a
 * continuation queued behind the batch that completed also does nothing.
 * Without this, a queued continuation could run after a caller observed
 * completion and clear what the user created in the meantime.
 */
const BULK_RUN_KIND = "bulkRun";
const runIdArg = { runId: v.optional(v.string()) };
async function bulkRunRecord(
  ctx: QueryCtx,
  workspaceId: string,
  operation: string,
) {
  return ctx.db
    .query("hostSettings")
    .withIndex("by_workspaceId_and_kind_and_id", (q) =>
      q
        .eq("workspaceId", workspaceId)
        .eq("kind", BULK_RUN_KIND)
        .eq("id", operation),
    )
    .unique();
}
/** The run this call belongs to, or null when it is a retired continuation. */
async function beginBulkRun(
  ctx: MutationCtx,
  workspaceId: string,
  operation: string,
  runId: string | undefined,
): Promise<string | null> {
  const current = await bulkRunRecord(ctx, workspaceId, operation);
  if (runId !== undefined) return current?.value.runId === runId ? runId : null;
  const value = { runId: crypto.randomUUID(), startedAt: Date.now() };
  if (current) await ctx.db.patch(current._id, { value });
  else
    await ctx.db.insert("hostSettings", {
      workspaceId,
      kind: BULK_RUN_KIND,
      id: operation,
      value,
    });
  return value.runId;
}
async function endBulkRun(
  ctx: MutationCtx,
  workspaceId: string,
  operation: string,
  runId: string,
) {
  const current = await bulkRunRecord(ctx, workspaceId, operation);
  if (current?.value.runId === runId) await ctx.db.delete(current._id);
}
// Keep this map aligned with DIMENSION_SCOPES in connector-ga4/src/metadata.ts.
const GA4_FIELD_SCOPES = {
  date: "time",
  yearWeek: "time",
  sessionDefaultChannelGroup: "session",
} as const;
/**
 * Bound the frames a data table accumulates across refreshes: keep the frame
 * the table now points at and the one it pointed at before (one-step rollback,
 * and the row that keeps the superseded blob named until cleanup confirms it).
 * `pruneFrames` adds anything another artifact or an open draft still
 * references. A table that accumulated more than LIMIT frames before retention
 * existed is left alone and its refresh still commits.
 */
async function retainTableFrames(
  ctx: MutationCtx,
  workspaceId: string,
  definitionId: string,
  currentFrameId: string,
  previousFrameId: string | null,
) {
  const rows = await frameHistory(ctx, workspaceId, { definitionId });
  if (!rows) return;
  await pruneFrames(
    ctx,
    workspaceId,
    rows,
    (frame) => frame.id === currentFrameId || frame.id === previousFrameId,
  );
}
/**
 * Bound a saved insight's results the same way: keep the previous current
 * result (one-step rollback) and whatever else is still referenced, and clear
 * the current-result flag on what remains so the frame being published is the
 * only current one. Over-cap history is not pruned; only the flag is cleared.
 */
async function retainInsightFrames(
  ctx: MutationCtx,
  workspaceId: string,
  insightId: string,
) {
  const isCurrent = (frame: Doc<"dataFrames">) =>
    !!frame.analysis && record(frame.analysis).currentInsightResult === true;
  const clearCurrent = async (frame: Doc<"dataFrames">) => {
    await ctx.db.patch(frame._id, {
      analysis: {
        ...(frame.analysis ? record(frame.analysis) : {}),
        currentInsightResult: false,
      },
      revision: frame.revision + 1,
    });
  };
  const prior = await frameHistory(ctx, workspaceId, { insightId });
  if (!prior) {
    // Over-cap history: read only the newest LIMIT frames, where the current
    // flag lives, so the publication's reads stay bounded whatever the
    // history holds. A stale flag deeper in legacy history is cosmetic.
    const newest = await ctx.db
      .query("dataFrames")
      .withIndex("by_workspaceId_and_insightId", (q) =>
        q.eq("workspaceId", workspaceId).eq("insightId", insightId),
      )
      .order("desc")
      .take(LIMIT);
    for (const frame of newest) if (isCurrent(frame)) await clearCurrent(frame);
    return;
  }
  const previousFrameId =
    prior.filter(isCurrent).sort(byFreshness)[0]?.id ??
    [...prior].sort(byFreshness)[0]?.id;
  const retained = await pruneFrames(
    ctx,
    workspaceId,
    prior,
    (frame) => frame.id === previousFrameId,
  );
  for (const frame of prior)
    if (retained.has(frame.id)) await clearCurrent(frame);
}
export const runtimeReady = internalQuery({
  args: {},
  returns: v.object({ ready: v.literal(true) }),
  handler: async () => ({ ready: true as const }),
});
export const initializeProject = internalMutation({
  args: {
    ...workspace,
    projectId: v.string(),
    name: v.string(),
    version: v.optional(v.string()),
    schemaVersion: v.optional(v.number()),
    createdBy: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("workspaces")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .unique();
    if (existing) {
      if (existing.projectId !== args.projectId)
        throw new Error("Workspace project identity mismatch");
      return null;
    }
    await ctx.db.insert("workspaces", {
      ...args,
      version: args.version ?? "0.3.0",
      schemaVersion: args.schemaVersion ?? 1,
      createdBy: args.createdBy ?? "local",
      createdAt: Date.now(),
    });
    return null;
  },
});

type Ga4RepairPhase = "tables" | "insights";
const ga4RepairPhase = v.union(v.literal("tables"), v.literal("insights"));
type Ga4RepairResult = {
  tablesRepaired: number;
  insightsRepaired: number;
  complete: boolean;
};
const GA4_REPAIR = "ga4MeasureContracts";
/** Whether a source is a GA4 source whose binding predates measure contracts. */
function legacyGa4Source(source: Doc<"dataSources"> | null): boolean {
  const version = source?.config?.sourceBindingVersion;
  return (
    source?.kind === "googleAnalytics" &&
    (version === undefined || version === "v1" || version === "v2")
  );
}
/** Whether a table, named by an insight metric, belongs to a legacy GA4 source. */
function legacyGa4TableLookup(
  ctx: QueryCtx,
  workspaceId: string,
  budget: BulkBudget,
) {
  // Each table and source is read once per batch, and charged to it.
  const sources = new Map<string, boolean>();
  const tables = new Map<string, boolean>();
  return async (tableId: string) => {
    let eligible = tables.get(tableId);
    if (eligible !== undefined) return eligible;
    const table = await find(ctx, workspaceId, "dataTables", tableId);
    budget.chargeLookup(table);
    const dataSourceId = table?.dataSourceId;
    if (dataSourceId === undefined) eligible = false;
    else {
      eligible = sources.get(dataSourceId);
      if (eligible === undefined) {
        const source = (await find(
          ctx,
          workspaceId,
          "dataSources",
          dataSourceId,
        )) as Doc<"dataSources"> | null;
        budget.chargeLookup(source);
        eligible = legacyGa4Source(source);
        sources.set(dataSourceId, eligible);
      }
    }
    tables.set(tableId, eligible);
    return eligible;
  };
}
async function repairGa4Table(
  ctx: MutationCtx,
  table: Doc<"dataTables">,
): Promise<boolean> {
  let changed = false;
  const fields = (table.fields ?? []).map((field) => {
    const columnName = field.columnName;
    const scope =
      typeof columnName === "string"
        ? GA4_FIELD_SCOPES[columnName as keyof typeof GA4_FIELD_SCOPES]
        : undefined;
    if (field.scope !== undefined || scope === undefined) return field;
    changed = true;
    return { ...field, scope };
  });
  const metrics = (table.metrics ?? []).map((metric) => {
    if (
      metric.columnName !== "activeUsers" ||
      metric.aggregation !== "sum" ||
      metric.expression !== undefined ||
      metric.contract !== undefined
    )
      return metric;
    changed = true;
    return {
      ...metric,
      ...(metric.name === "Sum of Active users"
        ? { name: "Active users" }
        : {}),
      contract: { kind: "non-additive" },
    };
  });
  if (!changed) return false;
  try {
    parseStoredDataTableState(
      { ...table, fields, metrics },
      "GA4 measure repair",
    );
  } catch (error) {
    console.warn(`Skipped malformed GA4 table ${table.id}`, error);
    return false;
  }
  await ctx.db.patch(table._id, {
    fields,
    metrics,
    revision: table.revision + 1,
    // Saved measure edits invalidate imported data; this metadata-only
    // repair changes query semantics without requiring a connector fetch.
    updatedAt: Date.now(),
  });
  return true;
}
async function repairGa4Insight(
  ctx: MutationCtx,
  insight: Doc<"insights">,
  ga4Table: (tableId: string) => Promise<boolean>,
): Promise<boolean> {
  const definition = insight.definition;
  if (!definition || !Array.isArray(definition.metrics)) return false;
  let changed = false;
  const metrics: typeof definition.metrics = [];
  try {
    for (const value of definition.metrics) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        metrics.push(value);
        continue;
      }
      const metric = value as ObjectValue;
      if (
        metric.columnName !== "activeUsers" ||
        metric.aggregation !== "sum" ||
        metric.expression !== undefined ||
        metric.contract !== undefined ||
        !(await ga4Table(String(metric.sourceTable)))
      ) {
        metrics.push(metric);
        continue;
      }
      const repaired = {
        ...metric,
        ...(metric.name === "Sum of Active users"
          ? { name: "Active users" }
          : {}),
        contract: { kind: "non-additive" },
      } satisfies ObjectValue;
      validateMetric(repaired, true);
      changed = true;
      metrics.push(repaired);
    }
  } catch (error) {
    console.warn(`Skipped malformed GA4 insight ${insight.id}`, error);
    return false;
  }
  if (!changed) return false;
  await ctx.db.patch(insight._id, {
    definition: { ...definition, metrics },
    revision: insight.revision + 1,
    refreshRevision: crypto.randomUUID(),
    updatedAt: Date.now(),
  });
  return true;
}
/**
 * Repair legacy GA4 field scopes and active-user measures shipped before
 * contracts. The repair walks the GA4 sources, the tables of each legacy one
 * through the source's index, and then every insight, one `BulkBudget` per
 * transaction, and schedules itself with where it stopped until everything is
 * walked. Tables of other sources are never read, and a workspace without a
 * legacy source skips the insights. Every boot walks again: a draft written
 * before contracts can still publish legacy rows, so no walk is final.
 *
 * The counts cover the rows this call repaired. When `complete` is false the
 * next batch is already scheduled; its counts are not reported to the caller,
 * and the rows it has not reached yet keep their legacy measures until it
 * runs. A call made while a walk is still queued starts a fresh walk and
 * retires the queued one; the repair is idempotent, so neither can double
 * apply.
 */
export const repairGa4MeasureContracts = internalMutation({
  args: {
    ...workspace,
    ...batchSizeArg,
    ...runIdArg,
    // Continuation state; callers start without it.
    phase: v.optional(ga4RepairPhase),
    /** Position among the GA4 sources, past the one being walked. */
    sourceAfter: v.optional(v.number()),
    sourceSeen: v.optional(v.array(v.string())),
    /** The legacy GA4 source whose tables are being walked, and where in them. */
    sourceId: v.optional(v.string()),
    tableAfter: v.optional(v.number()),
    tableSeen: v.optional(v.array(v.string())),
    /** The insight id the previous batch stopped at. */
    after: v.optional(v.string()),
    /** Whether a legacy source was met; without one no insight needs repair. */
    legacySources: v.optional(v.boolean()),
  },
  returns: v.object({
    tablesRepaired: v.number(),
    insightsRepaired: v.number(),
    complete: v.boolean(),
  }),
  handler: async (ctx, args): Promise<Ga4RepairResult> => {
    const workspaceId = args.workspaceId;
    const runId = await beginBulkRun(ctx, workspaceId, GA4_REPAIR, args.runId);
    if (runId === null)
      return { tablesRepaired: 0, insightsRepaired: 0, complete: true };
    const budget = new BulkBudget(bulkBatch(args.batchSize));
    const legacyGa4Table = legacyGa4TableLookup(ctx, workspaceId, budget);
    let phase: Ga4RepairPhase = args.phase ?? "tables";
    let sources: CreationKeyset = {
      after: args.sourceAfter,
      seen: args.sourceSeen ?? [],
    };
    let tables: CreationKeyset = {
      after: args.tableAfter,
      seen: args.tableSeen ?? [],
    };
    let { sourceId, after } = args;
    let legacySources = args.legacySources ?? false;
    let tablesRepaired = 0,
      insightsRepaired = 0;
    const finish = async () => {
      await endBulkRun(ctx, workspaceId, GA4_REPAIR, runId);
      return { tablesRepaired, insightsRepaired, complete: true };
    };
    while (!budget.exhausted) {
      if (phase === "tables" && sourceId === undefined) {
        // One source per read, charged to the budget, so a long list of GA4
        // sources spans batches instead of one transaction.
        const read = await ctx.db
          .query("dataSources")
          .withIndex("by_workspaceId_and_kind", (q) => {
            const range = q
              .eq("workspaceId", workspaceId)
              .eq("kind", "googleAnalytics");
            return sources.after === undefined
              ? range
              : range.gte("_creationTime", sources.after);
          })
          .take(1 + sources.seen.length);
        // Rows tied at one creation time are read again on every chunk until
        // the walk moves past them; charge the whole read, not just the row
        // that advances the walk, so the transaction stays inside its budget.
        budget.charge(read);
        const source = read.find((row) => !sources.seen.includes(row.id));
        if (!source) {
          phase = "insights";
          continue;
        }
        sources = advance(sources, [source]);
        if (!legacyGa4Source(source)) continue;
        legacySources = true;
        sourceId = source.id;
        tables = { seen: [] };
        continue;
      }
      if (phase === "tables") {
        const dataSourceId = sourceId!;
        const requested = budget.chunk;
        const read = await ctx.db
          .query("dataTables")
          .withIndex("by_workspaceId_and_dataSourceId", (q) => {
            const range = q
              .eq("workspaceId", workspaceId)
              .eq("dataSourceId", dataSourceId);
            return tables.after === undefined
              ? range
              : range.gte("_creationTime", tables.after);
          })
          .take(requested + tables.seen.length);
        // As above: the rows already in `seen` are read again, so the budget
        // is charged for every row the query returned.
        budget.charge(read);
        const rows = read.filter((row) => !tables.seen.includes(row.id));
        for (const table of rows)
          if (await repairGa4Table(ctx, table)) tablesRepaired += 1;
        tables = advance(tables, rows);
        if (rows.length < requested) sourceId = undefined;
        continue;
      }
      if (!legacySources) return finish();
      const requested = budget.chunk;
      const rows = await ctx.db
        .query("insights")
        .withIndex("by_workspaceId_and_id", (q) => {
          const range = q.eq("workspaceId", workspaceId);
          return after === undefined ? range : range.gt("id", after);
        })
        .take(requested);
      for (const insight of rows)
        if (await repairGa4Insight(ctx, insight, legacyGa4Table))
          insightsRepaired += 1;
      budget.charge(rows);
      if (rows.length < requested) return finish();
      after = rows[rows.length - 1]!.id;
    }
    await ctx.scheduler.runAfter(0, internal.host.repairGa4MeasureContracts, {
      workspaceId,
      runId,
      phase,
      sourceAfter: sources.after,
      sourceSeen: sources.seen,
      sourceId,
      tableAfter: tables.after,
      tableSeen: tables.seen,
      after,
      legacySources,
      ...(args.batchSize === undefined ? {} : { batchSize: args.batchSize }),
    });
    return { tablesRepaired, insightsRepaired, complete: false };
  },
});
export const getDataSource = internalQuery({
  args: { ...workspace, id: v.string() },
  returns: typed<DataSourceRow | null>(v.union(object, v.null())),
  handler: async (ctx, args) => {
    const row = await find(ctx, args.workspaceId, "dataSources", args.id);
    return row ? (rowValue(row) as unknown as DataSourceRow) : null;
  },
});
export const getDataTable = internalQuery({
  args: { ...workspace, id: v.string() },
  returns: typed<DataTableRow | null>(v.union(object, v.null())),
  handler: async (ctx, args) => {
    const row = await find(ctx, args.workspaceId, "dataTables", args.id);
    return row ? (rowValue(row) as unknown as DataTableRow) : null;
  },
});
/**
 * One page of the remote resources a source's tables read, e.g. GA4
 * properties, each named once per page.
 */
export const listDataTableResources = internalQuery({
  args: {
    ...workspace,
    dataSourceId: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: dataTableResourcePage,
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("dataTables")
      .withIndex("by_workspaceId_and_dataSourceId", (q) =>
        q
          .eq("workspaceId", args.workspaceId)
          .eq("dataSourceId", args.dataSourceId),
      )
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(500, args.paginationOpts.numItems),
      });
    const resources = result.page.flatMap((row) =>
      typeof row.table === "string" ? [row.table] : [],
    );
    return {
      page: [...new Set(resources)],
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});
export const getDataFrame = internalQuery({
  args: { ...workspace, id: v.string() },
  returns: typed<DataFrameRow | null>(v.union(object, v.null())),
  handler: async (ctx, args) => {
    const row = await find(ctx, args.workspaceId, "dataFrames", args.id);
    return row ? (rowValue(row) as unknown as DataFrameRow) : null;
  },
});
export const getInsight = internalQuery({
  args: { ...workspace, id: v.string() },
  returns: typed<InsightRow | null>(v.union(object, v.null())),
  handler: async (ctx, args) => {
    const row = await find(ctx, args.workspaceId, "insights", args.id);
    return row ? (rowValue(row) as unknown as InsightRow) : null;
  },
});
function framePage(result: {
  page: Doc<"dataFrames">[];
  isDone: boolean;
  continueCursor: string;
}): DataFramePage {
  return {
    page: result.page.map((row) => rowValue(row) as unknown as DataFrameRow),
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
}
/** One page of an insight's frames; the host follows `continueCursor` for the rest. */
export const listDataFramesByInsight = internalQuery({
  args: {
    ...workspace,
    insightId: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: dataFramePage,
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("dataFrames")
      .withIndex("by_workspaceId_and_insightId", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("insightId", args.insightId),
      )
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(500, args.paginationOpts.numItems),
      });
    return framePage(result);
  },
});
export const revokeCredential = internalMutation({
  args: { ...workspace, credentialId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("revokedCredentials")
      .withIndex("by_workspaceId_and_credentialId", (q) =>
        q
          .eq("workspaceId", args.workspaceId)
          .eq("credentialId", args.credentialId),
      )
      .unique();
    if (!row) await ctx.db.insert("revokedCredentials", args);
    return null;
  },
});
function sanitizedAnalysis(value: Json): Json {
  if (Array.isArray(value)) return value.map(sanitizedAnalysis);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        k === "sampleValues" ? [] : sanitizedAnalysis(v),
      ]),
    );
  return value;
}
async function putFrame(
  ctx: MutationCtx,
  workspaceId: string,
  input: ObjectValue,
): Promise<void> {
  await assertResourcesWritable(ctx, workspaceId, input);
  const id = String(input.id),
    storage = record(input.storage);
  if (storage.type !== "file" || storage.key !== id)
    throw new Error("Host frame storage must be its immutable UUID file");
  const old = await find(ctx, workspaceId, "dataFrames", id);
  if (old) throw new Error("Immutable frame already exists");
  const now = Date.now();
  await ctx.db.insert(
    "dataFrames",
    clean({
      ...input,
      id,
      workspaceId,
      revision: 1,
      name: String(input.name ?? "Data frame"),
      createdAt: typeof input.createdAt === "number" ? input.createdAt : now,
      updatedAt: now,
      analysis:
        input.analysis === undefined ? null : sanitizedAnalysis(input.analysis),
    }) as ArtifactRow,
  );
}
export const commitImportedFrame = internalMutation({
  args: {
    ...workspace,
    dataTableId: v.string(),
    dataSourceId: v.string(),
    expectedDataFrameId: v.union(v.string(), v.null()),
    frameRow: object,
    tableUpdate: object,
    operationId: v.optional(v.string()),
    requestHash: v.optional(v.string()),
    expectedDataSourceRevision: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    let claim: Awaited<ReturnType<typeof importClaim>> = null;
    if (args.requestHash !== undefined) {
      if (!args.operationId)
        throw new Error("Import requestHash requires operationId");
      claim = await importClaim(
        ctx,
        args.workspaceId,
        args.operationId,
        args.requestHash,
      );
      if (!claim) rejectImportPublication("Local import claim missing");
      if (claim.frameId !== args.frameRow.id)
        throw new Error("Local import frame differs from claim");
      if (claim.status === "complete") return null;
      if (
        args.tableUpdate.lastFetchedAt !== claim.fetchedAt ||
        args.frameRow.lastRefreshedAt !== claim.fetchedAt
      )
        throw new Error("Local import timestamp differs from claim");
      for (const key of ["rowCount", "columnCount"]) {
        const count = args.frameRow[key];
        if (
          typeof count !== "number" ||
          !Number.isSafeInteger(count) ||
          count < 0
        )
          throw new Error(`Invalid imported ${key}`);
      }
    }

    const request = clean({
        ...(args.expectedDataSourceRevision === undefined
          ? {}
          : { expectedDataSourceRevision: args.expectedDataSourceRevision }),
        dataTableId: args.dataTableId,
        dataSourceId: args.dataSourceId,
        expectedDataFrameId: args.expectedDataFrameId,
        frameRow: sanitizedAnalysis(args.frameRow),
        tableUpdate: args.tableUpdate,
      }),
      op = claim
        ? `local-import:${args.operationId}`
        : (args.operationId ?? `import:${String(args.frameRow.id)}`);
    if (await operation(ctx, args.workspaceId, op, request)) return null;
    const source = await find(
      ctx,
      args.workspaceId,
      "dataSources",
      args.dataSourceId,
    );
    if (
      args.expectedDataSourceRevision !== undefined &&
      (!source || source.revision !== args.expectedDataSourceRevision)
    )
      rejectImportPublication("SOURCE_BINDING_CHANGED");
    const table = await find(
      ctx,
      args.workspaceId,
      "dataTables",
      args.dataTableId,
    );
    if (
      !table ||
      table.dataSourceId !== args.dataSourceId ||
      (table.dataFrameId ?? null) !== args.expectedDataFrameId
    )
      rejectImportPublication("SOURCE_BINDING_CHANGED");
    if (
      args.tableUpdate.dataSourceId !== undefined &&
      args.tableUpdate.dataSourceId !== args.dataSourceId
    )
      throw new Error("Source rebinding is not permitted");
    if (
      args.tableUpdate.id !== undefined &&
      args.tableUpdate.id !== args.dataTableId
    )
      throw new Error("Table id is immutable");
    if (args.tableUpdate.dataFrameId !== args.frameRow.id)
      throw new Error("Frame pointer mismatch");
    const allowed = new Set([
      "name",
      "table",
      "sourceSchema",
      "fields",
      "metrics",
      "dataFrameId",
      "lastFetchedAt",
    ]);
    if (Object.keys(args.tableUpdate).some((k) => !allowed.has(k)))
      throw new Error("Unsupported imported table update");
    parseStoredDataTableState(
      { ...table, ...args.tableUpdate },
      "Imported table",
    );
    // A frame committed for a table belongs to it. Stamp the ownership the
    // retention index reads, whatever the caller supplied.
    await putFrame(ctx, args.workspaceId, {
      ...args.frameRow,
      definitionId: args.dataTableId,
      sourceId: args.dataSourceId,
    });
    await ctx.db.patch(table._id, {
      ...args.tableUpdate,
      refreshRevision: crypto.randomUUID(),
      revision: table.revision + 1,
      updatedAt: Date.now(),
    });
    await retainTableFrames(
      ctx,
      args.workspaceId,
      args.dataTableId,
      String(args.frameRow.id),
      args.expectedDataFrameId,
    );
    await ctx.db.insert("operations", {
      workspaceId: args.workspaceId,
      operationId: op,
      request,
      result: null,
    });
    if (claim?.claimKind === "connector-snapshot") {
      await ctx.db.delete(claim._id);
    } else if (claim) {
      await ctx.db.patch(claim._id, {
        status: "complete",
        result: {
          dataFrameId: claim.frameId,
          rowCount: args.frameRow.rowCount as number,
          columnCount: args.frameRow.columnCount as number,
          fetchedAt: claim.fetchedAt,
        },
      });
    }
    return null;
  },
});
export const getOperation = internalQuery({
  args: { ...workspace, operationId: v.string() },
  returns: v.union(object, v.null()),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("operations")
      .withIndex("by_workspaceId_and_operationId", (q) =>
        q
          .eq("workspaceId", args.workspaceId)
          .eq("operationId", args.operationId),
      )
      .unique();
    return row ? { request: row.request, result: row.result } : null;
  },
});
export const publishMaterialization = internalMutation({
  args: { ...workspace, value: publicationMetadata },
  returns: v.null(),
  handler: async (ctx, args) => {
    const value = args.value,
      { target, result, sources } = value;
    const op = `materialize:${result.id}`;
    if (await operation(ctx, args.workspaceId, op, value)) return null;
    const fetchedAt = value.fetchedAt;
    if (typeof fetchedAt !== "number")
      throw new Error("Invalid fetch timestamp");
    for (const item of sources) {
      const { source, frame } = item,
        binding = source.table;
      const table = await find(ctx, args.workspaceId, "dataTables", binding.id);
      if (
        !table ||
        table.dataSourceId !== binding.dataSourceId ||
        table.table !== binding.table
      )
        throw new Error("SOURCE_BINDING_CHANGED");
      await putFrame(ctx, args.workspaceId, {
        id: frame.id,
        fieldIds: frame.fieldIds,
        rowCount: frame.rowCount,
        storage: { type: "file", key: frame.id },
        name: binding.name,
        sourceId: binding.dataSourceId,
        definitionId: binding.id,
        columnCount: frame.fieldIds.length,
        analysis: {
          schema: frame.schema,
          provenance: source.provenance,
          fetchedAt,
        },
        lastRefreshedAt: fetchedAt,
      });
      await ctx.db.patch(table._id, {
        dataFrameId: frame.id,
        lastFetchedAt: fetchedAt,
        revision: table.revision + 1,
        updatedAt: Date.now(),
      });
      await retainTableFrames(
        ctx,
        args.workspaceId,
        binding.id,
        frame.id,
        table.dataFrameId ?? null,
      );
    }
    if (target.kind !== "transient") {
      if (target.kind === "saved") {
        if (!(await find(ctx, args.workspaceId, "insights", target.insightId)))
          throw new Error("Insight unavailable");
        await retainInsightFrames(ctx, args.workspaceId, target.insightId);
      }
      await putFrame(ctx, args.workspaceId, {
        id: result.id,
        fieldIds: result.fieldIds,
        rowCount: result.rowCount,
        storage: { type: "file", key: result.id },
        name:
          target.kind === "saved"
            ? `Insight ${target.insightId}`
            : "Live fetch",
        ...(target.kind === "saved" ? { insightId: target.insightId } : {}),
        columnCount: result.fieldIds.length,
        analysis: {
          schema: result.schema,
          definitionFingerprint: value.definitionFingerprint,
          provenance: value.provenance,
          fetchedAt,
          ...(target.kind === "saved" ? { currentInsightResult: true } : {}),
          ...(target.kind === "ephemeral"
            ? { lifecycle: { kind: "serverSession" } }
            : {}),
        },
        lastRefreshedAt: fetchedAt,
      });
    }
    await ctx.db.insert("operations", {
      workspaceId: args.workspaceId,
      operationId: op,
      request: value,
      result: null,
    });
    return null;
  },
});
export const replaceDataSourceConfig = internalMutation({
  args: {
    ...workspace,
    id: v.string(),
    expectedRevision: v.optional(v.number()),
    expectedConfig: json,
    config: object,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await find(ctx, args.workspaceId, "dataSources", args.id);
    if (
      !row ||
      (args.expectedRevision !== undefined &&
        row.revision !== args.expectedRevision) ||
      stable(row.config ?? {}) !== stable(args.expectedConfig)
    )
      throw new Error("DataSource config changed");
    for (const key of ["apiKey", "connectionString"])
      if (
        args.config[key] !== undefined &&
        (typeof args.config[key] !== "string" ||
          !/^secret:[0-9a-f-]{36}$/i.test(String(args.config[key])))
      )
        throw new Error("Credential must be a staged SecretRef");
    await assertResourcesWritable(ctx, args.workspaceId, args.config);
    await enqueueRemovedResources(
      ctx,
      args.workspaceId,
      row.config,
      args.config,
    );
    await ctx.db.patch(row._id, {
      config: args.config,
      revision: row.revision + 1,
      updatedAt: Date.now(),
    });
    return null;
  },
});
export const prepareRemoteDataTable = internalMutation({
  args: {
    ...workspace,
    id: v.string(),
    dataSourceId: v.string(),
    table: v.string(),
    fields: v.array(object),
    metrics: v.optional(v.array(object)),
    origin: v.optional(object),
  },
  returns: v.array(object),
  handler: async (ctx, args) => {
    const row = await find(ctx, args.workspaceId, "dataTables", args.id);
    const origin =
      args.origin === undefined
        ? undefined
        : parseTableOrigin(args.origin, "Remote origin");
    if (
      !row ||
      row.dataSourceId !== args.dataSourceId ||
      row.table !== args.table ||
      // Origins are compared only when both sides carry one: legacy rows and
      // callers that never pass an origin keep the pre-origin binding check.
      (row.origin !== undefined &&
        origin !== undefined &&
        stable(row.origin) !== stable(origin))
    )
      throw new Error("SOURCE_BINDING_CHANGED");
    const structural = (fields: ObjectValue[]) =>
      stable(
        fields
          .map((f) => ({ name: f.columnName ?? f.name, type: f.type }))
          .sort((a, b) => String(a.name).localeCompare(String(b.name))),
      );
    if (row.fields?.length) {
      if (structural(row.fields) !== structural(args.fields))
        throw new Error("SOURCE_SCHEMA_CHANGED");
      return row.fields;
    }
    // A connector's starting measures replace the generic Count only here, on
    // the first discovery; a table that already has fields keeps its measures.
    for (const metric of args.metrics ?? []) validateMetric(metric, false);
    const metrics = args.metrics ?? row.metrics;
    parseStoredDataTableState(
      { ...row, fields: args.fields, metrics },
      "Remote fields",
    );
    await ctx.db.patch(row._id, {
      fields: args.fields,
      metrics,
      revision: row.revision + 1,
      updatedAt: Date.now(),
    });
    return args.fields;
  },
});
export const commitBatch = internalMutation({
  args: {
    ...workspace,
    principal: hostPrincipal,
    commands: v.array(command),
    operationId: v.optional(v.string()),
  },
  returns: v.object({
    mode: v.literal("commit"),
    commands: v.array(command),
    results: v.array(v.object({ id: v.optional(v.string()), value: json })),
    tablesWritten: v.array(v.string()),
  }),
  handler: runHostCommit,
});
export const draftBatch = internalMutation({
  args: {
    ...workspace,
    principal: hostPrincipal,
    commands: v.array(command),
    draftId: v.optional(v.string()),
  },
  returns: v.object({
    draftId: v.string(),
    results: v.array(v.object({ id: v.optional(v.string()), value: json })),
  }),
  handler: runHostDraft,
});
/** One page of every frame in the workspace; the host follows `continueCursor` for the rest. */
export const listDataFrames = internalQuery({
  args: { ...workspace, paginationOpts: paginationOptsValidator },
  returns: dataFramePage,
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("dataFrames")
      .withIndex("by_workspaceId_and_id", (q) =>
        q.eq("workspaceId", args.workspaceId),
      )
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(500, args.paginationOpts.numItems),
      });
    return framePage(result);
  },
});
export const removeDataFrame = internalMutation({
  args: { ...workspace, id: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const frame = await find(ctx, args.workspaceId, "dataFrames", args.id);
    if (!frame) return null;
    if (record(frame.storage).type !== "file")
      throw new Error("Only server-owned frames may be removed");
    // The range holds the frame's owner table while the frame is current, so
    // one row or none, plus any table a command has deliberately pointed at
    // the same frame.
    const tables = await ctx.db
      .query("dataTables")
      .withIndex("by_workspaceId_and_dataFrameId", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("dataFrameId", args.id),
      )
      .collect();
    for (const table of tables)
      await ctx.db.patch(table._id, {
        dataFrameId: null,
        lastFetchedAt: null,
        refreshRevision: crypto.randomUUID(),
        revision: table.revision + 1,
        updatedAt: Date.now(),
      });
    await enqueueCleanup(ctx, args.workspaceId, resources(frame).values());
    await ctx.db.delete(frame._id);
    return null;
  },
});
/**
 * Clear a workspace's artifacts, drafts, pending host writes, and import
 * claims, one `BulkBudget` per transaction. Every step reads from the front
 * of a range its own writes empty, so a batch always makes progress, and a
 * batch that runs out of budget schedules the next one. `complete` is true
 * when every step exhausted its range inside this transaction, so the
 * workspace was empty when it committed. When it is
 * false the next batch is already scheduled; the caller may call again to
 * wait for the workspace to empty. Each call without `runId` starts a new run
 * and retires the previous run's queued continuation, so nothing created
 * after a completed clear is cleared by a batch queued before it.
 *
 * Import claims are tombstoned and pending host batches cancelled before any
 * row goes, so a delayed import or an abandoned batch that lands between two
 * continuations cannot restore cleared data. Operation receipts are kept so a
 * retried import of a cleared frame is still refused.
 */
export const clearAllData = internalMutation({
  args: { ...workspace, ...batchSizeArg, ...runIdArg },
  returns: v.object({ complete: v.boolean() }),
  handler: async (ctx, args): Promise<{ complete: boolean }> => {
    const workspaceId = args.workspaceId;
    const runId = await beginBulkRun(
      ctx,
      workspaceId,
      "clearAllData",
      args.runId,
    );
    if (runId === null) return { complete: true };
    const budget = new BulkBudget(bulkBatch(args.batchSize));
    let complete = true;
    // Each step reads from the front of a range its own writes empty, one
    // chunk at a time, so the range is exhausted in this transaction exactly
    // when a chunk comes back short.
    const step = async <Row>(
      read: (limit: number) => Promise<Row[]>,
      apply: (rows: Row[]) => Promise<void>,
    ) => {
      for (;;) {
        if (budget.exhausted) {
          complete = false;
          return;
        }
        const requested = budget.chunk;
        const rows = await read(requested);
        await apply(rows);
        budget.charge(rows);
        if (rows.length < requested) return;
      }
    };
    for (const status of ["pending", "complete"] as const)
      await step(
        (limit) =>
          ctx.db
            .query("localImports")
            .withIndex("by_workspaceId_and_status_and_cancelled", (q) =>
              q
                .eq("workspaceId", workspaceId)
                .eq("status", status)
                .eq("cancelled", false),
            )
            .take(limit),
        async (rows) => {
          for (const row of rows)
            await ctx.db.patch(row._id, { cancelled: true });
        },
      );
    await step(
      (limit) =>
        ctx.db
          .query("hostBatches")
          .withIndex("by_workspaceId_and_status", (q) =>
            q.eq("workspaceId", workspaceId).eq("status", "pending"),
          )
          .take(limit),
      async (batches) => {
        for (const batch of batches) {
          await ctx.db.patch(batch._id, { status: "cancelled", result: null });
          await enqueueCleanup(
            ctx,
            workspaceId,
            secretResources(batch.stagedRefs),
          );
        }
      },
    );
    const erase = async (rows: Doc<ClearedTable>[]) => {
      await enqueueCleanup(ctx, workspaceId, resources(rows).values());
      for (const row of rows) await ctx.db.delete(row._id);
    };
    // Children before parents, so a workspace seen between two batches never
    // shows a chart, insight, or table whose parent is already gone.
    for (const table of [...artifactTables].reverse())
      await step(
        (limit) =>
          ctx.db
            .query(table)
            .withIndex("by_workspaceId_and_id", (q) =>
              q.eq("workspaceId", workspaceId),
            )
            .take(limit),
        erase,
      );
    await step(
      (limit) =>
        ctx.db
          .query("drafts")
          .withIndex("by_workspaceId_and_draftId", (q) =>
            q.eq("workspaceId", workspaceId),
          )
          .take(limit),
      // A draft row names no resource; only its log and changes do.
      async (rows) => {
        for (const row of rows) await ctx.db.delete(row._id);
      },
    );
    await step(
      (limit) =>
        ctx.db
          .query("draftLog")
          .withIndex("by_workspaceId_and_draftId_and_sequence", (q) =>
            q.eq("workspaceId", workspaceId),
          )
          .take(limit),
      erase,
    );
    await step(
      (limit) =>
        ctx.db
          .query("draftChanges")
          .withIndex("by_workspaceId_and_draftId", (q) =>
            q.eq("workspaceId", workspaceId),
          )
          .take(limit),
      erase,
    );
    if (complete) {
      await endBulkRun(ctx, workspaceId, "clearAllData", runId);
      return { complete: true };
    }
    await ctx.scheduler.runAfter(0, internal.host.clearAllData, {
      workspaceId,
      runId,
      ...(args.batchSize === undefined ? {} : { batchSize: args.batchSize }),
    });
    return { complete: false };
  },
});

async function importClaim(
  ctx: QueryCtx,
  workspaceId: string,
  operationId: string,
  requestHash: string,
) {
  if (!operationId || operationId.length > 200)
    throw new Error("Invalid local import operationId");
  if (!/^[0-9a-f]{64}$/i.test(requestHash))
    throw new Error("Local import requestHash must be SHA256");
  const row = await ctx.db
    .query("localImports")
    .withIndex("by_workspaceId_and_operationId", (q) =>
      q.eq("workspaceId", workspaceId).eq("operationId", operationId),
    )
    .unique();
  if (row && row.requestHash !== requestHash)
    throw new Error("Local import operationId reused with different request");
  if (row?.cancelled)
    rejectImportPublication("Local import invalidated by workspace clear");
  return row;
}
function rejectImportPublication(message: string): never {
  throw new ConvexError({ code: "IMPORT_PUBLICATION_REJECTED", message });
}
const importClaimArgs = {
  ...workspace,
  operationId: v.string(),
  requestHash: v.string(),
};
export const beginLocalImport = internalMutation({
  args: {
    ...importClaimArgs,
    claimKind: v.optional(localImportClaimKind),
  },
  returns: localImportState,
  handler: async (ctx, args) => {
    const current = await importClaim(
      ctx,
      args.workspaceId,
      args.operationId,
      args.requestHash,
    );
    if (current) {
      const { frameId, fetchedAt, status, result } = current;
      return { frameId, fetchedAt, status, result };
    }
    const retired = await ctx.db
      .query("operations")
      .withIndex("by_workspaceId_and_operationId", (q) =>
        q
          .eq("workspaceId", args.workspaceId)
          .eq("operationId", `local-import:${args.operationId}`),
      )
      .unique();
    if (retired) rejectImportPublication("Local import already complete");
    const state = {
      frameId: crypto.randomUUID(),
      fetchedAt: Date.now(),
      status: "pending" as const,
      result: null,
    };
    await ctx.db.insert("localImports", {
      ...args,
      ...state,
      claimKind: args.claimKind ?? "local-ingest",
      cancelled: false,
    });
    return state;
  },
});
export const getLocalImport = internalQuery({
  args: importClaimArgs,
  returns: v.union(localImportState, v.null()),
  handler: async (ctx, args) => {
    const current = await importClaim(
      ctx,
      args.workspaceId,
      args.operationId,
      args.requestHash,
    );
    if (!current) return null;
    const { frameId, fetchedAt, status, result } = current;
    return { frameId, fetchedAt, status, result };
  },
});
export const cancelLocalImport = internalMutation({
  args: importClaimArgs,
  returns: v.boolean(),
  handler: async (ctx, args) => {
    if (!args.operationId || args.operationId.length > 200)
      throw new Error("Invalid local import operationId");
    if (!/^[0-9a-f]{64}$/i.test(args.requestHash))
      throw new Error("Local import requestHash must be SHA256");
    const current = await ctx.db
      .query("localImports")
      .withIndex("by_workspaceId_and_operationId", (q) =>
        q
          .eq("workspaceId", args.workspaceId)
          .eq("operationId", args.operationId),
      )
      .unique();
    if (current && current.requestHash !== args.requestHash)
      throw new Error("Local import operationId reused with different request");
    if (!current || current.cancelled || current.status === "complete")
      return false;
    await enqueueCleanup(ctx, args.workspaceId, [
      { kind: "frame", resourceId: current.frameId },
    ]);
    await ctx.db.delete(current._id);
    return true;
  },
});

export { listCleanup, claimCleanup, ackCleanup } from "./cleanup";
export {
  getHostBatch,
  prepareHostBatch,
  executeHostBatch,
  executeHostBatchChecked,
  settleHostBatch,
  listPendingHostBatches,
} from "./hostBatches";
