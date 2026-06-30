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
export declare function refreshAccessToken(refreshToken: string, fetchFn?: typeof fetch): Promise<RefreshedCredentials>;
//# sourceMappingURL=refresh.d.ts.map