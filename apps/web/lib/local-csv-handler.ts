import { csvToDataFrame } from "@dashframe/connector-csv";
import { db, getDataSourceByType, getDataTable } from "@dashframe/core";
import type { FileParseResult } from "@dashframe/engine";
import type { BrowserDataFrame } from "@dashframe/engine-browser";
import { deleteArrowData } from "@dashframe/engine-browser";
import type { Metric } from "@dashframe/types";

const ensureCountMetric = (
  existing: Metric[] = [],
  tableId: string,
): Metric[] => {
  const hasCount = existing.some(
    (metric) => metric.aggregation === "count" && !metric.columnName,
  );

  if (hasCount) return existing;

  return [
    {
      id: crypto.randomUUID(),
      name: "Count",
      tableId,
      columnName: undefined,
      aggregation: "count",
    },
    ...existing,
  ];
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
 * Handle CSV upload using Dexie database (no Convex, no auth required)
 *
 * Flow:
 * 1. Ensure "Local Files" data source exists in Dexie
 * 2. Parse CSV → DataFrame (stored in IndexedDB via Arrow IPC)
 * 3. Add DataTable to local data source
 * 4. Store DataFrame reference in Dexie
 * 5. Link DataFrame to DataTable
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
  // 1. Ensure local data source exists (uses "csv" connector type)
  let dataSource = await getDataSourceByType("csv");
  if (!dataSource) {
    const id = crypto.randomUUID();
    await db.dataSources.add({
      id,
      type: "csv",
      name: "Local Files",
      createdAt: Date.now(),
    });
    dataSource = await getDataSourceByType("csv");
    if (!dataSource) {
      throw new Error("Failed to create local data source");
    }
  }

  const tableName = file.name.replace(/\.csv$/i, "");
  const dataTableId = options?.overrideTableId ?? crypto.randomUUID();
  const overrideTable = options?.overrideTableId
    ? await getDataTable(options.overrideTableId)
    : undefined;

  // 2. Convert CSV to DataFrame (data stored in IndexedDB)
  const { dataFrame, fields, sourceSchema, rowCount, columnCount } =
    await csvToDataFrame(csvData, dataTableId);

  let dataFrameId: string;

  if (overrideTable) {
    // 3a. Override existing table instead of creating a new one
    const metrics = ensureCountMetric(overrideTable.metrics, dataTableId);

    await db.dataTables.update(dataTableId, {
      name: tableName,
      table: file.name,
      sourceSchema,
      fields,
      metrics,
    });

    // Update or create linked DataFrame
    if (overrideTable.dataFrameId) {
      // Replace the DataFrame data (delete old Arrow data, store new)
      const oldEntity = await db.dataFrames.get(overrideTable.dataFrameId);
      if (oldEntity?.storage?.type === "indexeddb") {
        await deleteArrowData(oldEntity.storage.key);
      }

      const newSerialization = dataFrame.toJSON();
      await db.dataFrames.update(overrideTable.dataFrameId, {
        storage: newSerialization.storage,
        fieldIds: newSerialization.fieldIds,
        primaryKey: newSerialization.primaryKey,
        createdAt: newSerialization.createdAt,
        rowCount,
        columnCount,
      });
      dataFrameId = overrideTable.dataFrameId;
    } else {
      // Create new DataFrame entry
      const serialization = dataFrame.toJSON();
      await db.dataFrames.add({
        ...serialization,
        name: tableName,
        rowCount,
        columnCount,
      });
      dataFrameId = dataFrame.id;
    }

    // Ensure the DataTable points to the updated DataFrame
    await db.dataTables.update(dataTableId, { dataFrameId });
  } else {
    // 3b. Add DataTable to Dexie
    const defaultMetrics: Metric[] = [
      {
        id: crypto.randomUUID(),
        name: "Count",
        tableId: dataTableId,
        columnName: undefined,
        aggregation: "count",
      },
    ];

    await db.dataTables.add({
      id: dataTableId,
      dataSourceId: dataSource.id,
      name: tableName,
      table: file.name,
      sourceSchema,
      fields,
      metrics: defaultMetrics,
      createdAt: Date.now(),
    });

    // 4. Create DataFrame entry in Dexie
    const serialization = dataFrame.toJSON();
    await db.dataFrames.add({
      ...serialization,
      name: tableName,
      rowCount,
      columnCount,
    });
    dataFrameId = dataFrame.id;

    // 5. Link DataFrame to DataTable
    await db.dataTables.update(dataTableId, { dataFrameId });
  }

  // Note: Column analysis is run lazily in InsightView when first needed
  // This keeps upload fast and defers expensive DuckDB queries

  return { dataTableId, dataFrameId, dataSourceId: dataSource.id };
}

