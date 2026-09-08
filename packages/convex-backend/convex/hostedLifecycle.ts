import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { query, mutation, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireHostedMetadataPrincipal } from "./hostedMetadataGuard";
import { hostBatchState, cleanupItem, cleanupClaim } from "./lifecycleValues";
import { enqueueCleanup, secretResources } from "./cleanup";
import { localImportClaimKind, localImportState } from "./schema";
import { command, object } from "./values";

async function requireOwner(ctx: QueryCtx) {
  const identity = await requireHostedMetadataPrincipal(ctx);
  if (identity.principal.kind !== "user")
    throw new ConvexError("User permission required");
  return identity;
}
const batchIdentity = { operationId: v.string(), requestHash: v.string() };
const importIdentity = { operationId: v.string(), requestHash: v.string() };
const pagination = { paginationOpts: paginationOptsValidator };
const pageInfo = { isDone: v.boolean(), continueCursor: v.string() };

export const getHostBatch = query({
  args: batchIdentity,
  returns: v.union(hostBatchState, v.null()),
  handler: async (ctx, args): Promise<typeof hostBatchState.type | null> => {
    const identity = await requireHostedMetadataPrincipal(ctx);
    return ctx.runQuery(internal.host.getHostBatch, { ...args, ...identity });
  },
});

export const prepareHostBatch = mutation({
  args: {
    ...batchIdentity,
    commands: v.array(command),
    mode: v.union(v.literal("commit"), v.literal("draft")),
    draftId: v.optional(v.string()),
    stagedRefs: v.array(v.string()),
  },
  returns: hostBatchState,
  handler: async (ctx, args): Promise<typeof hostBatchState.type> => {
    const identity = await requireHostedMetadataPrincipal(ctx);
    return ctx.runMutation(internal.host.prepareHostBatch, {
      ...args,
      ...identity,
    });
  },
});

export const executeHostBatch = mutation({
  args: batchIdentity,
  returns: hostBatchState,
  handler: async (ctx, args): Promise<typeof hostBatchState.type> => {
    const identity = await requireHostedMetadataPrincipal(ctx);
    return ctx.runMutation(internal.host.executeHostBatch, {
      ...args,
      ...identity,
    });
  },
});

export const settleHostBatch = mutation({
  args: {
    ...batchIdentity,
    stagedRefs: v.array(v.string()),
    retryable: v.optional(v.boolean()),
  },
  returns: v.union(
    hostBatchState,
    v.object({ status: v.literal("conflict"), result: v.null() }),
  ),
  handler: async (
    ctx,
    args,
  ): Promise<
    typeof hostBatchState.type | { status: "conflict"; result: null }
  > => {
    const identity = await requireHostedMetadataPrincipal(ctx);
    return ctx.runMutation(internal.host.settleHostBatch, {
      ...args,
      ...identity,
    });
  },
});

export const beginLocalImport = mutation({
  args: {
    ...importIdentity,
    claimKind: v.optional(localImportClaimKind),
  },
  returns: localImportState,
  handler: async (ctx, args): Promise<typeof localImportState.type> => {
    const { workspaceId } = await requireOwner(ctx);
    return ctx.runMutation(internal.host.beginLocalImport, {
      ...args,
      workspaceId,
    });
  },
});

export const getLocalImport = query({
  args: importIdentity,
  returns: v.union(localImportState, v.null()),
  handler: async (ctx, args): Promise<typeof localImportState.type | null> => {
    const { workspaceId } = await requireOwner(ctx);
    return ctx.runQuery(internal.host.getLocalImport, { ...args, workspaceId });
  },
});

export const cancelLocalImport = mutation({
  args: importIdentity,
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const { workspaceId } = await requireOwner(ctx);
    return ctx.runMutation(internal.host.cancelLocalImport, {
      ...args,
      workspaceId,
    });
  },
});

export const commitImportedFrame = mutation({
  args: {
    ...importIdentity,
    expectedDataSourceRevision: v.number(),
    dataTableId: v.string(),
    dataSourceId: v.string(),
    expectedDataFrameId: v.union(v.string(), v.null()),
    frameRow: object,
    tableUpdate: object,
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const { workspaceId } = await requireOwner(ctx);
    return ctx.runMutation(internal.host.commitImportedFrame, {
      ...args,
      workspaceId,
    });
  },
});

export const listCleanup = query({
  args: pagination,
  returns: v.object({ page: v.array(cleanupItem), ...pageInfo }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    page: (typeof cleanupItem.type)[];
    isDone: boolean;
    continueCursor: string;
  }> => {
    const { workspaceId } = await requireOwner(ctx);
    return ctx.runQuery(internal.host.listCleanup, { ...args, workspaceId });
  },
});

export const claimCleanup = mutation({
  args: { cleanupId: v.string() },
  returns: v.union(cleanupClaim, v.null()),
  handler: async (ctx, args): Promise<typeof cleanupClaim.type | null> => {
    const { workspaceId } = await requireOwner(ctx);
    return ctx.runMutation(internal.host.claimCleanup, {
      ...args,
      workspaceId,
    });
  },
});

export const ackCleanup = mutation({
  args: { cleanupId: v.string(), claimToken: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const { workspaceId } = await requireOwner(ctx);
    return ctx.runMutation(internal.host.ackCleanup, { ...args, workspaceId });
  },
});

/** Owner-authorized host startup recovery. The host mints owner metadata even
 * when a verified service is the first caller. */
export const listRecoverableHostBatches = query({
  args: pagination,
  returns: v.object({
    page: v.array(v.object({ operationId: v.string() })),
    ...pageInfo,
  }),
  handler: async (ctx, args) => {
    const { workspaceId } = await requireOwner(ctx);
    const result = await ctx.db
      .query("hostBatches")
      .withIndex("by_workspaceId_and_status", (q) =>
        q.eq("workspaceId", workspaceId).eq("status", "pending"),
      )
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(100, args.paginationOpts.numItems),
      });
    return {
      page: result.page.map(({ operationId }) => ({ operationId })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/** Owner-authorized cancellation of stored pending work during fenced startup. */
export const recoverHostBatch = mutation({
  args: { operationId: v.string() },
  returns: v.union(
    v.literal("missing"),
    v.literal("cancelled"),
    v.literal("completed"),
  ),
  handler: async (ctx, args) => {
    const { workspaceId } = await requireOwner(ctx);
    const row = await ctx.db
      .query("hostBatches")
      .withIndex("by_workspaceId_and_operationId", (q) =>
        q.eq("workspaceId", workspaceId).eq("operationId", args.operationId),
      )
      .unique();
    if (!row) return "missing" as const;
    if (row.status !== "pending") return row.status;
    await enqueueCleanup(ctx, workspaceId, secretResources(row.stagedRefs));
    await ctx.db.patch(row._id, { status: "cancelled", result: null });
    return "cancelled" as const;
  },
});
