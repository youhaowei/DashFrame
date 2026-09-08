import { ConvexError } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import {
  hostedUserSubject,
  requireHostedAuthority,
  requireHostedPrincipalAdmission,
} from "./admissionGuard";
import type { hostPrincipal } from "./lifecycleValues";

/** Resolve only Convex-verified claims, with live admission reads in this transaction. */
export async function requireHostedMetadataPrincipal(ctx: QueryCtx) {
  const identity = requireHostedAuthority(
    await ctx.auth.getUserIdentity(),
    "host",
  );
  if (identity.purpose !== "host-metadata")
    throw new ConvexError("Host metadata purpose required");
  const workspaceId = identity.workspaceId;
  if (
    typeof workspaceId !== "string" ||
    !workspaceId ||
    workspaceId.trim() !== workspaceId
  )
    throw new ConvexError("Invalid hosted workspace");
  let principal: typeof hostPrincipal.type;
  if (identity.principalKind === "user") {
    principal = { kind: "user", userId: hostedUserSubject(identity) };
  } else if (identity.principalKind === "service") {
    const credentialId = identity.credentialId;
    if (
      typeof credentialId !== "string" ||
      !credentialId ||
      identity.subject !== `service:${credentialId}`
    )
      throw new ConvexError("Invalid hosted service identity");
    principal = { kind: "service", credentialId };
  } else {
    throw new ConvexError("Invalid hosted metadata principal");
  }
  await requireHostedPrincipalAdmission(ctx, principal, workspaceId);
  return { workspaceId, principal };
}
