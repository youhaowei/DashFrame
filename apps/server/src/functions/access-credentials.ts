import type {
  AccessCredentialRecord,
  ApiAccessCredentials,
} from "@dashframe/server-core";
import type {
  AccessCapabilities,
  AccessConnectionInfo,
  AccessCredential,
  IssuedAccessCredential,
} from "@dashframe/types";
import { text, uuid } from "@wystack/db";

import type { DashframeFunctionContext } from "../app-context";
import { permissions } from "../permissions";
import { wy } from "../wystack";

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

function credentials(ctx: DashframeFunctionContext): ApiAccessCredentials {
  if (!ctx.accessCredentials) {
    throw new Error("Access credentials are unavailable in this host");
  }
  return ctx.accessCredentials;
}

const getAccessConnectionInfo = wy.procedure
  .authorize(permissions.accessCredentials.manage)
  .input({})
  .query(async (ctx): Promise<AccessConnectionInfo> => {
    credentials(ctx);
    const endpoint = ctx.getServerEndpoint();
    if (!endpoint) throw new Error("Server endpoint is not ready");
    return {
      endpoint,
      transport: "dashframe-http",
      authentication: "Bearer",
    };
  });

const getAccessCapabilities = wy.procedure
  .input({})
  .query(async (ctx): Promise<AccessCapabilities> => {
    return {
      canManageCredentials: Boolean(
        ctx.accessCredentials &&
        (await ctx.can(permissions.accessCredentials.manage)),
      ),
    };
  });

const listAccessCredentials = wy.procedure
  .authorize(permissions.accessCredentials.manage)
  .input({})
  .query(
    async (ctx): Promise<AccessCredential[]> =>
      (await credentials(ctx).list()).map(toDto),
  );

const issueAccessCredential = wy.procedure
  .authorize(permissions.accessCredentials.manage)
  .input({ name: text })
  .mutation(async (ctx, { name }): Promise<IssuedAccessCredential> => {
    const issued = await credentials(ctx).issue(name);
    return {
      credential: toDto(issued.credential),
      accessCredential: issued.token,
    };
  });

const revokeAccessCredential = wy.procedure
  .authorize(permissions.accessCredentials.manage)
  .input({ id: uuid })
  .mutation(async (ctx, { id }): Promise<{ ok: true }> => {
    await credentials(ctx).revoke(id);
    return { ok: true };
  });

export const accessCredentialFunctions = {
  getAccessCapabilities,
  getAccessConnectionInfo,
  listAccessCredentials,
  issueAccessCredential,
  revokeAccessCredential,
};
