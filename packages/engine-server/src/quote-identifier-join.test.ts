import { quoteIdentifier } from "@dashframe/engine";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { arrowIpcToJsonRows } from "./arrow-data-path";
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

  /**
   * The engine speaks Arrow only; JSON rows are decoded where transport
   * decodes them. These tests care about SQL semantics, not the encoding, so
   * they go through the same decoder the data path uses.
   */
  const rows = async (sql: string): Promise<Record<string, unknown>[]> =>
    arrowIpcToJsonRows(await engine!.queryArrow(sql));

  afterEach(async () => {
    await engine?.dispose();
    engine = null;
  });

  it("does not let a crafted column name inject extra SQL", async () => {
    engine = new NativeDuckDBEngine();
    await engine.initialize();

    await engine.queryArrow("CREATE TABLE base AS SELECT 1 AS id");
    // Injection payload as a column name. Quoted, it must be treated as a
    // (non-existent) identifier — a binder error — NOT executed as SQL. The
    // important property: it must not silently succeed by running the payload.
    const malicious = 'id" FROM base; DROP TABLE base; --';

    await expect(
      engine.queryArrow(
        `SELECT ${quoteIdentifier(malicious)} AS val FROM base`,
      ),
    ).rejects.toThrow();

    // base must still exist — the DROP inside the payload never executed.
    const stillThere = await rows("SELECT COUNT(*) AS cnt FROM base");
    expect(Number(stillThere[0]!.cnt)).toBe(1);
  });
});
