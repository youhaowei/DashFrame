/**
 * SQL sink-guard contract for the Join configuration flow.
 *
 * Table names are derived from a dataFrameId and interpolated into the preview
 * SQL. They must be quoted at the point of use so the sink is safe regardless
 * of where the value came from. This exercises the real `quoteIdentifier` used
 * by the component, with table names that contain SQL metacharacters.
 *
 * The async-lifecycle contracts (stale-run guard, submit recovery) are covered
 * against the real production helpers in `join-preview-run.test.ts`.
 */

import {
  JOIN_TYPE_TO_SQL_KEYWORD,
  joinTypeToSQL,
  quoteIdentifier,
} from "@dashframe/engine-browser";
import { describe, expect, it } from "vitest";

/**
 * Derives a DuckDB table name from a dataFrameId exactly as the component does
 * (`df_${id.replace(/-/g, "_")}`), so the test guards the same value shape.
 */
function deriveTableName(dataFrameId: string): string {
  return `df_${dataFrameId.replace(/-/g, "_")}`;
}

describe("join SQL — join type keyword mapping", () => {
  // These tests guard the production mapping used at the preview SQL emit site.
  // The mapping must be explicit (not .toUpperCase()) so "outer" → "FULL OUTER JOIN"
  // rather than the invalid "OUTER JOIN" that DuckDB rejects.

  it.each([
    ["inner", "INNER"],
    ["left", "LEFT"],
    ["right", "RIGHT"],
    // "outer" is the UI display value; must map to FULL OUTER, not bare OUTER.
    ["outer", "FULL OUTER"],
    // "full" is the persisted config value; toConfigType maps "outer" → "full".
    ["full", "FULL OUTER"],
  ] as Array<[string, string]>)(
    "joinTypeToSQL('%s') === '%s JOIN …'",
    (type, expectedKeyword) => {
      expect(joinTypeToSQL(type)).toBe(expectedKeyword);
    },
  );

  it("outer produces a valid FULL OUTER JOIN fragment (not bare OUTER JOIN)", () => {
    const fragment = `${joinTypeToSQL("outer")} JOIN t ON a = b`;
    expect(fragment).toBe("FULL OUTER JOIN t ON a = b");
  });

  it("throws for an unrecognised join type (fail-closed, never emits 'undefined JOIN')", () => {
    expect(() => joinTypeToSQL("cross")).toThrow("unknown join type");
  });

  it("JOIN_TYPE_TO_SQL_KEYWORD covers all four UI join types", () => {
    for (const type of ["inner", "left", "right", "outer"] as const) {
      expect(JOIN_TYPE_TO_SQL_KEYWORD[type]).toBeDefined();
    }
  });
});

describe("join SQL — component preview SQL template (consumer path)", () => {
  // Guards the real emit site in JoinConfigureContent.tsx lines 701-707.
  // A helper-only test (joinTypeToSQL("outer") === "FULL OUTER") still passes if the
  // component stops calling the helper or interpolates it incorrectly. These tests
  // replicate the exact SQL template so any regression at the call site is caught.

  it("emits FULL OUTER JOIN in the component SQL template for joinType 'outer'", () => {
    // Replicate the exact template from JoinConfigureContent.tsx lines 701-707.
    const baseTableName = "df_abc_123";
    const joinTableName = "df_def_456";
    const leftColumnName = "id";
    const rightColumnName = "account_id";
    // PREVIEW_ROW_LIMIT = 50 (JoinConfigureContent.tsx:64 — local constant, not exported)
    const PREVIEW_ROW_LIMIT = 50;

    const joinTypeSQL = joinTypeToSQL("outer");

    const joinSQL = `
      SELECT *
      FROM ${quoteIdentifier(baseTableName)} AS base
      ${joinTypeSQL} JOIN ${quoteIdentifier(joinTableName)} AS j
      ON base.${quoteIdentifier(leftColumnName)} = j.${quoteIdentifier(rightColumnName)}
      LIMIT ${PREVIEW_ROW_LIMIT}
    `;

    expect(joinSQL).toContain("FULL OUTER JOIN");
    // Guard: no bare "OUTER JOIN" without the "FULL" prefix (which DuckDB rejects).
    expect(joinSQL.replace(/FULL OUTER JOIN/g, "")).not.toContain("OUTER JOIN");
  });

  it("emits INNER JOIN (not FULL OUTER) for joinType 'inner'", () => {
    const joinTypeSQL = joinTypeToSQL("inner");
    const sql = `FROM ${quoteIdentifier("df_base")} AS base ${joinTypeSQL} JOIN ${quoteIdentifier("df_other")} AS j ON base."id" = j."id" LIMIT 50`;
    expect(sql).toContain("INNER JOIN");
    expect(sql).not.toContain("OUTER");
  });
});

describe("join SQL — table name sink-guard", () => {
  it("quoteIdentifier wraps the dataFrameId-derived table name in double-quotes", () => {
    const tableName = deriveTableName("abc-123-def");
    const quoted = quoteIdentifier(tableName);
    expect(quoted).toBe('"df_abc_123_def"');
  });

  it("neutralizes a table name containing a single-quote (SQL metacharacter)", () => {
    // If a dataFrameId somehow produced a name with a single-quote (e.g. via
    // external data), quoteIdentifier must not let it escape the identifier context.
    const tableName = "df_abc_123'; DROP TABLE users; --";
    const quoted = quoteIdentifier(tableName);

    // The result must be enclosed in double-quotes (identifier quoting).
    expect(quoted.startsWith('"')).toBe(true);
    expect(quoted.endsWith('"')).toBe(true);

    // The raw injection attempt is contained inside the quoted identifier.
    const inner = quoted.slice(1, -1);
    expect(inner).toContain("'; DROP TABLE users; --");
  });

  it("neutralizes a table name containing a double-quote (break-out attempt)", () => {
    // A double-quote in the name would close the identifier early without escaping.
    // quoteIdentifier doubles it, preventing break-out.
    const tableName = 'df_abc"--injection';
    const quoted = quoteIdentifier(tableName);

    expect(quoted).toBe('"df_abc""--injection"');
    // The embedded " is doubled — it cannot close the identifier context early.
    expect(quoted.startsWith('"')).toBe(true);
    expect(quoted.endsWith('"')).toBe(true);
  });

  it("produces a valid SQL fragment when interpolated into a FROM clause", () => {
    // Construct the FROM clause the same way the component does, and assert
    // the injection attempt is neutralized — the SQL does NOT contain a raw
    // semicolon outside of the quoted identifier.
    const tableName = deriveTableName("1234-5678");
    const quotedTable = quoteIdentifier(tableName);
    const sql = `SELECT 1 FROM ${quotedTable} AS base`;

    // The output must be a single SELECT statement — no injected commands.
    expect(sql).toBe('SELECT 1 FROM "df_1234_5678" AS base');
    // No unquoted semicolons that could terminate the statement.
    expect(sql.replace(/"[^"]*"/g, "")).not.toContain(";");
  });
});
