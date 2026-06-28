/**
 * Unit tests for the join type → DuckDB SQL keyword mapping.
 *
 * Guards the exact mapping used at all three preview SQL emit sites:
 *   - engine-browser/src/insight.ts (Insight.toSQL)
 *   - engine-browser/src/query-builder.ts (QueryBuilder.buildFromClause)
 *   - packages/app/JoinConfigureContent.tsx (join preview DuckDB query)
 *
 * "OUTER JOIN" alone is invalid DuckDB SQL; this mapping centralises the fix so
 * the bug class cannot recur silently at any of these three call sites.
 */

import { describe, expect, it } from "vitest";
import { JOIN_TYPE_TO_SQL_KEYWORD, joinTypeToSQL } from "../join-sql";

describe("joinTypeToSQL", () => {
  it.each([
    ["inner", "INNER"],
    ["left", "LEFT"],
    ["right", "RIGHT"],
    // "outer" is the UI display value — must produce FULL OUTER, not bare OUTER.
    ["outer", "FULL OUTER"],
    // "full" is the persisted config value (toConfigType maps "outer" → "full").
    ["full", "FULL OUTER"],
  ])("joinTypeToSQL('%s') === '%s'", (type, expected) => {
    expect(joinTypeToSQL(type)).toBe(expected);
  });

  it("outer produces a valid FULL OUTER JOIN fragment (not bare OUTER JOIN)", () => {
    const fragment = `${joinTypeToSQL("outer")} JOIN t ON a = b`;
    expect(fragment).toBe("FULL OUTER JOIN t ON a = b");
    // Explicitly guard against the bug: bare "OUTER JOIN" without "FULL" prefix.
    expect(fragment.replace("FULL OUTER JOIN", "")).not.toContain("OUTER JOIN");
  });

  it("full produces the same fragment as outer (both mean FULL OUTER JOIN)", () => {
    expect(joinTypeToSQL("full")).toBe(joinTypeToSQL("outer"));
  });

  it("throws for an unrecognised type (fail-closed: never emit 'undefined JOIN')", () => {
    expect(() => joinTypeToSQL("cross")).toThrow(/unknown join type/);
    expect(() => joinTypeToSQL("")).toThrow(/unknown join type/);
    expect(() => joinTypeToSQL("OUTER")).toThrow(/unknown join type/);
  });
});

describe("JOIN_TYPE_TO_SQL_KEYWORD", () => {
  it("covers all four UI join type values", () => {
    for (const type of ["inner", "left", "right", "outer"] as const) {
      expect(JOIN_TYPE_TO_SQL_KEYWORD[type]).toBeDefined();
    }
  });

  it("covers the persisted config value 'full'", () => {
    expect(JOIN_TYPE_TO_SQL_KEYWORD.full).toBe("FULL OUTER");
  });

  it("no entry produces a bare 'OUTER' keyword (which DuckDB rejects)", () => {
    for (const keyword of Object.values(JOIN_TYPE_TO_SQL_KEYWORD)) {
      // "OUTER JOIN" alone is invalid; "FULL OUTER JOIN" is valid.
      expect(keyword).not.toBe("OUTER");
    }
  });
});
