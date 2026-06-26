/**
 * Acceptance: repeat-join instance identity in the axis picker.
 *
 * Contract: given an insight that joins the same right table twice (e.g.
 * orders→users on created_by AND on approved_by), the axis picker must
 * surface BOTH join instances as DISTINCT selectable options, and the
 * encoding value for the second instance must resolve to the correct
 * `_j1`-suffixed SQL alias so the chart queries the right column.
 *
 * This is the user-facing acceptance for the fix introduced in this PR.
 * The test exercises the core matching logic that AxisSelectField.tsx
 * now uses: extractColumnAliasComponents → synthetic field-ID → distinct
 * encoding value per instance. It also validates the charting path via
 * fieldIdToColumnAlias(syntheticId) producing the correct SQL alias.
 */

import {
  buildInsightAvailableFields,
  extractColumnAliasComponents,
  fieldIdToColumnAlias,
} from "@dashframe/engine";
import type { DataTable, Field, Insight, UUID } from "@dashframe/types";
import { fieldEncoding } from "@dashframe/types";
import { describe, expect, it } from "vitest";

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

const singleJoinInsight: Pick<Insight, "joins"> = {
  joins: [
    {
      type: "inner",
      rightTableId: USERS_TABLE_ID,
      leftKey: "created_by",
      rightKey: "id",
    },
  ],
};

const joinedTables = new Map([[USERS_TABLE_ID, usersTable]]);

// ── Helpers that mirror AxisSelectField's matching logic ─────────────────────

/**
 * Simulate the field-ID matching logic now used in AxisSelectField's
 * allOptions and encodingToSqlAlias memos.
 *
 * For a given columnAlias from columnAnalysis, returns the encoding value
 * that would be stored (field:<syntheticId>) or the raw alias as fallback.
 */
function resolveColumnToEncoding(
  columnAlias: string,
  selectableFields: Field[],
): string {
  const components = extractColumnAliasComponents(columnAlias);
  if (!components) return columnAlias;

  const syntheticId =
    components.instanceIndex === 0
      ? components.uuid
      : `${components.uuid}_j${components.instanceIndex}`;

  const byId = selectableFields.find((f) => f.id === syntheticId);
  if (byId) return fieldEncoding(byId.id as UUID);

  // Fallback: bare UUID match (single-join or base-table column)
  const byBare = selectableFields.find((f) => f.id === components.uuid);
  if (byBare) return fieldEncoding(byBare.id as UUID);

  return columnAlias;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AxisSelectField — repeat-join instance identity (acceptance)", () => {
  it("buildInsightAvailableFields produces distinct synthetic IDs for repeat-join instances", () => {
    const fields = buildInsightAvailableFields(
      ordersTable,
      joinedTables,
      doubleJoinInsight,
    );
    expect(fields).not.toBeNull();

    // First join instance: bare UUID (no suffix)
    const j0Name = fields!.find((f) => f.id === U_NAME_FIELD.id);
    expect(j0Name).toBeDefined();

    // Second join instance: synthetic id with _j1 suffix
    const j1NameId = `${U_NAME_FIELD.id}_j1` as UUID;
    const j1Name = fields!.find((f) => f.id === j1NameId);
    expect(j1Name).toBeDefined();

    // Their IDs are distinct — the core invariant
    expect(j0Name!.id).not.toBe(j1Name!.id);

    // Both carry the same human-readable name
    expect(j0Name!.name).toBe(U_NAME_FIELD.name);
    expect(j1Name!.name).toBe(U_NAME_FIELD.name);
  });

  it("extractColumnAliasComponents recovers uuid and instanceIndex from a _j1-suffixed alias", () => {
    const j1NameId = `${U_NAME_FIELD.id}_j1` as UUID;
    const alias = fieldIdToColumnAlias(j1NameId);
    expect(alias).toContain("_j1");

    const components = extractColumnAliasComponents(alias);
    expect(components).not.toBeNull();
    expect(components!.uuid).toBe(U_NAME_FIELD.id);
    expect(components!.instanceIndex).toBe(1);
  });

  it("picker logic maps BOTH join-instance columns to DISTINCT encoding values", () => {
    // ACCEPTANCE: this is the key invariant the bug violated.
    // Before the fix: both columns got the same encoding → user saw one option.
    // After the fix: each instance maps to a distinct encoding.
    const selectableFields =
      buildInsightAvailableFields(
        ordersTable,
        joinedTables,
        doubleJoinInsight,
      ) ?? [];

    // DuckDB columnAnalysis would produce these two entries for the Name field:
    const j0Alias = fieldIdToColumnAlias(U_NAME_FIELD.id); // instance 0
    const j1Alias = fieldIdToColumnAlias(`${U_NAME_FIELD.id}_j1` as UUID); // instance 1

    const enc0 = resolveColumnToEncoding(j0Alias, selectableFields);
    const enc1 = resolveColumnToEncoding(j1Alias, selectableFields);

    // Both must be valid field: encodings (not raw alias fallbacks)
    expect(enc0).toMatch(/^field:/);
    expect(enc1).toMatch(/^field:/);

    // They must be DISTINCT (the acceptance invariant — picker shows both)
    expect(enc0).not.toBe(enc1);

    // enc0 maps to bare USER_NAME field, enc1 maps to <uuid>_j1
    expect(enc0).toBe(`field:${U_NAME_FIELD.id}`);
    expect(enc1).toBe(`field:${U_NAME_FIELD.id}_j1`);
  });

  it("instance-0 encoding resolves to bare SQL alias, instance-1 to _j1-suffixed alias", () => {
    // CHARTING PATH: encoding → fieldIdToColumnAlias → SQL alias.
    // The chart queries the model view by this alias — both must be distinct
    // and correct for the chart to display the right data.
    const j0Id = U_NAME_FIELD.id;
    const j1Id = `${U_NAME_FIELD.id}_j1` as UUID;

    const j0Alias = fieldIdToColumnAlias(j0Id);
    const j1Alias = fieldIdToColumnAlias(j1Id);

    // j1 alias has the _j1 suffix — matches what DuckDB emits
    expect(j1Alias).toBe(`${j0Alias}_j1`);

    // The two SQL aliases are distinct — each maps to a different DuckDB column
    expect(j0Alias).not.toBe(j1Alias);
  });

  it("single-join insight is unaffected — field still resolves to bare encoding", () => {
    // NON-REGRESSION: single joins must work identically to before the fix.
    const selectableFields =
      buildInsightAvailableFields(
        ordersTable,
        joinedTables,
        singleJoinInsight,
      ) ?? [];

    const alias = fieldIdToColumnAlias(U_NAME_FIELD.id);
    const enc = resolveColumnToEncoding(alias, selectableFields);

    expect(enc).toBe(`field:${U_NAME_FIELD.id}`);
  });

  it("base-table columns are unaffected by the repeat-join fix", () => {
    const selectableFields =
      buildInsightAvailableFields(
        ordersTable,
        joinedTables,
        doubleJoinInsight,
      ) ?? [];

    const orderId0Alias = fieldIdToColumnAlias(O_ID_FIELD.id);
    const enc = resolveColumnToEncoding(orderId0Alias, selectableFields);

    // Base-table field resolves to bare field encoding
    expect(enc).toBe(`field:${O_ID_FIELD.id}`);
  });
});
