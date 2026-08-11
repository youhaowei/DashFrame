import { ingestLocalDataFrame } from "@/lib/data-access/data-frames";
import { getOrCreateDataSourceByType } from "@/lib/data-access/data-sources";
import {
  createDataTable,
  getDataTable,
  updateDataTable,
} from "@/lib/data-access/data-tables";
import { csvToDataFrame } from "@dashframe/csv";
import type { FileParseResult } from "@dashframe/engine";
import type { Field, Metric } from "@dashframe/types";

/**
 * Build the default Count metric for a new DataTable.
 *
 * `CreateDataTable` is a PRIMITIVE — it does not auto-inject metrics.
 * Callers that want the default Count metric must pass it explicitly.
 * This helper produces the same shape that `withDefaultCountMetric` in
 * `app-artifacts.ts` used to inject, preserving the row-shape contract.
 */
function makeDefaultCountMetric(tableId: string): Metric {
  return {
    id: crypto.randomUUID(),
    name: "Count",
    tableId,
    columnName: undefined,
    aggregation: "count",
  };
}

const ensureCountMetric = (
  existing: Metric[] = [],
  tableId: string,
): Metric[] => {
  const hasCount = existing.some(
    (metric) => metric.aggregation === "count" && !metric.columnName,
  );

  if (hasCount) return existing;

  return [makeDefaultCountMetric(tableId), ...existing];
};

const retainReplacementMetrics = (
  metrics: Metric[],
  fields: Field[],
): Metric[] => {
  const columnNames = new Set(
    fields.flatMap((field) =>
      field.columnName === undefined ? [] : [field.columnName],
    ),
  );

  return metrics.filter(
    (metric) =>
      (metric.aggregation === "count" && !metric.columnName) ||
      (metric.columnName !== undefined && columnNames.has(metric.columnName)),
  );
};

/**
 * Keep stable field identities and confirmed-sensitive marks when a file-backed
 * table is replaced. Parsed fields provide the current schema; a column with
 * the same source column name retains its existing identity.
 */
const mergeReplacementFields = (
  fields: Field[],
  existingFields: Field[] = [],
): Field[] => {
  const existingFieldsByColumnName = new Map<string, Field[]>();
  const newFieldCountsByColumnName = new Map<string, number>();

  for (const existingField of existingFields) {
    if (existingField.columnName === undefined) continue;
    const matchingFields = existingFieldsByColumnName.get(
      existingField.columnName,
    );
    existingFieldsByColumnName.set(existingField.columnName, [
      ...(matchingFields ?? []),
      existingField,
    ]);
  }

  for (const field of fields) {
    if (field.columnName === undefined) continue;
    newFieldCountsByColumnName.set(
      field.columnName,
      (newFieldCountsByColumnName.get(field.columnName) ?? 0) + 1,
    );
  }

  return fields.map((field) => {
    if (
      field.columnName === undefined ||
      newFieldCountsByColumnName.get(field.columnName) !== 1
    ) {
      return field;
    }

    const matchingExistingFields = existingFieldsByColumnName.get(
      field.columnName,
    );
    const existingField = matchingExistingFields?.[0];
    if (!existingField || matchingExistingFields.length !== 1) return field;
    if (existingField.sensitivity === "sensitive") {
      return {
        ...field,
        id: existingField.id,
        sensitivity: existingField.sensitivity,
        sensitivityReason: existingField.sensitivityReason,
        sensitivitySource: existingField.sensitivitySource,
      };
    }

    return {
      ...field,
      id: existingField.id,
      ...(existingField.sensitivity === "cleared"
        ? {
            sensitivity: "unclassified" as const,
            sensitivityReason: undefined,
            sensitivitySource: undefined,
          }
        : {}),
    };
  });
};

/**
 * Local CSV Upload Result
 */
export interface LocalCSVResult {
  dataTableId: string;
  dataFrameId: string;
  dataSourceId: string;
}

/**
 * Handle CSV upload using the shared app-data layer.
 *
 * Flow:
 * 1. Ensure "Local Files" data source exists
 * 2. Parse CSV into Arrow IPC and structural metadata
 * 3. Add DataTable to local data source
 * 4. Persist a server-owned immutable frame and link it to the DataTable
 *
 * @param file - The CSV file object
 * @param csvData - Parsed CSV data (array of rows)
 * @param options - Optional override behavior for existing tables
 * @returns IDs for navigation and reference
 */
