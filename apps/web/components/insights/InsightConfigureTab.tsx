/* eslint-disable @typescript-eslint/no-explicit-any -- Vega-Lite specs use dynamic types */
"use client";

import { useMemo, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { DataFrameColumn, DataFrameRow } from "@dashframe/dataframe";
import { useDataFramesStore } from "@/lib/stores/dataframes-store";
import { useDataSourcesStore } from "@/lib/stores/data-sources-store";
import { useVisualizationsStore } from "@/lib/stores/visualizations-store";
import { useInsightsStore } from "@/lib/stores/insights-store";
import { useStoreQuery } from "@/hooks/useStoreQuery";
import { useDataFrameData } from "@/hooks/useDataFrameData";
import { useDuckDB } from "@/components/providers/DuckDBProvider";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  Badge,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  Checkbox,
  ItemList,
  JoinTypeIcon,
  getJoinTypeLabel,
  VirtualTable,
  type VirtualTableColumnConfig,
  type ListItem,
} from "@dashframe/ui";
import { useDataFramePagination } from "@/hooks/useDataFramePagination";
import {
  LuDatabase,
  LuPlus,
  LuX,
  LuChevronDown,
  LuHash,
  LuCalculator,
} from "react-icons/lu";
import {
  computeInsightPreview,
  computeInsightDataFrame,
} from "@/lib/insights/compute-preview";
import type { PreviewResult } from "@/lib/insights/compute-preview";
import { suggestCharts } from "@/lib/visualizations/suggest-charts";
import type { ChartSuggestion } from "@/lib/visualizations/suggest-charts";
import { SuggestedInsights } from "@/components/visualization-preview/SuggestedInsights";
import { JoinFlowModal } from "@/components/visualizations/JoinFlowModal";
import type {
  Insight,
  DataTable,
  DataSource,
  InsightMetric,
} from "@/lib/stores/types";
import type { UUID, Field as LocalField, Metric, ColumnType } from "@dashframe/dataframe";
import { cleanTableNameForDisplay } from "@dashframe/dataframe";

/** Column-like structure used in preview tables */
type PreviewColumn = {
  id: string;
  name: string;
  columnName?: string;
  type: string;
  _isJoined?: boolean;
};

/**
 * Helper to check if a field ID matches a column name in join preview
 * Used to map selected field IDs to actual column names
 */
function matchFieldIdToColumn(
  fieldId: string,
  column: { name: string },
  fields: LocalField[],
  joinTableDetails: Array<{ joinFields: LocalField[] }>,
): boolean {
  const baseName = column.name.replace(/_base$/, "").replace(/_join$/, "");

  // Check base table fields
  const field = fields.find((f) => f.id === fieldId);
  if (field) {
    const fieldColName = field.columnName ?? field.name;
    return fieldColName === column.name || fieldColName === baseName;
  }

  // Check joined table fields
  for (const detail of joinTableDetails) {
    const joinField = detail.joinFields.find((f) => f.id === fieldId);
    if (joinField) {
      const joinFieldColName = joinField.columnName ?? joinField.name;
      return joinFieldColName === column.name || joinFieldColName === baseName;
    }
  }

  return false;
}

// Utility to format dates consistently
function formatDate(value: unknown): string | null {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!isNaN(parsed)) {
      const date = new Date(parsed);
      return date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    }
  }
  return null;
}

// Format cell value for display
function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  const dateStr = formatDate(value);
  if (dateStr) return dateStr;
  if (typeof value === "number") return value.toLocaleString();
  return String(value);
}

interface InsightConfigureTabProps {
  insightId: UUID;
  insight: Insight;
  dataTable: DataTable;
  fields: LocalField[];
  tableMetrics: Metric[];
  insightMetrics: InsightMetric[];
  dataSource: DataSource | null;
  isConfigured: boolean;
}

/**
 * Configure Tab Content
 *
 * Shows different content based on configuration state:
 * - Unconfigured: Data preview + chart suggestions (like current create-visualization)
 * - Configured: Field/metric/filter/join editor
 */
