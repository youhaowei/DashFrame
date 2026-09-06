import type { HostContext } from "./context";
import { HostBatchRejectedError } from "./commands";

/** Return false for an unknown outcome so the setup session remains recoverable. */
export async function persistVerifiedSource(
  ctx: HostContext,
  source: { id: string; type: string; name: string; apiKey: string },
): Promise<boolean> {
  if (!ctx.application)
    throw new Error("Connector setup app context is unavailable");
  try {
    await ctx.application.execute("createDataSource", source, {
      principal: ctx.principal,
      operationId: source.id,
    });
    return true;
  } catch (error) {
    // A committed source is authoritative even when the response was lost.
    try {
      const existing = await ctx.metadata.getDataSource(source.id);
      if (existing?.kind === source.type) return true;
    } catch {
      return false;
    }
    // Only a confirmed cancellation proves no delayed mutation can still commit.
    if (error instanceof HostBatchRejectedError) throw error;
    return false;
  }
}
