import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import { csvToDataFrame, parseCSV } from "@dashframe/csv";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { SampleSeedProjectFixture } from "./sample-data-seed.fixture";
import { seedCsvTable } from "./sample-data-seed";

const samplePath = (name: string) =>
  new URL(`../sample-data/${name}.csv`, import.meta.url);

describe("sample CSV project seeding", () => {
  let project: SampleSeedProjectFixture;

  beforeEach(async () => {
    project = new SampleSeedProjectFixture();
    await project.initialize();
  });

  afterEach(async () => {
    await project.dispose();
  });

  it("creates one source and one queryable table, then reuses both on retry", async () => {
    const csvContent = await readFile(samplePath("orders"), "utf8");

    const first = await seedCsvTable(project.application, {
      csvContent,
      tableName: "orders",
    });
    const second = await seedCsvTable(project.application, {
      csvContent,
      tableName: "orders",
    });

    expect(second).toEqual(first);
    expect(project.sources.size).toBe(1);
    expect(project.tables.size).toBe(1);
    expect(project.frames.size).toBe(1);
    expect(
      await project.queryFrame(
        first.dataFrameId,
        "SELECT channel, revenue FROM $TABLE ORDER BY order_id LIMIT 1",
      ),
    ).toEqual([{ channel: "Organic Search", revenue: 83.25 }]);
  });

  it("converges concurrent seeds from distinct principal-bound applications", async () => {
    const csvContent = await readFile(samplePath("orders"), "utf8");
    const firstApplication = project.forPrincipalApplication();
    const secondApplication = project.forPrincipalApplication();
    project.synchronizeNextSourceReads(2);

    expect(firstApplication).not.toBe(secondApplication);

    const [first, second] = await Promise.all([
      seedCsvTable(firstApplication, { csvContent, tableName: "orders" }),
      seedCsvTable(secondApplication, { csvContent, tableName: "orders" }),
    ]);

    expect(second).toEqual(first);
    expect(project.sources.size).toBe(1);
    expect(project.tables.size).toBe(1);
    expect(project.frames.size).toBe(1);
    expect(
      await project.queryFrame(
        first.dataFrameId,
        "SELECT COUNT(*) AS count FROM $TABLE",
      ),
    ).toEqual([{ count: first.rowCount }]);
  });

  it("seeds a fresh queryable frame after the workspace is cleared", async () => {
    const csvContent = await readFile(samplePath("orders"), "utf8");
    const first = await seedCsvTable(project.application, {
      csvContent,
      tableName: "orders",
    });

    project.clearWorkspace();
    const reseeded = await seedCsvTable(project.application, {
      csvContent,
      tableName: "orders",
    });

    expect(reseeded.dataFrameId).not.toBe(first.dataFrameId);
    expect(reseeded.rowCount).toBe(first.rowCount);
    expect(
      await project.queryFrame(
        reseeded.dataFrameId,
        "SELECT COUNT(*) AS count FROM $TABLE",
      ),
    ).toEqual([{ count: first.rowCount }]);
  });

  it("replaces an intact table when the CSV content changes", async () => {
    const csvContent = await readFile(samplePath("orders"), "utf8");
    const first = await seedCsvTable(project.application, {
      csvContent,
      tableName: "orders",
    });
    const changedCsv = `${csvContent}O99999,C0001,2025-09-30,Direct,42.00,1,West\n`;

    const reseeded = await seedCsvTable(project.application, {
      csvContent: changedCsv,
      tableName: "orders",
    });

    expect(reseeded.dataFrameId).not.toBe(first.dataFrameId);
    expect(reseeded.rowCount).toBe(first.rowCount + 1);
    expect(
      await project.queryFrame(
        reseeded.dataFrameId,
        "SELECT revenue FROM $TABLE WHERE order_id = 'O99999'",
      ),
    ).toEqual([{ revenue: 42 }]);
    expect(
      await seedCsvTable(project.application, {
        csvContent: changedCsv,
        tableName: "orders",
      }),
    ).toEqual(reseeded);
    expect(project.frames.size).toBe(1);
  });

  it("preserves saved insight field and metric references across replacement", async () => {
    const csvContent = await readFile(samplePath("orders"), "utf8");
    const seeded = await seedCsvTable(project.application, {
      csvContent,
      tableName: "orders",
    });
    const table = project.tables.get(seeded.dataTableId)!;
    const revenueField = table.fields.find(
      (field) => field.columnName === "revenue",
    )!;
    const revenueMetric = {
      id: randomUUID(),
      name: "Revenue",
      tableId: seeded.dataTableId,
      columnName: "revenue",
      aggregation: "sum" as const,
    };
    await project.application.execute("addMetric", {
      nodeId: seeded.dataTableId,
      metric: revenueMetric,
    });
    const insightId = randomUUID();
    await project.application.execute("createInsightCmd", {
      id: insightId,
      name: "Revenue by channel",
      source: { sourceType: "dataTable", sourceId: seeded.dataTableId },
      selectedFields: [revenueField.id],
      metrics: [
        {
          id: revenueMetric.id,
          name: revenueMetric.name,
          sourceTable: seeded.dataTableId,
          columnName: revenueMetric.columnName,
          aggregation: revenueMetric.aggregation,
        },
      ],
    });

    await seedCsvTable(project.application, {
      csvContent: `${csvContent}O99999,C0001,2025-09-30,Direct,42.00,1,West\n`,
      tableName: "orders",
    });

    const replacedTable = project.tables.get(seeded.dataTableId)!;
    const insight = project.insights.get(insightId)!;
    expect(
      replacedTable.fields.find((field) => field.columnName === "revenue")?.id,
    ).toBe(revenueField.id);
    expect(
      insight.selectedFields.every((fieldId) =>
        replacedTable.fields.some((field) => field.id === fieldId),
      ),
    ).toBe(true);
    expect(
      insight.metrics.every((metric) =>
        replacedTable.metrics.some((candidate) => candidate.id === metric.id),
      ),
    ).toBe(true);
  });
});

describe("sample CSV fixtures", () => {
  it("infers the orders columns as dates, numbers, and dimensions", async () => {
    const csvContent = await readFile(samplePath("orders"), "utf8");
    const parsed = parseCSV(csvContent);
    const tableId = "8d2ed912-67e0-40f2-b62f-71b17f4ffec8";

    const converted = await csvToDataFrame(parsed, tableId);

    expect(converted.fields.map(({ name, type }) => [name, type])).toEqual([
      ["order_id", "string"],
      ["customer_id", "string"],
      ["order_date", "date"],
      ["channel", "string"],
      ["revenue", "number"],
      ["quantity", "number"],
      ["region", "string"],
    ]);
  });
});
