import { fieldIdToColumnAlias } from "@dashframe/engine";
import type { DataTable, InsightFetchDefinition, UUID } from "@dashframe/types";
import { Table, tableToIPC, vectorFromArray } from "apache-arrow";
import { describe, expect, it } from "vitest";

import { productionMaterializerDependencies } from "./production";

const tableId = "10000000-0000-4000-8000-000000000001" as UUID;
const fieldId = "10000000-0000-4000-8000-000000000002" as UUID;
const fieldAlias = fieldIdToColumnAlias(fieldId);
const table = {
  id: tableId,
  dataSourceId: "10000000-0000-4000-8000-000000000003",
  name: "Orders",
  table: "orders.csv",
  fields: [
    {
      id: fieldId,
      tableId,
      name: "Revenue",
      columnName: "amount",
      type: "number",
    },
  ],
  metrics: [],
  dataFrameId: "10000000-0000-4000-8000-000000000004",
  createdAt: 0,
} as DataTable;
const insight: InsightFetchDefinition = {
  baseTableId: tableId,
  selectedFields: [],
  metrics: [],
};

function resultArrow(name: string) {
  return tableToIPC(new Table({ [name]: vectorFromArray([10, 20]) }));
}

describe("production result schema", () => {
  it("keeps SQL aliases structural while publishing human display metadata", () => {
    const inspect = productionMaterializerDependencies().inspect;
    expect(
      inspect(resultArrow(fieldAlias), {
        insight,
        tables: new Map([[tableId, table]]),
      }),
    ).toEqual({
      rowCount: 2,
      schema: [{ id: fieldAlias, name: "Revenue", type: "number" }],
    });
  });

  it("fails closed when native execution returns an undeclared result column", () => {
    const inspect = productionMaterializerDependencies().inspect;
    expect(() =>
      inspect(resultArrow("unexpected"), {
        insight,
        tables: new Map([[tableId, table]]),
      }),
    ).toThrow("SOURCE_SCHEMA_CHANGED");
  });
});
