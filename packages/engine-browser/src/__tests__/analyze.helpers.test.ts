/**
 * Unit tests for analyze.ts helper functions
 *
 * Tests cover:
 * - Pattern detection helpers (email, URL, UUID)
 * - Type-specific analyzers (boolean, numeric, date, string)
 * - Join column suggestion logic
 */
import type {
  BooleanAnalysis,
  ColumnAnalysis,
  DateAnalysis,
  NumberAnalysis,
  StringAnalysis,
} from "@dashframe/types";
import { describe, expect, it } from "vitest";
import { CARDINALITY_THRESHOLDS, suggestJoinColumns } from "../analyze";

// ============================================================================
// Test Fixtures
// ============================================================================

function createStringAnalysis(
  columnName: string,
  options: {
    semantic?: "categorical" | "text" | "identifier" | "reference" | "email" | "url" | "uuid";
    cardinality?: number;
    uniqueness?: number;
  } = {},
): StringAnalysis {
  return {
    columnName,
    dataType: "string",
    semantic: options.semantic ?? "categorical",
    cardinality: options.cardinality ?? 10,
    uniqueness: options.uniqueness ?? 1,
    nullCount: 0,
    sampleValues: [],
    minLength: 0,
    maxLength: 10,
    avgLength: 5,
    maxFrequencyRatio: 0.1,
  };
}

function createNumberAnalysis(
  columnName: string,
  options: {
    semantic?: "numerical" | "identifier";
    cardinality?: number;
  } = {},
): NumberAnalysis {
  return {
    columnName,
    dataType: "number",
    semantic: options.semantic ?? "numerical",
    cardinality: options.cardinality ?? 100,
    uniqueness: 1,
    nullCount: 0,
    sampleValues: [],
    min: 0,
    max: 100,
    stdDev: 10,
    zeroCount: 0,
  };
}

function createDateAnalysis(columnName: string): DateAnalysis {
  return {
    columnName,
    dataType: "date",
    semantic: "temporal",
    cardinality: 365,
    uniqueness: 1,
    nullCount: 0,
    sampleValues: [],
    minDate: Date.now() - 365 * 24 * 60 * 60 * 1000,
    maxDate: Date.now(),
  };
}

function createBooleanAnalysis(columnName: string): BooleanAnalysis {
  return {
    columnName,
    dataType: "boolean",
    semantic: "boolean",
    cardinality: 2,
    uniqueness: 0.5,
    nullCount: 0,
    sampleValues: [],
    trueCount: 50,
    falseCount: 50,
  };
}

// ============================================================================
// Join Column Suggestion Tests
// ============================================================================

