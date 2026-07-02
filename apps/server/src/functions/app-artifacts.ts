import { makeNotionConnector } from "@dashframe/connector-notion";
import { makePostgresConnector } from "@dashframe/connector-postgres";
// The canonical bound-resolver type — aliased for readability at the mint site.
import type { SecretResolver as BoundSecretResolver } from "@dashframe/engine";
import { schema } from "@dashframe/server-core";
import type {
  DataFrameAnalysis,
  DataFrameJSON,
  DataFrameStorageLocation,
  DataSource,
  DataTable,
  Field,
  Insight,
  InsightFilter,
  InsightJoinConfig,
  InsightMetric,
  InsightSort,
  Metric,
  SourceSchema,
  UUID,
  VegaLiteSpec,
  Visualization,
  VisualizationEncoding,
  VisualizationType,
} from "@dashframe/types";
import { isUnmodifiedDraft, stripSampleValues } from "@dashframe/types";
import { eq, int, jsonb, text, uuid } from "@wystack/db";
import type { SecretRef, SecretVault } from "@wystack/secret-vault";
import { isSecretRef } from "@wystack/secret-vault";
import type { FunctionContext } from "@wystack/server";
import { mutation, query } from "@wystack/server";
import { z } from "zod";

import {
  applyCredentialField,
  type DataSourceConfig,
  isRecord,
  modeFromCtx,
  releaseCredentialRefs,
  requireRecordWithId,
  vaultFromCtx,
} from "./utils";

const {
  dashboards,
  dataFrames,
  dataSources,
  dataTables,
  insights,
  visualizations,
} = schema;

type DataSourceRow = typeof dataSources.$inferSelect;
type DataTableRow = typeof dataTables.$inferSelect;
type DataFrameRow = typeof dataFrames.$inferSelect;
type InsightRow = typeof insights.$inferSelect;
type VisualizationRow = typeof visualizations.$inferSelect;

type DataFrameEntry = DataFrameJSON & {
  name: string;
  insightId?: UUID;
  rowCount?: number;
  columnCount?: number;
  analysis?: DataFrameAnalysis;
};

type InsightDefinition = {
  baseTableId: UUID;
  selectedFields: UUID[];
  metrics: InsightMetric[];
  filters?: InsightFilter[];
  sorts?: InsightSort[];
  joins?: InsightJoinConfig[];
};

type DataTableArrayKind = "fields" | "metrics";
type DataTableArrayItem = { id: string };

function dateFromEpoch(value: unknown): Date | undefined {
  return typeof value === "number" ? new Date(value) : undefined;
}

function withDefaultCountMetric(
  tableId: string,
  metrics: Metric[] = [],
): Metric[] {
  if (
    metrics.some(
      (metric) => metric.aggregation === "count" && !metric.columnName,
    )
  ) {
    return metrics;
  }

  return [
    {
      id: crypto.randomUUID(),
      name: "Count",
      tableId,
      columnName: undefined,
      aggregation: "count",
    },
    ...metrics,
  ];
}

function requireInsightMetric(value: unknown): InsightMetric {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.sourceTable !== "string" ||
    typeof value.aggregation !== "string"
  ) {
    throw new Error(
      "metric must include id, name, sourceTable, and aggregation",
    );
  }
  return value as unknown as InsightMetric;
}

function patchDataTableItems(
  kind: DataTableArrayKind,
  mode: string,
  items: DataTableArrayItem[],
  itemId: string | undefined,
  value: unknown,
): DataTableArrayItem[] {
  if (mode === "add") return [...items, requireRecordWithId(value, kind)];
  if (mode === "update") {
    if (!itemId) throw new Error("itemId is required for update");
    if (!isRecord(value)) throw new Error(`${kind} update must be an object`);
    if (!items.some((item) => item.id === itemId)) {
      throw new Error(`${kind} item ${itemId} not found`);
    }
    return items.map((item) =>
      item.id === itemId ? { ...item, ...value } : item,
    );
  }
  if (mode === "delete") {
    if (!itemId) throw new Error("itemId is required for delete");
    if (!items.some((item) => item.id === itemId)) {
      throw new Error(`${kind} item ${itemId} not found`);
    }
    return items.filter((item) => item.id !== itemId);
  }
  throw new Error(`Unsupported patch mode ${mode}`);
}

function patchInsightDefinition(
  current: Insight,
  args: {
    mode: string;
    fieldId?: string;
    metricId?: string;
    metric?: unknown;
    updates?: unknown;
  },
): Pick<InsightDefinition, "selectedFields" | "metrics"> {
  if (args.mode === "addField") {
    if (!args.fieldId) throw new Error("fieldId is required for addField");
    return {
      selectedFields: current.selectedFields.includes(args.fieldId)
        ? current.selectedFields
        : [...current.selectedFields, args.fieldId],
      metrics: current.metrics,
    };
  }
  if (args.mode === "removeField") {
    if (!args.fieldId) throw new Error("fieldId is required for removeField");
    if (!current.selectedFields.includes(args.fieldId)) {
      throw new Error(`Field ${args.fieldId} is not selected`);
    }
    return {
      selectedFields: current.selectedFields.filter(
        (id) => id !== args.fieldId,
      ),
      metrics: current.metrics,
    };
  }
  if (args.mode === "addMetric") {
    return {
      selectedFields: current.selectedFields,
      metrics: [...current.metrics, requireInsightMetric(args.metric)],
    };
  }
  return patchInsightMetricDefinition(current, args);
}

function patchInsightMetricDefinition(
  current: Insight,
  args: { mode: string; metricId?: string; updates?: unknown },
): Pick<InsightDefinition, "selectedFields" | "metrics"> {
  if (args.mode === "updateMetric") {
    if (!args.metricId)
      throw new Error("metricId is required for updateMetric");
    if (!isRecord(args.updates) || Object.keys(args.updates).length === 0) {
      throw new Error("updates are required for updateMetric");
    }
    if (!current.metrics.some((metric) => metric.id === args.metricId)) {
      throw new Error(`Metric ${args.metricId} not found`);
    }
    return {
      selectedFields: current.selectedFields,
      metrics: current.metrics.map((metric) =>
        metric.id === args.metricId
          ? { ...metric, ...(args.updates as Partial<InsightMetric>) }
          : metric,
      ),
    };
  }
  if (args.mode === "removeMetric") {
    if (!args.metricId)
      throw new Error("metricId is required for removeMetric");
    if (!current.metrics.some((metric) => metric.id === args.metricId)) {
      throw new Error(`Metric ${args.metricId} not found`);
    }
    return {
      selectedFields: current.selectedFields,
      metrics: current.metrics.filter((metric) => metric.id !== args.metricId),
    };
  }
  throw new Error(`Unsupported insight patch mode ${args.mode}`);
}

