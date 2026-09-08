import { WorkOS } from "@workos-inc/node";
import { IdentityProviderUnavailableError } from "@wystack/identity";
import { createWorkOSSessionProvider } from "@wystack/identity-workos";
import { sealData, unsealData } from "iron-session";

const PKCE_COOKIE = "__Host-dashframe-workos-pkce";
const SESSION_COOKIE = "__Host-dashframe-workos-session";
const PKCE_TTL_SECONDS = 10 * 60;

type VerifiedIdentity = { identity: { subject: string }; expiresAt: number };

export type HostedBrowserSession =
  | ({ status: "authenticated"; setCookie?: string } & VerifiedIdentity)
  | { status: "signedout"; setCookie?: string }
  | { status: "unavailable" };

interface PkceState {
  state: string;
  codeVerifier: string;
  expiresAt: number;
}

interface AuthenticationResult {
  accessToken: string;
  sealedSession?: string;
}

interface AuthenticatedSessionResult {
  authenticated: true;
  accessToken: string;
}

interface FailedSessionResult {
  authenticated: false;
}

interface RefreshSuccessResult {
  authenticated: true;
  sealedSession?: string;
  session?: { accessToken: string };
}

interface RefreshFailureResult {
  authenticated: false;
  retryable: boolean;
}

interface LoadedSession {
  authenticate(): Promise<AuthenticatedSessionResult | FailedSessionResult>;
  refresh(options: {
    cookiePassword: string;
  }): Promise<RefreshSuccessResult | RefreshFailureResult>;
}

export interface HostedWorkOSSdk {
  getAuthorizationUrlWithPKCE(options: {
    clientId: string;
    provider: "authkit";
    redirectUri: string;
  }): Promise<{ url: string; state: string; codeVerifier: string }>;
  authenticateWithCode(options: {
    clientId: string;
    code: string;
    codeVerifier: string;
    session: { sealSession: true; cookiePassword: string };
  }): Promise<AuthenticationResult>;
  loadSealedSession(options: {
    sessionData: string;
    cookiePassword: string;
  }): LoadedSession;
}

export interface HostedWorkOSVerifier {
  verify(accessToken: string): Promise<VerifiedIdentity | null>;
}

export interface HostedWorkOSSessionOptions {
  clientId: string;
  issuer: string;
  apiKey: string;
  cookiePassword: string;
  /** Exact external HTTPS origin, without a path, query or fragment. */
  publicOrigin: string;
}

export interface HostedWorkOSSessionDependencies {
  sdk: HostedWorkOSSdk;
  verifier: HostedWorkOSVerifier;
}

/**
 * Owns browser login cookies and WorkOS session rotation. Workspace admission
 * remains a separate server-side decision after `resolve` returns an identity.
 * Logout clears only this application's cookie; it does not revoke the shared
 * WorkOS session used by Lumony or other applications.
 */
export function createHostedWorkOSSession(
  supplied: HostedWorkOSSessionOptions,
  dependencies?: HostedWorkOSSessionDependencies,
) {
  const options = validateOptions(supplied);
  const callbackUrl = `${options.publicOrigin}/auth/callback`;
  const rootUrl = `${options.publicOrigin}/`;
  const { sdk, verifier } = dependencies ?? productionDependencies(options);

  return {
    async login(): Promise<Response> {
      const authorization = await sdk.getAuthorizationUrlWithPKCE({
        clientId: options.clientId,
        provider: "authkit",
        redirectUri: callbackUrl,
      });
      const now = Date.now();
      const pkce = await sealData(
        {
          state: identifier(authorization.state, "WorkOS state"),
          codeVerifier: identifier(
            authorization.codeVerifier,
            "WorkOS code verifier",
          ),
          expiresAt: now + PKCE_TTL_SECONDS * 1000,
        } satisfies PkceState,
        { password: options.cookiePassword, ttl: PKCE_TTL_SECONDS },
      );
      return redirect(authorization.url, pkceCookie(pkce));
    },

    async callback(request: Request): Promise<Response> {
      const clearPkce = clearCookie(PKCE_COOKIE);
      const url = new URL(request.url);
      if (request.method !== "GET" || url.pathname !== "/auth/callback")
        return plain(400, "Invalid authentication callback", clearPkce);
      const state = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      const sealedPkce = readCookie(request, PKCE_COOKIE);
      const pkce = sealedPkce
        ? await unsealData<Partial<PkceState>>(sealedPkce, {
            password: options.cookiePassword,
            ttl: PKCE_TTL_SECONDS,
          })
        : {};
      if (
        !state ||
        !code ||
        typeof pkce.state !== "string" ||
        typeof pkce.codeVerifier !== "string" ||
        typeof pkce.expiresAt !== "number" ||
        !Number.isFinite(pkce.expiresAt) ||
        pkce.expiresAt <= Date.now() ||
        !constantTimeEqual(state, pkce.state)
      )
        return plain(400, "Invalid authentication callback", clearPkce);

      try {
        const authenticated = await sdk.authenticateWithCode({
          clientId: options.clientId,
          code,
          codeVerifier: pkce.codeVerifier,
          session: {
            sealSession: true,
            cookiePassword: options.cookiePassword,
          },
        });
        const verified = await verifier.verify(authenticated.accessToken);
        if (!verified || !authenticated.sealedSession)
          return plain(401, "Authentication failed", clearPkce);
        return redirect(rootUrl, [
          clearPkce,
          sessionCookie(authenticated.sealedSession),
        ]);
      } catch (error) {
        return plain(
          error instanceof IdentityProviderUnavailableError ? 503 : 502,
          "Authentication provider unavailable",
          clearPkce,
        );
      }
    },

    async resolve(request: Request): Promise<HostedBrowserSession> {
      const sealed = readCookie(request, SESSION_COOKIE);
      if (!sealed) return { status: "signedout" };
      let session: LoadedSession;
      try {
        session = sdk.loadSealedSession({
          sessionData: sealed,
          cookiePassword: options.cookiePassword,
        });
        const authenticated = await session.authenticate();
        if (authenticated.authenticated)
          return verifiedResolution(
            await verifier.verify(authenticated.accessToken),
          );
        const refreshed = await session.refresh({
          cookiePassword: options.cookiePassword,
        });
        if (!refreshed.authenticated) {
          if (refreshed.retryable) return { status: "unavailable" };
          return signedOutAndClear();
        }
        const accessToken = refreshed.session?.accessToken;
        if (!accessToken || !refreshed.sealedSession)
          return { status: "unavailable" };
        const verified = await verifier.verify(accessToken);
        if (!verified) return signedOutAndClear();
        return {
          status: "authenticated",
          ...verified,
          setCookie: sessionCookie(refreshed.sealedSession),
        };
      } catch {
        return { status: "unavailable" };
      }
    },

    logout(request: Request): Response {
      if (
        request.method !== "POST" ||
        request.headers.get("origin") !== options.publicOrigin
      )
        return plain(403, "Invalid logout origin");
      return plain(204, "", clearCookie(SESSION_COOKIE));
    },
  };
}

