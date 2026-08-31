import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { artifactTables } from "./model";
import { cleanupClaim, cleanupItem, cleanupResource } from "./lifecycleValues";
export type Resource = typeof cleanupResource.type;
const secretPattern = /^secret:[0-9a-f-]{36}$/i;
const key = (r: Resource) => `${r.kind}:${r.resourceId}`;
/** Inspect resource slots, never arbitrary strings in names, rows, or chart text. */
export function resources(value: unknown): Map<string, Resource> {
  const found = new Map<string, Resource>();
  const add = (kind: Resource["kind"], resourceId: string) =>
    found.set(key({ kind, resourceId }), { kind, resourceId });
  function visit(value: unknown) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    const object = value as Record<string, unknown>;
    if (object.type === "file" && typeof object.key === "string")
      add("frame", object.key);
    for (const [name, child] of Object.entries(object)) {
      if (name === "dataFrameId" && typeof child === "string")
        add("frame", child);
      if (
        ["apiKey", "connectionString", "credentialRef"].includes(name) &&
        typeof child === "string" &&
        secretPattern.test(child)
      )
        add("secret", child);
      visit(child);
    }
  }
  visit(value);
  return found;
}
export function secretResources(refs: string[]): Resource[] {
  return [...new Set(refs)].map((resourceId) => {
    if (!secretPattern.test(resourceId))
      throw new Error("Invalid staged SecretRef");
    return { kind: "secret", resourceId };
  });
}
async function tombstone(ctx: QueryCtx, workspaceId: string, r: Resource) {
  return ctx.db
    .query("resourceTombstones")
    .withIndex("by_workspaceId_and_kind_and_resourceId", (q) =>
      q
        .eq("workspaceId", workspaceId)
        .eq("kind", r.kind)
        .eq("resourceId", r.resourceId),
    )
    .unique();
}
export async function assertResourcesWritable(
  ctx: QueryCtx,
  workspaceId: string,
  value: unknown,
) {
  for (const r of resources(value).values())
    if (await tombstone(ctx, workspaceId, r))
      throw new Error("Resource has been retired for cleanup");
}
export async function enqueueCleanup(
  ctx: MutationCtx,
  workspaceId: string,
  items: Iterable<Resource>,
) {
  for (const r of new Map([...items].map((r) => [key(r), r])).values()) {
    if (await tombstone(ctx, workspaceId, r)) continue;
    const existing = await ctx.db
      .query("cleanupJobs")
      .withIndex("by_workspaceId_and_kind_and_resourceId", (q) =>
        q
          .eq("workspaceId", workspaceId)
          .eq("kind", r.kind)
          .eq("resourceId", r.resourceId),
      )
      .unique();
    if (!existing)
      await ctx.db.insert("cleanupJobs", {
        workspaceId,
        ...r,
        cleanupId: crypto.randomUUID(),
        state: "pending",
        claimToken: null,
        createdAt: Date.now(),
      });
  }
}
export async function enqueueRemovedResources(
  ctx: MutationCtx,
  workspaceId: string,
  before: unknown,
  after: unknown,
) {
  const next = resources(after);
  await enqueueCleanup(
    ctx,
    workspaceId,
    [...resources(before)].filter(([k]) => !next.has(k)).map(([, r]) => r),
  );
}
async function referencedResources(ctx: QueryCtx, workspaceId: string) {
  const found = new Map<string, Resource>();
  const add = (rows: unknown[]) => {
    if (rows.length > 1000)
      throw new Error("Resource reference scan limit exceeded");
    for (const [k, v] of resources(rows)) found.set(k, v);
  };
  for (const table of artifactTables)
    add(
      await ctx.db
        .query(table)
        .withIndex("by_workspaceId_and_id", (q) =>
          q.eq("workspaceId", workspaceId),
        )
        .take(1001),
    );
  add(
    await ctx.db
      .query("draftChanges")
      .withIndex("by_workspaceId_and_draftId", (q) =>
        q.eq("workspaceId", workspaceId),
      )
      .take(1001),
  );
  add(
    await ctx.db
      .query("draftLog")
      .withIndex("by_workspaceId_and_draftId_and_sequence", (q) =>
        q.eq("workspaceId", workspaceId),
      )
      .take(1001),
  );
  add(
    await ctx.db
      .query("hostSettings")
      .withIndex("by_workspaceId_and_kind_and_id", (q) =>
        q.eq("workspaceId", workspaceId),
      )
      .take(1001),
  );
  add(
    await ctx.db
      .query("connectorSetupSessions")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspaceId))
      .take(1001),
  );
  const pending = await ctx.db
    .query("hostBatches")
    .withIndex("by_workspaceId_and_status", (q) =>
      q.eq("workspaceId", workspaceId).eq("status", "pending"),
    )
    .take(1001);
  add(pending);
  for (const batch of pending)
    for (const r of secretResources(batch.stagedRefs)) found.set(key(r), r);
  return found;
}
export const listCleanup = internalQuery({
  args: { workspaceId: v.string(), paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(cleanupItem),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("cleanupJobs")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(100, args.paginationOpts.numItems),
      });
    return {
      page: result.page.map(({ cleanupId, kind, resourceId }) => ({
        cleanupId,
        kind,
        resourceId,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});
export const claimCleanup = internalMutation({
  args: { workspaceId: v.string(), cleanupId: v.string() },
  returns: v.union(cleanupClaim, v.null()),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("cleanupJobs")
      .withIndex("by_workspaceId_and_cleanupId", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("cleanupId", args.cleanupId),
      )
      .unique();
    if (!row) return null;
    const { cleanupId, kind, resourceId } = row;
    if (row.state === "claimed")
      return { cleanupId, kind, resourceId, claimToken: row.claimToken! };
    if ((await referencedResources(ctx, args.workspaceId)).has(key(row)))
      return null;
    const claimToken = crypto.randomUUID();
    await ctx.db.insert("resourceTombstones", {
      workspaceId: args.workspaceId,
      kind,
      resourceId,
    });
    await ctx.db.patch(row._id, { state: "claimed", claimToken });
    return { cleanupId, kind, resourceId, claimToken };
  },
});
export const ackCleanup = internalMutation({
  args: {
    workspaceId: v.string(),
    cleanupId: v.string(),
    claimToken: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("cleanupJobs")
      .withIndex("by_workspaceId_and_cleanupId", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("cleanupId", args.cleanupId),
      )
      .unique();
    if (!row) return null;
    if (row.state !== "claimed" || row.claimToken !== args.claimToken)
      throw new Error("Cleanup claim mismatch");
    await ctx.db.delete(row._id);
    return null;
  },
});