/**
 * Coalesce a row timestamp to epoch ms, null-safe.
 *
 * Canonical artifact tables stamp `created_at` with a DB default, so a canonical
 * read always has it. But the DRAFT-OVERLAY view coalesces canonical ⊕ the sparse
 * `<table>__draft` delta, and the draft shadow leaves `created_at` NULL for an
 * artifact CREATED inside a draft (it has no canonical base, and publish stamps
 * the real value). A draft-created artifact read through the overlay therefore
 * carries a null timestamp until publish — `.getTime()` on it throws. Coalesce
 * null → 0 (epoch): the artifact is unpublished, so it has no real creation time
 * yet; 0 is the honest placeholder the read path can surface without crashing.
 * `updatedAt` stays optional (null → undefined) via `?.getTime()` at call sites.
 */
export function tsToMillis(value: Date | null | undefined): number {
  return value != null ? value.getTime() : 0;
}

/**
 * Map a `data_sources` row to the `DataSource` read DTO.
 *
 * Presence flags (hasApiKey / hasConnectionString) are derived from the vault
 * when a vault is available: the config field holds a SecretRef, and
 * `vault.has(ref)` checks whether the ref resolves to a live secret without
 * decrypting. Falls back to a simple truthiness check (Boolean(config.apiKey))
 * when no vault is injected — this covers legacy rows in tests and pre-vault
 * dev paths where the config still holds plaintext-or-ref values.
 */
async function rowToDataSource(
  row: DataSourceRow,
  vault?: import("@wystack/secret-vault").SecretVault,
): Promise<DataSource> {
  const config = (row.config ?? {}) as DataSourceConfig;
  let hasApiKey: boolean;
  let hasConnectionString: boolean;
  if (vault != null) {
    // Presence via vault: config.apiKey is a SecretRef when set via the vault
    // path; isSecretRef guards against legacy plaintext rows.
    hasApiKey = isSecretRef(config.apiKey)
      ? await vault.has(
          config.apiKey as import("@wystack/secret-vault").SecretRef,
        )
      : Boolean(config.apiKey);
    hasConnectionString = isSecretRef(config.connectionString)
      ? await vault.has(
          config.connectionString as import("@wystack/secret-vault").SecretRef,
        )
      : Boolean(config.connectionString);
  } else {
    // Fallback: no vault — simple truthiness (covers legacy/test paths).
    hasApiKey = Boolean(config.apiKey);
    hasConnectionString = Boolean(config.connectionString);
  }
  // Pass through any non-credential keys from the stored config so future
  // fields are forward-compatible. Two exclusion criteria apply:
  //   1. Key name — "apiKey" and "connectionString" are the typed credential
  //      slots; they never appear in the public DTO (only the boolean flags do).
  //   2. Value shape — any value that is a well-formed SecretRef ("secret:<uuid>")
  //      is also dropped, regardless of key name. Guards the sink by value shape,
  //      not only by provenance: a future credential field stored under a
  //      non-standard key name can't leak a live ref to the renderer.
  const otherKeys: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    if (k !== "apiKey" && k !== "connectionString" && !isSecretRef(v)) {
      otherKeys[k] = v;
    }
  }
  return {
    id: row.id,
    type: row.kind,
    name: row.name,
    config: { hasApiKey, hasConnectionString, ...otherKeys },
    createdAt: tsToMillis(row.createdAt),
  };
}

function rowToDataTable(row: DataTableRow): DataTable {
  return {
    id: row.id,
    dataSourceId: row.dataSourceId,
    name: row.name,
    table: row.table,
    sourceSchema: (row.sourceSchema as SourceSchema | null) ?? undefined,
    fields: row.fields as Field[],
    metrics: row.metrics as Metric[],
    dataFrameId: row.dataFrameId ?? undefined,
    createdAt: tsToMillis(row.createdAt),
    lastFetchedAt: row.lastFetchedAt?.getTime(),
  };
}

function rowToDataFrame(row: DataFrameRow): DataFrameEntry {
  return {
    id: row.id,
    storage: row.storage as DataFrameStorageLocation,
    fieldIds: row.fieldIds as UUID[],
    primaryKey: (row.primaryKey as string | string[] | null) ?? undefined,
    createdAt: tsToMillis(row.createdAt),
    name: row.name,
    insightId: row.insightId ?? undefined,
    rowCount: row.rowCount ?? undefined,
    columnCount: row.columnCount ?? undefined,
    analysis: (row.analysis as DataFrameAnalysis | null) ?? undefined,
  };
}

function rowToInsight(row: InsightRow): Insight {
  const definition = row.definition as InsightDefinition;
  return {
    id: row.id,
    name: row.name,
    baseTableId: definition.baseTableId,
    selectedFields: definition.selectedFields ?? [],
    metrics: definition.metrics ?? [],
    filters: definition.filters,
    sorts: definition.sorts,
    joins: definition.joins,
    createdAt: tsToMillis(row.createdAt),
    updatedAt: row.updatedAt?.getTime(),
  };
}

function insightToDefinition(input: {
  baseTableId: UUID;
  selectedFields?: UUID[];
  metrics?: InsightMetric[];
  filters?: InsightFilter[];
  sorts?: InsightSort[];
  joins?: InsightJoinConfig[];
}): InsightDefinition {
  return {
    baseTableId: input.baseTableId,
    selectedFields: input.selectedFields ?? [],
    metrics: input.metrics ?? [],
    filters: input.filters,
    sorts: input.sorts,
    joins: input.joins,
  };
}

function stripDataFromSpec(spec: VegaLiteSpec): VegaLiteSpec {
  const next = { ...spec };
  delete next.data;
  return next;
}

