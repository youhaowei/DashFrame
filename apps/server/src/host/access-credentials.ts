import type { AccessCredentialRecord } from "@dashframe/server-core";
import type { AccessCredential } from "@dashframe/types";
import { z } from "zod";
import { requireLocalOperator, type HostContext } from "./context";

function toDto(record: AccessCredentialRecord): AccessCredential {
  return {
    id: record.id,
    name: record.name,
    tokenPrefix: record.tokenPrefix,
    createdAt: new Date(record.createdAt).getTime(),
    revokedAt: record.revokedAt
      ? new Date(record.revokedAt).getTime()
      : undefined,
  };
}

function credentials(ctx: HostContext) {
  requireLocalOperator(ctx);
  if (!ctx.accessCredentials)
    throw new Error("No secret key configured for named access credentials");
  return ctx.accessCredentials;
}

export async function getAccessCapabilities(ctx: HostContext) {
  return {
    canManageCredentials: Boolean(
      ctx.accessCredentials &&
      ctx.principal.kind === "user" &&
      ctx.principal.userId === "local-user",
    ),
  };
}

export async function getAccessConnectionInfo(ctx: HostContext) {
  credentials(ctx);
  const endpoint = ctx.getServerEndpoint();
  if (!endpoint) throw new Error("Server endpoint is not ready");
  return {
    endpoint,
    transport: "dashframe-http" as const,
    authentication: "Bearer" as const,
  };
}

export async function listAccessCredentials(ctx: HostContext) {
  return (await credentials(ctx).list()).map(toDto);
}

export async function issueAccessCredential(
  ctx: HostContext,
  input: { name: string },
) {
  const store = credentials(ctx);
  const { name } = z
    .object({ name: z.string().trim().min(1) })
    .strict()
    .parse(input);
  const issued = await store.issue(name);
  return {
    credential: toDto(issued.credential),
    accessCredential: issued.token,
  };
}

export async function revokeAccessCredential(
  ctx: HostContext,
  input: { id: string },
) {
  const store = credentials(ctx);
  const { id } = z.object({ id: z.string().uuid() }).strict().parse(input);
  // Revoke the native subscription identity before the host credential. A failed
  // second step is safe to retry; no issued JWT regains metadata access.
  await ctx.metadata.revokeCredential(id);
  if (!(await store.revoke(id))) throw new Error("Access credential not found");
  return { ok: true as const };
}
