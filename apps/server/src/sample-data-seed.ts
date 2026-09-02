import { createHash } from "node:crypto";

import { csvToDataFrame, parseCSV } from "@dashframe/csv";
import type { Principal } from "@wystack/identity";
import type { Metric, UUID } from "@dashframe/types";

import type { ApplicationOperations } from "./host/application";

const SAMPLE_SOURCE_ID = deterministicUuid("sample-source");
const SAMPLE_SOURCE_NAME = "Sample E-commerce";

export interface SeedCsvTableInput {
  csvContent: string;
  tableName: string;
}

export interface SeedCsvTableOptions {
  /** Required for an unbound application; omit for application.forPrincipal(...). */
  principal?: Principal;
}

export interface SeedCsvTableResult {
  dataSourceId: UUID;
  dataTableId: UUID;
  dataFrameId: UUID;
  rowCount: number;
  columnCount: number;
}

interface LocalIngestResult {
  dataFrameId: UUID;
  rowCount: number;
  columnCount: number;
}

/**
 * Seed one CSV-backed local table through the same project application boundary
 * used by connector setup. Stable IDs make identical retries converge on the
 * existing source, table, and immutable frame instead of creating duplicates.
 */
export async function seedCsvTable(
  application: Pick<ApplicationOperations, "execute">,
  input: SeedCsvTableInput,
  options: SeedCsvTableOptions = {},
): Promise<SeedCsvTableResult> {
  const tableName = input.tableName.trim();
  if (!tableName) throw new Error("Sample table name is required");

  const parsed = parseCSV(input.csvContent);
  if (parsed.length < 2) throw new Error("Sample CSV must include data rows");

  const dataTableId = deterministicUuid(`sample-table:${tableName}`);
  const metricId = deterministicUuid(`sample-metric:${tableName}:count`);
  const importOperationId = deterministicUuid(`sample-import:${tableName}`);
  const { arrowBuffer, primaryKey, fields, sourceSchema } =
    await csvToDataFrame(parsed, dataTableId);
  const context = options.principal
    ? { principal: options.principal }
    : undefined;

  await application.execute(
    "createDataSource",
    {
      id: SAMPLE_SOURCE_ID,
      type: "local",
      name: SAMPLE_SOURCE_NAME,
    },
    { ...context, operationId: SAMPLE_SOURCE_ID },
  );

  const countMetric: Metric = {
    id: metricId,
    name: "Count",
    tableId: dataTableId,
    aggregation: "count",
  };
  await application.execute(
    "createDataTable",
    {
      id: dataTableId,
      dataSourceId: SAMPLE_SOURCE_ID,
      name: tableName,
      table: `${tableName}.csv`,
      sourceSchema,
      fields,
      metrics: [countMetric],
    },
    { ...context, operationId: dataTableId },
  );

  const imported = (await application.execute(
    "ingestLocalDataFrame",
    {
      dataTableId,
      arrowBase64: Buffer.from(arrowBuffer).toString("base64"),
      ...(primaryKey ? { primaryKey } : {}),
      operationId: importOperationId,
    },
    context,
  )) as LocalIngestResult;

  return {
    dataSourceId: SAMPLE_SOURCE_ID,
    dataTableId,
    dataFrameId: imported.dataFrameId,
    rowCount: imported.rowCount,
    columnCount: imported.columnCount,
  };
}

function deterministicUuid(key: string): UUID {
  const bytes = createHash("sha256")
    .update(`dashframe:sample-data:${key}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` as UUID;
}
