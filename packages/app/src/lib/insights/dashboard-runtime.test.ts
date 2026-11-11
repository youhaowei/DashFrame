import { fieldIdToColumnAlias, metricIdToColumnAlias } from "@dashframe/engine";
import type { DataTable, Insight } from "@dashframe/types";
import { describe, expect, it } from "vite-plus/test";
import { buildSortFieldOptions } from "@/components/dashboards/override-field-row-utils";
import { resolveDashboardRuntime } from "./dashboard-runtime";

const fieldId = "11111111-1111-4111-8111-111111111111";
const metricId = "22222222-2222-4222-8222-222222222222";
const unlistedFieldId = "33333333-3333-4333-8333-333333333333";

const dataTable = {
  id: "orders",
  fields: [
    { id: fieldId, name: "Region", columnName: "region", tableId: "orders" },
    {
      id: unlistedFieldId,
      name: "Channel",
      columnName: "channel",
      tableId: "orders",
    },
  ],
} as unknown as DataTable;

const insight = {
  id: "insight",
  name: "Revenue by region",
  source: { sourceType: "dataTable", sourceId: "orders" },
  selectedFields: [fieldId, unlistedFieldId],
  metrics: [
    {
      id: metricId,
      name: "Revenue",
      sourceTable: "orders",
      aggregation: "sum",
      columnName: "amount",
    },
  ],
  runtimeControls: {
    sort: { allowedFieldIds: [fieldId, metricId], maxKeys: 1 },
  },
  createdAt: 0,
} as unknown as Insight;

function resolveSort(field: string, target = insight) {
  return resolveDashboardRuntime(target, [dataTable], {
    sorts: [{ field, direction: "desc" }],
  });
}

describe("resolveDashboardRuntime — tile sort override", () => {
  it.each([
    ["id", fieldId],
    ["result-column alias", fieldIdToColumnAlias(fieldId)],
    ["column name", "region"],
  ])("resolves a field by its %s", (_form, reference) => {
    expect(resolveSort(reference)).toEqual({
      runtime: { sort: [{ fieldId, direction: "desc" }] },
    });
  });

  it.each([
    ["id", metricId],
    ["result-column alias", metricIdToColumnAlias(metricId)],
    ["name", "Revenue"],
  ])("resolves a metric by its %s", (_form, reference) => {
    expect(resolveSort(reference)).toEqual({
      runtime: { sort: [{ fieldId: metricId, direction: "desc" }] },
    });
  });

  // The derived insight selects the upstream metric as a field.  No data
  // table owns that id, so only the id and its aliases can name it.
  it.each([
    ["id", metricId],
    ["upstream alias", metricIdToColumnAlias(metricId)],
    ["own alias", fieldIdToColumnAlias(metricId)],
  ])(
    "resolves an upstream column of an insight built on another insight by its %s",
    (_form, reference) => {
      const derived = {
        ...insight,
        id: "derived",
        source: { sourceType: "insight", sourceId: insight.id },
        selectedFields: [metricId],
        metrics: [],
        runtimeControls: {
          sort: { allowedFieldIds: [metricId], maxKeys: 1 },
        },
      } as unknown as Insight;
      expect(resolveSort(reference, derived)).toEqual({
        runtime: { sort: [{ fieldId: metricId, direction: "desc" }] },
      });
    },
  );

  it.each([
    ["id", unlistedFieldId],
    ["result-column alias", fieldIdToColumnAlias(unlistedFieldId)],
    ["column name", "channel"],
  ])(
    "refuses a field the Insight does not allow, named by its %s",
    (_form, reference) => {
      expect(resolveSort(reference)).toEqual({
        error: "This dashboard sort field is not allowed by the Insight.",
      });
    },
  );

  it("runs every choice the sort row offers for an Insight that declares a sort", () => {
    const regionOnly = {
      ...insight,
      runtimeControls: { sort: { allowedFieldIds: [fieldId], maxKeys: 1 } },
    } as unknown as Insight;
    const { options } = buildSortFieldOptions(
      dataTable.fields ?? [],
      regionOnly.metrics,
      regionOnly.runtimeControls?.sort?.allowedFieldIds,
    );
    expect(options.map((option) => option.label)).toEqual(["Region"]);
    expect(
      options.map((option) => resolveSort(option.value, regionOnly)),
    ).toEqual([{ runtime: { sort: [{ fieldId, direction: "desc" }] } }]);
  });

  it("names the cause when a saved list has more keys than a tile runs", () => {
    expect(
      resolveDashboardRuntime(insight, [dataTable], {
        sorts: [
          { field: metricId, direction: "desc" },
          { field: fieldId, direction: "asc" },
        ],
      }),
    ).toEqual({
      error: "This dashboard sort has 2 keys, and the Insight runs 1.",
    });
  });

  it("refuses any sort when the Insight declares none", () => {
    expect(
      resolveSort(fieldId, { ...insight, runtimeControls: undefined }),
    ).toEqual({ error: "This dashboard sort is not declared by the Insight." });
  });
});