function rowToVisualization(row: VisualizationRow): Visualization {
  const options = (row.options ?? {}) as { spec?: VegaLiteSpec };
  return {
    id: row.id,
    insightId: row.insightId,
    name: row.name,
    visualizationType: row.chartType as VisualizationType,
    encoding: row.encoding as VisualizationEncoding | undefined,
    spec: options.spec ?? {},
    createdAt: tsToMillis(row.createdAt),
    updatedAt: row.updatedAt?.getTime(),
  };
}

async function loadDataTable(
  ctx: { db: import("@wystack/db").DrizzleTracker },
  id: string,
): Promise<DataTable> {
  const row = (await ctx.db.from(dataTables).where(eq("id", id)).first()) as
    | DataTableRow
    | undefined;
  if (!row) throw new Error(`Data table ${id} not found`);
  return rowToDataTable(row);
}

async function loadInsight(
  ctx: { db: import("@wystack/db").DrizzleTracker },
  id: string,
): Promise<Insight> {
  const row = (await ctx.db.from(insights).where(eq("id", id)).first()) as
    | InsightRow
    | undefined;
  if (!row) throw new Error(`Insight ${id} not found`);
  return rowToInsight(row);
}

const listDataSources = query({
  args: {},
  handler: async (ctx): Promise<DataSource[]> => {
    const vault = vaultFromCtx(ctx);
    const rows = (await ctx.db.from(dataSources).all()) as DataSourceRow[];
    return Promise.all(rows.map((row) => rowToDataSource(row, vault)));
  },
});

const getDataSource = query({
  args: { id: uuid },
  handler: async (ctx, { id }): Promise<DataSource | null> => {
    const vault = vaultFromCtx(ctx);
    const row = (await ctx.db.from(dataSources).where(eq("id", id)).first()) as
      | DataSourceRow
      | undefined;
    return row ? rowToDataSource(row, vault) : null;
  },
});

const getDataSourceByType = query({
  args: { type: text },
  handler: async (ctx, { type }): Promise<DataSource | null> => {
    const vault = vaultFromCtx(ctx);
    const row = (await ctx.db
      .from(dataSources)
      .where(eq("kind", type))
      .first()) as DataSourceRow | undefined;
    return row ? rowToDataSource(row, vault) : null;
  },
});

// NOTE: the racy `getOrCreateDataSourceByType` (check-then-insert keyed on
// `kind`, no unique constraint → concurrent ingests double-insert, PR #46
// Greptile P1) was REPLACED by the `GetOrCreateDataSource` command in
// `./commands.ts`, which keys idempotency on a client-minted primary key. See
// that file's traceability table.

/**
 * Best-effort delete of vault refs minted earlier in the SAME failed operation
 * (never a pre-existing/canonical ref — see the callers, which only ever push a
 * ref here immediately after `storeCredential` returns it). Mirrors
 * `flushAndReleaseRefs`'s allSettled+log idiom in `commands.ts`: every delete is
 * attempted, failures are logged (not thrown), because the caller is already
 * unwinding from the original error and a release failure must not mask it —
 * worst case is an inert, idempotent-recoverable orphan.
 */
async function releaseMintedRefsBestEffort(
  vault: SecretVault | undefined,
  minted: SecretRef[],
  label: string,
): Promise<void> {
  if (vault == null || minted.length === 0) return;
  const results = await Promise.allSettled(
    minted.map((ref) => vault.delete(ref)),
  );
  const failures = results.filter(
    (r): r is PromiseRejectedResult => r.status === "rejected",
  );
  if (failures.length > 0) {
    console.error(
      `[dashframe] ${label}: ${failures.length} of ${minted.length} freshly-minted ` +
        "credential ref(s) failed to release after a write failure (inert orphan):",
      failures.map((f) => f.reason),
    );
  }
}

const addDataSource = mutation({
  args: {
    type: text,
    name: text,
    apiKey: text.optional(),
    connectionString: text.optional(),
  },
  handler: async (
    ctx,
    { type, name, apiKey, connectionString },
  ): Promise<{ id: string }> => {
    const vault = vaultFromCtx(ctx);
    // The id is generated by the DB default; use a pre-generated UUID as hint.
    const rowId = crypto.randomUUID();
    const config: DataSourceConfig = {};
    // Refs minted in THIS call only — a fresh insert has no pre-existing config,
    // so every ref that lands in `config` here was just minted by this operation.
    const minted: SecretRef[] = [];
    try {
      // store non-empty / skip-on-empty (applyCredentialField). On a fresh config an
      // empty string is a no-op (nothing to clear). A real store fails closed when no
      // vault is injected (throws rather than persisting plaintext).
      await applyCredentialField(
        config,
        "apiKey",
        apiKey,
        vault,
        `apiKey-${rowId}`,
      );
      if (isSecretRef(config.apiKey)) minted.push(config.apiKey);
      await applyCredentialField(
        config,
        "connectionString",
        connectionString,
        vault,
        `connectionString-${rowId}`,
      );
      if (isSecretRef(config.connectionString))
        minted.push(config.connectionString);
      const [row] = (await ctx.db.into(dataSources).insert({
        id: rowId,
        name,
        kind: type,
        storage: "live",
        config,
        createdBy: { kind: "user" },
      })) as DataSourceRow[];
      if (!row) throw new Error("insert returned no row");
      return { id: row.id };
    } catch (err) {
      // The insert never landed (or a store call itself threw before it) — every
      // ref in `minted` was minted by THIS call and is now unreferenced anywhere.
      // Release best-effort and rethrow the original error untouched.
      await releaseMintedRefsBestEffort(vault, minted, "addDataSource");
      throw err;
    }
  },
});

