import { describe, expect, it } from "vite-plus/test";
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
