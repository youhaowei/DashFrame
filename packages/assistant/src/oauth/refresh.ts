/**
 * Owns the token refresh leg inline.
 *
 * FINDING (pi packaging gap): pi DOES implement refreshAnthropicToken and its
 * .d.ts re-exports it from the package root — but the runtime `exports` map
 * does NOT, and there is no subpath for the oauth utils. It is UNREACHABLE at
 * runtime. We own the refresh here, against the same Claude Code OAuth endpoint
 * pi uses. CLIENT_ID is Claude Code's public client_id (not a secret).
 *
 * NEVER import { refreshAnthropicToken } from "@earendil-works/pi-ai" — it
 * will throw SyntaxError: Export named 'refreshAnthropicToken' not found.
 */

const CLAUDE_CODE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const CLAUDE_OAUTH_TOKEN_URL = "https://platform.claude.com/v1/oauth/token";

/**
 * The full rotated credential set returned by a successful token refresh.
 *
 * Claude Code ROTATES the refresh token on every successful refresh call —
 * the old refresh token becomes dead immediately after the response. Callers
 * MUST hold `refreshToken` in-memory for the next cycle; re-reading the
 * keychain after a refresh will return the now-dead original token.
 *
 * `expiresIn` is seconds from now (standard OAuth2 `expires_in` field).
 * May be absent if the server omits it; callers should treat absent as "unknown
 * expiry" and attempt a refresh on the next use rather than serving a token
 * whose freshness is unknowable.
 */
export interface RefreshedCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

/**
 * Refreshes the Claude Code OAuth access token in-memory.
 *
 * - Returns the full rotated credential set (accessToken + rotated refreshToken
 *   + expiresIn) so callers can track the new refresh token for the next cycle.
 * - Never writes the refreshed credentials back to the keychain (would race
 *   Claude Code's own refresher and mutate the user's real credentials).
 *
 * @throws if the refresh endpoint returns a non-2xx response.
 */
export async function refreshAccessToken(
  refreshToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<RefreshedCredentials> {
  const res = await fetchFn(CLAUDE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: CLAUDE_CODE_CLIENT_ID,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    // Parse structured OAuth error when possible; otherwise cap the raw body to
    // avoid surfacing attacker-influenced or credential-echoing server text in
    // exception messages that callers will log.
    const rawBody = await res.text().catch(() => "(unreadable body)");
    let detail: string;
    try {
      const parsed = JSON.parse(rawBody) as {
        error?: unknown;
        error_description?: unknown;
      };
      const code = typeof parsed.error === "string" ? parsed.error : null;
      const desc =
        typeof parsed.error_description === "string"
          ? parsed.error_description
          : null;
      detail = [code, desc].filter(Boolean).join(": ") || `HTTP ${res.status}`;
    } catch {
      // Non-JSON error body — surface HTTP status only (never raw body text).
      detail = `HTTP ${res.status}`;
    }
    throw new Error(`token refresh failed: ${detail}`);
  }

  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: unknown;
  };
  if (typeof data.access_token !== "string" || data.access_token.length === 0) {
    throw new Error("refresh response had no access_token field");
  }

  return {
    accessToken: data.access_token,
    // Claude Code rotates the refresh token on each successful refresh.
    // Preserve it in-memory so the next expiry cycle uses the live token.
    refreshToken:
      typeof data.refresh_token === "string" ? data.refresh_token : undefined,
    // Standard OAuth2 expires_in is seconds; validate it's a positive number.
    expiresIn:
      typeof data.expires_in === "number" && data.expires_in > 0
        ? data.expires_in
        : undefined,
  };
}