const updateDataSource = mutation({
  args: {
    id: uuid,
    name: text.optional(),
    apiKey: text.optional(),
    connectionString: text.optional(),
  },
  handler: async (
    ctx,
    { id, name, apiKey, connectionString },
  ): Promise<{ ok: true }> => {
    const vault = vaultFromCtx(ctx);
    const current = (await ctx.db
      .from(dataSources)
      .where(eq("id", id))
      .first()) as DataSourceRow | undefined;
    if (!current) throw new Error(`Data source ${id} not found`);
    const config = { ...((current.config ?? {}) as DataSourceConfig) };
    // Snapshot the PRE-existing refs before any applyCredentialField call mutates
    // `config` in place — the discriminator the HARD INVARIANT below relies on.
    const priorApiKey = config.apiKey;
    const priorConnectionString = config.connectionString;
    // HARD INVARIANT: `minted` collects ONLY refs that are NEW after this call's
    // applyCredentialField invocations — i.e. `config[field]` changed from its
    // pre-existing value. A pre-existing canonical ref on an untouched (or
    // re-affirmed-to-the-same-value) field is therefore never captured here, so a
    // write failure can never release it — only refs minted in THIS operation.
    const minted: SecretRef[] = [];
    try {
      // store non-empty / clear-on-empty / leave-on-undefined (applyCredentialField);
      // a real store fails closed when no vault is injected.
      await applyCredentialField(
        config,
        "apiKey",
        apiKey,
        vault,
        `apiKey-${id}`,
      );
      if (isSecretRef(config.apiKey) && config.apiKey !== priorApiKey)
        minted.push(config.apiKey);
      await applyCredentialField(
        config,
        "connectionString",
        connectionString,
        vault,
        `connectionString-${id}`,
      );
      if (
        isSecretRef(config.connectionString) &&
        config.connectionString !== priorConnectionString
      )
        minted.push(config.connectionString);
      await ctx.db
        .from(dataSources)
        .where(eq("id", id))
        .update({
          ...(name !== undefined ? { name } : {}),
          config,
        });
      return { ok: true };
    } catch (err) {
      // The update never landed (or a store call itself threw before it) — refs in
      // `minted` were stored by THIS call and are unreferenced anywhere (canonical
      // still points at the PRE-existing ref, since the write failed). Release only
      // these; a pre-existing ref on an untouched field is never in `minted`.
      await releaseMintedRefsBestEffort(vault, minted, "updateDataSource");
      throw err;
    }
  },
});

const removeDataSource = mutation({
  args: { id: uuid },
  handler: async (ctx, { id }): Promise<{ ok: true }> => {
    // Fetch the source config BEFORE deleting so we can release its SecretRefs.
    // vault-absent-with-a-ref is an error (fail-closed symmetry): a ref can only
    // exist because vault.store() succeeded, which requires a vault to be present.
    // In preview mode vault.delete() is skipped — like vault.store(), it is a
    // keychain side-effect outside the DB transaction. A preview executes then
    // rolls back: the row (with its refs) survives, so its credential must too.
    const source = await ctx.db.from(dataSources).where(eq("id", id)).first();
    if (source && modeFromCtx(ctx) !== "preview") {
      await releaseCredentialRefs(
        (source.config ?? {}) as DataSourceConfig,
        vaultFromCtx(ctx),
      );
    }
    await ctx.db.from(dataTables).where(eq("dataSourceId", id)).delete();
    await ctx.db.from(dataSources).where(eq("id", id)).delete();
    return { ok: true };
  },
});

const listDataTables = query({
  args: { dataSourceId: uuid.optional() },
  handler: async (ctx, { dataSourceId }): Promise<DataTable[]> => {
    const rows = dataSourceId
      ? ((await ctx.db
          .from(dataTables)
          .where(eq("dataSourceId", dataSourceId))
          .all()) as DataTableRow[])
      : ((await ctx.db.from(dataTables).all()) as DataTableRow[]);
    return rows.map(rowToDataTable);
  },
});

const getDataTable = query({
  args: { id: uuid },
  handler: async (ctx, { id }): Promise<DataTable | null> => {
    const row = (await ctx.db.from(dataTables).where(eq("id", id)).first()) as
      | DataTableRow
      | undefined;
    return row ? rowToDataTable(row) : null;
  },
});

const addDataTable = mutation({
  args: {
    dataSourceId: uuid,
    name: text,
    table: text,
    options: jsonb.optional(),
  },
  handler: async (
    ctx,
    { dataSourceId, name, table, options },
  ): Promise<{ id: string }> => {
    const opts = (options ?? {}) as {
      id?: string;
      sourceSchema?: SourceSchema;
      fields?: Field[];
      metrics?: Metric[];
      dataFrameId?: string;
    };
    const id = opts.id ?? crypto.randomUUID();
    const [row] = (await ctx.db.into(dataTables).insert({
      id,
      dataSourceId,
      name,
      table,
      sourceSchema: opts.sourceSchema ?? null,
      fields: opts.fields ?? [],
      metrics: withDefaultCountMetric(id, opts.metrics),
      dataFrameId: opts.dataFrameId ?? null,
    })) as DataTableRow[];
    if (!row) throw new Error("insert returned no row");
    return { id: row.id };
  },
});

const updateDataTable = mutation({
  args: { id: uuid, updates: jsonb },
  handler: async (ctx, { id, updates }): Promise<{ ok: true }> => {
    const patch = updates as Partial<DataTable>;
    await ctx.db
      .from(dataTables)
      .where(eq("id", id))
      .update({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.table !== undefined ? { table: patch.table } : {}),
        ...(patch.sourceSchema !== undefined
          ? { sourceSchema: patch.sourceSchema }
          : {}),
        ...(patch.fields !== undefined ? { fields: patch.fields } : {}),
        ...(patch.metrics !== undefined ? { metrics: patch.metrics } : {}),
        ...(patch.dataFrameId !== undefined
          ? { dataFrameId: patch.dataFrameId }
          : {}),
        ...(patch.lastFetchedAt !== undefined
          ? { lastFetchedAt: dateFromEpoch(patch.lastFetchedAt) }
          : {}),
      });
    return { ok: true };
  },
});

// NOTE: silently no-ops on a missing id (0-row UPDATE returns { ok: true }).
// The command path (`refreshDataTableCmd` in commands.ts) enforces existence
// and throws instead — divergent semantics for the same intent, bounded by the
// legacy-caller migration window (see #66).
const refreshDataTable = mutation({
  args: { id: uuid, dataFrameId: uuid },
  handler: async (ctx, { id, dataFrameId }): Promise<{ ok: true }> => {
    await ctx.db
      .from(dataTables)
      .where(eq("id", id))
      .update({ dataFrameId, lastFetchedAt: new Date() });
    return { ok: true };
  },
});

const removeDataTable = mutation({
  args: { id: uuid },
  handler: async (ctx, { id }): Promise<{ ok: true }> => {
    await ctx.db.from(dataTables).where(eq("id", id)).delete();
    return { ok: true };
  },
});

