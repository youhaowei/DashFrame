export interface KeychainOAuth {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number | string;
}
export declare function _parseKeychainOAuthForTest(value: unknown): KeychainOAuth;
/**
 * Reads the Claude Code OAuth credentials from the macOS keychain.
 * Parses the JSON blob and returns the claudeAiOauth sub-object.
 *
 * Throws with a clear message if the credential is missing or malformed.
 *
 * Uses the async execFile to avoid blocking the event loop — keychain reads
 * are typically fast but can stall on wake-from-sleep or when the keychain
 * is locked; blocking the event loop during those waits is undesirable.
 *
 * Account lookup: Claude Code stores the credential under the signed-in user's
 * account, not under "root". We pass `-a <current-user>` so the lookup matches
 * on any standard macOS installation. `userInfo().username` is the POSIX user
 * running the process — the same account Claude Code uses when writing the item.
 */
export declare function readKeychainOAuth(): Promise<KeychainOAuth>;
//# sourceMappingURL=keychain.d.ts.map