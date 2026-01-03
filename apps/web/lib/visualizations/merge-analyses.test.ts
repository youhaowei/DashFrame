/**
 * Unit tests for merge-analyses module
 *
 * Tests cover:
 * - mergeAnalyses() - Merging multiple DataFrameAnalysis results
 *   - Empty array handling
 *   - Single analysis passthrough
 *   - Multiple analyses merging
 *   - Duplicate column handling (first occurrence wins)
 *   - Order preservation
 * - areAnalysesValid() - Analysis validation
 *   - Missing analysis detection
 *   - Field hash validation
 *   - Empty analysis detection
 *   - All valid cases
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type {
  ColumnAnalysis,
  DataFrameAnalysis,
  NumberAnalysis,
  StringAnalysis,
  DateAnalysis,
  BooleanAnalysis,
} from "@dashframe/types";
import { mergeAnalyses, areAnalysesValid } from "./merge-analyses";

describe("merge-analyses", () => {
  // ============================================================================
  // Mock Data Helpers
  // ============================================================================

  const createStringColumn = (
    overrides: Partial<StringAnalysis> = {},
  ): StringAnalysis => ({
    columnName: "field_cat123",
    dataType: "string",
    semantic: "categorical",
    cardinality: 5,
    uniqueness: 0.5,
    nullCount: 0,
    sampleValues: ["A", "B", "C", "D", "E"],
    fieldId: "cat123",
    ...overrides,
  });

  const createNumberColumn = (
    overrides: Partial<NumberAnalysis> = {},
  ): NumberAnalysis => ({
    columnName: "field_num456",
    dataType: "number",
    semantic: "numerical",
    cardinality: 100,
    uniqueness: 0.9,
    nullCount: 0,
    sampleValues: [10, 20, 30, 40, 50],
    min: 0,
    max: 100,
    stdDev: 25,
    zeroCount: 0,
    fieldId: "num456",
    ...overrides,
  });

  const createDateColumn = (
    overrides: Partial<DateAnalysis> = {},
  ): DateAnalysis => {
    const now = Date.now();
    const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;
    return {
      columnName: "field_date789",
      dataType: "date",
      semantic: "temporal",
      cardinality: 365,
      uniqueness: 0.8,
      nullCount: 0,
      sampleValues: [oneYearAgo, now],
      minDate: oneYearAgo,
      maxDate: now,
      fieldId: "date789",
      ...overrides,
    };
  };

  const createBooleanColumn = (
    overrides: Partial<BooleanAnalysis> = {},
  ): BooleanAnalysis => ({
    columnName: "field_bool999",
    dataType: "boolean",
    semantic: "boolean",
    cardinality: 2,
    uniqueness: 0.5,
    nullCount: 0,
    sampleValues: [true, false],
    trueCount: 50,
    falseCount: 50,
    fieldId: "bool999",
    ...overrides,
  });

  const createDataFrameAnalysis = (
    columns: ColumnAnalysis[],
    overrides: Partial<DataFrameAnalysis> = {},
  ): DataFrameAnalysis => ({
    columns,
    rowCount: 100,
    analyzedAt: Date.now(),
    fieldHash: "hash123",
    ...overrides,
  });

  // ============================================================================
  // Console Mock Setup
  // ============================================================================

  const originalConsoleDebug = console.debug;

  beforeEach(() => {
    // Mock console.debug to avoid noise in test output
    console.debug = vi.fn();
  });

  afterEach(() => {
    // Restore console.debug
    console.debug = originalConsoleDebug;
    vi.clearAllMocks();
  });

  // ============================================================================
  // mergeAnalyses() - Basic Functionality
  // ============================================================================

  describe("mergeAnalyses() - basic functionality", () => {
    it("should return empty array when input is empty", () => {
      const result = mergeAnalyses([]);

      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });

    it("should return columns from single analysis unchanged", () => {
      const col1 = createStringColumn({ columnName: "field_cat1", fieldId: "cat1" });
      const col2 = createNumberColumn({ columnName: "field_num1", fieldId: "num1" });
      const analysis = createDataFrameAnalysis([col1, col2]);

      const result = mergeAnalyses([analysis]);

      expect(result).toEqual([col1, col2]);
      expect(result).toHaveLength(2);
    });

    it("should preserve single analysis reference when possible", () => {
      const columns = [
        createStringColumn({ columnName: "field_cat1", fieldId: "cat1" }),
      ];
      const analysis = createDataFrameAnalysis(columns);

      const result = mergeAnalyses([analysis]);

      // Should return the same array reference for efficiency
      expect(result).toBe(columns);
    });
  });

  // ============================================================================
  // mergeAnalyses() - Multiple Analyses
  // ============================================================================

  describe("mergeAnalyses() - multiple analyses", () => {
    it("should merge two analyses with distinct columns", () => {
      const col1 = createStringColumn({ columnName: "field_cat1", fieldId: "cat1" });
      const col2 = createNumberColumn({ columnName: "field_num1", fieldId: "num1" });
      const col3 = createDateColumn({ columnName: "field_date1", fieldId: "date1" });
      const col4 = createBooleanColumn({ columnName: "field_bool1", fieldId: "bool1" });

      const analysis1 = createDataFrameAnalysis([col1, col2]);
      const analysis2 = createDataFrameAnalysis([col3, col4]);

      const result = mergeAnalyses([analysis1, analysis2]);

      expect(result).toEqual([col1, col2, col3, col4]);
      expect(result).toHaveLength(4);
    });

    it("should merge three analyses with distinct columns", () => {
      const col1 = createStringColumn({ columnName: "field_cat1", fieldId: "cat1" });
      const col2 = createNumberColumn({ columnName: "field_num1", fieldId: "num1" });
      const col3 = createDateColumn({ columnName: "field_date1", fieldId: "date1" });
      const col4 = createBooleanColumn({ columnName: "field_bool1", fieldId: "bool1" });
      const col5 = createStringColumn({ columnName: "field_cat2", fieldId: "cat2" });

      const analysis1 = createDataFrameAnalysis([col1]);
      const analysis2 = createDataFrameAnalysis([col2, col3]);
      const analysis3 = createDataFrameAnalysis([col4, col5]);

      const result = mergeAnalyses([analysis1, analysis2, analysis3]);

      expect(result).toEqual([col1, col2, col3, col4, col5]);
      expect(result).toHaveLength(5);
    });

    it("should preserve order from first to last analysis", () => {
      const colA = createStringColumn({ columnName: "field_a", fieldId: "a" });
      const colB = createNumberColumn({ columnName: "field_b", fieldId: "b" });
      const colC = createDateColumn({ columnName: "field_c", fieldId: "c" });

      const analysis1 = createDataFrameAnalysis([colA]);
      const analysis2 = createDataFrameAnalysis([colB]);
      const analysis3 = createDataFrameAnalysis([colC]);

      const result = mergeAnalyses([analysis1, analysis2, analysis3]);

      expect(result[0]).toBe(colA);
      expect(result[1]).toBe(colB);
      expect(result[2]).toBe(colC);
    });
  });

  // ============================================================================
  // mergeAnalyses() - Duplicate Column Handling
  // ============================================================================

  describe("mergeAnalyses() - duplicate column handling", () => {
    it("should use first occurrence when column names collide", () => {
      const col1First = createStringColumn({
        columnName: "field_shared",
        fieldId: "shared1",
        cardinality: 5,
      });
      const col1Duplicate = createStringColumn({
        columnName: "field_shared",
        fieldId: "shared2",
        cardinality: 10, // Different value to distinguish
      });
      const col2 = createNumberColumn({ columnName: "field_num1", fieldId: "num1" });

      const analysis1 = createDataFrameAnalysis([col1First, col2]);
      const analysis2 = createDataFrameAnalysis([col1Duplicate]);

      const result = mergeAnalyses([analysis1, analysis2]);

      expect(result).toHaveLength(2);
      expect(result[0]).toBe(col1First);
      expect(result[0].cardinality).toBe(5); // First occurrence
      expect(result[1]).toBe(col2);
      expect(console.debug).toHaveBeenCalledWith(
        "[mergeAnalyses] Skipping duplicate column: field_shared",
      );
    });

    it("should log debug message for each duplicate", () => {
      const col1 = createStringColumn({ columnName: "field_dup", fieldId: "1" });
      const col2 = createStringColumn({ columnName: "field_dup", fieldId: "2" });
      const col3 = createStringColumn({ columnName: "field_dup", fieldId: "3" });

      const analysis1 = createDataFrameAnalysis([col1]);
      const analysis2 = createDataFrameAnalysis([col2]);
      const analysis3 = createDataFrameAnalysis([col3]);

      mergeAnalyses([analysis1, analysis2, analysis3]);

      expect(console.debug).toHaveBeenCalledTimes(2);
      expect(console.debug).toHaveBeenCalledWith(
        "[mergeAnalyses] Skipping duplicate column: field_dup",
      );
    });

    it("should handle partial duplicates correctly", () => {
      const colA = createStringColumn({ columnName: "field_a", fieldId: "a" });
      const colB = createNumberColumn({ columnName: "field_b", fieldId: "b" });
      const colC = createDateColumn({ columnName: "field_c", fieldId: "c" });
      const colBDup = createNumberColumn({
        columnName: "field_b",
        fieldId: "b_dup",
        min: 999, // Different to distinguish
      });

      const analysis1 = createDataFrameAnalysis([colA, colB]);
      const analysis2 = createDataFrameAnalysis([colBDup, colC]);

      const result = mergeAnalyses([analysis1, analysis2]);

      expect(result).toHaveLength(3);
      expect(result[0]).toBe(colA);
      expect(result[1]).toBe(colB);
      expect(result[1].min).toBe(0); // First occurrence
      expect(result[2]).toBe(colC);
    });

    it("should maintain order even with duplicates", () => {
      const col1 = createStringColumn({ columnName: "field_1", fieldId: "1" });
      const col2 = createNumberColumn({ columnName: "field_2", fieldId: "2" });
      const col3 = createDateColumn({ columnName: "field_3", fieldId: "3" });
      const col2Dup = createNumberColumn({ columnName: "field_2", fieldId: "2dup" });
      const col4 = createBooleanColumn({ columnName: "field_4", fieldId: "4" });

      const analysis1 = createDataFrameAnalysis([col1, col2]);
      const analysis2 = createDataFrameAnalysis([col2Dup, col3, col4]);

      const result = mergeAnalyses([analysis1, analysis2]);

      expect(result).toHaveLength(4);
      expect(result[0].columnName).toBe("field_1");
      expect(result[1].columnName).toBe("field_2");
      expect(result[2].columnName).toBe("field_3");
      expect(result[3].columnName).toBe("field_4");
    });
  });

  // ============================================================================
  // mergeAnalyses() - Edge Cases
  // ============================================================================

  describe("mergeAnalyses() - edge cases", () => {
    it("should handle analyses with empty columns arrays", () => {
      const analysis1 = createDataFrameAnalysis([]);
      const analysis2 = createDataFrameAnalysis([]);

      const result = mergeAnalyses([analysis1, analysis2]);

      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });

    it("should merge when some analyses have empty columns", () => {
      const col1 = createStringColumn({ columnName: "field_cat1", fieldId: "cat1" });
      const col2 = createNumberColumn({ columnName: "field_num1", fieldId: "num1" });

      const analysis1 = createDataFrameAnalysis([col1]);
      const analysis2 = createDataFrameAnalysis([]);
      const analysis3 = createDataFrameAnalysis([col2]);

      const result = mergeAnalyses([analysis1, analysis2, analysis3]);

      expect(result).toEqual([col1, col2]);
      expect(result).toHaveLength(2);
    });

    it("should handle analyses with different field hashes", () => {
      const col1 = createStringColumn({ columnName: "field_cat1", fieldId: "cat1" });
      const col2 = createNumberColumn({ columnName: "field_num1", fieldId: "num1" });

      const analysis1 = createDataFrameAnalysis([col1], { fieldHash: "hash1" });
      const analysis2 = createDataFrameAnalysis([col2], { fieldHash: "hash2" });

      const result = mergeAnalyses([analysis1, analysis2]);

      expect(result).toEqual([col1, col2]);
      expect(result).toHaveLength(2);
    });

    it("should handle analyses with different row counts", () => {
      const col1 = createStringColumn({ columnName: "field_cat1", fieldId: "cat1" });
      const col2 = createNumberColumn({ columnName: "field_num1", fieldId: "num1" });

      const analysis1 = createDataFrameAnalysis([col1], { rowCount: 100 });
      const analysis2 = createDataFrameAnalysis([col2], { rowCount: 500 });

      const result = mergeAnalyses([analysis1, analysis2]);

      expect(result).toEqual([col1, col2]);
      expect(result).toHaveLength(2);
    });

    it("should handle analyses with different timestamps", () => {
      const col1 = createStringColumn({ columnName: "field_cat1", fieldId: "cat1" });
      const col2 = createNumberColumn({ columnName: "field_num1", fieldId: "num1" });

      const analysis1 = createDataFrameAnalysis([col1], { analyzedAt: 1000000 });
      const analysis2 = createDataFrameAnalysis([col2], { analyzedAt: 2000000 });

      const result = mergeAnalyses([analysis1, analysis2]);

      expect(result).toEqual([col1, col2]);
      expect(result).toHaveLength(2);
    });
  });

  // ============================================================================
  // mergeAnalyses() - Integration Tests
  // ============================================================================

  describe("mergeAnalyses() - integration tests", () => {
    it("should merge realistic joined view scenario", () => {
      // Base table with user data
      const userId = createStringColumn({
        columnName: "field_user_id",
        fieldId: "user_id",
        semantic: "identifier",
      });
      const userName = createStringColumn({
        columnName: "field_user_name",
        fieldId: "user_name",
      });
      const userAge = createNumberColumn({
        columnName: "field_user_age",
        fieldId: "user_age",
      });

      // Joined table with order data
      const orderId = createStringColumn({
        columnName: "field_order_id",
        fieldId: "order_id",
        semantic: "identifier",
      });
      const orderAmount = createNumberColumn({
        columnName: "field_order_amount",
        fieldId: "order_amount",
      });
      const orderDate = createDateColumn({
        columnName: "field_order_date",
        fieldId: "order_date",
      });

      const baseAnalysis = createDataFrameAnalysis([userId, userName, userAge], {
        fieldHash: "user_hash_abc",
      });
      const joinedAnalysis = createDataFrameAnalysis([orderId, orderAmount, orderDate], {
        fieldHash: "order_hash_xyz",
      });

      const result = mergeAnalyses([baseAnalysis, joinedAnalysis]);

      expect(result).toHaveLength(6);
      expect(result[0]).toBe(userId);
      expect(result[1]).toBe(userName);
      expect(result[2]).toBe(userAge);
      expect(result[3]).toBe(orderId);
      expect(result[4]).toBe(orderAmount);
      expect(result[5]).toBe(orderDate);
    });

    it("should handle complex multi-table join with shared columns", () => {
      const sharedId = createStringColumn({
        columnName: "field_shared_id",
        fieldId: "shared",
      });
      const table1Col = createNumberColumn({
        columnName: "field_table1_value",
        fieldId: "t1val",
      });
      const table2Col = createNumberColumn({
        columnName: "field_table2_value",
        fieldId: "t2val",
      });
      const sharedIdDup = createStringColumn({
        columnName: "field_shared_id",
        fieldId: "shared_dup",
      });

      const analysis1 = createDataFrameAnalysis([sharedId, table1Col]);
      const analysis2 = createDataFrameAnalysis([sharedIdDup, table2Col]);

      const result = mergeAnalyses([analysis1, analysis2]);

      expect(result).toHaveLength(3);
      expect(result[0]).toBe(sharedId); // First occurrence wins
      expect(result[1]).toBe(table1Col);
      expect(result[2]).toBe(table2Col);
      expect(console.debug).toHaveBeenCalledWith(
        "[mergeAnalyses] Skipping duplicate column: field_shared_id",
      );
    });
  });

  // ============================================================================
  // mergeAnalyses() - Type Safety
  // ============================================================================

  describe("mergeAnalyses() - type safety", () => {
    it("should return ColumnAnalysis array type", () => {
      const col = createStringColumn({ columnName: "field_cat1", fieldId: "cat1" });
      const analysis = createDataFrameAnalysis([col]);

      const result: ColumnAnalysis[] = mergeAnalyses([analysis]);

      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toHaveProperty("columnName");
      expect(result[0]).toHaveProperty("dataType");
    });

    it("should preserve column analysis discriminated union types", () => {
      const stringCol = createStringColumn({ columnName: "field_str", fieldId: "str" });
      const numberCol = createNumberColumn({ columnName: "field_num", fieldId: "num" });
      const dateCol = createDateColumn({ columnName: "field_date", fieldId: "date" });
      const boolCol = createBooleanColumn({ columnName: "field_bool", fieldId: "bool" });

      const analysis = createDataFrameAnalysis([stringCol, numberCol, dateCol, boolCol]);
      const result = mergeAnalyses([analysis]);

      expect(result[0].dataType).toBe("string");
      expect(result[1].dataType).toBe("number");
      expect(result[2].dataType).toBe("date");
      expect(result[3].dataType).toBe("boolean");
    });
  });

  // ============================================================================
  // areAnalysesValid() - Missing Analysis
  // ============================================================================

  describe("areAnalysesValid() - missing analysis", () => {
    it("should return false when analysis is undefined", () => {
      const analyses = [{ id: "df1", analysis: undefined }];
      const hashes = new Map([["df1", "hash1"]]);

      const result = areAnalysesValid(analyses, hashes);

      expect(result).toBe(false);
      expect(console.debug).toHaveBeenCalledWith(
        "[areAnalysesValid] Missing analysis for DataFrame df1",
      );
    });

    it("should return false when any analysis is missing", () => {
      const col1 = createStringColumn({ columnName: "field_cat1", fieldId: "cat1" });
      const analysis1 = createDataFrameAnalysis([col1]);

      const analyses = [
        { id: "df1", analysis: analysis1 },
        { id: "df2", analysis: undefined },
      ];
      const hashes = new Map([
        ["df1", "hash1"],
        ["df2", "hash2"],
      ]);

      const result = areAnalysesValid(analyses, hashes);

      expect(result).toBe(false);
      expect(console.debug).toHaveBeenCalledWith(
        "[areAnalysesValid] Missing analysis for DataFrame df2",
      );
    });

    it("should check all analyses even if first is missing", () => {
      const analyses = [
        { id: "df1", analysis: undefined },
        { id: "df2", analysis: undefined },
      ];
      const hashes = new Map([
        ["df1", "hash1"],
        ["df2", "hash2"],
      ]);

      const result = areAnalysesValid(analyses, hashes);

      expect(result).toBe(false);
      // Should exit early on first missing analysis
      expect(console.debug).toHaveBeenCalledTimes(1);
      expect(console.debug).toHaveBeenCalledWith(
        "[areAnalysesValid] Missing analysis for DataFrame df1",
      );
    });
  });

  // ============================================================================
  // areAnalysesValid() - Field Hash Validation
  // ============================================================================

  describe("areAnalysesValid() - field hash validation", () => {
    it("should return false when field hash mismatches", () => {
      const col1 = createStringColumn({ columnName: "field_cat1", fieldId: "cat1" });
      const analysis1 = createDataFrameAnalysis([col1], { fieldHash: "wrong_hash" });

      const analyses = [{ id: "df1", analysis: analysis1 }];
      const hashes = new Map([["df1", "expected_hash"]]);

      const result = areAnalysesValid(analyses, hashes);

      expect(result).toBe(false);
      expect(console.debug).toHaveBeenCalledWith(
        "[areAnalysesValid] Field hash mismatch for DataFrame df1",
        { expected: "expected_hash", actual: "wrong_hash" },
      );
    });

    it("should return true when expected hash is not provided", () => {
      const col1 = createStringColumn({ columnName: "field_cat1", fieldId: "cat1" });
      const analysis1 = createDataFrameAnalysis([col1], { fieldHash: "any_hash" });

      const analyses = [{ id: "df1", analysis: analysis1 }];
      const hashes = new Map(); // No expected hash for df1

      const result = areAnalysesValid(analyses, hashes);

      expect(result).toBe(true);
    });

    it("should validate all hashes when multiple analyses", () => {
      const col1 = createStringColumn({ columnName: "field_cat1", fieldId: "cat1" });
      const col2 = createNumberColumn({ columnName: "field_num1", fieldId: "num1" });
      const analysis1 = createDataFrameAnalysis([col1], { fieldHash: "hash1" });
      const analysis2 = createDataFrameAnalysis([col2], { fieldHash: "wrong_hash" });

      const analyses = [
        { id: "df1", analysis: analysis1 },
        { id: "df2", analysis: analysis2 },
      ];
      const hashes = new Map([
        ["df1", "hash1"],
        ["df2", "hash2"],
      ]);

      const result = areAnalysesValid(analyses, hashes);

      expect(result).toBe(false);
      expect(console.debug).toHaveBeenCalledWith(
        "[areAnalysesValid] Field hash mismatch for DataFrame df2",
        { expected: "hash2", actual: "wrong_hash" },
      );
    });

    it("should pass when all hashes match", () => {
      const col1 = createStringColumn({ columnName: "field_cat1", fieldId: "cat1" });
      const col2 = createNumberColumn({ columnName: "field_num1", fieldId: "num1" });
      const analysis1 = createDataFrameAnalysis([col1], { fieldHash: "hash1" });
      const analysis2 = createDataFrameAnalysis([col2], { fieldHash: "hash2" });

      const analyses = [
        { id: "df1", analysis: analysis1 },
        { id: "df2", analysis: analysis2 },
      ];
      const hashes = new Map([
        ["df1", "hash1"],
        ["df2", "hash2"],
      ]);

      const result = areAnalysesValid(analyses, hashes);

      expect(result).toBe(true);
    });
  });

  // ============================================================================
  // areAnalysesValid() - Empty Analysis Detection
  // ============================================================================

  describe("areAnalysesValid() - empty analysis detection", () => {
    it("should return false when analysis has no columns", () => {
      const analysis1 = createDataFrameAnalysis([], { fieldHash: "hash1" });

      const analyses = [{ id: "df1", analysis: analysis1 }];
      const hashes = new Map([["df1", "hash1"]]);

      const result = areAnalysesValid(analyses, hashes);

      expect(result).toBe(false);
      expect(console.debug).toHaveBeenCalledWith(
        "[areAnalysesValid] Empty analysis for DataFrame df1",
      );
    });

    it("should detect empty analysis even with matching hash", () => {
      const analysis1 = createDataFrameAnalysis([], { fieldHash: "hash1" });

      const analyses = [{ id: "df1", analysis: analysis1 }];
      const hashes = new Map([["df1", "hash1"]]);

      const result = areAnalysesValid(analyses, hashes);

      expect(result).toBe(false);
    });

    it("should fail if any analysis is empty", () => {
      const col1 = createStringColumn({ columnName: "field_cat1", fieldId: "cat1" });
      const analysis1 = createDataFrameAnalysis([col1], { fieldHash: "hash1" });
      const analysis2 = createDataFrameAnalysis([], { fieldHash: "hash2" });

      const analyses = [
        { id: "df1", analysis: analysis1 },
        { id: "df2", analysis: analysis2 },
      ];
      const hashes = new Map([
        ["df1", "hash1"],
        ["df2", "hash2"],
      ]);

      const result = areAnalysesValid(analyses, hashes);

      expect(result).toBe(false);
      expect(console.debug).toHaveBeenCalledWith(
        "[areAnalysesValid] Empty analysis for DataFrame df2",
      );
    });
  });

  // ============================================================================
  // areAnalysesValid() - All Valid Cases
  // ============================================================================

  describe("areAnalysesValid() - all valid cases", () => {
    it("should return true for single valid analysis", () => {
      const col1 = createStringColumn({ columnName: "field_cat1", fieldId: "cat1" });
      const analysis1 = createDataFrameAnalysis([col1], { fieldHash: "hash1" });

      const analyses = [{ id: "df1", analysis: analysis1 }];
      const hashes = new Map([["df1", "hash1"]]);

      const result = areAnalysesValid(analyses, hashes);

      expect(result).toBe(true);
      expect(console.debug).not.toHaveBeenCalled();
    });

    it("should return true for multiple valid analyses", () => {
      const col1 = createStringColumn({ columnName: "field_cat1", fieldId: "cat1" });
      const col2 = createNumberColumn({ columnName: "field_num1", fieldId: "num1" });
      const col3 = createDateColumn({ columnName: "field_date1", fieldId: "date1" });
      const analysis1 = createDataFrameAnalysis([col1], { fieldHash: "hash1" });
      const analysis2 = createDataFrameAnalysis([col2, col3], { fieldHash: "hash2" });

      const analyses = [
        { id: "df1", analysis: analysis1 },
        { id: "df2", analysis: analysis2 },
      ];
      const hashes = new Map([
        ["df1", "hash1"],
        ["df2", "hash2"],
      ]);

      const result = areAnalysesValid(analyses, hashes);

      expect(result).toBe(true);
      expect(console.debug).not.toHaveBeenCalled();
    });

    it("should return true when no expected hashes provided", () => {
      const col1 = createStringColumn({ columnName: "field_cat1", fieldId: "cat1" });
      const analysis1 = createDataFrameAnalysis([col1], { fieldHash: "hash1" });

      const analyses = [{ id: "df1", analysis: analysis1 }];
      const hashes = new Map(); // Empty map

      const result = areAnalysesValid(analyses, hashes);

      expect(result).toBe(true);
    });

    it("should return true with empty analyses array", () => {
      const analyses: Array<{ id: string; analysis?: DataFrameAnalysis }> = [];
      const hashes = new Map();

      const result = areAnalysesValid(analyses, hashes);

      expect(result).toBe(true);
    });

    it("should validate realistic joined view scenario", () => {
      const col1 = createStringColumn({
        columnName: "field_user_id",
        fieldId: "user_id",
      });
      const col2 = createNumberColumn({
        columnName: "field_order_amount",
        fieldId: "order_amount",
      });
      const baseAnalysis = createDataFrameAnalysis([col1], {
        fieldHash: "user_hash_abc",
      });
      const joinedAnalysis = createDataFrameAnalysis([col2], {
        fieldHash: "order_hash_xyz",
      });

      const analyses = [
        { id: "base_df", analysis: baseAnalysis },
        { id: "joined_df", analysis: joinedAnalysis },
      ];
      const hashes = new Map([
        ["base_df", "user_hash_abc"],
        ["joined_df", "order_hash_xyz"],
      ]);

      const result = areAnalysesValid(analyses, hashes);

      expect(result).toBe(true);
    });
  });

  // ============================================================================
  // areAnalysesValid() - Edge Cases
  // ============================================================================

  describe("areAnalysesValid() - edge cases", () => {
    it("should handle analyses with single column", () => {
      const col1 = createStringColumn({ columnName: "field_single", fieldId: "single" });
      const analysis1 = createDataFrameAnalysis([col1], { fieldHash: "hash1" });

      const analyses = [{ id: "df1", analysis: analysis1 }];
      const hashes = new Map([["df1", "hash1"]]);

      const result = areAnalysesValid(analyses, hashes);

      expect(result).toBe(true);
    });

    it("should handle analyses with many columns", () => {
      const columns = Array.from({ length: 100 }, (_, i) =>
        createNumberColumn({ columnName: `field_${i}`, fieldId: `${i}` }),
      );
      const analysis1 = createDataFrameAnalysis(columns, { fieldHash: "hash1" });

      const analyses = [{ id: "df1", analysis: analysis1 }];
      const hashes = new Map([["df1", "hash1"]]);

      const result = areAnalysesValid(analyses, hashes);

      expect(result).toBe(true);
    });

    it("should handle partial hash map coverage", () => {
      const col1 = createStringColumn({ columnName: "field_cat1", fieldId: "cat1" });
      const col2 = createNumberColumn({ columnName: "field_num1", fieldId: "num1" });
      const analysis1 = createDataFrameAnalysis([col1], { fieldHash: "hash1" });
      const analysis2 = createDataFrameAnalysis([col2], { fieldHash: "hash2" });

      const analyses = [
        { id: "df1", analysis: analysis1 },
        { id: "df2", analysis: analysis2 },
      ];
      const hashes = new Map([["df1", "hash1"]]); // Only df1 has expected hash

      const result = areAnalysesValid(analyses, hashes);

      expect(result).toBe(true); // df2 has no expected hash, so it's valid
    });
  });

  // ============================================================================
  // areAnalysesValid() - Integration Tests
  // ============================================================================

  describe("areAnalysesValid() - integration tests", () => {
    it("should validate complete workflow with valid data", () => {
      const col1 = createStringColumn({ columnName: "field_user_id", fieldId: "uid" });
      const col2 = createNumberColumn({ columnName: "field_order_amt", fieldId: "amt" });
      const col3 = createDateColumn({ columnName: "field_order_date", fieldId: "date" });

      const analysis1 = createDataFrameAnalysis([col1], { fieldHash: "user_abc" });
      const analysis2 = createDataFrameAnalysis([col2, col3], { fieldHash: "order_xyz" });

      const analyses = [
        { id: "users", analysis: analysis1 },
        { id: "orders", analysis: analysis2 },
      ];
      const hashes = new Map([
        ["users", "user_abc"],
        ["orders", "order_xyz"],
      ]);

      const valid = areAnalysesValid(analyses, hashes);
      expect(valid).toBe(true);

      if (valid) {
        const merged = mergeAnalyses([analysis1, analysis2]);
        expect(merged).toHaveLength(3);
        expect(merged[0]).toBe(col1);
        expect(merged[1]).toBe(col2);
        expect(merged[2]).toBe(col3);
      }
    });

    it("should detect invalid workflow with mismatched hash", () => {
      const col1 = createStringColumn({ columnName: "field_user_id", fieldId: "uid" });
      const analysis1 = createDataFrameAnalysis([col1], { fieldHash: "wrong_hash" });

      const analyses = [{ id: "users", analysis: analysis1 }];
      const hashes = new Map([["users", "expected_hash"]]);

      const valid = areAnalysesValid(analyses, hashes);
      expect(valid).toBe(false);
    });

    it("should detect invalid workflow with empty analysis", () => {
      const analysis1 = createDataFrameAnalysis([], { fieldHash: "hash1" });

      const analyses = [{ id: "users", analysis: analysis1 }];
      const hashes = new Map([["users", "hash1"]]);

      const valid = areAnalysesValid(analyses, hashes);
      expect(valid).toBe(false);
    });
  });

  // ============================================================================
  // areAnalysesValid() - Type Safety
  // ============================================================================

  describe("areAnalysesValid() - type safety", () => {
    it("should return boolean type", () => {
      const col1 = createStringColumn({ columnName: "field_cat1", fieldId: "cat1" });
      const analysis1 = createDataFrameAnalysis([col1], { fieldHash: "hash1" });

      const analyses = [{ id: "df1", analysis: analysis1 }];
      const hashes = new Map([["df1", "hash1"]]);

      const result: boolean = areAnalysesValid(analyses, hashes);

      expect(typeof result).toBe("boolean");
    });

    it("should accept optional analysis in input type", () => {
      const analyses: Array<{ id: string; analysis?: DataFrameAnalysis }> = [
        { id: "df1", analysis: undefined },
      ];
      const hashes = new Map();

      const result = areAnalysesValid(analyses, hashes);

      expect(result).toBe(false);
    });
  });
});
