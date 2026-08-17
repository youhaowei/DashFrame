import type { DataTable, Insight } from "@dashframe/types";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { mockUseQuery } = vi.hoisted(() => ({
  mockUseQuery: vi.fn(),
}));

vi.mock("@/wystack/api", () => ({
  api: {
    getInsight: { _path: "getInsight" },
    listDataTables: { _path: "listDataTables" },
    listInsights: { _path: "listInsights" },
  },
}));

vi.mock("@wystack/client", () => ({
  useQuery: (ref: { _path: string }) => mockUseQuery(ref),
}));

import { useCompiledInsight } from "./useCompiledInsight";

describe("useCompiledInsight", () => {
  beforeEach(() => {
    mockUseQuery.mockReset();
  });

  it("compiles a derived Insight against its root DataTable without replacing its definition", () => {
    const rootField = {
      id: "field-revenue",
      name: "Revenue",
      tableId: "table-root",
      columnName: "revenue",
      type: "number",
    } as const;
    const joinedField = {
      id: "field-region",
      name: "Region",
      tableId: "table-region",
      columnName: "region",
      type: "string",
    } as const;
    const tables = [
      {
        id: "table-root",
        fields: [rootField],
      },
      {
        id: "table-region",
        fields: [joinedField],
      },
    ] as DataTable[];
    const upstream = {
      id: "insight-upstream",
      source: { sourceType: "dataTable", sourceId: "table-root" },
      selectedFields: ["field-revenue"],
      metrics: [],
      name: "Upstream",
    } as Insight;
    const metric = {
      id: "metric-total",
      name: "Total revenue",
      sourceTable: "table-root",
      columnName: "revenue",
      aggregation: "sum",
    } as const;
    const derived = {
      id: "insight-derived",
      source: { sourceType: "insight", sourceId: upstream.id },
      selectedFields: [rootField.id, joinedField.id],
      metrics: [metric],
      filters: [{ field: "revenue", operator: "gt", value: 100 }],
      sorts: [{ field: "revenue", direction: "desc" }],
      joins: [
        {
          type: "left",
          rightTableId: "table-region",
          leftKey: "region_id",
          rightKey: "id",
        },
      ],
      name: "Derived",
    } as Insight;

    mockUseQuery.mockImplementation((ref: { _path: string }) => {
      if (ref._path === "getInsight") return { data: derived };
      if (ref._path === "listDataTables") return { data: tables };
      if (ref._path === "listInsights") return { data: [upstream, derived] };
      return { data: undefined };
    });

    const { result } = renderHook(() => useCompiledInsight(derived.id));

    expect(result.current.data).toEqual({
      id: derived.id,
      name: derived.name,
      dimensions: [rootField, joinedField],
      metrics: [metric],
      filters: derived.filters,
      sorts: derived.sorts,
    });
  });
});
