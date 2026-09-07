import type { UserIdentity } from "convex/server";
import { ConvexError } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import { hostedTrust } from "./admissionConfig";

export type HostedAuthority = "browser" | "service" | "host" | "operator";

/** Identity comes from Convex's JWT verifier, never request arguments. */
export function requireHostedAuthority(
  identity: UserIdentity | null,
  authority: HostedAuthority,
) {
  const trust = hostedTrust();
  const expectedIssuer =
    authority === "operator" ? trust.operatorIssuer : trust.runtimeIssuer;
  if (
    !identity ||
    identity.issuer !== expectedIssuer ||
    identity.authority !== authority ||
    !identity.subject
  )
    throw new ConvexError("Invalid hosted authority");
  return identity;
}

export function hostedUserSubject(identity: UserIdentity): string {
  const subject = identity.userId;
  if (
    typeof subject !== "string" ||
    !subject ||
    identity.subject !== `user:${subject}`
  )
    throw new ConvexError("Invalid hosted user identity");
  return subject;
}

export async function admissionForSubject(ctx: QueryCtx, subject: string) {
  return ctx.db
    .query("admissions")
    .withIndex("by_subject", (q) => q.eq("subject", subject))
    .unique();
}

/** Shared by application principals and future authenticated host-native wrappers. */
export async function requireAdmittedWorkspace(
  ctx: QueryCtx,
  subject: string,
  workspaceId: string,
) {
  const admission = await admissionForSubject(ctx, subject);
  if (
    !admission ||
    admission.status !== "admitted" ||
    !admission.workspaceId ||
    admission.workspaceId !== workspaceId
  )
    throw new ConvexError("Workspace admission required");
  return admission;
}

/** Call only after verifying the host/browser/service authority and its principal. */
export async function requireHostedPrincipalAdmission(
  ctx: QueryCtx,
  principal:
    | { kind: "user"; userId: string }
    | { kind: "service"; credentialId: string },
  workspaceId: string,
) {
  if (principal.kind === "user") {
    await requireAdmittedWorkspace(ctx, principal.userId, workspaceId);
    return;
  }
  const owner = await ctx.db
    .query("credentialOwners")
    .withIndex("by_credentialId", (q) =>
      q.eq("credentialId", principal.credentialId),
    )
    .unique();
  if (!owner || owner.workspaceId !== workspaceId)
    throw new ConvexError("Credential ownership required");
  await requireAdmittedWorkspace(ctx, owner.subject, workspaceId);
  const revoked = await ctx.db
    .query("revokedCredentials")
    .withIndex("by_workspaceId_and_credentialId", (q) =>
      q
        .eq("workspaceId", workspaceId)
        .eq("credentialId", principal.credentialId),
    )
    .unique();
  if (revoked) throw new ConvexError("Credential revoked");
}
