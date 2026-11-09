import { ConvexError, v } from "convex/values";
import type { UserIdentity } from "convex/server";
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
 * Find or create the caller's grant for one OAuth client. A revoked grant is
 * reissued under a new grantId only for an access token minted after the
 * latest revocation. Tokens issued before it stay denied, even after reissue.
 */
export const ensureOAuthGrant = mutation({
  args: { clientKey: v.string(), issuedAt: v.number() },
  returns: grantResult,
  handler: async (ctx, { clientKey, issuedAt }) => {
    const { subject, workspaceId } = await hostUser(ctx, "host-agent-grants");
    validateClientKey(clientKey);
    if (!Number.isFinite(issuedAt) || issuedAt <= 0)
      throw new ConvexError("Invalid token issue time");
    const existing = await ctx.db
      .query("agentGrants")
      .withIndex("by_subject_and_clientKey", (q) =>
        q.eq("subject", subject).eq("clientKey", clientKey),
      )
      .unique();
    if (!existing) {
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
    }
    if (existing.workspaceId !== workspaceId)
      throw new ConvexError("Agent grant workspace mismatch");
    if (
      existing.notBefore !== undefined &&
      issuedAt * 1000 <= existing.notBefore
    )
      throw new ConvexError("Agent grant revoked");
    if (existing.revokedAt === undefined)
      return { grantId: existing.grantId, permissions: existing.permissions };
    // The old grantId keeps its revocation marker; reconnecting gets a new one.
    const grantId = await unusedGrantId(ctx);
    await ctx.db.insert("credentialOwners", {
      credentialId: grantId,
      subject,
      workspaceId,
    });
    await ctx.db.patch(existing._id, { grantId, revokedAt: undefined });
    return { grantId, permissions: existing.permissions };
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
    if (grant.revokedAt === undefined) {
      const revokedAt = Date.now();
      await ctx.db.patch(grant._id, { revokedAt, notBefore: revokedAt });
    }
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
  args: {},
  returns: v.array(grantSummary),
  handler: async (ctx) => {
    const { subject, workspaceId } = await hostUser(ctx, "host-credentials");
    const grants = await ctx.db
      .query("agentGrants")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspaceId))
      .take(256);
    return grants
      .filter((grant) => grant.subject === subject)
      .map((grant) => ({
        grantId: grant.grantId,
        clientKey: grant.clientKey,
        permissions: grant.permissions,
        createdAt: grant.createdAt,
        revokedAt: grant.revokedAt ?? null,
      }));
  },
});
