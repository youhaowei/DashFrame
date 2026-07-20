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
import type { Principal } from "@wystack/identity";
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

/**
 * `getAccessCapabilities` is intentionally unguarded, so it sees untrusted
 * context before WyStack's protected-function check. Identity currently
 * exports only the Principal type; mirror its required identifiers here so
 * this informational query also fails closed on malformed context.
 */
function isPrincipal(value: unknown): value is Principal {
  if (typeof value !== "object" || value === null) return false;
  if (!("kind" in value)) return false;
  if (value.kind === "user") {
    return (
      "userId" in value &&
      typeof value.userId === "string" &&
      value.userId.length > 0
    );
  }
  if (value.kind === "service") {
    return (
      "credentialId" in value &&
      typeof value.credentialId === "string" &&
      value.credentialId.length > 0
    );
  }
  return false;
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
    handler: async (ctx): Promise<AccessCapabilities> => {
      const principal = ctx.principal;
      return {
        canManageCredentials: Boolean(
          dependencies.accessCredentials &&
          isPrincipal(principal) &&
          (await dependencies.checkPermission(
            principal,
            permission.manageAccessCredentials,
          )) === true,
        ),
      };
    },
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
