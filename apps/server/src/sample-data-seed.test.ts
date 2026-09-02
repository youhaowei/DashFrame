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
