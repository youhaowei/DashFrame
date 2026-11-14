/**
 * Repeat-join instance identity on the charting path.
 *
 * resolveEncodingToSql, given the instance-aware fields from
 * buildInsightAvailableFields, resolves field:<uuid>_j1 to the _j1-suffixed
 * SQL alias. VisualizationDisplay and VisualizationPreview resolve their
 * encodings this way. The picker itself is covered by
 * AxisSelectField.render.test.tsx.
 */

import {
  buildInsightAvailableFields,
  fieldIdToColumnAlias,
  resolveEncodingToSql,
} from "@dashframe/engine";
import type { DataTable, Field, Insight, UUID } from "@dashframe/types";
import { describe, expect, it } from "vite-plus/test";

// ── Fixtures (matching engine test fixture format) ────────────────────────────

const ORDERS_TABLE_ID = "10101010-1010-1010-1010-101010101010" as UUID;
const ORDERS_DF_ID = "20202020-2020-2020-2020-202020202020" as UUID;
const USERS_TABLE_ID = "30303030-3030-3030-3030-303030303030" as UUID;
const USERS_DF_ID = "40404040-4040-4040-4040-404040404040" as UUID;
const DATA_SOURCE_ID = "33333333-3333-3333-3333-333333333333" as UUID;

const O_ID_FIELD: Field = {
  id: "a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0" as UUID,
  name: "Order ID",
  tableId: ORDERS_TABLE_ID,
  columnName: "id",
  type: "string",
};
const O_CREATED_BY_FIELD: Field = {
  id: "b0b0b0b0-b0b0-b0b0-b0b0-b0b0b0b0b0b0" as UUID,
  name: "Created By",
  tableId: ORDERS_TABLE_ID,
  columnName: "created_by",
  type: "string",
};
const O_APPROVED_BY_FIELD: Field = {
  id: "c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0" as UUID,
  name: "Approved By",
  tableId: ORDERS_TABLE_ID,
  columnName: "approved_by",
  type: "string",
};

const U_ID_FIELD: Field = {
  id: "d0d0d0d0-d0d0-d0d0-d0d0-d0d0d0d0d0d0" as UUID,
  name: "User ID",
  tableId: USERS_TABLE_ID,
  columnName: "id",
  type: "string",
};
const U_NAME_FIELD: Field = {
  id: "e0e0e0e0-e0e0-e0e0-e0e0-e0e0e0e0e0e0" as UUID,
  name: "User Name",
  tableId: USERS_TABLE_ID,
  columnName: "name",
  type: "string",
};
const U_EMAIL_FIELD: Field = {
  id: "f0f0f0f0-f0f0-f0f0-f0f0-f0f0f0f0f0f0" as UUID,
  name: "User Email",
  tableId: USERS_TABLE_ID,
  columnName: "email",
  type: "string",
};

const ordersTable: DataTable = {
  id: ORDERS_TABLE_ID,
  name: "orders",
  dataSourceId: DATA_SOURCE_ID,
  table: "orders.csv",
  fields: [O_ID_FIELD, O_CREATED_BY_FIELD, O_APPROVED_BY_FIELD],
  metrics: [],
  dataFrameId: ORDERS_DF_ID,
  createdAt: 0,
};

const usersTable: DataTable = {
  id: USERS_TABLE_ID,
  name: "users",
  dataSourceId: DATA_SOURCE_ID,
  table: "users.csv",
  fields: [U_ID_FIELD, U_NAME_FIELD, U_EMAIL_FIELD],
  metrics: [],
  dataFrameId: USERS_DF_ID,
  createdAt: 0,
};

const doubleJoinInsight: Pick<Insight, "joins"> = {
  joins: [
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
};

const joinedTables = new Map([[USERS_TABLE_ID, usersTable]]);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("repeat-join instance identity — charting path", () => {
  it("resolveEncodingToSql with instance-aware fields resolves _j1 encoding to the correct SQL alias", () => {
    // resolveEncodingToSql is the real function VisualizationDisplay and
    // VisualizationPreview call, fed the fields buildInsightAvailableFields
    // returns for a repeat join.
    const instanceAwareFields =
      buildInsightAvailableFields(
        ordersTable,
        joinedTables,
        doubleJoinInsight,
      ) ?? [];

    const j0Enc = `field:${U_NAME_FIELD.id}`;
    const j1Enc = `field:${U_NAME_FIELD.id}_j1`;

    const context = {
      fields: instanceAwareFields,
      metrics: [],
    };

    // Instance 0: resolves to bare alias
    const j0Sql = resolveEncodingToSql({ x: j0Enc }, context);
    expect(j0Sql.x).toBe(fieldIdToColumnAlias(U_NAME_FIELD.id));

    // Instance 1: resolves to the _j1-suffixed alias — the SQL alias DuckDB emits
    const j1Sql = resolveEncodingToSql({ x: j1Enc }, context);
    expect(j1Sql.x).toBe(`${fieldIdToColumnAlias(U_NAME_FIELD.id)}_j1`);

    // Verify they differ (regression guard)
    expect(j0Sql.x).not.toBe(j1Sql.x);
  });
});
