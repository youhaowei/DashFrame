import { csvToDataFrame } from "@dashframe/csv";
import { useDataSourcesStore } from "@/lib/stores/data-sources-store";
import { useDataFramesStore } from "@/lib/stores/dataframes-store";
import type { Metric, FileParseResult } from "@dashframe/dataframe";

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
 * Handle CSV upload using local Zustand stores (no Convex, no auth required)
 *
 * Flow:
 * 1. Ensure "Local Files" data source exists in local store
 * 2. Parse CSV → DataFrame (stored in IndexedDB via Arrow IPC)
 * 3. Add DataTable to local data source
 * 4. Store DataFrame reference in dataframes store
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
  // 1. Ensure local data source exists
  let dataSource = useDataSourcesStore.getState().getLocal();
  if (!dataSource) {
    useDataSourcesStore.getState().addLocal("Local Files");
    dataSource = useDataSourcesStore.getState().getLocal();

    if (!dataSource) {
      throw new Error("Failed to create local data source");
    }
  }

  const tableName = file.name.replace(/\.csv$/i, "");
  const overrideTable = options?.overrideTableId
    ? dataSource.dataTables.get(options.overrideTableId)
    : undefined;
  const dataTableId = options?.overrideTableId ?? crypto.randomUUID();

  // 2. Convert CSV to DataFrame (data stored in IndexedDB)
  const { dataFrame, fields, sourceSchema, rowCount, columnCount } =
    await csvToDataFrame(csvData, dataTableId);

  let dataFrameId: string;

  if (overrideTable) {
    // 3a. Override existing table instead of creating a new one
    const metrics = ensureCountMetric(overrideTable.metrics, dataTableId);

    useDataSourcesStore.getState().updateDataTable(dataSource.id, dataTableId, {
      name: tableName,
      table: file.name,
      sourceSchema,
      fields,
      metrics,
    });

    // Update or create linked DataFrame
    if (overrideTable.dataFrameId) {
      // Replace the DataFrame data (delete old Arrow data, store new)
      await useDataFramesStore
        .getState()
        .replaceDataFrame(overrideTable.dataFrameId, dataFrame, {
          rowCount,
          columnCount,
        });
      dataFrameId = overrideTable.dataFrameId;
    } else {
      // Create new DataFrame entry
      dataFrameId = useDataFramesStore.getState().addDataFrame(dataFrame, {
        name: tableName,
        rowCount,
        columnCount,
      });
    }

    // Ensure the DataTable points to the updated DataFrame
    useDataSourcesStore
      .getState()
      .updateDataTable(dataSource.id, dataTableId, { dataFrameId });
  } else {
    // 3b. Add DataTable to local store
    useDataSourcesStore
      .getState()
      .addDataTable(dataSource.id, tableName, file.name, {
        id: dataTableId,
        sourceSchema,
        fields,
      });

    // 4. Create DataFrame entry in dataframes store
    dataFrameId = useDataFramesStore.getState().addDataFrame(dataFrame, {
      name: tableName,
      rowCount,
      columnCount,
    });

    // 5. Link DataFrame to DataTable
    useDataSourcesStore
      .getState()
      .updateDataTable(dataSource.id, dataTableId, { dataFrameId });
  }

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
  const { dataFrame, fields, sourceSchema, rowCount, columnCount } =
    parseResult;

  // 1. Ensure local data source exists
  let dataSource = useDataSourcesStore.getState().getLocal();
  if (!dataSource) {
    useDataSourcesStore.getState().addLocal("Local Files");
    dataSource = useDataSourcesStore.getState().getLocal();

    if (!dataSource) {
      throw new Error("Failed to create local data source");
    }
  }

  const tableName = fileName.replace(/\.(csv|xlsx?|json)$/i, "");
  const overrideTable = options?.overrideTableId
    ? dataSource.dataTables.get(options.overrideTableId)
    : undefined;
  const dataTableId = options?.overrideTableId ?? dataFrame.id;

  let dataFrameId: string;

  if (overrideTable) {
    // Override existing table
    const metrics = ensureCountMetric(overrideTable.metrics, dataTableId);

    useDataSourcesStore.getState().updateDataTable(dataSource.id, dataTableId, {
      name: tableName,
      table: fileName,
      sourceSchema,
      fields,
      metrics,
    });

    // Update or create linked DataFrame
    if (overrideTable.dataFrameId) {
      await useDataFramesStore
        .getState()
        .replaceDataFrame(overrideTable.dataFrameId, dataFrame, {
          rowCount,
          columnCount,
        });
      dataFrameId = overrideTable.dataFrameId;
    } else {
      dataFrameId = useDataFramesStore.getState().addDataFrame(dataFrame, {
        name: tableName,
        rowCount,
        columnCount,
      });
    }

    useDataSourcesStore
      .getState()
      .updateDataTable(dataSource.id, dataTableId, { dataFrameId });
  } else {
    // Add new DataTable
    useDataSourcesStore
      .getState()
      .addDataTable(dataSource.id, tableName, fileName, {
        id: dataTableId,
        sourceSchema,
        fields,
      });

    // Create DataFrame entry
    dataFrameId = useDataFramesStore.getState().addDataFrame(dataFrame, {
      name: tableName,
      rowCount,
      columnCount,
    });

    // Link DataFrame to DataTable
    useDataSourcesStore
      .getState()
      .updateDataTable(dataSource.id, dataTableId, { dataFrameId });
  }

  return { dataTableId, dataFrameId, dataSourceId: dataSource.id };
}