// Discriminated-union guard for patchDataTableArray mode inputs.
// Guards the SINK — validates at the handler boundary before the helper call,
// catching malformed payloads that arrive from any untrusted client path.
const patchDataTableArrayArgsSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("add"),
    value: z.object({ id: z.string().uuid() }).passthrough(),
  }),
  z.object({
    mode: z.literal("update"),
    itemId: z.string().uuid(),
    // value is optional (partial patch object); the helper validates it is an
    // object when present. The guard only enforces itemId is present and valid.
    value: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    mode: z.literal("delete"),
    itemId: z.string().uuid(),
  }),
]);

const patchDataTableArray = mutation({
  args: {
    dataTableId: uuid,
    kind: text,
    mode: text,
    itemId: uuid.optional(),
    value: jsonb.optional(),
  },
  handler: async (
    ctx,
    { dataTableId, kind, mode, itemId, value },
  ): Promise<{ ok: true }> => {
    const parsed = patchDataTableArrayArgsSchema.safeParse({
      mode,
      itemId,
      value,
    });
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const table = await loadDataTable(ctx, dataTableId);
    if (kind !== "fields" && kind !== "metrics") {
      throw new Error(`Unsupported data table array ${kind}`);
    }
    const items = (table[kind] ?? []) as DataTableArrayItem[];
    const next = patchDataTableItems(kind, mode, items, itemId, value);
    await ctx.db
      .from(dataTables)
      .where(eq("id", dataTableId))
      .update({ [kind]: next });
    return { ok: true };
  },
});

const listDataFrames = query({
  args: {},
  handler: async (ctx): Promise<DataFrameEntry[]> => {
    const rows = (await ctx.db.from(dataFrames).all()) as DataFrameRow[];
    return rows.map(rowToDataFrame);
  },
});

const getDataFrameEntry = query({
  args: { id: uuid },
  handler: async (ctx, { id }): Promise<DataFrameEntry | null> => {
    const row = (await ctx.db.from(dataFrames).where(eq("id", id)).first()) as
      | DataFrameRow
      | undefined;
    return row ? rowToDataFrame(row) : null;
  },
});

const getDataFrameByInsight = query({
  args: { insightId: uuid },
  handler: async (ctx, { insightId }): Promise<DataFrameEntry | null> => {
    const row = (await ctx.db
      .from(dataFrames)
      .where(eq("insightId", insightId))
      .first()) as DataFrameRow | undefined;
    return row ? rowToDataFrame(row) : null;
  },
});

const putDataFrameEntry = mutation({
  args: { entry: jsonb },
  handler: async (ctx, { entry }): Promise<{ id: string }> => {
    const value = entry as DataFrameEntry;
    // Strip raw sample values before persisting — privacy floor: the artifact
    // DB holds zero raw cell values. In-memory callers that need sampleValues
    // (e.g. the suggest-mode PII classifier) operate on the runtime object
    // before it reaches this write boundary.
    const safeAnalysis = value.analysis
      ? stripSampleValues(value.analysis)
      : null;
    const row = {
      id: value.id,
      storage: value.storage,
      fieldIds: value.fieldIds,
      primaryKey: value.primaryKey ?? null,
      createdAt: new Date(value.createdAt),
      name: value.name,
      insightId: value.insightId ?? null,
      rowCount: value.rowCount ?? null,
      columnCount: value.columnCount ?? null,
      analysis: safeAnalysis,
    };
    const existing = (await ctx.db
      .from(dataFrames)
      .where(eq("id", value.id))
      .first()) as DataFrameRow | undefined;
    if (existing) {
      await ctx.db.from(dataFrames).where(eq("id", value.id)).update(row);
    } else {
      await ctx.db.into(dataFrames).insert(row);
    }
    return { id: value.id };
  },
});

const updateDataFrameEntry = mutation({
  args: { id: uuid, updates: jsonb },
  handler: async (ctx, { id, updates }): Promise<{ ok: true }> => {
    const patch = updates as Partial<DataFrameEntry>;
    await ctx.db
      .from(dataFrames)
      .where(eq("id", id))
      .update({
        ...(patch.storage !== undefined ? { storage: patch.storage } : {}),
        ...(patch.fieldIds !== undefined ? { fieldIds: patch.fieldIds } : {}),
        ...(patch.primaryKey !== undefined
          ? { primaryKey: patch.primaryKey }
          : {}),
        ...(patch.createdAt !== undefined
          ? { createdAt: new Date(patch.createdAt) }
          : {}),
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.insightId !== undefined
          ? { insightId: patch.insightId }
          : {}),
        ...(patch.rowCount !== undefined ? { rowCount: patch.rowCount } : {}),
        ...(patch.columnCount !== undefined
          ? { columnCount: patch.columnCount }
          : {}),
        // Strip raw sample values at the write boundary (privacy floor).
        ...(patch.analysis !== undefined
          ? {
              analysis: patch.analysis
                ? stripSampleValues(patch.analysis)
                : null,
            }
          : {}),
      });
    return { ok: true };
  },
});

const removeDataFrameEntry = mutation({
  args: { id: uuid },
  handler: async (ctx, { id }): Promise<{ ok: true }> => {
    await ctx.db.from(dataFrames).where(eq("id", id)).delete();
    return { ok: true };
  },
});

const listInsights = query({
  args: { excludeIds: jsonb.optional() },
  handler: async (ctx, { excludeIds }): Promise<Insight[]> => {
    const excluded = new Set((excludeIds as UUID[] | undefined) ?? []);
    const rows = (await ctx.db.from(insights).all()) as InsightRow[];
    return rows
      .map(rowToInsight)
      .filter((insight) => !excluded.has(insight.id));
  },
});

const getInsight = query({
  args: { id: uuid },
  handler: async (ctx, { id }): Promise<Insight | null> => {
    const row = (await ctx.db.from(insights).where(eq("id", id)).first()) as
      | InsightRow
      | undefined;
    return row ? rowToInsight(row) : null;
  },
});

