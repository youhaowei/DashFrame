import type { KeychainOAuth } from "./keychain.js";
import { readKeychainOAuth } from "./keychain.js";
import type { RefreshedCredentials } from "./refresh.js";
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

/**
 * `readKeychain` and `fetchRefresh` must be stable function references (a
 * module-level function, a memoized closure, etc.) — NOT an inline closure
 * created fresh per call. `getOAuthToken`'s `CredentialState` cache is
 * WeakMap-keyed on these two functions (see `credentialStatesByReader`
 * below); a new closure each call is a new WeakMap key, so every call misses
 * the cache and loses both the in-memory refresh-token rotation tracking and
 * the single-flight in-flight-refresh dedup.
 */
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
 * Parses `expiresAt` to a Unix-ms timestamp, accepting both numeric ms values
 * and ISO-8601 strings. Returns `undefined` when the value is absent or
 * unparseable — callers treat absent expiry as "unknown, must refresh."
 *
 * Claude Code stores `expiresAt` as either a numeric milliseconds value or an
 * ISO timestamp string, depending on the version that wrote the keychain entry.
 */
function parseExpiresAt(raw: number | string | undefined): number | undefined {
  if (typeof raw === "number") return raw > 0 ? raw : undefined;
  if (typeof raw === "string") {
    const ms = Date.parse(raw);
    return isNaN(ms) ? undefined : ms;
  }
  return undefined;
}

function formatExpiresAtForLog(raw: number | string | undefined): string {
  if (raw === undefined) return "none";
  const expiresAtMs = parseExpiresAt(raw);
  if (expiresAtMs === undefined) return "invalid";
  return new Date(expiresAtMs).toISOString();
}

/**
 * Returns a live Claude Code OAuth access token (sk-ant-oat…).
 *
 * Strategy:
 * 1. Read the credential from the macOS keychain.
 * 2. If the stored access token is fresh (expiresAt > now + 60s) → return it.
 * 3. If the access token is expired → refresh in-memory via the OAuth endpoint.
 * 4. Hold the rotated refresh token + new expiry in-memory for the session so
 *    subsequent calls use the live token, not the dead original in the keychain.
 * 5. If both are dead → throw OAuthTokenExpiredError (fail-closed).
 *
 * Security invariants:
 * - Token is never written to console.log, process.stdout, or process.stderr.
 * - Token is never written to disk.
 * - Refreshed token is never written back to the keychain.
 * - Token is returned by value for the caller's use; callers must not log it.
 *
 * Token rotation:
 * - Claude Code ROTATES the refresh token on every successful refresh response.
 * - The in-memory credential slot is updated after each refresh so the next
 *   expiry cycle uses the live (rotated) refresh token, not the dead original.
 * - The keychain entry is NOT updated; it remains the original and becomes stale
 *   after the first rotation. Re-reading the keychain after a rotation would
 *   yield a dead refresh token — hence the in-memory slot.
 *
 * Note on SecretVault: the token is returned as a bare string (not wrapped in
 * a SecretVault ref / withSecret lease) because pi's `getApiKey` hook expects
 * a plain string. A withSecret-style opaque holder would require pi to be
 * vault-aware, which it is not. The trust boundary is at the process level:
 * the token exists in-memory for the duration of the agent turn. Callers
 * MUST NOT log or persist the returned value.
 *
 * Expiry safety margin:
 * - A 60-second safety margin is applied so that a token expiring imminently
 *   triggers a refresh before it actually expires rather than after. This avoids
 *   in-flight race conditions where the token expires mid-request.
 */

/** Seconds before expiry at which we proactively refresh. */
const EXPIRY_MARGIN_MS = 60_000;

/**
 * In-memory credential slot updated after each successful refresh.
 * Tracks the rotated refresh token and new expiry so subsequent calls within
 * the same process do not re-read a stale keychain entry.
 *
 * Module-level state is intentional: a single process runs one agent turn;
 * there is no multi-tenant concern. The slot holds secrets only in-memory.
 */
interface CredentialState {
  inMemoryCredentials: {
    accessToken: string;
    refreshToken: string;
    expiresAtMs: number | undefined;
  } | null;
  inFlightRefresh: Promise<string> | null;
}

function createCredentialState(): CredentialState {
  return {
    inMemoryCredentials: null,
    inFlightRefresh: null,
  };
}

const defaultCredentialState = createCredentialState();
let credentialStatesByReader = new WeakMap<
  TokenProviderOptions["readKeychain"] & object,
  WeakMap<TokenProviderOptions["fetchRefresh"] & object, CredentialState>
>();

function getCredentialState(
  keychainReader: TokenProviderOptions["readKeychain"] & object,
  refresher: TokenProviderOptions["fetchRefresh"] & object,
): CredentialState {
  let statesByRefresher = credentialStatesByReader.get(keychainReader);
  if (!statesByRefresher) {
    statesByRefresher = new WeakMap<
      TokenProviderOptions["fetchRefresh"] & object,
      CredentialState
    >();
    credentialStatesByReader.set(keychainReader, statesByRefresher);
  }

  let state = statesByRefresher.get(refresher);
  if (!state) {
    state =
      keychainReader === readKeychainOAuth && refresher === refreshAccessToken
        ? defaultCredentialState
        : createCredentialState();
    statesByRefresher.set(refresher, state);
  }

  return state;
}

function wrapRefreshError(err: unknown): never {
  if (err instanceof OAuthTokenExpiredError) throw err;
  const cause = err instanceof Error ? err.message : String(err);
  throw new OAuthTokenExpiredError(
    `OAuth refresh failed — re-authenticate with Claude Code. Cause: ${cause}`,
    { cause: err },
  );
}

