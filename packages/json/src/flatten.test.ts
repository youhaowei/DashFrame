/**
 * Unit tests for JSON Flattening Utilities
 *
 * Tests cover:
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
  describe("primitive values", () => {
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

  describe("edge cases", () => {
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
  });
});

describe("flattenObjectArray", () => {
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
  });
});

describe("extractKeys", () => {
  it("should return sorted keys", () => {
    const input: FlattenedObject[] = [{ z: 1, a: 2, m: 3, d: 4 }];
    const result = extractKeys(input);
    expect(result).toEqual(["a", "d", "m", "z"]);
  });
});
