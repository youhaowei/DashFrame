import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireHostedMetadataPrincipal } from "./hostedMetadataGuard";
import { runHostCommit, runHostDraft } from "./hostCommands";
import { publicationMetadata } from "./publication";
import { command, json, object, typed } from "./values";
import type {
  DataSourceRow,
  DataTableRow,
  DataFrameRow,
  InsightRow,
} from "./model";

// Named wrappers are the public host allowlist. No body contains tenant or
// principal input. Nested native calls share this query/mutation transaction,
// so admission/credential revocation cannot race a separately authorized write.
export const getDataSource = query({
  args: { id: v.string() },
  returns: typed<DataSourceRow | null>(v.union(object, v.null())),
  handler: async (ctx, args): Promise<DataSourceRow | null> => {
    const { workspaceId } = await requireHostedMetadataPrincipal(ctx);
    return ctx.runQuery(internal.host.getDataSource, { ...args, workspaceId });
  },
});
export const getDataTable = query({
  args: { id: v.string() },
  returns: typed<DataTableRow | null>(v.union(object, v.null())),
  handler: async (ctx, args): Promise<DataTableRow | null> => {
    const { workspaceId } = await requireHostedMetadataPrincipal(ctx);
    return ctx.runQuery(internal.host.getDataTable, { ...args, workspaceId });
  },
});
export const getDataFrame = query({
  args: { id: v.string() },
  returns: typed<DataFrameRow | null>(v.union(object, v.null())),
  handler: async (ctx, args): Promise<DataFrameRow | null> => {
    const { workspaceId } = await requireHostedMetadataPrincipal(ctx);
    return ctx.runQuery(internal.host.getDataFrame, { ...args, workspaceId });
  },
});
export const getInsight = query({
  args: { id: v.string() },
  returns: typed<InsightRow | null>(v.union(object, v.null())),
  handler: async (ctx, args): Promise<InsightRow | null> => {
    const { workspaceId } = await requireHostedMetadataPrincipal(ctx);
    return ctx.runQuery(internal.host.getInsight, { ...args, workspaceId });
  },
});
export const listDataFramesByInsight = query({
  args: { insightId: v.string() },
  returns: typed<DataFrameRow[]>(v.array(object)),
  handler: async (ctx, args): Promise<DataFrameRow[]> => {
    const { workspaceId } = await requireHostedMetadataPrincipal(ctx);
    return ctx.runQuery(internal.host.listDataFramesByInsight, {
      ...args,
      workspaceId,
    });
  },
});
export const listDataFrames = query({
  args: {},
  returns: typed<DataFrameRow[]>(v.array(object)),
  handler: async (ctx): Promise<DataFrameRow[]> => {
    const { workspaceId } = await requireHostedMetadataPrincipal(ctx);
    return ctx.runQuery(internal.host.listDataFrames, { workspaceId });
  },
});
export const getOperation = query({
  args: { operationId: v.string() },
  returns: v.union(v.object({ request: json, result: json }), v.null()),
  handler: async (
    ctx,
    args,
  ): Promise<{
    request: typeof json.type;
    result: typeof json.type;
  } | null> => {
    const { workspaceId } = await requireHostedMetadataPrincipal(ctx);
    const result = await ctx.runQuery(internal.host.getOperation, {
      ...args,
      workspaceId,
    });
    return result ? { request: result.request!, result: result.result! } : null;
  },
});
export const publishMaterialization = mutation({
  args: { value: publicationMetadata },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const { workspaceId } = await requireHostedMetadataPrincipal(ctx);
    return ctx.runMutation(internal.host.publishMaterialization, {
      ...args,
      workspaceId,
    });
  },
});
export const commitBatch = mutation({
  args: { commands: v.array(command) },
  returns: v.object({
    mode: v.literal("commit"),
    commands: v.array(command),
    results: v.array(v.object({ id: v.optional(v.string()), value: json })),
    tablesWritten: v.array(v.string()),
  }),
  handler: async (ctx, args): ReturnType<typeof runHostCommit> => {
    const identity = await requireHostedMetadataPrincipal(ctx);
    return runHostCommit(ctx, { ...args, ...identity });
  },
});
export const draftBatch = mutation({
  args: { commands: v.array(command), draftId: v.optional(v.string()) },
  returns: v.object({
    draftId: v.string(),
    results: v.array(v.object({ id: v.optional(v.string()), value: json })),
  }),
  handler: async (ctx, args): ReturnType<typeof runHostDraft> => {
    const identity = await requireHostedMetadataPrincipal(ctx);
    return runHostDraft(ctx, { ...args, ...identity });
  },
});
