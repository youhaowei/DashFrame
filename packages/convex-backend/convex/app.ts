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
} from "@dashframe/types";
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
  loadGraph,
  readGraph,
  persist,
  draft,
  log,
  draftChanges,
  eraseDraft,
} from "./store";
import { cloneGraph, changes, execute, type Graph } from "./engine";
import { publicRow, preview, lateBound, signature, redact } from "./preview";
import { artifactTables, type ArtifactTable } from "./model";
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
    row = graph.get(table)!.get(args.id);
  return row ? publicRow(table, row) : null;
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
      const who = await principal(ctx),
        graph = await readGraph(ctx, who, args.draftId);
      return [...graph.get(table)!.values()]
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
export const listDataFrames = listQuery<FrameEntry>("dataFrames");
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
    const who = await principal(ctx),
      graph = await readGraph(ctx, who, args.draftId);
    const row = [...graph.get("dataSources")!.values()].find(
      (r) => r.kind === args.type,
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
    const who = await principal(ctx),
      graph = await readGraph(ctx, who, args.draftId);
    const rows = [...graph.get("dataFrames")!.values()].filter(
      (r) => r.insightId === args.insightId,
    );
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
        if (JSON.stringify(prior.request) !== JSON.stringify(args.commands))
          throw new ConvexError("Operation ID reused with different commands");
        return prior.result as {
          mode: "commit";
          results: { id?: string; value: Json }[];
          commands: Command[];
          tablesWritten: string[];
        };
      }
    }
    const before = await loadGraph(ctx, who.workspaceId),
      after = cloneGraph(before);
    const results = execute(after, args.commands, who.workspaceId, Date.now());
    const tablesWritten = await persist(ctx, who.workspaceId, before, after),
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
    return preview(
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
  before: Graph,
  after: Graph,
  oldBase = true,
) {
  if (commands.length > 1000)
    throw new ConvexError("Draft command limit exceeded");
  const prior = await draftChanges(ctx, row.workspaceId, row.draftId);
  const baseByKey = new Map(prior.map((c) => [`${c.table}:${c.id}`, c.base]));
  for (const c of prior) await ctx.db.delete(c._id);
  for (const c of changes(before, after)) {
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
      before = await loadGraph(ctx, who.workspaceId),
      after = await readGraph(ctx, who, row.draftId);
    const results = execute(after, args.commands, who.workspaceId, Date.now(), {
      service: who.kind === "service",
    });
    await replaceDraft(ctx, row, commands, before, after);
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
    }),
  ),
  handler: async (ctx) => {
    const who = await principal(ctx),
      rows = await ctx.db
        .query("drafts")
        .withIndex("by_workspaceId_and_owner", (q) =>
          q.eq("workspaceId", who.workspaceId),
        )
        .take(1001);
    if (rows.length > 1000) throw new Error("Draft list limit exceeded");
    const result = [];
    for (const row of rows) {
      if (
        row.owner !== who.owner &&
        !(who.kind === "user" && row.owner.startsWith("service:"))
      )
        continue;
      const entries = await log(ctx, who.workspaceId, row.draftId),
        paths = entries.map((e) => e.command.path);
      const kinds: Record<string, number> = {};
      for (const path of paths) kinds[path] = (kinds[path] ?? 0) + 1;
      result.push({
        draftId: row.draftId,
        createdAt: new Date(row.createdAt).toISOString(),
        updatedAt: new Date(row.updatedAt).toISOString(),
        commandCount: row.commandCount,
        kinds,
        paths: [...new Set(paths)],
      });
    }
    return result;
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
    diff = preview(
      await loadGraph(ctx, who.workspaceId),
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
                JSON.stringify(record(change.base)[key]) !==
                  JSON.stringify(record(change.value)[key]),
            )
          : Object.keys(change.base).filter(
              (key) => key !== "revision" && key !== "updatedAt",
            );
        if (
          changedKeys.some(
            (key) =>
              JSON.stringify(record(current)[key]) !==
              JSON.stringify(record(change.base)[key]),
          )
        )
          throw new ConvexError("Draft conflicts with canonical changes");
      }
    }
    const before = await loadGraph(ctx, who.workspaceId),
      after = cloneGraph(before),
      results = execute(after, commands, who.workspaceId, Date.now(), {
        host: true,
      });
    const tablesWritten = await persist(ctx, who.workspaceId, before, after);
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
    const before = await loadGraph(ctx, who.workspaceId),
      after = cloneGraph(before);
    execute(after, next, who.workspaceId, row.createdAt, { host: true });
    await replaceDraft(ctx, row, next, before, after);
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