async function refreshWithToken(
  state: CredentialState,
  refresher: NonNullable<TokenProviderOptions["fetchRefresh"]>,
  refreshToken: string,
): Promise<string> {
  try {
    const rotated: RefreshedCredentials = await refresher(refreshToken);
    const newExpiresAtMs =
      typeof rotated.expiresIn === "number"
        ? Date.now() + rotated.expiresIn * 1000
        : undefined;

    state.inMemoryCredentials = {
      accessToken: rotated.accessToken,
      // If the server didn't return a new refresh token (non-rotating server),
      // keep the one we just used so the next cycle still has a token to try.
      refreshToken: rotated.refreshToken ?? refreshToken,
      expiresAtMs: newExpiresAtMs,
    };

    return rotated.accessToken;
  } catch (err) {
    wrapRefreshError(err);
  }
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

export function getOAuthToken(
  options: TokenProviderOptions = {},
): Promise<string> {
  const keychainReader = options.readKeychain ?? readKeychainOAuth;
  const refresher = options.fetchRefresh ?? refreshAccessToken;
  const state = getCredentialState(keychainReader, refresher);

  // ------------------------------------------------------------------
  // 1. Check the in-memory credential slot first (populated after first
  //    successful in-memory refresh — holds the rotated refresh token).
  // ------------------------------------------------------------------
  if (state.inMemoryCredentials) {
    const { accessToken, expiresAtMs } = state.inMemoryCredentials;
    const isFresh =
      typeof expiresAtMs === "number" &&
      Date.now() + EXPIRY_MARGIN_MS < expiresAtMs;
    if (isFresh) return Promise.resolve(accessToken);
    // In-memory slot is stale — fall through to refresh using the in-memory
    // refresh token (which may be rotated from the keychain's original).
  }

  // ------------------------------------------------------------------
  // 2. Single-flight dedup: if a refresh is already in flight, join it.
  //
  //    This check is synchronous — before any await — so concurrent callers
  //    that enter this function while a refresh is in progress will see the
  //    live `inFlightRefresh` Promise and await it rather than issuing a
  //    second (rotation-invalidating) refresh call.
  //
  //    The `inFlightRefresh` Promise is set below (step 4) synchronously
  //    before any await, so the first caller to reach step 4 wins the
  //    lock and all later callers that reach THIS check (steps 1–2) see
  //    the live Promise immediately.
  // ------------------------------------------------------------------
  if (state.inFlightRefresh) {
    return state.inFlightRefresh;
  }

  // ------------------------------------------------------------------
  // 3. No in-flight refresh yet. Register the guard Promise synchronously
  //    before any await so concurrent callers see it at step 2.
  // ------------------------------------------------------------------
  state.inFlightRefresh = (async (): Promise<string> => {
    try {
      if (state.inMemoryCredentials) {
        return refreshWithToken(
          state,
          refresher,
          state.inMemoryCredentials.refreshToken,
        );
      }

      // Read from keychain (first call, or in-memory slot exhausted before
      // we had a chance to refresh it).
      const kc = await keychainReader();

      try {
        if (!kc.accessToken && !kc.refreshToken) {
          throw new OAuthTokenExpiredError(
            "no claudeAiOauth credentials found in keychain (missing accessToken and refreshToken)",
          );
        }

        // Resolve expiresAt — keychain may store numeric ms or ISO string.
        const expiresAtMs = parseExpiresAt(kc.expiresAt);

        // Conservative freshness: if expiresAt is absent or unparseable, we cannot
        // assert the token is still valid, so we fall to the refresh path. This
        // avoids silently serving a potentially-stale token at the cost of an extra
        // network call. Apply a 60s safety margin so tokens expiring imminently
        // are proactively refreshed before they actually expire.
        const isFresh =
          typeof expiresAtMs === "number" &&
          Date.now() + EXPIRY_MARGIN_MS < expiresAtMs;

        if (isFresh && kc.accessToken) {
          return kc.accessToken;
        }

        // ------------------------------------------------------------------
        // Determine which refresh token to use: prefer the in-memory
        // (potentially rotated) token over the keychain's original, which may
        // be dead after a prior rotation.
        // ------------------------------------------------------------------
        const refreshToken = kc.refreshToken;

        if (!refreshToken) {
          throw new OAuthTokenExpiredError(
            "keychain access token is expired and no refreshToken is present — re-authenticate with Claude Code",
          );
        }

        // ------------------------------------------------------------------
        // Perform the in-memory refresh.
        // NOTE: expiresAt is a timestamp — never the token itself — so
        // interpolating it here is safe.
        // ------------------------------------------------------------------
        process.stderr.write(
          `[assistant/oauth] keychain access token expired (expiresAt=${formatExpiresAtForLog(kc.expiresAt)}); refreshing in-memory…\n`,
        );
        return refreshWithToken(state, refresher, refreshToken);
      } catch (err) {
        wrapRefreshError(err);
      }
    } finally {
      // Clear the in-flight guard regardless of outcome so subsequent calls
      // (after this one settles) can initiate a new refresh if needed.
      state.inFlightRefresh = null;
    }
  })();

  return state.inFlightRefresh;
}

/**
 * Resets the in-memory credential slot and in-flight refresh guard.
 *
 * Exposed for testing only — allows tests to clear module-level state between
 * cases without reimporting. NOT part of the public API surface.
 *
 * @internal
 */
export function _resetInMemoryCredentials(): void {
  defaultCredentialState.inMemoryCredentials = null;
  defaultCredentialState.inFlightRefresh = null;
  credentialStatesByReader = new WeakMap();
}