function productionDependencies(
  options: HostedWorkOSSessionOptions,
): HostedWorkOSSessionDependencies {
  const workos = new WorkOS(options.apiKey, { clientId: options.clientId });
  const provider = createWorkOSSessionProvider({
    clientId: options.clientId,
    issuer: options.issuer,
  });
  return {
    sdk: workos.userManagement,
    verifier: {
      async verify(accessToken) {
        const session = await provider.getSession(
          new Request("https://workos-token.invalid/", {
            headers: { authorization: `Bearer ${accessToken}` },
          }),
        );
        if (!session) return null;
        const subject = session.identity.subject;
        const expiresAt = session.expiresAt?.getTime();
        if (
          typeof subject !== "string" ||
          !subject ||
          subject.trim() !== subject ||
          typeof expiresAt !== "number" ||
          !Number.isFinite(expiresAt)
        )
          return null;
        return {
          identity: { subject },
          expiresAt,
        };
      },
    },
  };
}

function validateOptions(
  options: HostedWorkOSSessionOptions,
): HostedWorkOSSessionOptions {
  const clientId = identifier(options.clientId, "WorkOS client ID");
  const issuer = secureUrl(options.issuer, "WorkOS issuer", false);
  const apiKey = identifier(options.apiKey, "WorkOS API key");
  if (
    typeof options.cookiePassword !== "string" ||
    options.cookiePassword.length < 32 ||
    options.cookiePassword.trim() !== options.cookiePassword
  )
    throw new Error("WorkOS cookie password must be at least 32 characters");
  const publicOrigin = secureUrl(options.publicOrigin, "public origin", true);
  return {
    clientId,
    issuer,
    apiKey,
    cookiePassword: options.cookiePassword,
    publicOrigin,
  };
}

function secureUrl(value: unknown, name: string, originOnly: boolean): string {
  if (typeof value !== "string" || !value || value.trim() !== value)
    throw new Error(`Invalid ${name}`);
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (originOnly && value !== url.origin)
    )
      throw new Error();
  } catch {
    throw new Error(`Invalid ${name}`);
  }
  return value;
}

function identifier(value: unknown, name: string): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.trim() !== value ||
    /\p{Cc}/u.test(value)
  )
    throw new Error(`Invalid ${name}`);
  return value;
}

function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function verifiedResolution(
  verified: VerifiedIdentity | null,
): HostedBrowserSession {
  return verified
    ? { status: "authenticated", ...verified }
    : signedOutAndClear();
}

function signedOutAndClear(): HostedBrowserSession {
  return { status: "signedout", setCookie: clearCookie(SESSION_COOKIE) };
}

function pkceCookie(value: string): string {
  return `${PKCE_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${PKCE_TTL_SECONDS}`;
}

function sessionCookie(value: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function clearCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

function redirect(location: string, cookies: string | string[]): Response {
  const headers = new Headers({ location, "cache-control": "no-store" });
  for (const cookie of typeof cookies === "string" ? [cookies] : cookies)
    headers.append("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
}

function plain(status: number, message: string, cookie?: string): Response {
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "text/plain; charset=utf-8",
  });
  if (cookie) headers.append("set-cookie", cookie);
  return new Response(status === 204 ? null : message, { status, headers });
}
