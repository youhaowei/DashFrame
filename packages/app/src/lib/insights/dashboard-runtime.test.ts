import { fieldIdToColumnAlias, metricIdToColumnAlias } from "@dashframe/engine";
import type { DataTable, Insight } from "@dashframe/types";
import { describe, expect, it } from "vite-plus/test";
import { buildSortFieldOptions } from "@/components/dashboards/override-field-row-utils";
import { resolveDashboardRuntime } from "./dashboard-runtime";

const fieldId = "11111111-1111-4111-8111-111111111111";
const metricId = "22222222-2222-4222-8222-222222222222";
const unlistedFieldId = "33333333-3333-4333-8333-333333333333";
const regionCell = { fieldId, value: "West" };

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
    "ignores a field the Insight does not allow, named by its %s",
    (_form, reference) => {
      expect(resolveSort(reference)).toEqual({ runtime: {} });
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

  it("runs only the first key of a longer list saved before one key was the rule", () => {
    expect(
      resolveDashboardRuntime(insight, [dataTable], {
        sorts: [
          { field: metricId, direction: "desc" },
          { field: fieldId, direction: "asc" },
        ],
      }),
    ).toEqual({
      runtime: { sort: [{ fieldId: metricId, direction: "desc" }] },
    });
  });

  it("ignores a sort when the Insight declares none", () => {
    expect(
      resolveSort(fieldId, { ...insight, runtimeControls: undefined }),
    ).toEqual({ runtime: {} });
  });

  // A pivoted metric sorts by the cell the Insight's own sort on it names; the
  // host refuses one with no such sort.
  it.each([
    [
      "runs a metric the Insight sorts by a full pivot cell",
      [regionCell],
      true,
    ],
    ["ignores a metric the Insight does not sort by a pivot cell", [], false],
  ])("on a pivoted Insight, %s", (_case, pivotValues, runs) => {
    const pivoted = {
      ...insight,
      reporting: { pivotFields: [fieldId] },
      sorts:
        pivotValues.length > 0
          ? [
              {
                field: metricIdToColumnAlias(metricId),
                direction: "asc",
                pivotValues,
              },
            ]
          : [],
    } as unknown as Insight;
    expect(resolveSort(metricId, pivoted)).toEqual({
      runtime: runs ? { sort: [{ fieldId: metricId, direction: "desc" }] } : {},
    });
  });
});
