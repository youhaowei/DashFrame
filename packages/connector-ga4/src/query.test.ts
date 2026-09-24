import { tableFromArrays, tableFromIPC, tableToIPC } from "apache-arrow";
import { describe, expect, it, vi } from "vite-plus/test";

import { GA4_PRESETS } from "./presets";
import {
  dimensionValue,
  legacyDefinition,
  reportBody,
  runReport,
  type RunReportResponse,
} from "./query";

const NOW = Date.parse("2026-09-24T12:00:00Z");

function responseFor(version: "v1" | "v2"): RunReportResponse {
  return version === "v1"
    ? {
        dimensionHeaders: [{ name: "date" }],
        metricHeaders: [{ name: "activeUsers", type: "TYPE_INTEGER" }],
        rows: [
          {
            dimensionValues: [{ value: "20260923" }],
            metricValues: [{ value: "42" }],
          },
        ],
      }
    : {
        dimensionHeaders: [
          { name: "yearWeek" },
          { name: "sessionDefaultChannelGroup" },
        ],
        metricHeaders: [
          { name: "activeUsers" },
          { name: "newUsers" },
          { name: "sessions" },
          { name: "engagedSessions" },
          { name: "engagementRate" },
          { name: "keyEvents" },
          { name: "totalRevenue" },
        ],
        rows: [
          {
            dimensionValues: [{ value: "202638" }, { value: "Organic Search" }],
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
      };
}

describe("GA4 report queries", () => {
  it("builds the runReport body for every preset at a fixed clock", () => {
    expect(
      Object.fromEntries(
        GA4_PRESETS.map((preset) => [
          preset.id,
          reportBody(preset.definition, 0, NOW),
        ]),
      ),
    ).toMatchSnapshot();
  });

  it("preserves the v1 bytes and v2 decoded schema and values", async () => {
    for (const version of ["v1", "v2"] as const) {
      const response = responseFor(version);
      let requestBody = "";
      const result = await runReport(
        "properties/123",
        legacyDefinition(version, NOW),
        {
          request: async (_url, init) => {
            requestBody = String(init?.body);
            return response;
          },
        },
        {
          tableId: crypto.randomUUID(),
          now: NOW,
          allowLegacyYearWeek: version === "v2",
          legacyDateRange: version === "v2" ? "90daysAgo" : "30daysAgo",
          page: { offset: 0, limit: 10_000, single: true },
        },
      );
      expect(requestBody).toBe(
        version === "v1"
          ? '{"dateRanges":[{"startDate":"30daysAgo","endDate":"yesterday"}],"dimensions":[{"name":"date"}],"metrics":[{"name":"activeUsers"}],"offset":"0","limit":"10000","orderBys":[{"dimension":{"dimensionName":"date"}}]}'
          : '{"dateRanges":[{"startDate":"90daysAgo","endDate":"yesterday"}],"dimensions":[{"name":"yearWeek"},{"name":"sessionDefaultChannelGroup"}],"metrics":[{"name":"activeUsers"},{"name":"newUsers"},{"name":"sessions"},{"name":"engagedSessions"},{"name":"engagementRate"},{"name":"keyEvents"},{"name":"totalRevenue"}],"offset":"0","limit":"10000","orderBys":[{"dimension":{"dimensionName":"yearWeek"}},{"dimension":{"dimensionName":"sessionDefaultChannelGroup"}}]}',
      );
      const expected =
        version === "v1"
          ? tableFromArrays({
              date: [new Date("2026-09-23T00:00:00.000Z")],
              activeUsers: [42],
            })
          : tableFromArrays({
              yearWeek: [new Date("2026-09-13T00:00:00.000Z")],
              sessionDefaultChannelGroup: ["Organic Search"],
              activeUsers: new Float64Array([42]),
              newUsers: new Float64Array([12]),
              sessions: new Float64Array([56]),
              engagedSessions: new Float64Array([31]),
              engagementRate: new Float64Array([0.5536]),
              keyEvents: new Float64Array([3]),
              totalRevenue: new Float64Array([98.75]),
            });
      const actualBytes = Buffer.from(result.arrowBuffer, "base64");
      const expectedBytes = Buffer.from(tableToIPC(expected));
      if (version === "v1") expect(actualBytes).toEqual(expectedBytes);
      const actualTable = tableFromIPC(actualBytes);
      const expectedTable = tableFromIPC(expectedBytes);
      // Dictionary IDs are process-global Arrow bookkeeping, so compare the
      // decoded schema and values for the string-bearing v2 fixture.
      expect(
        actualTable.schema.fields.map((field) => [
          field.name,
          String(field.type),
        ]),
      ).toEqual(
        expectedTable.schema.fields.map((field) => [
          field.name,
          String(field.type),
        ]),
      );
      expect(actualTable.toArray().map((row) => row.toJSON())).toEqual(
        expectedTable.toArray().map((row) => row.toJSON()),
      );
    }
  });

  it("fetches the second page when GA4 reports 250,001 rows", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const firstPageRow = {
      dimensionValues: [{ value: "20260901" }],
      metricValues: [{ value: "1" }],
    };
    const result = await runReport(
      "123",
      {
        dimensions: ["date"],
        metrics: ["sessions"],
        grain: "day",
        dateRange: { kind: "absolute", start: "2026-09-01", end: "2026-09-23" },
      },
      {
        request: async (_url, init) => {
          requests.push(
            JSON.parse(String(init?.body)) as Record<string, unknown>,
          );
          const page = requests.length;
          return {
            dimensionHeaders: [{ name: "date" }],
            metricHeaders: [{ name: "sessions" }],
            rowCount: 250_001,
            propertyQuota: { tokensPerDay: { consumed: page } },
            rows:
              page === 1
                ? Array.from({ length: 250_000 }, () => firstPageRow)
                : [
                    {
                      dimensionValues: [{ value: "20260902" }],
                      metricValues: [{ value: "2" }],
                    },
                  ],
          };
        },
      },
      { tableId: crypto.randomUUID(), now: NOW },
    );

    expect(requests.map((body) => body.offset)).toEqual(["0", "250000"]);
    expect(result.rowCount).toBe(250_001);
    expect(debug).toHaveBeenLastCalledWith("[GA4Connector] property quota", {
      tokensPerDayConsumed: 2,
    });
    debug.mockRestore();
  }, 15_000);

  it("pages without rowCount until GA4 returns a short page", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const fullPageRow = {
      dimensionValues: [{ value: "20260901" }],
      metricValues: [{ value: "1" }],
    };
    const result = await runReport(
      "123",
      {
        dimensions: ["date"],
        metrics: ["sessions"],
        grain: "day",
        dateRange: { kind: "absolute", start: "2026-09-01", end: "2026-09-23" },
      },
      {
        request: async (_url, init) => {
          requests.push(
            JSON.parse(String(init?.body)) as Record<string, unknown>,
          );
          return {
            dimensionHeaders: [{ name: "date" }],
            metricHeaders: [{ name: "sessions" }],
            rows:
              requests.length === 1
                ? Array.from({ length: 250_000 }, () => fullPageRow)
                : [],
          };
        },
      },
      { tableId: crypto.randomUUID(), now: NOW },
    );
    expect(requests.map((body) => body.offset)).toEqual(["0", "250000"]);
    expect(result.rowCount).toBe(250_000);
  }, 15_000);

  it("fails when a reported total does not match the collected rows", async () => {
    await expect(
      runReport(
        "123",
        {
          dimensions: ["date"],
          metrics: ["sessions"],
          grain: "day",
          dateRange: {
            kind: "absolute",
            start: "2026-09-01",
            end: "2026-09-23",
          },
        },
        {
          request: async () => ({
            dimensionHeaders: [{ name: "date" }],
            metricHeaders: [{ name: "sessions" }],
            rowCount: 2,
            rows: [
              {
                dimensionValues: [{ value: "20260901" }],
                metricValues: [{ value: "1" }],
              },
            ],
          }),
        },
        { tableId: crypto.randomUUID(), now: NOW },
      ),
    ).rejects.toThrow("Expected 2 report rows but received 1");
  });

  it("keeps empty Arrow schemas aligned with declared field types", async () => {
    const result = await runReport(
      "123",
      {
        dimensions: ["date", "eventName"],
        metrics: ["eventCount"],
        grain: "day",
        dateRange: { kind: "absolute", start: "2026-09-01", end: "2026-09-23" },
      },
      {
        request: async () => ({
          dimensionHeaders: [{ name: "date" }, { name: "eventName" }],
          metricHeaders: [{ name: "eventCount" }],
          rowCount: 0,
          rows: [],
        }),
      },
      { tableId: crypto.randomUUID(), now: NOW },
    );
    expect(
      tableFromIPC(Buffer.from(result.arrowBuffer, "base64")).schema.fields.map(
        (field) => [field.name, String(field.type)],
      ),
    ).toEqual([
      ["date", "Timestamp<MILLISECOND>"],
      ["eventName", "Dictionary<Int32, Utf8>"],
      ["eventCount", "Float64"],
    ]);
  });

  it("shares maxResponseBytes across report pages", async () => {
    const responses: RunReportResponse[] = [
      {
        dimensionHeaders: [{ name: "date" }],
        metricHeaders: [{ name: "sessions" }],
        rowCount: 250_001,
        rows: [
          {
            dimensionValues: [{ value: "20260901" }],
            metricValues: [{ value: "1" }],
          },
        ],
      },
      {
        dimensionHeaders: [{ name: "date" }],
        metricHeaders: [{ name: "sessions" }],
        rowCount: 250_001,
        rows: [
          {
            dimensionValues: [{ value: "20260902" }],
            metricValues: [{ value: "2" }],
          },
        ],
      },
    ];
    const responseSizes = responses.map(
      (response) =>
        new TextEncoder().encode(JSON.stringify(response)).byteLength,
    );
    const budgets: Array<number | undefined> = [];
    await expect(
      runReport(
        "123",
        {
          dimensions: ["date"],
          metrics: ["sessions"],
          grain: "day",
          dateRange: {
            kind: "absolute",
            start: "2026-09-01",
            end: "2026-09-23",
          },
        },
        {
          request: async () => {
            throw new Error("unmeasured request should not run");
          },
          requestMeasured: async (_url, _init, maxResponseBytes) => {
            budgets.push(maxResponseBytes);
            const body = responses[budgets.length - 1]!;
            return {
              body,
              byteLength: responseSizes[budgets.length - 1]!,
            };
          },
        },
        {
          tableId: crypto.randomUUID(),
          now: NOW,
          maxResponseBytes: responseSizes[0]! + responseSizes[1]! - 1,
        },
      ),
    ).rejects.toThrow("SOURCE_RESULT_TOO_LARGE");
    expect(budgets).toEqual([
      responseSizes[0]! + responseSizes[1]! - 1,
      responseSizes[1]! - 1,
    ]);
  });

  it("reports an exhausted byte budget before requesting another page", async () => {
    const response: RunReportResponse = {
      dimensionHeaders: [{ name: "date" }],
      metricHeaders: [{ name: "sessions" }],
      rowCount: 250_001,
      rows: [
        {
          dimensionValues: [{ value: "20260901" }],
          metricValues: [{ value: "1" }],
        },
      ],
    };
    const responseBytes = new TextEncoder().encode(
      JSON.stringify(response),
    ).byteLength;
    const request = vi.fn(async () => response);
    const requestMeasured = vi.fn(async () => ({
      body: response,
      byteLength: responseBytes,
    }));

    await expect(
      runReport(
        "123",
        {
          dimensions: ["date"],
          metrics: ["sessions"],
          grain: "day",
          dateRange: {
            kind: "absolute",
            start: "2026-09-01",
            end: "2026-09-23",
          },
        },
        { request, requestMeasured },
        {
          tableId: crypto.randomUUID(),
          now: NOW,
          maxResponseBytes: responseBytes,
        },
      ),
    ).rejects.toThrow("SOURCE_RESULT_TOO_LARGE");
    expect(requestMeasured).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
  });

  it("debits the response budget by transport-measured bytes", async () => {
    const response: RunReportResponse = {
      dimensionHeaders: [{ name: "date" }],
      metricHeaders: [{ name: "sessions" }],
      rowCount: 250_001,
      rows: [
        {
          dimensionValues: [{ value: "20260901" }],
          metricValues: [{ value: "1" }],
        },
      ],
    };
    const minifiedBytes = new TextEncoder().encode(
      JSON.stringify(response),
    ).byteLength;
    const request = vi.fn(async () => response);
    const requestMeasured = vi.fn(async () => ({
      body: response,
      byteLength: minifiedBytes + 64,
    }));

    await expect(
      runReport(
        "123",
        {
          dimensions: ["date"],
          metrics: ["sessions"],
          grain: "day",
          dateRange: {
            kind: "absolute",
            start: "2026-09-01",
            end: "2026-09-23",
          },
        },
        { request, requestMeasured },
        {
          tableId: crypto.randomUUID(),
          now: NOW,
          maxResponseBytes: minifiedBytes + 63,
        },
      ),
    ).rejects.toThrow("SOURCE_RESULT_TOO_LARGE");
    expect(requestMeasured).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects a byte budget when the client cannot measure transport bytes", async () => {
    const response: RunReportResponse = {
      dimensionHeaders: [{ name: "date" }],
      metricHeaders: [{ name: "sessions" }],
      rowCount: 1,
      rows: [
        {
          dimensionValues: [{ value: "20260901" }],
          metricValues: [{ value: "1" }],
        },
      ],
    };
    const request = vi.fn(async () => response);
    await expect(
      runReport(
        "123",
        {
          dimensions: ["date"],
          metrics: ["sessions"],
          grain: "day",
          dateRange: {
            kind: "absolute",
            start: "2026-09-01",
            end: "2026-09-23",
          },
        },
        { request },
        {
          tableId: crypto.randomUUID(),
          now: NOW,
          maxResponseBytes: 1,
        },
      ),
    ).rejects.toThrow("Response byte budget requires transport measurement");
    expect(request).not.toHaveBeenCalled();
  });

  it("applies maxRows to a requested legacy page, not the whole report", async () => {
    const result = await runReport(
      "123",
      legacyDefinition("v1", NOW),
      {
        request: async () => ({
          dimensionHeaders: [{ name: "date" }],
          metricHeaders: [{ name: "activeUsers" }],
          rowCount: 250_000,
          rows: [
            {
              dimensionValues: [{ value: "20260901" }],
              metricValues: [{ value: "1" }],
            },
          ],
        }),
      },
      {
        tableId: crypto.randomUUID(),
        now: NOW,
        maxRows: 1,
        legacyDateRange: "30daysAgo",
        page: { offset: 0, limit: 1, single: true },
      },
    );
    expect(result.rowCount).toBe(1);
  });

  it("keeps Arrow types stable for populated, all-null, and empty results", async () => {
    const definition = {
      dimensions: ["date", "eventName"],
      metrics: ["eventCount"],
      grain: "day" as const,
      dateRange: {
        kind: "absolute" as const,
        start: "2026-09-01",
        end: "2026-09-23",
      },
    };
    const schemaFor = async (rows: NonNullable<RunReportResponse["rows"]>) => {
      const result = await runReport(
        "123",
        definition,
        {
          request: async () => ({
            dimensionHeaders: [{ name: "date" }, { name: "eventName" }],
            metricHeaders: [{ name: "eventCount" }],
            rowCount: rows.length,
            rows,
          }),
        },
        { tableId: crypto.randomUUID(), now: NOW },
      );
      return tableFromIPC(
        Buffer.from(result.arrowBuffer, "base64"),
      ).schema.fields.map((field) => [field.name, String(field.type)]);
    };
    const populated = await schemaFor([
      {
        dimensionValues: [{ value: "20260901" }, { value: "purchase" }],
        metricValues: [{ value: "1" }],
      },
    ]);
    const allNull = await schemaFor([
      {
        dimensionValues: [{ value: "bad-date" }, {}],
        metricValues: [{}],
      },
    ]);
    expect(allNull).toEqual(populated);
    expect(await schemaFor([])).toEqual(populated);
  });

  it("parses ISO weeks from Monday and year-month values from month start", () => {
    expect(
      (dimensionValue("isoYearIsoWeek", "202601") as Date).toISOString(),
    ).toBe("2025-12-29T00:00:00.000Z");
    expect((dimensionValue("yearMonth", "202602") as Date).toISOString()).toBe(
      "2026-02-01T00:00:00.000Z",
    );
  });
});
