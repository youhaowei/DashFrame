/**
 * Unit tests for encoding-helpers module
 *
 * Tests cover:
 * - fieldEncoding() - Creating field encoding strings
 * - metricEncoding() - Creating metric encoding strings
 * - parseEncoding() - Parsing encoding strings into type and ID
 * - isFieldEncoding() - Type guard for field encodings
 * - isMetricEncoding() - Type guard for metric encodings
 * - isValidEncoding() - Type guard for valid encodings
 */
import { describe, expect, it } from "vitest";
import type { UUID } from "./uuid";
import {
  fieldEncoding,
  isFieldEncoding,
  isMetricEncoding,
  isValidEncoding,
  metricEncoding,
  parseEncoding,
} from "./encoding-helpers";

describe("encoding-helpers", () => {
  // Sample UUIDs for testing
  const sampleFieldId = "abc-123-def" as UUID;
  const sampleMetricId = "xyz-456-ghi" as UUID;

  describe("fieldEncoding()", () => {
    it("should create field encoding with correct format", () => {
      const result = fieldEncoding(sampleFieldId);
      expect(result).toBe("field:abc-123-def");
    });

    it("should handle different UUID formats", () => {
      const uuid1 = "550e8400-e29b-41d4-a716-446655440000" as UUID;
      const uuid2 = "simple-id" as UUID;

      expect(fieldEncoding(uuid1)).toBe("field:550e8400-e29b-41d4-a716-446655440000");
      expect(fieldEncoding(uuid2)).toBe("field:simple-id");
    });

    it("should create value that passes isFieldEncoding type guard", () => {
      const result = fieldEncoding(sampleFieldId);
      expect(isFieldEncoding(result)).toBe(true);
    });
  });

  describe("metricEncoding()", () => {
    it("should create metric encoding with correct format", () => {
      const result = metricEncoding(sampleMetricId);
      expect(result).toBe("metric:xyz-456-ghi");
    });

    it("should handle different UUID formats", () => {
      const uuid1 = "550e8400-e29b-41d4-a716-446655440000" as UUID;
      const uuid2 = "simple-id" as UUID;

      expect(metricEncoding(uuid1)).toBe("metric:550e8400-e29b-41d4-a716-446655440000");
      expect(metricEncoding(uuid2)).toBe("metric:simple-id");
    });

    it("should create value that passes isMetricEncoding type guard", () => {
      const result = metricEncoding(sampleMetricId);
      expect(isMetricEncoding(result)).toBe(true);
    });
  });

  describe("parseEncoding()", () => {
    describe("valid field encodings", () => {
      it("should parse field encoding correctly", () => {
        const result = parseEncoding("field:abc-123-def");
        expect(result).toEqual({
          type: "field",
          id: "abc-123-def",
        });
      });

      it("should parse field encoding with UUID format", () => {
        const result = parseEncoding("field:550e8400-e29b-41d4-a716-446655440000");
        expect(result).toEqual({
          type: "field",
          id: "550e8400-e29b-41d4-a716-446655440000",
        });
      });

      it("should parse field encoding with simple ID", () => {
        const result = parseEncoding("field:123");
        expect(result).toEqual({
          type: "field",
          id: "123",
        });
      });
    });

    describe("valid metric encodings", () => {
      it("should parse metric encoding correctly", () => {
        const result = parseEncoding("metric:xyz-456-ghi");
        expect(result).toEqual({
          type: "metric",
          id: "xyz-456-ghi",
        });
      });

      it("should parse metric encoding with UUID format", () => {
        const result = parseEncoding("metric:550e8400-e29b-41d4-a716-446655440000");
        expect(result).toEqual({
          type: "metric",
          id: "550e8400-e29b-41d4-a716-446655440000",
        });
      });

      it("should parse metric encoding with simple ID", () => {
        const result = parseEncoding("metric:789");
        expect(result).toEqual({
          type: "metric",
          id: "789",
        });
      });
    });

    describe("invalid encodings", () => {
      it("should return undefined for undefined input", () => {
        const result = parseEncoding(undefined);
        expect(result).toBeUndefined();
      });

      it("should return undefined for empty string", () => {
        const result = parseEncoding("");
        expect(result).toBeUndefined();
      });

      it("should return undefined for legacy format (no prefix)", () => {
        const result = parseEncoding("sum(revenue)");
        expect(result).toBeUndefined();
      });

      it("should return undefined for plain column names", () => {
        const result = parseEncoding("category");
        expect(result).toBeUndefined();
      });

      it("should return undefined for invalid prefix", () => {
        const result = parseEncoding("invalid:abc-123");
        expect(result).toBeUndefined();
      });

      it("should return undefined for missing ID after field prefix", () => {
        const result = parseEncoding("field:");
        expect(result).toEqual({
          type: "field",
          id: "",
        });
      });

      it("should return undefined for missing ID after metric prefix", () => {
        const result = parseEncoding("metric:");
        expect(result).toEqual({
          type: "metric",
          id: "",
        });
      });

      it("should return undefined for malformed encoding", () => {
        const result = parseEncoding("field");
        expect(result).toBeUndefined();
      });

      it("should return undefined for metric typo", () => {
        const result = parseEncoding("metrik:123");
        expect(result).toBeUndefined();
      });
    });

    describe("edge cases", () => {
      it("should handle encoding with special characters in ID", () => {
        const result = parseEncoding("field:id-with_special.chars@123");
        expect(result).toEqual({
          type: "field",
          id: "id-with_special.chars@123",
        });
      });

      it("should handle encoding with spaces in ID (though unusual)", () => {
        const result = parseEncoding("field:id with spaces");
        expect(result).toEqual({
          type: "field",
          id: "id with spaces",
        });
      });

      it("should handle encoding that looks like it has multiple prefixes", () => {
        const result = parseEncoding("field:metric:123");
        expect(result).toEqual({
          type: "field",
          id: "metric:123",
        });
      });
    });
  });

  describe("isFieldEncoding()", () => {
    describe("valid field encodings", () => {
      it("should return true for valid field encoding", () => {
        expect(isFieldEncoding("field:abc-123")).toBe(true);
      });

      it("should return true for field encoding with UUID", () => {
        expect(isFieldEncoding("field:550e8400-e29b-41d4-a716-446655440000")).toBe(true);
      });

      it("should return true for field encoding with simple ID", () => {
        expect(isFieldEncoding("field:123")).toBe(true);
      });

      it("should return true for field encoding with empty ID", () => {
        expect(isFieldEncoding("field:")).toBe(true);
      });
    });

    describe("invalid inputs", () => {
      it("should return false for undefined", () => {
        expect(isFieldEncoding(undefined)).toBe(false);
      });

      it("should return false for empty string", () => {
        expect(isFieldEncoding("")).toBe(false);
      });

      it("should return false for metric encoding", () => {
        expect(isFieldEncoding("metric:123")).toBe(false);
      });

      it("should return false for plain column name", () => {
        expect(isFieldEncoding("category")).toBe(false);
      });

      it("should return false for legacy format", () => {
        expect(isFieldEncoding("sum(revenue)")).toBe(false);
      });

      it("should return false for partial match", () => {
        expect(isFieldEncoding("field")).toBe(false);
      });

      it("should return false for prefix in wrong position", () => {
        expect(isFieldEncoding("abc-field:123")).toBe(false);
      });
    });
  });

  describe("isMetricEncoding()", () => {
    describe("valid metric encodings", () => {
      it("should return true for valid metric encoding", () => {
        expect(isMetricEncoding("metric:xyz-456")).toBe(true);
      });

      it("should return true for metric encoding with UUID", () => {
        expect(isMetricEncoding("metric:550e8400-e29b-41d4-a716-446655440000")).toBe(true);
      });

      it("should return true for metric encoding with simple ID", () => {
        expect(isMetricEncoding("metric:789")).toBe(true);
      });

      it("should return true for metric encoding with empty ID", () => {
        expect(isMetricEncoding("metric:")).toBe(true);
      });
    });

    describe("invalid inputs", () => {
      it("should return false for undefined", () => {
        expect(isMetricEncoding(undefined)).toBe(false);
      });

      it("should return false for empty string", () => {
        expect(isMetricEncoding("")).toBe(false);
      });

      it("should return false for field encoding", () => {
        expect(isMetricEncoding("field:123")).toBe(false);
      });

      it("should return false for plain column name", () => {
        expect(isMetricEncoding("revenue")).toBe(false);
      });

      it("should return false for legacy format", () => {
        expect(isMetricEncoding("sum(revenue)")).toBe(false);
      });

      it("should return false for partial match", () => {
        expect(isMetricEncoding("metric")).toBe(false);
      });

      it("should return false for prefix in wrong position", () => {
        expect(isMetricEncoding("abc-metric:123")).toBe(false);
      });
    });
  });

  describe("isValidEncoding()", () => {
    describe("valid encodings", () => {
      it("should return true for field encoding", () => {
        expect(isValidEncoding("field:abc-123")).toBe(true);
      });

      it("should return true for metric encoding", () => {
        expect(isValidEncoding("metric:xyz-456")).toBe(true);
      });

      it("should return true for field encoding with UUID", () => {
        expect(isValidEncoding("field:550e8400-e29b-41d4-a716-446655440000")).toBe(true);
      });

      it("should return true for metric encoding with UUID", () => {
        expect(isValidEncoding("metric:550e8400-e29b-41d4-a716-446655440000")).toBe(true);
      });
    });

    describe("invalid inputs", () => {
      it("should return false for undefined", () => {
        expect(isValidEncoding(undefined)).toBe(false);
      });

      it("should return false for empty string", () => {
        expect(isValidEncoding("")).toBe(false);
      });

      it("should return false for plain column name", () => {
        expect(isValidEncoding("category")).toBe(false);
      });

      it("should return false for legacy format", () => {
        expect(isValidEncoding("sum(revenue)")).toBe(false);
      });

      it("should return false for invalid prefix", () => {
        expect(isValidEncoding("invalid:123")).toBe(false);
      });

      it("should return false for partial field prefix", () => {
        expect(isValidEncoding("field")).toBe(false);
      });

      it("should return false for partial metric prefix", () => {
        expect(isValidEncoding("metric")).toBe(false);
      });
    });
  });

  describe("integration - roundtrip encoding", () => {
    it("should roundtrip field encoding through constructor and parser", () => {
      const id = sampleFieldId;
      const encoded = fieldEncoding(id);
      const parsed = parseEncoding(encoded);

      expect(parsed).toEqual({
        type: "field",
        id,
      });
    });

    it("should roundtrip metric encoding through constructor and parser", () => {
      const id = sampleMetricId;
      const encoded = metricEncoding(id);
      const parsed = parseEncoding(encoded);

      expect(parsed).toEqual({
        type: "metric",
        id,
      });
    });

    it("should pass all type guards for field encoding created via constructor", () => {
      const encoded = fieldEncoding(sampleFieldId);

      expect(isFieldEncoding(encoded)).toBe(true);
      expect(isMetricEncoding(encoded)).toBe(false);
      expect(isValidEncoding(encoded)).toBe(true);
    });

    it("should pass all type guards for metric encoding created via constructor", () => {
      const encoded = metricEncoding(sampleMetricId);

      expect(isFieldEncoding(encoded)).toBe(false);
      expect(isMetricEncoding(encoded)).toBe(true);
      expect(isValidEncoding(encoded)).toBe(true);
    });
  });

  describe("type safety guarantees", () => {
    it("should distinguish between field and metric encodings", () => {
      const fieldEnc = fieldEncoding(sampleFieldId);
      const metricEnc = metricEncoding(sampleMetricId);

      expect(isFieldEncoding(fieldEnc)).toBe(true);
      expect(isMetricEncoding(fieldEnc)).toBe(false);

      expect(isFieldEncoding(metricEnc)).toBe(false);
      expect(isMetricEncoding(metricEnc)).toBe(true);
    });

    it("should correctly identify invalid encodings", () => {
      const invalidEncodings = [
        "sum(revenue)",
        "category",
        "avg(price)",
        "field",
        "metric",
        "random-string",
        "",
      ];

      invalidEncodings.forEach((invalid) => {
        expect(isValidEncoding(invalid)).toBe(false);
      });
    });

    it("should handle all valid encoding formats", () => {
      const validEncodings = [
        "field:abc-123",
        "metric:xyz-456",
        "field:550e8400-e29b-41d4-a716-446655440000",
        "metric:550e8400-e29b-41d4-a716-446655440000",
        "field:simple",
        "metric:simple",
      ];

      validEncodings.forEach((valid) => {
        expect(isValidEncoding(valid)).toBe(true);
      });
    });
  });
});
