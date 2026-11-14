/**
 * Unit tests for column-analysis module
 *
 * Tests cover:
 * - looksLikeIdentifier() - Detect identifier column names
 */
import { describe, expect, it } from "vite-plus/test";
import { looksLikeIdentifier } from "./column-analysis";

describe("column-analysis", () => {
  describe("looksLikeIdentifier()", () => {
    describe("suffix patterns", () => {
      it("should detect columns ending with '_id'", () => {
        expect(looksLikeIdentifier("user_id")).toBe(true);
        expect(looksLikeIdentifier("customer_id")).toBe(true);
        expect(looksLikeIdentifier("order_id")).toBe(true);
        expect(looksLikeIdentifier("product_ID")).toBe(true);
      });
    });

    describe("non-identifier column names", () => {
      it("should NOT detect columns with 'id' in the middle", () => {
        expect(looksLikeIdentifier("video")).toBe(false);
        expect(looksLikeIdentifier("friday")).toBe(false);
        expect(looksLikeIdentifier("idea")).toBe(false);
      });
    });

    describe("edge cases", () => {
      it("should prioritize false positive patterns over ID patterns", () => {
        // Each name matches an ID pattern (/^id_/i) and a NOT_ID pattern; the
        // NOT_ID pattern must win.
        expect(looksLikeIdentifier("id_zipcode")).toBe(false);
        expect(looksLikeIdentifier("id_postcode")).toBe(false);
        expect(looksLikeIdentifier("ID_AreaCode")).toBe(false);
      });
    });
  });
});
