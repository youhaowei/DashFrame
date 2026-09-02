import { readFile } from "node:fs/promises";

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

  it("keeps every order customer joinable to the customers fixture", async () => {
    const customerRows = parseCSV(
      await readFile(samplePath("customers"), "utf8"),
    );
    const orderRows = parseCSV(await readFile(samplePath("orders"), "utf8"));
    const customerIds = new Set(customerRows.slice(1).map((row) => row[0]));
    const orderCustomerIndex = orderRows[0]!.indexOf("customer_id");

    const missingCustomerIds = new Set(
      orderRows
        .slice(1)
        .map((row) => row[orderCustomerIndex])
        .filter((customerId) => !customerIds.has(customerId)),
    );

    expect(missingCustomerIds).toEqual(new Set());
  });

  it("infers the customer signup date without stringifying it", async () => {
    const parsed = parseCSV(await readFile(samplePath("customers"), "utf8"));
    const tableId = "a7626de3-0447-4ab7-b0ba-55ebf4649060";

    const converted = await csvToDataFrame(parsed, tableId);

    expect(converted.fields.map(({ name, type }) => [name, type])).toEqual([
      ["customer_id", "string"],
      ["signup_date", "date"],
      ["region", "string"],
      ["segment", "string"],
    ]);
  });

  it("uses the GA4 default channel-group vocabulary", async () => {
    const rows = parseCSV(await readFile(samplePath("orders"), "utf8"));
    const channelIndex = rows[0]!.indexOf("channel");

    expect(new Set(rows.slice(1).map((row) => row[channelIndex]))).toEqual(
      new Set([
        "Organic Search",
        "Paid Search",
        "Direct",
        "Referral",
        "Email",
        "Organic Social",
      ]),
    );
  });

  it("keeps every channel revenue-positive in every month", async () => {
    const rows = parseCSV(await readFile(samplePath("orders"), "utf8"));
    const dateIndex = rows[0]!.indexOf("order_date");
    const channelIndex = rows[0]!.indexOf("channel");
    const revenueIndex = rows[0]!.indexOf("revenue");
    const months = new Set<string>();
    const channels = new Set<string>();
    const revenueByMonthAndChannel = new Map<string, number>();

    for (const row of rows.slice(1)) {
      const month = row[dateIndex]!.slice(0, 7);
      const channel = row[channelIndex]!;
      const key = `${month}:${channel}`;
      months.add(month);
      channels.add(channel);
      revenueByMonthAndChannel.set(
        key,
        (revenueByMonthAndChannel.get(key) ?? 0) + Number(row[revenueIndex]),
      );
    }

    const zeroRevenueChannelMonths = [...months].flatMap((month) =>
      [...channels]
        .filter(
          (channel) =>
            (revenueByMonthAndChannel.get(`${month}:${channel}`) ?? 0) <= 0,
        )
        .map((channel) => `${month}:${channel}`),
    );

    expect(zeroRevenueChannelMonths).toEqual([]);
  });

  it("preserves an August drop driven by Paid Search and Organic Social", async () => {
    const rows = parseCSV(await readFile(samplePath("orders"), "utf8"));
    const [header, ...data] = rows;
    const dateIndex = header!.indexOf("order_date");
    const channelIndex = header!.indexOf("channel");
    const revenueIndex = header!.indexOf("revenue");
    const totals = new Map<string, number>();

    for (const row of data) {
      const month = row[dateIndex]!.slice(0, 7);
      if (month !== "2025-07" && month !== "2025-08") continue;
      const key = `${month}:${row[channelIndex]}`;
      totals.set(key, (totals.get(key) ?? 0) + Number(row[revenueIndex]));
    }

    const monthTotal = (month: string) =>
      [...totals]
        .filter(([key]) => key.startsWith(`${month}:`))
        .reduce((sum, [, revenue]) => sum + revenue, 0);
    const july = monthTotal("2025-07");
    const august = monthTotal("2025-08");
    const channelDrop = (channel: string) =>
      (totals.get(`2025-07:${channel}`) ?? 0) -
      (totals.get(`2025-08:${channel}`) ?? 0);
    const causalDrop =
      channelDrop("Paid Search") + channelDrop("Organic Social");

    expect(august).toBeLessThan(july * 0.75);
    expect(causalDrop).toBeGreaterThan((july - august) * 0.9);
  });
});
