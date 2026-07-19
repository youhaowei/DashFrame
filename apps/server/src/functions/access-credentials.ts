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
import { mutation, query } from "@wystack/server";

interface AccessFunctionContext {
  accessCredentials?: ApiAccessCredentials;
  canManageApiAccess?: boolean;
  serverEndpoint?: string;
}

function context(ctx: unknown): AccessFunctionContext {
  return ctx as AccessFunctionContext;
}

function requireAccessCredentials(ctx: unknown): ApiAccessCredentials {
  const credentials = context(ctx).accessCredentials;
  if (!credentials) {
    throw new Error("Access credentials are unavailable in this host");
  }
  return credentials;
}

function requireManagementAccess(ctx: unknown): ApiAccessCredentials {
  if (!context(ctx).canManageApiAccess) {
    throw new Error("API access credential management is owner-only");
  }
  return requireAccessCredentials(ctx);
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

const getAccessCapabilities = query({
  args: {},
  handler: async (ctx): Promise<AccessCapabilities> => ({
    canManageCredentials: Boolean(
      context(ctx).accessCredentials && context(ctx).canManageApiAccess,
    ),
  }),
});

const listAccessCredentials = query({
  args: {},
  handler: async (ctx): Promise<AccessCredential[]> => {
    const credentials = requireManagementAccess(ctx);
    return (await credentials.list()).map(toDto);
  },
});

const issueAccessCredential = mutation({
  args: { name: text },
  handler: async (ctx, { name }): Promise<IssuedAccessCredential> => {
    const credentials = requireManagementAccess(ctx);
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
    const credentials = requireManagementAccess(ctx);
    await credentials.revoke(id);
    return { ok: true };
  },
});

export const accessCredentialFunctions = {
  getAccessCapabilities,
  getAccessConnectionInfo,
  listAccessCredentials,
  issueAccessCredential,
  revokeAccessCredential,
};
