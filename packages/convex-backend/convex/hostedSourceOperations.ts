import { ConvexError, v } from "convex/values";
import { mutation, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireHostedMetadataPrincipal } from "./hostedMetadataGuard";
import { object } from "./values";
import {
  hostedSourceConfigValidator,
  parseHostedSourceConfig,
} from "./hostedSourceConfig";

async function requireOwner(ctx: QueryCtx) {
  const identity = await requireHostedMetadataPrincipal(ctx);
  if (identity.principal.kind !== "user")
    throw new ConvexError("User permission required");
  return identity.workspaceId;
}

export const replaceDataSourceConfig = mutation({
  args: {
    id: v.string(),
    expectedConfig: hostedSourceConfigValidator,
    expectedRevision: v.optional(v.number()),
    config: hostedSourceConfigValidator,
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const workspaceId = await requireOwner(ctx);
    return ctx.runMutation(internal.host.replaceDataSourceConfig, {
      ...args,
      config: parseHostedSourceConfig(args.config),
      expectedConfig: parseHostedSourceConfig(args.expectedConfig),
      workspaceId,
    });
  },
});

export const prepareRemoteDataTable = mutation({
  args: {
    id: v.string(),
    dataSourceId: v.string(),
    table: v.string(),
    fields: v.array(object),
  },
  returns: v.array(object),
  handler: async (ctx, args): Promise<(typeof object.type)[]> => {
    const workspaceId = await requireOwner(ctx);
    return ctx.runMutation(internal.host.prepareRemoteDataTable, {
      ...args,
      workspaceId,
    });
  },
});

export const removeDataFrame = mutation({
  args: { id: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const workspaceId = await requireOwner(ctx);
    return ctx.runMutation(internal.host.removeDataFrame, {
      ...args,
      workspaceId,
    });
  },
});

export const clearAllData = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    const workspaceId = await requireOwner(ctx);
    return ctx.runMutation(internal.host.clearAllData, { workspaceId });
  },
});
