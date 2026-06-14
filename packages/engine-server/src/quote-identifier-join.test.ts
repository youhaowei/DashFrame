import { quoteIdentifier } from "@dashframe/engine";
import { afterEach, describe, expect, it } from "vitest";

import { NativeDuckDBEngine } from "./native-engine";

/**
 * Regression coverage for the join-builder SQL identifier escaping fix.
 *
 * Column/table identifiers in the join SQL builders
 * (`JoinConfigureContent.tsx`) come from ingested data sources (CSV headers,
 * Notion column names) = untrusted input. Before the fix, a column named with a
 * reserved word, a space, or an embedded double-quote either broke the query or
 * enabled identifier injection. These tests run the generated SQL against real
 * DuckDB to prove that `quoteIdentifier` makes such names work.
 */
describe("quoteIdentifier — join SQL against real DuckDB", () => {
  let engine: NativeDuckDBEngine | null = null;

  afterEach(async () => {
    await engine?.dispose();
    engine = null;
  });

  it("joins on a reserved-word column name without breaking SQL", async () => {
    engine = new NativeDuckDBEngine();
    await engine.initialize();

    // "order" is a SQL reserved word — unquoted it is a syntax error.
    await engine.query(
      `CREATE TABLE base AS SELECT 1 AS ${quoteIdentifier("order")}`,
    );
    await engine.query(
      `CREATE TABLE other AS SELECT 1 AS ${quoteIdentifier("order")}`,
    );

    const result = await engine.query(`
      SELECT COUNT(*) AS cnt
      FROM base AS b
      INNER JOIN other AS j
      ON b.${quoteIdentifier("order")} = j.${quoteIdentifier("order")}
    `);

    expect(Number(result.rows[0]!.cnt)).toBe(1);
  });

  it("joins on a column name containing a double-quote (no injection, valid SQL)", async () => {
    engine = new NativeDuckDBEngine();
    await engine.initialize();

    // A column name an attacker (or messy CSV) might supply. The embedded
    // double-quote must be doubled so it stays a single identifier and cannot
    // close the quote to inject SQL.
    const weird = 'weird"name';
    await engine.query(
      `CREATE TABLE base AS SELECT 42 AS ${quoteIdentifier(weird)}`,
    );
    await engine.query(
      `CREATE TABLE other AS SELECT 42 AS ${quoteIdentifier(weird)}`,
    );

    const result = await engine.query(`
      SELECT COUNT(*) AS cnt
      FROM base AS b
      INNER JOIN other AS j
      ON b.${quoteIdentifier(weird)} = j.${quoteIdentifier(weird)}
    `);

    expect(Number(result.rows[0]!.cnt)).toBe(1);
  });

  it("does not let a crafted column name inject extra SQL", async () => {
    engine = new NativeDuckDBEngine();
    await engine.initialize();

    await engine.query("CREATE TABLE base AS SELECT 1 AS id");
    // Injection payload as a column name. Quoted, it must be treated as a
    // (non-existent) identifier — a binder error — NOT executed as SQL. The
    // important property: it must not silently succeed by running the payload.
    const malicious = 'id" FROM base; DROP TABLE base; --';

    await expect(
      engine.query(`SELECT ${quoteIdentifier(malicious)} AS val FROM base`),
    ).rejects.toThrow();

    // base must still exist — the DROP inside the payload never executed.
    const stillThere = await engine.query("SELECT COUNT(*) AS cnt FROM base");
    expect(Number(stillThere.rows[0]!.cnt)).toBe(1);
  });

  it("joins on an ordinary column name (no regression)", async () => {
    engine = new NativeDuckDBEngine();
    await engine.initialize();

    await engine.query(
      `CREATE TABLE base AS SELECT 7 AS ${quoteIdentifier("user_id")}`,
    );
    await engine.query(
      `CREATE TABLE other AS SELECT 7 AS ${quoteIdentifier("user_id")}`,
    );

    const result = await engine.query(`
      SELECT COUNT(*) AS cnt
      FROM base AS b
      INNER JOIN other AS j
      ON b.${quoteIdentifier("user_id")} = j.${quoteIdentifier("user_id")}
    `);

    expect(Number(result.rows[0]!.cnt)).toBe(1);
  });
});
