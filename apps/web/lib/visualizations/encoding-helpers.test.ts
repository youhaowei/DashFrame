/**
 * Unit tests for encoding-helpers module
 */
import { describe, it, expect } from "vitest";
import {
  parseEncoding,
  fieldEncoding,
  metricEncoding,
  isFieldEncoding,
  isMetricEncoding,
  isValidEncoding,
} from "@dashframe/types";
import type { UUID } from "@dashframe/types";

describe("encoding-helpers", () => {
  const testFieldId = "abc-123-def-456" as UUID;
  const testMetricId = "xyz-789-uvw-012" as UUID;

  describe("fieldEncoding", () => {
    it("should create field encoding with correct prefix", () => {
      const result = fieldEncoding(testFieldId);
      expect(result).toBe("field:abc-123-def-456");
    });
  });

  describe("metricEncoding", () => {
    it("should create metric encoding with correct prefix", () => {
      const result = metricEncoding(testMetricId);
      expect(result).toBe("metric:xyz-789-uvw-012");
    });
  });

  describe("parseEncoding", () => {
    it("should parse field encoding correctly", () => {
      const result = parseEncoding("field:abc-123");
      expect(result).toEqual({ type: "field", id: "abc-123" });
    });

    it("should parse metric encoding correctly", () => {
      const result = parseEncoding("metric:xyz-456");
      expect(result).toEqual({ type: "metric", id: "xyz-456" });
    });

    it("should return undefined for undefined input", () => {
      expect(parseEncoding(undefined)).toBeUndefined();
    });

    it("should return undefined for empty string", () => {
      expect(parseEncoding("")).toBeUndefined();
    });

    it("should return undefined for legacy SQL expressions", () => {
      expect(parseEncoding("sum(revenue)")).toBeUndefined();
      expect(parseEncoding("avg(price)")).toBeUndefined();
      expect(parseEncoding("count(*)")).toBeUndefined();
    });

    it("should return undefined for plain column names", () => {
      expect(parseEncoding("category")).toBeUndefined();
      expect(parseEncoding("revenue")).toBeUndefined();
    });

    it("should return undefined for invalid prefixes", () => {
      expect(parseEncoding("column:abc-123")).toBeUndefined();
      expect(parseEncoding("invalid:xyz-456")).toBeUndefined();
    });
  });

  describe("isFieldEncoding", () => {
    it("should return true for field encoding", () => {
      expect(isFieldEncoding("field:abc-123")).toBe(true);
    });

    it("should return false for metric encoding", () => {
      expect(isFieldEncoding("metric:xyz-456")).toBe(false);
    });

    it("should return false for undefined", () => {
      expect(isFieldEncoding(undefined)).toBe(false);
    });

    it("should return false for plain strings", () => {
      expect(isFieldEncoding("category")).toBe(false);
      expect(isFieldEncoding("sum(revenue)")).toBe(false);
    });
  });

  describe("isMetricEncoding", () => {
    it("should return true for metric encoding", () => {
      expect(isMetricEncoding("metric:xyz-456")).toBe(true);
    });

    it("should return false for field encoding", () => {
      expect(isMetricEncoding("field:abc-123")).toBe(false);
    });

    it("should return false for undefined", () => {
      expect(isMetricEncoding(undefined)).toBe(false);
    });

    it("should return false for plain strings", () => {
      expect(isMetricEncoding("category")).toBe(false);
      expect(isMetricEncoding("sum(revenue)")).toBe(false);
    });
  });

  describe("isValidEncoding", () => {
    it("should return true for field encoding", () => {
      expect(isValidEncoding("field:abc-123")).toBe(true);
    });

    it("should return true for metric encoding", () => {
      expect(isValidEncoding("metric:xyz-456")).toBe(true);
    });

    it("should return false for undefined", () => {
      expect(isValidEncoding(undefined)).toBe(false);
    });

    it("should return false for legacy SQL expressions", () => {
      expect(isValidEncoding("sum(revenue)")).toBe(false);
      expect(isValidEncoding("avg(price)")).toBe(false);
    });

    it("should return false for plain column names", () => {
      expect(isValidEncoding("category")).toBe(false);
    });
  });

  describe("roundtrip", () => {
    it("should correctly roundtrip field encoding", () => {
      const encoded = fieldEncoding(testFieldId);
      const parsed = parseEncoding(encoded);
      expect(parsed).toEqual({ type: "field", id: testFieldId });
    });

    it("should correctly roundtrip metric encoding", () => {
      const encoded = metricEncoding(testMetricId);
      const parsed = parseEncoding(encoded);
      expect(parsed).toEqual({ type: "metric", id: testMetricId });
    });
  });
});
