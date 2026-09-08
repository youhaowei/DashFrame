import { ConvexError, v } from "convex/values";
import { mutation, type QueryCtx } from "./_generated/server";
import {
  hostedUserSubject,
  requireAdmittedWorkspace,
  requireHostedAuthority,
} from "./admissionGuard";

const ownership = v.object({
  credentialId: v.string(),
  subject: v.string(),
  workspaceId: v.string(),
});

async function owner(ctx: QueryCtx, credentialId: string) {
  const identity = requireHostedAuthority(
    await ctx.auth.getUserIdentity(),
    "host",
  );
  if (
    identity.purpose !== "host-credentials" ||
    identity.principalKind !== "user" ||
    typeof identity.workspaceId !== "string"
  )
    throw new ConvexError("Invalid credential administration authority");
  const subject = hostedUserSubject(identity);
  const admission = await requireAdmittedWorkspace(
    ctx,
    subject,
    identity.workspaceId,
  );
  // Named credentials use the host store's canonical randomUUID() identifiers.
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      credentialId,
    )
  )
    throw new ConvexError("Invalid credential ID");
  return { credentialId, subject, workspaceId: admission.workspaceId! };
}

function findOwner(ctx: QueryCtx, credentialId: string) {
  return ctx.db
    .query("credentialOwners")
    .withIndex("by_credentialId", (q) => q.eq("credentialId", credentialId))
    .unique();
}

function findRevocation(
  ctx: QueryCtx,
  workspaceId: string,
  credentialId: string,
) {
  return ctx.db
    .query("revokedCredentials")
    .withIndex("by_workspaceId_and_credentialId", (q) =>
      q.eq("workspaceId", workspaceId).eq("credentialId", credentialId),
    )
    .unique();
}

/** Persist host-issued ownership before the host exposes or accepts the token. */
export const register = mutation({
  args: { credentialId: v.string() },
  returns: ownership,
  handler: async (ctx, { credentialId }) => {
    const expected = await owner(ctx, credentialId);
    // The global indexed read participates in OCC: concurrent owners cannot
    // both bind the same opaque ID, even when their workspaces differ.
    const existing = await findOwner(ctx, credentialId);
    if (
      existing &&
      (existing.subject !== expected.subject ||
        existing.workspaceId !== expected.workspaceId)
    )
      throw new ConvexError("Credential ownership conflict");
    // Check even without an owner row: historical revocation markers must not
    // be bypassed by retrying registration. Ownership rows are never deleted.
    if (
      await ctx.db
        .query("revokedCredentials")
        .withIndex("by_credentialId", (q) => q.eq("credentialId", credentialId))
        .first()
    )
      throw new ConvexError("Credential revoked");
    if (!existing) await ctx.db.insert("credentialOwners", expected);
    return expected;
  },
});

/** Commit this denial before attempting host-store revocation. */
export const revoke = mutation({
  args: { credentialId: v.string() },
  returns: v.null(),
  handler: async (ctx, { credentialId }) => {
    const expected = await owner(ctx, credentialId);
    const existing = await findOwner(ctx, credentialId);
    if (
      !existing ||
      existing.subject !== expected.subject ||
      existing.workspaceId !== expected.workspaceId
    )
      throw new ConvexError("Credential ownership required");
    if (!(await findRevocation(ctx, expected.workspaceId, credentialId)))
      await ctx.db.insert("revokedCredentials", {
        workspaceId: expected.workspaceId,
        credentialId,
      });
    return null;
  },
});
