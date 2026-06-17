import { describe, expect, it, vi } from "vitest";

import type { KeychainOAuth } from "./keychain.js";
import { getOAuthToken, OAuthTokenExpiredError } from "./token-provider.js";

const FUTURE = Date.now() + 3_600_000; // 1h from now — fresh
const PAST = Date.now() - 3_600_000; // 1h ago — expired

function makeKeychain(overrides: Partial<KeychainOAuth> = {}): KeychainOAuth {
  return {
    accessToken: "sk-ant-oat-mock-access-token",
    refreshToken: "mock-refresh-token",
    expiresAt: FUTURE,
    ...overrides,
  };
}

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
    const mockFetchRefresh = vi.fn(async (_rt: string) => freshToken);

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
});

// ---------------------------------------------------------------------------
// Expired token → refresh
// ---------------------------------------------------------------------------

describe("getOAuthToken — expired token refresh", () => {
  it("calls refresh when access token is expired and returns refreshed token", async () => {
    const mockReadKeychain = vi.fn(async () =>
      makeKeychain({ expiresAt: PAST }),
    );
    const refreshed = "sk-ant-oat-mock-refreshed-token";
    const mockFetchRefresh = vi.fn(async (_rt: string) => refreshed);

    const token = await getOAuthToken({
      readKeychain: mockReadKeychain,
      fetchRefresh: mockFetchRefresh,
    });

    expect(token).toBe(refreshed);
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
    const refreshed = "sk-ant-oat-mock-refreshed-no-expiry";
    const mockReadKeychain = vi.fn(async () =>
      makeKeychain({ expiresAt: undefined }),
    );
    const mockFetchRefresh = vi.fn(async (_rt: string) => refreshed);

    const token = await getOAuthToken({
      readKeychain: mockReadKeychain,
      fetchRefresh: mockFetchRefresh,
    });

    expect(token).toBe(refreshed);
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
