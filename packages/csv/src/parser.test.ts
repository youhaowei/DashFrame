/**
 * Unit tests for CSV parser
 *
 * Tests cover:
 * - Simple CSV parsing
 * - Quoted fields with commas
 * - Escaped quotes (doubled quotes)
 * - Newlines within quoted fields
 * - Different line endings (LF, CRLF, CR)
 * - Edge cases (trailing newline, empty fields, single column)
 */
import { describe, expect, it } from "vitest";
import { parseCSV } from "./parser";

describe("parseCSV", () => {
  describe("standard CSV parsing", () => {
    it("should parse simple CSV correctly", () => {
      const csv = "name,age\nAlice,30\nBob,25";
      const result = parseCSV(csv);

      expect(result).toEqual([
        ["name", "age"],
        ["Alice", "30"],
        ["Bob", "25"],
      ]);
    });

    it("should return empty array for empty string", () => {
      expect(parseCSV("")).toEqual([]);
    });

    it("should handle single row", () => {
      const csv = "a,b,c";
      const result = parseCSV(csv);

      expect(result).toEqual([["a", "b", "c"]]);
    });
  });

  describe("quoted fields", () => {
    it("should handle quoted fields with commas", () => {
      const csv = 'name,description\nAlice,"Hello, World"';
      const result = parseCSV(csv);

      expect(result).toEqual([
        ["name", "description"],
        ["Alice", "Hello, World"],
      ]);
    });

    it("should handle escaped quotes (doubled quotes)", () => {
      const csv = 'name,quote\nAlice,"She said ""hello"""';
      const result = parseCSV(csv);

      expect(result).toEqual([
        ["name", "quote"],
        ["Alice", 'She said "hello"'],
      ]);
    });

    it("should handle newlines within quoted fields", () => {
      const csv = 'name,address\nAlice,"123 Main St\nApt 4"';
      const result = parseCSV(csv);

      expect(result).toEqual([
        ["name", "address"],
        ["Alice", "123 Main St\nApt 4"],
      ]);
    });

    it("should handle empty quoted fields", () => {
      const csv = 'a,b\n"",2';
      const result = parseCSV(csv);

      expect(result).toEqual([
        ["a", "b"],
        ["", "2"],
      ]);
    });
  });

  describe("line endings", () => {
    it("should handle Unix line endings (LF)", () => {
      const csv = "a,b\n1,2\n3,4";
      const result = parseCSV(csv);

      expect(result).toEqual([
        ["a", "b"],
        ["1", "2"],
        ["3", "4"],
      ]);
    });

    it("should handle Windows line endings (CRLF)", () => {
      const csv = "a,b\r\n1,2\r\n3,4";
      const result = parseCSV(csv);

      expect(result).toEqual([
        ["a", "b"],
        ["1", "2"],
        ["3", "4"],
      ]);
    });

    it("should handle old Mac line endings (CR)", () => {
      const csv = "a,b\r1,2\r3,4";
      const result = parseCSV(csv);

      expect(result).toEqual([
        ["a", "b"],
        ["1", "2"],
        ["3", "4"],
      ]);
    });
  });

  describe("edge cases", () => {
    it("should handle trailing newline", () => {
      const csv = "a,b\n1,2\n";
      const result = parseCSV(csv);

      expect(result).toEqual([
        ["a", "b"],
        ["1", "2"],
      ]);
    });

    it("should handle empty fields", () => {
      const csv = "a,b,c\n1,,3\n,2,";
      const result = parseCSV(csv);

      expect(result).toEqual([
        ["a", "b", "c"],
        ["1", "", "3"],
        ["", "2", ""],
      ]);
    });

    it("should handle single column CSV", () => {
      const csv = "name\nAlice\nBob";
      const result = parseCSV(csv);

      expect(result).toEqual([["name"], ["Alice"], ["Bob"]]);
    });

    it("should skip empty rows", () => {
      const csv = "a,b\n\n1,2\n\n3,4";
      const result = parseCSV(csv);

      expect(result).toEqual([
        ["a", "b"],
        ["1", "2"],
        ["3", "4"],
      ]);
    });

    it("should handle whitespace-only fields", () => {
      const csv = "a,b\n  ,  ";
      const result = parseCSV(csv);

      expect(result).toEqual([
        ["a", "b"],
        ["  ", "  "],
      ]);
    });
  });
});