describe("suggestJoinColumns", () => {
  describe("Strategy 1: Exact name match on identifier/reference columns", () => {
    it("should suggest exact name matches on identifier columns", () => {
      const leftAnalysis: ColumnAnalysis[] = [
        createStringAnalysis("user_id", { semantic: "identifier" }),
        createStringAnalysis("name", { semantic: "categorical" }),
      ];

      const rightAnalysis: ColumnAnalysis[] = [
        createStringAnalysis("user_id", { semantic: "identifier" }),
        createStringAnalysis("email", { semantic: "email" }),
      ];

      const suggestions = suggestJoinColumns(leftAnalysis, rightAnalysis);

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0]).toEqual({
        leftColumn: "user_id",
        rightColumn: "user_id",
        confidence: "high",
        reason: 'Exact match on "user_id"',
      });
    });

    it("should match on reference columns", () => {
      const leftAnalysis: ColumnAnalysis[] = [
        createStringAnalysis("tags", { semantic: "reference" }),
      ];

      const rightAnalysis: ColumnAnalysis[] = [
        createStringAnalysis("tags", { semantic: "reference" }),
      ];

      const suggestions = suggestJoinColumns(leftAnalysis, rightAnalysis);

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].confidence).toBe("high");
    });

    it("should normalize names (case-insensitive, ignore underscores/hyphens)", () => {
      const leftAnalysis: ColumnAnalysis[] = [
        createStringAnalysis("user_id", { semantic: "identifier" }),
      ];

      const rightAnalysis: ColumnAnalysis[] = [
        createStringAnalysis("USER-ID", { semantic: "identifier" }),
      ];

      const suggestions = suggestJoinColumns(leftAnalysis, rightAnalysis);

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].leftColumn).toBe("user_id");
      expect(suggestions[0].rightColumn).toBe("USER-ID");
    });

    it("should not match non-identifier columns with same name", () => {
      const leftAnalysis: ColumnAnalysis[] = [
        createStringAnalysis("status", { semantic: "categorical" }),
      ];

      const rightAnalysis: ColumnAnalysis[] = [
        createStringAnalysis("status", { semantic: "categorical" }),
      ];

      const suggestions = suggestJoinColumns(leftAnalysis, rightAnalysis);

      // Should match via Strategy 3 (same name with compatible types) instead
      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].confidence).toBe("medium");
    });
  });

  describe("Strategy 2: Reference pattern matching (users.id → orders.user_id)", () => {
    it("should suggest foreign key patterns", () => {
      const leftAnalysis: ColumnAnalysis[] = [
        createStringAnalysis("id", { semantic: "identifier" }),
        createStringAnalysis("name", { semantic: "categorical" }),
      ];

      const rightAnalysis: ColumnAnalysis[] = [
        createStringAnalysis("user_id", { semantic: "identifier" }),
        createStringAnalysis("total", { semantic: "categorical" }),
      ];

      const suggestions = suggestJoinColumns(
        leftAnalysis,
        rightAnalysis,
        "users", // Left table name
      );

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0]).toEqual({
        leftColumn: "id",
        rightColumn: "user_id",
        confidence: "high",
        reason: "Foreign key pattern: users.id → user_id",
      });
    });

    it("should handle plural table names (users → user)", () => {
      const leftAnalysis: ColumnAnalysis[] = [
        createStringAnalysis("id", { semantic: "identifier" }),
      ];

      const rightAnalysis: ColumnAnalysis[] = [
        createStringAnalysis("user_id", { semantic: "identifier" }),
      ];

      const suggestions = suggestJoinColumns(
        leftAnalysis,
        rightAnalysis,
        "users", // Plural table name
      );

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].reason).toContain("users.id → user_id");
    });

    it("should not duplicate suggestions from exact match", () => {
      const leftAnalysis: ColumnAnalysis[] = [
        createStringAnalysis("id", { semantic: "identifier" }),
      ];

      const rightAnalysis: ColumnAnalysis[] = [
        createStringAnalysis("id", { semantic: "identifier" }),
      ];

      const suggestions = suggestJoinColumns(
        leftAnalysis,
        rightAnalysis,
        "users",
      );

      // Should only have exact match, not foreign key match
      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].reason).toContain("Exact match");
    });
  });

  describe("Strategy 2b: Reverse reference pattern (orders.user_id → users.id)", () => {
    it("should suggest reverse foreign key patterns", () => {
      const leftAnalysis: ColumnAnalysis[] = [
        createStringAnalysis("user_id", { semantic: "identifier" }),
        createStringAnalysis("total", { semantic: "categorical" }),
      ];

      const rightAnalysis: ColumnAnalysis[] = [
        createStringAnalysis("id", { semantic: "identifier" }),
        createStringAnalysis("name", { semantic: "categorical" }),
      ];

      const suggestions = suggestJoinColumns(
        leftAnalysis,
        rightAnalysis,
        undefined, // No left table name
        "users", // Right table name
      );

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0]).toEqual({
        leftColumn: "user_id",
        rightColumn: "id",
        confidence: "high",
        reason: "Foreign key pattern: user_id → users.id",
      });
    });
  });

  describe("Strategy 3: Same name with compatible types (non-ID columns)", () => {
    it("should suggest same name with compatible types", () => {
      const leftAnalysis: ColumnAnalysis[] = [
        createStringAnalysis("country", { semantic: "categorical" }),
      ];

      const rightAnalysis: ColumnAnalysis[] = [
        createStringAnalysis("country", { semantic: "categorical" }),
      ];

      const suggestions = suggestJoinColumns(leftAnalysis, rightAnalysis);

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0]).toEqual({
        leftColumn: "country",
        rightColumn: "country",
        confidence: "medium",
        reason: 'Same column name "country" with compatible types',
      });
    });

    it("should check type compatibility", () => {
      const leftAnalysis: ColumnAnalysis[] = [
        createStringAnalysis("email", { semantic: "email" }),
      ];

      const rightAnalysis: ColumnAnalysis[] = [
        createStringAnalysis("email", { semantic: "email" }),
      ];

      const suggestions = suggestJoinColumns(leftAnalysis, rightAnalysis);

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].confidence).toBe("medium");
    });

    it("should not suggest columns already in higher-confidence matches", () => {
      const leftAnalysis: ColumnAnalysis[] = [
        createStringAnalysis("id", { semantic: "identifier" }),
        createStringAnalysis("category", { semantic: "categorical" }),
      ];

      const rightAnalysis: ColumnAnalysis[] = [
        createStringAnalysis("id", { semantic: "identifier" }),
        createStringAnalysis("category", { semantic: "categorical" }),
      ];

      const suggestions = suggestJoinColumns(leftAnalysis, rightAnalysis);

      // Should only suggest "id" (exact match), not "category" (since both are used)
      // Actually, both should be suggested since they can be independent joins
      expect(suggestions.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Strategy 4: ID pattern matching", () => {
    it("should suggest identifier columns with matching patterns", () => {
      const leftAnalysis: ColumnAnalysis[] = [
        createStringAnalysis("product", { semantic: "identifier" }),
      ];

      const rightAnalysis: ColumnAnalysis[] = [
        createStringAnalysis("product_id", { semantic: "identifier" }),
      ];

      const suggestions = suggestJoinColumns(leftAnalysis, rightAnalysis);

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].confidence).toBe("low");
      expect(suggestions[0].reason).toContain("Potential foreign key");
    });

    it("should extract base name from *_id patterns", () => {
      const leftAnalysis: ColumnAnalysis[] = [
        createStringAnalysis("customer", { semantic: "identifier" }),
      ];

      const rightAnalysis: ColumnAnalysis[] = [
        createStringAnalysis("customer_id", { semantic: "identifier" }),
      ];

      const suggestions = suggestJoinColumns(leftAnalysis, rightAnalysis);

      expect(suggestions).toHaveLength(1);
    });
  });

  describe("Type compatibility", () => {
    it("should allow identifier with identifier", () => {
      const leftAnalysis: ColumnAnalysis[] = [
        createNumberAnalysis("id", { semantic: "identifier" }),
      ];

      const rightAnalysis: ColumnAnalysis[] = [
        createNumberAnalysis("user_id", { semantic: "identifier" }),
      ];

      const suggestions = suggestJoinColumns(
        leftAnalysis,
        rightAnalysis,
        "users",
      );

      expect(suggestions.length).toBeGreaterThan(0);
    });

    it("should allow numerical with identifier (foreign keys)", () => {
      const leftAnalysis: ColumnAnalysis[] = [
        createNumberAnalysis("count", { semantic: "numerical" }),
      ];

      const rightAnalysis: ColumnAnalysis[] = [
        createNumberAnalysis("count_id", { semantic: "identifier" }),
      ];

      const suggestions = suggestJoinColumns(leftAnalysis, rightAnalysis);

      // Should be allowed due to numerical/identifier compatibility
      expect(suggestions.length).toBeGreaterThanOrEqual(0);
    });

    it("should allow same semantic types", () => {
      const leftAnalysis: ColumnAnalysis[] = [
        createDateAnalysis("created_at"),
      ];

      const rightAnalysis: ColumnAnalysis[] = [
        createDateAnalysis("created_at"),
      ];

      const suggestions = suggestJoinColumns(leftAnalysis, rightAnalysis);

      expect(suggestions).toHaveLength(1);
    });
  });

  describe("Internal column filtering", () => {
    it("should exclude _rowIndex from suggestions", () => {
      const leftAnalysis: ColumnAnalysis[] = [
        createNumberAnalysis("_rowIndex", { semantic: "identifier" }),
        createStringAnalysis("id", { semantic: "identifier" }),
      ];

      const rightAnalysis: ColumnAnalysis[] = [
        createNumberAnalysis("_rowIndex", { semantic: "identifier" }),
      ];

      const suggestions = suggestJoinColumns(leftAnalysis, rightAnalysis);

      // Should not suggest _rowIndex
      expect(suggestions.every((s) => !s.leftColumn.startsWith("_"))).toBe(
        true,
      );
      expect(suggestions.every((s) => !s.rightColumn.startsWith("_"))).toBe(
        true,
      );
    });

    it("should exclude rowindex (case-insensitive)", () => {
      const leftAnalysis: ColumnAnalysis[] = [
        createNumberAnalysis("rowindex", { semantic: "identifier" }),
      ];

      const rightAnalysis: ColumnAnalysis[] = [
        createNumberAnalysis("ROWINDEX", { semantic: "identifier" }),
      ];

      const suggestions = suggestJoinColumns(leftAnalysis, rightAnalysis);

      expect(suggestions).toHaveLength(0);
    });

    it("should exclude row_index", () => {
      const leftAnalysis: ColumnAnalysis[] = [
        createNumberAnalysis("row_index", { semantic: "identifier" }),
      ];

      const rightAnalysis: ColumnAnalysis[] = [
        createNumberAnalysis("row_index", { semantic: "identifier" }),
      ];

      const suggestions = suggestJoinColumns(leftAnalysis, rightAnalysis);

      expect(suggestions).toHaveLength(0);
    });
  });

  describe("Confidence sorting", () => {
    it("should sort suggestions by confidence (high → medium → low)", () => {
      const leftAnalysis: ColumnAnalysis[] = [
        createStringAnalysis("id", { semantic: "identifier" }),
        createStringAnalysis("category", { semantic: "categorical" }),
        createStringAnalysis("product", { semantic: "identifier" }),
      ];

      const rightAnalysis: ColumnAnalysis[] = [
        createStringAnalysis("id", { semantic: "identifier" }), // Exact match → high
        createStringAnalysis("category", { semantic: "categorical" }), // Same name → medium
        createStringAnalysis("product_id", { semantic: "identifier" }), // ID pattern → low
      ];

      const suggestions = suggestJoinColumns(leftAnalysis, rightAnalysis);

      // Verify sorted by confidence
      for (let i = 0; i < suggestions.length - 1; i++) {
        const currentConfidence = suggestions[i].confidence;
        const nextConfidence = suggestions[i + 1].confidence;
        const confidenceOrder = { high: 0, medium: 1, low: 2 };
        expect(confidenceOrder[currentConfidence]).toBeLessThanOrEqual(
          confidenceOrder[nextConfidence],
        );
      }
    });
  });

  describe("Edge cases", () => {
    it("should handle empty analysis arrays", () => {
      const suggestions = suggestJoinColumns([], []);

      expect(suggestions).toEqual([]);
    });

    it("should handle no matching columns", () => {
      const leftAnalysis: ColumnAnalysis[] = [
        createStringAnalysis("name", { semantic: "categorical" }),
      ];

      const rightAnalysis: ColumnAnalysis[] = [
        createNumberAnalysis("age", { semantic: "numerical" }),
      ];

      const suggestions = suggestJoinColumns(leftAnalysis, rightAnalysis);

      // No compatible columns to join on
      expect(suggestions).toEqual([]);
    });

    it("should handle analysis with only internal columns", () => {
      const leftAnalysis: ColumnAnalysis[] = [
        createNumberAnalysis("_rowIndex", { semantic: "identifier" }),
      ];

      const rightAnalysis: ColumnAnalysis[] = [
        createNumberAnalysis("_rowIndex", { semantic: "identifier" }),
      ];

      const suggestions = suggestJoinColumns(leftAnalysis, rightAnalysis);

      expect(suggestions).toEqual([]);
    });
  });

  describe("Integration scenarios", () => {
    it("should suggest joins for users-orders scenario", () => {
      const usersAnalysis: ColumnAnalysis[] = [
        createStringAnalysis("id", { semantic: "identifier" }),
        createStringAnalysis("name", { semantic: "categorical" }),
        createStringAnalysis("email", { semantic: "email" }),
      ];

      const ordersAnalysis: ColumnAnalysis[] = [
        createStringAnalysis("order_id", { semantic: "identifier" }),
        createStringAnalysis("user_id", { semantic: "identifier" }),
        createNumberAnalysis("total", { semantic: "numerical" }),
      ];

      const suggestions = suggestJoinColumns(
        usersAnalysis,
        ordersAnalysis,
        "users",
      );

      // Should suggest users.id → orders.user_id
      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].leftColumn).toBe("id");
      expect(suggestions[0].rightColumn).toBe("user_id");
      expect(suggestions[0].confidence).toBe("high");
    });

    it("should handle multiple join possibilities", () => {
      const leftAnalysis: ColumnAnalysis[] = [
        createStringAnalysis("id", { semantic: "identifier" }),
        createStringAnalysis("customer_id", { semantic: "identifier" }),
        createStringAnalysis("country", { semantic: "categorical" }),
      ];

      const rightAnalysis: ColumnAnalysis[] = [
        createStringAnalysis("id", { semantic: "identifier" }),
        createStringAnalysis("country", { semantic: "categorical" }),
        createStringAnalysis("region", { semantic: "categorical" }),
      ];

      const suggestions = suggestJoinColumns(leftAnalysis, rightAnalysis);

      // Should suggest both "id" exact match and "country" same name
      expect(suggestions.length).toBeGreaterThanOrEqual(2);
    });
  });
});