/**
 * Handle file connector result - stores a pre-converted DataFrame
 *
 * Use this when you have a FileParseResult from a connector's parse() method.
 * Unlike handleLocalCSVUpload which parses CSV data, this function works with
 * pre-converted DataFrame results from any file connector (CSV, Excel, etc.)
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
  const { fields, sourceSchema, rowCount, columnCount } = parseResult;
  // In browser context, all DataFrames are BrowserDataFrame instances
  const dataFrame = parseResult.dataFrame as BrowserDataFrame;

  // 1. Ensure local data source exists (uses "csv" connector type)
  let dataSource = await getDataSourceByType("csv");
  if (!dataSource) {
    const id = crypto.randomUUID();
    await db.dataSources.add({
      id,
      type: "csv",
      name: "Local Files",
      createdAt: Date.now(),
    });
    dataSource = await getDataSourceByType("csv");
    if (!dataSource) {
      throw new Error("Failed to create local data source");
    }
  }

  const tableName = fileName.replace(/\.(csv|xlsx?|json)$/i, "");
  const dataTableId = options?.overrideTableId ?? dataFrame.id;
  const overrideTable = options?.overrideTableId
    ? await getDataTable(options.overrideTableId)
    : undefined;

  let dataFrameId: string;

  if (overrideTable) {
    // Override existing table
    const metrics = ensureCountMetric(overrideTable.metrics, dataTableId);

    await db.dataTables.update(dataTableId, {
      name: tableName,
      table: fileName,
      sourceSchema,
      fields,
      metrics,
    });

    // Update or create linked DataFrame
    if (overrideTable.dataFrameId) {
      const oldEntity = await db.dataFrames.get(overrideTable.dataFrameId);
      if (oldEntity?.storage?.type === "indexeddb") {
        await deleteArrowData(oldEntity.storage.key);
      }

      const newSerialization = dataFrame.toJSON();
      await db.dataFrames.update(overrideTable.dataFrameId, {
        storage: newSerialization.storage,
        fieldIds: newSerialization.fieldIds,
        primaryKey: newSerialization.primaryKey,
        createdAt: newSerialization.createdAt,
        rowCount,
        columnCount,
      });
      dataFrameId = overrideTable.dataFrameId;
    } else {
      const serialization = dataFrame.toJSON();
      await db.dataFrames.add({
        ...serialization,
        name: tableName,
        rowCount,
        columnCount,
      });
      dataFrameId = dataFrame.id;
    }

    await db.dataTables.update(dataTableId, { dataFrameId });
  } else {
    // Add new DataTable
    const defaultMetrics: Metric[] = [
      {
        id: crypto.randomUUID(),
        name: "Count",
        tableId: dataTableId,
        columnName: undefined,
        aggregation: "count",
      },
    ];

    await db.dataTables.add({
      id: dataTableId,
      dataSourceId: dataSource.id,
      name: tableName,
      table: fileName,
      sourceSchema,
      fields,
      metrics: defaultMetrics,
      createdAt: Date.now(),
    });

    // Create DataFrame entry
    const serialization = dataFrame.toJSON();
    await db.dataFrames.add({
      ...serialization,
      name: tableName,
      rowCount,
      columnCount,
    });
    dataFrameId = dataFrame.id;

    // Link DataFrame to DataTable
    await db.dataTables.update(dataTableId, { dataFrameId });
  }

  // Note: Column analysis is run lazily in InsightView when first needed
  // This keeps upload fast and defers expensive DuckDB queries

  return { dataTableId, dataFrameId, dataSourceId: dataSource.id };
}
