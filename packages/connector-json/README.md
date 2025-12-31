# @dashframe/connector-json

JSON file connector for DashFrame. Parses JSON files and converts them to DataFrames with automatic type inference and nested object flattening.

## Installation

```bash
bun add @dashframe/connector-json
```

## Overview

This package provides:

- `jsonToDataFrame()` - Core conversion function from JSON data to DataFrame
- `JSONConnector` - File source connector class following the connector pattern
- Automatic flattening of nested objects using dot-notation keys

**Features:**

- Automatic type inference (number, boolean, date, string)
- Nested object flattening (e.g., `user.address.city`)
- Array-of-objects JSON support
- Arrow IPC storage in IndexedDB
- Auto-detection of ID columns for primary key
- Computed `_rowIndex` field for row identification

## Usage

### Direct Conversion

```typescript
import { jsonToDataFrame } from "@dashframe/connector-json";

// JSON data as array of objects
const jsonData = [
  { name: "Alice", age: 30, active: true },
  { name: "Bob", age: 25, active: false },
];

const result = await jsonToDataFrame(jsonData, dataTableId);

// Result contains:
// - dataFrame: DataFrame instance (stored in IndexedDB)
// - fields: Field[] with auto-generated UUIDs
// - sourceSchema: Column metadata with inferred types
// - rowCount: Number of data rows
// - columnCount: Number of columns
```

### Nested Object Flattening

```typescript
// Nested JSON data is automatically flattened
const nestedData = [
  {
    user: {
      name: "Alice",
      address: {
        city: "NYC",
        zip: "10001",
      },
    },
    active: true,
  },
];

// After flattening, columns become:
// - user.name
// - user.address.city
// - user.address.zip
// - active
```

### Using the Connector Pattern

```typescript
import { jsonConnector } from "@dashframe/connector-json";

// In a file upload handler
async function handleFileUpload(file: File, tableId: string) {
  const result = await jsonConnector.parse(file, tableId);

  return {
    dataFrame: result.dataFrame,
    fields: result.fields,
    sourceSchema: result.sourceSchema,
  };
}
```

### Connector Metadata

```typescript
import { jsonConnector } from "@dashframe/connector-json";

console.log(jsonConnector.id); // "json"
console.log(jsonConnector.name); // "JSON File"
console.log(jsonConnector.accept); // ".json,application/json"
console.log(jsonConnector.maxSizeMB); // 100
console.log(jsonConnector.helperText); // "Supports .json files up to 100MB (stored locally)"
```

## Supported JSON Formats

### Array of Objects (Recommended)

```json
[
  { "name": "Alice", "age": 30 },
  { "name": "Bob", "age": 25 }
]
```

### Nested Objects

```json
[
  {
    "user": { "name": "Alice" },
    "metadata": { "created": "2024-01-15" }
  }
]
```

Nested objects are flattened using dot-notation:

| Original Key             | Flattened Key        |
| ------------------------ | -------------------- |
| `user.name`              | `user.name`          |
| `metadata.created`       | `metadata.created`   |

## Type Inference

The connector automatically infers column types from sample values:

| Sample Value        | Inferred Type |
| ------------------- | ------------- |
| `123`, `45.67`      | `number`      |
| `true`, `false`     | `boolean`     |
| `"2024-01-15"`      | `date`        |
| `"hello"`           | `string`      |
| `null`/`undefined`  | `unknown`     |

## Generated Fields

For each JSON file, the connector generates:

1. **`_rowIndex`** - System computed field (number, identifier)
   - Used as primary key if no ID column detected
   - Excluded from visualization suggestions

2. **User columns** - One field per JSON key (after flattening)
   - UUID-based references for formula stability
   - Linked to source column via `columnName`

## Primary Key Detection

The connector auto-detects ID columns by pattern matching:

- `id`, `ID`, `Id`, `_id`, `_ID` -> Uses as primary key
- No match -> Falls back to `_rowIndex`

## Conversion Result

```typescript
interface JSONConversionResult {
  /** DataFrame class instance (data stored in IndexedDB) */
  dataFrame: DataFrame;

  /** Field definitions with UUIDs */
  fields: Field[];

  /** Source schema metadata */
  sourceSchema: SourceSchema;

  /** Row count for metadata */
  rowCount: number;

  /** Column count for metadata */
  columnCount: number;
}
```

## Exports

```typescript
// Core conversion
export {
  jsonToDataFrame,
  type JSONData,
  type JSONConversionResult,
} from "./index";

// Flattening utilities
export { flattenObject, flattenArray } from "./flatten";

// Connector pattern
export { JSONConnector, jsonConnector } from "./connector";
```

## See Also

- `@dashframe/engine` - Connector base classes (`FileSourceConnector`)
- `@dashframe/engine-browser` - DataFrame implementation
- `@dashframe/connector-csv` - CSV file connector
- `@dashframe/connector-notion` - Notion API connector
