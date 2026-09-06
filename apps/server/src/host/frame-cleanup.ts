import { z } from "zod";
import { requireUser, type HostContext } from "./context";

export async function removeDataFrameEntry(
  ctx: HostContext,
  input: { id: string },
) {
  requireUser(ctx);
  const id = z.string().uuid().parse(input.id);
  await ctx.metadata.removeDataFrame(id);
  await ctx.cleanupResources?.();
  return { ok: true as const };
}

export async function clearAllData(ctx: HostContext) {
  requireUser(ctx);
  await ctx.metadata.clearAllData();
  await ctx.cleanupResources?.();
  return { ok: true as const };
}
