import type {
  AccessCredentialRecord,
  AccessCredentials,
} from "@dashframe/server-core";
import type {
  AccessConnectionInfo,
  AccessCredential,
  IssuedAccessCredential,
} from "@dashframe/types";
import { text, uuid } from "@wystack/db";
import { mutation, query } from "@wystack/server";

interface AccessFunctionContext {
  accessCredentials?: AccessCredentials;
  serverEndpoint?: string;
}

function context(ctx: unknown): AccessFunctionContext {
  return ctx as AccessFunctionContext;
}

function requireAccessCredentials(ctx: unknown): AccessCredentials {
  const credentials = context(ctx).accessCredentials;
  if (!credentials) {
    throw new Error("Access credentials are unavailable in this host");
  }
  return credentials;
}

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

const getAccessConnectionInfo = query({
  args: {},
  handler: async (ctx): Promise<AccessConnectionInfo> => {
    requireAccessCredentials(ctx);
    const endpoint = context(ctx).serverEndpoint;
    if (!endpoint) throw new Error("Server endpoint is not ready");
    return {
      endpoint,
      transport: "dashframe-http",
      authentication: "Bearer",
    };
  },
});

const listAccessCredentials = query({
  args: {},
  handler: async (ctx): Promise<AccessCredential[]> => {
    const credentials = requireAccessCredentials(ctx);
    return (await credentials.list()).map(toDto);
  },
});

const issueAccessCredential = mutation({
  args: { name: text },
  handler: async (ctx, { name }): Promise<IssuedAccessCredential> => {
    const credentials = requireAccessCredentials(ctx);
    const issued = await credentials.issue(name);
    return {
      credential: toDto(issued.credential),
      accessCredential: issued.token,
    };
  },
});

const revokeAccessCredential = mutation({
  args: { id: uuid },
  handler: async (ctx, { id }): Promise<{ ok: true }> => {
    const credentials = requireAccessCredentials(ctx);
    await credentials.revoke(id);
    return { ok: true };
  },
});

export const accessCredentialFunctions = {
  getAccessConnectionInfo,
  listAccessCredentials,
  issueAccessCredential,
  revokeAccessCredential,
};
