import { ConvexError, v } from "convex/values";
import { paginationOptsValidator, type UserIdentity } from "convex/server";
import { mutation, query, type QueryCtx } from "./_generated/server";
import {
  hostedUserSubject,
  requireAdmittedWorkspace,
  requireHostedAuthority,
} from "./admissionGuard";
import { agentPermission, REVIEW_PERMISSIONS } from "./agentPermissions";

const MAX_CLIENT_KEY_LENGTH = 512;

const grantResult = v.object({
  grantId: v.string(),
  permissions: v.array(agentPermission),
});

const grantSummary = v.object({
  grantId: v.string(),
  clientKey: v.string(),
  permissions: v.array(agentPermission),
  createdAt: v.number(),
  revokedAt: v.union(v.number(), v.null()),
});

/**
 * The host signs a purpose-bound user token only after it has verified the
 * AuthKit access token and resolved the subject's admitted workspace.
 */
async function hostUser(
  ctx: QueryCtx,
  purpose: "host-agent-grants" | "host-credentials",
) {
  const identity: UserIdentity = requireHostedAuthority(
    await ctx.auth.getUserIdentity(),
    "host",
  );
  if (
    identity.purpose !== purpose ||
    identity.principalKind !== "user" ||
    typeof identity.workspaceId !== "string"
  )
    throw new ConvexError("Invalid agent grant authority");
  const subject = hostedUserSubject(identity);
  const admission = await requireAdmittedWorkspace(
    ctx,
    subject,
    identity.workspaceId,
  );
  return { subject, workspaceId: admission.workspaceId! };
}

function validateClientKey(clientKey: string) {
  if (
    !clientKey ||
    clientKey.length > MAX_CLIENT_KEY_LENGTH ||
    clientKey.trim() !== clientKey ||
    /[\s\p{Cc}]/u.test(clientKey)
  )
    throw new ConvexError("Invalid agent client");
}

function newGrantId() {
  // Convex seeds Math.random with strong randomness inside mutations. The
  // shape matches the credential IDs that credentialOwners already accepts.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (position) => {
    // oxlint-disable-next-line sonarjs/pseudo-random -- Convex seeds Math.random with strong randomness in mutations
    const value = Math.floor(Math.random() * 16);
    return (position === "x" ? value : (value & 3) | 8).toString(16);
  });
}

async function unusedGrantId(ctx: QueryCtx) {
  const grantId = newGrantId();
  const taken =
    (await ctx.db
      .query("credentialOwners")
      .withIndex("by_credentialId", (q) => q.eq("credentialId", grantId))
      .unique()) ??
    (await ctx.db
      .query("revokedCredentials")
      .withIndex("by_credentialId", (q) => q.eq("credentialId", grantId))
      .first());
  if (taken) throw new ConvexError("Agent grant allocation conflict; retry");
  return grantId;
}

/**
 * Find or create the caller's grant for one OAuth client. Revocation is final
 * here: a refreshed access token looks the same as a fresh consent, so
 * reconnecting a revoked client has to be an explicit owner action.
 */
export const ensureOAuthGrant = mutation({
  args: { clientKey: v.string() },
  returns: grantResult,
  handler: async (ctx, { clientKey }) => {
    const { subject, workspaceId } = await hostUser(ctx, "host-agent-grants");
    validateClientKey(clientKey);
    const existing = await ctx.db
      .query("agentGrants")
      .withIndex("by_subject_and_clientKey", (q) =>
        q.eq("subject", subject).eq("clientKey", clientKey),
      )
      .unique();
    if (existing) {
      if (existing.workspaceId !== workspaceId)
        throw new ConvexError("Agent grant workspace mismatch");
      if (existing.revokedAt !== undefined)
        throw new ConvexError("Agent grant revoked");
      return { grantId: existing.grantId, permissions: existing.permissions };
    }
    const grantId = await unusedGrantId(ctx);
    await ctx.db.insert("credentialOwners", {
      credentialId: grantId,
      subject,
      workspaceId,
    });
    await ctx.db.insert("agentGrants", {
      grantId,
      subject,
      workspaceId,
      clientKey,
      permissions: REVIEW_PERMISSIONS,
      createdAt: Date.now(),
    });
    return { grantId, permissions: REVIEW_PERMISSIONS };
  },
});

/** Commit the denial before anything else; later requests fail the service check. */
export const revokeGrant = mutation({
  args: { grantId: v.string() },
  returns: v.null(),
  handler: async (ctx, { grantId }) => {
    const { subject, workspaceId } = await hostUser(ctx, "host-credentials");
    const grant = await ctx.db
      .query("agentGrants")
      .withIndex("by_grantId", (q) => q.eq("grantId", grantId))
      .unique();
    if (
      !grant ||
      grant.subject !== subject ||
      grant.workspaceId !== workspaceId
    )
      throw new ConvexError("Agent grant ownership required");
    if (grant.revokedAt === undefined)
      await ctx.db.patch(grant._id, { revokedAt: Date.now() });
    const marker = await ctx.db
      .query("revokedCredentials")
      .withIndex("by_workspaceId_and_credentialId", (q) =>
        q.eq("workspaceId", workspaceId).eq("credentialId", grantId),
      )
      .unique();
    if (!marker)
      await ctx.db.insert("revokedCredentials", {
        workspaceId,
        credentialId: grantId,
      });
    return null;
  },
});

export const listGrants = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(grantSummary),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, { paginationOpts }) => {
    const { subject, workspaceId } = await hostUser(ctx, "host-credentials");
    // One admission owns each workspace, so every row here is the caller's.
    const result = await ctx.db
      .query("agentGrants")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspaceId))
      .paginate({
        ...paginationOpts,
        numItems: Math.min(100, paginationOpts.numItems),
      });
    return {
      page: result.page
        .filter((grant) => grant.subject === subject)
        .map((grant) => ({
          grantId: grant.grantId,
          clientKey: grant.clientKey,
          permissions: grant.permissions,
          createdAt: grant.createdAt,
          revokedAt: grant.revokedAt ?? null,
        })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/** True when an ID belongs to an agent grant, which named-credential admin must not touch. */
export async function isAgentGrantId(ctx: QueryCtx, id: string) {
  return (
    (await ctx.db
      .query("agentGrants")
      .withIndex("by_grantId", (q) => q.eq("grantId", id))
      .unique()) !== null
  );
}
