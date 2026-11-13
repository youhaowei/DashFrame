import { describe, expect, it } from "bun:test";

import { applyDateTransformToSql } from "../date-transforms";

// ---------------------------------------------------------------------------
// applyDateTransformToSql — identifier sink-guard tests
//
// Contract: column names are quoted via quoteIdentifier at the point of SQL
// construction. An identifier containing an embedded double-quote must be
// escaped (doubled), not passed through raw, so the SQL identifier boundary
// stays closed regardless of column-name provenance.
// ---------------------------------------------------------------------------

describe("applyDateTransformToSql — identifier sink-guard", () => {
  describe("temporal aggregations", () => {
    it("hostile column name with embedded double-quote is escaped", () => {
      // Contract: the embedded " is escaped to "" so the identifier boundary
      // is never broken. The raw hostile string must not appear in the output.
      const sql = applyDateTransformToSql('amount"malicious', {
        kind: "temporal",
        aggregation: "yearMonth",
      });
      expect(sql).toBe(`date_trunc('month', "amount""malicious")`);
      expect(sql).not.toContain('amount"m');
    });

    it("'none' aggregation returns the quoted column as-is (passthrough)", () => {
      const sql = applyDateTransformToSql("order_date", {
        kind: "temporal",
        aggregation: "none",
      });
      expect(sql).toBe('"order_date"');
    });
  });

  describe("categorical groupings", () => {
    it("monthName transform quotes the identifier", () => {
      const sql = applyDateTransformToSql("order_date", {
        kind: "categorical",
        groupBy: "monthName",
      });
      expect(sql).toBe(`monthname("order_date")`);
    });
  });
});