const createInsight = mutation({
  args: { name: text, baseTableId: uuid, options: jsonb.optional() },
  handler: async (
    ctx,
    { name, baseTableId, options },
  ): Promise<{ id: string }> => {
    const opts = (options ?? {}) as {
      selectedFields?: UUID[];
      metrics?: InsightMetric[];
      /** Opt-in: when this would be an unmodified draft, reuse an existing
       *  unmodified draft for the same baseTableId instead of inserting a
       *  duplicate. The auto-draft entry point sets this; explicit creation
       *  paths (e.g. deriving from an insight) leave it false. */
      reuseUnmodifiedDraft?: boolean;
    };

    return ctx.db.transaction(async (tx) => {
      // Reuse is opt-in and only applies when the incoming insight is itself an
      // unmodified draft. A pre-populated insight (fields/metrics) or any
      // non-auto-draft caller always inserts a fresh row. Extract the draft
      // shape explicitly so the predicate reads only the fields it should —
      // the wider `opts` bag carries the reuse flag itself, which is not part
      // of the draft definition.
      const shouldReuse =
        opts.reuseUnmodifiedDraft === true &&
        isUnmodifiedDraft({
          selectedFields: opts.selectedFields,
          metrics: opts.metrics,
        });

      if (shouldReuse) {
        // Atomic check-and-create: scan-and-decide runs inside the transaction
        // so two concurrent auto-draft calls for the same baseTableId converge
        // on a single draft rather than racing into duplicates (TOCTOU).
        //
        // INVARIANT: this closes the race only while the backend is
        // single-connection (PGlite, the desktop + `dashframe serve` target),
        // where transactions serialize at the event loop. A multi-connection
        // store under READ COMMITTED would let both transactions scan, find no
        // draft, and both insert — reopening the phantom-read window. Trigger
        // to revisit if the backend ever becomes multi-connection: add a unique
        // index on (definition->>'baseTableId') for unmodified drafts, or take
        // SELECT … FOR UPDATE / serializable isolation here.
        //
        // NOTE: baseTableId lives inside the `definition` JSONB column, and
        // @wystack/db has no JSONB-path filtering — so the scan is a full table
        // read filtered in JS. Acceptable at current insight-table scale.
        // Trigger to revisit: when insight count grows enough that this scan
        // shows up in latency, promote baseTableId to a top-level indexed
        // column (or add a JSONB expression index) and filter at the DB layer.
        const rows = (await tx.from(insights).all()) as InsightRow[];
        const existingDraft = rows
          .filter(
            (r) =>
              (r.definition as InsightDefinition).baseTableId === baseTableId,
          )
          .find((r) => isUnmodifiedDraft(r.definition as InsightDefinition));

        if (existingDraft) {
          return { id: existingDraft.id };
        }
      }

      const [row] = (await tx.into(insights).insert({
        name,
        definition: insightToDefinition({
          baseTableId,
          selectedFields: opts.selectedFields,
          metrics: opts.metrics,
        }),
        createdBy: { kind: "user" },
      })) as InsightRow[];
      if (!row) throw new Error("insert returned no row");
      return { id: row.id };
    });
  },
});

const updateInsight = mutation({
  args: { id: uuid, updates: jsonb },
  handler: async (ctx, { id, updates }): Promise<{ ok: true }> => {
    const current = await loadInsight(ctx, id);
    const patch = updates as Partial<Insight>;
    await ctx.db
      .from(insights)
      .where(eq("id", id))
      .update({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        definition: insightToDefinition({
          baseTableId: patch.baseTableId ?? current.baseTableId,
          selectedFields: patch.selectedFields ?? current.selectedFields,
          metrics: patch.metrics ?? current.metrics,
          filters: patch.filters ?? current.filters,
          sorts: patch.sorts ?? current.sorts,
          joins: patch.joins ?? current.joins,
        }),
      });
    return { ok: true };
  },
});

const removeInsight = mutation({
  args: { id: uuid },
  handler: async (ctx, { id }): Promise<{ ok: true }> => {
    await ctx.db.from(visualizations).where(eq("insightId", id)).delete();
    await ctx.db.from(insights).where(eq("id", id)).delete();
    return { ok: true };
  },
});

// Discriminated-union guard for patchInsight mode inputs.
// Guards the SINK — validates at the handler boundary before the helper call,
// catching malformed payloads that arrive from any untrusted client path.
const patchInsightArgsSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("addMetric"),
    metric: z.record(z.string(), z.unknown()),
  }),
  z.object({
    mode: z.literal("addField"),
    fieldId: z.string().uuid(),
  }),
  z.object({
    mode: z.literal("removeField"),
    fieldId: z.string().uuid(),
  }),
  z.object({
    mode: z.literal("updateMetric"),
    metricId: z.string().uuid(),
    updates: z.record(z.string(), z.unknown()),
  }),
  z.object({
    mode: z.literal("removeMetric"),
    metricId: z.string().uuid(),
  }),
]);

const patchInsight = mutation({
  args: {
    id: uuid,
    mode: text,
    fieldId: uuid.optional(),
    metricId: uuid.optional(),
    metric: jsonb.optional(),
    updates: jsonb.optional(),
  },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const parsed = patchInsightArgsSchema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    const current = await loadInsight(ctx, args.id);
    const { selectedFields, metrics } = patchInsightDefinition(current, args);
    await ctx.db
      .from(insights)
      .where(eq("id", args.id))
      .update({
        definition: insightToDefinition({
          ...current,
          selectedFields,
          metrics,
        }),
      });
    return { ok: true };
  },
});

const listVisualizations = query({
  args: { insightId: uuid.optional() },
  handler: async (ctx, { insightId }): Promise<Visualization[]> => {
    const rows = insightId
      ? ((await ctx.db
          .from(visualizations)
          .where(eq("insightId", insightId))
          .all()) as VisualizationRow[])
      : ((await ctx.db.from(visualizations).all()) as VisualizationRow[]);
    return rows.map(rowToVisualization);
  },
});

const getVisualization = query({
  args: { id: uuid },
  handler: async (ctx, { id }): Promise<Visualization | null> => {
    const row = (await ctx.db
      .from(visualizations)
      .where(eq("id", id))
      .first()) as VisualizationRow | undefined;
    return row ? rowToVisualization(row) : null;
  },
});

const createVisualization = mutation({
  args: {
    name: text,
    insightId: uuid,
    visualizationType: text,
    spec: jsonb,
    encoding: jsonb.optional(),
  },
  handler: async (
    ctx,
    { name, insightId, visualizationType, spec, encoding },
  ): Promise<{ id: string }> => {
    const [row] = (await ctx.db.into(visualizations).insert({
      name,
      insightId,
      chartType: visualizationType,
      encoding: (encoding ?? {}) as VisualizationEncoding,
      options: { spec: stripDataFromSpec(spec as VegaLiteSpec) },
      createdBy: { kind: "user" },
    })) as VisualizationRow[];
    if (!row) throw new Error("insert returned no row");
    return { id: row.id };
  },
});

