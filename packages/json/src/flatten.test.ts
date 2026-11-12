/**
 * Unit tests for JSON Flattening Utilities
 *
 * Tests cover:
 * - Basic nested object flattening
 * - Deep nesting with dot-notation keys
 * - Array handling with numeric indices
 * - Edge cases (empty objects, arrays, null values)
 * - flattenObjectArray with inconsistent keys
 * - extractKeys function
 */
import { describe, expect, it } from "vite-plus/test";
import {
  extractKeys,
  flattenObject,
  flattenObjectArray,
  type FlattenedObject,
  type JsonValue,
} from "./flatten";

describe("flattenObject", () => {
  describe("basic flattening", () => {
    it("should flatten deeply nested object", () => {
      const input = {
        user: {
          name: "Alice",
          address: {
            city: "NYC",
            zip: "10001",
          },
        },
      };
      const result = flattenObject(input);
      expect(result).toEqual({
        "user.name": "Alice",
        "user.address.city": "NYC",
        "user.address.zip": "10001",
      });
    });
  });

  describe("primitive values", () => {
    it("should handle boolean values", () => {
      const input = { settings: { enabled: true, visible: false } };
      const result = flattenObject(input);
      expect(result).toEqual({
        "settings.enabled": true,
        "settings.visible": false,
      });
    });

    it("should handle primitive at root level", () => {
      expect(flattenObject("hello" as unknown as JsonValue)).toEqual({
        value: "hello",
      });
      expect(flattenObject(42 as unknown as JsonValue)).toEqual({ value: 42 });
      expect(flattenObject(true as unknown as JsonValue)).toEqual({
        value: true,
      });
      expect(flattenObject(null as unknown as JsonValue)).toEqual({
        value: null,
      });
    });
  });

  describe("array handling", () => {
    it("should flatten arrays with numeric indices", () => {
      const input = { items: [1, 2, 3] };
      const result = flattenObject(input);
      expect(result).toEqual({
        "items.0": 1,
        "items.1": 2,
        "items.2": 3,
      });
    });

    it("should flatten nested arrays", () => {
      const input = {
        matrix: [
          [1, 2],
          [3, 4],
        ],
      };
      const result = flattenObject(input);
      expect(result).toEqual({
        "matrix.0.0": 1,
        "matrix.0.1": 2,
        "matrix.1.0": 3,
        "matrix.1.1": 4,
      });
    });
  });

  describe("edge cases", () => {
    it("should handle completely empty object at root", () => {
      const result = flattenObject({});
      expect(result).toEqual({});
    });

    it("should handle object with multiple empty nested values", () => {
      const input = {
        empty: {},
        items: [],
        value: null,
      };
      const result = flattenObject(input);
      expect(result).toEqual({
        empty: "{}",
        items: "[]",
        value: null,
      });
    });
  });

  describe("complex structures", () => {
    it("should handle real-world user profile object", () => {
      const input = {
        id: 1,
        name: "Alice Smith",
        email: "alice@example.com",
        profile: {
          age: 30,
          address: {
            street: "123 Main St",
            city: "NYC",
            country: "USA",
          },
          preferences: {
            theme: "dark",
            notifications: true,
          },
        },
        tags: ["admin", "verified"],
      };
      const result = flattenObject(input);
      expect(result).toEqual({
        id: 1,
        name: "Alice Smith",
        email: "alice@example.com",
        "profile.age": 30,
        "profile.address.street": "123 Main St",
        "profile.address.city": "NYC",
        "profile.address.country": "USA",
        "profile.preferences.theme": "dark",
        "profile.preferences.notifications": true,
        "tags.0": "admin",
        "tags.1": "verified",
      });
    });

    it("should handle mixed arrays and objects", () => {
      const input = {
        data: [
          { type: "A", values: [1, 2] },
          { type: "B", values: [3, 4] },
        ],
      };
      const result = flattenObject(input);
      expect(result).toEqual({
        "data.0.type": "A",
        "data.0.values.0": 1,
        "data.0.values.1": 2,
        "data.1.type": "B",
        "data.1.values.0": 3,
        "data.1.values.1": 4,
      });
    });
  });
});

describe("flattenObjectArray", () => {
  describe("basic functionality", () => {
    it("should handle empty array", () => {
      const result = flattenObjectArray([]);
      expect(result).toEqual([]);
    });
  });

  describe("consistent keys across objects", () => {
    it("should fill missing keys with null", () => {
      const input = [
        { user: { name: "Alice" } },
        { user: { name: "Bob", age: 30 } },
      ];
      const result = flattenObjectArray(input);
      expect(result).toEqual([
        { "user.age": null, "user.name": "Alice" },
        { "user.age": 30, "user.name": "Bob" },
      ]);
    });

    it("should sort keys alphabetically", () => {
      const input = [{ z: 1, a: 2, m: 3 }];
      const result = flattenObjectArray(input);
      expect(Object.keys(result[0])).toEqual(["a", "m", "z"]);
    });
  });
});

describe("extractKeys", () => {
  it("should extract all unique keys from array of objects", () => {
    const input: FlattenedObject[] = [
      { a: 1, b: 2 },
      { b: 3, c: 4 },
    ];
    const result = extractKeys(input);
    expect(result).toEqual(["a", "b", "c"]);
  });

  it("should return sorted keys", () => {
    const input: FlattenedObject[] = [{ z: 1, a: 2, m: 3, d: 4 }];
    const result = extractKeys(input);
    expect(result).toEqual(["a", "d", "m", "z"]);
  });

  it("should handle empty array", () => {
    const result = extractKeys([]);
    expect(result).toEqual([]);
  });
});
