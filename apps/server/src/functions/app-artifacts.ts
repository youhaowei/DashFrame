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
import { stripSampleValues } from "@dashframe/types";
import { eq, jsonb, text, uuid } from "@wystack/db";
import { mutation, query } from "@wystack/server";

import { type DataSourceConfig, isRecord, requireRecordWithId } from "./utils";

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

function rowToDataSource(row: DataSourceRow): DataSource {
  const config = (row.config ?? {}) as DataSourceConfig;
  return {
    id: row.id,
    type: row.kind,
    name: row.name,
    apiKey: config.apiKey,
    connectionString: config.connectionString,
    createdAt: row.createdAt.getTime(),
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
    createdAt: row.createdAt.getTime(),
    lastFetchedAt: row.lastFetchedAt?.getTime(),
  };
}

function rowToDataFrame(row: DataFrameRow): DataFrameEntry {
  return {
    id: row.id,
    storage: row.storage as DataFrameStorageLocation,
    fieldIds: row.fieldIds as UUID[],
    primaryKey: (row.primaryKey as string | string[] | null) ?? undefined,
    createdAt: row.createdAt.getTime(),
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
    createdAt: row.createdAt.getTime(),
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
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt?.getTime(),
  };
}

async function loadDataTable(
  ctx: { db: import("@wystack/db").TrackedDb },
  id: string,
): Promise<DataTable> {
  const row = (await ctx.db.from(dataTables).where(eq("id", id)).first()) as
    | DataTableRow
    | undefined;
  if (!row) throw new Error(`Data table ${id} not found`);
  return rowToDataTable(row);
}

async function loadInsight(
  ctx: { db: import("@wystack/db").TrackedDb },
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
    const rows = (await ctx.db.from(dataSources).all()) as DataSourceRow[];
    return rows.map(rowToDataSource);
  },
});

const getDataSource = query({
  args: { id: uuid },
  handler: async (ctx, { id }): Promise<DataSource | null> => {
    const row = (await ctx.db.from(dataSources).where(eq("id", id)).first()) as
      | DataSourceRow
      | undefined;
    return row ? rowToDataSource(row) : null;
  },
});

const getDataSourceByType = query({
  args: { type: text },
  handler: async (ctx, { type }): Promise<DataSource | null> => {
    const row = (await ctx.db
      .from(dataSources)
      .where(eq("kind", type))
      .first()) as DataSourceRow | undefined;
    return row ? rowToDataSource(row) : null;
  },
});

// NOTE: the racy `getOrCreateDataSourceByType` (check-then-insert keyed on
// `kind`, no unique constraint → concurrent ingests double-insert, PR #46
// Greptile P1) was REPLACED by the `GetOrCreateDataSource` command in
// `./commands.ts`, which keys idempotency on a client-minted primary key. See
// that file's traceability table.

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
    const [row] = (await ctx.db.into(dataSources).insert({
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
    const current = (await ctx.db
      .from(dataSources)
      .where(eq("id", id))
      .first()) as DataSourceRow | undefined;
    if (!current) throw new Error(`Data source ${id} not found`);
    const config = { ...((current.config ?? {}) as DataSourceConfig) };
    if (apiKey !== undefined) config.apiKey = apiKey;
    if (connectionString !== undefined)
      config.connectionString = connectionString;
    await ctx.db
      .from(dataSources)
      .where(eq("id", id))
      .update({
        ...(name !== undefined ? { name } : {}),
        config,
      });
    return { ok: true };
  },
});

const removeDataSource = mutation({
  args: { id: uuid },
  handler: async (ctx, { id }): Promise<{ ok: true }> => {
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
// YW-157 caller migration window.
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
    // DB holds zero raw cell values (YW-118). In-memory callers that need
    // sampleValues (e.g. YW-129 classifier) operate on the runtime object
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
        // Strip raw sample values at the write boundary (YW-118).
        ...(patch.analysis !== undefined
          ? { analysis: stripSampleValues(patch.analysis) }
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
    };
    const [row] = (await ctx.db.into(insights).insert({
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
    // One unconditional DELETE FROM per table (TrackedDb.delete() with no
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
};
