import { assertResourcesWritable, enqueueCleanup, resources } from "./cleanup";
import { stable } from "./values";
import { v, ConvexError } from "convex/values";
import type {
  DataSource,
  DataTable,
  DataFrameJSON,
  DataFrameAnalysis,
  Insight,
  Visualization,
  Dashboard,
  PreviewDiff,
  CommandRegistryPath,
} from "@dashframe/types";
import { isUnmodifiedDraft } from "@dashframe/types";
import {
  query,
  mutation,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import {
  typed,
  json,
  object,
  command,
  publicCommand,
  record,
  clean,
  type Command,
  type Json,
} from "./values";
import {
  principal,
  user,
  find,
  rowValue,
  LIMIT,
  openGraph,
  readGraph,
  persist,
  draft,
  log,
  draftChanges,
  eraseDraft,
} from "./store";
import { execute } from "./engine";
import { type Graph, capMessage } from "./graph";
import {
  publicRow,
  preview,
  lateBound,
  signature,
  redact,
  describeCommand,
} from "./preview";
import {
  artifactKinds,
  artifactTables,
  type ArtifactRow,
  type ArtifactTable,
} from "./model";
import { storedInsightDefinitionSchema } from "./insightCodec";
const draftArg = { draftId: v.optional(v.string()) };
async function readOne(
  ctx: QueryCtx,
  table: ArtifactTable,
  args: { id: string; draftId?: string },
) {
  const who = await principal(ctx);
  if (!args.draftId) {
    const row = await find(ctx, who.workspaceId, table, args.id);
    return row ? publicRow(table, rowValue(row)) : null;
  }
  const graph = await readGraph(ctx, who, args.draftId),
    row = await graph.find(table, args.id);
  return row ? publicRow(table, row) : null;
}
function assertCompleteArtifactRows(
  rows: readonly unknown[],
  table: ArtifactTable,
) {
  if (rows.length <= LIMIT) return;
  throw new ConvexError(capMessage(table));
}
function listQuery<T>(table: ArtifactTable) {
  return query({
    args: {
      ...draftArg,
      dataSourceId: v.optional(v.string()),
      insightId: v.optional(v.string()),
      excludeIds: v.optional(v.array(v.string())),
    },
    returns: typed<T[]>(v.array(object)),
    handler: async (ctx, args) => {
      const who = await principal(ctx);
      if (!args.draftId) {
        const rows = args.dataSourceId
          ? await ctx.db
              .query(table)
              .withIndex("by_workspaceId_and_dataSourceId", (q) =>
                q
                  .eq("workspaceId", who.workspaceId)
                  .eq("dataSourceId", args.dataSourceId),
              )
              .take(LIMIT + 1)
          : args.insightId
            ? await ctx.db
                .query(table)
                .withIndex("by_workspaceId_and_insightId", (q) =>
                  q
                    .eq("workspaceId", who.workspaceId)
                    .eq("insightId", args.insightId),
                )
                .take(LIMIT + 1)
            : await ctx.db
                .query(table)
                .withIndex("by_workspaceId_and_id", (q) =>
                  q.eq("workspaceId", who.workspaceId),
                )
                .take(LIMIT + 1);
        assertCompleteArtifactRows(rows, table);
        return rows
          .filter(
            (row) =>
              (!args.dataSourceId || row.dataSourceId === args.dataSourceId) &&
              (!args.insightId || row.insightId === args.insightId) &&
              !args.excludeIds?.includes(row.id),
          )
          .map((row) => publicRow(table, rowValue(row)) as unknown as T);
      }
      const graph = await readGraph(ctx, who, args.draftId);
      return (
        await graph.scan(
          table,
          args.dataSourceId
            ? { dataSourceId: args.dataSourceId }
            : args.insightId
              ? { insightId: args.insightId }
              : {},
        )
      )
        .filter(
          (row) =>
            (!args.dataSourceId || row.dataSourceId === args.dataSourceId) &&
            (!args.insightId || row.insightId === args.insightId) &&
            !args.excludeIds?.includes(row.id),
        )
        .map((row) => publicRow(table, row) as unknown as T);
    },
  });
}
export const listDataSources = listQuery<DataSource>("dataSources");
export const getDataSource = query({
  args: { id: v.string(), ...draftArg },
  returns: typed<DataSource | null>(v.union(object, v.null())),
  handler: async (ctx, args) =>
    (await readOne(ctx, "dataSources", args)) as unknown as DataSource | null,
});
export const listDataTables = listQuery<DataTable>("dataTables");
export const getDataTable = query({
  args: { id: v.string(), ...draftArg },
  returns: typed<DataTable | null>(v.union(object, v.null())),
  handler: async (ctx, args) =>
    (await readOne(ctx, "dataTables", args)) as unknown as DataTable | null,
});
export type FrameEntry = DataFrameJSON & {
  name: string;
  insightId?: string;
  sourceId?: string;
  definitionId?: string;
  rowCount?: number;
  columnCount?: number;
  analysis?: DataFrameAnalysis | null;
  lastRefreshedAt?: number;
  currentInsightResult?: boolean;
};
/**
 * The list read over frames. A `dataSourceId` or `insightId` filter selects
 * through that index; without one the whole table is read. Every branch,
 * filtered or not, is bounded at LIMIT rows and refuses beyond that naming
 * the recovery path, except `recovery: true` without a draft, which returns a
 * truncated batch so the Data Frames page can still delete rows through the
 * host. Under a draft the same selection runs through the graph (`scan` with
 * the filter, `list` without) and `recovery` is ignored. Command batches never
 * read frames this way, so an over-cap workspace keeps committing, drafting,
 * and publishing; only surfaces whose selection here exceeds LIMIT stop
 * rendering.
 */
export const listDataFrames = query({
  args: {
    ...draftArg,
    dataSourceId: v.optional(v.string()),
    insightId: v.optional(v.string()),
    excludeIds: v.optional(v.array(v.string())),
    recovery: v.optional(v.boolean()),
  },
  returns: typed<FrameEntry[]>(v.array(object)),
  handler: async (ctx, args) => {
    const who = await principal(ctx),
      dataSourceId = args.dataSourceId,
      insightId = args.insightId;
    if (args.draftId) {
      const graph = await readGraph(ctx, who, args.draftId);
      return (
        await (dataSourceId
          ? graph.scan("dataFrames", { dataSourceId })
          : insightId
            ? graph.scan("dataFrames", { insightId })
            : graph.list("dataFrames"))
      )
        .filter(
          (row) =>
            (!args.dataSourceId || row.dataSourceId === args.dataSourceId) &&
            (!args.insightId || row.insightId === args.insightId) &&
            !args.excludeIds?.includes(row.id),
        )
        .map((row) => publicRow("dataFrames", row) as unknown as FrameEntry);
    }
    const rows = dataSourceId
      ? await ctx.db
          .query("dataFrames")
          .withIndex("by_workspaceId_and_dataSourceId", (q) =>
            q
              .eq("workspaceId", who.workspaceId)
              .eq("dataSourceId", dataSourceId),
          )
          .take(args.recovery ? LIMIT : LIMIT + 1)
      : insightId
        ? await ctx.db
            .query("dataFrames")
            .withIndex("by_workspaceId_and_insightId", (q) =>
              q.eq("workspaceId", who.workspaceId).eq("insightId", insightId),
            )
            .take(args.recovery ? LIMIT : LIMIT + 1)
        : await ctx.db
            .query("dataFrames")
            .withIndex("by_workspaceId_and_id", (q) =>
              q.eq("workspaceId", who.workspaceId),
            )
            .take(args.recovery ? LIMIT : LIMIT + 1);
    if (!args.recovery) assertCompleteArtifactRows(rows, "dataFrames");
    return rows
      .filter(
        (row) =>
          (!dataSourceId || row.dataSourceId === dataSourceId) &&
          (!insightId || row.insightId === insightId) &&
          !args.excludeIds?.includes(row.id),
      )
      .map(
        (row) =>
          publicRow("dataFrames", rowValue(row)) as unknown as FrameEntry,
      );
  },
});
export const getDataFrameEntry = query({
  args: { id: v.string(), ...draftArg },
  returns: typed<FrameEntry | null>(v.union(object, v.null())),
  handler: async (ctx, args) =>
    (await readOne(ctx, "dataFrames", args)) as unknown as FrameEntry | null,
});
export const listInsights = listQuery<Insight>("insights");
export const getInsight = query({
  args: { id: v.string(), ...draftArg },
  returns: typed<Insight | null>(v.union(object, v.null())),
  handler: async (ctx, args) =>
    (await readOne(ctx, "insights", args)) as unknown as Insight | null,
});
export const listVisualizations = listQuery<Visualization>("visualizations");
export const getVisualization = query({
  args: { id: v.string(), ...draftArg },
  returns: typed<Visualization | null>(v.union(object, v.null())),
  handler: async (ctx, args) =>
    (await readOne(
      ctx,
      "visualizations",
      args,
    )) as unknown as Visualization | null,
});
export const listDashboards = listQuery<Dashboard>("dashboards");
export const getDashboard = query({
  args: { id: v.string(), ...draftArg },
  returns: typed<Dashboard | null>(v.union(object, v.null())),
  handler: async (ctx, args) =>
    (await readOne(ctx, "dashboards", args)) as unknown as Dashboard | null,
});
export const getDataSourceByType = query({
  args: { type: v.string(), ...draftArg },
  returns: typed<DataSource | null>(v.union(object, v.null())),
  handler: async (ctx, args) => {
    const who = await principal(ctx);
    if (!args.draftId) {
      const row = await ctx.db
        .query("dataSources")
        .withIndex("by_workspaceId_and_kind", (q) =>
          q.eq("workspaceId", who.workspaceId).eq("kind", args.type),
        )
        .first();
      return row
        ? (publicRow("dataSources", rowValue(row)) as unknown as DataSource)
        : null;
    }
    const graph = await readGraph(ctx, who, args.draftId);
    const row = (await graph.scan("dataSources")).find(
      (candidate) => candidate.kind === args.type,
    );
    return row
      ? (publicRow("dataSources", row) as unknown as DataSource)
      : null;
  },
});
export const getDataFrameByInsight = query({
  args: { insightId: v.string(), ...draftArg },
  returns: typed<FrameEntry | null>(v.union(object, v.null())),
  handler: async (ctx, args) => {
    const who = await principal(ctx);
    const rows = args.draftId
      ? await (
          await readGraph(ctx, who, args.draftId)
        ).scan("dataFrames", {
          insightId: args.insightId,
        })
      : (
          await ctx.db
            .query("dataFrames")
            .withIndex("by_workspaceId_and_insightId", (q) =>
              q
                .eq("workspaceId", who.workspaceId)
                .eq("insightId", args.insightId),
            )
            .take(LIMIT + 1)
        ).map((row) => rowValue(row));
    assertCompleteArtifactRows(rows, "dataFrames");
    rows.sort((a, b) => {
      const aCurrent =
        a.analysis &&
        typeof a.analysis === "object" &&
        !Array.isArray(a.analysis) &&
        a.analysis.currentInsightResult === true;
      const bCurrent =
        b.analysis &&
        typeof b.analysis === "object" &&
        !Array.isArray(b.analysis) &&
        b.analysis.currentInsightResult === true;
      return (
        Number(bCurrent) - Number(aCurrent) ||
        (b.lastRefreshedAt ?? b.createdAt) - (a.lastRefreshedAt ?? a.createdAt)
      );
    });
    return rows[0]
      ? (publicRow("dataFrames", rows[0]) as unknown as FrameEntry)
      : null;
  },
});
const resultValidator = v.array(
  v.object({ id: v.optional(v.string()), value: json }),
);
export const commitBatch = mutation({
  args: {
    commands: v.array(publicCommand),
    operationId: v.optional(v.string()),
  },
  returns: v.object({
    mode: v.literal("commit"),
    results: resultValidator,
    commands: v.array(publicCommand),
    tablesWritten: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const who = await principal(ctx);
    user(who);
    if (lateBound(args.commands).length)
      throw new ConvexError("Unbound operands cannot be committed");
    if (args.operationId) {
      const prior = await ctx.db
        .query("operations")
        .withIndex("by_workspaceId_and_operationId", (q) =>
          q
            .eq("workspaceId", who.workspaceId)
            .eq("operationId", args.operationId!),
        )
        .unique();
      if (prior) {
        if (stable(prior.request) !== stable(args.commands))
          throw new ConvexError("Operation ID reused with different commands");
        return prior.result as {
          mode: "commit";
          results: { id?: string; value: Json }[];
          commands: Command[];
          tablesWritten: string[];
        };
      }
    }
    const graph = openGraph(ctx, who.workspaceId);
    const results = await execute(
      graph,
      args.commands,
      who.workspaceId,
      Date.now(),
    );
    const tablesWritten = await persist(ctx, who.workspaceId, graph),
      result = {
        mode: "commit" as const,
        results,
        commands: args.commands,
        tablesWritten,
      };
    if (args.operationId)
      await ctx.db.insert("operations", {
        workspaceId: who.workspaceId,
        operationId: args.operationId,
        request: args.commands as unknown as Json,
        result: result as unknown as Json,
      });
    return result;
  },
});
export const previewDiff = query({
  args: { commands: v.array(publicCommand), ...draftArg },
  returns: typed<PreviewDiff>(object),
  handler: async (ctx, args) => {
    const who = await principal(ctx);
    return await preview(
      await readGraph(ctx, who, args.draftId),
      args.commands,
      who.workspaceId,
      Date.now(),
    );
  },
});
export async function replaceDraft(
  ctx: MutationCtx,
  row: Doc<"drafts">,
  commands: Command[],
  graph: Graph,
  oldBase = true,
) {
  if (commands.length > 200)
    throw new ConvexError("Draft is limited to 200 commands");
  const diff = await graph.changes();
  await assertResourcesWritable(ctx, row.workspaceId, [
    commands,
    diff.map((c) => c.value),
  ]);
  const prior = await draftChanges(ctx, row.workspaceId, row.draftId);
  await enqueueCleanup(
    ctx,
    row.workspaceId,
    resources([prior, await log(ctx, row.workspaceId, row.draftId)]).values(),
  );
  const baseByKey = new Map(prior.map((c) => [`${c.table}:${c.id}`, c.base]));
  for (const c of prior) await ctx.db.delete(c._id);
  for (const c of diff) {
    await ctx.db.insert("draftChanges", {
      workspaceId: row.workspaceId,
      draftId: row.draftId,
      ...c,
      base:
        oldBase && baseByKey.has(`${c.table}:${c.id}`)
          ? baseByKey.get(`${c.table}:${c.id}`)!
          : c.base,
    });
  }
  for (const e of await log(ctx, row.workspaceId, row.draftId))
    await ctx.db.delete(e._id);
  for (let sequence = 0; sequence < commands.length; sequence++)
    await ctx.db.insert("draftLog", {
      workspaceId: row.workspaceId,
      draftId: row.draftId,
      sequence,
      command: {
        ...commands[sequence]!,
        args: record(commands[sequence]!.args),
      },
    });
  await ctx.db.patch(row._id, {
    revision: row.revision + 1,
    commandCount: commands.length,
    updatedAt: Date.now(),
  });
}
export const draftBatch = mutation({
  args: { commands: v.array(publicCommand), ...draftArg },
  returns: v.object({ draftId: v.string(), results: resultValidator }),
  handler: async (ctx, args) => {
    const who = await principal(ctx);
    let row: Doc<"drafts">;
    if (args.draftId) row = await draft(ctx, who, args.draftId, true);
    else {
      const draftId = crypto.randomUUID(),
        now = Date.now(),
        _id = await ctx.db.insert("drafts", {
          workspaceId: who.workspaceId,
          draftId,
          owner: who.owner,
          revision: 0,
          createdAt: now,
          updatedAt: now,
          commandCount: 0,
        });
      row = (await ctx.db.get(_id))!;
    }
    const commands = [
        ...(await log(ctx, who.workspaceId, row.draftId)).map((e) => e.command),
        ...args.commands,
      ],
      graph = await readGraph(ctx, who, row.draftId);
    const results = await execute(
      graph,
      args.commands,
      who.workspaceId,
      Date.now(),
      { service: who.kind === "service" },
    );
    await replaceDraft(ctx, row, commands, graph);
    return { draftId: row.draftId, results };
  },
});
export const getDraftLog = query({
  args: { draftId: v.string() },
  returns: v.array(command),
  handler: async (ctx, args) => {
    const who = await principal(ctx);
    await draft(ctx, who, args.draftId);
    return (await log(ctx, who.workspaceId, args.draftId)).map((e) => ({
      ...e.command,
      args: record(redact(e.command.args)),
    }));
  },
});

const draftSummaryNode = v.object({
  nodeId: v.string(),
  kind: v.union(
    v.literal("dataSource"),
    v.literal("dataTable"),
    v.literal("insight"),
    v.literal("dataFrame"),
    v.literal("visualization"),
    v.literal("dashboard"),
  ),
  name: v.string(),
  intent: v.array(
    v.object({
      command: v.string(),
      summary: v.string(),
    }),
  ),
});

type VisibleDraftPrincipal = Awaited<ReturnType<typeof principal>>;

async function listVisibleDraftRows(
  ctx: QueryCtx,
  who: VisibleDraftPrincipal,
): Promise<Doc<"drafts">[]> {
  const ownRows = await ctx.db
    .query("drafts")
    .withIndex("by_workspaceId_and_owner", (q) =>
      q.eq("workspaceId", who.workspaceId).eq("owner", who.owner),
    )
    .take(LIMIT + 1);
  const serviceRows =
    who.kind === "user"
      ? await ctx.db
          .query("drafts")
          .withIndex("by_workspaceId_and_owner", (q) =>
            q
              .eq("workspaceId", who.workspaceId)
              .gte("owner", "service:")
              .lt("owner", "service;"),
          )
          .take(LIMIT + 1)
      : [];
  const rows = [...ownRows, ...serviceRows];
  if (rows.length > LIMIT) throw new ConvexError("Draft list limit exceeded");
  return rows;
}

export const listDraftCount = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const who = await principal(ctx);
    return (await listVisibleDraftRows(ctx, who)).length;
  },
});