export async function handleLocalCSVUpload(
  file: File,
  csvData: string[][],
  options?: { overrideTableId?: string },
): Promise<LocalCSVResult> {
  // 1. Ensure local data source exists (uses "local" connector type)
  const dataSource = await getOrCreateDataSourceByType("local", "Local Files");

  const tableName = file.name.replace(/\.csv$/i, "");
  const dataTableId = options?.overrideTableId ?? crypto.randomUUID();
  const overrideTable = options?.overrideTableId
    ? await getDataTable(options.overrideTableId)
    : undefined;

  // 2. Convert CSV to Arrow IPC for the server-owned local ingest path.
  const { arrowBuffer, primaryKey, fields, sourceSchema } =
    await csvToDataFrame(csvData, dataTableId);

  if (overrideTable) {
    // 3a. Override existing table instead of creating a new one
    const replacementFields = mergeReplacementFields(
      fields,
      overrideTable.fields,
    );
    const metrics = retainReplacementMetrics(
      ensureCountMetric(overrideTable.metrics, dataTableId),
      replacementFields,
    );

    await updateDataTable(dataTableId, {
      name: tableName,
      table: file.name,
      sourceSchema,
      fields: replacementFields,
      metrics,
    });
  } else {
    // 3b. Create DataTable via the CreateDataTable command — PRIMITIVE path.
    // CreateDataTable does NOT auto-inject metrics, so we pass the default
    // Count metric explicitly here. This mirrors the shape that the legacy
    // `addDataTable` mutation produced via `withDefaultCountMetric`.
    await createDataTable({
      id: dataTableId,
      dataSourceId: dataSource.id,
      name: tableName,
      table: file.name,
      sourceSchema,
      fields,
      metrics: [makeDefaultCountMetric(dataTableId)],
    });
  }

  const { dataFrameId } = await ingestLocalDataFrame(
    dataTableId,
    arrowBuffer,
    primaryKey,
  );

  // Note: Column analysis is run lazily in InsightView when first needed
  // This keeps upload fast and defers expensive DuckDB queries

  return { dataTableId, dataFrameId, dataSourceId: dataSource.id };
}

/**
 * Handle file connector result - stores pre-converted Arrow IPC
 *
 * Use this when you have a FileParseResult from a connector's parse() method.
 * Unlike handleLocalCSVUpload which parses CSV data, this function works with
 * pre-converted results from any file connector (CSV, Excel, etc.)
 *
 * @param fileName - Original file name
 * @param parseResult - Result from connector.parse()
 * @param options - Optional override behavior for existing tables
 * @returns IDs for navigation and reference
 */
export async function handleFileConnectorResult(
  fileName: string,
  parseResult: FileParseResult,
  options?: { overrideTableId?: string },
): Promise<LocalCSVResult> {
  const { fields, sourceSchema, arrowBuffer, primaryKey } = parseResult;

  // 1. Ensure local data source exists (uses "local" connector type)
  const dataSource = await getOrCreateDataSourceByType("local", "Local Files");

  const tableName = fileName.replace(/\.(csv|xlsx?|json)$/i, "");
  const dataTableId = options?.overrideTableId ?? crypto.randomUUID();
  const overrideTable = options?.overrideTableId
    ? await getDataTable(options.overrideTableId)
    : undefined;

  if (overrideTable) {
    // Override existing table
    const replacementFields = mergeReplacementFields(
      fields,
      overrideTable.fields,
    );
    const metrics = retainReplacementMetrics(
      ensureCountMetric(overrideTable.metrics, dataTableId),
      replacementFields,
    );

    await updateDataTable(dataTableId, {
      name: tableName,
      table: fileName,
      sourceSchema,
      fields: replacementFields,
      metrics,
    });
  } else {
    // Create DataTable via the CreateDataTable command — PRIMITIVE path.
    // CreateDataTable does NOT auto-inject metrics, so we pass the default
    // Count metric explicitly here. This mirrors the shape that the legacy
    // `addDataTable` mutation produced via `withDefaultCountMetric`.
    await createDataTable({
      id: dataTableId,
      dataSourceId: dataSource.id,
      name: tableName,
      table: fileName,
      sourceSchema,
      fields,
      metrics: [makeDefaultCountMetric(dataTableId)],
    });
  }

  const { dataFrameId } = await ingestLocalDataFrame(
    dataTableId,
    arrowBuffer,
    primaryKey,
  );

  // Note: Column analysis is run lazily in InsightView when first needed
  // This keeps upload fast and defers expensive DuckDB queries

  return { dataTableId, dataFrameId, dataSourceId: dataSource.id };
}
