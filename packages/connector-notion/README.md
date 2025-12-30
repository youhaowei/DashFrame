# @dashframe/connector-notion

Notion API connector for DashFrame. Connects to Notion workspaces, fetches database schemas, and converts data to DataFrames.

## Installation

```bash
bun add @dashframe/connector-notion
```

## Overview

This package provides:

- `NotionConnector` - Remote API connector class following the connector pattern
- `fetchNotionDatabases()` - List accessible databases
- `fetchNotionDatabaseSchema()` - Get database schema
- `notionToDataFrame()` - Convert Notion data to DataFrame
- Type mapping from Notion property types to DashFrame column types

**CORS Note:** Notion API blocks browser requests. These methods must be called through a server-side proxy (tRPC router, Next.js API route).

## Usage

### Using the Connector Pattern

```typescript
import { notionConnector } from "@dashframe/connector-notion";

// Get form fields for UI
const fields = notionConnector.getFormFields();
// [{ name: "apiKey", label: "API Key", type: "password", ... }]

// Validate user input
const validation = notionConnector.validate({ apiKey: "secret_..." });
// { valid: true } or { valid: false, errors: { apiKey: "..." } }

// Connect and list databases (via server proxy)
const databases = await notionConnector.connect({ apiKey: "secret_..." });
// [{ id: "...", name: "Tasks" }, ...]

// Query a database (via server proxy)
const result = await notionConnector.query(databaseId, tableId, {
  apiKey: "...",
});
// { dataFrame, fields }
```

### Direct API Functions

```typescript
import {
  fetchNotionDatabases,
  fetchNotionDatabaseSchema,
  notionToDataFrame,
  notionToDataFrameSample,
  generateFieldsFromNotionSchema,
} from "@dashframe/connector-notion";

// List databases
const databases = await fetchNotionDatabases(apiKey);

// Get schema
const schema = await fetchNotionDatabaseSchema(apiKey, databaseId);

// Generate fields from schema (discovery phase)
const { fields, sourceSchema } = generateFieldsFromNotionSchema(
  schema,
  tableId,
);

// Fetch full data
const result = await notionToDataFrame({ apiKey, databaseId }, fields);

// Fetch sample (100 rows)
const sample = await notionToDataFrameSample(
  { apiKey, databaseId },
  fields,
  100,
);
```

## Notion Type Mapping

| Notion Type                        | DashFrame Type |
| ---------------------------------- | -------------- |
| `number`                           | `number`       |
| `date`                             | `date`         |
| `checkbox`                         | `boolean`      |
| `title`, `rich_text`               | `string`       |
| `select`, `multi_select`           | `string`       |
| `url`, `email`, `phone_number`     | `string`       |
| `status`                           | `string`       |
| `created_time`, `last_edited_time` | `string`       |
| `people`, `files`, `relation`      | `string`       |
| `formula`, `rollup`                | varies         |

## Generated Fields

For each Notion database, the connector generates:

1. **`_rowIndex`** - System computed field (number, identifier)
   - Computed from array index
   - Excluded from visualization suggestions

2. **`_notionId`** - System computed field (string, identifier)
   - Notion page ID
   - Used as primary key

3. **User columns** - One field per Notion property
   - UUID-based references for formula stability
   - Native Notion types preserved in `sourceSchema`

## Conversion Result

```typescript
interface NotionConversionResult {
  /** Raw row data */
  rows: DataFrameRow[];

  /** Column definitions */
  columns: DataFrameColumn[];

  /** Arrow IPC buffer (base64 for JSON transport) */
  arrowBuffer: string;

  /** Field IDs for DataFrame creation */
  fieldIds: string[];

  /** Row count */
  rowCount: number;
}
```

## Property Value Extraction

The converter handles all Notion property types:

```typescript
import { extractPropertyValue } from "@dashframe/connector-notion/converter";

// Title → string
// Rich text → concatenated string
// Number → number | null
// Select → option name string
// Multi-select → comma-separated names
// Date → ISO date string
// Checkbox → boolean
// URL/Email/Phone → string | null
// Status → status name string
// People → comma-separated names
// Files → comma-separated file names
// Relation → comma-separated page IDs
// Formula → computed value
// Rollup → number or count
```

## Server Proxy Integration

Due to CORS, Notion API calls must go through a server:

```typescript
// apps/web/lib/trpc/routers/notion.ts
import {
  fetchNotionDatabases,
  fetchNotionDatabaseSchema,
  notionToDataFrame,
} from "@dashframe/connector-notion";

export const notionRouter = router({
  listDatabases: publicProcedure
    .input(z.object({ apiKey: z.string() }))
    .query(({ input }) => fetchNotionDatabases(input.apiKey)),

  getSchema: publicProcedure
    .input(z.object({ apiKey: z.string(), databaseId: z.string() }))
    .query(({ input }) =>
      fetchNotionDatabaseSchema(input.apiKey, input.databaseId),
    ),

  fetchData: publicProcedure
    .input(z.object({ apiKey: z.string(), databaseId: z.string() }))
    .mutation(async ({ input }) => {
      // Return raw data for client-side DataFrame creation
      return notionToDataFrame({ ...input }, fields);
    }),
});
```

## Exports

```typescript
// Connector pattern
export { NotionConnector, notionConnector } from "./connector";

// API functions
export {
  fetchNotionDatabases,
  fetchNotionDatabaseSchema,
  notionToDataFrame,
  notionToDataFrameSample,
  generateFieldsFromNotionSchema,
} from "./index";

// Types
export type {
  NotionDatabase,
  NotionProperty,
  NotionConversionResult,
  NotionConfig,
} from "./index";

// Utilities
export { mapNotionTypeToColumnType, extractPropertyValue } from "./converter";
```

## See Also

- `@dashframe/engine` - Connector base classes (`RemoteApiConnector`)
- `@dashframe/engine-browser` - DataFrame implementation
- `@dashframe/connector-csv` - CSV file connector
