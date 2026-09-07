import type { ApiAccessCredentials } from "@dashframe/server-core";
import type { Principal } from "@wystack/identity";
import type { SecretRef, SecretVault } from "@wystack/secret-vault";
import { createHash, timingSafeEqual, type BinaryLike } from "node:crypto";

import { isLoopbackHost } from "../bind-host";
import { readCookie, verifySession, type SessionClaims } from "./session";

function tokenMatches(actual: string, expected: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(actual).digest(),
    createHash("sha256").update(expected).digest(),
  );
}

/**
 * Browser-session credential the host will additionally accept.
 *
 * `principalFor` is the seam where the hosted identity model plugs in: this
 * module verifies that a cookie was signed by this host and has not expired,
 * and then asks the caller who that subject actually is. It deliberately does
 * not decide — a verified session is proof of authentication, never by itself
 * proof of what the session may reach.
 */
export interface HostSessionAuth {
  secret: BinaryLike;
  cookieName: string;
  principalFor(claims: SessionClaims): Principal | undefined;
  now?: () => number;
}

export function createHostAuthenticator(options: {
  hostname: string;
  authToken?: string;
  authRef?: SecretRef;
  vault?: SecretVault;
  accessCredentials?: ApiAccessCredentials;
  session?: HostSessionAuth;
}): (request: Request) => Promise<Principal> {
  if (options.authRef && !options.vault)
    throw new Error("Token vault is required");
  const protectedHost = Boolean(
    options.authRef || options.authToken || options.session,
  );
  if (!protectedHost && !isLoopbackHost(options.hostname)) {
    throw new Error("Non-loopback host requires authentication");
  }
  return async (request) => {
    if (!protectedHost) return { kind: "user", userId: "loopback-anonymous" };
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";
    if (token) {
      // A bearer token is an explicit claim of identity. If it is presented and
      // wrong, the request is rejected outright rather than silently falling
      // back to whatever cookie the same browser happens to carry — a fallback
      // would turn a revoked token into a still-working one.
      const primary = options.authRef
        ? await options.vault!.withSecret(options.authRef, async (expected) =>
            tokenMatches(token, expected),
          )
        : options.authToken
          ? tokenMatches(token, options.authToken)
          : false;
      if (primary) return { kind: "user", userId: "local-user" };
      const credentialId = await options.accessCredentials?.authenticate(token);
      if (credentialId) return { kind: "service", credentialId };
      throw new Error("Unauthorized");
    }
    const session = options.session;
    if (session) {
      const claims = verifySession(
        session.secret,
        readCookie(request.headers.get("cookie"), session.cookieName),
        session.now?.() ?? Date.now(),
      );
      const principal = claims && session.principalFor(claims);
      if (principal) return principal;
    }
    throw new Error("Unauthorized");
  };
}
