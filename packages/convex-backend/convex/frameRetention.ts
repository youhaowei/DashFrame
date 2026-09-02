import type { QueryCtx } from "./_generated/server";
import { resources, scanWorkspaceReferenceRows } from "./cleanup";

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
