/// <reference types="vite/client" />
import { internal } from "@dashframe/convex-backend/api";
import schema from "@dashframe/convex-backend/schema";
import type { Field, Metric } from "@dashframe/types";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { HostContext } from "./context";
import { createHostMetadata } from "./convex-metadata";
import { prepareRemoteDataTable } from "./connectors";

const modules = import.meta.glob(
  "../../../../packages/convex-backend/convex/**/*.ts",
);

/** One acquisition row shaped like the Data API's runReport response. */
const runReport = {
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
      dimensionValues: [{ value: "202601" }, { value: "Organic Search" }],
      metricValues: ["42", "12", "56", "31", "0.55", "3", "98.75"].map(
        (value) => ({ value }),
      ),
    },
  ],
};

async function importedTable(sourceBindingVersion: "v1" | "v2") {
  const native = convexTest(schema, modules);
  const dataSourceId = crypto.randomUUID(),
    tableId = crypto.randomUUID();
  const count: Metric = {
    id: crypto.randomUUID(),
    name: "Count",
    tableId,
    aggregation: "count",
  };
  await native.run(async (ctx) => {
    await ctx.db.insert("dataSources", {
      workspaceId: "workspace",
      id: dataSourceId,
      revision: 1,
      name: "Google Analytics 4",
      kind: "googleAnalytics",
      config: {
        apiKey: `secret:${crypto.randomUUID()}`,
        sourceBindingVersion,
      },
      createdAt: 0,
    });
    // What the import creates before discovery: a named table with only Count.
    await ctx.db.insert("dataTables", {
      workspaceId: "workspace",
      id: tableId,
      revision: 1,
      name: "Lumina LaBelle",
      dataSourceId,
      table: "properties/123",
      fields: [],
      metrics: [count],
      sourceSchema: null,
      createdAt: 0,
    });
  });
  const bundle = JSON.stringify({
    version: 1,
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresAt: Date.now() + 3_600_000,
    clientId: "client-id",
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
  });
  const ctx = {
    principal: { kind: "user", userId: "local-user" },
    vault: {
      withSecret: <T>(_ref: string, use: (plaintext: string) => Promise<T>) =>
        use(bundle),
    },
    metadata: createHostMetadata(native as never, "workspace"),
  } as unknown as HostContext;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(runReport))),
  );
  await prepareRemoteDataTable(ctx, { id: tableId });
  const table = (await native.query(internal.host.getDataTable, {
    workspaceId: "workspace",
    id: tableId,
  })) as { name: string; fields: Field[]; metrics: Metric[] };
  return { table, count, ctx, tableId };
}

describe("importing a GA4 property", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("names the columns for people and starts with acquisition measures", async () => {
    const { table } = await importedTable("v2");

    expect(table.name).toBe("Lumina LaBelle");
    expect(
      table.fields.map(({ name, columnName, type }) => [
        name,
        columnName,
        type,
      ]),
    ).toEqual([
      ["Week", "yearWeek", "date"],
      ["Channel", "sessionDefaultChannelGroup", "string"],
      ["Active users", "activeUsers", "number"],
      ["New users", "newUsers", "number"],
      ["Sessions", "sessions", "number"],
      ["Engaged sessions", "engagedSessions", "number"],
      ["Engagement rate", "engagementRate", "number"],
      ["Key events", "keyEvents", "number"],
      ["Revenue", "totalRevenue", "number"],
    ]);
    expect(table.metrics.map(({ name, format }) => ({ name, format }))).toEqual(
      [
        { name: "Sum of Active users", format: undefined },
        { name: "Sum of New users", format: undefined },
        { name: "Sum of Sessions", format: undefined },
        { name: "Sum of Engaged sessions", format: undefined },
        { name: "Sum of Key events", format: undefined },
        { name: "Sum of Revenue", format: { style: "currency" } },
        { name: "Engagement rate", format: { style: "percent" } },
      ],
    );
    const byName = new Map(
      table.metrics.map((metric) => [metric.name, metric]),
    );
    expect(byName.get("Engagement rate")?.expression).toEqual({
      kind: "binary",
      operator: "divide",
      left: {
        kind: "measure",
        measureId: byName.get("Sum of Engaged sessions")?.id,
      },
      right: { kind: "measure", measureId: byName.get("Sum of Sessions")?.id },
    });
  });

  it("keeps the table's measures when discovery runs again", async () => {
    const { table, ctx, tableId } = await importedTable("v2");
    await prepareRemoteDataTable(ctx, { id: tableId });
    const again = await ctx.metadata.getDataTable(tableId);
    expect((again as { metrics: Metric[] }).metrics).toEqual(table.metrics);
  });

  it("leaves a legacy report's table with its Count", async () => {
    const { table, count } = await importedTable("v1");
    expect(table.metrics).toEqual([count]);
  });
});
