import { ConvexError } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import { resources } from "./cleanup";
import { artifactTables } from "./model";

const FRAME_REFERENCE_SCAN_LIMIT = 1000;

export async function externallyReferencedFrameIds(
  ctx: QueryCtx,
  workspaceId: string,
  candidates: readonly { id: string; storage?: unknown }[],
) {
  const referenced = new Set<string>();
  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  const candidatesByResourceId = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    const storage =
      candidate.storage &&
      typeof candidate.storage === "object" &&
      !Array.isArray(candidate.storage)
        ? (candidate.storage as Record<string, unknown>)
        : null;
    const resourceIds = [
      candidate.id,
      ...(storage?.type === "file" && typeof storage.key === "string"
        ? [storage.key]
        : []),
    ];
    for (const resourceId of resourceIds) {
      const frameIds = candidatesByResourceId.get(resourceId) ?? new Set();
      frameIds.add(candidate.id);
      candidatesByResourceId.set(resourceId, frameIds);
    }
  }
  const add = (table: string, rows: unknown[]) => {
    if (rows.length > FRAME_REFERENCE_SCAN_LIMIT)
      throw new ConvexError(`Frame reference scan limit exceeded for ${table}`);
    for (const resource of resources(rows).values()) {
      if (resource.kind !== "frame") continue;
      for (const frameId of candidatesByResourceId.get(resource.resourceId) ??
        [])
        referenced.add(frameId);
    }
  };

  for (const table of artifactTables) {
    const rows = await ctx.db
      .query(table)
      .withIndex("by_workspaceId_and_id", (q) =>
        q.eq("workspaceId", workspaceId),
      )
      .take(FRAME_REFERENCE_SCAN_LIMIT + 1);
    if (rows.length > FRAME_REFERENCE_SCAN_LIMIT)
      throw new ConvexError(`Frame reference scan limit exceeded for ${table}`);
    add(
      table,
      table === "dataFrames"
        ? rows.map((row) =>
            candidateIds.has(row.id) ? { ...row, storage: undefined } : row,
          )
        : rows,
    );
  }
  add(
    "draftChanges",
    await ctx.db
      .query("draftChanges")
      .withIndex("by_workspaceId_and_draftId", (q) =>
        q.eq("workspaceId", workspaceId),
      )
      .take(FRAME_REFERENCE_SCAN_LIMIT + 1),
  );
  add(
    "draftLog",
    await ctx.db
      .query("draftLog")
      .withIndex("by_workspaceId_and_draftId_and_sequence", (q) =>
        q.eq("workspaceId", workspaceId),
      )
      .take(FRAME_REFERENCE_SCAN_LIMIT + 1),
  );
  add(
    "hostSettings",
    await ctx.db
      .query("hostSettings")
      .withIndex("by_workspaceId_and_kind_and_id", (q) =>
        q.eq("workspaceId", workspaceId),
      )
      .take(FRAME_REFERENCE_SCAN_LIMIT + 1),
  );
  add(
    "connectorSetupSessions",
    await ctx.db
      .query("connectorSetupSessions")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspaceId))
      .take(FRAME_REFERENCE_SCAN_LIMIT + 1),
  );
  add(
    "hostBatches",
    await ctx.db
      .query("hostBatches")
      .withIndex("by_workspaceId_and_status", (q) =>
        q.eq("workspaceId", workspaceId).eq("status", "pending"),
      )
      .take(FRAME_REFERENCE_SCAN_LIMIT + 1),
  );
  return referenced;
}
