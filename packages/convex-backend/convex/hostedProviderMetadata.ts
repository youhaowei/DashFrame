import { ConvexError, v } from "convex/values";
import ipaddr from "ipaddr.js";
import { internal } from "./_generated/api";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireHostedMetadataPrincipal } from "./hostedMetadataGuard";

const provider = v.object({
  id: v.string(),
  providerId: v.string(),
  displayLabel: v.string(),
  authKind: v.union(
    v.literal("api-key"),
    v.literal("local"),
    v.literal("oauth"),
  ),
  baseUrl: v.union(v.string(), v.null()),
  credentialRef: v.union(v.string(), v.null()),
  defaultModel: v.string(),
  isDefault: v.boolean(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

async function requireUser(ctx: QueryCtx) {
  const identity = await requireHostedMetadataPrincipal(ctx);
  if (identity.principal.kind !== "user")
    throw new ConvexError("User permission required");
  return identity;
}

function isPrivateLiteralOrLocalhost(hostname: string): boolean {
  // Hosted-only literal floor: local providers remain available outside this
  // metadata path. DNS resolution and redirect targets need a future fetch-time
  // egress policy; this validator deliberately does not claim to cover them.
  let host = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  while (host.endsWith(".")) host = host.slice(0, -1);
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (!ipaddr.isValid(host)) return false;
  return ipaddr.process(host).range() !== "unicast";
}

function validateRow(row: typeof provider.type) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      row.id,
    )
  )
    throw new ConvexError("Invalid provider configuration ID");
  for (const [name, value] of [
    ["provider ID", row.providerId],
    ["display label", row.displayLabel],
    ["default model", row.defaultModel],
  ] as const)
    if (!value || value.trim() !== value)
      throw new ConvexError(`Invalid provider ${name}`);
  if (row.baseUrl !== null) {
    let baseUrl: URL;
    try {
      baseUrl = new URL(row.baseUrl);
    } catch {
      throw new ConvexError("Invalid provider base URL");
    }
    if (
      row.baseUrl.trim() !== row.baseUrl ||
      Array.from(row.baseUrl).some(
        (character) =>
          character.charCodeAt(0) <= 32 ||
          character.charCodeAt(0) === 127 ||
          character === "\\",
      ) ||
      (baseUrl.protocol !== "https:" && baseUrl.protocol !== "http:") ||
      baseUrl.username ||
      baseUrl.password ||
      baseUrl.search ||
      baseUrl.hash ||
      isPrivateLiteralOrLocalhost(baseUrl.hostname)
    )
      throw new ConvexError("Invalid provider base URL");
  }
  if (
    row.credentialRef !== null &&
    !/^secret:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      row.credentialRef,
    )
  )
    throw new ConvexError("Invalid provider credential reference");
  if (
    !Number.isFinite(row.createdAt) ||
    row.createdAt < 0 ||
    !Number.isFinite(row.updatedAt) ||
    row.updatedAt < row.createdAt
  )
    throw new ConvexError("Invalid provider timestamps");
}

export const list = query({
  args: {},
  returns: v.array(provider),
  handler: async (ctx): Promise<(typeof provider.type)[]> => {
    const { workspaceId } = await requireUser(ctx);
    return ctx.runQuery(internal.host.listAssistantProviderConfigs, {
      workspaceId,
    });
  },
});

export const get = query({
  args: { id: v.string() },
  returns: v.union(provider, v.null()),
  handler: async (ctx, { id }): Promise<typeof provider.type | null> => {
    const { workspaceId } = await requireUser(ctx);
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        id,
      )
    )
      throw new ConvexError("Invalid provider configuration ID");
    return ctx.runQuery(internal.host.getAssistantProviderConfig, {
      workspaceId,
      id,
    });
  },
});

export const save = mutation({
  args: { row: provider, expected: v.union(provider, v.null()) },
  returns: provider,
  handler: async (ctx, args): Promise<typeof provider.type> => {
    const { workspaceId } = await requireUser(ctx);
    validateRow(args.row);
    if (args.expected) validateRow(args.expected);
    return ctx.runMutation(internal.host.saveAssistantProviderConfig, {
      workspaceId,
      ...args,
    });
  },
});

export const remove = mutation({
  args: { id: v.string(), expected: provider },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const { workspaceId } = await requireUser(ctx);
    validateRow(args.expected);
    if (args.id !== args.expected.id)
      throw new ConvexError("Provider configuration identity mismatch");
    return ctx.runMutation(internal.host.removeAssistantProviderConfig, {
      workspaceId,
      ...args,
    });
  },
});
