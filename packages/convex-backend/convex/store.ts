import {
  assertResourcesWritable,
  enqueueRemovedResources,
  enqueueCleanup,
  resources,
} from "./cleanup";
import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { artifactTables, type ArtifactRow, type ArtifactTable } from "./model";
import { emptyGraph, changes, type Graph } from "./engine";
import { clean } from "./values";
export const LIMIT = 1000;
export type Principal = {
  workspaceId: string;
  owner: string;
  kind: "user" | "service";
};
export async function principal(ctx: QueryCtx): Promise<Principal> {
  const who = await ctx.auth.getUserIdentity();
  if (!who || typeof who.workspaceId !== "string")
    throw new ConvexError("Authentication required");
  const kind = who.principalKind;
  if (kind !== "user" && kind !== "service")
    throw new ConvexError("Invalid principal");
  const key = kind === "user" ? who.userId : who.credentialId;
  if (typeof key !== "string" || !key)
    throw new ConvexError("Invalid principal");
  if (kind === "service") {
    const revoked = await ctx.db
      .query("revokedCredentials")
      .withIndex("by_workspaceId_and_credentialId", (q) =>
        q.eq("workspaceId", who.workspaceId as string).eq("credentialId", key),
      )
      .unique();
    if (revoked) throw new ConvexError("Credential revoked");
  }
  return { workspaceId: who.workspaceId, owner: `${kind}:${key}`, kind };
}
export function user(who: Principal) {
  if (who.kind !== "user") throw new ConvexError("User permission required");
}
export async function find(
  ctx: QueryCtx,
  workspaceId: string,
  table: ArtifactTable,
  id: string,
) {
  return ctx.db
    .query(table)
    .withIndex("by_workspaceId_and_id", (q) =>
      q.eq("workspaceId", workspaceId).eq("id", id),
    )
    .unique();
}
export function rowValue(row: Doc<ArtifactTable>): ArtifactRow {
  const { _id, _creationTime, ...value } = row;
  return value;
}
export async function loadGraph(
  ctx: QueryCtx,
  workspaceId: string,
): Promise<Graph> {
  const graph = emptyGraph();
  for (const table of artifactTables) {
    const rows = await ctx.db
      .query(table)
      .withIndex("by_workspaceId_and_id", (q) =>
        q.eq("workspaceId", workspaceId),
      )
      .take(LIMIT + 1);
    if (rows.length > LIMIT)
      throw new ConvexError(
        table === "dataFrames"
          ? `Workspace exceeds ${LIMIT} dataFrames; use the Data Frames recovery list to delete rows`
          : `Workspace exceeds ${LIMIT} ${table}; pagination required`,
      );
    for (const row of rows) graph.get(table)!.set(row.id, rowValue(row));
  }
  return graph;
}
export async function persist(
  ctx: MutationCtx,
  workspaceId: string,
  before: Graph,
  after: Graph,
) {
  const diff = changes(before, after);
  await assertResourcesWritable(
    ctx,
    workspaceId,
    diff.map((change) => change.value),
  );
  await enqueueRemovedResources(
    ctx,
    workspaceId,
    diff.map((change) => change.base),
    diff.map((change) => change.value),
  );
  for (const change of diff) {
    const current = await find(ctx, workspaceId, change.table, change.id);
    if (change.value === null) {
      if (current) await ctx.db.delete(current._id);
    } else {
      const value = clean({
        ...change.value,
        workspaceId,
        revision: (current?.revision ?? 0) + 1,
        updatedAt: Date.now(),
      });
      if (current) await ctx.db.replace(current._id, value);
      else await ctx.db.insert(change.table, value);
    }
  }
  return [...new Set(diff.map((c) => c.table))];
}
export async function draft(
  ctx: QueryCtx,
  who: Principal,
  draftId: string,
  append = false,
) {
  const row = await ctx.db
    .query("drafts")
    .withIndex("by_workspaceId_and_draftId", (q) =>
      q.eq("workspaceId", who.workspaceId).eq("draftId", draftId),
    )
    .unique();
  if (
    !row ||
    (row.owner !== who.owner &&
      (append || who.kind !== "user" || !row.owner.startsWith("service:")))
  )
    throw new ConvexError("Draft unavailable");
  return row;
}
export async function log(ctx: QueryCtx, workspaceId: string, draftId: string) {
  const entries = await ctx.db
    .query("draftLog")
    .withIndex("by_workspaceId_and_draftId_and_sequence", (q) =>
      q.eq("workspaceId", workspaceId).eq("draftId", draftId),
    )
    .take(LIMIT + 1);
  if (entries.length > LIMIT)
    throw new ConvexError("Draft command limit exceeded");
  return entries;
}
export async function draftChanges(
  ctx: QueryCtx,
  workspaceId: string,
  draftId: string,
) {
  const rows = await ctx.db
    .query("draftChanges")
    .withIndex("by_workspaceId_and_draftId", (q) =>
      q.eq("workspaceId", workspaceId).eq("draftId", draftId),
    )
    .take(LIMIT + 1);
  if (rows.length > LIMIT) throw new ConvexError("Draft change limit exceeded");
  return rows;
}
export async function readGraph(
  ctx: QueryCtx,
  who: Principal,
  draftId?: string,
) {
  const graph = await loadGraph(ctx, who.workspaceId);
  if (draftId) {
    await draft(ctx, who, draftId);
    for (const c of await draftChanges(ctx, who.workspaceId, draftId)) {
      const table = c.table as ArtifactTable;
      if (!artifactTables.includes(table))
        throw new Error("Invalid draft table");
      if (c.value) graph.get(table)!.set(c.id, c.value);
      else graph.get(table)!.delete(c.id);
    }
  }
  return graph;
}
export async function eraseDraft(ctx: MutationCtx, row: Doc<"drafts">) {
  const entries = await log(ctx, row.workspaceId, row.draftId),
    pending = await draftChanges(ctx, row.workspaceId, row.draftId);
  await enqueueCleanup(
    ctx,
    row.workspaceId,
    resources([entries, pending]).values(),
  );
  for (const entry of entries) await ctx.db.delete(entry._id);
  for (const c of pending) await ctx.db.delete(c._id);
  await ctx.db.delete(row._id);
}
