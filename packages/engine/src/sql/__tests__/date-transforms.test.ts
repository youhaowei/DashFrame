import { describe, expect, it } from "bun:test";

import {
  applyDateTransformToSql,
  categoricalTransform,
  temporalTransform,
} from "../date-transforms";

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
    it("normal column name is quoted", () => {
      const sql = applyDateTransformToSql(
        "created_at",
        temporalTransform("yearMonth"),
      );
      expect(sql).toBe(`date_trunc('month', "created_at")`);
    });

    it("hostile column name with embedded double-quote is escaped", () => {
      // Contract: the embedded " is escaped to "" so the identifier boundary
      // is never broken. The raw hostile string must not appear in the output.
      const sql = applyDateTransformToSql(
        'amount"malicious',
        temporalTransform("yearMonth"),
      );
      expect(sql).toBe(`date_trunc('month', "amount""malicious")`);
      expect(sql).not.toContain('amount"m');
    });

    it("'none' aggregation returns the quoted column as-is (passthrough)", () => {
      const sql = applyDateTransformToSql(
        "order_date",
        temporalTransform("none"),
      );
      expect(sql).toBe('"order_date"');
    });

    it("year aggregation quotes the identifier", () => {
      const sql = applyDateTransformToSql(
        'year"col',
        temporalTransform("year"),
      );
      expect(sql).toBe(`date_trunc('year', "year""col")`);
    });

    it("yearWeek aggregation quotes the identifier", () => {
      const sql = applyDateTransformToSql(
        "shipped_at",
        temporalTransform("yearWeek"),
      );
      expect(sql).toBe(`date_trunc('week', "shipped_at")`);
    });
  });

  describe("categorical groupings", () => {
    it("monthName transform quotes the identifier", () => {
      const sql = applyDateTransformToSql(
        "order_date",
        categoricalTransform("monthName"),
      );
      expect(sql).toBe(`monthname("order_date")`);
    });

    it("hostile column name is escaped in categorical monthName", () => {
      const sql = applyDateTransformToSql(
        'amount"malicious',
        categoricalTransform("monthName"),
      );
      expect(sql).toBe(`monthname("amount""malicious")`);
      expect(sql).not.toContain('amount"m');
    });

    it("dayOfWeek transform quotes the identifier", () => {
      const sql = applyDateTransformToSql(
        "event_date",
        categoricalTransform("dayOfWeek"),
      );
      expect(sql).toBe(`dayname("event_date")`);
    });

    it("quarter transform quotes the identifier", () => {
      const sql = applyDateTransformToSql(
        "sale_date",
        categoricalTransform("quarter"),
      );
      expect(sql).toBe(`quarter("sale_date")`);
    });
  });
});
