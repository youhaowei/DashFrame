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
 * Builds a new key by joining prefix with the new part using a dot.
 */
function buildKey(prefix: string, part: string): string {
  return prefix ? `${prefix}.${part}` : part;
}

/**
 * Flattens an array value into the result object.
 * Elements are keyed by numeric index (e.g., 'items.0', 'items.1').
 */
function flattenArray(
  value: JsonValue[],
  prefix: string,
  result: FlattenedObject,
  flattenValue: (v: JsonValue, p: string) => void,
): void {
  if (value.length === 0) {
    result[prefix] = JSON.stringify(value);
    return;
  }

  for (let i = 0; i < value.length; i++) {
    const key = buildKey(prefix, String(i));
    flattenValue(value[i] as JsonValue, key);
  }
}

/**
 * Flattens a plain object value into the result object.
 */
function flattenPlainObject(
  value: Record<string, JsonValue>,
  prefix: string,
  result: FlattenedObject,
  flattenValue: (v: JsonValue, p: string) => void,
): void {
  const keys = Object.keys(value);

  if (keys.length === 0) {
    result[prefix] = JSON.stringify({});
    return;
  }

  for (const key of keys) {
    const newPrefix = buildKey(prefix, key);
    flattenValue(value[key] as JsonValue, newPrefix);
  }
}

/**
 * Flattens a single nested object into a flat structure with dot-notation keys.
 *
 * @param obj - The object to flatten
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
export function flattenObject(obj: JsonValue): FlattenedObject {
  const result: FlattenedObject = {};

  // Start flattening from root
  if (isPrimitive(obj)) {
    return { value: obj };
  }

  // Handle empty object/array at root
  if (Array.isArray(obj) && obj.length === 0) {
    return {};
  }
  if (isPlainObject(obj) && Object.keys(obj).length === 0) {
    return {};
  }

  function flatten(value: JsonValue, prefix: string): void {
    if (isPrimitive(value)) {
      result[prefix] = value;
      return;
    }

    if (Array.isArray(value)) {
      flattenArray(value, prefix, result, flatten);
      return;
    }

    if (isPlainObject(value)) {
      flattenPlainObject(value, prefix, result, flatten);
      return;
    }

    result[prefix] = String(value);
  }

  flatten(obj, "");
  return result;
}

/**
 * Flattens an array of objects, ensuring all objects have the same keys.
 * Missing keys in individual objects are filled with null.
 *
 * @param objects - Array of objects to flatten
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
export function flattenObjectArray(objects: JsonValue[]): FlattenedObject[] {
  if (objects.length === 0) {
    return [];
  }

  // First pass: flatten all objects and collect all keys
  const flattenedObjects = objects.map((obj) => flattenObject(obj));
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
      normalized[key] = key in obj ? (obj[key] ?? null) : null;
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