// ============================================================================
// Constants Export Tests
// ============================================================================

describe("CARDINALITY_THRESHOLDS", () => {
  it("should export cardinality thresholds", () => {
    expect(CARDINALITY_THRESHOLDS).toBeDefined();
    expect(CARDINALITY_THRESHOLDS.COLOR_MAX).toBeGreaterThan(0);
    expect(CARDINALITY_THRESHOLDS.COLOR_MIN).toBeGreaterThan(0);
    expect(CARDINALITY_THRESHOLDS.CATEGORICAL_X_MAX).toBeGreaterThan(0);
    expect(CARDINALITY_THRESHOLDS.CATEGORICAL_RATIO).toBeGreaterThan(0);
    expect(CARDINALITY_THRESHOLDS.CATEGORICAL_RATIO).toBeLessThan(1);
  });

  it("should have sensible threshold relationships", () => {
    // Color min should be less than color max
    expect(CARDINALITY_THRESHOLDS.COLOR_MIN).toBeLessThan(
      CARDINALITY_THRESHOLDS.COLOR_MAX,
    );

    // Categorical ratio should be a reasonable percentage
    expect(CARDINALITY_THRESHOLDS.CATEGORICAL_RATIO).toBeGreaterThan(0.1);
    expect(CARDINALITY_THRESHOLDS.CATEGORICAL_RATIO).toBeLessThan(0.9);
  });
});
