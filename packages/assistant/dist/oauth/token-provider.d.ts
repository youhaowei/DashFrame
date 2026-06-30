import type { KeychainOAuth } from "./keychain.js";
import type { RefreshedCredentials } from "./refresh.js";
/**
 * Thrown when the keychain access token is expired AND the refresh token is
 * also dead (or absent). Fail-closed: never silently falls back to an
 * unauthenticated state.
 */
export declare class OAuthTokenExpiredError extends Error {
    constructor(message: string, options?: ErrorOptions);
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
     *
     * Returns the full rotated credential set so the caller can track the new
     * refresh token for the next cycle (Claude Code rotates it on every call).
     */
    fetchRefresh?: (refreshToken: string) => Promise<RefreshedCredentials>;
}
/**
 * In-flight refresh Promise (single-flight dedup).
 *
 * When a refresh is already in progress, concurrent callers await the same
 * Promise rather than issuing parallel refresh requests. This is critical for
 * token rotation: Claude Code rotates the refresh token on every successful
 * refresh, so a second parallel refresh would send a token the first call just
 * invalidated → 400 error + corrupted in-memory slot. The Promise is cleared
 * (set to null) when the refresh settles, regardless of outcome.
 */
export declare function getOAuthToken(options?: TokenProviderOptions): Promise<string>;
/**
 * Resets the in-memory credential slot and in-flight refresh guard.
 *
 * Exposed for testing only — allows tests to clear module-level state between
 * cases without reimporting. NOT part of the public API surface.
 *
 * @internal
 */
export declare function _resetInMemoryCredentials(): void;
//# sourceMappingURL=token-provider.d.ts.map