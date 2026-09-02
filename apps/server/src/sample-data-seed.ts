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

const seedQueues = new WeakMap<
  object,
  Map<UUID, Promise<SeedCsvTableResult>>
>();

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

  return enqueueSeed(application, dataTableId, () =>
    seedObservedTable(application, {
      context,
      tableName,
      tableBinding,
      dataTableId,
      arrowBuffer,
      primaryKey,
      fields,
      sourceSchema,
    }),
  );
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
  const source = (await application.execute(
    "getDataSource",
    { id: SAMPLE_SOURCE_ID },
    input.context,
  )) as DataSource | null;
  if (source && source.type !== "local") {
    throw new Error(
      "Sample data source ID is already used by another connector",
    );
  }

  const table = (await application.execute(
    "getDataTable",
    { id: input.dataTableId },
    input.context,
  )) as DataTable | null;
  if (table && table.dataSourceId !== SAMPLE_SOURCE_ID) {
    throw new Error("Sample table ID is already used by another data source");
  }
  const current = await matchingFrame(application, table, input, source);
  if (current) return current;

  if (!source) {
    await application.execute(
      "createDataSource",
      {
        id: SAMPLE_SOURCE_ID,
        type: "local",
        name: SAMPLE_SOURCE_NAME,
      },
      { ...input.context, operationId: randomUUID() },
    );
  }

  const countMetric: Metric = {
    id: deterministicUuid(`sample-metric:${input.tableName}:count`),
    name: "Count",
    tableId: input.dataTableId,
    aggregation: "count",
  };
  if (!table) {
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
  }

  const imported = (await application.execute(
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

  return {
    dataSourceId: SAMPLE_SOURCE_ID,
    dataTableId: input.dataTableId,
    dataFrameId: imported.dataFrameId,
    rowCount: imported.rowCount,
    columnCount: imported.columnCount,
  };
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

function enqueueSeed(
  application: object,
  dataTableId: UUID,
  seed: () => Promise<SeedCsvTableResult>,
): Promise<SeedCsvTableResult> {
  let queues = seedQueues.get(application);
  if (!queues) {
    queues = new Map();
    seedQueues.set(application, queues);
  }
  const current = (queues.get(dataTableId) ?? Promise.resolve())
    .catch(() => undefined)
    .then(seed);
  queues.set(dataTableId, current);
  const cleanup = () => {
    if (queues.get(dataTableId) === current) queues.delete(dataTableId);
  };
  current.then(cleanup, cleanup);
  return current;
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
