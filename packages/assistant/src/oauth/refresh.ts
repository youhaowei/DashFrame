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
 * Refreshes the Claude Code OAuth access token in-memory.
 *
 * - Never writes the refreshed token back to the keychain (would race Claude
 *   Code's own refresher and mutate the user's real credentials).
 * - Returns the new access token string in-memory only.
 *
 * @throws if the refresh endpoint returns a non-2xx response.
 */
export async function refreshAccessToken(
  refreshToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
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

  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("refresh response had no access_token field");
  }
  return data.access_token;
}
