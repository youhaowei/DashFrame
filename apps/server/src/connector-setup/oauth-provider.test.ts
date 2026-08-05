import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  makeGa4OAuthDescriptor,
  oauthConnectorDescriptorFor,
  readOptionalGoogleOAuthConfig,
  resolveOAuthRedirectUri,
} from "./oauth-provider";

describe("Google connector OAuth provider", () => {
  it("builds a PKCE S256 authorize URL without exposing the verifier", () => {
    const descriptor = makeGa4OAuthDescriptor({
      clientId: "client-id",
      clientSecret: "client-secret",
    });
    const verifier = "v".repeat(64);
    const url = new URL(
      descriptor.buildAuthorizeUrl({
        redirectUri: "http://127.0.0.1:4567/api/connectors/oauth/callback",
        state: "opaque-state",
        codeVerifier: verifier,
      }),
    );
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(
      createHash("sha256").update(verifier).digest("base64url"),
    );
    expect(url.toString()).not.toContain(verifier);
  });

  it("resolves GA4 only through an OAuth entry in the server catalog", () => {
    expect(
      oauthConnectorDescriptorFor("googleAnalytics", {
        clientId: "client-id",
        clientSecret: "client-secret",
      }),
    ).toMatchObject({ id: "googleAnalytics", authKind: "oauth" });
    expect(() =>
      oauthConnectorDescriptorFor("notion", {
        clientId: "client-id",
        clientSecret: "client-secret",
      }),
    ).toThrow(/does not support OAuth setup/);
  });

  it("fails closed for a non-loopback endpoint without an override", () => {
    expect(() =>
      resolveOAuthRedirectUri("https://dashframe.example/api"),
    ).toThrow(/DASHFRAME_OAUTH_REDIRECT_BASE/);
    expect(
      resolveOAuthRedirectUri(
        // Loopback HTTP is the installed-app OAuth contract under test.
        // eslint-disable-next-line sonarjs/no-clear-text-protocols
        "http://0.0.0.0:4000/api",
        "https://dashframe.example/api",
      ),
    ).toBe("https://dashframe.example/api/connectors/oauth/callback");
    expect(
      resolveOAuthRedirectUri(
        // Loopback HTTP is the installed-app OAuth contract under test.
        // eslint-disable-next-line sonarjs/no-clear-text-protocols
        "http://0.0.0.0:4000/api",
        "https://dashframe.example",
      ),
    ).toBe("https://dashframe.example/api/connectors/oauth/callback");
  });

  it("treats partial Google client configuration as an actionable startup error", () => {
    expect(() =>
      readOptionalGoogleOAuthConfig({ DASHFRAME_GOOGLE_CLIENT_ID: "id" }),
    ).toThrow(/DASHFRAME_GOOGLE_CLIENT_SECRET is required/);
  });

  it("classifies a redirect mismatch without including the provider response", async () => {
    const descriptor = makeGa4OAuthDescriptor({
      clientId: "client-id",
      clientSecret: "client-secret",
      fetch: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: "redirect_uri_mismatch",
              error_description: "secret provider detail",
            }),
            { status: 400 },
          ),
      ) as unknown as typeof fetch,
    });
    await expect(
      descriptor.exchangeCode({
        code: "code",
        codeVerifier: "v".repeat(64),
        redirectUri: "http://127.0.0.1/callback",
        state: "state",
      }),
    ).rejects.toMatchObject({ redirectUriMismatch: true });
  });

  // The client secret is one server-wide credential. Serialising it into each
  // connected source's vault bundle would multiply the places it must be
  // rotated out of, and would let any single source's bundle disclose the
  // secret for every source.
  it("never serialises the client secret into the stored token bundle", async () => {
    const clientSecret = "super-secret-value";
    const descriptor = makeGa4OAuthDescriptor({
      clientId: "client-id",
      clientSecret,
      now: () => 1_000_000,
      fetch: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              access_token: "access-token",
              refresh_token: "refresh-token",
              expires_in: 3600,
              scope: "https://www.googleapis.com/auth/analytics.readonly",
            }),
            { status: 200 },
          ),
      ) as unknown as typeof fetch,
    });

    const stored = await descriptor.exchangeCode({
      code: "code",
      codeVerifier: "v".repeat(64),
      redirectUri: "http://127.0.0.1/callback",
      state: "state",
    });

    expect(stored).not.toContain(clientSecret);
    const bundle = JSON.parse(stored) as Record<string, unknown>;
    expect(bundle).not.toHaveProperty("clientSecret");
    // The non-secret fields the refresh path still depends on must survive.
    expect(bundle).toMatchObject({
      version: 1,
      accessToken: "access-token",
      refreshToken: "refresh-token",
      clientId: "client-id",
    });
  });
});
