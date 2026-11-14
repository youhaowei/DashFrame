import { ingestLocalDataFrame } from "@/lib/data-access/data-frames";
import { getOrCreateDataSourceByType } from "@/lib/data-access/data-sources";
import {
  createDataTable,
  getDataTable,
  makeDefaultCountMetric,
} from "@/lib/data-access/data-tables";
import type { FileParseResult } from "@dashframe/engine";
import {
  mergeReplacementFields,
  retainReplacementMetrics,
  type Metric,
} from "@dashframe/types";

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

/**
 * Local CSV Upload Result
 */
export interface LocalCSVResult {
  dataTableId: string;
  dataFrameId: string;
  dataSourceId: string;
}

/**
 * Handle file connector result - stores pre-converted Arrow IPC
 *
 * Use this when you have a FileParseResult from a connector's parse() method.
 * It works with pre-converted results from any file connector (CSV, Excel,
 * etc.)
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

    const { dataFrameId } = await ingestLocalDataFrame(
      dataTableId,
      arrowBuffer,
      primaryKey,
      {
        expectedDataFrameId: overrideTable.dataFrameId ?? null,
        name: tableName,
        table: fileName,
        sourceSchema,
        fields: replacementFields,
        metrics,
      },
    );
    return { dataTableId, dataFrameId, dataSourceId: dataSource.id };
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