const updateVisualization = mutation({
  args: { id: uuid, updates: jsonb },
  handler: async (ctx, { id, updates }): Promise<{ ok: true }> => {
    const patch = updates as Partial<Visualization>;
    await ctx.db
      .from(visualizations)
      .where(eq("id", id))
      .update({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.visualizationType !== undefined
          ? { chartType: patch.visualizationType }
          : {}),
        ...(patch.encoding !== undefined ? { encoding: patch.encoding } : {}),
        ...(patch.spec !== undefined
          ? { options: { spec: stripDataFromSpec(patch.spec) } }
          : {}),
      });
    return { ok: true };
  },
});

const removeVisualization = mutation({
  args: { id: uuid },
  handler: async (ctx, { id }): Promise<{ ok: true }> => {
    await ctx.db.from(visualizations).where(eq("id", id)).delete();
    return { ok: true };
  },
});

const clearAllData = mutation({
  args: {},
  handler: async (ctx): Promise<{ ok: true }> => {
    // One unconditional DELETE FROM per table (DrizzleTracker.delete() with no
    // .where() clears the whole table). Idempotent and a single statement
    // each — no per-row round-trips, no partial-clear retry hazard. FK-child
    // tables first so cascade order is satisfied even without DB-level FKs.
    await ctx.db.from(dashboards).delete();
    await ctx.db.from(visualizations).delete();
    await ctx.db.from(insights).delete();
    await ctx.db.from(dataFrames).delete();
    await ctx.db.from(dataTables).delete();
    await ctx.db.from(dataSources).delete();
    return { ok: true };
  },
});

// ============================================================================
// Connector factory — the single (vault, ref) → boundResolver → connector
// mint site. Called by the notion data-plane routes below. The call site
// (the WyStack mutation handler) has no ref in scope after this call — only
// the typed connector data methods are visible.
// ============================================================================

/**
 * Mint a bound SecretResolver for a single credential ref.
 *
 * Capability attenuation: the returned resolver can open ONLY the secret at
 * `ref`. It cannot resolve any other ref — it's not a vault handle.
 *
 * The return type is the canonical `SecretResolver` from `@dashframe/engine`
 * (aliased `BoundSecretResolver` for local readability) — not a re-declaration —
 * so the connector factory's contract and this mint site can't drift.
 *
 * @throws when no vault is injected into this server (fail-closed)
 * @throws when `ref` is not a well-formed SecretRef
 */
function mintBoundResolver(
  vault: SecretVault | undefined,
  ref: string | undefined,
  label: string,
): BoundSecretResolver {
  if (vault == null) {
    throw new Error(
      `[connector-factory] no vault injected — cannot resolve credential for ${label}`,
    );
  }
  if (!ref || !isSecretRef(ref)) {
    throw new Error(
      `[connector-factory] ${label} has no valid SecretRef in config — ` +
        `run the control-plane migration first or set the API key`,
    );
  }
  const secretRef = ref as SecretRef;
  // Pre-bind vault.withSecret to this one ref. The connector calls
  // `this.auth(use => ...)` and never sees the vault or ref itself.
  return <T>(use: (plaintext: string) => Promise<T>) =>
    vault.withSecret(secretRef, use);
}

/**
 * Build a Notion connector for a DataSource: read the row, verify it's a notion
 * source, mint a bound resolver from the stored credential ref, and construct
 * the connector. The single seam where a notion connector is created from a
 * DataSource id — both data-plane routes go through it.
 *
 * @throws when the row is missing, not a notion source, or has no valid ref
 */
async function notionConnectorFor(
  ctx: FunctionContext,
  dataSourceId: UUID,
): Promise<ReturnType<typeof makeNotionConnector>> {
  const vault = vaultFromCtx(ctx);
  const row = (await ctx.db
    .from(dataSources)
    .where(eq("id", dataSourceId))
    .first()) as DataSourceRow | undefined;
  if (!row) throw new Error(`DataSource ${dataSourceId} not found`);
  if (row.kind !== "notion") {
    throw new Error(`DataSource ${dataSourceId} is not a notion source`);
  }
  const config = (row.config ?? {}) as DataSourceConfig;
  const auth = mintBoundResolver(
    vault,
    config.apiKey,
    `DataSource(${dataSourceId})`,
  );
  return makeNotionConnector(auth);
}

// ============================================================================
// Notion data-plane routes — server-side connector calls via bound resolver.
// notionConnectorFor is the only place connectors are constructed.
// ============================================================================

/**
 * Database list entry the Notion renderer controls expect: `{ id, title }`.
 * The connector's `connect()` returns the engine `RemoteDatabase` shape
 * (`{ id, name }`); this route maps `name → title` so `DataSourceControls`
 * renders and adds databases by `title` without a DTO mismatch.
 */
type NotionDatabase = { id: string; title: string };

/**
 * listNotionDatabases — connect to Notion and list accessible databases.
 *
 * Resolves the credential via the vault; the handler has no plaintext in scope.
 * Accepts the DataSource id — the ref is read from the row, never from the client.
 */
const listNotionDatabases = mutation({
  args: { dataSourceId: uuid },
  handler: async (ctx, { dataSourceId }): Promise<NotionDatabase[]> => {
    const connector = await notionConnectorFor(ctx, dataSourceId);
    const databases = await connector.connect();
    return databases.map((db) => ({ id: db.id, title: db.name }));
  },
});

/**
 * Serializable result of a Notion query — raw Arrow IPC buffer (base64) +
 * field ids + field definitions. The renderer materializes the browser
 * DataFrame from this; no plaintext and no live DataFrame crosses the boundary.
 */
type NotionQueryResult = {
  arrowBuffer: string;
  fieldIds: string[];
  fields: Field[];
  rowCount: number;
};

/**
 * queryNotionDatabase — fetch rows from a specific Notion database server-side
 * and return a serializable result the renderer can materialize.
 *
 * The credential resolves via the bound resolver inside `connector.query`; the
 * handler has no plaintext in scope and the client receives only data.
 */
