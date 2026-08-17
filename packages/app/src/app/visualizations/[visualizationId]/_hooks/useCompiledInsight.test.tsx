import { fieldIdToColumnAlias } from "@dashframe/engine";
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

  it("compiles a derived Insight against its immediate upstream output schema", () => {
    const rootField = {
      id: "field-revenue",
      name: "Revenue",
      tableId: "table-root",
      columnName: "revenue",
      type: "number",
    } as const;
    const rootOnlyField = {
      id: "field-root-only",
      name: "Root only",
      tableId: "table-root",
      columnName: "root_only",
      type: "number",
    } as const;
    const regionIdField = {
      id: "field-region-id",
      name: "Region ID",
      tableId: "table-root",
      columnName: "region_id",
      type: "string",
    } as const;
    const joinedKey = {
      id: "field-joined-key",
      name: "ID",
      tableId: "table-region",
      columnName: "id",
      type: "string",
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
        dataFrameId: "frame-root",
        fields: [rootField, rootOnlyField, regionIdField],
      },
      {
        id: "table-region",
        dataFrameId: "frame-region",
        fields: [joinedKey, joinedField],
      },
    ] as DataTable[];
    const upstream = {
      id: "insight-upstream",
      source: { sourceType: "dataTable", sourceId: "table-root" },
      selectedFields: [rootField.id, regionIdField.id],
      metrics: [],
      name: "Upstream",
    } as Insight;
    const metric = {
      id: "metric-total",
      name: "Total revenue",
      sourceTable: upstream.id,
      columnName: fieldIdToColumnAlias(rootField.id),
      aggregation: "sum",
    } as const;
    const derived = {
      id: "insight-derived",
      source: { sourceType: "insight", sourceId: upstream.id },
      selectedFields: [rootField.id, joinedField.id],
      metrics: [metric],
      filters: [
        {
          field: fieldIdToColumnAlias(rootField.id),
          operator: "gt",
          value: 100,
        },
      ],
      sorts: [{ field: fieldIdToColumnAlias(rootField.id), direction: "desc" }],
      joins: [
        {
          type: "left",
          rightTableId: "table-region",
          leftKey: fieldIdToColumnAlias(regionIdField.id),
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
      dimensions: [
        {
          ...rootField,
          tableId: upstream.id,
          columnName: fieldIdToColumnAlias(rootField.id),
        },
        joinedField,
      ],
      metrics: [metric],
      filters: derived.filters,
      sorts: derived.sorts,
    });
    expect(
      result.current.data?.dimensions.some(
        (field) => field.id === rootOnlyField.id,
      ),
    ).toBe(false);
  });
});
