import { describe, expect, it } from "vite-plus/test";
import { Table, tableToIPC, vectorFromArray } from "apache-arrow";
import {
  fieldIdToColumnAlias,
  frameTableName,
  metricIdToColumnAlias,
} from "@dashframe/engine";
import { NativeDuckDBEngine } from "@dashframe/engine-server";
import type { DataTable, Field, UUID } from "@dashframe/types";

import type { HostContext } from "../context";
import type { EffectiveInsightDefinition } from "./materializer";
import {
  completedProductionReplayScope,
  productionMaterializerDependencies,
  productionMaterializationScope,
} from "./production";

const tableId = "10000000-0000-4000-8000-000000000001";
const frameId = "10000000-0000-4000-8000-000000000002";
const countryId = "20000000-0000-4000-8000-000000000001";
const channelId = "20000000-0000-4000-8000-000000000002";
const dateId = "20000000-0000-4000-8000-000000000003";
const revenueFieldId = "20000000-0000-4000-8000-000000000004";
const revenueMetricId = "30000000-0000-4000-8000-000000000001";
const ordersMetricId = "30000000-0000-4000-8000-000000000002";
const fields: Field[] = [
  {
    id: countryId,
    tableId,
    name: "Country",
    columnName: "country",
    type: "string",
  },
  {
    id: channelId,
    tableId,
    name: "Channel",
    columnName: "channel",
    type: "string",
  },
  {
    id: dateId,
    tableId,
    name: "Date",
    columnName: "occurred_at",
    type: "date",
  },
  {
    id: revenueFieldId,
    tableId,
    name: "Revenue",
    columnName: "revenue",
    type: "number",
  },
];
const dataTable: DataTable = {
  id: tableId,
  dataSourceId: "source-1",
  name: "Sales",
  table: "sales",
  fields,
  metrics: [],
  dataFrameId: frameId,
  createdAt: 0,
};
const metrics = [
  {
    id: revenueMetricId,
    name: "Revenue",
    sourceTable: tableId,
    columnName: "revenue",
    aggregation: "sum" as const,
  },
  {
    id: ordersMetricId,
    name: "Orders",
    sourceTable: tableId,
    aggregation: "count" as const,
  },
];

function arrowWithColumns(names: readonly string[]): Uint8Array {
  return tableToIPC(
    new Table(
      Object.fromEntries(names.map((name) => [name, vectorFromArray([1])])),
    ),
  );
}

function inspect(
  insight: EffectiveInsightDefinition,
  names: readonly string[],
) {
  return productionMaterializerDependencies().inspect(arrowWithColumns(names), {
    insight,
    tables: new Map([[tableId, dataTable]]),
  });
}

describe("production result inspection", () => {
  it("accepts a presentation that omits a selected dimension", () => {
    const country = fieldIdToColumnAlias(countryId);
    const revenue = metricIdToColumnAlias(revenueMetricId);

    expect(
      inspect(
        {
          baseTableId: tableId,
          selectedFields: [countryId, channelId],
          metrics,
          presentation: { dimensions: [countryId] },
        },
        [country, revenue, metricIdToColumnAlias(ordersMetricId)],
      ).schema.map((column) => column.id),
    ).toEqual([country, revenue, metricIdToColumnAlias(ordersMetricId)]);
  });

  it("accepts a no-dimension presentation aggregate", () => {
    const revenue = metricIdToColumnAlias(revenueMetricId);
    expect(
      inspect(
        {
          baseTableId: tableId,
          selectedFields: [countryId],
          metrics: [metrics[0]!],
          presentation: { dimensions: [] },
        },
        [revenue],
      ).schema.map((column) => column.id),
    ).toEqual([revenue]);
  });

  it("reports categorical date presentation columns with transformed types", () => {
    const date = fieldIdToColumnAlias(dateId);
    const schema = inspect(
      {
        baseTableId: tableId,
        selectedFields: [dateId],
        metrics: [metrics[0]!],
        presentation: {
          dimensions: [dateId],
          transforms: {
            [dateId]: { kind: "categorical", groupBy: "monthName" },
          },
        },
      },
      [date, metricIdToColumnAlias(revenueMetricId)],
    ).schema;

    expect(schema[0]).toMatchObject({ id: date, type: "string" });
  });

  it("accepts canonical totals, selected measures, and comparison aliases", () => {
    const country = fieldIdToColumnAlias(countryId);
    const revenue = metricIdToColumnAlias(revenueMetricId);
    const names = [
      country,
      revenue,
      `${revenue}_previous`,
      `${revenue}_change`,
      `${revenue}_change_percent`,
      "__report_grouping",
    ];
    const schema = inspect(
      {
        baseTableId: tableId,
        selectedFields: [countryId],
        metrics,
        reporting: {
          totals: true,
          measureIds: [revenueMetricId],
          comparison: "previous_period",
        },
      },
      names,
    ).schema;

    expect(schema.map((column) => column.id)).toEqual(names);
    expect(
      schema.find((column) => column.id === `${revenue}_previous`),
    ).toMatchObject({
      type: "number",
    });
  });

  it("accepts an actual compiled canonical totals and comparison frame", async () => {
    const engine = new NativeDuckDBEngine();
    try {
      await engine.initialize();
      await engine.registerArrowTable(
        frameTableName(frameId),
        tableToIPC(
          new Table({
            country: vectorFromArray(["US", "US", "CA"]),
            channel: vectorFromArray(["web", "web", "store"]),
            occurred_at: vectorFromArray([
              new Date("2025-12-10T00:00:00.000Z"),
              new Date("2026-01-10T00:00:00.000Z"),
              new Date("2026-01-11T00:00:00.000Z"),
            ]),
            revenue: vectorFromArray([5, 10, 20]),
          }),
        ),
      );
      const insight: EffectiveInsightDefinition = {
        baseTableId: tableId,
        selectedFields: [countryId],
        metrics,
        reporting: {
          totals: true,
          measureIds: [revenueMetricId],
          dateRange: {
            fieldId: dateId,
            range: {
              type: "absolute",
              start: "2026-01-01T00:00:00.000Z",
              end: "2026-02-01T00:00:00.000Z",
            },
          },
          comparison: "previous_period",
        },
      };
      const dependencies = productionMaterializerDependencies();
      const tables = new Map<UUID, DataTable>([[tableId, dataTable]]);
      const sql = dependencies.compile({ insight, tables });
      const result = await engine.queryArrow(sql);

      expect(dependencies.inspect(result, { insight, tables }).schema).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: metricIdToColumnAlias(revenueMetricId),
          }),
          expect.objectContaining({ id: "__report_grouping" }),
          expect.objectContaining({
            id: `${metricIdToColumnAlias(revenueMetricId)}_change_percent`,
          }),
        ]),
      );
    } finally {
      await engine.dispose();
    }
  });
});