async function hasVisibleDraft(
  ctx: QueryCtx,
  who: Awaited<ReturnType<typeof principal>>,
): Promise<boolean> {
  const ownDraft = await ctx.db
    .query("drafts")
    .withIndex("by_workspaceId_and_owner", (q) =>
      q.eq("workspaceId", who.workspaceId).eq("owner", who.owner),
    )
    .first();
  if (ownDraft) return true;
  if (who.kind !== "user") return false;
  return Boolean(
    await ctx.db
      .query("drafts")
      .withIndex("by_workspaceId_and_owner", (q) =>
        q
          .eq("workspaceId", who.workspaceId)
          .gte("owner", "service:")
          .lt("owner", "service;"),
      )
      .first(),
  );
}

export const workspaceArtifactPresence = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const who = await principal(ctx);
    const rows = await Promise.all([
      ctx.db
        .query("dashboards")
        .withIndex("by_workspaceId_and_id", (q) =>
          q.eq("workspaceId", who.workspaceId),
        )
        .first(),
      ctx.db
        .query("visualizations")
        .withIndex("by_workspaceId_and_id", (q) =>
          q.eq("workspaceId", who.workspaceId),
        )
        .first(),
      ctx.db
        .query("insights")
        .withIndex("by_workspaceId_and_id", (q) =>
          q.eq("workspaceId", who.workspaceId),
        )
        .first(),
      ctx.db
        .query("dataSources")
        .withIndex("by_workspaceId_and_id", (q) =>
          q.eq("workspaceId", who.workspaceId),
        )
        .first(),
      hasVisibleDraft(ctx, who),
    ]);
    return rows.some(Boolean);
  },
});

