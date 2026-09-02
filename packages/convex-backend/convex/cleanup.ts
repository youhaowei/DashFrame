import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
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
// Finds secret references in stored rows so cleanup cannot reclaim live data.
// credentialRef appears only here because saveAssistantProviderConfig writes it
// directly to stored assistant provider configs, never through the command path.
const STORED_RESOURCE_CREDENTIAL_SLOTS = [
  "apiKey",
  "connectionString",
  "credentialRef",
] as const;
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
        STORED_RESOURCE_CREDENTIAL_SLOTS.some((slot) => slot === name) &&
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
export const WORKSPACE_REFERENCE_TABLES = [
  ...artifactTables,
  "draftChanges",
  "draftLog",
  "hostSettings",
  "connectorSetupSessions",
  "hostBatches",
] as const;
export type WorkspaceReferenceTable =
  (typeof WORKSPACE_REFERENCE_TABLES)[number];

export async function scanWorkspaceReferenceRows(
  ctx: QueryCtx,
  workspaceId: string,
  transform: (table: WorkspaceReferenceTable, rows: unknown[]) => unknown[] = (
    _table,
    rows,
  ) => rows,
) {
  const scanned: { table: WorkspaceReferenceTable; rows: unknown[] }[] = [];
  const add = (table: WorkspaceReferenceTable, rows: unknown[]) => {
    if (rows.length > 1000)
      throw new ConvexError(
        `resource reference scan cap exceeded for ${table}; cleanup outbox halted`,
      );
    scanned.push({ table, rows: transform(table, rows) });
  };
  for (const table of artifactTables)
    add(
      table,
      await ctx.db
        .query(table)
        .withIndex("by_workspaceId_and_id", (q) =>
          q.eq("workspaceId", workspaceId),
        )
        .take(1001),
    );
  add(
    "draftChanges",
    await ctx.db
      .query("draftChanges")
      .withIndex("by_workspaceId_and_draftId", (q) =>
        q.eq("workspaceId", workspaceId),
      )
      .take(1001),
  );
  add(
    "draftLog",
    await ctx.db
      .query("draftLog")
      .withIndex("by_workspaceId_and_draftId_and_sequence", (q) =>
        q.eq("workspaceId", workspaceId),
      )
      .take(1001),
  );
  add(
    "hostSettings",
    await ctx.db
      .query("hostSettings")
      .withIndex("by_workspaceId_and_kind_and_id", (q) =>
        q.eq("workspaceId", workspaceId),
      )
      .take(1001),
  );
  add(
    "connectorSetupSessions",
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
  add("hostBatches", pending);
  return scanned;
}

export async function referencedResources(ctx: QueryCtx, workspaceId: string) {
  const found = new Map<string, Resource>();
  const scanned = await scanWorkspaceReferenceRows(ctx, workspaceId);
  for (const { rows } of scanned)
    for (const [k, v] of resources(rows)) found.set(k, v);
  const pending = scanned.find(({ table }) => table === "hostBatches")?.rows;
  for (const batch of pending ?? []) {
    if (!batch || typeof batch !== "object" || Array.isArray(batch))
      throw new Error("Invalid pending host batch");
    const refs = (batch as Record<string, unknown>).stagedRefs;
    if (!Array.isArray(refs) || !refs.every((ref) => typeof ref === "string"))
      throw new Error("Invalid staged SecretRef list");
    for (const r of secretResources(refs)) found.set(key(r), r);
  }
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
