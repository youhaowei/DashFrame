import { fieldIdToColumnAlias, metricIdToColumnAlias } from "@dashframe/engine";
import type { Field } from "@dashframe/types";
import { describe, expect, it } from "vite-plus/test";

import type { EffectiveInsightDefinition } from "./materializer";
import { runtimeSortsForCompile } from "./runtime-sort";

const fields: Field[] = [
  {
    id: "country",
    name: "Country",
    columnName: "country_code",
    tableId: "orders",
    type: "string",
  },
  {
    id: "product",
    name: "Product",
    columnName: "product_name",
    tableId: "orders",
    type: "string",
  },
];

function definition(
  overrides: Partial<EffectiveInsightDefinition> = {},
): EffectiveInsightDefinition {
  return {
    baseTableId: "orders",
    selectedFields: ["product"],
    metrics: [
      {
        id: "revenue",
        name: "Revenue",
        sourceTable: "orders",
        aggregation: "sum",
        columnName: "amount",
      },
    ],
    runtimeDimensionsChanged: true,
    ...overrides,
  };
}

describe("runtime dimension sort reconciliation", () => {
  it("canonicalizes a uniquely resolved retained raw dimension sort", () => {
    expect(
      runtimeSortsForCompile(
        definition({
          sorts: [{ field: "product_name", direction: "asc" }],
        }),
        fields,
      ),
    ).toEqual([{ field: fieldIdToColumnAlias("product"), direction: "asc" }]);
  });

  it("prunes a uniquely resolved removed raw dimension sort", () => {
    expect(
      runtimeSortsForCompile(
        definition({
          sorts: [{ field: "country_code", direction: "asc" }],
        }),
        fields,
      ),
    ).toEqual([]);
  });

  it("retains metric sorts when dimensions change", () => {
    expect(
      runtimeSortsForCompile(
        definition({
          sorts: [
            { field: metricIdToColumnAlias("revenue"), direction: "desc" },
          ],
        }),
        fields,
      ),
    ).toEqual([{ field: metricIdToColumnAlias("revenue"), direction: "desc" }]);
  });

  it("prunes a metric pivot-cell sort when its pivot tuple no longer matches", () => {
    const pivotSort = {
      field: metricIdToColumnAlias("revenue"),
      direction: "desc" as const,
      pivotValues: [{ fieldId: "country", value: "US" }],
    };
    expect(
      runtimeSortsForCompile(
        definition({
          sorts: [pivotSort],
          reporting: { pivotFields: ["product"] },
        }),
        fields,
      ),
    ).toEqual([]);
    expect(() =>
      runtimeSortsForCompile(
        definition({
          sorts: [pivotSort],
          reporting: { pivotFields: ["product"], limit: 10 },
          limit: 10,
        }),
        fields,
      ),
    ).toThrow("RUNTIME_LIMIT_REQUIRES_SORT");
  });

  it("retains a metric pivot-cell sort when its full tuple remains selected", () => {
    const sort = {
      field: metricIdToColumnAlias("revenue"),
      direction: "desc" as const,
      pivotValues: [{ fieldId: "product", value: "Widget" }],
    };
    expect(
      runtimeSortsForCompile(
        definition({
          sorts: [sort],
          reporting: { pivotFields: ["product"] },
        }),
        fields,
      ),
    ).toEqual([sort]);
  });

  it("rejects a tupleless runtime metric override for a pivot report", () => {
    expect(() =>
      runtimeSortsForCompile(
        definition({
          runtimeDimensionsChanged: undefined,
          runtimeSortOverride: true,
          sorts: [
            { field: metricIdToColumnAlias("revenue"), direction: "desc" },
          ],
          reporting: { pivotFields: ["product"] },
        }),
        fields,
      ),
    ).toThrow("RUNTIME_PIVOT_SORT_REQUIRES_TUPLE");
  });

  it("accepts a runtime metric override with the saved exact pivot tuple", () => {
    const sort = {
      field: metricIdToColumnAlias("revenue"),
      direction: "asc" as const,
      pivotValues: [{ fieldId: "product", value: "Widget" }],
    };
    expect(
      runtimeSortsForCompile(
        definition({
          runtimeDimensionsChanged: undefined,
          runtimeSortOverride: true,
          sorts: [sort],
          reporting: { pivotFields: ["product"] },
        }),
        fields,
      ),
    ).toEqual([sort]);
  });

  it("rejects an ambiguous joined raw reference", () => {
    const duplicate = { ...fields[1]!, id: "joined-product" };
    expect(() =>
      runtimeSortsForCompile(
        definition({
          sorts: [{ field: "product_name", direction: "asc" }],
        }),
        [...fields, duplicate],
      ),
    ).toThrow("RUNTIME_SORT_REFERENCE_AMBIGUOUS");
  });

  it("rejects a limit whose only saved sort was pruned", () => {
    expect(() =>
      runtimeSortsForCompile(
        definition({
          sorts: [{ field: "country_code", direction: "asc" }],
          limit: 10,
        }),
        fields,
      ),
    ).toThrow("RUNTIME_LIMIT_REQUIRES_SORT");
  });

  it("keeps a limit when a selected dimension sort remains", () => {
    expect(
      runtimeSortsForCompile(
        definition({
          sorts: [{ field: "product_name", direction: "asc" }],
          limit: 10,
        }),
        fields,
      ),
    ).toEqual([{ field: fieldIdToColumnAlias("product"), direction: "asc" }]);
  });
});