const fixedDraftTargetTables: Record<
  CommandRegistryPath,
  readonly ArtifactTable[]
> = {
  getOrCreateDataSource: ["dataSources"],
  createDataSource: ["dataSources"],
  setDataSourceConfig: ["dataSources"],
  createDataTable: ["dataTables"],
  setDataTableSchema: ["dataTables"],
  refreshDataTableCmd: ["dataTables"],
  addField: ["dataTables", "insights"],
  updateField: ["dataTables", "insights"],
  removeField: ["dataTables", "insights"],
  addMetric: ["dataTables", "insights"],
  updateMetric: ["dataTables", "insights"],
  removeMetric: ["dataTables", "insights"],
  getOrCreateInsightDraft: ["insights"],
  createInsightCmd: ["insights"],
  setInsightSource: ["insights"],
  selectFields: ["insights"],
  setInsightFilter: ["insights"],
  setInsightSort: ["insights"],
  setInsightRuntimeControls: ["insights"],
  addJoin: ["insights"],
  updateJoin: ["insights"],
  removeJoin: ["insights"],
  createVisualizationCmd: ["visualizations"],
  setChartType: ["visualizations"],
  setChartEncoding: ["visualizations"],
  createDashboardCmd: ["dashboards"],
  addDashboardItemCmd: ["dashboards"],
  updateDashboardItemCmd: ["dashboards"],
  setDashboardLayout: ["dashboards"],
  removeDashboardItemCmd: ["dashboards"],
  patchDashboardItemOverrideCmd: ["dashboards"],
  setDashboardControls: ["dashboards"],
  fanOutDashboardItemsCmd: ["dashboards"],
  renameNode: artifactTables,
  deleteNode: [
    "visualizations",
    "dashboards",
    "insights",
    "dataTables",
    "dataSources",
  ],
};

