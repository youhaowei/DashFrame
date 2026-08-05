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
    throw new Error(
      "No secret key configured — set DASHFRAME_SECRET_KEY_FILE or " +
        "DASHFRAME_SECRET_KEY to enable named access credentials.",
    );
  }
  return ctx.accessCredentials;
}

// Authorization runs before the capability check: `.authorize` gates on the
// caller's principal first, and only an authorized caller learns whether
// this server has key material configured. Reversing this order (capability
// check ahead of `.authorize`) would let an unauthenticated caller
// distinguish "no secret key configured" from "unauthorized" and, on a
// --token-protected server with no key configured, would turn an
// unauthenticated request into a 500 with the operator-facing config message
// instead of a 401/403.
const configuredAccessCredentialProcedure = wy.procedure
  .authorize(permissions.accessCredentials.manage)
  .use(async ({ ctx, next }) => {
    credentials(ctx);
    return next();
  });

const getAccessConnectionInfo = configuredAccessCredentialProcedure
  .input({})
  .query(async (ctx): Promise<AccessConnectionInfo> => {
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

const listAccessCredentials = configuredAccessCredentialProcedure
  .input({})
  .query(
    async (ctx): Promise<AccessCredential[]> =>
      (await credentials(ctx).list()).map(toDto),
  );

const issueAccessCredential = configuredAccessCredentialProcedure
  .input({ name: text })
  .mutation(async (ctx, { name }): Promise<IssuedAccessCredential> => {
    const issued = await credentials(ctx).issue(name);
    return {
      credential: toDto(issued.credential),
      accessCredential: issued.token,
    };
  });

const revokeAccessCredential = configuredAccessCredentialProcedure
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
