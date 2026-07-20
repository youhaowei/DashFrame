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
import type { CheckPermission } from "@wystack/server";
import { mutation, query } from "@wystack/server";

import { permission } from "../permissions";

export interface AccessCredentialFunctionDependencies {
  accessCredentials?: ApiAccessCredentials;
  getServerEndpoint: () => string | undefined;
  checkPermission: CheckPermission;
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

export function createAccessCredentialFunctions(
  dependencies: AccessCredentialFunctionDependencies,
) {
  const credentials = (): ApiAccessCredentials => {
    if (!dependencies.accessCredentials) {
      throw new Error("Access credentials are unavailable in this host");
    }
    return dependencies.accessCredentials;
  };

  const getAccessConnectionInfo = query({
    permission: permission.manageAccessCredentials,
    args: {},
    handler: async (): Promise<AccessConnectionInfo> => {
      credentials();
      const endpoint = dependencies.getServerEndpoint();
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
        dependencies.accessCredentials &&
        ctx.userId &&
        (await dependencies.checkPermission(
          ctx.userId,
          permission.manageAccessCredentials,
        )),
      ),
    }),
  });

  const listAccessCredentials = query({
    permission: permission.manageAccessCredentials,
    args: {},
    handler: async (): Promise<AccessCredential[]> =>
      (await credentials().list()).map(toDto),
  });

  const issueAccessCredential = mutation({
    permission: permission.manageAccessCredentials,
    args: { name: text },
    handler: async (_ctx, { name }): Promise<IssuedAccessCredential> => {
      const issued = await credentials().issue(name);
      return {
        credential: toDto(issued.credential),
        accessCredential: issued.token,
      };
    },
  });

  const revokeAccessCredential = mutation({
    permission: permission.manageAccessCredentials,
    args: { id: uuid },
    handler: async (_ctx, { id }): Promise<{ ok: true }> => {
      await credentials().revoke(id);
      return { ok: true };
    },
  });

  return {
    getAccessCapabilities,
    getAccessConnectionInfo,
    listAccessCredentials,
    issueAccessCredential,
    revokeAccessCredential,
  };
}
