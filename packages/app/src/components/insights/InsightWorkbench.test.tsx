import { describe, expect, it } from "vite-plus/test";
import { fieldIdToColumnAlias } from "@dashframe/engine";
import type { DataTable, Insight, UUID } from "@dashframe/types";

import {
  buildInsightModelMetadata,
  canChangeSavedVisualizationType,
  MAX_DOT_ROW_COUNT,
} from "./InsightWorkbench";

describe("buildInsightModelMetadata", () => {
  it("keeps unselected declared dimensions in the workbench switcher catalog", () => {
    const tableId = "10000000-0000-4000-8000-000000000010" as UUID;
    const dateId = "10000000-0000-4000-8000-000000000011" as UUID;
    const channelId = "10000000-0000-4000-8000-000000000012" as UUID;
    const countryId = "10000000-0000-4000-8000-000000000013" as UUID;
    const table = {
      id: tableId,
      name: "Orders",
      dataFrameId: "orders-frame",
      fields: [
        { id: dateId, tableId, name: "Date", type: "date" },
        { id: channelId, tableId, name: "Channel", type: "string" },
        { id: countryId, tableId, name: "Country", type: "string" },
      ],
    } as DataTable;
    const report = {
      id: "10000000-0000-4000-8000-000000000014",
      name: "Orders report",
      source: { sourceType: "dataTable", sourceId: tableId },
      selectedFields: [dateId, channelId],
      metrics: [],
      joins: [],
      runtimeControls: {
        dimensions: {
          allowedIds: [dateId, channelId, countryId],
          maxSelected: 2,
        },
      },
      createdAt: 0,
    } as Insight;

    const metadata = buildInsightModelMetadata(report, table, [table]);

    expect(metadata.fields.map((field) => field.id)).toEqual([
      dateId,
      channelId,
      countryId,
    ]);
  });

  it("labels an unselected repeat-join metric source without materializing rows", () => {
    const ordersId = "10000000-0000-4000-8000-000000000001" as UUID;
    const usersId = "10000000-0000-4000-8000-000000000002" as UUID;
    const userId = "10000000-0000-4000-8000-000000000003" as UUID;
    const userNameId = "10000000-0000-4000-8000-000000000004" as UUID;
    const orders = {
      id: ordersId,
      name: "Orders",
      dataFrameId: "orders-frame",
      fields: [
        {
          id: "10000000-0000-4000-8000-000000000005",
          tableId: ordersId,
          name: "Created by",
          columnName: "created_by",
          type: "string",
        },
        {
          id: "10000000-0000-4000-8000-000000000006",
          tableId: ordersId,
          name: "Approved by",
          columnName: "approved_by",
          type: "string",
        },
      ],
    } as DataTable;
    const users = {
      id: usersId,
      name: "Users",
      dataFrameId: "users-frame",
      fields: [
        {
          id: userId,
          tableId: usersId,
          name: "ID",
          columnName: "id",
          type: "string",
        },
        {
          id: userNameId,
          tableId: usersId,
          name: "User name",
          columnName: "name",
          type: "string",
        },
      ],
    } as DataTable;
    const insight = {
      id: "10000000-0000-4000-8000-000000000007",
      name: "Approvals",
      source: { sourceType: "insight", sourceId: "upstream-insight" },
      selectedFields: [],
      metrics: [
        {
          id: "10000000-0000-4000-8000-000000000008",
          name: "Approver count",
          aggregation: "count_distinct",
          columnName: `${fieldIdToColumnAlias(userNameId)}_j1`,
        },
      ],
      joins: [
        { rightTableId: usersId, leftKey: "created_by", rightKey: "id" },
        { rightTableId: usersId, leftKey: "approved_by", rightKey: "id" },
      ],
      createdAt: 0,
    } as Insight;

    const metadata = buildInsightModelMetadata(insight, orders, [
      orders,
      users,
    ]);

    expect(
      metadata.columnDisplayNames[`${fieldIdToColumnAlias(userNameId)}_j1`],
    ).toBe("User name (approved_by)");
  });
});

describe("canChangeSavedVisualizationType", () => {
  const numericAnalysis = [
    { columnName: "amount", dataType: "DOUBLE", semantic: "numerical" },
    { columnName: "quantity", dataType: "DOUBLE", semantic: "numerical" },
  ] as never;
  const compiledInsight = { metrics: [], dimensions: [] } as never;
  const densityVisualization = {
    visualizationType: "hexbin" as const,
    encoding: { x: "amount", y: "quantity" },
  };

  it("allows Dot at 10000 rows and blocks it above the raw-point limit", () => {
    const common = {
      visualization: densityVisualization,
      chartType: "dot" as const,
      encodingsReady: true,
      encodingColumnAnalysis: numericAnalysis,
      compiledInsight,
    };

    expect(
      canChangeSavedVisualizationType({
        ...common,
        encodingRowCount: MAX_DOT_ROW_COUNT,
      }),
    ).toBe(true);
    expect(
      canChangeSavedVisualizationType({
        ...common,
        encodingRowCount: MAX_DOT_ROW_COUNT + 1,
      }),
    ).toBe(false);
  });

  it("keeps the current Dot visualization available above the limit", () => {
    expect(
      canChangeSavedVisualizationType({
        visualization: {
          ...densityVisualization,
          visualizationType: "dot",
        },
        chartType: "dot",
        encodingsReady: true,
        encodingRowCount: MAX_DOT_ROW_COUNT + 1,
        encodingColumnAnalysis: numericAnalysis,
        compiledInsight,
      }),
    ).toBe(true);
  });
});
