import { describe, expect, it, vi } from "vitest";
import { refreshAccessToken } from "./refresh.js";

type RefreshFetch = Parameters<typeof refreshAccessToken>[1];

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
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
});
