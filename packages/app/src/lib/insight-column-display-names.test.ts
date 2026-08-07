import {
  buildInsightAvailableFields,
  fieldIdToColumnAlias,
} from "@dashframe/engine";
import type { DataTable, Field, Insight, UUID } from "@dashframe/types";
import { describe, expect, it } from "vitest";
import { buildInsightColumnDisplayNames } from "./insight-column-display-names";

const BASE_TABLE_ID = "10101010-1010-1010-1010-101010101010" as UUID;
const USERS_TABLE_ID = "30303030-3030-3030-3030-303030303030" as UUID;

const createdBy: Field = {
  id: "b0b0b0b0-b0b0-b0b0-b0b0-b0b0b0b0b0b0" as UUID,
  name: "Created By",
  tableId: BASE_TABLE_ID,
  columnName: "created_by",
  type: "string",
};
const approvedBy: Field = {
  id: "c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0" as UUID,
  name: "Approved By",
  tableId: BASE_TABLE_ID,
  columnName: "approved_by",
  type: "string",
};
const userId: Field = {
  id: "d0d0d0d0-d0d0-d0d0-d0d0-d0d0d0d0d0d0" as UUID,
  name: "User ID",
  tableId: USERS_TABLE_ID,
  columnName: "id",
  type: "string",
};
const userName: Field = {
  id: "e0e0e0e0-e0e0-e0e0-e0e0-e0e0e0e0e0e0" as UUID,
  name: "User Name",
  tableId: USERS_TABLE_ID,
  columnName: "name",
  type: "string",
};

const baseTable: DataTable = {
  id: BASE_TABLE_ID,
  name: "orders",
  dataSourceId: "33333333-3333-3333-3333-333333333333" as UUID,
  table: "orders.csv",
  fields: [createdBy, approvedBy],
  metrics: [],
  dataFrameId: "20202020-2020-2020-2020-202020202020" as UUID,
  createdAt: 0,
};
const usersTable: DataTable = {
  id: USERS_TABLE_ID,
  name: "users",
  dataSourceId: "33333333-3333-3333-3333-333333333333" as UUID,
  table: "users.csv",
  fields: [userId, userName],
  metrics: [],
  dataFrameId: "40404040-4040-4040-4040-404040404040" as UUID,
  createdAt: 0,
};

describe("buildInsightColumnDisplayNames", () => {
  it("does not advance a repeat-join instance for a skipped join", () => {
    const insight: Insight = {
      id: "50505050-5050-5050-5050-505050505050" as UUID,
      name: "Orders with users",
      baseTableId: BASE_TABLE_ID,
      selectedFields: [],
      metrics: [],
      joins: [
        {
          type: "inner",
          rightTableId: USERS_TABLE_ID,
          leftKey: "missing_creator",
          rightKey: "id",
        },
        {
          type: "inner",
          rightTableId: USERS_TABLE_ID,
          leftKey: "created_by",
          rightKey: "id",
        },
        {
          type: "inner",
          rightTableId: USERS_TABLE_ID,
          leftKey: "approved_by",
          rightKey: "id",
        },
      ],
      createdAt: 0,
    };
    const fields = buildInsightAvailableFields(
      baseTable,
      new Map([[USERS_TABLE_ID, usersTable]]),
      insight,
    );

    expect(fields).not.toBeNull();

    const labels = buildInsightColumnDisplayNames(insight, fields!, {
      baseTable,
      joinedTables: new Map([[USERS_TABLE_ID, usersTable]]),
    });
    const firstAlias = fieldIdToColumnAlias(userName.id);
    const secondAlias = fieldIdToColumnAlias(`${userName.id}_j1`);

    expect(labels[firstAlias]).toBe("User Name (created_by)");
    expect(labels[secondAlias]).toBe("User Name (approved_by)");
  });
});
