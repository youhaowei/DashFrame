import { describe, expect, it, vi } from "vitest";
import { refreshAccessToken } from "./refresh.js";

type RefreshFetch = Parameters<typeof refreshAccessToken>[1];

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function errorJson(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("refreshAccessToken", () => {
  it("returns a string access token from a successful refresh response", async () => {
    const fetchFn = vi.fn(async () =>
      okJson({
        access_token: "access-new",
        refresh_token: "refresh-new",
        expires_in: 3600,
      }),
    );

    await expect(
      refreshAccessToken("refresh-old", fetchFn as unknown as RefreshFetch),
    ).resolves.toEqual({
      accessToken: "access-new",
      refreshToken: "refresh-new",
      expiresIn: 3600,
    });
  });

  it("rejects malformed successful refresh responses with non-string access_token", async () => {
    const fetchFn = vi.fn(async () =>
      okJson({ access_token: { value: "not-a-string" } }),
    );

    await expect(
      refreshAccessToken("refresh-old", fetchFn as unknown as RefreshFetch),
    ).rejects.toThrow("refresh response had no access_token field");
  });

  it("treats an empty rotated refresh_token as absent", async () => {
    const fetchFn = vi.fn(async () =>
      okJson({
        access_token: "access-new",
        refresh_token: "  ",
        expires_in: 3600,
      }),
    );

    await expect(
      refreshAccessToken("refresh-old", fetchFn as unknown as RefreshFetch),
    ).resolves.toEqual({
      accessToken: "access-new",
      refreshToken: undefined,
      expiresIn: 3600,
    });
  });

  it("redacts OAuth error descriptions from thrown refresh failures", async () => {
    const fetchFn = vi.fn(async () =>
      errorJson(400, {
        error: "invalid_grant",
        error_description: "bad refresh token refresh-secret",
      }),
    );

    await expect(
      refreshAccessToken("refresh-secret", fetchFn as unknown as RefreshFetch),
    ).rejects.toThrow("token refresh failed: invalid_grant (HTTP 400)");

    await expect(
      refreshAccessToken("refresh-secret", fetchFn as unknown as RefreshFetch),
    ).rejects.not.toThrow("refresh-secret");
  });
});
