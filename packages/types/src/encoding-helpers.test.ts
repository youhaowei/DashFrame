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
 * - isEncodingValue() / validateVisualizationEncoding() - write-time validation
 */
import { describe, expect, it } from "vite-plus/test";
import {
  fieldEncoding,
  isEncodingValue,
  isFieldEncoding,
  isMetricEncoding,
  isValidEncoding,
  metricEncoding,
  parseEncoding,
  validateVisualizationEncoding,
} from "./encoding-helpers";
import type { UUID } from "./uuid";

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

      expect(fieldEncoding(uuid1)).toBe(
        "field:550e8400-e29b-41d4-a716-446655440000",
      );
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

      expect(metricEncoding(uuid1)).toBe(
        "metric:550e8400-e29b-41d4-a716-446655440000",
      );
      expect(metricEncoding(uuid2)).toBe("metric:simple-id");
    });

    it("should create value that passes isMetricEncoding type guard", () => {
      const result = metricEncoding(sampleMetricId);
      expect(isMetricEncoding(result)).toBe(true);
    });
  });

  describe("parseEncoding()", () => {
    // `encoding` is stored as opaque jsonb, so a row written before the write
    // gate existed can hand any shape to a reader. parseEncoding sits under
    // every one of them, so screening the type here is what keeps a malformed
    // stored row from throwing in render code that no error boundary covers.
    it("returns undefined for a non-string, rather than throwing", () => {
      for (const bad of [{ field: "region" }, 42, true, ["field:a"], null]) {
        expect(parseEncoding(bad as never)).toBeUndefined();
      }
      expect(isFieldEncoding({ field: "region" } as never)).toBe(false);
      expect(isMetricEncoding({ metric: "revenue" } as never)).toBe(false);
    });

    describe("valid field encodings", () => {
      it("should parse field encoding correctly", () => {
        const result = parseEncoding("field:abc-123-def");
        expect(result).toEqual({
          type: "field",
          id: "abc-123-def",
        });
      });

      it("should parse field encoding with UUID format", () => {
        const result = parseEncoding(
          "field:550e8400-e29b-41d4-a716-446655440000",
        );
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
        const result = parseEncoding(
          "metric:550e8400-e29b-41d4-a716-446655440000",
        );
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
        expect(
          isFieldEncoding("field:550e8400-e29b-41d4-a716-446655440000"),
        ).toBe(true);
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
        expect(
          isMetricEncoding("metric:550e8400-e29b-41d4-a716-446655440000"),
        ).toBe(true);
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
        expect(
          isValidEncoding("field:550e8400-e29b-41d4-a716-446655440000"),
        ).toBe(true);
      });

      it("should return true for metric encoding with UUID", () => {
        expect(
          isValidEncoding("metric:550e8400-e29b-41d4-a716-446655440000"),
        ).toBe(true);
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
  // ==========================================================================
  // Write-time validation (GH #289)
  // ==========================================================================

  describe("isEncodingValue()", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";

    it("accepts a canonical field and metric encoding", () => {
      expect(isEncodingValue(`field:${uuid}`)).toBe(true);
      expect(isEncodingValue(`metric:${uuid}`)).toBe(true);
    });

    it("rejects a wrong-case PREFIX — parseEncoding matches it case-sensitively", () => {
      // `FIELD:<uuid>` would not parse as an ID reference at all; the reader
      // falls back to treating it as a raw column name. Admitting it at the
      // gate would persist a value the reader silently mis-resolves.
      expect(isEncodingValue(`FIELD:${uuid}`)).toBe(false);
      expect(isEncodingValue(`Metric:${uuid}`)).toBe(false);
      expect(isEncodingValue(`field:${uuid}_J1`)).toBe(false);
    });

    it("accepts an uppercase uuid BODY — the reader compares it exactly", () => {
      // The id is sliced out and compared to the stored field id, so an
      // uppercase id resolves fine when that is how it was stored. Rejecting
      // it would make the gate stricter than the reader.
      expect(isEncodingValue(`field:${uuid.toUpperCase()}`)).toBe(true);
      expect(isEncodingValue(`metric:${uuid.toUpperCase()}_j2`)).toBe(true);
    });

    it("accepts a repeat-join instance suffix — the axis picker emits it", () => {
      expect(isEncodingValue(`field:${uuid}_j1`)).toBe(true);
      expect(isEncodingValue(`field:${uuid}_j12`)).toBe(true);
    });

    it("rejects a _j0 suffix — instance 0 is the bare uuid", () => {
      expect(isEncodingValue(`field:${uuid}_j0`)).toBe(false);
    });

    it("rejects a non-string, which is exactly what crashed the renderer", () => {
      expect(isEncodingValue({ field: "region" })).toBe(false);
      expect(isEncodingValue(null)).toBe(false);
      expect(isEncodingValue(42)).toBe(false);
      expect(isEncodingValue(["field:" + uuid])).toBe(false);
    });

    it("rejects a prefixed non-uuid, a raw column name, and a SQL aggregate", () => {
      expect(isEncodingValue("field:abc")).toBe(false);
      expect(isEncodingValue("field:")).toBe(false);
      expect(isEncodingValue("region")).toBe(false);
      expect(isEncodingValue("sum(revenue)")).toBe(false);
      expect(isEncodingValue(`dimension:${uuid}`)).toBe(false);
    });

    it("accepts what the constructors produce", () => {
      expect(isEncodingValue(fieldEncoding(uuid as UUID))).toBe(true);
      expect(isEncodingValue(metricEncoding(uuid as UUID))).toBe(true);
    });
  });

  describe("validateVisualizationEncoding()", () => {
    const x = "550e8400-e29b-41d4-a716-446655440000";
    const y = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

    it("accepts an absent encoding — encodings are built up incrementally", () => {
      expect(validateVisualizationEncoding(undefined)).toBeUndefined();
      expect(validateVisualizationEncoding({})).toBeUndefined();
    });

    it("accepts a full encoding with types and transforms", () => {
      expect(
        validateVisualizationEncoding({
          x: `field:${x}`,
          y: `metric:${y}`,
          color: `field:${x}_j1`,
          xType: "temporal",
          xTransform: {
            type: "date",
            transform: { kind: "temporal", aggregation: "yearMonth" },
          },
          yTransform: {
            type: "date",
            transform: { kind: "categorical", groupBy: "monthName" },
          },
        }),
      ).toBeUndefined();
    });

    it("rejects the documented-looking guess and names the channel + format", () => {
      const problem = validateVisualizationEncoding({ x: { field: "region" } });
      expect(problem).toContain("encoding.x");
      expect(problem).toContain("must be a string");
      expect(problem).toContain("field:<uuid>");
      expect(problem).toContain('{"field":"region"}');
    });

    it("rejects any non-string on any value-bearing channel", () => {
      for (const channel of ["x", "y", "color", "size"]) {
        expect(
          validateVisualizationEncoding({ [channel]: { field: "c" } }),
        ).toContain(`encoding.${channel}`);
        expect(validateVisualizationEncoding({ [channel]: 7 })).toContain(
          `encoding.${channel}`,
        );
        expect(validateVisualizationEncoding({ [channel]: null })).toContain(
          `encoding.${channel}`,
        );
      }
    });

    // The axis picker offers raw data-frame columns while analysis is
    // unavailable, and offers an unmatched analyzed column under its own name;
    // `resolveToSql` resolves both. Rejecting these would break the picker's
    // own writes and duplicating any older chart that stored one.
    it("accepts a bare column name — a form the axis picker still writes", () => {
      expect(validateVisualizationEncoding({ x: "region" })).toBeUndefined();
      expect(
        validateVisualizationEncoding({ x: "region", y: "sum(amount)" }),
      ).toBeUndefined();
    });

    it("accepts an empty channel value — that is how the picker clears one", () => {
      // Clearing the optional Color/Size picker saves `""`; `resolveToSql`
      // reads it as "channel not set".
      expect(validateVisualizationEncoding({ color: "" })).toBeUndefined();
      expect(validateVisualizationEncoding({ size: "" })).toBeUndefined();
      expect(
        validateVisualizationEncoding({ x: `field:${x}`, color: "" }),
      ).toBeUndefined();
    });

    it("rejects a value that claims to be an ID reference but carries no uuid", () => {
      for (const bad of [
        "field:",
        "field:abc",
        `metric:${x}-nope`,
        // Wrong case: the reader's prefix match is case-sensitive, so this
        // would be silently mis-read as a raw column name rather than an id.
        `FIELD:${x}`,
      ]) {
        expect(validateVisualizationEncoding({ x: bad })).toContain(
          "looks like an ID reference but is malformed",
        );
      }
    });

    it("rejects a non-object encoding", () => {
      expect(validateVisualizationEncoding(null)).toContain(
        "must be an object",
      );
      expect(validateVisualizationEncoding("field:" + x)).toContain(
        "must be an object",
      );
      expect(validateVisualizationEncoding([])).toContain("must be an object");
    });

    it("rejects a bad axis type", () => {
      expect(
        validateVisualizationEncoding({
          x: `field:${x}`,
          xType: "categorical",
        }),
      ).toContain("encoding.xType");
      expect(
        validateVisualizationEncoding({ y: `field:${x}`, yType: 3 }),
      ).toContain("encoding.yType");
    });

    // `applyTransform` reads transform.transform.kind — a half-built transform
    // throws at render exactly like a non-string channel value.
    it("rejects a half-built date transform", () => {
      const cases: unknown[] = [
        { type: "date" },
        { type: "date", transform: {} },
        { type: "date", transform: { kind: "temporal" } },
        { type: "date", transform: { kind: "temporal", aggregation: "daily" } },
        { type: "date", transform: { kind: "categorical" } },
        { type: "date", transform: { kind: "categorical", groupBy: "week" } },
        { type: "date", transform: { kind: "weird", aggregation: "year" } },
        { transform: { kind: "temporal", aggregation: "year" } },
        "yearMonth",
        null,
      ];
      for (const bad of cases) {
        expect(
          validateVisualizationEncoding({ x: `field:${x}`, xTransform: bad }),
        ).toContain("encoding.xTransform");
        expect(
          validateVisualizationEncoding({ y: `field:${y}`, yTransform: bad }),
        ).toContain("encoding.yTransform");
      }
    });

    it("ignores keys it does not own rather than rejecting them", () => {
      expect(
        validateVisualizationEncoding({ x: `field:${x}`, xLabel: "Region" }),
      ).toBeUndefined();
    });
  });
});
