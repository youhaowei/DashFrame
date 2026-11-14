/**
 * Unit tests for CSV parser
 *
 * Tests cover:
 * - Simple CSV parsing
 * - Quoted fields with commas
 * - Escaped quotes (doubled quotes)
 * - Newlines within quoted fields
 * - Different line endings (LF, CRLF, CR)
 * - Edge cases (trailing newline, empty fields, empty rows)
 */
import { describe, expect, it } from "vite-plus/test";
import { parseCSV } from "./parser";

describe("parseCSV", () => {
  it.each<[string, string, string[][]]>([
    [
      "should parse simple CSV correctly",
      "name,age\nAlice,30\nBob,25",
      [
        ["name", "age"],
        ["Alice", "30"],
        ["Bob", "25"],
      ],
    ],
    [
      "should handle quoted fields with commas",
      'name,description\nAlice,"Hello, World"',
      [
        ["name", "description"],
        ["Alice", "Hello, World"],
      ],
    ],
    [
      "should handle escaped quotes (doubled quotes)",
      'name,quote\nAlice,"She said ""hello"""',
      [
        ["name", "quote"],
        ["Alice", 'She said "hello"'],
      ],
    ],
    [
      "should handle newlines within quoted fields",
      'name,address\nAlice,"123 Main St\nApt 4"',
      [
        ["name", "address"],
        ["Alice", "123 Main St\nApt 4"],
      ],
    ],
    [
      "should handle Windows line endings (CRLF)",
      "a,b\r\n1,2\r\n3,4",
      [
        ["a", "b"],
        ["1", "2"],
        ["3", "4"],
      ],
    ],
    [
      "should handle old Mac line endings (CR)",
      "a,b\r1,2\r3,4",
      [
        ["a", "b"],
        ["1", "2"],
        ["3", "4"],
      ],
    ],
    [
      "should handle trailing newline",
      "a,b\n1,2\n",
      [
        ["a", "b"],
        ["1", "2"],
      ],
    ],
    [
      "should handle empty fields",
      "a,b,c\n1,,3\n,2,",
      [
        ["a", "b", "c"],
        ["1", "", "3"],
        ["", "2", ""],
      ],
    ],
    [
      "should handle single column CSV",
      "name\nAlice\nBob",
      [["name"], ["Alice"], ["Bob"]],
    ],
    [
      "should skip empty rows",
      "a,b\n\n1,2\n\n3,4",
      [
        ["a", "b"],
        ["1", "2"],
        ["3", "4"],
      ],
    ],
  ])("%s", (_label, csv, expected) => {
    expect(parseCSV(csv)).toEqual(expected);
  });
});
