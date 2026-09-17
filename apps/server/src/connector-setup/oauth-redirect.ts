import { isLoopbackHost } from "../bind-host";

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
