import { createHash, randomUUID } from "node:crypto";

import { csvToDataFrame, parseCSV } from "@dashframe/csv";
import type { Principal } from "@wystack/identity";
import type { DataSource, DataTable, Metric, UUID } from "@dashframe/types";

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

interface ExistingFrame {
  id: UUID;
  rowCount?: number;
  columnCount?: number;
}

/**
 * Seed one CSV-backed local table through the same project application boundary
 * used by connector setup. Live metadata and a content-addressed source binding
 * make identical requests converge. Writes receive fresh operation IDs so a new
 * seed can follow a workspace clear without reusing an invalidated operation.
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
  const contentHash = createHash("sha256")
    .update(input.csvContent)
    .digest("hex");
  const tableBinding = `${tableName}.${contentHash}.csv`;
  const { arrowBuffer, primaryKey, fields, sourceSchema } =
    await csvToDataFrame(parsed, dataTableId);
  const context = options.principal
    ? { principal: options.principal }
    : undefined;

  return seedObservedTable(application, {
    context,
    tableName,
    tableBinding,
    dataTableId,
    arrowBuffer,
    primaryKey,
    fields,
    sourceSchema,
  });
}

async function seedObservedTable(
  application: Pick<ApplicationOperations, "execute">,
  input: {
    context: { principal: Principal } | undefined;
    tableName: string;
    tableBinding: string;
    dataTableId: UUID;
    arrowBuffer: Uint8Array;
    primaryKey?: string | string[];
    fields: DataTable["fields"];
    sourceSchema: NonNullable<DataTable["sourceSchema"]>;
  },
): Promise<SeedCsvTableResult> {
  let source = await readSampleSource(application, input.context);
  let table = await readSampleTable(
    application,
    input.dataTableId,
    input.context,
  );
  const current = await matchingFrame(application, table, input, source);
  if (current) return current;

  if (!source) {
    source = await createSourceOrObserveConflict(application, input.context);
  }

  const countMetric: Metric = {
    id: deterministicUuid(`sample-metric:${input.tableName}:count`),
    name: "Count",
    tableId: input.dataTableId,
    aggregation: "count",
  };
  if (!table) {
    table = await createTableOrObserveConflict(application, input, countMetric);
    const raced = await matchingFrame(application, table, input, source);
    if (raced) return raced;
  }

  let imported: LocalIngestResult;
  try {
    imported = (await application.execute(
      "ingestLocalDataFrame",
      {
        dataTableId: input.dataTableId,
        arrowBase64: Buffer.from(input.arrowBuffer).toString("base64"),
        ...(input.primaryKey ? { primaryKey: input.primaryKey } : {}),
        ...(table
          ? {
              replacement: {
                expectedDataFrameId: table.dataFrameId ?? null,
                name: input.tableName,
                table: input.tableBinding,
                sourceSchema: input.sourceSchema,
                fields: input.fields,
                metrics: [countMetric],
              },
            }
          : {}),
        operationId: randomUUID(),
      },
      input.context,
    )) as LocalIngestResult;
  } catch (error) {
    if (!isFramePublicationConflict(error)) throw error;
    const raced = await observeMatchingFrame(application, input, source);
    if (raced) return raced;
    throw error;
  }

  return {
    dataSourceId: SAMPLE_SOURCE_ID,
    dataTableId: input.dataTableId,
    dataFrameId: imported.dataFrameId,
    rowCount: imported.rowCount,
    columnCount: imported.columnCount,
  };
}

async function createSourceOrObserveConflict(
  application: Pick<ApplicationOperations, "execute">,
  context: { principal: Principal } | undefined,
): Promise<DataSource> {
  try {
    await application.execute(
      "createDataSource",
      {
        id: SAMPLE_SOURCE_ID,
        type: "local",
        name: SAMPLE_SOURCE_NAME,
      },
      { ...context, operationId: randomUUID() },
    );
  } catch (error) {
    if (!isOwnedCreateConflict(error, "dataSource", SAMPLE_SOURCE_ID)) {
      throw error;
    }
  }
  const source = await readSampleSource(application, context);
  if (!source) throw new Error("Sample data source missing after creation");
  return source;
}

async function createTableOrObserveConflict(
  application: Pick<ApplicationOperations, "execute">,
  input: {
    context: { principal: Principal } | undefined;
    tableName: string;
    tableBinding: string;
    dataTableId: UUID;
    fields: DataTable["fields"];
    sourceSchema: NonNullable<DataTable["sourceSchema"]>;
  },
  countMetric: Metric,
): Promise<DataTable | null> {
  try {
    await application.execute(
      "createDataTable",
      {
        id: input.dataTableId,
        dataSourceId: SAMPLE_SOURCE_ID,
        name: input.tableName,
        table: input.tableBinding,
        sourceSchema: input.sourceSchema,
        fields: input.fields,
        metrics: [countMetric],
      },
      { ...input.context, operationId: randomUUID() },
    );
    return null;
  } catch (error) {
    if (!isOwnedCreateConflict(error, "dataTable", input.dataTableId)) {
      throw error;
    }
    const table = await readSampleTable(
      application,
      input.dataTableId,
      input.context,
    );
    if (!table) throw error;
    return table;
  }
}

async function observeMatchingFrame(
  application: Pick<ApplicationOperations, "execute">,
  input: {
    context: { principal: Principal } | undefined;
    tableBinding: string;
    dataTableId: UUID;
  },
  source: DataSource,
): Promise<SeedCsvTableResult | null> {
  const table = await readSampleTable(
    application,
    input.dataTableId,
    input.context,
  );
  return matchingFrame(application, table, input, source);
}

async function readSampleSource(
  application: Pick<ApplicationOperations, "execute">,
  context: { principal: Principal } | undefined,
): Promise<DataSource | null> {
  const source = (await application.execute(
    "getDataSource",
    { id: SAMPLE_SOURCE_ID },
    context,
  )) as DataSource | null;
  if (source && source.type !== "local") {
    throw new Error(
      "Sample data source ID is already used by another connector",
    );
  }
  return source;
}

async function readSampleTable(
  application: Pick<ApplicationOperations, "execute">,
  dataTableId: UUID,
  context: { principal: Principal } | undefined,
): Promise<DataTable | null> {
  const table = (await application.execute(
    "getDataTable",
    { id: dataTableId },
    context,
  )) as DataTable | null;
  if (table && table.dataSourceId !== SAMPLE_SOURCE_ID) {
    throw new Error("Sample table ID is already used by another data source");
  }
  return table;
}

function isOwnedCreateConflict(
  error: unknown,
  kind: "dataSource" | "dataTable",
  id: UUID,
): boolean {
  return hasErrorMessage(error, `${kind} ${id} already exists`);
}

function isFramePublicationConflict(error: unknown): boolean {
  return (
    hasErrorMessage(error, "SOURCE_BINDING_CHANGED") ||
    hasErrorMessage(error, "STALE_LOCAL_REPLACEMENT")
  );
}

function hasErrorMessage(error: unknown, expected: string): boolean {
  const seen = new Set<Error>();
  let current = error;
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if (
      current.message === expected ||
      current.message
        .split("\n")
        .some((line) => line.trimEnd().endsWith(`Error: ${expected}`))
    ) {
      return true;
    }
    current = current.cause;
  }
  return false;
}

async function matchingFrame(
  application: Pick<ApplicationOperations, "execute">,
  table: DataTable | null,
  input: {
    context: { principal: Principal } | undefined;
    tableBinding: string;
    dataTableId: UUID;
  },
  source: DataSource | null,
): Promise<SeedCsvTableResult | null> {
  if (!source || table?.table !== input.tableBinding || !table.dataFrameId) {
    return null;
  }
  const frame = (await application.execute(
    "getDataFrameEntry",
    { id: table.dataFrameId },
    input.context,
  )) as ExistingFrame | null;
  if (!frame) return null;
  return {
    dataSourceId: SAMPLE_SOURCE_ID,
    dataTableId: input.dataTableId,
    dataFrameId: frame.id,
    rowCount: frame.rowCount ?? 0,
    columnCount: frame.columnCount ?? table.fields.length,
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
