import { beforeEach, describe, expect, it, vi } from "vitest";

import type { KeychainOAuth } from "./keychain.js";
import type { RefreshedCredentials } from "./refresh.js";
import {
  _resetInMemoryCredentials,
  getOAuthToken,
  OAuthTokenExpiredError,
} from "./token-provider.js";

const FUTURE = Date.now() + 3_600_000; // 1h from now — fresh
const PAST = Date.now() - 3_600_000; // 1h ago — expired
/** Just beyond the 60s safety margin — treated as fresh. */
const NEAR_FUTURE = Date.now() + 61_000;
/** Just within the 60s safety margin — treated as expiring/stale. */
const EXPIRING_SOON = Date.now() + 59_000;

function makeKeychain(overrides: Partial<KeychainOAuth> = {}): KeychainOAuth {
  return {
    accessToken: "sk-ant-oat-mock-access-token",
    refreshToken: "mock-refresh-token",
    expiresAt: FUTURE,
    ...overrides,
  };
}

function makeRotated(
  overrides: Partial<RefreshedCredentials> = {},
): RefreshedCredentials {
  return {
    accessToken: "sk-ant-oat-mock-rotated-access-token",
    refreshToken: "mock-rotated-refresh-token",
    expiresIn: 3600,
    ...overrides,
  };
}

// Reset in-memory slot between tests so they are isolated.
beforeEach(() => {
  _resetInMemoryCredentials();
});

// ---------------------------------------------------------------------------
// Security: token-never-logged invariant
// ---------------------------------------------------------------------------

describe("getOAuthToken — security invariant", () => {
  it("should never log the access token to stdout or stderr", async () => {
    const mockKeychain = makeKeychain({ expiresAt: FUTURE });
    const mockReadKeychain = vi.fn(async () => mockKeychain);

    // intercept raw stream writes
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    const origStdout = process.stdout.write.bind(process.stdout);
    const origStderr = process.stderr.write.bind(process.stderr);

    process.stdout.write = (chunk: unknown) => {
      stdoutChunks.push(String(chunk));
      return origStdout(chunk as Parameters<typeof origStdout>[0]);
    };
    process.stderr.write = (chunk: unknown) => {
      stderrChunks.push(String(chunk));
      return origStderr(chunk as Parameters<typeof origStderr>[0]);
    };

    // Also spy on console.* — Vitest can buffer these separately from raw
    // stream writes, so a naive process.stderr.write intercept won't catch
    // console.error(token). Any console.* call with the token is a leak.
    const consoleSpy = {
      log: vi.spyOn(console, "log").mockImplementation(() => {}),
      error: vi.spyOn(console, "error").mockImplementation(() => {}),
      warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
      debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
    };

    try {
      const token = await getOAuthToken({ readKeychain: mockReadKeychain });
      const allOutput = [...stdoutChunks, ...stderrChunks].join("\n");
      expect(allOutput).not.toContain(token);

      // Assert console.* never received the token as any argument
      for (const spy of Object.values(consoleSpy)) {
        const allArgs = spy.mock.calls.flat().map(String).join("\n");
        expect(allArgs).not.toContain(token);
      }
    } finally {
      process.stdout.write = origStdout;
      process.stderr.write = origStderr;
      vi.restoreAllMocks();
    }
  });

  it("should never log the refreshed access token to stdout or stderr", async () => {
    const mockKeychain = makeKeychain({
      expiresAt: PAST,
      accessToken: "sk-ant-oat-mock-stale-access-token",
      refreshToken: "mock-refresh-token",
    });
    const mockReadKeychain = vi.fn(async () => mockKeychain);
    const freshToken = "sk-ant-oat-mock-fresh-access-token";
    const mockFetchRefresh = vi.fn(async (_rt: string) =>
      makeRotated({ accessToken: freshToken }),
    );

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    const origStdout = process.stdout.write.bind(process.stdout);
    const origStderr = process.stderr.write.bind(process.stderr);

    process.stdout.write = (chunk: unknown) => {
      stdoutChunks.push(String(chunk));
      return origStdout(chunk as Parameters<typeof origStdout>[0]);
    };
    process.stderr.write = (chunk: unknown) => {
      stderrChunks.push(String(chunk));
      return origStderr(chunk as Parameters<typeof origStderr>[0]);
    };

    // Also spy on console.* — same reasoning as above
    const consoleSpy = {
      log: vi.spyOn(console, "log").mockImplementation(() => {}),
      error: vi.spyOn(console, "error").mockImplementation(() => {}),
      warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
      debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
    };

    try {
      const token = await getOAuthToken({
        readKeychain: mockReadKeychain,
        fetchRefresh: mockFetchRefresh,
      });
      const allOutput = [...stdoutChunks, ...stderrChunks].join("\n");
      expect(allOutput).not.toContain(token);
      expect(token).toBe(freshToken);

      // Assert console.* never received the token as any argument
      for (const spy of Object.values(consoleSpy)) {
        const allArgs = spy.mock.calls.flat().map(String).join("\n");
        expect(allArgs).not.toContain(token);
      }
    } finally {
      process.stdout.write = origStdout;
      process.stderr.write = origStderr;
      vi.restoreAllMocks();
    }
  });
});

