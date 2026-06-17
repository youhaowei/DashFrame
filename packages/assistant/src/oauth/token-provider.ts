import type { KeychainOAuth } from "./keychain.js";
import { readKeychainOAuth } from "./keychain.js";
import { refreshAccessToken } from "./refresh.js";

/**
 * Thrown when the keychain access token is expired AND the refresh token is
 * also dead (or absent). Fail-closed: never silently falls back to an
 * unauthenticated state.
 */
export class OAuthTokenExpiredError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OAuthTokenExpiredError";
  }
}

export interface TokenProviderOptions {
  /**
   * Injectable keychain reader for testing.
   * Defaults to the real macOS keychain read via `security`.
   */
  readKeychain?: () => KeychainOAuth | Promise<KeychainOAuth>;

  /**
   * Injectable fetch for token refresh, for testing.
   * Defaults to the real global `fetch`.
   */
  fetchRefresh?: (refreshToken: string) => Promise<string>;
}

/**
 * Returns a live Claude Code OAuth access token (sk-ant-oat…).
 *
 * Strategy:
 * 1. Read the credential from the macOS keychain.
 * 2. If the stored access token is fresh (expiresAt in the future) → return it.
 * 3. If the access token is expired → refresh in-memory via the OAuth endpoint.
 * 4. If both are dead → throw OAuthTokenExpiredError (fail-closed).
 *
 * Security invariants:
 * - Token is never written to console.log, process.stdout, or process.stderr.
 * - Token is never written to disk.
 * - Refreshed token is never written back to the keychain.
 * - Token is returned by value for the caller's use; callers must not log it.
 *
 * Note on SecretVault: the token is returned as a bare string (not wrapped in
 * a SecretVault ref / withSecret lease) because pi's `getApiKey` hook expects
 * a plain string. A withSecret-style opaque holder would require pi to be
 * vault-aware, which it is not. The trust boundary is at the process level:
 * the token exists in-memory for the duration of the agent turn. Callers
 * MUST NOT log or persist the returned value.
 */
export async function getOAuthToken(
  options: TokenProviderOptions = {},
): Promise<string> {
  const keychainReader = options.readKeychain ?? readKeychainOAuth;
  const refresher = options.fetchRefresh ?? refreshAccessToken;

  const kc = await keychainReader();

  if (!kc.accessToken && !kc.refreshToken) {
    throw new OAuthTokenExpiredError(
      "no claudeAiOauth credentials found in keychain (missing accessToken and refreshToken)",
    );
  }

  // Conservative freshness: if expiresAt is absent or non-numeric, we cannot
  // assert the token is still valid, so we fall to the refresh path. This
  // avoids silently serving a potentially-stale token at the cost of an extra
  // network call. Callers that prefer returning an existing token when expiresAt
  // is absent can set a permissive readKeychain mock.
  const isFresh = typeof kc.expiresAt === "number" && Date.now() < kc.expiresAt;

  if (isFresh && kc.accessToken) {
    return kc.accessToken;
  }

  // Access token is expired or missing. Try the refresh path.
  if (!kc.refreshToken) {
    throw new OAuthTokenExpiredError(
      "keychain access token is expired and no refreshToken is present — re-authenticate with Claude Code",
    );
  }

  // Perform the in-memory refresh. If this throws (e.g. 400/401 from server),
  // we surface it as OAuthTokenExpiredError so callers get a typed sentinel.
  try {
    process.stderr.write(
      `[assistant/oauth] keychain access token expired (expiresAt=${kc.expiresAt ?? "none"}); refreshing in-memory…\n`,
    );
    const freshToken = await refresher(kc.refreshToken);
    return freshToken;
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new OAuthTokenExpiredError(
      `OAuth refresh failed — re-authenticate with Claude Code. Cause: ${cause}`,
      { cause: err },
    );
  }
}
