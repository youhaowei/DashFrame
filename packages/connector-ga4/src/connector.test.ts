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
    clientSecret: "client-secret",
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
    ...overrides,
  };
}

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
});