// ---------------------------------------------------------------------------
// Happy paths
// ---------------------------------------------------------------------------

describe("getOAuthToken — fresh token path", () => {
  it("returns the access token directly when expiresAt is in the future", async () => {
    const mockReadKeychain = vi.fn(async () =>
      makeKeychain({ expiresAt: FUTURE }),
    );
    const mockFetchRefresh = vi.fn();

    const token = await getOAuthToken({
      readKeychain: mockReadKeychain,
      fetchRefresh: mockFetchRefresh,
    });

    expect(token).toBe("sk-ant-oat-mock-access-token");
    expect(mockFetchRefresh).not.toHaveBeenCalled();
  });

  it("returns fresh token when expiresAt is just beyond the 60s safety margin", async () => {
    const mockReadKeychain = vi.fn(async () =>
      makeKeychain({ expiresAt: NEAR_FUTURE }),
    );
    const mockFetchRefresh = vi.fn();

    const token = await getOAuthToken({
      readKeychain: mockReadKeychain,
      fetchRefresh: mockFetchRefresh,
    });

    expect(token).toBe("sk-ant-oat-mock-access-token");
    expect(mockFetchRefresh).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Expiry safety margin
// ---------------------------------------------------------------------------

describe("getOAuthToken — 60s expiry safety margin", () => {
  it("proactively refreshes when token expires within 60s", async () => {
    const mockReadKeychain = vi.fn(async () =>
      makeKeychain({ expiresAt: EXPIRING_SOON }),
    );
    const rotated = makeRotated();
    const mockFetchRefresh = vi.fn(async (_rt: string) => rotated);

    const token = await getOAuthToken({
      readKeychain: mockReadKeychain,
      fetchRefresh: mockFetchRefresh,
    });

    expect(token).toBe(rotated.accessToken);
    expect(mockFetchRefresh).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// String expiresAt (ISO timestamp)
// ---------------------------------------------------------------------------

describe("getOAuthToken — string expiresAt", () => {
  it("accepts a future ISO timestamp string as fresh", async () => {
    const futureIso = new Date(Date.now() + 3_600_000).toISOString();
    const mockReadKeychain = vi.fn(async () =>
      makeKeychain({ expiresAt: futureIso as unknown as number }),
    );
    const mockFetchRefresh = vi.fn();

    const token = await getOAuthToken({
      readKeychain: mockReadKeychain,
      fetchRefresh: mockFetchRefresh,
    });

    expect(token).toBe("sk-ant-oat-mock-access-token");
    expect(mockFetchRefresh).not.toHaveBeenCalled();
  });

  it("treats a past ISO timestamp string as expired — falls to refresh path", async () => {
    const pastIso = new Date(Date.now() - 3_600_000).toISOString();
    const rotated = makeRotated();
    const mockReadKeychain = vi.fn(async () =>
      makeKeychain({ expiresAt: pastIso as unknown as number }),
    );
    const mockFetchRefresh = vi.fn(async (_rt: string) => rotated);

    const token = await getOAuthToken({
      readKeychain: mockReadKeychain,
      fetchRefresh: mockFetchRefresh,
    });

    expect(token).toBe(rotated.accessToken);
    expect(mockFetchRefresh).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Expired token → refresh + token rotation
// ---------------------------------------------------------------------------

describe("getOAuthToken — expired token refresh", () => {
  it("calls refresh when access token is expired and returns refreshed token", async () => {
    const mockReadKeychain = vi.fn(async () =>
      makeKeychain({ expiresAt: PAST }),
    );
    const rotated = makeRotated();
    const mockFetchRefresh = vi.fn(async (_rt: string) => rotated);

    const token = await getOAuthToken({
      readKeychain: mockReadKeychain,
      fetchRefresh: mockFetchRefresh,
    });

    expect(token).toBe(rotated.accessToken);
    expect(mockFetchRefresh).toHaveBeenCalledOnce();
    expect(mockFetchRefresh).toHaveBeenCalledWith("mock-refresh-token");
  });

  it("throws OAuthTokenExpiredError when refresh returns 400 (dead refresh token)", async () => {
    const mockReadKeychain = vi.fn(async () =>
      makeKeychain({ expiresAt: PAST }),
    );
    const mockFetchRefresh = vi.fn(async (_rt: string) => {
      throw new Error("token refresh failed: 400 Bad Request");
    });

    await expect(
      getOAuthToken({
        readKeychain: mockReadKeychain,
        fetchRefresh: mockFetchRefresh,
      }),
    ).rejects.toThrow(OAuthTokenExpiredError);
  });

  it("OAuthTokenExpiredError message includes cause when refresh fails", async () => {
    const mockReadKeychain = vi.fn(async () =>
      makeKeychain({ expiresAt: PAST }),
    );
    const mockFetchRefresh = vi.fn(async (_rt: string) => {
      throw new Error("token refresh failed: 400 Bad Request");
    });

    await expect(
      getOAuthToken({
        readKeychain: mockReadKeychain,
        fetchRefresh: mockFetchRefresh,
      }),
    ).rejects.toThrow(/token refresh failed: 400/);
  });

  it("second getOAuthToken call uses rotated refresh token (not dead keychain original)", async () => {
    // Simulate token rotation correctly using a very short expiresIn so the
    // in-memory slot is already expired on the second call.
    // We use a mock that can control "now" via Date.now overriding.

    const originalDateNow = Date.now;
    let fakeNow = originalDateNow();

    // Monkey-patch Date.now for this test
    Date.now = () => fakeNow;

    try {
      const expiredAt = fakeNow - 100; // Already expired
      const mockReadKeychain = vi.fn(async () =>
        makeKeychain({ expiresAt: expiredAt }),
      );

      const firstRotated: RefreshedCredentials = {
        accessToken: "sk-ant-oat-first-rotated-access",
        refreshToken: "rotated-refresh-token-v2",
        expiresIn: 60, // 60s from "now"
      };
      const secondRotated: RefreshedCredentials = {
        accessToken: "sk-ant-oat-second-rotated-access",
        refreshToken: "rotated-refresh-token-v3",
        expiresIn: 3600,
      };
      const mockFetchRefresh = vi
        .fn()
        .mockResolvedValueOnce(firstRotated)
        .mockResolvedValueOnce(secondRotated);

      // First call — triggers refresh
      const token1 = await getOAuthToken({
        readKeychain: mockReadKeychain,
        fetchRefresh: mockFetchRefresh,
      });
      expect(token1).toBe(firstRotated.accessToken);
      expect(mockFetchRefresh).toHaveBeenCalledTimes(1);
      const call0Arg = mockFetchRefresh.mock.calls[0]?.[0];
      expect(call0Arg).toBe("mock-refresh-token");

      // Advance time past the in-memory token's expiry (60s + 61s safety margin)
      fakeNow += (60 + 61) * 1000;

      // Second call — in-memory slot is expired, must use rotated refresh token
      const token2 = await getOAuthToken({
        readKeychain: mockReadKeychain,
        fetchRefresh: mockFetchRefresh,
      });
      expect(token2).toBe(secondRotated.accessToken);
      expect(mockFetchRefresh).toHaveBeenCalledTimes(2);
      // CRITICAL: second call must use the rotated refresh token, NOT the original
      const call1Arg = mockFetchRefresh.mock.calls[1]?.[0];
      expect(call1Arg).toBe(firstRotated.refreshToken);
      expect(call1Arg).not.toBe("mock-refresh-token");
    } finally {
      Date.now = originalDateNow;
    }
  });
});

// ---------------------------------------------------------------------------
// Missing / no-credential cases
// ---------------------------------------------------------------------------

describe("getOAuthToken — missing credentials", () => {
  it("throws OAuthTokenExpiredError when no claudeAiOauth block found (missing both tokens)", async () => {
    const mockReadKeychain = vi.fn(async () => ({}) as KeychainOAuth);

    await expect(
      getOAuthToken({ readKeychain: mockReadKeychain }),
    ).rejects.toThrow(OAuthTokenExpiredError);
  });

  it("OAuthTokenExpiredError message mentions 'missing' when no credential", async () => {
    const mockReadKeychain = vi.fn(async () => ({}) as KeychainOAuth);

    await expect(
      getOAuthToken({ readKeychain: mockReadKeychain }),
    ).rejects.toThrow(/missing accessToken and refreshToken/);
  });

  it("throws OAuthTokenExpiredError when accessToken expired and no refreshToken", async () => {
    const mockReadKeychain = vi.fn(async () =>
      makeKeychain({
        expiresAt: PAST,
        refreshToken: undefined,
      }),
    );

    await expect(
      getOAuthToken({ readKeychain: mockReadKeychain }),
    ).rejects.toThrow(OAuthTokenExpiredError);
  });

  it("OAuthTokenExpiredError is an instanceof Error", async () => {
    const mockReadKeychain = vi.fn(async () => ({}) as KeychainOAuth);

    const err = await getOAuthToken({ readKeychain: mockReadKeychain }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(OAuthTokenExpiredError);
    expect(err).toBeInstanceOf(Error);
  });

  it("treats accessToken present with undefined expiresAt as expired — falls to refresh path", async () => {
    // Intentional policy: when expiresAt is absent we cannot assert freshness,
    // so we attempt an in-memory refresh. This avoids silently serving a
    // potentially-stale token at the cost of an extra network call.
    const rotated = makeRotated({
      accessToken: "sk-ant-oat-mock-refreshed-no-expiry",
    });
    const mockReadKeychain = vi.fn(async () =>
      makeKeychain({ expiresAt: undefined }),
    );
    const mockFetchRefresh = vi.fn(async (_rt: string) => rotated);

    const token = await getOAuthToken({
      readKeychain: mockReadKeychain,
      fetchRefresh: mockFetchRefresh,
    });

    expect(token).toBe(rotated.accessToken);
    expect(mockFetchRefresh).toHaveBeenCalledOnce();
  });

  it("propagates a raw Error (not OAuthTokenExpiredError) when the keychain reader throws — callers receive a clear failure", async () => {
    // readKeychainOAuth throws a plain Error (e.g. OS keychain unavailable).
    // This is intentionally NOT wrapped in OAuthTokenExpiredError — it's an
    // infrastructure failure, not an expired-credential case. The error still
    // satisfies "fail-closed": it throws, never silently falls back.
    const mockReadKeychain = vi.fn(async () => {
      throw new Error(
        "Failed to read Claude Code credentials from keychain: the tool exited with status 44",
      );
    });

    await expect(
      getOAuthToken({ readKeychain: mockReadKeychain }),
    ).rejects.toThrow("Failed to read Claude Code credentials from keychain");
  });
});

// ---------------------------------------------------------------------------
// In-memory credential slot: isolation + reset
// ---------------------------------------------------------------------------

describe("getOAuthToken — in-memory credential slot", () => {
  it("_resetInMemoryCredentials clears state so next call re-reads the keychain", async () => {
    // Populate the in-memory slot via a first refresh.
    const mockReadKeychain = vi.fn(async () =>
      makeKeychain({ expiresAt: PAST }),
    );
    const rotated = makeRotated();
    const mockFetchRefresh = vi.fn(async (_rt: string) => rotated);

    await getOAuthToken({
      readKeychain: mockReadKeychain,
      fetchRefresh: mockFetchRefresh,
    });
    expect(mockFetchRefresh).toHaveBeenCalledTimes(1);

    // Reset slot — next call must re-read keychain.
    _resetInMemoryCredentials();

    // Provide a fresh keychain entry — should not need to refresh.
    const freshKeychain = makeKeychain({ expiresAt: FUTURE });
    const mockReadKeychain2 = vi.fn(async () => freshKeychain);
    const mockFetchRefresh2 = vi.fn();

    const token = await getOAuthToken({
      readKeychain: mockReadKeychain2,
      fetchRefresh: mockFetchRefresh2,
    });
    expect(token).toBe(freshKeychain.accessToken);
    expect(mockFetchRefresh2).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Concurrent refresh — single-flight dedup
// ---------------------------------------------------------------------------

describe("getOAuthToken — concurrent refresh dedup (single-flight)", () => {
  it("fires the refresh exactly once when two concurrent calls race on an expired token", async () => {
    // Both calls arrive with an expired in-memory state. Without single-flight
    // dedup, both would call refresher() — the second sends the now-dead
    // (rotated) original refresh token → 400 on Claude's server.
    const mockReadKeychain = vi.fn(async () =>
      makeKeychain({ expiresAt: PAST }),
    );

    let resolveRefresh!: (v: RefreshedCredentials) => void;
    const refreshPromise = new Promise<RefreshedCredentials>((resolve) => {
      resolveRefresh = resolve;
    });
    const mockFetchRefresh = vi.fn(() => refreshPromise);

    // Fire two concurrent calls before the refresh resolves.
    const [p1, p2] = [
      getOAuthToken({
        readKeychain: mockReadKeychain,
        fetchRefresh: mockFetchRefresh,
      }),
      getOAuthToken({
        readKeychain: mockReadKeychain,
        fetchRefresh: mockFetchRefresh,
      }),
    ];

    // Resolve the refresh now — both callers should get the same token.
    const rotated = makeRotated({
      accessToken: "sk-ant-oat-single-flight-token",
    });
    resolveRefresh(rotated);

    const [t1, t2] = await Promise.all([p1, p2]);

    // Both callers receive the refreshed token.
    expect(t1).toBe(rotated.accessToken);
    expect(t2).toBe(rotated.accessToken);
    // The refresh was only called once — no rotation-invalidating second call.
    expect(mockFetchRefresh).toHaveBeenCalledTimes(1);
  });
});