export function InsightConfigureTab({
  insightId,
  insight,
  dataTable,
  fields,
  tableMetrics: _tableMetrics, // Kept for future use
  insightMetrics,
  dataSource,
  isConfigured,
}: InsightConfigureTabProps) {
  const router = useRouter();

  // Local stores
  const getDataFrameEntry = useDataFramesStore((state) => state.getEntry);
  const createVisualizationLocal = useVisualizationsStore(
    (state) => state.create,
  );
  const updateInsightLocal = useInsightsStore((state) => state.updateInsight);

  // Load source DataFrame data asynchronously from IndexedDB
  // Use Infinity to load all rows - aggregations need complete data for accurate results
  const { data: sourceDataFrameData, isLoading: isLoadingSourceData } = useDataFrameData(
    dataTable?.dataFrameId,
    { limit: Infinity }
  );

  // Pagination hook for VirtualTable - enables efficient browsing of large datasets
  const {
    fetchData: fetchPreviewData,
    totalCount: previewTotalCount,
    isReady: isPreviewReady,
  } = useDataFramePagination(dataTable?.dataFrameId);

  // DuckDB connection for join computation
  const { connection: duckDBConnection, isInitialized: isDuckDBReady } = useDuckDB();
  const getDataFrame = useDataFramesStore((state) => state.getDataFrame);

  // Local state
  const [isJoinFlowOpen, setIsJoinFlowOpen] = useState(false);
  const [suggestionSeed, setSuggestionSeed] = useState(0);

  // State for DuckDB-computed joined data
  const [joinedPreviewData, setJoinedPreviewData] = useState<{
    rows: DataFrameRow[];
    columns: Array<{ name: string; type?: string; _isJoined?: boolean }>;
    totalCount: number;
  } | null>(null);
  const [isLoadingJoinedData, setIsLoadingJoinedData] = useState(false);

  // Data sources (for join metadata)
  const { data: dataSources } = useStoreQuery(useDataSourcesStore, (state) =>
    state.getAll(),
  );

  // All visible fields from the table (for unconfigured preview)
  const allTableFields = useMemo(() => {
    return fields.filter((f) => !f.name.startsWith("_"));
  }, [fields]);

  const baseFieldById = useMemo(() => {
    const map = new Map<UUID, LocalField>();
    fields.forEach((field) => map.set(field.id, field));
    return map;
  }, [fields]);

  // Helper to get source type label
  const getSourceTypeLabel = (type: string | undefined): string => {
    switch (type) {
      case "notion":
        return "Notion";
      case "local":
        return "CSV";
      case "postgresql":
        return "PostgreSQL";
      default:
        return "Unknown";
    }
  };

  // Resolve joined table metadata for display + chart ranking
  const joinTableDetails = useMemo(
    () =>
      (insight.joins ?? []).map((join) => {
        const sources = dataSources ?? [];
        let joinTable: DataTable | undefined;
        let joinSource: DataSource | undefined;

        for (const source of sources) {
          const candidate = source.dataTables.get(join.tableId);
          if (candidate) {
            joinTable = candidate;
            joinSource = source;
            break;
          }
        }

        const joinFields = (joinTable?.fields ?? []).filter(
          (field) => !field.name.startsWith("_"),
        );
        const baseField = baseFieldById.get(join.joinOn.baseField);
        const joinedField = joinFields.find(
          (field) => field.id === join.joinOn.joinedField,
        );

        // Get row count from DataFrame entry metadata if available
        const joinedDataFrameEntry = joinTable?.dataFrameId
          ? getDataFrameEntry(joinTable.dataFrameId)
          : undefined;
        const joinRowCount = joinedDataFrameEntry?.rowCount ?? 0;

        return {
          id: join.id,
          tableId: join.tableId,
          joinType: join.joinType,
          joinTable,
          joinSource,
          joinFields,
          baseFieldName:
            baseField?.name ?? baseField?.columnName ?? "Base field",
          joinedFieldName:
            joinedField?.name ?? joinedField?.columnName ?? "Joined field",
          tableName: joinTable?.name ?? "Joined table",
          rowCount: joinRowCount,
          fieldCount: joinFields.length,
          sourceType: getSourceTypeLabel(joinSource?.type),
        };
      }),
    [insight.joins, dataSources, baseFieldById, getDataFrameEntry],
  );

  // Fields to display in Join preview
  // Combines fields from base table + all joined tables
  const previewFields = useMemo(() => {
    // Start with base table fields
    const combined: Array<LocalField & { _isJoined?: boolean }> =
      allTableFields.map((f) => ({
        ...f,
        _isJoined: false,
      }));

    // Add fields from all joined tables
    if (insight.joins?.length && joinTableDetails.length > 0) {
      // Collect all joined fields into a flat array first
      const allJoinedFields = joinTableDetails.flatMap((join) =>
        join.joinFields.map((field: LocalField) => field),
      );
      // Then add non-duplicate fields to combined
      for (const field of allJoinedFields) {
        const fieldName = field.columnName ?? field.name;
        const exists = combined.some(
          (f) => (f.columnName ?? f.name) === fieldName,
        );
        if (!exists) {
          combined.push({
            ...field,
            _isJoined: true,
          });
        }
      }
    }

    return combined;
  }, [allTableFields, insight.joins, joinTableDetails]);

  // Effect to compute joined data using DuckDB when joins exist
  useEffect(() => {
    if (!insight.joins?.length) {
      setJoinedPreviewData(null);
      return;
    }

    if (!duckDBConnection || !isDuckDBReady) {
      return;
    }

    if (!dataTable?.dataFrameId) {
      return;
    }

    // Wait for base table to be loaded into DuckDB (via pagination hook)
    // This prevents "Table does not exist" errors from race conditions
    if (!isPreviewReady) {
      return;
    }

    const computeJoinedData = async () => {
      setIsLoadingJoinedData(true);

      // dataTable.dataFrameId is verified non-null by the guard above
      const baseDataFrameId = dataTable.dataFrameId!;

      try {
        // Base table should already be loaded by useDataFramePagination
        const baseDataFrame = getDataFrame(baseDataFrameId);
        if (!baseDataFrame) {
          console.error("Base DataFrame not found");
          setIsLoadingJoinedData(false);
          return;
        }

        // Base table is already loaded via useDataFramePagination (isPreviewReady guard)
        const baseTableName = `df_${baseDataFrameId.replace(/-/g, '_')}`;

        // Get base column names
        const baseColNames = fields
          .filter(f => !f.name.startsWith('_'))
          .map(f => f.columnName ?? f.name);

        // Process each join
        let currentTableSQL = baseTableName;
        const allJoinColNames = new Set<string>();

        // Get base table display name for column prefixing (cleaned of UUIDs)
        const baseDisplayName = cleanTableNameForDisplay(dataTable.name);

        for (const join of insight.joins ?? []) {
          const joinDetail = joinTableDetails.find(j => j.id === join.id);
          if (!joinDetail?.joinTable?.dataFrameId) continue;

          // Load join table into DuckDB
          const joinDataFrame = getDataFrame(joinDetail.joinTable.dataFrameId);
          if (!joinDataFrame) continue;

          // Load and trigger ensureLoaded() by calling sql() on the QueryBuilder
          const joinQueryBuilder = await joinDataFrame.load(duckDBConnection);
          await joinQueryBuilder.sql(); // This triggers the actual table creation in DuckDB
          const joinTableName = `df_${joinDetail.joinTable.dataFrameId.replace(/-/g, '_')}`;

          // Get join table display name for column prefixing (cleaned of UUIDs)
          const joinDisplayName = cleanTableNameForDisplay(joinDetail.joinTable.name);

          // Get join column info
          const baseField = fields.find(f => f.id === join.joinOn.baseField);
          const joinField = joinDetail.joinFields.find((f: LocalField) => f.id === join.joinOn.joinedField);

          if (!baseField || !joinField) continue;

          const leftColName = baseField.columnName ?? baseField.name;
          const rightColName = joinField.columnName ?? joinField.name;

          // Get column lists from join table
          const joinColNames = joinDetail.joinFields
            .filter((f: LocalField) => !f.name.startsWith('_'))
            .map((f: LocalField) => f.columnName ?? f.name);

          // Build SELECT clause with table name prefixes for duplicates
          const selectParts: string[] = [];

          for (const col of baseColNames) {
            const isDuplicate = joinColNames.includes(col) && col !== leftColName;
            if (isDuplicate) {
              // Use table name prefix: "accounts.acctid" instead of "acctid_base"
              selectParts.push(`base."${col}" AS "${baseDisplayName}.${col}"`);
            } else {
              selectParts.push(`base."${col}"`);
            }
          }

          // Build lowercase set of base column names for case-insensitive duplicate detection
          const baseColNamesLower = new Set(baseColNames.map(c => c.toLowerCase()));

          for (const col of joinColNames) {
            // Check for duplicate using case-insensitive comparison
            // DuckDB treats column names case-insensitively, so "acctId" and "acctid" conflict
            const isDuplicate = baseColNamesLower.has(col.toLowerCase());
            if (isDuplicate) {
              // Use table name prefix: "opportunities.acctid" instead of "acctid_1"
              const prefixedName = `${joinDisplayName}.${col}`;
              selectParts.push(`j."${col}" AS "${prefixedName}"`);
              allJoinColNames.add(prefixedName);
            } else {
              selectParts.push(`j."${col}"`);
              allJoinColNames.add(col);
            }
          }

          const joinTypeSQL = (join.joinType ?? 'inner').toUpperCase();

          currentTableSQL = `(
            SELECT ${selectParts.join(', ')}
            FROM ${currentTableSQL} AS base
            ${joinTypeSQL} JOIN ${joinTableName} AS j
            ON base."${leftColName}" = j."${rightColName}"
          )`;
        }

        // Get total count
        const countSQL = `SELECT COUNT(*) as count FROM ${currentTableSQL}`;
        const countResult = await duckDBConnection.query(countSQL);
        const totalCount = Number(countResult.toArray()[0]?.count ?? 0);

        // Get preview rows (limit 100 for display)
        const previewSQL = `SELECT * FROM ${currentTableSQL} LIMIT 100`;
        console.log("[InsightConfigureTab] Join SQL:", previewSQL);
        const previewResult = await duckDBConnection.query(previewSQL);
        const rows = previewResult.toArray() as DataFrameRow[];

        // Build columns from result
        const columns = rows.length > 0
          ? Object.keys(rows[0])
              .filter(key => !key.startsWith('_'))
              .map(name => ({
                name,
                _isJoined: allJoinColNames.has(name),
              }))
          : [];

        setJoinedPreviewData({ rows, columns, totalCount });
      } catch (err) {
        console.error("Failed to compute joined data:", err);
        setJoinedPreviewData(null);
      } finally {
        setIsLoadingJoinedData(false);
      }
    };

    computeJoinedData();
  }, [
    insight.joins,
    duckDBConnection,
    isDuckDBReady,
    dataTable?.dataFrameId,
    dataTable.name,
    fields,
    joinTableDetails,
    getDataFrame,
    isPreviewReady,
  ]);

  // Compute selected fields (for configured state)
  // Filters previewFields by the IDs stored in insight.baseTable.selectedFields
  const selectedFields = useMemo(() => {
    const selectedIds = insight.baseTable?.selectedFields ?? [];
    if (selectedIds.length === 0) return [];
    return previewFields.filter(
      (f) => selectedIds.includes(f.id) && !f.name.startsWith("_"),
    );
  }, [previewFields, insight.baseTable?.selectedFields]);

  // Map columns to their originating table for multi-table chart ranking
  const columnTableMap = useMemo<Record<string, UUID[]>>(() => {
    const map: Record<string, UUID[]> = {};
    const addMapping = (columnName: string | undefined, tableId: UUID) => {
      if (!columnName) return;
      const existing = map[columnName] ?? [];
      if (!existing.includes(tableId)) {
        map[columnName] = [...existing, tableId];
      }
    };

    fields.forEach((field) => {
      if (field.name.startsWith("_")) return;
      const name = field.columnName ?? field.name;
      addMapping(name, dataTable.id);
      addMapping(`${name}_base`, dataTable.id); // Join suffix coverage
    });

    joinTableDetails.forEach((join) => {
      const tableId = join.joinTable?.id ?? join.tableId;
      join.joinFields.forEach((field) => {
        if (field.name.startsWith("_")) return;
        const name = field.columnName ?? field.name;
        addMapping(name, tableId);
        addMapping(`${name}_join`, tableId);
      });
    });

    return map;
  }, [fields, dataTable.id, joinTableDetails]);

  // Compute visible metrics
  const visibleMetrics = useMemo(() => {
    return insightMetrics.filter((m) => !m.name.startsWith("_"));
  }, [insightMetrics]);

  // Determine which DataFrame to display:
  // - If insight has a computed DataFrame (e.g., after join), use that
  // - Otherwise, fall back to the base table's DataFrame
  const activeDataFrameId = insight.dataFrameId ?? dataTable?.dataFrameId;

  // Raw preview for unconfigured state (shows source data directly)
  // Display is limited for the inline HTML table; VirtualTable handles full dataset via async mode
  const PREVIEW_TABLE_LIMIT = 100;
  const rawPreview = useMemo(() => {
    if (isConfigured) return null;
    if (!sourceDataFrameData) return null;

    return {
      dataFrame: {
        fieldIds: [] as string[],
        columns: sourceDataFrameData.columns,
        rows: sourceDataFrameData.rows.slice(0, PREVIEW_TABLE_LIMIT),
      },
      rowCount: sourceDataFrameData.rows.length,
    };
  }, [isConfigured, sourceDataFrameData]);

  // Aggregated preview for configured state
  // NOTE: This is computed AFTER onDemandJoinPreview is available, but we can't use it
  // directly here due to hook ordering. We'll compute aggregation separately below.
  const aggregatedPreview = useMemo<PreviewResult | null>(() => {
    if (!isConfigured) return null;
    if (!dataTable?.dataFrameId) return null;
    if (!sourceDataFrameData) return null;

    try {
      // Convert local types to expected format for compute function
      const insightForCompute = {
        id: insightId,
        name: insight.name,
        baseTable: {
          tableId: dataTable.id,
          selectedFields: insight.baseTable?.selectedFields || [],
        },
        metrics: insightMetrics.map((m) => ({
          id: m.id,
          name: m.name,
          sourceTable: m.sourceTable,
          columnName: m.columnName,
          aggregation: m.aggregation,
        })),
        filters: insight.filters,
        createdAt: insight.createdAt,
        updatedAt: insight.updatedAt,
      };

      const dataTableForCompute = {
        id: dataTable.id,
        name: dataTable.name,
        table: dataTable.table,
        dataFrameId: dataTable.dataFrameId,
        fields: fields.map((f) => ({
          id: f.id,
          name: f.name,
          columnName: f.columnName,
          type: f.type,
        })),
      };

      // Convert LoadedDataFrameData to DataFrameData format (add empty fieldIds)
      const sourceDataForCompute = {
        fieldIds: [] as string[],
        columns: sourceDataFrameData.columns,
        rows: sourceDataFrameData.rows,
      };

      // Use Infinity for maxRows to compute all aggregated groups (not just first 50)
      return computeInsightPreview(
        insightForCompute as any,
        dataTableForCompute as any,
        sourceDataForCompute,
        Infinity,
      );
    } catch (error) {
      console.error("Failed to compute preview:", error);
      return null;
    }
  }, [
    isConfigured,
    insight,
    insightId,
    dataTable,
    fields,
    insightMetrics,
    sourceDataFrameData,
  ]);

  // Use appropriate preview based on state
  const preview = isConfigured ? aggregatedPreview : rawPreview;

  // Join preview data - computed ON-DEMAND from source tables using join config
  // This ensures we always show raw joined data, not aggregated data
  // Returns displayRows (limited for HTML table) and allRows (full data for aggregations)
  const onDemandJoinPreview = useMemo(() => {
    // Get base table DataFrame
    if (!dataTable?.dataFrameId) return null;
    if (!sourceDataFrameData) return null;

    // Helper to build columns from fields
    const buildColumnsFromFields = (
      tableFields: LocalField[],
    ): DataFrameColumn[] => {
      return tableFields
        .filter((f) => !f.name.startsWith("_"))
        .map((f) => ({
          name: f.columnName ?? f.name,
          type: f.type,
        }));
    };

    // If no joins, just return base table data
    if (!insight.joins?.length) {
      const baseColumns: DataFrameColumn[] =
        sourceDataFrameData.columns ?? buildColumnsFromFields(fields);
      const columns = baseColumns
        .filter((col: DataFrameColumn) => !col.name.startsWith("_"))
        .map((col: DataFrameColumn) => ({
          id: col.name,
          name: col.name,
          columnName: col.name,
          type: col.type,
          _isJoined: false,
        }));

      return {
        columns,
        rows: sourceDataFrameData.rows.slice(0, PREVIEW_TABLE_LIMIT), // For HTML table display
        allRows: sourceDataFrameData.rows, // Full data for aggregations
        rowCount: sourceDataFrameData.rows.length,
      };
    }

    // Build base columns first
    const baseColumns = (sourceDataFrameData.columns ?? buildColumnsFromFields(fields))
      .filter((col: DataFrameColumn) => !col.name.startsWith("_"))
      .map((col: DataFrameColumn) => ({
        id: col.name,
        name: col.name,
        columnName: col.name,
        type: col.type,
        _isJoined: false,
      }));

    // NOTE: Client-side joins have been removed. Joins are now computed via DuckDB SQL.
    // For now, when joins exist, we show base columns + join columns (without actual join computation).
    // TODO: Implement DuckDB-based join preview using QueryBuilder
    if (insight.joins.length > 0) {
      // Collect all join table columns for display
      const allJoinColumns: typeof baseColumns = [];
      for (const join of insight.joins) {
        const joinDetail = joinTableDetails.find((j) => j.id === join.id);
        if (!joinDetail) continue;

        for (const field of joinDetail.joinFields) {
          allJoinColumns.push({
            id: field.id,
            name: field.name,
            columnName: field.columnName ?? field.name,
            type: field.type,
            _isJoined: true,
          });
        }
      }

      // Return base columns + join columns (without actual join computation)
      return {
        columns: [...baseColumns, ...allJoinColumns],
        rows: sourceDataFrameData.rows.slice(0, PREVIEW_TABLE_LIMIT), // For HTML table display
        allRows: sourceDataFrameData.rows, // Full data for aggregations
        rowCount: sourceDataFrameData.rows.length,
      };
    }

    // No joins - return base table data
    return {
      columns: baseColumns,
      rows: sourceDataFrameData.rows.slice(0, PREVIEW_TABLE_LIMIT), // For HTML table display
      allRows: sourceDataFrameData.rows, // Full data for aggregations
      rowCount: sourceDataFrameData.rows.length,
    };
  }, [
    dataTable?.dataFrameId,
    sourceDataFrameData,
    fields,
    insight.joins,
    joinTableDetails,
    allTableFields,
  ]);

  // Use the on-demand computed columns for join preview
  const joinPreviewColumns = onDemandJoinPreview?.columns ?? previewFields;

  // Compute aggregated result using the DuckDB-computed joined data
  // This properly handles joined column names (with table prefixes like tablename.column)
  // eslint-disable-next-line sonarjs/cognitive-complexity -- Complex aggregation with multiple data transformations
  const joinedAggregatedPreview = useMemo<PreviewResult | null>(() => {
    if (!isConfigured) return null;
    if (!joinedPreviewData) return null;

    // Get the selected fields
    const selectedFieldIds = insight.baseTable?.selectedFields ?? [];
    if (selectedFieldIds.length === 0) return null;

    // Map selected field IDs to actual column names from the DuckDB join result
    // We need to match field IDs to the new column names which may have table prefixes
    const selectedColumns: Array<{ name: string; type: string }> = [];

    for (const fieldId of selectedFieldIds) {
      // First check base table fields
      const baseField = fields.find(f => f.id === fieldId);
      if (baseField) {
        const colName = baseField.columnName ?? baseField.name;
        // Check if this column exists in joinedPreviewData (might be prefixed)
        const matchingCol = joinedPreviewData.columns.find(c =>
          c.name === colName || c.name.endsWith(`.${colName}`)
        );
        if (matchingCol) {
          selectedColumns.push({ name: matchingCol.name, type: matchingCol.type ?? 'unknown' });
          continue;
        }
      }

      // Check joined table fields
      for (const joinDetail of joinTableDetails) {
        const joinField = joinDetail.joinFields.find((f: LocalField) => f.id === fieldId);
        if (joinField) {
          const colName = joinField.columnName ?? joinField.name;
          // Check if this column exists in joinedPreviewData (might be prefixed with table name)
          const matchingCol = joinedPreviewData.columns.find(c =>
            c.name === colName || c.name.endsWith(`.${colName}`)
          );
          if (matchingCol) {
            selectedColumns.push({ name: matchingCol.name, type: matchingCol.type ?? 'unknown' });
            break;
          }
        }
      }
    }

    if (selectedColumns.length === 0) return null;

    // Group rows by selected columns - using the preview rows (limited to 100)
    // Note: For accurate aggregation, this should be computed in DuckDB
    const groupMap = new Map<string, Record<string, unknown>[]>();
    for (const row of joinedPreviewData.rows) {
      const keyParts = selectedColumns.map((col) => {
        const value = row[col.name];
        return value != null ? String(value) : "__NULL__";
      });
      const key = keyParts.join("|||");
      if (!groupMap.has(key)) {
        groupMap.set(key, []);
      }
      groupMap.get(key)!.push(row);
    }

    // Compute aggregations for each group
    const aggregatedRows: Record<string, unknown>[] = [];
    for (const [, groupRows] of groupMap) {
      const row: Record<string, unknown> = {};

      // Add group key values
      for (const col of selectedColumns) {
        row[col.name] = groupRows[0][col.name];
      }

      // Compute metrics
      for (const metric of insightMetrics) {
        if (metric.name.startsWith("_")) continue;

        // Find the actual column name in the joined data
        // The metric.columnName might need table prefix matching
        let actualColumnName: string | undefined = metric.columnName;

        // Check for exact match or table-prefixed match
        const matchingCol = joinedPreviewData.columns.find(c =>
          c.name === metric.columnName ||
          c.name.endsWith(`.${metric.columnName}`)
        );

        if (matchingCol) {
          actualColumnName = matchingCol.name;
        }

        let value = 0;
        switch (metric.aggregation) {
          case "count":
            value = groupRows.length;
            break;
          case "count_distinct":
            if (actualColumnName) {
              const values = groupRows
                .map((r) => r[actualColumnName])
                .filter((v) => v != null);
              value = new Set(values).size;
            }
            break;
          case "sum":
            if (actualColumnName) {
              value = groupRows.reduce((sum, r) => {
                const val = r[actualColumnName];
                return sum + (typeof val === "number" ? val : 0);
              }, 0);
            }
            break;
          case "avg":
            if (actualColumnName) {
              const values = groupRows
                .map((r) => r[actualColumnName])
                .filter((v) => typeof v === "number") as number[];
              value =
                values.length > 0
                  ? values.reduce((sum, v) => sum + v, 0) / values.length
                  : 0;
            }
            break;
          case "min":
            if (actualColumnName) {
              const values = groupRows
                .map((r) => r[actualColumnName])
                .filter((v) => typeof v === "number") as number[];
              value = values.length > 0 ? Math.min(...values) : 0;
            }
            break;
          case "max":
            if (actualColumnName) {
              const values = groupRows
                .map((r) => r[actualColumnName])
                .filter((v) => typeof v === "number") as number[];
              value = values.length > 0 ? Math.max(...values) : 0;
            }
            break;
        }
        row[metric.name] = value;
      }

      aggregatedRows.push(row);
    }

    // Build columns for the result
    const resultColumns: Array<{
      name: string;
      type: "string" | "number" | "boolean" | "date" | "unknown";
    }> = [
      ...selectedColumns.map((col) => ({
        name: col.name,
        type: col.type as "string" | "number" | "boolean" | "date" | "unknown",
      })),
      ...insightMetrics
        .filter((m) => !m.name.startsWith("_"))
        .map((m) => ({ name: m.name, type: "number" as const })),
    ];

    return {
      dataFrame: {
        fieldIds: [],
        columns: resultColumns,
        rows: aggregatedRows,
      },
      rowCount: aggregatedRows.length,
      sampleSize: aggregatedRows.length,
    };
  }, [
    isConfigured,
    joinedPreviewData,
    insight.baseTable?.selectedFields,
    fields,
    joinTableDetails,
    insightMetrics,
  ]);

  // Use joined aggregation when we have joins, otherwise use base table aggregation
  const effectiveAggregatedPreview = insight.joins?.length
    ? joinedAggregatedPreview
    : aggregatedPreview;

  // Use joined preview row count when joins exist, otherwise use base preview
  // Now uses DuckDB-computed joinedPreviewData for accurate row count
  const rowCount = insight.joins?.length
    ? joinedPreviewData?.totalCount ?? 0
    : preview?.rowCount ?? 0;
  const columnCount = (insight.joins?.length ? joinPreviewColumns.length : previewFields.length) + visibleMetrics.length;

  // Build field map from preview fields (use joined columns when joins exist)
  const fieldMap = useMemo<
    Record<string, { id: string; name: string; type: string }>
  >(() => {
    const map: Record<string, { id: string; name: string; type: string }> = {};

    // Use DuckDB-computed joined columns when available, otherwise use previewFields
    if (insight.joins?.length && joinedPreviewData) {
      joinedPreviewData.columns.forEach((col) => {
        map[col.name] = { id: col.name, name: col.name, type: col.type ?? 'unknown' };
      });
    } else {
      previewFields.forEach((f: PreviewColumn) => {
        map[f.name] = { id: f.id, name: f.name, type: f.type };
      });
    }

    return map;
  }, [previewFields, joinedPreviewData, insight.joins?.length]);

  // Generate chart suggestions (only for unconfigured state)
  // Uses joined data when joins exist to suggest charts across all tables
  const suggestions = useMemo<ChartSuggestion[]>(() => {
    // Check if we have joins and DuckDB-computed joined preview data
    const hasJoins = !!(insight.joins?.length && joinedPreviewData);

    // Need either rawPreview (no joins) or joinedPreviewData (with joins)
    if (isConfigured || (!rawPreview && !hasJoins)) return [];

    // Check if we have data available (either base table data or join preview)
    if (!sourceDataFrameData && !hasJoins) return [];

    try {
      // Build preview data from joined data when available, otherwise use raw preview
      const previewData = hasJoins
        ? {
            fieldIds: joinedPreviewData.columns.map((c) => c.name),
            columns: joinedPreviewData.columns.map((c) => ({
              name: c.name,
              type: (c.type ?? 'unknown') as ColumnType,
            })),
            rows: joinedPreviewData.rows,
          }
        : rawPreview!.dataFrame;

      // Create a minimal insight object for suggestions
      const insightForSuggestions = {
        id: insightId,
        name: insight.name,
        baseTable: {
          tableId: dataTable.id,
          selectedFields: [] as string[],
        },
        metrics: [] as any[],
        createdAt: insight.createdAt,
        updatedAt: insight.updatedAt,
      };

      // suggestCharts expects DataFrameData (plain object with rows/columns)
      // Pass suggestionSeed for variety when user clicks "Regenerate"
      return suggestCharts(
        insightForSuggestions as any,
        previewData,
        fieldMap as any,
        3,
        columnTableMap,
        suggestionSeed,
      );
    } catch (error) {
      console.error("Failed to generate suggestions:", error);
      return [];
    }
  }, [
    isConfigured,
    rawPreview,
    joinedPreviewData,
    insight,
    insightId,
    fieldMap,
    dataTable,
    sourceDataFrameData,
    columnTableMap,
    suggestionSeed,
  ]);

  // Get data source type label
  const dataSourceTypeLabel = useMemo(() => {
    if (!dataSource?.type) return "unknown source";
    switch (dataSource.type) {
      case "notion":
        return "Notion database";
      case "local":
        return "Uploaded CSV";
      case "postgresql":
        return "PostgreSQL source";
      default:
        return "unknown source";
    }
  }, [dataSource]);

  // Parse aggregate expression like "sum(amount)" → { aggregation: "sum", columnName: "amount" }
  const parseAggregateExpression = (
    expr: string,
  ): {
    aggregation: InsightMetric["aggregation"];
    columnName: string;
  } | null => {
    const match = expr.match(
      /^(sum|avg|count|min|max|count_distinct)\(([^)]+)\)$/i,
    );
    if (match) {
      return {
        aggregation: match[1].toLowerCase() as InsightMetric["aggregation"],
        columnName: match[2],
      };
    }
    return null;
  };

  // Handle creating a chart from suggestion (LOCAL ONLY - no Convex)
  const handleCreateChart = async (suggestion: ChartSuggestion) => {
    if (!activeDataFrameId) return;
    if (!sourceDataFrameData) return;

    // Parse encoding to determine fields and metrics for the insight
    const encoding = suggestion.encoding;
    const dimensionFields: string[] = []; // Column names to group by
    const metrics: InsightMetric[] = [];
    const cleanEncoding = { ...encoding }; // Encoding with metric references cleaned

    // Process X axis - check if it's a dimension or aggregate
    if (encoding.x) {
      const parsed = parseAggregateExpression(encoding.x);
      if (parsed) {
        // X is an aggregate (rare but possible)
        const metricId = crypto.randomUUID();
        metrics.push({
          id: metricId,
          name: encoding.x, // e.g., "sum(amount)"
          sourceTable: dataTable.id,
          columnName: parsed.columnName,
          aggregation: parsed.aggregation,
        });
      } else {
        // X is a dimension field
        dimensionFields.push(encoding.x);
      }
    }

    // Process Y axis - commonly an aggregate like "sum(amount)"
    if (encoding.y) {
      const parsed = parseAggregateExpression(encoding.y);
      if (parsed) {
        // Y is an aggregate - add as metric
        const metricId = crypto.randomUUID();
        metrics.push({
          id: metricId,
          name: encoding.y, // e.g., "sum(amount)"
          sourceTable: dataTable.id,
          columnName: parsed.columnName,
          aggregation: parsed.aggregation,
        });
      } else {
        // Y is a dimension (for scatter plots, etc.)
        dimensionFields.push(encoding.y);
      }
    }

    // Process color - typically a dimension
    if (encoding.color) {
      const parsed = parseAggregateExpression(encoding.color);
      if (!parsed) {
        dimensionFields.push(encoding.color);
      }
    }

    // Map dimension column names to field IDs
    // For joined data, we need to find fields by column name
    const fieldIdMap = new Map<string, UUID>();

    // Build field map from previewFields (which include joined columns)
    previewFields.forEach((f) => {
      fieldIdMap.set(f.columnName ?? f.name, f.id);
    });

    // Also add fields from the original dataTable for base table columns
    fields.forEach((f) => {
      if (!fieldIdMap.has(f.columnName ?? f.name)) {
        fieldIdMap.set(f.columnName ?? f.name, f.id);
      }
    });

    // Convert dimension column names to field IDs
    const selectedFieldIds = dimensionFields
      .map((colName) => fieldIdMap.get(colName))
      .filter((id): id is UUID => id !== undefined);

    // Now configure the insight with the extracted fields and metrics
    // This triggers the proper data flow where insight knows about the configuration
    updateInsightLocal(insightId, {
      baseTable: {
        ...insight.baseTable,
        selectedFields: selectedFieldIds,
      },
      metrics: metrics,
    });

    // Compute the aggregated DataFrame
    // Build proper insight object for computation
    const computeInsight = {
      id: insightId,
      name: insight.name,
      baseTable: {
        tableId: dataTable.id,
        selectedFields: selectedFieldIds,
      },
      metrics: metrics.map((m) => ({
        id: m.id,
        name: m.name,
        sourceTable: m.sourceTable,
        columnName: m.columnName,
        aggregation: m.aggregation,
      })),
      filters: insight.filters,
      createdAt: insight.createdAt,
      updatedAt: insight.updatedAt,
    };

    const computeDataTable = {
      id: dataTable.id,
      name: dataTable.name,
      table: dataTable.table,
      dataFrameId: activeDataFrameId,
      fields: previewFields.map((f) => ({
        id: f.id,
        name: f.name,
        columnName: f.columnName ?? f.name,
        type: f.type,
      })),
    };

    // Compute aggregated data (convert LoadedDataFrameData to DataFrameData format)
    const sourceDataForCompute = {
      fieldIds: [] as string[],
      columns: sourceDataFrameData.columns,
      rows: sourceDataFrameData.rows,
    };
    const aggregatedData = computeInsightDataFrame(
      computeInsight as any,
      computeDataTable as any,
      sourceDataForCompute,
    );

    console.log("Computed aggregated data:", {
      rows: aggregatedData.rows.length,
      columns: aggregatedData.columns?.length ?? 0,
    });

    // Create visualization using the SOURCE DataFrame (not a computed one)
    // The visualization will reference the insight for aggregation configuration.
    // When rendering, the chart spec uses the pre-computed aggregated data from
    // the insight's preview, which is computed on-the-fly from the source DataFrame.
    //
    // Architecture:
    // - Source DataFrame: Raw data stored in IndexedDB
    // - Insight: Configuration for dimensions, metrics, filters
    // - Visualization: Points to source DataFrame + insight for live computation
    const vizId = createVisualizationLocal(
      {
        dataFrameId: activeDataFrameId, // Use SOURCE DataFrame, not a fake computed ID
        insightId: insightId,
      },
      suggestion.title,
      suggestion.spec,
      suggestion.chartType,
      cleanEncoding, // Keep original encoding - columns match metric names like "sum(amount)"
    );

    // Navigate to the visualization using route-based navigation
    router.push(`/visualizations/${vizId}`);
  };

  // Handle filter toggle - LOCAL ONLY
  const handleExcludeNullsToggle = (checked: boolean) => {
    updateInsightLocal(insightId, {
      filters: {
        ...insight.filters,
        excludeNulls: checked,
      },
    });
  };

  // Add a field from column header click
  const handleAddField = (columnName: string) => {
    // Find field by column name
    const field = fields.find((f) => (f.columnName ?? f.name) === columnName);
    if (!field) return;

    // Don't add if already selected
    if (insight.baseTable?.selectedFields?.includes(field.id)) return;

    updateInsightLocal(insightId, {
      baseTable: {
        ...insight.baseTable,
        selectedFields: [
          ...(insight.baseTable?.selectedFields || []),
          field.id,
        ],
      } as any,
    });
  };

  // Remove a field from the selected list
  const handleRemoveField = (fieldId: UUID) => {
    updateInsightLocal(insightId, {
      baseTable: {
        ...insight.baseTable,
        selectedFields:
          insight.baseTable?.selectedFields?.filter((id) => id !== fieldId) ||
          [],
      } as any,
    });
  };

  // Add a metric from column header click
  const handleAddMetric = (
    columnName: string,
    aggregation: InsightMetric["aggregation"],
  ) => {
    const metricId = crypto.randomUUID() as UUID;
    const metricName = `${aggregation}(${columnName})`;

    // Check if metric already exists
    const exists = insightMetrics.some(
      (m) => m.columnName === columnName && m.aggregation === aggregation,
    );
    if (exists) return;

    updateInsightLocal(insightId, {
      metrics: [
        ...(insight.metrics || []),
        {
          id: metricId,
          name: metricName,
          sourceTable: dataTable.id,
          columnName,
          aggregation,
        },
      ],
    });
  };

  // Remove a metric
  const handleRemoveMetric = (metricId: UUID) => {
    updateInsightLocal(insightId, {
      metrics: insight.metrics?.filter((m) => m.id !== metricId) || [],
    });
  };

  // Remove a join from the insight
  const handleRemoveJoin = (joinId: UUID) => {
    const updatedJoins = insight.joins?.filter((j) => j.id !== joinId) || [];
    updateInsightLocal(insightId, {
      joins: updatedJoins,
    });

    // If no joins remain, clear the joined DataFrame and revert to base table
    if (updatedJoins.length === 0 && insight.dataFrameId) {
      // Remove the computed DataFrame reference
      const setInsightDataFrame =
        useInsightsStore.getState().setInsightDataFrame;
      setInsightDataFrame(insightId, undefined as any);
    }
  };

  // Build ItemList items for Data Sources section
  const dataSourceItems = useMemo<ListItem[]>(() => {
    // Get base table metadata from entry
    const baseDataFrameEntry = dataTable?.dataFrameId
      ? getDataFrameEntry(dataTable.dataFrameId)
      : undefined;
    const baseRowCount = baseDataFrameEntry?.rowCount ?? 0;
    const baseFieldCount = allTableFields.length;

    // Base table item (always first)
    const baseItem: ListItem = {
      id: "base",
      title: dataTable.name,
      subtitle: `${baseRowCount.toLocaleString()} rows • ${baseFieldCount} fields`,
      badge: "base",
      icon: <LuDatabase className="h-4 w-4" />,
    };

    // Join items - show table name prominently, join info in subtitle
    const joinItems: ListItem[] = joinTableDetails.map((join) => ({
      id: join.id,
      title: join.tableName,
      subtitle: `${join.baseFieldName} → ${join.joinedFieldName} • ${join.rowCount.toLocaleString()} rows`,
      badge: getJoinTypeLabel(join.joinType).replace(" join", ""),
      icon: <JoinTypeIcon type={join.joinType} size="sm" />,
      actions: [
        {
          icon: LuX,
          label: "Remove",
          variant: "ghost" as const,
          onClick: () => handleRemoveJoin(join.id as UUID),
        },
      ],
    }));

    return [baseItem, ...joinItems];
  }, [
    dataTable,
    allTableFields,
    joinTableDetails,
    getDataFrameEntry,
    handleRemoveJoin,
  ]);

  const dataSummary = `${rowCount.toLocaleString()} rows • ${columnCount} fields • ${visibleMetrics.length} metrics`;

  // Render unconfigured state (draft insight)
  if (!isConfigured) {
    return (
      <div className="flex-1">
        <div className="container mx-auto max-w-6xl space-y-6 px-6 py-6">
          {/* Data Sources Section with ItemList */}
          <section className="border-border bg-card space-y-3 rounded-2xl border p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-muted-foreground text-xs font-semibold">
                  Data sources
                </p>
                <p className="text-foreground text-sm">
                  Tables used in this insight
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsJoinFlowOpen(true)}
              >
                <LuPlus className="mr-1 h-4 w-4" />
                Add join
              </Button>
            </div>
            <ItemList
              items={dataSourceItems}
              onSelect={() => {}}
              orientation="horizontal"
              gap={12}
              itemWidth={260}
              emptyMessage="No data sources"
              emptyIcon={<LuDatabase className="h-8 w-8" />}
            />
          </section>

          {/* Data Preview Section */}
          <section className="border-border bg-card space-y-4 rounded-2xl border p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-muted-foreground text-xs font-semibold">
                  Data preview
                </p>
                <p className="text-foreground text-sm">
                  {/* Use joined data count when joins exist, otherwise base table count */}
                  {(insight.joins?.length
                    ? joinedPreviewData?.totalCount ?? 0
                    : previewTotalCount || rowCount
                  ).toLocaleString()} rows
                </p>
              </div>
              <div className="text-muted-foreground flex items-center gap-3 text-xs">
                <span>{dataSummary}</span>
                <span>•</span>
                <span>{dataSourceTypeLabel}</span>
              </div>
            </div>
            {/* Use VirtualTable for efficient rendering of large datasets */}
            {/* Show skeleton while data is loading */}
            {isLoadingSourceData && !isPreviewReady && !preview ? (
              <div className="bg-muted/20 relative overflow-hidden rounded-xl border" style={{ height: 260 }}>
                <div className="bg-muted border-b px-3 py-2">
                  <div className="flex gap-4">
                    {[1, 2, 3, 4].map((i) => (
                      <div key={i} className="bg-muted-foreground/20 h-4 w-24 animate-pulse rounded" />
                    ))}
                  </div>
                </div>
                <div className="space-y-2 p-3">
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div key={i} className="flex gap-4">
                      {[1, 2, 3, 4].map((j) => (
                        <div key={j} className="bg-muted-foreground/10 h-4 w-24 animate-pulse rounded" />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            ) : insight.joins?.length ? (
              // Joins exist: use DuckDB-computed joined data
              isLoadingJoinedData ? (
                <div className="bg-muted/20 relative overflow-hidden rounded-xl border" style={{ height: 260 }}>
                  <div className="flex h-full items-center justify-center">
                    <div className="flex flex-col items-center gap-2">
                      <div className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      <span className="text-muted-foreground text-sm">Computing join...</span>
                    </div>
                  </div>
                </div>
              ) : joinedPreviewData ? (
                <VirtualTable
                  rows={joinedPreviewData.rows}
                  columns={joinedPreviewData.columns.map((col) => ({
                    name: col.name,
                    type: col.type,
                  }))}
                  height={260}
                  compact
                />
              ) : (
                <p className="text-muted-foreground text-sm">
                  No data available. The data source may not have been loaded yet.
                </p>
              )
            ) : isPreviewReady ? (
              // No joins: use async mode with DuckDB pagination for full dataset browsing
              <VirtualTable
                onFetchData={fetchPreviewData}
                height={260}
                compact
              />
            ) : preview ? (
              // Fallback to static preview while async mode initializes
              <VirtualTable
                rows={preview.dataFrame.rows}
                columns={preview.dataFrame.columns}
                height={260}
                compact
              />
            ) : (
              <p className="text-muted-foreground text-sm">
                No data available. The data source may not have been loaded yet.
              </p>
            )}
          </section>

          {/* Suggested Charts Section */}
          <section className="space-y-4">
            <div className="flex items-end justify-between">
              <div>
                <h3 className="text-foreground text-lg font-semibold">
                  Suggested charts
                </h3>
              </div>
              <p className="text-muted-foreground text-xs">
                {isLoadingSourceData ? "Analyzing data..." : "Click a suggestion to create a visualization"}
              </p>
            </div>
            {isLoadingSourceData ? (
              // Show skeleton cards while loading
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="border-border bg-card rounded-2xl border p-4 shadow-sm">
                    <div className="bg-muted mb-3 h-32 animate-pulse rounded-xl" />
                    <div className="bg-muted-foreground/20 mb-2 h-5 w-3/4 animate-pulse rounded" />
                    <div className="bg-muted-foreground/10 h-4 w-1/2 animate-pulse rounded" />
                  </div>
                ))}
              </div>
            ) : (
              <SuggestedInsights
                suggestions={suggestions}
                onCreateChart={handleCreateChart}
                onRegenerate={() => setSuggestionSeed((prev) => prev + 1)}
              />
            )}
          </section>
        </div>

        {/* Sticky Footer Actions */}
        <div className="bg-card/90 sticky bottom-0 border-t px-6 py-4 backdrop-blur-sm">
          <div className="container mx-auto max-w-6xl">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-muted-foreground text-xs">
                Need something custom? Build from scratch or join another
                dataset.
              </p>
              <div className="flex gap-3">
                <Button variant="outline" size="sm">
                  Create custom visualization
                </Button>
                <Button size="sm" onClick={() => setIsJoinFlowOpen(true)}>
                  Join with another dataset
                </Button>
              </div>
            </div>
          </div>
        </div>

        <JoinFlowModal
          insight={insight as any}
          dataTable={dataTable as any}
          isOpen={isJoinFlowOpen}
          onOpenChange={setIsJoinFlowOpen}
        />
      </div>
    );
  }

  // Column header dropdown component
  const ColumnHeaderDropdown = ({
    columnName,
    columnType,
  }: {
    columnName: string;
    columnType: string;
  }) => {
    const isNumeric =
      columnType === "number" ||
      columnType === "integer" ||
      columnType === "float";
    const isAlreadyField = insight.baseTable?.selectedFields?.some((id) => {
      const f = fields.find((field) => field.id === id);
      return f && (f.columnName ?? f.name) === columnName;
    });
    const aggregations: InsightMetric["aggregation"][] = isNumeric
      ? ["sum", "avg", "min", "max", "count"]
      : ["count", "count_distinct"];

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="text-muted-foreground hover:bg-muted/50 flex items-center gap-1 px-3 py-2 text-left text-xs font-semibold transition-colors">
            {columnName}
            <LuChevronDown className="h-3 w-3 opacity-50" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuLabel className="text-xs">
            Add &quot;{columnName}&quot; as
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => handleAddField(columnName)}
            disabled={isAlreadyField}
          >
            <LuHash className="mr-2 h-4 w-4" />
            Field (group by)
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <LuCalculator className="mr-2 h-4 w-4" />
              Metric
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {aggregations.map((agg) => (
                <DropdownMenuItem
                  key={agg}
                  onClick={() => handleAddMetric(columnName, agg)}
                >
                  {agg}({columnName})
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  // Render configured state (edit fields, metrics, filters, joins)
  return (
    <div className="flex-1">
      <div className="container mx-auto max-w-6xl space-y-6 px-6 py-6">
        {/* Data Sources Section with ItemList */}
        <section className="border-border bg-card space-y-3 rounded-2xl border p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-muted-foreground text-xs font-semibold">
                Data sources
              </p>
              <p className="text-foreground text-sm">
                Tables used in this insight
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsJoinFlowOpen(true)}
            >
              <LuPlus className="mr-1 h-4 w-4" />
              Add join
            </Button>
          </div>
          <ItemList
            items={dataSourceItems}
            onSelect={() => {}}
            orientation="horizontal"
            gap={12}
            itemWidth={260}
            emptyMessage="No data sources"
            emptyIcon={<LuDatabase className="h-8 w-8" />}
          />
        </section>

        {/* Join Preview with Clickable Headers */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Join preview</h3>
                <p className="text-muted-foreground text-xs">
                  Combined data from {1 + (insight.joins?.length ?? 0)} table
                  {(insight.joins?.length ?? 0) !== 0 ? "s" : ""} • Click
                  headers to add fields
                </p>
              </div>
              <div className="text-muted-foreground text-xs">
                {joinedPreviewData?.totalCount.toLocaleString()} rows
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoadingJoinedData ? (
              <div className="flex h-32 items-center justify-center">
                <div className="flex flex-col items-center gap-2">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  <span className="text-muted-foreground text-xs">Computing join...</span>
                </div>
              </div>
            ) : joinedPreviewData ? (
              <div className="bg-muted/20 relative overflow-hidden rounded-xl border">
                <div className="overflow-auto" style={{ maxHeight: 200 }}>
                  <table className="w-full border-separate border-spacing-0 text-sm">
                    <thead className="bg-card sticky top-0 z-10">
                      <tr>
                        {joinedPreviewData.columns.map((col) => (
                          <th key={col.name} className="text-left">
                            <ColumnHeaderDropdown
                              columnName={col.name}
                              columnType={col.type ?? 'unknown'}
                            />
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {joinedPreviewData.rows.slice(0, 10).map((row, idx) => (
                        <tr key={idx} className="border-b last:border-0">
                          {joinedPreviewData.columns.map((col) => (
                            <td
                              key={col.name}
                              className="whitespace-nowrap px-3 py-2 text-xs"
                            >
                              {formatCellValue(
                                (row as Record<string, unknown>)[col.name],
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                No data available.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Fields (Dimensions) - Removable Item List */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Fields (Dimensions)</h3>
                <p className="text-muted-foreground text-xs">
                  Columns to group by
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {selectedFields.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {selectedFields.map((field) => {
                  const isJoined = (
                    field as LocalField & { _isJoined?: boolean }
                  )._isJoined;
                  return (
                    <Badge
                      key={field.id}
                      variant="secondary"
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm"
                    >
                      <LuHash className="h-3 w-3" />
                      <span>{field.name}</span>
                      <span className="text-muted-foreground text-[10px]">
                        {field.type}
                      </span>
                      <span className="bg-muted rounded px-1.5 py-0.5 text-[10px]">
                        {isJoined ? "joined" : "base"}
                      </span>
                      <button
                        onClick={() => handleRemoveField(field.id)}
                        className="hover:bg-muted ml-0.5 rounded-full p-0.5"
                      >
                        <LuX className="h-3 w-3" />
                      </button>
                    </Badge>
                  );
                })}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                No fields selected. Click a column header above to add.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Metrics - Removable Item List */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Metrics</h3>
                <p className="text-muted-foreground text-xs">
                  Aggregations to compute
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {visibleMetrics.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {visibleMetrics.map((metric) => (
                  <Badge
                    key={metric.id}
                    variant="secondary"
                    className="bg-primary/10 text-primary flex items-center gap-1.5 px-3 py-1.5 text-sm"
                  >
                    <LuCalculator className="h-3 w-3" />
                    <span>{metric.name}</span>
                    <span className="text-primary/60 text-[10px]">
                      {metric.aggregation}
                    </span>
                    <span className="bg-primary/20 rounded px-1.5 py-0.5 text-[10px]">
                      base
                    </span>
                    <button
                      onClick={() => handleRemoveMetric(metric.id)}
                      className="hover:bg-primary/20 ml-0.5 rounded-full p-0.5"
                    >
                      <LuX className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                No metrics configured. Click a column header above to add.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Result Preview */}
        {effectiveAggregatedPreview && selectedFields.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">Result preview</h3>
                  <p className="text-muted-foreground text-xs">
                    {effectiveAggregatedPreview.rowCount} groups
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="bg-muted/20 relative overflow-hidden rounded-xl border">
                <div className="overflow-auto" style={{ maxHeight: 200 }}>
                  <table className="w-full border-separate border-spacing-0 text-sm">
                    <thead className="bg-card sticky top-0 z-10">
                      <tr>
                        {/* Use columns from the aggregated result for correct names */}
                        {effectiveAggregatedPreview.dataFrame.columns
                          ?.filter(
                            (col) =>
                              !visibleMetrics.some((m) => m.name === col.name),
                          )
                          .map((col) => (
                            <th
                              key={col.name}
                              className="text-muted-foreground px-3 py-2 text-left text-xs font-semibold"
                            >
                              {col.name}
                            </th>
                          ))}
                        {visibleMetrics.map((metric) => (
                          <th
                            key={metric.id}
                            className="text-primary px-3 py-2 text-left text-xs font-semibold"
                          >
                            {metric.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {effectiveAggregatedPreview.dataFrame.rows
                        .slice(0, 10)
                        .map((row, idx) => (
                          <tr key={idx} className="border-b last:border-0">
                            {effectiveAggregatedPreview.dataFrame.columns
                              ?.filter(
                                (col) =>
                                  !visibleMetrics.some(
                                    (m) => m.name === col.name,
                                  ),
                              )
                              .map((col) => (
                                <td
                                  key={col.name}
                                  className="whitespace-nowrap px-3 py-2 text-xs"
                                >
                                  {formatCellValue(
                                    (row as Record<string, unknown>)[col.name],
                                  )}
                                </td>
                              ))}
                            {visibleMetrics.map((metric) => (
                              <td
                                key={metric.id}
                                className="text-primary whitespace-nowrap px-3 py-2 text-xs font-medium"
                              >
                                {formatCellValue(
                                  (row as Record<string, unknown>)[metric.name],
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Filters */}
        <Card>
          <CardHeader className="pb-3">
            <h3 className="text-sm font-semibold">Filters</h3>
            <p className="text-muted-foreground text-xs">
              Control which data is included
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={insight.filters?.excludeNulls ?? false}
                  onCheckedChange={(checked: boolean) =>
                    handleExcludeNullsToggle(checked)
                  }
                />
                <span className="text-sm">Exclude null values</span>
              </label>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sticky Footer */}
      <div className="bg-card/90 sticky bottom-0 border-t px-6 py-4 backdrop-blur-sm">
        <div className="container mx-auto max-w-6xl">
          <div className="flex justify-end">
            <Button disabled={selectedFields.length === 0}>
              Create Visualization
            </Button>
          </div>
        </div>
      </div>

      <JoinFlowModal
        insight={insight as any}
        dataTable={dataTable as any}
        isOpen={isJoinFlowOpen}
        onOpenChange={setIsJoinFlowOpen}
      />
    </div>
  );
}
