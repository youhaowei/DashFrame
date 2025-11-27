import { csvToDataFrameWithFields } from "@dashframe/csv";
import { useDataSourcesStore } from "@/lib/stores/data-sources-store";
import { useDataFramesStore } from "@/lib/stores/dataframes-store";
import type { Metric } from "@dashframe/dataframe";

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
 * 2. Parse CSV → DataFrame with fields
 * 3. Add DataTable to local data source
 * 4. Store DataFrame in dataframes store
 * 5. Link DataFrame to DataTable
 *
 * @param file - The CSV file object
 * @param csvData - Parsed CSV data (array of rows)
 * @param options - Optional override behavior for existing tables
 * @returns IDs for navigation and reference
 */
export function handleLocalCSVUpload(
  file: File,
  csvData: string[][],
  options?: { overrideTableId?: string }
): LocalCSVResult {
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

  // 2. Convert CSV to DataFrame with fields (using the target table ID)
  const { dataFrame, fields, sourceSchema } = csvToDataFrameWithFields(
    csvData,
    dataTableId
  );

  // Helper: ensure a default count metric exists
  const ensureCountMetric = (existing: Metric[] = []): Metric[] => {
    const hasCount = existing.some(
      (metric) => metric.aggregation === "count" && !metric.columnName
    );

    if (hasCount) return existing;

    return [
      {
        id: crypto.randomUUID(),
        name: "Count",
        tableId: dataTableId,
        columnName: undefined,
        aggregation: "count",
      },
      ...existing,
    ];
  };

  let dataFrameId: string;

  if (overrideTable) {
    // 3a. Override existing table instead of creating a new one
    const metrics = ensureCountMetric(overrideTable.metrics);

    useDataSourcesStore.getState().updateDataTable(
      dataSource.id,
      dataTableId,
      {
        name: tableName,
        table: file.name,
        sourceSchema,
        fields,
        metrics,
      }
    );

    // Update or create linked DataFrame
    if (overrideTable.dataFrameId) {
      useDataFramesStore.getState().updateById(overrideTable.dataFrameId, dataFrame);
      dataFrameId = overrideTable.dataFrameId;
    } else {
      dataFrameId = useDataFramesStore
        .getState()
        .createFromCSV(dataSource.id, tableName, dataFrame);
    }

    // Ensure the DataTable points to the updated DataFrame
    useDataSourcesStore.getState().updateDataTable(
      dataSource.id,
      dataTableId,
      { dataFrameId }
    );
  } else {
    // 3b. Add DataTable to local store
    useDataSourcesStore.getState().addDataTable(
      dataSource.id,
      tableName,
      file.name,
      { id: dataTableId, sourceSchema, fields }
    );

    // 4. Create DataFrame in dataframes store
    dataFrameId = useDataFramesStore.getState().createFromCSV(
      dataSource.id,
      tableName,
      dataFrame
    );

    // 5. Link DataFrame to DataTable
    useDataSourcesStore.getState().updateDataTable(
      dataSource.id,
      dataTableId,
      { dataFrameId }
    );
  }

  return { dataTableId, dataFrameId, dataSourceId: dataSource.id };
}
