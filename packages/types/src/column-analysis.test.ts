/**
 * Unit tests for column-analysis module
 *
 * Tests cover:
 * - getLegacyCategory() - Extract legacy category from ColumnAnalysis
 * - looksLikeIdentifier() - Detect identifier column names
 * - CARDINALITY_THRESHOLDS - Validation thresholds export
 */
import { describe, expect, it } from "vitest";
import type {
  BooleanAnalysis,
  ColumnAnalysis,
  DateAnalysis,
  NumberAnalysis,
  StringAnalysis,
} from "./column-analysis";
import {
  CARDINALITY_THRESHOLDS,
  getLegacyCategory,
  looksLikeIdentifier,
} from "./column-analysis";

describe("column-analysis", () => {
  describe("getLegacyCategory()", () => {
    describe("string analysis types", () => {
      it("should return 'text' for text semantic", () => {
        const analysis: StringAnalysis = {
          columnName: "description",
          dataType: "string",
          semantic: "text",
          cardinality: 100,
          uniqueness: 0.95,
          nullCount: 5,
          sampleValues: ["sample text"],
          minLength: 10,
          maxLength: 500,
          avgLength: 150,
        };
        expect(getLegacyCategory(analysis)).toBe("text");
      });

      it("should return 'identifier' for identifier semantic", () => {
        const analysis: StringAnalysis = {
          columnName: "id",
          dataType: "string",
          semantic: "identifier",
          cardinality: 1000,
          uniqueness: 1.0,
          nullCount: 0,
          sampleValues: ["abc-123"],
        };
        expect(getLegacyCategory(analysis)).toBe("identifier");
      });

      it("should return 'email' for email semantic", () => {
        const analysis: StringAnalysis = {
          columnName: "email",
          dataType: "string",
          semantic: "email",
          cardinality: 50,
          uniqueness: 1.0,
          nullCount: 0,
          sampleValues: ["user@example.com"],
          pattern: "email",
        };
        expect(getLegacyCategory(analysis)).toBe("email");
      });

      it("should return 'url' for url semantic", () => {
        const analysis: StringAnalysis = {
          columnName: "website",
          dataType: "string",
          semantic: "url",
          cardinality: 50,
          uniqueness: 0.8,
          nullCount: 2,
          sampleValues: ["https://example.com"],
          pattern: "url",
        };
        expect(getLegacyCategory(analysis)).toBe("url");
      });

      it("should return 'uuid' for uuid semantic", () => {
        const analysis: StringAnalysis = {
          columnName: "uuid",
          dataType: "string",
          semantic: "uuid",
          cardinality: 100,
          uniqueness: 1.0,
          nullCount: 0,
          sampleValues: ["550e8400-e29b-41d4-a716-446655440000"],
          pattern: "uuid",
        };
        expect(getLegacyCategory(analysis)).toBe("uuid");
      });

      it("should return 'categorical' for categorical semantic", () => {
        const analysis: StringAnalysis = {
          columnName: "category",
          dataType: "string",
          semantic: "categorical",
          cardinality: 5,
          uniqueness: 0.05,
          nullCount: 0,
          sampleValues: ["A", "B", "C"],
        };
        expect(getLegacyCategory(analysis)).toBe("categorical");
      });
    });

    describe("number analysis types", () => {
      it("should return 'numerical' for numerical semantic", () => {
        const analysis: NumberAnalysis = {
          columnName: "revenue",
          dataType: "number",
          semantic: "numerical",
          cardinality: 500,
          uniqueness: 0.9,
          nullCount: 10,
          sampleValues: [100, 200, 300],
          min: 0,
          max: 10000,
          stdDev: 1500,
        };
        expect(getLegacyCategory(analysis)).toBe("numerical");
      });

      it("should return 'identifier' for numeric identifier semantic", () => {
        const analysis: NumberAnalysis = {
          columnName: "user_id",
          dataType: "number",
          semantic: "identifier",
          cardinality: 1000,
          uniqueness: 1.0,
          nullCount: 0,
          sampleValues: [1, 2, 3],
          min: 1,
          max: 1000,
        };
        expect(getLegacyCategory(analysis)).toBe("identifier");
      });
    });

    describe("date analysis types", () => {
      it("should return 'temporal' for date semantic", () => {
        const analysis: DateAnalysis = {
          columnName: "created_at",
          dataType: "date",
          semantic: "temporal",
          cardinality: 365,
          uniqueness: 0.5,
          nullCount: 0,
          sampleValues: [new Date("2024-01-01")],
          minDate: new Date("2024-01-01").getTime(),
          maxDate: new Date("2024-12-31").getTime(),
        };
        expect(getLegacyCategory(analysis)).toBe("temporal");
      });
    });

    describe("boolean analysis types", () => {
      it("should return 'boolean' for boolean semantic", () => {
        const analysis: BooleanAnalysis = {
          columnName: "is_active",
          dataType: "boolean",
          semantic: "boolean",
          cardinality: 2,
          uniqueness: 0.002,
          nullCount: 5,
          sampleValues: [true, false],
          trueCount: 700,
          falseCount: 295,
        };
        expect(getLegacyCategory(analysis)).toBe("boolean");
      });
    });

    describe("array and unknown analysis types", () => {
      it("should return 'reference' for array semantic", () => {
        const analysis: ColumnAnalysis = {
          columnName: "tags",
          dataType: "array",
          semantic: "reference",
          cardinality: 50,
          uniqueness: 0.3,
          nullCount: 10,
          sampleValues: [["tag1", "tag2"]],
          avgLength: 3,
        };
        expect(getLegacyCategory(analysis)).toBe("reference");
      });

      it("should return 'unknown' for unknown semantic", () => {
        const analysis: ColumnAnalysis = {
          columnName: "weird_data",
          dataType: "unknown",
          semantic: "unknown",
          cardinality: 0,
          uniqueness: 0,
          nullCount: 100,
          sampleValues: [],
        };
        expect(getLegacyCategory(analysis)).toBe("unknown");
      });
    });

    describe("edge cases", () => {
      it("should handle analysis with minimal fields", () => {
        const analysis: StringAnalysis = {
          columnName: "col",
          dataType: "string",
          semantic: "text",
          cardinality: 0,
          uniqueness: 0,
          nullCount: 100,
          sampleValues: [],
        };
        expect(getLegacyCategory(analysis)).toBe("text");
      });

      it("should handle analysis with all optional fields populated", () => {
        const analysis: StringAnalysis = {
          columnName: "description",
          dataType: "string",
          semantic: "text",
          fieldId: "field-123",
          cardinality: 100,
          uniqueness: 0.95,
          nullCount: 5,
          sampleValues: ["sample"],
          minLength: 10,
          maxLength: 500,
          avgLength: 150,
          pattern: "text",
          maxFrequencyRatio: 0.2,
        };
        expect(getLegacyCategory(analysis)).toBe("text");
      });
    });
  });

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

    describe("false positives (NOT_ID_PATTERNS)", () => {
      it("should NOT detect 'zipcode' as identifier", () => {
        expect(looksLikeIdentifier("zipcode")).toBe(false);
        expect(looksLikeIdentifier("ZipCode")).toBe(false);
        expect(looksLikeIdentifier("ZIPCODE")).toBe(false);
      });

      it("should NOT detect 'postcode' as identifier", () => {
        expect(looksLikeIdentifier("postcode")).toBe(false);
        expect(looksLikeIdentifier("PostCode")).toBe(false);
        expect(looksLikeIdentifier("POSTCODE")).toBe(false);
      });

      it("should NOT detect 'areacode' as identifier", () => {
        expect(looksLikeIdentifier("areacode")).toBe(false);
        expect(looksLikeIdentifier("AreaCode")).toBe(false);
        expect(looksLikeIdentifier("AREACODE")).toBe(false);
      });

      it("should NOT detect columns containing false positive patterns", () => {
        expect(looksLikeIdentifier("us_zipcode")).toBe(false);
        expect(looksLikeIdentifier("uk_postcode")).toBe(false);
        expect(looksLikeIdentifier("phone_areacode")).toBe(false);
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

      it("should NOT detect columns starting with 'id' but not followed by underscore", () => {
        expect(looksLikeIdentifier("idea")).toBe(false);
        expect(looksLikeIdentifier("identity")).toBe(false);
        expect(looksLikeIdentifier("ideology")).toBe(false);
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
        // Even if it ends with 'code' which could match patterns,
        // the NOT_ID_PATTERNS should take precedence
        expect(looksLikeIdentifier("zipcode")).toBe(false);
        expect(looksLikeIdentifier("my_zipcode")).toBe(false);
      });
    });

    describe("real-world examples", () => {
      it("should detect common database identifiers", () => {
        expect(looksLikeIdentifier("id")).toBe(true);
        expect(looksLikeIdentifier("user_id")).toBe(true);
        expect(looksLikeIdentifier("customer_id")).toBe(true);
        expect(looksLikeIdentifier("order_id")).toBe(true);
        expect(looksLikeIdentifier("product_id")).toBe(true);
      });

      it("should detect common key patterns", () => {
        expect(looksLikeIdentifier("api_key")).toBe(true);
        expect(looksLikeIdentifier("primary_key")).toBe(true);
        expect(looksLikeIdentifier("foreign_key")).toBe(true);
      });

      it("should detect UUID-related columns", () => {
        expect(looksLikeIdentifier("uuid")).toBe(true);
        expect(looksLikeIdentifier("guid")).toBe(true);
      });

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

  describe("CARDINALITY_THRESHOLDS", () => {
    it("should export COLOR_MAX threshold", () => {
      expect(CARDINALITY_THRESHOLDS.COLOR_MAX).toBe(12);
    });

    it("should export COLOR_MIN threshold", () => {
      expect(CARDINALITY_THRESHOLDS.COLOR_MIN).toBe(2);
    });

    it("should export CATEGORICAL_X_MAX threshold", () => {
      expect(CARDINALITY_THRESHOLDS.CATEGORICAL_X_MAX).toBe(50);
    });

    it("should export CATEGORICAL_RATIO threshold", () => {
      expect(CARDINALITY_THRESHOLDS.CATEGORICAL_RATIO).toBe(0.2);
    });

    it("should be a const object (read-only)", () => {
      // TypeScript enforces const, but we can verify the values are numbers
      expect(typeof CARDINALITY_THRESHOLDS.COLOR_MAX).toBe("number");
      expect(typeof CARDINALITY_THRESHOLDS.COLOR_MIN).toBe("number");
      expect(typeof CARDINALITY_THRESHOLDS.CATEGORICAL_X_MAX).toBe("number");
      expect(typeof CARDINALITY_THRESHOLDS.CATEGORICAL_RATIO).toBe("number");
    });

    it("should have sensible threshold values", () => {
      // COLOR_MIN should be less than COLOR_MAX
      expect(CARDINALITY_THRESHOLDS.COLOR_MIN).toBeLessThan(
        CARDINALITY_THRESHOLDS.COLOR_MAX,
      );

      // COLOR_MAX should be less than CATEGORICAL_X_MAX
      expect(CARDINALITY_THRESHOLDS.COLOR_MAX).toBeLessThan(
        CARDINALITY_THRESHOLDS.CATEGORICAL_X_MAX,
      );

      // CATEGORICAL_RATIO should be between 0 and 1
      expect(CARDINALITY_THRESHOLDS.CATEGORICAL_RATIO).toBeGreaterThan(0);
      expect(CARDINALITY_THRESHOLDS.CATEGORICAL_RATIO).toBeLessThan(1);

      // All max thresholds should be positive
      expect(CARDINALITY_THRESHOLDS.COLOR_MAX).toBeGreaterThan(0);
      expect(CARDINALITY_THRESHOLDS.COLOR_MIN).toBeGreaterThan(0);
      expect(CARDINALITY_THRESHOLDS.CATEGORICAL_X_MAX).toBeGreaterThan(0);
    });

    it("should have all expected properties", () => {
      const keys = Object.keys(CARDINALITY_THRESHOLDS);
      expect(keys).toContain("COLOR_MAX");
      expect(keys).toContain("COLOR_MIN");
      expect(keys).toContain("CATEGORICAL_X_MAX");
      expect(keys).toContain("CATEGORICAL_RATIO");
      expect(keys).toHaveLength(4);
    });
  });

  describe("integration - getLegacyCategory with real analysis objects", () => {
    it("should work with complete StringAnalysis object", () => {
      const analysis: StringAnalysis = {
        columnName: "email",
        fieldId: "field-abc-123",
        dataType: "string",
        semantic: "email",
        cardinality: 50,
        uniqueness: 1.0,
        nullCount: 0,
        sampleValues: ["user@example.com", "admin@test.com"],
        minLength: 10,
        maxLength: 30,
        avgLength: 20,
        pattern: "email",
        maxFrequencyRatio: 0.1,
      };

      expect(getLegacyCategory(analysis)).toBe("email");
    });

    it("should work with complete NumberAnalysis object", () => {
      const analysis: NumberAnalysis = {
        columnName: "revenue",
        fieldId: "field-xyz-789",
        dataType: "number",
        semantic: "numerical",
        cardinality: 500,
        uniqueness: 0.9,
        nullCount: 10,
        sampleValues: [100, 200, 300, 400, 500],
        min: 0,
        max: 10000,
        stdDev: 1500,
        zeroCount: 5,
      };

      expect(getLegacyCategory(analysis)).toBe("numerical");
    });

    it("should consistently return semantic value regardless of other fields", () => {
      const minimal: StringAnalysis = {
        columnName: "cat",
        dataType: "string",
        semantic: "categorical",
        cardinality: 5,
        uniqueness: 0.05,
        nullCount: 0,
        sampleValues: [],
      };

      const complete: StringAnalysis = {
        columnName: "category",
        fieldId: "field-123",
        dataType: "string",
        semantic: "categorical",
        cardinality: 5,
        uniqueness: 0.05,
        nullCount: 0,
        sampleValues: ["A", "B", "C", "D", "E"],
        minLength: 1,
        maxLength: 1,
        avgLength: 1,
        maxFrequencyRatio: 0.3,
      };

      expect(getLegacyCategory(minimal)).toBe("categorical");
      expect(getLegacyCategory(complete)).toBe("categorical");
      expect(getLegacyCategory(minimal)).toBe(getLegacyCategory(complete));
    });
  });

  describe("type safety", () => {
    it("should accept all valid ColumnAnalysis types", () => {
      const analyses: ColumnAnalysis[] = [
        {
          columnName: "text_col",
          dataType: "string",
          semantic: "text",
          cardinality: 100,
          uniqueness: 0.95,
          nullCount: 5,
          sampleValues: [],
        },
        {
          columnName: "num_col",
          dataType: "number",
          semantic: "numerical",
          cardinality: 500,
          uniqueness: 0.9,
          nullCount: 10,
          sampleValues: [],
          min: 0,
          max: 1000,
        },
        {
          columnName: "date_col",
          dataType: "date",
          semantic: "temporal",
          cardinality: 365,
          uniqueness: 0.5,
          nullCount: 0,
          sampleValues: [],
          minDate: 0,
          maxDate: 1000000,
        },
        {
          columnName: "bool_col",
          dataType: "boolean",
          semantic: "boolean",
          cardinality: 2,
          uniqueness: 0.002,
          nullCount: 0,
          sampleValues: [],
          trueCount: 50,
          falseCount: 50,
        },
        {
          columnName: "arr_col",
          dataType: "array",
          semantic: "reference",
          cardinality: 10,
          uniqueness: 0.1,
          nullCount: 0,
          sampleValues: [],
        },
        {
          columnName: "unk_col",
          dataType: "unknown",
          semantic: "unknown",
          cardinality: 0,
          uniqueness: 0,
          nullCount: 100,
          sampleValues: [],
        },
      ];

      analyses.forEach((analysis) => {
        expect(typeof getLegacyCategory(analysis)).toBe("string");
      });
    });
  });
});