function getDraftTargetTables(path: string): readonly ArtifactTable[] {
  return Object.hasOwn(fixedDraftTargetTables, path)
    ? fixedDraftTargetTables[path as CommandRegistryPath]
    : [];
}

type DraftCommandTarget = {
  id: string;
  table: ArtifactTable;
  name: string;
};

const explicitCreateTargetTables: Partial<
  Record<CommandRegistryPath, ArtifactTable>
> = {
  getOrCreateDataSource: "dataSources",
  createDataSource: "dataSources",
  createDataTable: "dataTables",
  getOrCreateInsightDraft: "insights",
  createInsightCmd: "insights",
  createVisualizationCmd: "visualizations",
  createDashboardCmd: "dashboards",
};

function explicitCreateTarget(command: Command): DraftCommandTarget | null {
  const table = Object.hasOwn(explicitCreateTargetTables, command.path)
    ? explicitCreateTargetTables[command.path as CommandRegistryPath]
    : undefined;
  if (!table) return null;
  const args = record(command.args);
  if (typeof args.id !== "string") return null;
  return {
    id: args.id,
    table,
    name:
      typeof args.name === "string" && args.name.length > 0
        ? args.name
        : "Untitled artifact",
  };
}

function rememberInsightDraftTargetBySourceId(
  targets: Map<string, DraftCommandTarget>,
  id: string,
  row: Pick<ArtifactRow, "definition" | "name">,
) {
  if (!row.definition) return;
  const definition = storedInsightDefinitionSchema.parse(row.definition);
  if (
    definition.source.sourceType !== "dataTable" ||
    !isUnmodifiedDraft(definition) ||
    targets.has(definition.source.sourceId)
  ) {
    return;
  }
  targets.set(definition.source.sourceId, {
    id,
    table: "insights",
    name: row.name.length > 0 ? row.name : "Untitled artifact",
  });
}

