# @dashframe/csv

CSV parsing and conversion utilities for DashFrame. Parses CSV text and emits Arrow IPC plus structural metadata with automatic type inference.

## Installation

```bash
bun add @dashframe/csv
```

## Overview

This package provides:

- `parseCSV()` - Parse CSV text into 2D array
- `csvToDataFrame()` - Convert parsed CSV to Arrow IPC with type inference

**Features:**

- Automatic type inference (number, boolean, date, string)
- Quoted field support with escaped quotes
- Multiple line ending formats (Windows, Unix, Mac)
- Arrow IPC output for the server-owned local ingestion path
- Auto-detection of ID columns for primary key

## Usage

### Parse CSV Text

```typescript
import { parseCSV } from "@dashframe/csv";

const text = `name,age,active
Alice,30,true
Bob,25,false`;

const rows = parseCSV(text);
// [["name", "age", "active"], ["Alice", "30", "true"], ["Bob", "25", "false"]]
```

### CSV to DataFrame

```typescript
import { parseCSV, csvToDataFrame } from "@dashframe/csv";

const rows = parseCSV(csvText);
const result = await csvToDataFrame(rows, dataTableId);
// result.arrowBuffer, result.fields, result.sourceSchema, result.primaryKey
```

## CSV Parser Features

- Quoted fields with commas: `"a,b"` → `a,b`
- Escaped quotes: `""` → `"`
- Windows (`\r\n`), Unix (`\n`), Mac (`\r`) line endings
- Empty rows filtered out

## Type Inference

| Sample Value        | Inferred Type |
| ------------------- | ------------- |
| `"123"`, `"45.67"`  | `number`      |
| `"true"`, `"false"` | `boolean`     |
| `"2024-01-15"`      | `date`        |
| `"hello"`           | `string`      |
| empty               | `unknown`     |

## Exports

```typescript
// Parsing
export { parseCSV } from "./parser";

// Conversion
export { csvToDataFrame, type CSVConversionResult } from "./index";
```

## See Also

- `@dashframe/json` - JSON parsing utilities
- `@dashframe/connector-local` - Unified file connector (uses this package)
- `@dashframe/engine-server` - Server-owned DataFrame persistence and querying
