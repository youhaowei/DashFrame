/**
 * Unit tests for JSON Flattening Utilities
 *
 * Tests cover:
 * - Basic nested object flattening
 * - Deep nesting with dot-notation keys
 * - Array handling (index vs stringify modes)
 * - Max depth limiting
 * - Custom separator configuration
 * - Edge cases (empty objects, arrays, null values)
 * - flattenObjectArray with inconsistent keys
 * - extractKeys function
 * - unflattenObject (inverse operation)
 */
import { describe, it, expect } from "vitest";
import {
  flattenObject,
  flattenObjectArray,
  extractKeys,
  unflattenObject,
  type JsonValue,
  type FlattenedObject,
} from "./flatten";

describe("flattenObject", () => {
  describe("basic flattening", () => {
    it("should flatten simple nested object", () => {
      const input = { user: { name: "Alice" } };
      const result = flattenObject(input);
      expect(result).toEqual({ "user.name": "Alice" });
    });

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

    it("should handle multiple top-level keys", () => {
      const input = {
        name: "Alice",
        age: 30,
        active: true,
      };
      const result = flattenObject(input);
      expect(result).toEqual({
        name: "Alice",
        age: 30,
        active: true,
      });
    });

    it("should handle mixed nesting levels", () => {
      const input = {
        name: "Alice",
        address: {
          city: "NYC",
        },
        verified: true,
      };
      const result = flattenObject(input);
      expect(result).toEqual({
        name: "Alice",
        "address.city": "NYC",
        verified: true,
      });
    });
  });

  describe("primitive values", () => {
    it("should handle null values", () => {
      const input = { user: { name: null } };
      const result = flattenObject(input);
      expect(result).toEqual({ "user.name": null });
    });

    it("should handle boolean values", () => {
      const input = { settings: { enabled: true, visible: false } };
      const result = flattenObject(input);
      expect(result).toEqual({
        "settings.enabled": true,
        "settings.visible": false,
      });
    });

    it("should handle number values (integers and floats)", () => {
      const input = { data: { count: 42, ratio: 3.14 } };
      const result = flattenObject(input);
      expect(result).toEqual({
        "data.count": 42,
        "data.ratio": 3.14,
      });
    });

    it("should handle string values with special characters", () => {
      const input = { text: { message: "Hello, World! 🎉" } };
      const result = flattenObject(input);
      expect(result).toEqual({ "text.message": "Hello, World! 🎉" });
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

  describe("array handling - index mode (default)", () => {
    it("should flatten arrays with numeric indices", () => {
      const input = { items: [1, 2, 3] };
      const result = flattenObject(input);
      expect(result).toEqual({
        "items.0": 1,
        "items.1": 2,
        "items.2": 3,
      });
    });

    it("should flatten array of strings", () => {
      const input = { tags: ["a", "b", "c"] };
      const result = flattenObject(input);
      expect(result).toEqual({
        "tags.0": "a",
        "tags.1": "b",
        "tags.2": "c",
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

    it("should flatten array of objects", () => {
      const input = {
        users: [
          { name: "Alice", age: 30 },
          { name: "Bob", age: 25 },
        ],
      };
      const result = flattenObject(input);
      expect(result).toEqual({
        "users.0.name": "Alice",
        "users.0.age": 30,
        "users.1.name": "Bob",
        "users.1.age": 25,
      });
    });
  });

  describe("array handling - stringify mode", () => {
    it("should stringify arrays when arrayHandling is stringify", () => {
      const input = { items: [1, 2, 3] };
      const result = flattenObject(input, { arrayHandling: "stringify" });
      expect(result).toEqual({
        items: "[1,2,3]",
      });
    });

    it("should stringify nested arrays", () => {
      const input = { data: { items: ["a", "b"] } };
      const result = flattenObject(input, { arrayHandling: "stringify" });
      expect(result).toEqual({
        "data.items": '["a","b"]',
      });
    });

    it("should stringify array of objects", () => {
      const input = { users: [{ name: "Alice" }] };
      const result = flattenObject(input, { arrayHandling: "stringify" });
      expect(result).toEqual({
        users: '[{"name":"Alice"}]',
      });
    });
  });

  describe("max depth option", () => {
    it("should stringify objects beyond max depth", () => {
      const input = {
        level1: {
          level2: {
            level3: {
              value: "deep",
            },
          },
        },
      };
      const result = flattenObject(input, { maxDepth: 2 });
      expect(result).toEqual({
        "level1.level2": '{"level3":{"value":"deep"}}',
      });
    });

    it("should respect maxDepth of 1", () => {
      const input = { a: { b: { c: 1 } } };
      const result = flattenObject(input, { maxDepth: 1 });
      expect(result).toEqual({
        a: '{"b":{"c":1}}',
      });
    });

    it("should not affect flattening when maxDepth is Infinity", () => {
      const input = { a: { b: { c: { d: 1 } } } };
      const result = flattenObject(input, { maxDepth: Infinity });
      expect(result).toEqual({
        "a.b.c.d": 1,
      });
    });
  });

  describe("custom separator option", () => {
    it("should use underscore separator", () => {
      const input = { user: { name: "Alice" } };
      const result = flattenObject(input, { separator: "_" });
      expect(result).toEqual({ user_name: "Alice" });
    });

    it("should use double underscore separator", () => {
      const input = { user: { address: { city: "NYC" } } };
      const result = flattenObject(input, { separator: "__" });
      expect(result).toEqual({ user__address__city: "NYC" });
    });

    it("should use slash separator", () => {
      const input = { a: { b: { c: 1 } } };
      const result = flattenObject(input, { separator: "/" });
      expect(result).toEqual({ "a/b/c": 1 });
    });
  });

  describe("edge cases", () => {
    it("should handle empty object", () => {
      const input = { data: {} };
      const result = flattenObject(input);
      expect(result).toEqual({ data: "{}" });
    });

    it("should handle empty array", () => {
      const input = { items: [] };
      const result = flattenObject(input);
      expect(result).toEqual({ items: "[]" });
    });

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

    it("should handle deeply nested empty objects", () => {
      const input = { a: { b: { c: {} } } };
      const result = flattenObject(input);
      expect(result).toEqual({ "a.b.c": "{}" });
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
    it("should flatten array of simple objects", () => {
      const input = [{ name: "Alice" }, { name: "Bob" }];
      const result = flattenObjectArray(input);
      expect(result).toEqual([{ name: "Alice" }, { name: "Bob" }]);
    });

    it("should flatten array of nested objects", () => {
      const input = [
        { user: { name: "Alice" } },
        { user: { name: "Bob" } },
      ];
      const result = flattenObjectArray(input);
      expect(result).toEqual([
        { "user.name": "Alice" },
        { "user.name": "Bob" },
      ]);
    });

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

    it("should handle completely different keys", () => {
      const input = [{ a: 1 }, { b: 2 }, { c: 3 }];
      const result = flattenObjectArray(input);
      expect(result).toEqual([
        { a: 1, b: null, c: null },
        { a: null, b: 2, c: null },
        { a: null, b: null, c: 3 },
      ]);
    });

    it("should sort keys alphabetically", () => {
      const input = [{ z: 1, a: 2, m: 3 }];
      const result = flattenObjectArray(input);
      expect(Object.keys(result[0])).toEqual(["a", "m", "z"]);
    });
  });

  describe("complex scenarios", () => {
    it("should handle real-world dataset with varying fields", () => {
      const input = [
        { id: 1, name: "Product A", price: 100 },
        { id: 2, name: "Product B", price: 200, discount: 10 },
        { id: 3, name: "Product C" },
      ];
      const result = flattenObjectArray(input);
      expect(result).toEqual([
        { discount: null, id: 1, name: "Product A", price: 100 },
        { discount: 10, id: 2, name: "Product B", price: 200 },
        { discount: null, id: 3, name: "Product C", price: null },
      ]);
    });

    it("should handle nested objects with varying fields", () => {
      const input = [
        { user: { name: "Alice", address: { city: "NYC" } } },
        { user: { name: "Bob" } },
      ];
      const result = flattenObjectArray(input);
      expect(result).toEqual([
        { "user.address.city": "NYC", "user.name": "Alice" },
        { "user.address.city": null, "user.name": "Bob" },
      ]);
    });
  });

  describe("with options", () => {
    it("should pass separator option through", () => {
      const input = [{ user: { name: "Alice" } }];
      const result = flattenObjectArray(input, { separator: "_" });
      expect(result).toEqual([{ user_name: "Alice" }]);
    });

    it("should pass arrayHandling option through", () => {
      const input = [{ tags: ["a", "b"] }];
      const result = flattenObjectArray(input, { arrayHandling: "stringify" });
      expect(result).toEqual([{ tags: '["a","b"]' }]);
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

  it("should handle single object", () => {
    const input: FlattenedObject[] = [{ name: "Alice", age: 30 }];
    const result = extractKeys(input);
    expect(result).toEqual(["age", "name"]);
  });

  it("should handle dot-notation keys", () => {
    const input: FlattenedObject[] = [
      { "user.name": "Alice", "user.age": 30 },
      { "user.email": "alice@example.com" },
    ];
    const result = extractKeys(input);
    expect(result).toEqual(["user.age", "user.email", "user.name"]);
  });
});

describe("unflattenObject", () => {
  describe("basic unflattening", () => {
    it("should unflatten simple dot-notation keys", () => {
      const input = { "user.name": "Alice" };
      const result = unflattenObject(input);
      expect(result).toEqual({ user: { name: "Alice" } });
    });

    it("should unflatten deeply nested keys", () => {
      const input = { "user.address.city": "NYC" };
      const result = unflattenObject(input);
      expect(result).toEqual({ user: { address: { city: "NYC" } } });
    });

    it("should handle multiple keys at same level", () => {
      const input = {
        "user.name": "Alice",
        "user.age": 30,
      };
      const result = unflattenObject(input);
      expect(result).toEqual({ user: { name: "Alice", age: 30 } });
    });
  });

  describe("array reconstruction", () => {
    it("should reconstruct arrays from numeric indices", () => {
      const input = {
        "items.0": "a",
        "items.1": "b",
        "items.2": "c",
      };
      const result = unflattenObject(input);
      expect(result).toEqual({ items: ["a", "b", "c"] });
    });

    it("should reconstruct array of objects", () => {
      const input = {
        "users.0.name": "Alice",
        "users.0.age": 30,
        "users.1.name": "Bob",
        "users.1.age": 25,
      };
      const result = unflattenObject(input);
      expect(result).toEqual({
        users: [
          { name: "Alice", age: 30 },
          { name: "Bob", age: 25 },
        ],
      });
    });
  });

  describe("custom separator", () => {
    it("should use underscore separator", () => {
      const input = { user_name: "Alice" };
      const result = unflattenObject(input, "_");
      expect(result).toEqual({ user: { name: "Alice" } });
    });

    it("should use double underscore separator", () => {
      const input = { user__address__city: "NYC" };
      const result = unflattenObject(input, "__");
      expect(result).toEqual({ user: { address: { city: "NYC" } } });
    });
  });

  describe("roundtrip", () => {
    it("should roundtrip simple nested object", () => {
      const original = { user: { name: "Alice", age: 30 } };
      const flattened = flattenObject(original);
      const result = unflattenObject(flattened);
      expect(result).toEqual(original);
    });

    it("should roundtrip with arrays", () => {
      const original = { items: ["a", "b", "c"] };
      const flattened = flattenObject(original);
      const result = unflattenObject(flattened);
      expect(result).toEqual(original);
    });

    it("should roundtrip complex structure", () => {
      const original = {
        user: {
          name: "Alice",
          address: {
            city: "NYC",
            zip: "10001",
          },
        },
        active: true,
      };
      const flattened = flattenObject(original);
      const result = unflattenObject(flattened);
      expect(result).toEqual(original);
    });
  });

  describe("edge cases", () => {
    it("should handle empty object", () => {
      const result = unflattenObject({});
      expect(result).toEqual({});
    });

    it("should handle top-level keys without dots", () => {
      const input = { name: "Alice", age: 30 };
      const result = unflattenObject(input);
      expect(result).toEqual({ name: "Alice", age: 30 });
    });

    it("should handle null values", () => {
      const input = { "user.name": null };
      const result = unflattenObject(input);
      expect(result).toEqual({ user: { name: null } });
    });
  });
});
