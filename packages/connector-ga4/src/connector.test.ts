import { tableFromIPC } from "apache-arrow";
import { describe, expect, it, vi } from "vite-plus/test";
import { supportsDefinitions } from "@dashframe/engine";

import {
  acquisitionMeasures,
  GoogleAuthorizationError,
  makeGa4Connector,
  yearWeekStart,
  type GoogleOAuthTokenBundle,
} from "./connector";

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
  it("implements definition queries, field listing, compatibility, and the capability guard", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      urls.push(url);
      if (
        url === "https://analyticsadmin.googleapis.com/v1beta/properties/123"
      ) {
        return new Response(JSON.stringify({ timeZone: "Asia/Tokyo" }));
      }
      if (url.endsWith(":runReport")) {
        return new Response(
          JSON.stringify({
            dimensionHeaders: [{ name: "date" }],
            metricHeaders: [{ name: "sessions" }],
            rowCount: 0,
            rows: [],
          }),
        );
      }
      if (url.endsWith("/metadata")) {
        return new Response(
          JSON.stringify({
            dimensions: [{ apiName: "date", uiName: "Date" }],
            metrics: [],
          }),
        );
      }
      if (url.endsWith(":checkCompatibility")) {
        return new Response(JSON.stringify({}));
      }
      return new Response(null, { status: 404 });
    });
    const connector = makeGa4Connector(resolver(bundle()), {
      fetch: fetchImpl as typeof fetch,
      now: () => Date.parse("2026-03-01T00:30:00Z"),
    });
    const definition = {
      dimensions: ["date"],
      metrics: ["sessions"],
      grain: "day" as const,
      dateRange: { kind: "relative" as const, months: 1 },
    };

    expect(supportsDefinitions(connector)).toBe(true);
    await expect(
      connector.queryDefinition("123", definition, {
        tableId: crypto.randomUUID(),
      }),
    ).resolves.toMatchObject({ rowCount: 0 });
    await connector.queryDefinition("123", definition, {
      tableId: crypto.randomUUID(),
    });
    await expect(connector.listFields("123")).resolves.toMatchObject([
      { apiName: "date", scope: "time" },
    ]);
    await expect(connector.checkDefinition("123", definition)).resolves.toEqual(
      { ok: true },
    );
    expect(
      urls.filter(
        (url) => new URL(url).hostname === "analyticsadmin.googleapis.com",
      ),
    ).toHaveLength(1);
  });

  it("reserves the response-byte budget for report data, not time-zone metadata", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      urls.push(url);
      return new URL(url).hostname === "analyticsadmin.googleapis.com"
        ? new Response(JSON.stringify({ timeZone: "Asia/Tokyo" }))
        : new Response(JSON.stringify({ rowCount: 0, rows: [] }));
    });
    const connector = makeGa4Connector(resolver(bundle()), {
      fetch: fetchImpl as typeof fetch,
      now: () => Date.parse("2026-08-05T12:00:00Z"),
    });
    await expect(
      connector.queryDefinition(
        "123",
        {
          dimensions: ["date"],
          metrics: ["sessions"],
          grain: "day",
          dateRange: { kind: "relative", months: 1 },
        },
        { tableId: crypto.randomUUID(), maxResponseBytes: 1 },
      ),
    ).rejects.toThrow("SOURCE_RESULT_TOO_LARGE");
    expect(urls).toEqual([
      "https://analyticsadmin.googleapis.com/v1beta/properties/123",
      "https://analyticsdata.googleapis.com/v1beta/properties/123:runReport",
    ]);
  });

  it("bounds report response bytes and cancels the unread body", async () => {
    const cancel = vi.fn();
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"rows":[]}'));
            },
            cancel,
          }),
        ),
    );
    const connector = makeGa4Connector(
      resolver(bundle({ expiresAt: Date.now() + 3_600_000 })),
      { fetch: fetchImpl as typeof fetch },
    );
    await expect(
      connector.query("properties/123", "table", { maxResponseBytes: 4 }),
    ).rejects.toThrow("SOURCE_RESULT_TOO_LARGE");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("passes cancellation through token refresh and skips already aborted queries", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        expect(init?.signal).toBe(controller.signal);
        controller.abort();
        init?.signal?.throwIfAborted();
        return new Response();
      },
    );
    const connector = makeGa4Connector(resolver(bundle({ expiresAt: 0 })), {
      fetch: fetchImpl as typeof fetch,
      oauthClient,
    });
    await expect(
      connector.query("properties/123", "table", { signal: controller.signal }),
    ).rejects.toThrow();
    await expect(
      connector.query("properties/123", "table", { signal: controller.signal }),
    ).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
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

  it("runs the bounded acquisition report and returns aligned Arrow data", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            dimensionHeaders: [
              { name: "yearWeek" },
              { name: "sessionDefaultChannelGroup" },
            ],
            metricHeaders: [
              { name: "activeUsers", type: "TYPE_INTEGER" },
              { name: "newUsers", type: "TYPE_INTEGER" },
              { name: "sessions", type: "TYPE_INTEGER" },
              { name: "engagedSessions", type: "TYPE_INTEGER" },
              { name: "engagementRate", type: "TYPE_FLOAT" },
              { name: "keyEvents", type: "TYPE_FLOAT" },
              { name: "totalRevenue", type: "TYPE_CURRENCY" },
            ],
            rows: [
              {
                dimensionValues: [
                  { value: "202631" },
                  { value: "Organic Search" },
                ],
                metricValues: [
                  { value: "42" },
                  { value: "12" },
                  { value: "56" },
                  { value: "31" },
                  { value: "0.5536" },
                  { value: "3" },
                  { value: "98.75" },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
    );
    const connector = makeGa4Connector(resolver(bundle()), {
      fetch: fetchImpl as typeof fetch,
      now: () => Date.parse("2026-08-05T12:00:00Z"),
      reportVersion: "v2",
    });
    const controller = new AbortController();
    const result = await connector.query(
      "properties/123",
      crypto.randomUUID(),
      { pagination: { offset: 0, limit: 25 }, signal: controller.signal },
    );
    const arrow = tableFromIPC(Buffer.from(result.arrowBuffer, "base64"));
    expect(result.rowCount).toBe(1);
    expect(result.fields.map((field) => field.columnName)).toEqual([
      "yearWeek",
      "sessionDefaultChannelGroup",
      "activeUsers",
      "newUsers",
      "sessions",
      "engagedSessions",
      "engagementRate",
      "keyEvents",
      "totalRevenue",
    ]);
    expect(result.fields.map((field) => field.name)).toEqual([
      "Week",
      "Channel",
      "Active users",
      "New users",
      "Sessions",
      "Engaged sessions",
      "Engagement rate",
      "Key events",
      "Revenue",
    ]);
    expect(result.fields.map((field) => field.type)).toEqual([
      "date",
      "string",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]);
    expect(result.fields.map((field) => field.scope)).toEqual([
      "time",
      "session",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(arrow.schema.fields[0]?.name).toBe("yearWeek");
    expect(String(arrow.schema.fields[0]?.type)).toContain("Timestamp");
    // GA4 week 31 of 2026 starts on Sunday 26 July.
    expect(new Date(arrow.getChildAt(0)?.get(0) as number).toISOString()).toBe(
      "2026-07-26T00:00:00.000Z",
    );
    expect(arrow.numRows).toBe(1);
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({
      dateRanges: [{ startDate: "90daysAgo", endDate: "yesterday" }],
      dimensions: [
        { name: "yearWeek" },
        { name: "sessionDefaultChannelGroup" },
      ],
      metrics: [
        { name: "activeUsers" },
        { name: "newUsers" },
        { name: "sessions" },
        { name: "engagedSessions" },
        { name: "engagementRate" },
        { name: "keyEvents" },
        { name: "totalRevenue" },
      ],
      offset: "0",
      limit: "25",
      orderBys: [
        { dimension: { dimensionName: "yearWeek" } },
        { dimension: { dimensionName: "sessionDefaultChannelGroup" } },
      ],
    });
    expect(fetchImpl.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });

  it("dates each GA4 week from its first day, across a year boundary", () => {
    // GA4 weeks start on Sunday and January 1st is always in week 01, so the
    // weeks around New Year are short and are not ISO weeks.
    const day = (value: string) => yearWeekStart(value)?.toISOString();
    expect(day("202552")).toBe("2025-12-21T00:00:00.000Z");
    expect(day("202553")).toBe("2025-12-28T00:00:00.000Z");
    expect(day("202601")).toBe("2026-01-01T00:00:00.000Z");
    expect(day("202602")).toBe("2026-01-04T00:00:00.000Z");
    // 2023 began on a Sunday: its week 01 is a full week.
    expect(day("202301")).toBe("2023-01-01T00:00:00.000Z");
    expect(day("202302")).toBe("2023-01-08T00:00:00.000Z");
    // A week that would start in the next year does not exist.
    expect(yearWeekStart("202654")).toBeNull();
    expect(yearWeekStart("202300")).toBeNull();
    expect(yearWeekStart("2026-01")).toBeNull();
  });

  it("starts an acquisition table with scoped measures and a true engagement rate", () => {
    const tableId = crypto.randomUUID();
    const measures = acquisitionMeasures(tableId);
    expect(
      measures.map(({ name, columnName, aggregation, format, contract }) => ({
        name,
        columnName,
        aggregation,
        format,
        contract,
      })),
    ).toEqual([
      {
        name: "Active users",
        columnName: "activeUsers",
        aggregation: "sum",
        format: undefined,
        contract: { kind: "non-additive" },
      },
      {
        name: "Sum of New users",
        columnName: "newUsers",
        aggregation: "sum",
        format: undefined,
        contract: {
          kind: "additive",
          additiveOver: ["time", "session"],
        },
      },
      {
        name: "Sum of Sessions",
        columnName: "sessions",
        aggregation: "sum",
        format: undefined,
        contract: {
          kind: "additive",
          additiveOver: ["time", "session"],
        },
      },
      {
        name: "Sum of Engaged sessions",
        columnName: "engagedSessions",
        aggregation: "sum",
        format: undefined,
        contract: {
          kind: "additive",
          additiveOver: ["time", "session"],
        },
      },
      {
        name: "Sum of Key events",
        columnName: "keyEvents",
        aggregation: "sum",
        format: undefined,
        contract: {
          kind: "additive",
          additiveOver: ["time", "session", "event"],
        },
      },
      {
        name: "Sum of Revenue",
        columnName: "totalRevenue",
        aggregation: "sum",
        format: { style: "currency" },
        contract: {
          kind: "additive",
          additiveOver: ["time", "session", "event"],
        },
      },
      {
        name: "Engagement rate",
        columnName: undefined,
        aggregation: "sum",
        format: { style: "percent" },
        contract: { kind: "ratio" },
      },
    ]);
    const byName = new Map(measures.map((measure) => [measure.name, measure]));
    expect(byName.get("Engagement rate")?.expression).toEqual({
      kind: "binary",
      operator: "divide",
      left: {
        kind: "measure",
        measureId: byName.get("Sum of Engaged sessions")?.id,
      },
      right: { kind: "measure", measureId: byName.get("Sum of Sessions")?.id },
    });
    expect(measures.every((measure) => measure.tableId === tableId)).toBe(true);
    expect(new Set(measures.map((measure) => measure.id)).size).toBe(7);

    const connector = (reportVersion: "v1" | "v2") =>
      makeGa4Connector(resolver(bundle()), { reportVersion });
    expect(connector("v2").defaultMeasures(tableId)).toHaveLength(7);
    expect(connector("v1").defaultMeasures(tableId)).toEqual([]);
  });

  it("preserves the legacy v1 report shape unless acquisition is explicit", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            dimensionHeaders: [{ name: "date" }],
            metricHeaders: [{ name: "activeUsers", type: "TYPE_INTEGER" }],
            rows: [
              {
                dimensionValues: [{ value: "20260805" }],
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

    const result = await connector.query("properties/123", crypto.randomUUID());

    expect(result.fields.map((field) => field.name)).toEqual([
      "date",
      "activeUsers",
    ]);
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({
      dateRanges: [{ startDate: "30daysAgo", endDate: "yesterday" }],
      dimensions: [{ name: "date" }],
      metrics: [{ name: "activeUsers" }],
      offset: "0",
      limit: "10000",
      orderBys: [{ dimension: { dimensionName: "date" } }],
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
    ).rejects.toThrow(/Invalid GA4 site id/);
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

    it("marks a revoked grant as needing a new sign-in, but not a Google outage", async () => {
      const refreshWith = (status: number) =>
        makeGa4Connector(resolver(bundle(expired)), {
          fetch: vi.fn(
            async () =>
              new Response(JSON.stringify({ error: "invalid_grant" }), {
                status,
              }),
          ) as unknown as typeof fetch,
          now,
          oauthClient,
        }).connect();

      await expect(refreshWith(400)).rejects.toBeInstanceOf(
        GoogleAuthorizationError,
      );
      const outage = await refreshWith(503).catch((error: unknown) => error);
      expect(outage).toBeInstanceOf(Error);
      expect(outage).not.toBeInstanceOf(GoogleAuthorizationError);
    });
  });
});