function rememberInsightCreationResolutionBySourceId(
  targets: Map<string, DraftCommandTarget>,
  command: Command,
  target: DraftCommandTarget,
) {
  if (
    command.path !== "getOrCreateInsightDraft" &&
    command.path !== "createInsightCmd"
  ) {
    return;
  }
  if (target.table !== "insights") {
    return;
  }
  const args = record(command.args);
  if (command.path === "createInsightCmd" && !isUnmodifiedDraft(args)) {
    return;
  }
  const source = record(args.source);
  if (
    source.sourceType === "dataTable" &&
    typeof source.sourceId === "string" &&
    !targets.has(source.sourceId)
  ) {
    // Record what this command resolved to before later commands can modify the
    // final materialized row and make it ineligible for unmodified-draft reuse.
    targets.set(source.sourceId, target);
  }
}

async function listExistingInsightDraftTargets(
  ctx: QueryCtx,
  workspaceId: string,
): Promise<Map<string, DraftCommandTarget>> {
  const rows = await ctx.db
    .query("insights")
    .withIndex("by_workspaceId_and_id", (q) => q.eq("workspaceId", workspaceId))
    .take(LIMIT + 1);
  assertCompleteArtifactRows(rows, "insights");

  const targets = new Map<string, DraftCommandTarget>();
  for (const row of rows) {
    rememberInsightDraftTargetBySourceId(targets, row.id, row);
  }
  return targets;
}