const queryNotionDatabase = mutation({
  args: {
    dataSourceId: uuid,
    databaseId: text,
    tableId: uuid,
    // Optional cap on rows fetched for the preview. Bounds an unbounded Notion
    // database scan; the renderer passes a preview limit. Omitted = no cap.
    limit: int.optional(),
  },
  handler: async (
    ctx,
    { dataSourceId, databaseId, tableId, limit },
  ): Promise<NotionQueryResult> => {
    const connector = await notionConnectorFor(ctx, dataSourceId);
    // Only a positive integer limit caps the fetch. Reject 0/negative — the
    // client-side page loop treats `0 || Infinity` as unbounded, so a `limit: 0`
    // would silently become a full-database scan (the cap's whole purpose).
    const pagination =
      limit !== undefined && Number.isInteger(limit) && limit > 0
        ? { pagination: { offset: 0, limit } }
        : undefined;
    // query() resolves the apiKey via the bound resolver internally and returns
    // a serializable result — no credential in scope here, no DataFrame built.
    const result = await connector.query(databaseId, tableId, pagination);
    return {
      arrowBuffer: result.arrowBuffer,
      fieldIds: result.fieldIds,
      fields: result.fields,
      rowCount: result.rowCount,
    };
  },
});

// ============================================================================
// Postgres connector factory — mirrors notionConnectorFor.
// postgresConnectorFor is the single seam where a postgres connector is
// created from a DataSource id. Both postgres data-plane routes go through it.
// ============================================================================

/**
 * Build a Postgres connector for a DataSource: read the row, verify it's a
 * postgres source, mint a bound resolver from the stored connectionString ref,
 * and construct the connector.
 *
 * @throws when the row is missing, not a postgres source, or has no valid ref
 */
async function postgresConnectorFor(
  ctx: FunctionContext,
  dataSourceId: UUID,
): Promise<ReturnType<typeof makePostgresConnector>> {
  const vault = vaultFromCtx(ctx);
  const row = (await ctx.db
    .from(dataSources)
    .where(eq("id", dataSourceId))
    .first()) as DataSourceRow | undefined;
  if (!row) throw new Error(`DataSource ${dataSourceId} not found`);
  if (row.kind !== "postgres") {
    throw new Error(`DataSource ${dataSourceId} is not a postgres source`);
  }
  const config = (row.config ?? {}) as DataSourceConfig;
  // connectionString holds the SecretRef (same vault slot as Notion's apiKey).
  const auth = mintBoundResolver(
    vault,
    config.connectionString,
    `DataSource(${dataSourceId})`,
  );
  // connectionStringRef is for introspection only; the bound `auth` resolver
  // is the actual credential source. Pass the ref as-is — never coerce to "".
  //
  // Sink guard: defaultSchema flows into quoteIdentifier() in connect(); verify
  // it's a string before passing it through (config is an untyped JSON blob).
  const defaultSchema =
    typeof config.defaultSchema === "string" ? config.defaultSchema : undefined;
  return makePostgresConnector(auth, {
    connectionStringRef: config.connectionString,
    defaultSchema,
  });
}

// ============================================================================
// Postgres data-plane routes — server-side connector calls via bound resolver.
// postgresConnectorFor is the only place postgres connectors are constructed.
// ============================================================================

/**
 * Serializable result of a Postgres query — raw Arrow IPC buffer (base64) +
 * field ids + field definitions. The renderer materializes the browser
 * DataFrame from this; no plaintext and no live DataFrame crosses the boundary.
 */
type PostgresQueryResult = {
  arrowBuffer: string;
  fieldIds: string[];
  fields: Field[];
  rowCount: number;
};

/**
 * listPostgresTables — connect to Postgres and list tables/views in the
 * configured schema.
 *
 * Resolves the credential via the vault; the handler has no plaintext in scope.
 * Accepts the DataSource id — the ref is read from the row, never from the client.
 */
const listPostgresTables = mutation({
  args: { dataSourceId: uuid },
  handler: async (
    ctx,
    { dataSourceId },
  ): Promise<{ id: string; title: string }[]> => {
    const connector = await postgresConnectorFor(ctx, dataSourceId);
    const tables = await connector.connect();
    return tables.map((t) => ({ id: t.id, title: t.name }));
  },
});

/**
 * queryPostgresTable — fetch rows from a Postgres table or run a SELECT
 * server-side and return a serializable result the renderer can materialize.
 *
 * The credential resolves via the bound resolver inside `connector.query`; the
 * handler has no plaintext in scope and the client receives only data.
 * The connector enforces read-only at both layers (allowlist + SET SESSION).
 */
const queryPostgresTable = mutation({
  args: {
    dataSourceId: uuid,
    /** "schema.table" ref from listPostgresTables, or a user SELECT statement */
    databaseId: text,
    tableId: uuid,
    /** Optional cap on rows fetched for the preview. */
    limit: int.optional(),
  },
  handler: async (
    ctx,
    { dataSourceId, databaseId, tableId, limit },
  ): Promise<PostgresQueryResult> => {
    const connector = await postgresConnectorFor(ctx, dataSourceId);
    const pagination =
      limit !== undefined && Number.isInteger(limit) && limit > 0
        ? { pagination: { offset: 0, limit } }
        : undefined;
    const result = await connector.query(databaseId, tableId, pagination);
    return {
      arrowBuffer: result.arrowBuffer,
      fieldIds: result.fieldIds,
      fields: result.fields,
      rowCount: result.rowCount,
    };
  },
});

export const appArtifactFunctions = {
  listDataSources,
  getDataSource,
  getDataSourceByType,
  addDataSource,
  updateDataSource,
  removeDataSource,
  listDataTables,
  getDataTable,
  addDataTable,
  updateDataTable,
  refreshDataTable,
  removeDataTable,
  patchDataTableArray,
  listDataFrames,
  getDataFrameEntry,
  getDataFrameByInsight,
  putDataFrameEntry,
  updateDataFrameEntry,
  removeDataFrameEntry,
  listInsights,
  getInsight,
  createInsight,
  updateInsight,
  removeInsight,
  patchInsight,
  listVisualizations,
  getVisualization,
  createVisualization,
  updateVisualization,
  removeVisualization,
  clearAllData,
  // Notion data-plane routes (auth-blind via bound resolver)
  listNotionDatabases,
  queryNotionDatabase,
  // Postgres data-plane routes (auth-blind via bound resolver)
  listPostgresTables,
  queryPostgresTable,
};
