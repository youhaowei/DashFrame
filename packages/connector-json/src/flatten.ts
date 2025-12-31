/**
 * JSON Flattening Utilities
 *
 * Provides functions to flatten nested JSON objects into flat structures
 * with dot-notation keys (e.g., 'user.address.city').
 *
 * This is essential for converting nested JSON structures into tabular
 * DataFrame format where each column represents a single value.
 */

/**
 * Represents a JSON value that can be nested.
 * Excludes functions and symbols as they are not valid JSON.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Represents a primitive JSON value (non-nested).
 * These are the only values that can exist in a flattened structure.
 */
export type JsonPrimitive = string | number | boolean | null;

/**
 * Represents a flattened JSON object with dot-notation keys.
 * All values are primitives since nested structures are flattened.
 */
export type FlattenedObject = Record<string, JsonPrimitive>;

/**
 * Options for controlling the flattening behavior.
 */
export interface FlattenOptions {
  /**
   * Maximum depth to flatten. Objects deeper than this will be serialized as JSON strings.
   * Default: Infinity (flatten all levels)
   */
  maxDepth?: number;

  /**
   * Custom separator for nested keys. Default: '.'
   * Example with '_': user_address_city
   */
  separator?: string;

  /**
   * How to handle arrays:
   * - 'index': Flatten with numeric indices (e.g., 'items.0', 'items.1')
   * - 'stringify': Convert arrays to JSON strings
   * Default: 'index'
   */
  arrayHandling?: "index" | "stringify";
}

const DEFAULT_OPTIONS: Required<FlattenOptions> = {
  maxDepth: Infinity,
  separator: ".",
  arrayHandling: "index",
};

/**
 * Checks if a value is a plain object (not null, not an array).
 */
function isPlainObject(value: unknown): value is Record<string, JsonValue> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}

/**
 * Checks if a value is a primitive JSON value.
 */
function isPrimitive(value: unknown): value is JsonPrimitive {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

/**
 * Flattens a single nested object into a flat structure with dot-notation keys.
 *
 * @param obj - The object to flatten
 * @param options - Flattening options
 * @returns A flat object with dot-notation keys
 *
 * @example
 * ```typescript
 * flattenObject({ user: { name: 'Alice', address: { city: 'NYC' } } })
 * // Returns: { 'user.name': 'Alice', 'user.address.city': 'NYC' }
 *
 * flattenObject({ items: [1, 2, 3] })
 * // Returns: { 'items.0': 1, 'items.1': 2, 'items.2': 3 }
 * ```
 */
export function flattenObject(
  obj: JsonValue,
  options: FlattenOptions = {},
): FlattenedObject {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const result: FlattenedObject = {};

  function flatten(
    value: JsonValue,
    prefix: string,
    currentDepth: number,
  ): void {
    // Handle primitives - add directly to result
    if (isPrimitive(value)) {
      result[prefix] = value;
      return;
    }

    // Check max depth - stringify if exceeded
    if (currentDepth >= opts.maxDepth) {
      result[prefix] = JSON.stringify(value);
      return;
    }

    // Handle arrays
    if (Array.isArray(value)) {
      if (opts.arrayHandling === "stringify") {
        result[prefix] = JSON.stringify(value);
        return;
      }

      // Handle empty arrays
      if (value.length === 0) {
        result[prefix] = JSON.stringify([]);
        return;
      }

      // Flatten with numeric indices
      for (let i = 0; i < value.length; i++) {
        const key = prefix ? `${prefix}${opts.separator}${i}` : String(i);
        flatten(value[i], key, currentDepth + 1);
      }
      return;
    }

    // Handle objects
    if (isPlainObject(value)) {
      const keys = Object.keys(value);

      // Handle empty objects
      if (keys.length === 0) {
        result[prefix] = JSON.stringify({});
        return;
      }

      for (const key of keys) {
        const newPrefix = prefix ? `${prefix}${opts.separator}${key}` : key;
        flatten(value[key], newPrefix, currentDepth + 1);
      }
      return;
    }

    // Fallback for unexpected types - stringify
    result[prefix] = String(value);
  }

  // Start flattening from root
  if (isPrimitive(obj)) {
    // Single primitive value at root - not really meaningful but handle it
    return { value: obj };
  }

  flatten(obj, "", 0);
  return result;
}

/**
 * Flattens an array of objects, ensuring all objects have the same keys.
 * Missing keys in individual objects are filled with null.
 *
 * @param objects - Array of objects to flatten
 * @param options - Flattening options
 * @returns Array of flattened objects with consistent keys
 *
 * @example
 * ```typescript
 * flattenObjectArray([
 *   { user: { name: 'Alice' } },
 *   { user: { name: 'Bob', age: 30 } }
 * ])
 * // Returns: [
 * //   { 'user.name': 'Alice', 'user.age': null },
 * //   { 'user.name': 'Bob', 'user.age': 30 }
 * // ]
 * ```
 */
export function flattenObjectArray(
  objects: JsonValue[],
  options: FlattenOptions = {},
): FlattenedObject[] {
  if (objects.length === 0) {
    return [];
  }

  // First pass: flatten all objects and collect all keys
  const flattenedObjects = objects.map((obj) => flattenObject(obj, options));
  const allKeys = new Set<string>();

  for (const obj of flattenedObjects) {
    for (const key of Object.keys(obj)) {
      allKeys.add(key);
    }
  }

  // Second pass: ensure all objects have all keys (fill missing with null)
  const sortedKeys = Array.from(allKeys).sort();
  return flattenedObjects.map((obj) => {
    const normalized: FlattenedObject = {};
    for (const key of sortedKeys) {
      normalized[key] = key in obj ? obj[key] : null;
    }
    return normalized;
  });
}

/**
 * Extracts all unique keys from an array of flattened objects.
 * Keys are sorted alphabetically for consistent column ordering.
 *
 * @param objects - Array of flattened objects
 * @returns Sorted array of unique keys
 */
export function extractKeys(objects: FlattenedObject[]): string[] {
  const keys = new Set<string>();
  for (const obj of objects) {
    for (const key of Object.keys(obj)) {
      keys.add(key);
    }
  }
  return Array.from(keys).sort();
}

/**
 * Unflattens a flat object back into a nested structure.
 * This is the inverse of flattenObject.
 *
 * @param obj - The flat object with dot-notation keys
 * @param separator - The separator used in keys (default: '.')
 * @returns The unflattened nested object
 *
 * @example
 * ```typescript
 * unflattenObject({ 'user.name': 'Alice', 'user.address.city': 'NYC' })
 * // Returns: { user: { name: 'Alice', address: { city: 'NYC' } } }
 * ```
 */
export function unflattenObject(
  obj: FlattenedObject,
  separator: string = ".",
): JsonValue {
  const result: Record<string, JsonValue> = {};

  for (const [key, value] of Object.entries(obj)) {
    const parts = key.split(separator);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Building dynamic nested structure
    let current: any = result;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      const nextPart = parts[i + 1];

      // Check if next part is a numeric index
      const isNextArray = /^\d+$/.test(nextPart);

      if (!(part in current)) {
        current[part] = isNextArray ? [] : {};
      }
      current = current[part];
    }

    const lastPart = parts[parts.length - 1];
    current[lastPart] = value;
  }

  return result;
}
