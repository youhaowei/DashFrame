/**
 * Unit tests for the duplicate-join detection helpers.
 *
 * Contract: classify the pending join so the UI can label correctly.
 * Never prevent creation (only warn).
 */

import type { InsightJoinConfig } from "@dashframe/types";
import { describe, expect, it } from "vite-plus/test";
import {
  findExistingJoinsToTable,
  isExactDuplicateJoin,
} from "./join-duplicate-guard";

const TABLE_A = "table-a-id";
const TABLE_B = "table-b-id";

const joinAInner: InsightJoinConfig = {
  type: "inner",
  rightTableId: TABLE_A,
  leftKey: "created_by",
  rightKey: "id",
};

const joinALeft: InsightJoinConfig = {
  type: "left",
  rightTableId: TABLE_A,
  leftKey: "approved_by",
  rightKey: "id",
};

const joinB: InsightJoinConfig = {
  type: "inner",
  rightTableId: TABLE_B,
  leftKey: "region_id",
  rightKey: "id",
};

// ---------------------------------------------------------------------------
// findExistingJoinsToTable
// ---------------------------------------------------------------------------

describe("findExistingJoinsToTable", () => {
  it("returns all matching joins when multiple joins target the same table", () => {
    // The legitimate double-join case: same right table, different keys
    const existing = [joinAInner, joinALeft, joinB];
    const result = findExistingJoinsToTable(existing, TABLE_A);
    expect(result).toHaveLength(2);
    expect(result).toContain(joinAInner);
    expect(result).toContain(joinALeft);
  });
});

// ---------------------------------------------------------------------------
// isExactDuplicateJoin
// ---------------------------------------------------------------------------

describe("isExactDuplicateJoin", () => {
  it("returns true when candidate exactly matches an existing join", () => {
    expect(
      isExactDuplicateJoin([joinAInner], {
        leftKey: "created_by",
        rightKey: "id",
        type: "inner",
      }),
    ).toBe(true);
  });

  it("returns false when keys match but type differs", () => {
    expect(
      isExactDuplicateJoin([joinAInner], {
        leftKey: "created_by",
        rightKey: "id",
        type: "left",
      }),
    ).toBe(false);
  });

  it("returns false when type matches but leftKey differs — different-key double join is legitimate", () => {
    expect(
      isExactDuplicateJoin([joinAInner], {
        leftKey: "approved_by",
        rightKey: "id",
        type: "inner",
      }),
    ).toBe(false);
  });

  it("returns false when type and leftKey match but rightKey differs", () => {
    expect(
      isExactDuplicateJoin([joinAInner], {
        leftKey: "created_by",
        rightKey: "user_id",
        type: "inner",
      }),
    ).toBe(false);
  });
});
