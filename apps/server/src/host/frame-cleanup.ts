import type { UUID } from "@dashframe/types";
import { z } from "zod";
import { requireUser, type HostContext } from "./context";

async function deleteBytes(ctx: HostContext, ids: readonly string[]) {
  for (const id of ids) {
    // Confirm the committed metadata decision before deleting. If Convex is
    // unavailable, retain bytes for the next reconciliation attempt.
    if (await ctx.metadata.getDataFrame(id)) continue;
    await ctx.dataPlaneRuntime?.unregisterTable?.(
      `df_${id.replaceAll("-", "_")}`,
    );
    await ctx.dataFrameStorage?.delete(id as UUID);
  }
}

export async function removeDataFrameEntry(
  ctx: HostContext,
  input: { id: string },
) {
  requireUser(ctx);
  const id = z.string().uuid().parse(input.id);
  await ctx.metadata.removeDataFrame(id);
  await deleteBytes(ctx, [id]);
  return { ok: true as const };
}

export async function clearAllData(ctx: HostContext) {
  requireUser(ctx);
  const frames = await ctx.metadata.listDataFrames();
  await ctx.metadata.clearAllData();
  await deleteBytes(
    ctx,
    frames.map((frame) => frame.id),
  );
  return { ok: true as const };
}
