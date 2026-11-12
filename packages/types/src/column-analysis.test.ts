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
    describe("exact matches (case insensitive)", () => {
      it("should detect 'id'", () => {
        expect(looksLikeIdentifier("id")).toBe(true);
        expect(looksLikeIdentifier("ID")).toBe(true);
        expect(looksLikeIdentifier("Id")).toBe(true);
      });

      it("should detect 'uuid'", () => {
        expect(looksLikeIdentifier("uuid")).toBe(true);
        expect(looksLikeIdentifier("UUID")).toBe(true);
        expect(looksLikeIdentifier("Uuid")).toBe(true);
      });

      it("should detect 'guid'", () => {
        expect(looksLikeIdentifier("guid")).toBe(true);
        expect(looksLikeIdentifier("GUID")).toBe(true);
        expect(looksLikeIdentifier("Guid")).toBe(true);
      });

      it("should detect 'pk'", () => {
        expect(looksLikeIdentifier("pk")).toBe(true);
        expect(looksLikeIdentifier("PK")).toBe(true);
        expect(looksLikeIdentifier("Pk")).toBe(true);
      });

      it("should detect '_rowindex'", () => {
        expect(looksLikeIdentifier("_rowindex")).toBe(true);
        expect(looksLikeIdentifier("_ROWINDEX")).toBe(true);
        expect(looksLikeIdentifier("_RowIndex")).toBe(true);
      });

      it("should detect 'rowindex'", () => {
        expect(looksLikeIdentifier("rowindex")).toBe(true);
        expect(looksLikeIdentifier("ROWINDEX")).toBe(true);
        expect(looksLikeIdentifier("RowIndex")).toBe(true);
      });
    });

    describe("suffix patterns", () => {
      it("should detect columns ending with '_id'", () => {
        expect(looksLikeIdentifier("user_id")).toBe(true);
        expect(looksLikeIdentifier("customer_id")).toBe(true);
        expect(looksLikeIdentifier("order_id")).toBe(true);
        expect(looksLikeIdentifier("product_ID")).toBe(true);
      });

      it("should detect camelCase columns ending with 'Id'", () => {
        expect(looksLikeIdentifier("userId")).toBe(true);
        expect(looksLikeIdentifier("customerId")).toBe(true);
        expect(looksLikeIdentifier("orderId")).toBe(true);
      });

      it("should detect columns ending with 'key'", () => {
        expect(looksLikeIdentifier("primary_key")).toBe(true);
        expect(looksLikeIdentifier("api_key")).toBe(true);
        expect(looksLikeIdentifier("authkey")).toBe(true);
        expect(looksLikeIdentifier("sessionKey")).toBe(true);
      });
    });

    describe("prefix patterns", () => {
      it("should detect columns starting with 'id_'", () => {
        expect(looksLikeIdentifier("id_user")).toBe(true);
        expect(looksLikeIdentifier("id_customer")).toBe(true);
        expect(looksLikeIdentifier("ID_order")).toBe(true);
      });
    });

    describe("non-identifier column names", () => {
      it("should NOT detect regular column names", () => {
        expect(looksLikeIdentifier("name")).toBe(false);
        expect(looksLikeIdentifier("email")).toBe(false);
        expect(looksLikeIdentifier("revenue")).toBe(false);
        expect(looksLikeIdentifier("category")).toBe(false);
      });

      it("should NOT detect columns with 'id' in the middle", () => {
        expect(looksLikeIdentifier("video")).toBe(false);
        expect(looksLikeIdentifier("friday")).toBe(false);
        expect(looksLikeIdentifier("idea")).toBe(false);
      });

      it("should detect columns ending with 'key' suffix", () => {
        // Words ending in 'key' match the /key$/i pattern
        expect(looksLikeIdentifier("monkey")).toBe(true);
        expect(looksLikeIdentifier("turkey")).toBe(true);
        expect(looksLikeIdentifier("hockey")).toBe(true);
      });
    });

    describe("edge cases", () => {
      it("should handle empty string", () => {
        expect(looksLikeIdentifier("")).toBe(false);
      });

      it("should handle single character", () => {
        expect(looksLikeIdentifier("i")).toBe(false);
        expect(looksLikeIdentifier("k")).toBe(false);
      });

      it("should handle special characters", () => {
        // "_id_" doesn't match any pattern (/_id$/ requires ending with _id, /^id_/ requires starting with id)
        expect(looksLikeIdentifier("_id_")).toBe(false);
        expect(looksLikeIdentifier("user-id")).toBe(false);
      });

      it("should handle mixed case combinations", () => {
        expect(looksLikeIdentifier("UserId")).toBe(true);
        expect(looksLikeIdentifier("USER_ID")).toBe(true);
        expect(looksLikeIdentifier("User_Id")).toBe(true);
      });

      it("should prioritize false positive patterns over ID patterns", () => {
        // Each name matches an ID pattern (/^id_/i) and a NOT_ID pattern; the
        // NOT_ID pattern must win.
        expect(looksLikeIdentifier("id_zipcode")).toBe(false);
        expect(looksLikeIdentifier("id_postcode")).toBe(false);
        expect(looksLikeIdentifier("ID_AreaCode")).toBe(false);
      });
    });

    describe("real-world examples", () => {
      it("should NOT detect descriptive columns", () => {
        expect(looksLikeIdentifier("first_name")).toBe(false);
        expect(looksLikeIdentifier("last_name")).toBe(false);
        expect(looksLikeIdentifier("email_address")).toBe(false);
        expect(looksLikeIdentifier("phone_number")).toBe(false);
        expect(looksLikeIdentifier("created_at")).toBe(false);
        expect(looksLikeIdentifier("updated_at")).toBe(false);
      });
    });
  });
});
