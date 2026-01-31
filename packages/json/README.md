# @dashframe/json

JSON parsing and conversion utilities for DashFrame. Converts JSON data to DataFrames with automatic type inference and nested object flattening.

## Installation

```bash
bun add @dashframe/json
```

## Overview

This package provides:

- `jsonToDataFrame()` - Convert JSON data to DataFrame with type inference
- `flattenObject()` / `flattenObjectArray()` - Flatten nested JSON to dot-notation
- `unflattenObject()` - Reverse flattening operation

**Features:**

- Automatic type inference (number, boolean, date, string)
- Nested object flattening (e.g., `user.address.city`)
- Array-of-objects JSON support
- Arrow IPC storage in IndexedDB
- Auto-detection of ID columns for primary key

## Usage

### JSON to DataFrame

```typescript
import { jsonToDataFrame } from "@dashframe/json";

const jsonData = [
  { name: "Alice", age: 30, active: true },
  { name: "Bob", age: 25, active: false },
];

const result = await jsonToDataFrame(jsonData, dataTableId);
// result.dataFrame, result.fields, result.sourceSchema
```

### Nested Object Flattening

```typescript
import { flattenObject, flattenObjectArray } from "@dashframe/json";

// Flatten single object
flattenObject({ user: { name: "Alice", address: { city: "NYC" } } });
// { "user.name": "Alice", "user.address.city": "NYC" }

// Flatten array with consistent keys
flattenObjectArray([
  { user: { name: "Alice" } },
  { user: { name: "Bob", age: 25 } },
]);
// [{ "user.name": "Alice", "user.age": null }, { "user.name": "Bob", "user.age": 25 }]
```

### Flatten Options

```typescript
flattenObject(data, {
  maxDepth: 2,              // Limit nesting depth
  separator: "_",           // Use underscore: user_name
  arrayHandling: "stringify" // Arrays become JSON strings
});
```

## Type Inference

| Sample Value       | Inferred Type |
| ------------------ | ------------- |
| `123`, `45.67`     | `number`      |
| `true`, `false`    | `boolean`     |
| `"2024-01-15"`     | `date`        |
| `"hello"`          | `string`      |
| `null`             | `unknown`     |

## Exports

```typescript
// Conversion
export { jsonToDataFrame, type JSONData, type JSONConversionResult } from "./index";

// Flatten utilities
export {
  flattenObject,
  flattenObjectArray,
  extractKeys,
  unflattenObject,
  type FlattenOptions,
  type FlattenedObject,
  type JsonValue,
  type JsonPrimitive,
} from "./flatten";
```

## See Also

- `@dashframe/csv` - CSV parsing utilities
- `@dashframe/connector-local` - Unified file connector (uses this package)
- `@dashframe/engine-browser` - DataFrame implementation
