import type { GoogleOAuthTokenBundle } from "@dashframe/connector-ga4";
import { createHash } from "node:crypto";

import { isLoopbackHost } from "../bind-host";
import { getConnectorCatalogEntries } from "../functions/connector-catalog";

export interface OAuthAuthorizeInput {
  redirectUri: string;
  state: string;
  codeVerifier: string;
}

export interface OAuthExchangeInput extends OAuthAuthorizeInput {
  code: string;
}

export interface OAuthConnectorDescriptor {
  id: string;
  authKind: "oauth";
  scopes: string[];
  buildAuthorizeUrl(input: OAuthAuthorizeInput): string;
  exchangeCode(input: OAuthExchangeInput): Promise<string>;
}

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectBase?: string;
  fetch?: typeof fetch;
  now?: () => number;
}

export class OAuthExchangeError extends Error {
  constructor(
    readonly code: string,
    readonly redirectUriMismatch: boolean,
  ) {
    super("OAuth code exchange failed");
  }
}

const GA4_SCOPES = ["https://www.googleapis.com/auth/analytics.readonly"];

function requiredEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for Google Analytics connector setup`);
  }
  return value;
}

export function readGoogleOAuthConfig(
  environment: NodeJS.ProcessEnv = process.env,
): GoogleOAuthConfig {
  return {
    clientId: requiredEnvironmentValue(
      environment,
      "DASHFRAME_GOOGLE_CLIENT_ID",
    ),
    clientSecret: requiredEnvironmentValue(
      environment,
      "DASHFRAME_GOOGLE_CLIENT_SECRET",
    ),
    redirectBase:
      environment.DASHFRAME_OAUTH_REDIRECT_BASE?.trim() || undefined,
  };
}

export function readOptionalGoogleOAuthConfig(
  environment: NodeJS.ProcessEnv = process.env,
): GoogleOAuthConfig | undefined {
  const clientId = environment.DASHFRAME_GOOGLE_CLIENT_ID?.trim();
  const clientSecret = environment.DASHFRAME_GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId && !clientSecret) return undefined;
  return readGoogleOAuthConfig(environment);
}

function normalizedBase(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "DASHFRAME_OAUTH_REDIRECT_BASE must be an HTTP(S) base URL without credentials, query, or fragment",
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("OAuth redirect base must use HTTP or HTTPS");
  }
  return url.toString().replace(/\/$/u, "");
}

/** Resolve the callback from the current server endpoint on every issuance. */
export function resolveOAuthRedirectUri(
  serverEndpoint: string | undefined,
  redirectBase?: string,
): string {
  if (!serverEndpoint) throw new Error("Server endpoint is not ready");
  const endpoint = new URL(serverEndpoint);
  const selectedBase = redirectBase
    ? normalizedBase(redirectBase)
    : normalizedBase(serverEndpoint);
  if (!redirectBase && !isLoopbackHost(endpoint.hostname)) {
    throw new Error(
      "Google OAuth on a non-loopback server requires DASHFRAME_OAUTH_REDIRECT_BASE set to the registered callback base",
    );
  }
  const callbackBase = selectedBase.endsWith("/api")
    ? selectedBase
    : `${selectedBase}/api`;
  return `${callbackBase}/connectors/oauth/callback`;
}

export function connectorResumeLink(
  serverEndpoint: string | undefined,
  sessionId: string,
): string {
  if (!serverEndpoint) throw new Error("Server endpoint is not ready");
  const url = new URL("/", serverEndpoint);
  url.searchParams.set("resumeConnector", sessionId);
  return url.toString();
}

function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function isRedirectMismatch(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const error = (value as { error?: unknown }).error;
  const description = (value as { error_description?: unknown })
    .error_description;
  return [error, description].some(
    (candidate) =>
      typeof candidate === "string" &&
      candidate.toLowerCase().includes("redirect_uri"),
  );
}

export function makeGa4OAuthDescriptor(
  config: GoogleOAuthConfig,
): OAuthConnectorDescriptor {
  const fetchImpl = config.fetch ?? fetch;
  const now = config.now ?? Date.now;
  return {
    id: "googleAnalytics",
    authKind: "oauth",
    scopes: [...GA4_SCOPES],
    buildAuthorizeUrl(input) {
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("client_id", config.clientId);
      url.searchParams.set("redirect_uri", input.redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", GA4_SCOPES.join(" "));
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("prompt", "consent");
      url.searchParams.set("state", input.state);
      url.searchParams.set("code_challenge", codeChallenge(input.codeVerifier));
      url.searchParams.set("code_challenge_method", "S256");
      return url.toString();
    },
    async exchangeCode(input) {
      const body = new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code: input.code,
        code_verifier: input.codeVerifier,
        grant_type: "authorization_code",
        redirect_uri: input.redirectUri,
      });
      const response = await fetchImpl("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      const value = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        throw new OAuthExchangeError(
          "exchange-rejected",
          isRedirectMismatch(value),
        );
      }
      if (value === null || typeof value !== "object") {
        throw new OAuthExchangeError("invalid-token-response", false);
      }
      const token = value as {
        access_token?: unknown;
        refresh_token?: unknown;
        expires_in?: unknown;
        scope?: unknown;
      };
      if (
        typeof token.access_token !== "string" ||
        typeof token.refresh_token !== "string" ||
        typeof token.expires_in !== "number" ||
        typeof token.scope !== "string"
      ) {
        throw new OAuthExchangeError("invalid-token-response", false);
      }
      const grantedScopes = token.scope.split(/\s+/u).filter(Boolean);
      if (!GA4_SCOPES.every((scope) => grantedScopes.includes(scope))) {
        throw new OAuthExchangeError("missing-required-scope", false);
      }
      const bundle: GoogleOAuthTokenBundle = {
        version: 1,
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: now() + token.expires_in * 1000,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        scopes: grantedScopes,
      };
      return JSON.stringify(bundle);
    },
  };
}

/** Maps catalog-advertised OAuth connectors to their provider implementation. */
export function oauthConnectorDescriptorFor(
  connectorId: string,
  config: GoogleOAuthConfig,
): OAuthConnectorDescriptor {
  const catalogEntry = getConnectorCatalogEntries().find(
    (entry) => entry.id === connectorId,
  );
  if (catalogEntry?.authKind !== "oauth" || connectorId !== "googleAnalytics") {
    throw new Error(`Connector ${connectorId} does not support OAuth setup`);
  }
  return makeGa4OAuthDescriptor(config);
}
