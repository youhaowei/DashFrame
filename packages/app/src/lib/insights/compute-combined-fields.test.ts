import type { InsightJoinConfig } from "@dashframe/types";
import { describe, expect, it } from "vitest";
import {
  computeFilterableFields,
  type CombinedField,
} from "./compute-combined-fields";

/**
 * Locks the filterable-field narrowing used by the FilterEditDialog picker.
 * Every offered field must back a working, unambiguous predicate — so dropped
 * right join-keys and ambiguous duplicate column names are excluded. Mirrors
 * the insight SQL builder's join emission (right join-key dropped) and its
 * column-name-based filter resolution.
 */

function field(overrides: Partial<CombinedField>): CombinedField {
  return {
    id: overrides.id ?? `id-${overrides.name ?? "f"}`,
    name: overrides.name ?? "f",
    type: "string",
    columnName: overrides.columnName,
    sourceTableId: overrides.sourceTableId ?? "table-base",
    displayName: overrides.displayName ?? overrides.name ?? "f",
    ...overrides,
  } as CombinedField;
}

describe("computeFilterableFields", () => {
  it("returns all fields unchanged when there are no joins", () => {
    const fields = [
      field({ id: "a", name: "amount", columnName: "amount" }),
      field({ id: "b", name: "region", columnName: "region" }),
    ];
    expect(computeFilterableFields(fields, undefined)).toHaveLength(2);
  });

  it("excludes the right-side join key (dropped from the emitted subquery)", () => {
    // The joined table's `room_id` is joined on join.rightKey and dropped from
    // the subquery — a filter on it would silently resolve to a missing column.
    const fields = [
      field({ id: "lead-id", name: "lead_id", columnName: "lead_id" }),
      field({
        id: "room-id",
        name: "room_id",
        columnName: "room_id",
        sourceTableId: "table-rooms",
      }),
      field({
        id: "room-name",
        name: "room_name",
        columnName: "room_name",
        sourceTableId: "table-rooms",
      }),
    ];
    const joins: InsightJoinConfig[] = [
      {
        type: "inner",
        rightTableId: "table-rooms",
        leftKey: "lead_id",
        rightKey: "room_id",
      },
    ];
    const result = computeFilterableFields(fields, joins);
    expect(result.map((f) => f.columnName)).toEqual(["lead_id", "room_name"]);
    expect(result.some((f) => f.columnName === "room_id")).toBe(false);
  });

  it("matches the right join key case-insensitively", () => {
    const fields = [
      field({ id: "k", name: "ID", columnName: "ID", sourceTableId: "t2" }),
      field({
        id: "x",
        name: "label",
        columnName: "label",
        sourceTableId: "t2",
      }),
    ];
    const joins: InsightJoinConfig[] = [
      {
        type: "inner",
        rightTableId: "t2",
        leftKey: "fk",
        rightKey: "id", // lower-case, field is "ID"
      },
    ];
    const result = computeFilterableFields(fields, joins);
    expect(result.some((f) => f.columnName === "ID")).toBe(false);
  });

  it("excludes both sides of an ambiguous duplicate column name", () => {
    // Base `id` and joined `id` both persist the bare value "id"; the resolver
    // cannot disambiguate, so neither may be offered.
    const fields = [
      field({ id: "base-id", name: "id", columnName: "id" }),
      field({
        id: "join-id",
        name: "id",
        columnName: "id",
        sourceTableId: "t2",
        displayName: "rooms.id",
      }),
      field({ id: "amount", name: "amount", columnName: "amount" }),
    ];
    // No join key dropping in play here (rightKey unrelated).
    const joins: InsightJoinConfig[] = [
      {
        type: "inner",
        rightTableId: "t2",
        leftKey: "amount",
        rightKey: "amount_ref",
      },
    ];
    const result = computeFilterableFields(fields, joins);
    expect(result.map((f) => f.columnName)).toEqual(["amount"]);
  });
});
