import { tableFromIPC } from "apache-arrow";
import { describe, expect, it, vi } from "vitest";

import { makeGa4Connector, type GoogleOAuthTokenBundle } from "./connector";

function resolver(bundle: GoogleOAuthTokenBundle) {
  return async <T>(use: (plaintext: string) => Promise<T>) =>
    use(JSON.stringify(bundle));
}

function bundle(overrides: Partial<GoogleOAuthTokenBundle> = {}) {
  return {
    version: 1 as const,
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresAt: Date.parse("2026-08-05T13:00:00Z"),
    clientId: "client-id",
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
    ...overrides,
  };
}

/** Client credentials the host supplies at call time, never persisted. */
const oauthClient = { clientId: "client-id", clientSecret: "client-secret" };

describe("GA4 connector", () => {
  it("lists every accessible property with a bearer header", async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        expect(new Headers(init?.headers).get("Authorization")).toBe(
          "Bearer access-token",
        );
        return new Response(
          JSON.stringify({
            accountSummaries: [
              {
                propertySummaries: [
                  { property: "properties/123", displayName: "Store" },
                ],
              },
            ],
          }),
          { status: 200 },
        );
      },
    );
    const connector = makeGa4Connector(resolver(bundle()), {
      fetch: fetchImpl as typeof fetch,
      now: () => Date.parse("2026-08-05T12:00:00Z"),
    });
    await expect(connector.connect()).resolves.toEqual([
      { id: "properties/123", name: "Store" },
    ]);
  });

  it("refreshes an expired access token before the authenticated read", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "fresh-token" }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accountSummaries: [] }), { status: 200 }),
      );
    const connector = makeGa4Connector(
      resolver(bundle({ expiresAt: Date.parse("2026-08-05T11:00:00Z") })),
      {
        fetch: fetchImpl as typeof fetch,
        now: () => Date.parse("2026-08-05T12:00:00Z"),
        oauthClient,
      },
    );
    await connector.connect();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(
      new Headers(fetchImpl.mock.calls[1]?.[1]?.headers).get("Authorization"),
    ).toBe("Bearer fresh-token");
  });

  it("runs the bounded default report and returns aligned Arrow data", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            dimensionHeaders: [{ name: "date" }],
            metricHeaders: [{ name: "activeUsers", type: "TYPE_INTEGER" }],
            rows: [
              {
                dimensionValues: [{ value: "20260804" }],
                metricValues: [{ value: "42" }],
              },
            ],
          }),
          { status: 200 },
        ),
    );
    const connector = makeGa4Connector(resolver(bundle()), {
      fetch: fetchImpl as typeof fetch,
      now: () => Date.parse("2026-08-05T12:00:00Z"),
    });
    const result = await connector.query(
      "properties/123",
      crypto.randomUUID(),
      { pagination: { offset: 0, limit: 25 } },
    );
    const arrow = tableFromIPC(Buffer.from(result.arrowBuffer, "base64"));
    expect(result.rowCount).toBe(1);
    expect(result.fields.map((field) => field.name)).toEqual([
      "date",
      "activeUsers",
    ]);
    expect(result.fields.map((field) => field.type)).toEqual([
      "date",
      "number",
    ]);
    expect(String(arrow.schema.fields[0]?.type)).toContain("Timestamp");
    expect(arrow.numRows).toBe(1);
    expect(
      JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      offset: "0",
      limit: "25",
    });
  });

  it("rejects a property id that could alter the Google request path", async () => {
    const connector = makeGa4Connector(resolver(bundle()), {
      fetch: vi.fn() as typeof fetch,
    });
    await expect(
      connector.query(
        "properties/123:runReport?token=leak",
        crypto.randomUUID(),
      ),
    ).rejects.toThrow(/Invalid GA4 property id/);
  });

  // The client secret is server-wide config, not per-source data, so it reaches
  // the refresh request from the host at call time rather than from the stored
  // bundle. These pin that the wire request is still correctly authenticated,
  // and that a missing or mismatched client fails closed instead of silently
  // sending an unauthenticated refresh.
  describe("token refresh client credentials", () => {
    const expired = { expiresAt: Date.parse("2026-08-05T11:00:00Z") };
    const now = () => Date.parse("2026-08-05T12:00:00Z");

    it("sends the host-supplied client secret, which is absent from the bundle", async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ access_token: "fresh-token" }), {
            status: 200,
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ accountSummaries: [] }), {
            status: 200,
          }),
        );
      const stored = bundle(expired);
      expect(stored).not.toHaveProperty("clientSecret");

      const connector = makeGa4Connector(resolver(stored), {
        fetch: fetchImpl as typeof fetch,
        now,
        oauthClient,
      });
      await connector.connect();

      const body = new URLSearchParams(
        String(fetchImpl.mock.calls[0]?.[1]?.body),
      );
      expect(body.get("client_secret")).toBe(oauthClient.clientSecret);
      expect(body.get("client_id")).toBe(oauthClient.clientId);
      expect(body.get("grant_type")).toBe("refresh_token");
    });

    it("fails closed when the host has no OAuth client configured", async () => {
      const fetchImpl = vi.fn();
      const connector = makeGa4Connector(resolver(bundle(expired)), {
        fetch: fetchImpl as unknown as typeof fetch,
        now,
      });
      await expect(connector.connect()).rejects.toThrow(/not configured/);
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("persists the renewed bundle so the next call does not refresh again", async () => {
      // A mutable store standing in for the vault entry: persist writes to it,
      // and the resolver reads whatever is currently there.
      let stored = JSON.stringify(bundle(expired));
      const persistTokenBundle = vi.fn(async (next: GoogleOAuthTokenBundle) => {
        stored = JSON.stringify(next);
      });
      // Matched on the parsed origin, not a substring: a substring test would
      // also match a host that merely contains this one, which is the same
      // mistake that makes real host checks exploitable.
      const isTokenEndpoint = (url: string | URL) =>
        new URL(String(url)).origin === "https://oauth2.googleapis.com";
      const fetchImpl = vi.fn(async (url: string | URL) =>
        isTokenEndpoint(url)
          ? new Response(
              JSON.stringify({ access_token: "fresh-token", expires_in: 3600 }),
              { status: 200 },
            )
          : new Response(JSON.stringify({ accountSummaries: [] }), {
              status: 200,
            }),
      );
      const connector = makeGa4Connector(
        async <T>(use: (plaintext: string) => Promise<T>) => use(stored),
        {
          fetch: fetchImpl as unknown as typeof fetch,
          now,
          persistTokenBundle,
          oauthClient,
        },
      );

      await connector.connect();
      expect(persistTokenBundle).toHaveBeenCalledTimes(1);
      const saved = JSON.parse(stored) as GoogleOAuthTokenBundle;
      expect(saved.accessToken).toBe("fresh-token");
      expect(saved.expiresAt).toBe(now() + 3600_000);
      // Google returned no new refresh token, so the existing grant is kept.
      expect(saved.refreshToken).toBe("refresh-token");
      expect(saved).not.toHaveProperty("clientSecret");

      // The whole point: the second call is already inside the new expiry
      // window, so it must not spend another refresh grant.
      fetchImpl.mockClear();
      await connector.connect();
      expect(persistTokenBundle).toHaveBeenCalledTimes(1);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(new URL(String(fetchImpl.mock.calls[0]?.[0])).origin).not.toBe(
        "https://oauth2.googleapis.com",
      );
    });

    it("still serves the request when the write-back fails", async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ access_token: "fresh-token" }), {
            status: 200,
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ accountSummaries: [] }), {
            status: 200,
          }),
        );
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const connector = makeGa4Connector(resolver(bundle(expired)), {
        fetch: fetchImpl as typeof fetch,
        now,
        oauthClient,
        persistTokenBundle: async () => {
          throw new Error("vault unavailable");
        },
      });

      // The token in hand is valid; only storing it failed.
      await expect(connector.connect()).resolves.toEqual([]);
      expect(
        new Headers(fetchImpl.mock.calls[1]?.[1]?.headers).get("Authorization"),
      ).toBe("Bearer fresh-token");
      warn.mockRestore();
    });

    it("refuses to renew a grant minted by a different OAuth client", async () => {
      const fetchImpl = vi.fn();
      const connector = makeGa4Connector(
        resolver(bundle({ ...expired, clientId: "retired-client" })),
        {
          fetch: fetchImpl as unknown as typeof fetch,
          now,
          oauthClient,
        },
      );
      await expect(connector.connect()).rejects.toThrow(
        /different OAuth client/,
      );
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });
});