async function resolveDraftCommandTarget(
  ctx: QueryCtx,
  workspaceId: string,
  command: Command,
  changes: readonly Doc<"draftChanges">[],
  existingInsightDraftsBySourceId: ReadonlyMap<string, DraftCommandTarget>,
  createdTargets: ReadonlyMap<string, DraftCommandTarget>,
): Promise<DraftCommandTarget | null> {
  const args = record(command.args);
  const targetId = args.nodeId ?? args.dashboardId ?? args.id;
  if (typeof targetId !== "string") return null;

  const targetTables = getDraftTargetTables(command.path);
  for (const table of targetTables) {
    const change = changes.find(
      (candidate) => candidate.table === table && candidate.id === targetId,
    );
    if (!change) continue;
    return {
      id: change.id,
      table,
      name: change.base?.name ?? change.value?.name ?? "Deleted artifact",
    };
  }

  if (command.path === "getOrCreateInsightDraft") {
    const source = record(args.source);
    if (
      source.sourceType === "dataTable" &&
      typeof source.sourceId === "string"
    ) {
      const existing = existingInsightDraftsBySourceId.get(source.sourceId);
      if (existing) return existing;
    }
  }

  for (const table of targetTables) {
    const created = createdTargets.get(`${table}:${targetId}`);
    if (created) return created;
  }

  for (const table of targetTables) {
    const row = await find(ctx, workspaceId, table, targetId);
    if (!row) continue;
    const value = rowValue(row);
    return {
      id: targetId,
      table,
      name:
        typeof value.name === "string" && value.name.length > 0
          ? value.name
          : "Untitled artifact",
    };
  }

  return explicitCreateTarget(command);
}

async function summarizeDraftForList(
  ctx: QueryCtx,
  workspaceId: string,
  commands: Command[],
  changes: Doc<"draftChanges">[],
  existingInsightDraftsBySourceId: ReadonlyMap<string, DraftCommandTarget>,
) {
  const insightDraftsBySourceId = new Map(existingInsightDraftsBySourceId);
  const createdTargets = new Map<string, DraftCommandTarget>();
  const targets: Array<{
    key: string;
    id: string;
    table: ArtifactTable;
    name: string;
    command: Command;
  }> = [];
  for (const command of commands) {
    const target = await resolveDraftCommandTarget(
      ctx,
      workspaceId,
      command,
      changes,
      insightDraftsBySourceId,
      createdTargets,
    );
    if (!target) continue;
    targets.push({
      key: `${target.table}:${target.id}`,
      ...target,
      command,
    });
    if (explicitCreateTarget(command)) {
      createdTargets.set(`${target.table}:${target.id}`, target);
    }
    rememberInsightCreationResolutionBySourceId(
      insightDraftsBySourceId,
      command,
      target,
    );
    if (target.table === "insights") {
      const change = changes.find(
        (candidate) =>
          candidate.table === "insights" && candidate.id === target.id,
      );
      if (change?.value) {
        rememberInsightDraftTargetBySourceId(
          insightDraftsBySourceId,
          change.id,
          change.value,
        );
      }
    }
  }

  const primary = targets[0];
  if (primary) {
    const intent = targets
      .filter((target) => target.key === primary.key)
      .slice(0, 2)
      .map((target) => describeCommand(target.command));
    return {
      directNodes: [
        {
          nodeId: primary.id,
          kind: artifactKinds[primary.table],
          name: primary.name,
          intent,
        },
      ],
      remainingIntentCount: Math.max(0, commands.length - intent.length),
    };
  }

  const change = changes.find((candidate) =>
    artifactTables.includes(candidate.table as ArtifactTable),
  );
  if (change) {
    const table = change.table as ArtifactTable;
    return {
      directNodes: [
        {
          nodeId: change.id,
          kind: artifactKinds[table],
          name: change.base?.name ?? change.value?.name ?? "Deleted artifact",
          intent: [],
        },
      ],
      remainingIntentCount: commands.length,
    };
  }

  return {
    directNodes: [],
    remainingIntentCount: commands.length,
  };
}

