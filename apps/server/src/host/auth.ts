import type { ApiAccessCredentials } from "@dashframe/server-core";
import type { Principal } from "@wystack/identity";
import type { SecretRef, SecretVault } from "@wystack/secret-vault";
import { createHash, timingSafeEqual } from "node:crypto";

import { isLoopbackHost } from "../bind-host";

function tokenMatches(actual: string, expected: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(actual).digest(),
    createHash("sha256").update(expected).digest(),
  );
}

export function createHostAuthenticator(options: {
  hostname: string;
  authToken?: string;
  authRef?: SecretRef;
  vault?: SecretVault;
  accessCredentials?: ApiAccessCredentials;
  insecure?: boolean;
}): (request: Request) => Promise<Principal> {
  if (options.authRef && !options.vault)
    throw new Error("Token vault is required");
  const protectedHost = Boolean(options.authRef || options.authToken);
  if (
    !protectedHost &&
    !isLoopbackHost(options.hostname) &&
    !options.insecure
  ) {
    throw new Error("Non-loopback host requires authentication");
  }
  return async (request) => {
    if (!protectedHost) return { kind: "user", userId: "loopback-anonymous" };
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";
    if (!token) throw new Error("Unauthorized");
    const primary = options.authRef
      ? await options.vault!.withSecret(options.authRef, async (expected) =>
          tokenMatches(token, expected),
        )
      : tokenMatches(token, options.authToken!);
    if (primary) return { kind: "user", userId: "local-user" };
    const credentialId = await options.accessCredentials?.authenticate(token);
    if (credentialId) return { kind: "service", credentialId };
    throw new Error("Unauthorized");
  };
}
