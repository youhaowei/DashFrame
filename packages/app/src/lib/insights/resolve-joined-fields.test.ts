import { fieldIdToColumnAlias } from "@dashframe/engine";
import type { DataTable, Field, Insight, UUID } from "@dashframe/types";
import { describe, expect, it } from "vitest";

import { resolveJoinedFields } from "./resolve-joined-fields";

// ---------------------------------------------------------------------------
// resolveJoinedFields must produce field ids whose derived column aliases match
// EXACTLY what the SQL engine emits for the same insight. The dangerous case is
// two joins to the same table: the engine suffixes the second instance's
// aliases (`field_<uuid>_j1`), and the engine advances its instance counter
// ONLY for joins it actually emits. If this helper's counter drifts from the
// engine's, the pagination display-name / type maps key on a column DuckDB
// never produced — silent header/format loss (the same silent-wrong-column
// failure the suffixing prevents, one step removed).
// ---------------------------------------------------------------------------

const ORDERS_TABLE_ID = "11111111-1111-1111-1111-111111111111" as UUID;
const USERS_TABLE_ID = "22222222-2222-2222-2222-222222222222" as UUID;

const O_ID: Field = {
  id: "a1111111-1111-1111-1111-111111111111" as UUID,
  name: "id",
  tableId: ORDERS_TABLE_ID,
  columnName: "id",
  type: "string",
};
const O_CREATED_BY: Field = {
  id: "a2222222-2222-2222-2222-222222222222" as UUID,
  name: "created_by",
  tableId: ORDERS_TABLE_ID,
  columnName: "created_by",
  type: "string",
};
const O_APPROVED_BY: Field = {
  id: "a3333333-3333-3333-3333-333333333333" as UUID,
  name: "approved_by",
  tableId: ORDERS_TABLE_ID,
  columnName: "approved_by",
  type: "string",
};
const U_ID: Field = {
  id: "b1111111-1111-1111-1111-111111111111" as UUID,
  name: "id",
  tableId: USERS_TABLE_ID,
  columnName: "id",
  type: "string",
};
const U_NAME: Field = {
  id: "b2222222-2222-2222-2222-222222222222" as UUID,
  name: "name",
  tableId: USERS_TABLE_ID,
  columnName: "name",
  type: "string",
};

const ordersTable: DataTable = {
  id: ORDERS_TABLE_ID,
  name: "orders",
  dataSourceId: "33333333-3333-3333-3333-333333333333" as UUID,
  table: "orders.csv",
  fields: [O_ID, O_CREATED_BY, O_APPROVED_BY],
  metrics: [],
  dataFrameId: "44444444-4444-4444-4444-444444444444" as UUID,
  createdAt: 0,
};
const usersTable: DataTable = {
  id: USERS_TABLE_ID,
  name: "users",
  dataSourceId: "33333333-3333-3333-3333-333333333333" as UUID,
  table: "users.csv",
  fields: [U_ID, U_NAME],
  metrics: [],
  dataFrameId: "55555555-5555-5555-5555-555555555555" as UUID,
  createdAt: 0,
};

const joinedTables = new Map<UUID, DataTable>([[USERS_TABLE_ID, usersTable]]);

/** The column alias the engine emits for a field at a given join instance. */
const aliasFor = (fieldId: string, instance: number) =>
  instance === 0
    ? fieldIdToColumnAlias(fieldId)
    : fieldIdToColumnAlias(`${fieldId}_j${instance}`);

describe("resolveJoinedFields — alias parity with the SQL engine", () => {
  it("two joins to the same table: the second instance gets the _j1-suffixed alias", () => {
    const insight: Pick<Insight, "joins"> = {
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

    const fields = resolveJoinedFields(ordersTable, insight, joinedTables);
    const aliases = fields.map((f) => fieldIdToColumnAlias(f.id));

    // First instance: canonical alias for users.name. Second: _j1-suffixed.
    expect(aliases).toContain(aliasFor(U_NAME.id, 0));
    expect(aliases).toContain(aliasFor(U_NAME.id, 1));
    // No duplicate alias — that is the whole point.
    expect(new Set(aliases).size).toBe(aliases.length);
  });

  it("a SKIPPED first join does not consume the instance index — the surviving join stays canonical", () => {
    // First join references a column orders does not have → the engine skips it
    // and does NOT advance the counter, so the second (valid) join to users is
    // instance 0 and emits the CANONICAL alias, not _j1.
    const insight: Pick<Insight, "joins"> = {
      joins: [
        {
          type: "inner",
          rightTableId: USERS_TABLE_ID,
          leftKey: "nonexistent_column",
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

    const fields = resolveJoinedFields(ordersTable, insight, joinedTables);
    const aliases = fields.map((f) => fieldIdToColumnAlias(f.id));

    // The one surviving join uses the canonical alias …
    expect(aliases).toContain(aliasFor(U_NAME.id, 0));
    // … and NOT the suffixed one (which would key maps on a phantom column).
    expect(aliases).not.toContain(aliasFor(U_NAME.id, 1));
  });

  it("a join whose table has no dataFrameId is skipped without consuming an index", () => {
    const usersNoDf: DataTable = { ...usersTable, dataFrameId: undefined };
    const tables = new Map<UUID, DataTable>([[USERS_TABLE_ID, usersNoDf]]);
    const insight: Pick<Insight, "joins"> = {
      joins: [
        {
          type: "inner",
          rightTableId: USERS_TABLE_ID,
          leftKey: "created_by",
          rightKey: "id",
        },
      ],
    };

    const fields = resolveJoinedFields(ordersTable, insight, tables);
    // Only base-table fields survive; the unresolved join contributes nothing.
    expect(fields.map((f) => f.id)).toEqual([
      O_ID.id,
      O_CREATED_BY.id,
      O_APPROVED_BY.id,
    ]);
  });

  it("no joins: returns base fields unchanged", () => {
    const fields = resolveJoinedFields(ordersTable, { joins: [] }, new Map());
    expect(fields.map((f) => f.id)).toEqual([
      O_ID.id,
      O_CREATED_BY.id,
      O_APPROVED_BY.id,
    ]);
  });
});
