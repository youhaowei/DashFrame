# @dashframe/connector-csv

CSV file connector for DashFrame. Parses CSV files and converts them to DataFrames with automatic type inference.

## Installation

```bash
pnpm add @dashframe/connector-csv
```

## Overview

This package provides:

- `csvToDataFrame()` - Core conversion function from CSV data to DataFrame
- `CSVConnector` - File source connector class following the connector pattern
- Built-in CSV parser with support for quoted fields and various line endings

**Features:**

- Automatic type inference (number, boolean, date, string)
- Arrow IPC storage in IndexedDB
- Auto-detection of ID columns for primary key
- Computed `_rowIndex` field for row identification

## Usage

### Direct Conversion

```typescript
import { csvToDataFrame } from "@dashframe/connector-csv";

// CSV data as 2D array (headers + rows)
const csvData = [
  ["name", "age", "active"],
  ["Alice", "30", "true"],
  ["Bob", "25", "false"],
];

const result = await csvToDataFrame(csvData, dataTableId);

// Result contains:
// - dataFrame: DataFrame instance (stored in IndexedDB)
// - fields: Field[] with auto-generated UUIDs
// - sourceSchema: Column metadata with inferred types
// - rowCount: Number of data rows
// - columnCount: Number of columns
```

### Using the Connector Pattern

```typescript
import { csvConnector } from "@dashframe/connector-csv";

// In a file upload handler
async function handleFileUpload(file: File, tableId: string) {
  const result = await csvConnector.parse(file, tableId);

  return {
    dataFrame: result.dataFrame,
    fields: result.fields,
    sourceSchema: result.sourceSchema,
  };
}
```

### Connector Metadata

```typescript
import { csvConnector } from "@dashframe/connector-csv";

console.log(csvConnector.id); // "csv"
console.log(csvConnector.name); // "CSV File"
console.log(csvConnector.accept); // ".csv,text/csv"
console.log(csvConnector.maxSizeMB); // 100
console.log(csvConnector.helperText); // "Supports .csv files up to 100MB (stored locally)"
```

## Type Inference

The connector automatically infers column types from sample values:

| Sample Value        | Inferred Type |
| ------------------- | ------------- |
| `"123"`, `"45.67"`  | `number`      |
| `"true"`, `"false"` | `boolean`     |
| `"2024-01-15"`      | `date`        |
| `"hello"`           | `string`      |
| empty/undefined     | `unknown`     |

## Generated Fields

For each CSV file, the connector generates:

1. **`_rowIndex`** - System computed field (number, identifier)
   - Used as primary key if no ID column detected
   - Excluded from visualization suggestions

2. **User columns** - One field per CSV header
   - UUID-based references for formula stability
   - Linked to source column via `columnName`

## Primary Key Detection

The connector auto-detects ID columns by pattern matching:

- `id`, `ID`, `Id`, `_id`, `_ID` → Uses as primary key
- No match → Falls back to `_rowIndex`

## CSV Parser

Built-in parser handles:

- Quoted fields with commas
- Escaped quotes (`""` → `"`)
- Windows (`\r\n`), Unix (`\n`), and old Mac (`\r`) line endings
- Empty rows (filtered out)

```typescript
// Internal parser function (also exported)
const rows = parseCSV('name,value\n"a,b",123\n');
// [["name", "value"], ["a,b", "123"]]
```

## Conversion Result

```typescript
interface CSVConversionResult {
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
  csvToDataFrame,
  type CSVData,
  type CSVConversionResult,
} from "./index";

// Connector pattern
export { CSVConnector, csvConnector } from "./connector";
```

## See Also

- `@dashframe/engine` - Connector base classes (`FileSourceConnector`)
- `@dashframe/engine-browser` - DataFrame implementation
- `@dashframe/connector-notion` - Notion API connector