export const listDrafts = query({
  args: {},
  returns: v.array(
    v.object({
      draftId: v.string(),
      createdAt: v.string(),
      updatedAt: v.union(v.string(), v.null()),
      commandCount: v.number(),
      kinds: v.record(v.string(), v.number()),
      paths: v.array(v.string()),
      summary: v.object({
        directNodes: v.array(draftSummaryNode),
        remainingIntentCount: v.number(),
      }),
    }),
  ),
  handler: async (ctx) => {
    const who = await principal(ctx);
    const rows = await listVisibleDraftRows(ctx, who);
    const commandsByDraft = new Map<string, Command[]>();
    const summaryByDraft = new Map<
      string,
      Awaited<ReturnType<typeof summarizeDraftForList>>
    >();
    await Promise.all(
      rows.map(async (row) => {
        const commands = (await log(ctx, who.workspaceId, row.draftId)).map(
          (entry) => entry.command,
        );
        commandsByDraft.set(row.draftId, commands);
      }),
    );
    const needsExistingInsightDrafts = [...commandsByDraft.values()].some(
      (commands) =>
        commands.some((command) => command.path === "getOrCreateInsightDraft"),
    );
    const existingInsightDraftsBySourceId = needsExistingInsightDrafts
      ? await listExistingInsightDraftTargets(ctx, who.workspaceId)
      : new Map<string, DraftCommandTarget>();
    await Promise.all(
      rows.map(async (row) => {
        const commands = commandsByDraft.get(row.draftId) ?? [];
        summaryByDraft.set(
          row.draftId,
          await summarizeDraftForList(
            ctx,
            who.workspaceId,
            commands,
            await draftChanges(ctx, who.workspaceId, row.draftId),
            existingInsightDraftsBySourceId,
          ),
        );
      }),
    );
    return rows.map((row) => {
      const commands = commandsByDraft.get(row.draftId) ?? [];
      const paths = commands.map((command) => command.path);
      const kinds: Record<string, number> = {};
      for (const path of paths) kinds[path] = (kinds[path] ?? 0) + 1;
      return {
        draftId: row.draftId,
        createdAt: new Date(row.createdAt).toISOString(),
        updatedAt: new Date(row.updatedAt).toISOString(),
        commandCount: row.commandCount,
        kinds,
        paths: [...new Set(paths)],
        summary: summaryByDraft.get(row.draftId) ?? {
          directNodes: [],
          remainingIntentCount: row.commandCount,
        },
      };
    });
  },
});
async function review(
  ctx: QueryCtx,
  who: Awaited<ReturnType<typeof principal>>,
  draftId: string,
) {
  const row = await draft(ctx, who, draftId),
    commands = (await log(ctx, who.workspaceId, draftId)).map((e) => e.command),
    unbound = lateBound(commands),
    diff = await preview(
      openGraph(ctx, who.workspaceId),
      commands,
      who.workspaceId,
      row.createdAt,
      true,
    );
  return {
    draftId,
    commands: commands.map((c, i) =>
      clean({
        id: c.id,
        path: c.path,
        hasArgs: true,
        lateBoundCount: unbound.filter((x) => x.commandIndex === i).length,
      }),
    ),
    commandCount: commands.length,
    logSignature: signature(row.revision, commands),
    revision: row.revision,
    diff,
    lateBound: unbound,
    publishBlocked: commands.length === 0 || unbound.length > 0 || !!diff.error,
    draftExists: true,
  };
}
export const draftPublishReview = query({
  args: { draftId: v.string() },
  returns: typed<Awaited<ReturnType<typeof review>>>(object),
  handler: async (ctx, args) => review(ctx, await principal(ctx), args.draftId),
});
export const discardDraft = mutation({
  args: { draftId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const who = await principal(ctx),
      row = await draft(ctx, who, args.draftId);
    await eraseDraft(ctx, row);
    return null;
  },
});
export const publishDraft = mutation({
  args: {
    draftId: v.string(),
    expectedCommandCount: v.optional(v.union(v.string(), v.number())),
    expectedLogSignature: v.optional(v.string()),
    expectedRevision: v.optional(v.number()),
  },
  returns: v.object({
    mode: v.literal("commit"),
    results: resultValidator,
    commands: v.array(publicCommand),
    tablesWritten: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const who = await principal(ctx);
    user(who);
    const row = await draft(ctx, who, args.draftId),
      commands = (await log(ctx, who.workspaceId, args.draftId)).map(
        (e) => e.command,
      );
    if (
      (args.expectedCommandCount !== undefined &&
        Number(args.expectedCommandCount) !== commands.length) ||
      (args.expectedLogSignature !== undefined &&
        args.expectedLogSignature !== signature(row.revision, commands)) ||
      (args.expectedRevision !== undefined &&
        args.expectedRevision !== row.revision)
    )
      throw new ConvexError("Draft changed since review");
    if (!commands.length || lateBound(commands).length)
      throw new ConvexError("Draft publication blocked");
    for (const change of await draftChanges(
      ctx,
      who.workspaceId,
      args.draftId,
    )) {
      const table = change.table as ArtifactTable,
        currentDoc = await find(ctx, who.workspaceId, table, change.id),
        current = currentDoc ? rowValue(currentDoc) : null;
      if (change.base === null) {
        if (current !== null)
          throw new ConvexError("Draft conflicts with canonical changes");
      } else if (current === null)
        throw new ConvexError("Draft conflicts with canonical deletion");
      else {
        const changedKeys = change.value
          ? Object.keys({ ...change.base, ...change.value }).filter(
              (key) =>
                key !== "revision" &&
                key !== "updatedAt" &&
                stable(record(change.base)[key]) !==
                  stable(record(change.value)[key]),
            )
          : Object.keys(change.base).filter(
              (key) => key !== "revision" && key !== "updatedAt",
            );
        if (
          changedKeys.some(
            (key) =>
              stable(record(current)[key]) !== stable(record(change.base)[key]),
          )
        )
          throw new ConvexError("Draft conflicts with canonical changes");
      }
    }
    const graph = openGraph(ctx, who.workspaceId),
      results = await execute(graph, commands, who.workspaceId, Date.now(), {
        host: true,
      });
    const tablesWritten = await persist(ctx, who.workspaceId, graph);
    await eraseDraft(ctx, row);
    return {
      mode: "commit" as const,
      results,
      commands: commands.map((c) => ({ ...c, args: redact(record(c.args)) })),
      tablesWritten,
    };
  },
});
const revisionOp = v.union(
  v.object({ type: v.literal("removeCommand"), commandIndex: v.number() }),
  v.object({
    type: v.literal("bindOperand"),
    commandIndex: v.number(),
    jsonPath: v.string(),
    value: json,
  }),
);
export const reviseDraft = mutation({
  args: {
    draftId: v.string(),
    expectedLogSignature: v.string(),
    ops: v.array(revisionOp),
  },
  returns: v.object({
    draftId: v.string(),
    commandCount: v.number(),
    logSignature: v.string(),
  }),
  handler: async (ctx, args) => {
    const who = await principal(ctx);
    user(who);
    const row = await draft(ctx, who, args.draftId),
      commands = clean(
        (await log(ctx, who.workspaceId, args.draftId)).map((e) => e.command),
      );
    if (signature(row.revision, commands) !== args.expectedLogSignature)
      throw new ConvexError("Draft changed since review");
    const removals = new Set<number>(),
      bindings = new Set<string>();
    for (const op of args.ops) {
      if (
        !Number.isInteger(op.commandIndex) ||
        op.commandIndex < 0 ||
        op.commandIndex >= commands.length
      )
        throw new Error("Invalid command index");
      if (op.type === "removeCommand") {
        if (removals.has(op.commandIndex)) throw new Error("Duplicate removal");
        removals.add(op.commandIndex);
        continue;
      }
      if (
        !/^args(?:\.[A-Za-z_$][\w$]*|\[\d+\])*$/.test(op.jsonPath) ||
        /__(?:proto)__|constructor|prototype/.test(op.jsonPath)
      )
        throw new Error("Invalid operand path");
      const binding = `${op.commandIndex}:${op.jsonPath}`;
      if (bindings.has(binding)) throw new Error("Duplicate binding");
      bindings.add(binding);
      const found = lateBound([commands[op.commandIndex]!]).find(
        (x) => x.jsonPath === op.jsonPath,
      );
      if (!found || found.refType !== "placeholder")
        throw new Error("Only placeholder operands can be bound");
      const tokens = [
        ...op.jsonPath.matchAll(/([A-Za-z_$][\w$]*)|\[(\d+)\]/g),
      ].map((m) => (m[2] === undefined ? m[1]! : Number(m[2])));
      let parent: unknown = commands[op.commandIndex];
      for (const token of tokens.slice(0, -1)) {
        if (!parent || typeof parent !== "object")
          throw new Error("Operand path missing");
        parent = (parent as Record<string | number, unknown>)[token];
      }
      if (!parent || typeof parent !== "object")
        throw new Error("Operand path missing");
      (parent as Record<string | number, unknown>)[tokens.at(-1)!] = {
        kind: "value",
        v: op.value,
      };
    }
    const next = commands.filter((_, i) => !removals.has(i));
    const graph = openGraph(ctx, who.workspaceId);
    await execute(graph, next, who.workspaceId, row.createdAt, { host: true });
    await replaceDraft(ctx, row, next, graph);
    return {
      draftId: row.draftId,
      commandCount: next.length,
      logSignature: signature(row.revision + 1, next),
    };
  },
});

export const updateDataFrameEntry = mutation({
  args: { id: v.string(), updates: object },
  returns: v.object({ ok: v.literal(true) }),
  handler: async (ctx, args) => {
    const who = await principal(ctx);
    user(who);
    const row = await find(ctx, who.workspaceId, "dataFrames", args.id);
    if (!row) throw new Error("Data frame not found");
    const allowed = new Set(["name", "insightId"]);
    if (Object.keys(args.updates).some((k) => !allowed.has(k)))
      throw new Error(
        "Server frames are immutable; only name and insight association may be updated",
      );
    if (
      args.updates.name !== undefined &&
      typeof args.updates.name !== "string"
    )
      throw new Error("Invalid frame name");
    if (
      args.updates.insightId !== undefined &&
      typeof args.updates.insightId !== "string"
    )
      throw new Error("Invalid insight ID");
    if (
      typeof args.updates.insightId === "string" &&
      !(await find(ctx, who.workspaceId, "insights", args.updates.insightId))
    )
      throw new Error("Insight not found");
    await ctx.db.patch(row._id, {
      ...args.updates,
      revision: row.revision + 1,
      updatedAt: Date.now(),
    });
    return { ok: true as const };
  },
});
export const projectInfo = query({
  args: {},
  returns: v.object({
    projectId: v.string(),
    name: v.string(),
    version: v.string(),
    schemaVersion: v.number(),
    createdAt: v.string(),
    createdBy: v.string(),
  }),
  handler: async (ctx) => {
    const who = await principal(ctx);
    const row = await ctx.db
      .query("workspaces")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", who.workspaceId))
      .unique();
    if (!row) throw new Error("Project not initialized");
    return {
      projectId: row.projectId,
      name: row.name,
      version: row.version,
      schemaVersion: row.schemaVersion,
      createdAt: new Date(row.createdAt).toISOString(),
      createdBy: row.createdBy,
    };
  },
});
