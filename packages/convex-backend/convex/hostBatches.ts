import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import {
  hostBatchIdentity,
  hostBatchState,
  principalOwner,
  hostPrincipal,
} from "./lifecycleValues";
import { command } from "./values";
import {
  assertResourcesWritable,
  enqueueCleanup,
  secretResources,
} from "./cleanup";
import { hostIdentity, runHostCommit, runHostDraft } from "./host";
const hostBatchSettlement = v.union(
  hostBatchState,
  v.object({ status: v.literal("conflict"), result: v.null() }),
);
type Identity = {
  workspaceId: string;
  operationId: string;
  principal: typeof hostPrincipal.type;
  requestHash: string;
};
function validateIdentity(args: Identity) {
  principalOwner(args.principal);
  if (
    !args.operationId ||
    args.operationId.length > 200 ||
    !/^[a-f0-9]{64}$/i.test(args.requestHash)
  )
    throw new Error("Invalid host batch identity");
}
async function lookup(ctx: QueryCtx, args: Identity, requireMatch = true) {
  validateIdentity(args);
  const row = await ctx.db
    .query("hostBatches")
    .withIndex("by_workspaceId_and_operationId", (q) =>
      q.eq("workspaceId", args.workspaceId).eq("operationId", args.operationId),
    )
    .unique();
  if (
    requireMatch &&
    row &&
    (row.owner !== principalOwner(args.principal) ||
      row.requestHash !== args.requestHash)
  )
    throw new Error("Host batch identity mismatch");
  return row;
}
function state(
  row: Pick<Doc<"hostBatches">, "status" | "result">,
): typeof hostBatchState.type {
  return { status: row.status, result: row.result };
}
function stagedOnly(value: unknown) {
  if (Array.isArray(value)) {
    value.forEach(stagedOnly);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (
      ["apiKey", "connectionString"].includes(key) &&
      child !== undefined &&
      child !== "" &&
      (typeof child !== "string" || !/^secret:[a-f0-9-]{36}$/i.test(child))
    )
      throw new Error("Host batch credentials must be staged SecretRefs");
    stagedOnly(child);
  }
}
export const getHostBatch = internalQuery({
  args: hostBatchIdentity,
  returns: v.union(hostBatchState, v.null()),
  handler: async (ctx, args) => {
    const row = await lookup(ctx, args);
    return row ? state(row) : null;
  },
});
export const prepareHostBatch = internalMutation({
  args: {
    ...hostBatchIdentity,
    commands: v.array(command),
    mode: v.union(v.literal("commit"), v.literal("draft")),
    draftId: v.optional(v.string()),
    stagedRefs: v.array(v.string()),
  },
  returns: hostBatchState,
  handler: async (ctx, args) => {
    validateIdentity(args);
    const refs = secretResources(args.stagedRefs);
    stagedOnly(args.commands);
    if (args.commands.length > 200)
      throw new Error("A batch is limited to 200 commands");
    const who = await hostIdentity(ctx, args.workspaceId, args.principal);
    if (args.mode === "commit" && who.kind !== "user")
      throw new Error("User permission required");
    const old = await lookup(ctx, args);
    if (old) {
      if (old.status === "pending" && (!old.commands || !old.mode)) {
        await assertResourcesWritable(ctx, args.workspaceId, [
          args.commands,
          ...refs.map((r) => ({ credentialRef: r.resourceId })),
        ]);
        await enqueueCleanup(
          ctx,
          args.workspaceId,
          secretResources(old.stagedRefs),
        );
        await ctx.db.patch(old._id, {
          commands: args.commands,
          mode: args.mode,
          draftId: args.draftId,
          stagedRefs: args.stagedRefs,
          result: null,
        });
        return { status: "pending" as const, result: null };
      }
      await enqueueCleanup(
        ctx,
        args.workspaceId,
        refs.filter((r) => !old.stagedRefs.includes(r.resourceId)),
      );
      return state(old);
    }
    await assertResourcesWritable(ctx, args.workspaceId, [
      args.commands,
      ...refs.map((r) => ({ credentialRef: r.resourceId })),
    ]);
    await ctx.db.insert("hostBatches", {
      ...args,
      owner: who.owner,
      status: "pending",
      result: null,
      createdAt: Date.now(),
    });
    return { status: "pending" as const, result: null };
  },
});
export const executeHostBatch = internalMutation({
  args: hostBatchIdentity,
  returns: hostBatchState,
  handler: async (ctx, args) => {
    const row = await lookup(ctx, args);
    if (!row) throw new Error("Host batch not prepared");
    if (row.status !== "pending") return state(row);
    await hostIdentity(ctx, args.workspaceId, args.principal);
    if (!row.commands || !row.mode)
      throw new Error("Host batch payload missing");
    const input = {
      workspaceId: args.workspaceId,
      principal: args.principal,
      commands: row.commands,
    };
    const result =
      row.mode === "commit"
        ? await runHostCommit(ctx, input)
        : await runHostDraft(ctx, {
            ...input,
            ...(row.draftId ? { draftId: row.draftId } : {}),
          });
    await ctx.db.patch(row._id, { status: "completed", result });
    await enqueueCleanup(
      ctx,
      args.workspaceId,
      secretResources(row.stagedRefs),
    );
    return { status: "completed" as const, result };
  },
});
export const settleHostBatch = internalMutation({
  args: {
    ...hostBatchIdentity,
    stagedRefs: v.array(v.string()),
    retryable: v.optional(v.boolean()),
  },
  returns: hostBatchSettlement,
  handler: async (ctx, args) => {
    const supplied = secretResources(args.stagedRefs),
      row = await lookup(ctx, args, false);
    if (
      row &&
      (row.owner !== principalOwner(args.principal) ||
        row.requestHash !== args.requestHash)
    ) {
      // A competing request already owns this ID. Retire only this caller's
      // staged refs, without exposing or changing the winner's state.
      await enqueueCleanup(ctx, args.workspaceId, supplied);
      return { status: "conflict" as const, result: null };
    }
    if (row) {
      await enqueueCleanup(ctx, args.workspaceId, supplied);
      if (row.status === "completed") return state(row);
      await enqueueCleanup(
        ctx,
        args.workspaceId,
        secretResources(row.stagedRefs),
      );
      if (args.retryable && row.status === "pending") {
        await ctx.db.patch(row._id, {
          commands: undefined,
          mode: undefined,
          draftId: undefined,
          stagedRefs: [],
        });
        return { status: "pending" as const, result: null };
      }
      if (row.status === "pending")
        await ctx.db.patch(row._id, { status: "cancelled", result: null });
      return { status: "cancelled" as const, result: null };
    }
    if (args.retryable) {
      await ctx.db.insert("hostBatches", {
        workspaceId: args.workspaceId,
        operationId: args.operationId,
        principal: args.principal,
        requestHash: args.requestHash,
        owner: principalOwner(args.principal),
        status: "pending",
        result: null,
        stagedRefs: [],
        createdAt: Date.now(),
      });
      await enqueueCleanup(ctx, args.workspaceId, supplied);
      return { status: "pending" as const, result: null };
    }
    await ctx.db.insert("hostBatches", {
      ...args,
      owner: principalOwner(args.principal),
      status: "cancelled",
      result: null,
      createdAt: Date.now(),
    });
    await enqueueCleanup(ctx, args.workspaceId, supplied);
    return { status: "cancelled" as const, result: null };
  },
});
export const listPendingHostBatches = internalQuery({
  args: { workspaceId: v.string(), paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(
      v.object({
        operationId: v.string(),
        principal: hostPrincipal,
        requestHash: v.string(),
        stagedRefs: v.array(v.string()),
      }),
    ),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("hostBatches")
      .withIndex("by_workspaceId_and_status", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("status", "pending"),
      )
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(100, args.paginationOpts.numItems),
      });
    return {
      page: page.page.map(
        ({ operationId, principal, requestHash, stagedRefs }) => ({
          operationId,
          principal,
          requestHash,
          stagedRefs,
        }),
      ),
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});
