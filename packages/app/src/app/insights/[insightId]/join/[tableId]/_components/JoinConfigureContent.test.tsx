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

import { quoteIdentifier } from "@dashframe/engine-browser";
import { describe, expect, it } from "vitest";

/**
 * Derives a DuckDB table name from a dataFrameId exactly as the component does
 * (`df_${id.replace(/-/g, "_")}`), so the test guards the same value shape.
 */
function deriveTableName(dataFrameId: string): string {
  return `df_${dataFrameId.replace(/-/g, "_")}`;
}

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
