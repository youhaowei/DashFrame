import { paginationOptsValidator } from "convex/server";
import { v, type Infer } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";

const state = v.union(
  v.literal("awaiting-user-auth"),
  v.literal("exchanging"),
  v.literal("verifying"),
  v.literal("connected"),
  v.literal("failed"),
  v.literal("expired"),
);
const nullableString = v.union(v.string(), v.null());
const sessionRow = v.object({
  id: v.string(),
  connectorId: v.string(),
  requestedName: v.string(),
  state,
  stateNonceHash: v.string(),
  codeVerifier: v.string(),
  scopes: v.array(v.string()),
  dataSourceId: nullableString,
  failureCode: nullableString,
  failureMessage: nullableString,
  expiresAt: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
});
type Session = Infer<typeof sessionRow>;
const workspace = { workspaceId: v.string() };
const byId = { ...workspace, id: v.string() };
const optionalRow = v.union(sessionRow, v.null());

async function find(ctx: QueryCtx, workspaceId: string, id: string) {
  return ctx.db
    .query("connectorSetupSessions")
    .withIndex("by_workspaceId_and_id", (q) =>
      q.eq("workspaceId", workspaceId).eq("id", id),
    )
    .unique();
}

export const get = internalQuery({
  args: byId,
  returns: optionalRow,
  handler: async (ctx, args) =>
    ((await find(ctx, args.workspaceId, args.id))?.value as
      | Session
      | undefined) ?? null,
});

export const findByNonce = internalQuery({
  args: { ...workspace, stateNonceHash: v.string() },
  returns: optionalRow,
  handler: async (ctx, args) =>
    ((
      await ctx.db
        .query("connectorSetupSessions")
        .withIndex("by_workspaceId_and_stateNonceHash", (q) =>
          q
            .eq("workspaceId", args.workspaceId)
            .eq("stateNonceHash", args.stateNonceHash),
        )
        .unique()
    )?.value as Session | undefined) ?? null,
});

export const insert = internalMutation({
  args: { ...workspace, row: sessionRow },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (await find(ctx, args.workspaceId, args.row.id))
      throw new Error("Connector setup session already exists");
    const nonceOwner = await ctx.db
      .query("connectorSetupSessions")
      .withIndex("by_workspaceId_and_stateNonceHash", (q) =>
        q
          .eq("workspaceId", args.workspaceId)
          .eq("stateNonceHash", args.row.stateNonceHash),
      )
      .unique();
    if (nonceOwner) throw new Error("Connector setup state collision");
    await ctx.db.insert("connectorSetupSessions", {
      workspaceId: args.workspaceId,
      id: args.row.id,
      stateNonceHash: args.row.stateNonceHash,
      state: args.row.state,
      updatedAt: args.row.updatedAt,
      value: args.row,
    });
    return null;
  },
});

export const compareAndSwap = internalMutation({
  args: {
    ...byId,
    expected: v.object({
      state: v.optional(state),
      stateNonceHash: v.optional(v.string()),
      dataSourceId: v.optional(nullableString),
      updatedAt: v.optional(v.number()),
    }),
    patch: v.object({
      state: v.optional(state),
      stateNonceHash: v.optional(v.string()),
      codeVerifier: v.optional(v.string()),
      dataSourceId: v.optional(nullableString),
      failureCode: v.optional(nullableString),
      failureMessage: v.optional(nullableString),
      updatedAt: v.optional(v.number()),
    }),
  },
  returns: optionalRow,
  handler: async (ctx, args) => {
    const row = await find(ctx, args.workspaceId, args.id);
    if (!row) return null;
    const current = row.value as Session;
    for (const [field, expected] of Object.entries(args.expected)) {
      if (current[field as keyof Session] !== expected) return null;
    }
    const value = { ...current, ...args.patch };
    if (value.stateNonceHash !== current.stateNonceHash) {
      const owner = await ctx.db
        .query("connectorSetupSessions")
        .withIndex("by_workspaceId_and_stateNonceHash", (q) =>
          q
            .eq("workspaceId", args.workspaceId)
            .eq("stateNonceHash", value.stateNonceHash),
        )
        .unique();
      if (owner) throw new Error("Connector setup state collision");
    }
    await ctx.db.patch(row._id, {
      state: value.state,
      stateNonceHash: value.stateNonceHash,
      updatedAt: value.updatedAt,
      value,
    });
    return value;
  },
});

export const list = internalQuery({
  args: { ...workspace, paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(sessionRow),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(100, args.paginationOpts.numItems));
    // Session IDs are immutable, so deleting preceding pages cannot move this cursor.
    const rows = ctx.db
      .query("connectorSetupSessions")
      .withIndex("by_workspaceId_and_id", (q) => {
        const scoped = q.eq("workspaceId", args.workspaceId);
        return args.paginationOpts.cursor === null
          ? scoped
          : scoped.gt("id", args.paginationOpts.cursor);
      });
    const page = await rows.take(limit + 1);
    const visible = page.slice(0, limit);
    return {
      page: visible.map((row) => row.value as Session),
      continueCursor: visible.at(-1)?.id ?? "",
      isDone: page.length <= limit,
    };
  },
});

export const remove = internalMutation({
  args: { ...byId, updatedBefore: v.number() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await find(ctx, args.workspaceId, args.id);
    if (
      !row ||
      !["connected", "failed", "expired"].includes(row.state) ||
      row.updatedAt >= args.updatedBefore
    )
      return false;
    await ctx.db.delete(row._id);
    return true;
  },
});
