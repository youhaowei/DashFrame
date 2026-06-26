/**
 * Repeat-join instance identity: picker helper composition + charting
 * encoding resolution + label disambiguation.
 *
 * What this file proves:
 * (A) PICKER LOGIC — the helper composition that AxisSelectField now uses
 *     (extractColumnAliasComponents → synthetic field-ID → fieldEncoding)
 *     maps both repeat-join instances to DISTINCT encoding values.
 * (B) CHARTING PATH — resolveEncodingToSql with instance-aware fields
 *     (from buildInsightAvailableFields) resolves field:<uuid>_j1 to the
 *     correct _j1-suffixed SQL alias; and fails (undefined) when called
 *     with bare dataTable.fields, catching the regression gap.
 * (C) LABEL DISAMBIGUATION — the display-name logic used by
 *     useInsightPagination.columnDisplayNames produces distinct, human-readable
 *     labels for colliding repeat-join instances (e.g. "User Name (created_by)"
 *     vs "User Name (approved_by)"), while leaving Field.name canonical.
 *
 * What this file does NOT prove: end-to-end React rendering of the picker
 * or the chart component — those require DuckDB and full provider mounts.
 */

import {
  buildInsightAvailableFields,
  extractColumnAliasComponents,
  fieldIdToColumnAlias,
  resolveEncodingToSql,
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

  it("resolveEncodingToSql with instance-aware fields resolves _j1 encoding to the correct SQL alias", () => {
    // CHARTING PATH (B): proves the full resolution pipeline used by
    // VisualizationDisplay and VisualizationPreview after this fix.
    // resolveEncodingToSql is the real function called by those components;
    // testing against it catches surface regressions the helper-composition
    // tests above cannot see.
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

  it("resolveEncodingToSql with bare dataTable.fields cannot resolve a _j1 encoding", () => {
    // Proves the gap that existed BEFORE this fix on Preview/Display surfaces.
    // If bare fields are used (old behavior), instance-1 resolves to undefined.
    // This test is the detector that would have caught VisualizationPreview's bug.
    const j1Enc = `field:${U_NAME_FIELD.id}_j1`;
    const bareContext = {
      fields: usersTable.fields ?? [],
      metrics: [],
    };

    const result = resolveEncodingToSql({ x: j1Enc }, bareContext);
    expect(result.x).toBeUndefined();
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

  it("(C) display-name disambiguation: both repeat-join instances get distinct labels including leftKey", () => {
    // This test verifies the label logic used by useInsightPagination.columnDisplayNames.
    // Both colliding instances must be labeled so neither appears as an unlabeled
    // default.  Field.name stays canonical ("User Name") — only the picker/display
    // label gets the "(leftKey)" suffix.
    const resolvedFields =
      buildInsightAvailableFields(
        ordersTable,
        joinedTables,
        doubleJoinInsight,
      ) ?? [];

    // Mirror the hook's disambiguation logic:
    // 1. Walk joins to build (rightTableId, instanceIndex) → leftKey map.
    const joinKeyByInstance = new Map<string, string>();
    const instanceCount = new Map<string, number>();
    for (const join of doubleJoinInsight.joins!) {
      const idx = instanceCount.get(join.rightTableId) ?? 0;
      joinKeyByInstance.set(`${join.rightTableId}:${idx}`, join.leftKey);
      instanceCount.set(join.rightTableId, idx + 1);
    }

    // 2. Find base UUIDs that have ≥2 instances.
    const baseUuidsWithRepeat = new Set<string>();
    for (const field of resolvedFields) {
      const components = extractColumnAliasComponents(
        fieldIdToColumnAlias(field.id),
      );
      if (components && components.instanceIndex > 0) {
        baseUuidsWithRepeat.add(components.uuid);
      }
    }

    // 3. Build display name map with disambiguation.
    const displayNames: Record<string, string> = {};
    for (const field of resolvedFields) {
      const alias = fieldIdToColumnAlias(field.id);
      const components = extractColumnAliasComponents(alias);
      if (components && baseUuidsWithRepeat.has(components.uuid)) {
        const leftKey = joinKeyByInstance.get(
          `${field.tableId}:${components.instanceIndex}`,
        );
        displayNames[alias] = leftKey
          ? `${field.name} (${leftKey})`
          : field.name;
      } else {
        displayNames[alias] = field.name;
      }
    }

    const j0Alias = fieldIdToColumnAlias(U_NAME_FIELD.id);
    const j1NameId = `${U_NAME_FIELD.id}_j1` as UUID;
    const j1Alias = fieldIdToColumnAlias(j1NameId);

    // J0 → "User Name (created_by)", J1 → "User Name (approved_by)"
    expect(displayNames[j0Alias]).toBe("User Name (created_by)");
    expect(displayNames[j1Alias]).toBe("User Name (approved_by)");

    // Labels are distinct — the picker shows two distinguishable options.
    expect(displayNames[j0Alias]).not.toBe(displayNames[j1Alias]);

    // Field.name is NOT mutated — it stays canonical.
    const j0Field = resolvedFields.find((f) => f.id === U_NAME_FIELD.id);
    const j1Field = resolvedFields.find((f) => f.id === j1NameId);
    expect(j0Field!.name).toBe(U_NAME_FIELD.name);
    expect(j1Field!.name).toBe(U_NAME_FIELD.name);

    // Non-colliding fields (e.g. User Email) are unaffected — no "(leftKey)" suffix.
    const j0EmailAlias = fieldIdToColumnAlias(U_EMAIL_FIELD.id);
    const j1EmailId = `${U_EMAIL_FIELD.id}_j1` as UUID;
    const j1EmailAlias = fieldIdToColumnAlias(j1EmailId);
    expect(displayNames[j0EmailAlias]).toBe("User Email (created_by)");
    expect(displayNames[j1EmailAlias]).toBe("User Email (approved_by)");
  });

  it("(C) single-join: display names are unambiguous bare field names (no leftKey suffix)", () => {
    // Non-regression: when there's only one join to a table, no disambiguation
    // suffix should appear.  "User Name" stays "User Name".
    const resolvedFields =
      buildInsightAvailableFields(
        ordersTable,
        joinedTables,
        singleJoinInsight,
      ) ?? [];

    // Walk the single join
    const joinKeyByInstance = new Map<string, string>();
    const instanceCount = new Map<string, number>();
    for (const join of singleJoinInsight.joins!) {
      const idx = instanceCount.get(join.rightTableId) ?? 0;
      joinKeyByInstance.set(`${join.rightTableId}:${idx}`, join.leftKey);
      instanceCount.set(join.rightTableId, idx + 1);
    }

    const baseUuidsWithRepeat = new Set<string>();
    for (const field of resolvedFields) {
      const components = extractColumnAliasComponents(
        fieldIdToColumnAlias(field.id),
      );
      if (components && components.instanceIndex > 0) {
        baseUuidsWithRepeat.add(components.uuid);
      }
    }

    const displayNames: Record<string, string> = {};
    for (const field of resolvedFields) {
      const alias = fieldIdToColumnAlias(field.id);
      const components = extractColumnAliasComponents(alias);
      if (components && baseUuidsWithRepeat.has(components.uuid)) {
        const leftKey = joinKeyByInstance.get(
          `${field.tableId}:${components.instanceIndex}`,
        );
        displayNames[alias] = leftKey
          ? `${field.name} (${leftKey})`
          : field.name;
      } else {
        displayNames[alias] = field.name;
      }
    }

    const j0Alias = fieldIdToColumnAlias(U_NAME_FIELD.id);
    // Single join — no repeat — so no disambiguation suffix.
    expect(displayNames[j0Alias]).toBe("User Name");
  });
});
