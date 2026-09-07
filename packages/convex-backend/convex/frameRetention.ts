import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import {
  enqueueCleanup,
  resources,
  scanWorkspaceReferenceRows,
} from "./cleanup";
import { LIMIT } from "./graph";
import { isResourceReferenceScanCapError } from "./model";

type FrameDoc = Doc<"dataFrames">;
/** Newest first, by the refresh that produced the frame. */
export function byFreshness(a: FrameDoc, b: FrameDoc): number {
  return (
    (b.lastRefreshedAt ?? b.createdAt) - (a.lastRefreshedAt ?? a.createdAt)
  );
}
/**
 * Every frame one owner holds, through the owner's index. `null` when the
 * history is already over LIMIT: nothing can be pruned safely from a history
 * that cannot be read whole, and the write that asked must still commit. The
 * Data Frames recovery list is the way out of that state.
 */
export async function frameHistory(
  ctx: QueryCtx,
  workspaceId: string,
  owner: { insightId: string } | { definitionId: string },
): Promise<FrameDoc[] | null> {
  const rows = await (
    "insightId" in owner
      ? ctx.db
          .query("dataFrames")
          .withIndex("by_workspaceId_and_insightId", (q) =>
            q.eq("workspaceId", workspaceId).eq("insightId", owner.insightId),
          )
      : ctx.db
          .query("dataFrames")
          .withIndex("by_workspaceId_and_definitionId", (q) =>
            q
              .eq("workspaceId", workspaceId)
              .eq("definitionId", owner.definitionId),
          )
  ).take(LIMIT + 1);
  return rows.length > LIMIT ? null : rows;
}
/**
 * Prune a frame history down to the frames `keep` names plus anything another
 * artifact, an open draft, or a pending host batch still references. Pruned
 * frames leave the table and their blobs go to the cleanup outbox, which
 * re-checks references before reclaiming. If the reference scan hits its cap
 * nothing is pruned: a leak is recoverable, a lost live frame is not. Returns
 * the ids of the frames that remain.
 */
export async function pruneFrames(
  ctx: MutationCtx,
  workspaceId: string,
  rows: readonly FrameDoc[],
  keep: (frame: FrameDoc) => boolean,
): Promise<Set<string>> {
  const retained = new Set<string>(),
    candidates: FrameDoc[] = [];
  for (const frame of rows)
    if (keep(frame)) retained.add(frame.id);
    else candidates.push(frame);
  if (!candidates.length) return retained;
  let referenced: ReadonlySet<string>;
  try {
    referenced = await externallyReferencedFrameIds(
      ctx,
      workspaceId,
      candidates,
    );
  } catch (error) {
    if (!isResourceReferenceScanCapError(error)) throw error;
    for (const frame of candidates) retained.add(frame.id);
    return retained;
  }
  for (const frame of candidates) {
    if (referenced.has(frame.id)) {
      retained.add(frame.id);
      continue;
    }
    await enqueueCleanup(ctx, workspaceId, resources(frame).values());
    await ctx.db.delete(frame._id);
  }
  return retained;
}

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
  const add = (rows: unknown[]) => {
    for (const resource of resources(rows).values()) {
      if (resource.kind !== "frame") continue;
      for (const frameId of candidatesByResourceId.get(resource.resourceId) ??
        [])
        referenced.add(frameId);
    }
  };

  const scanned = await scanWorkspaceReferenceRows(
    ctx,
    workspaceId,
    (table, rows) =>
      table === "dataFrames"
        ? rows.map((row) => {
            if (!row || typeof row !== "object" || Array.isArray(row))
              return row;
            const object = row as Record<string, unknown>;
            return typeof object.id === "string" && candidateIds.has(object.id)
              ? { ...object, storage: undefined }
              : row;
          })
        : rows,
  );
  for (const { rows } of scanned) add(rows);
  return referenced;
}