describe("production presentation sources", () => {
  it("reuses a remote published generation without connector acquisition", async () => {
    const table = {
      id: "table-1",
      dataSourceId: "source-1",
      name: "Remote",
      table: "database-id",
      fields: [],
      metrics: [],
      dataFrameId: "published-frame",
      lastFetchedAt: 456,
      createdAt: 0,
    };
    const context = {
      workspaceOwnerId: "workspace-owner",
      metadata: {
        getDataTable: async () => table,
        getDataSource: async () => ({
          id: "source-1",
          kind: "notion",
          config: {},
        }),
      },
    } as unknown as HostContext;
    const resolveSource = productionMaterializerDependencies().resolveSource;

    const reused = await resolveSource(
      context,
      "table-1",
      undefined,
      undefined,
      true,
    );
    expect(reused).toMatchObject({
      existingFrameId: "published-frame",
      table: { id: "table-1", lastFetchedAt: 456 },
      provenance: { connectorKind: "notion", bindingVersion: "v1" },
    });
  });
});

describe("completed production replay scope", () => {
  it("replaces only generations published by the completed materialization", () => {
    const scope = JSON.stringify([
      "runtime-1",
      { kind: "user", userId: "user" },
      { kind: "saved", insightId: "insight" },
      { baseTableId: "base" },
      [
        ["table", "base", "old-base", 1],
        ["table", "unchanged", "existing-frame", 2],
      ],
    ]);

    const replay = completedProductionReplayScope(scope, {
      sourceGenerations: [
        {
          tableId: "base",
          dataFrameId: "published-base",
          lastFetchedAt: 3,
        },
      ],
    });

    expect(JSON.parse(replay!)[4]).toEqual([
      ["table", "base", "published-base", 3],
      ["table", "unchanged", "existing-frame", 2],
    ]);
  });

  it("matches the scope recomputed after publication", async () => {
    let table = {
      id: "base",
      dataFrameId: "old-frame",
      lastFetchedAt: 1,
    };
    const context = {
      principal: { kind: "user", userId: "user" },
      metadata: { getDataTable: async () => table },
    } as unknown as HostContext;
    const target = { kind: "saved", insightId: "insight" } as const;
    const insight = {
      baseTableId: "base",
      selectedFields: [],
      metrics: [],
    };
    const before = await productionMaterializationScope(
      "runtime-1",
      context,
      target,
      insight,
    );
    const result = {
      sourceGenerations: [
        { tableId: "base", dataFrameId: "new-frame", lastFetchedAt: 2 },
      ],
    };
    table = { id: "base", dataFrameId: "new-frame", lastFetchedAt: 2 };
    const after = await productionMaterializationScope(
      "runtime-1",
      context,
      target,
      insight,
    );

    expect(completedProductionReplayScope(before, result)).toBe(after);
  });

  it("does not replay an explicit refresh", () => {
    const scope = JSON.stringify([
      "runtime-1",
      { kind: "user", userId: "user" },
      { kind: "refresh" },
      { baseTableId: "base" },
      [["table", "base", "old-frame", 1]],
    ]);

    expect(
      completedProductionReplayScope(scope, {
        sourceGenerations: [
          { tableId: "base", dataFrameId: "new-frame", lastFetchedAt: 2 },
        ],
      }),
    ).toBeUndefined();
  });
});
