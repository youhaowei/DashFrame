"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { join as joinDataFrames, type DataFrame } from "@dashframe/dataframe";
import { useDataFramesStore } from "@/lib/stores/dataframes-store";
import { useDataSourcesStore } from "@/lib/stores/data-sources-store";
import { useVisualizationsStore } from "@/lib/stores/visualizations-store";
import { useInsightsStore } from "@/lib/stores/insights-store";
import { useStoreQuery } from "@/hooks/useStoreQuery";
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
  type ListItem,
} from "@dashframe/ui";
import { LuDatabase, LuPlus, LuX, LuChevronDown, LuHash, LuCalculator } from "react-icons/lu";
import {
  computeInsightPreview,
  computeInsightDataFrame,
} from "@/lib/insights/compute-preview";
import type { PreviewResult } from "@/lib/insights/compute-preview";
import { suggestCharts } from "@/lib/visualizations/suggest-charts";
import type { ChartSuggestion } from "@/lib/visualizations/suggest-charts";
import { SuggestedInsights } from "@/components/visualization-preview/SuggestedInsights";
import { JoinFlowModal } from "@/components/visualizations/JoinFlowModal";
import type { Insight, DataTable, DataSource, InsightMetric } from "@/lib/stores/types";
import type { UUID, Field as LocalField, Metric } from "@dashframe/dataframe";

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
  const getDataFrame = useDataFramesStore((state) => state.get);
  const createVisualizationLocal = useVisualizationsStore((state) => state.create);
  const updateInsightLocal = useInsightsStore((state) => state.updateInsight);

  // Local state
  const [isJoinFlowOpen, setIsJoinFlowOpen] = useState(false);

  // Data sources (for join metadata)
  const { data: dataSources } = useStoreQuery(
    useDataSourcesStore,
    (state) => state.getAll()
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
      case "notion": return "Notion";
      case "local": return "CSV";
      case "postgresql": return "PostgreSQL";
      default: return "Unknown";
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
          (field) => !field.name.startsWith("_")
        );
        const baseField = baseFieldById.get(join.joinOn.baseField);
        const joinedField = joinFields.find(
          (field) => field.id === join.joinOn.joinedField
        );

        // Get row count from DataFrame if available
        const joinedDataFrame = joinTable?.dataFrameId ? getDataFrame(joinTable.dataFrameId) : undefined;
        const joinRowCount = joinedDataFrame?.metadata.rowCount ?? 0;

        return {
          id: join.id,
          tableId: join.tableId,
          joinType: join.joinType,
          joinTable,
          joinSource,
          joinFields,
          baseFieldName: baseField?.name ?? baseField?.columnName ?? "Base field",
          joinedFieldName:
            joinedField?.name ??
            joinedField?.columnName ??
            "Joined field",
          tableName: joinTable?.name ?? "Joined table",
          rowCount: joinRowCount,
          fieldCount: joinFields.length,
          sourceType: getSourceTypeLabel(joinSource?.type),
        };
      }),
    [insight.joins, dataSources, baseFieldById, getDataFrame]
  );

  // Fields to display in Join preview
  // Combines fields from base table + all joined tables
  const previewFields = useMemo(() => {
    // Start with base table fields
    const combined: Array<LocalField & { _isJoined?: boolean }> = allTableFields.map(f => ({
      ...f,
      _isJoined: false,
    }));

    // Add fields from all joined tables
    if (insight.joins?.length && joinTableDetails.length > 0) {
      joinTableDetails.forEach((join) => {
        join.joinFields.forEach((field: LocalField) => {
          // Avoid duplicates by checking if field name already exists
          const fieldName = field.columnName ?? field.name;
          const exists = combined.some(f =>
            (f.columnName ?? f.name) === fieldName
          );
          if (!exists) {
            combined.push({
              ...field,
              _isJoined: true,
            });
          }
        });
      });
    }

    return combined;
  }, [allTableFields, insight.joins, joinTableDetails]);

  // Compute selected fields (for configured state)
  // Filters previewFields by the IDs stored in insight.baseTable.selectedFields
  const selectedFields = useMemo(() => {
    const selectedIds = insight.baseTable?.selectedFields ?? [];
    if (selectedIds.length === 0) return [];
    return previewFields.filter(
      (f) => selectedIds.includes(f.id) && !f.name.startsWith("_")
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
  const rawPreview = useMemo(() => {
    if (isConfigured) return null;
    if (!activeDataFrameId) return null;

    const sourceFrame = getDataFrame(activeDataFrameId);
    if (!sourceFrame) return null;

    // Return first 50 rows of raw data
    return {
      dataFrame: {
        ...sourceFrame.data,
        rows: sourceFrame.data.rows.slice(0, 50),
      },
      rowCount: sourceFrame.data.rows.length,
      sampleSize: Math.min(50, sourceFrame.data.rows.length),
    };
  }, [isConfigured, activeDataFrameId, getDataFrame]);

  // Aggregated preview for configured state
  // NOTE: This is computed AFTER onDemandJoinPreview is available, but we can't use it
  // directly here due to hook ordering. We'll compute aggregation separately below.
  const aggregatedPreview = useMemo<PreviewResult | null>(() => {
    if (!isConfigured) return null;
    if (!dataTable?.dataFrameId) return null;

    const sourceDataFrameEnhanced = getDataFrame(dataTable.dataFrameId);
    if (!sourceDataFrameEnhanced) return null;

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

      return computeInsightPreview(
        insightForCompute as any,
        dataTableForCompute as any,
        sourceDataFrameEnhanced.data
      );
    } catch (error) {
      console.error("Failed to compute preview:", error);
      return null;
    }
  }, [isConfigured, insight, insightId, dataTable, fields, insightMetrics, getDataFrame]);

  // Use appropriate preview based on state
  const preview = isConfigured ? aggregatedPreview : rawPreview;

  // Raw data preview for configured state (shows source data with clickable headers)
  // Must be called unconditionally to satisfy Rules of Hooks
  const rawDataPreview = useMemo(() => {
    if (!isConfigured) return null;
    if (!activeDataFrameId) return null;
    const sourceFrame = getDataFrame(activeDataFrameId);
    if (!sourceFrame) return null;
    return {
      dataFrame: {
        ...sourceFrame.data,
        rows: sourceFrame.data.rows.slice(0, 20),
      },
      rowCount: sourceFrame.data.rows.length,
      sampleSize: Math.min(20, sourceFrame.data.rows.length),
    };
  }, [isConfigured, activeDataFrameId, getDataFrame]);

  // Join preview data - computed ON-DEMAND from source tables using join config
  // This ensures we always show raw joined data, not aggregated data
  const onDemandJoinPreview = useMemo(() => {
    // Get base table DataFrame
    if (!dataTable?.dataFrameId) return null;
    const baseFrame = getDataFrame(dataTable.dataFrameId);
    if (!baseFrame) return null;

    // Helper to build columns from fields
    const buildColumnsFromFields = (tableFields: LocalField[]): NonNullable<DataFrame["columns"]> => {
      return tableFields
        .filter((f) => !f.name.startsWith("_"))
        .map((f) => ({
          name: f.columnName ?? f.name,
          type: f.type,
        }));
    };

    // If no joins, just return base table data
    if (!insight.joins?.length) {
      const baseColumns = baseFrame.data.columns ?? buildColumnsFromFields(fields);
      const columns = baseColumns
        .filter((col) => !col.name.startsWith("_"))
        .map((col) => ({
          id: col.name,
          name: col.name,
          columnName: col.name,
          type: col.type,
          _isJoined: false,
        }));

      return {
        columns,
        rows: baseFrame.data.rows.slice(0, 20),
        rowCount: baseFrame.data.rows.length,
      };
    }

    // Compute the join on-demand from source tables
    let currentData: DataFrame = {
      ...baseFrame.data,
      columns: baseFrame.data.columns ?? buildColumnsFromFields(fields),
    };

    // Apply each join in sequence
    for (const join of insight.joins) {
      // Find the joined table's DataFrame
      const joinDetail = joinTableDetails.find((j) => j.id === join.id);
      if (!joinDetail?.joinTable?.dataFrameId) continue;

      const joinFrame = getDataFrame(joinDetail.joinTable.dataFrameId);
      if (!joinFrame) continue;

      // Get join column names
      const baseField = fields.find((f) => f.id === join.joinOn.baseField);
      const joinedField = joinDetail.joinFields.find(
        (f: LocalField) => f.id === join.joinOn.joinedField
      );
      if (!baseField || !joinedField) continue;

      const leftColName = baseField.columnName ?? baseField.name;
      const rightColName = joinedField.columnName ?? joinedField.name;

      // Build join table columns
      const joinColumns = joinFrame.data.columns ?? buildColumnsFromFields(joinDetail.joinFields);

      // Perform the join
      try {
        currentData = joinDataFrames(
          currentData,
          { ...joinFrame.data, columns: joinColumns },
          {
            on: { left: leftColName, right: rightColName },
            how: join.joinType,
            suffixes: { left: "_base", right: "_join" },
          }
        );
      } catch (err) {
        console.error("On-demand join failed:", err);
        // Continue with what we have
      }
    }

    // Build column metadata for the preview
    const columns = (currentData.columns ?? [])
      .filter((col) => !col.name.startsWith("_"))
      .map((col) => {
        // Determine if column is from a joined table
        const baseName = col.name.replace(/_base$/, "").replace(/_join$/, "");
        const isFromBase = allTableFields.some(
          (f) => (f.columnName ?? f.name) === col.name || (f.columnName ?? f.name) === baseName
        );
        return {
          id: col.name,
          name: col.name,
          columnName: col.name,
          type: col.type,
          _isJoined: !isFromBase || col.name.endsWith("_join"),
        };
      });

    return {
      columns,
      rows: currentData.rows.slice(0, 20),
      rowCount: currentData.rows.length,
    };
  }, [dataTable?.dataFrameId, getDataFrame, fields, insight.joins, joinTableDetails, allTableFields]);

  // Use the on-demand computed columns for join preview
  const joinPreviewColumns = onDemandJoinPreview?.columns ?? previewFields;

  // Compute aggregated result using the on-demand joined data
  // This properly handles joined column names (with suffixes like _join)
  const joinedAggregatedPreview = useMemo<PreviewResult | null>(() => {
    if (!isConfigured) return null;
    if (!onDemandJoinPreview) return null;

    // Get the selected fields from joinPreviewColumns
    const selectedFieldIds = insight.baseTable?.selectedFields ?? [];
    if (selectedFieldIds.length === 0) return null;

    // Map selected field IDs to actual column names from the join preview
    // For base table fields, use original ID; for joined columns, match by name
    const selectedColumns = joinPreviewColumns.filter((col) => {
      // Check if this column's ID matches a selected field
      // Or if the column name (without suffix) matches
      const baseName = col.name.replace(/_base$/, "").replace(/_join$/, "");
      return selectedFieldIds.some((id) => {
        const field = fields.find((f) => f.id === id);
        if (field) {
          const fieldColName = field.columnName ?? field.name;
          return fieldColName === col.name || fieldColName === baseName;
        }
        // Also check joined table fields
        for (const detail of joinTableDetails) {
          const joinField = detail.joinFields.find((f: LocalField) => f.id === id);
          if (joinField) {
            const joinFieldColName = joinField.columnName ?? joinField.name;
            return joinFieldColName === col.name || joinFieldColName === baseName;
          }
        }
        return false;
      });
    });

    if (selectedColumns.length === 0) return null;

    // Group rows by selected columns
    const groupMap = new Map<string, Record<string, unknown>[]>();
    for (const row of onDemandJoinPreview.rows) {
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

      // Add group key values (using field.name as output key)
      for (const col of selectedColumns) {
        row[col.name] = groupRows[0][col.name];
      }

      // Compute metrics
      for (const metric of insightMetrics) {
        if (metric.name.startsWith("_")) continue;

        // Find the actual column name in the joined data
        // The metric.columnName might be the original name, but joined data has suffixes
        let actualColumnName: string | undefined = metric.columnName;
        const possibleNames = [
          metric.columnName,
          `${metric.columnName}_join`,
          `${metric.columnName}_base`,
        ];

        for (const name of possibleNames) {
          if (joinPreviewColumns.some((c) => c.name === name)) {
            actualColumnName = name;
            break;
          }
        }

        let value = 0;
        switch (metric.aggregation) {
          case "count":
            value = groupRows.length;
            break;
          case "count_distinct":
            if (actualColumnName) {
              const values = groupRows.map((r) => r[actualColumnName]).filter((v) => v != null);
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
              value = values.length > 0
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
    const resultColumns: Array<{ name: string; type: "string" | "number" | "boolean" | "date" | "unknown" }> = [
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
  }, [isConfigured, onDemandJoinPreview, joinPreviewColumns, insight.baseTable?.selectedFields, fields, joinTableDetails, insightMetrics]);

  // Use joined aggregation when we have joins, otherwise use base table aggregation
  const effectiveAggregatedPreview = insight.joins?.length
    ? joinedAggregatedPreview
    : aggregatedPreview;

  const rowCount = preview?.rowCount ?? 0;
  const sampleSize = preview?.sampleSize ?? 0;
  const columnCount = previewFields.length + visibleMetrics.length;

  // Build field map from preview fields (includes joined columns if present)
  const fieldMap = useMemo<Record<string, { id: string; name: string; type: string }>>(() => {
    const map: Record<string, { id: string; name: string; type: string }> = {};
    previewFields.forEach((f) => {
      map[f.name] = { id: f.id, name: f.name, type: f.type };
    });
    return map;
  }, [previewFields]);

  // Generate chart suggestions (only for unconfigured state)
  const suggestions = useMemo<ChartSuggestion[]>(() => {
    if (isConfigured || !rawPreview) return [];

    // Use active DataFrame (joined if available, otherwise base table)
    const sourceFrame = getDataFrame(activeDataFrameId ?? "");
    if (!sourceFrame) return [];

    try {
      const previewEnhanced = {
        metadata: {
          id: "preview",
          name: insight.name,
          source: { insightId: insightId.toString() },
          timestamp: Date.now(),
          rowCount: sourceFrame.metadata.rowCount,
          columnCount: sourceFrame.metadata.columnCount,
        },
        data: rawPreview.dataFrame,
      };

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

      return suggestCharts(
        insightForSuggestions as any,
        previewEnhanced,
        fieldMap as any,
        3,
        columnTableMap
      );
    } catch (error) {
      console.error("Failed to generate suggestions:", error);
      return [];
    }
  }, [isConfigured, rawPreview, insight, insightId, fieldMap, dataTable, activeDataFrameId, getDataFrame, columnTableMap]);

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
    expr: string
  ): { aggregation: InsightMetric["aggregation"]; columnName: string } | null => {
    const match = expr.match(/^(sum|avg|count|min|max|count_distinct)\(([^)]+)\)$/i);
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

    const sourceDataFrameEnhanced = getDataFrame(activeDataFrameId);
    if (!sourceDataFrameEnhanced) return;

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

    // Compute aggregated data
    const aggregatedDataFrame = computeInsightDataFrame(
      computeInsight as any,
      computeDataTable as any,
      sourceDataFrameEnhanced.data
    );

    // Store the computed DataFrame
    const createFromInsight = useDataFramesStore.getState().createFromInsight;
    const computedDataFrameId = createFromInsight(
      insightId,
      `${suggestion.title} Data`,
      aggregatedDataFrame
    );

    // Link the computed DataFrame to the insight
    const setInsightDataFrame = useInsightsStore.getState().setInsightDataFrame;
    setInsightDataFrame(insightId, computedDataFrameId);

    // Create visualization using the computed (aggregated) DataFrame
    // The encoding now references actual column names in the aggregated data
    const vizId = createVisualizationLocal(
      {
        dataFrameId: computedDataFrameId,
        insightId: insightId,
      },
      suggestion.title,
      suggestion.spec,
      suggestion.chartType,
      cleanEncoding // Keep original encoding - columns match metric names like "sum(amount)"
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
    const field = fields.find(
      (f) => (f.columnName ?? f.name) === columnName
    );
    if (!field) return;

    // Don't add if already selected
    if (insight.baseTable?.selectedFields?.includes(field.id)) return;

    updateInsightLocal(insightId, {
      baseTable: {
        ...insight.baseTable,
        selectedFields: [...(insight.baseTable?.selectedFields || []), field.id],
      } as any,
    });
  };

  // Remove a field from the selected list
  const handleRemoveField = (fieldId: UUID) => {
    updateInsightLocal(insightId, {
      baseTable: {
        ...insight.baseTable,
        selectedFields:
          insight.baseTable?.selectedFields?.filter((id) => id !== fieldId) || [],
      } as any,
    });
  };

  // Add a metric from column header click
  const handleAddMetric = (
    columnName: string,
    aggregation: InsightMetric["aggregation"]
  ) => {
    const metricId = crypto.randomUUID() as UUID;
    const metricName = `${aggregation}(${columnName})`;

    // Check if metric already exists
    const exists = insightMetrics.some(
      (m) => m.columnName === columnName && m.aggregation === aggregation
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
      const setInsightDataFrame = useInsightsStore.getState().setInsightDataFrame;
      setInsightDataFrame(insightId, undefined as any);
    }
  };

  // Build ItemList items for Data Sources section
  const dataSourceItems = useMemo<ListItem[]>(() => {
    // Get base table metadata
    const baseDataFrame = dataTable?.dataFrameId ? getDataFrame(dataTable.dataFrameId) : undefined;
    const baseRowCount = baseDataFrame?.metadata.rowCount ?? 0;
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
  }, [dataTable, dataSource, allTableFields, joinTableDetails, getDataFrame, getSourceTypeLabel, handleRemoveJoin]);

  const dataSummary = `${rowCount.toLocaleString()} rows • ${columnCount} fields • ${visibleMetrics.length} metrics`;

  // Render unconfigured state (draft insight)
  if (!isConfigured) {
    return (
      <div className="flex-1">
        <div className="container mx-auto px-6 py-6 max-w-6xl space-y-6">
          {/* Data Sources Section with ItemList */}
          <section className="space-y-3 rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-muted-foreground">
                  Data sources
                </p>
                <p className="text-sm text-foreground">
                  Tables used in this insight
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsJoinFlowOpen(true)}
              >
                <LuPlus className="h-4 w-4 mr-1" />
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
          <section className="space-y-4 rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-muted-foreground">
                  Data preview
                </p>
                <p className="text-sm text-foreground">
                  First {sampleSize || rowCount} rows
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{dataSummary}</span>
                <span>•</span>
                <span>{dataSourceTypeLabel}</span>
              </div>
            </div>
            {preview ? (
              <div className="relative overflow-hidden rounded-xl border bg-muted/20">
                <div className="overflow-auto" style={{ maxHeight: 260 }}>
                  <table className="w-full text-sm border-separate border-spacing-0">
                    <thead className="sticky top-0 z-10 bg-card">
                      <tr>
                        {previewFields.map((field) => (
                          <th
                            key={field.id}
                            className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground"
                          >
                            {field.name}
                          </th>
                        ))}
                        {visibleMetrics.map((metric) => (
                          <th
                            key={metric.id}
                            className="px-3 py-2 text-left text-xs font-semibold text-primary"
                          >
                            {metric.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.dataFrame.rows.map((row, idx) => (
                        <tr key={idx} className="border-b last:border-0">
                          {previewFields.map((field) => (
                            <td
                              key={field.id}
                              className="px-3 py-2 text-xs whitespace-nowrap"
                            >
                              {formatCellValue(
                                (row as Record<string, unknown>)[field.columnName ?? field.name]
                              )}
                            </td>
                          ))}
                          {visibleMetrics.map((metric) => (
                            <td
                              key={metric.id}
                              className="px-3 py-2 text-xs font-medium text-primary whitespace-nowrap"
                            >
                              {formatCellValue(
                                (row as Record<string, unknown>)[metric.name]
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
              <p className="text-sm text-muted-foreground">
                No data available. The data source may not have been loaded yet.
              </p>
            )}
          </section>

          {/* Suggested Charts Section */}
          <section className="space-y-4">
            <div className="flex items-end justify-between">
              <div>
                <h3 className="text-lg font-semibold text-foreground">
                  Suggested charts
                </h3>
              </div>
              <p className="text-xs text-muted-foreground">
                Click a suggestion to create a visualization
              </p>
            </div>
            <SuggestedInsights
              suggestions={suggestions}
              onCreateChart={handleCreateChart}
            />
          </section>
        </div>

        {/* Sticky Footer Actions */}
        <div className="sticky bottom-0 border-t bg-card/90 backdrop-blur-sm px-6 py-4">
          <div className="container mx-auto max-w-6xl">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
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
    const isNumeric = columnType === "number" || columnType === "integer" || columnType === "float";
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
          <button className="flex items-center gap-1 px-3 py-2 text-left text-xs font-semibold text-muted-foreground hover:bg-muted/50 transition-colors">
            {columnName}
            <LuChevronDown className="h-3 w-3 opacity-50" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuLabel className="text-xs">Add "{columnName}" as</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => handleAddField(columnName)}
            disabled={isAlreadyField}
          >
            <LuHash className="h-4 w-4 mr-2" />
            Field (group by)
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <LuCalculator className="h-4 w-4 mr-2" />
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
      <div className="container mx-auto px-6 py-6 max-w-6xl space-y-6">
        {/* Data Sources Section with ItemList */}
        <section className="space-y-3 rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-muted-foreground">
                Data sources
              </p>
              <p className="text-sm text-foreground">
                Tables used in this insight
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsJoinFlowOpen(true)}
            >
              <LuPlus className="h-4 w-4 mr-1" />
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
                <p className="text-xs text-muted-foreground">
                  Combined data from {1 + (insight.joins?.length ?? 0)} table{(insight.joins?.length ?? 0) !== 0 ? "s" : ""} • Click headers to add fields
                </p>
              </div>
              <div className="text-xs text-muted-foreground">
                {onDemandJoinPreview?.rowCount.toLocaleString()} rows
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {onDemandJoinPreview ? (
              <div className="relative overflow-hidden rounded-xl border bg-muted/20">
                <div className="overflow-auto" style={{ maxHeight: 200 }}>
                  <table className="w-full text-sm border-separate border-spacing-0">
                    <thead className="sticky top-0 z-10 bg-card">
                      <tr>
                        {joinPreviewColumns.map((field) => (
                          <th key={field.id} className="text-left">
                            <ColumnHeaderDropdown
                              columnName={field.columnName ?? field.name}
                              columnType={field.type}
                            />
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {onDemandJoinPreview.rows.map((row, idx) => (
                        <tr key={idx} className="border-b last:border-0">
                          {joinPreviewColumns.map((field) => (
                            <td
                              key={field.id}
                              className="px-3 py-2 text-xs whitespace-nowrap"
                            >
                              {formatCellValue(
                                (row as Record<string, unknown>)[
                                  field.columnName ?? field.name
                                ]
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
              <p className="text-sm text-muted-foreground">
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
                <p className="text-xs text-muted-foreground">
                  Columns to group by
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {selectedFields.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {selectedFields.map((field) => {
                  const isJoined = (field as LocalField & { _isJoined?: boolean })._isJoined;
                  return (
                    <Badge
                      key={field.id}
                      variant="secondary"
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm"
                    >
                      <LuHash className="h-3 w-3" />
                      <span>{field.name}</span>
                      <span className="text-muted-foreground text-[10px]">{field.type}</span>
                      <span className="bg-muted px-1.5 py-0.5 rounded text-[10px]">
                        {isJoined ? "joined" : "base"}
                      </span>
                      <button
                        onClick={() => handleRemoveField(field.id)}
                        className="ml-0.5 hover:bg-muted rounded-full p-0.5"
                      >
                        <LuX className="h-3 w-3" />
                      </button>
                    </Badge>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
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
                <p className="text-xs text-muted-foreground">
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
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary/10 text-primary"
                  >
                    <LuCalculator className="h-3 w-3" />
                    <span>{metric.name}</span>
                    <span className="text-primary/60 text-[10px]">{metric.aggregation}</span>
                    <span className="bg-primary/20 px-1.5 py-0.5 rounded text-[10px]">base</span>
                    <button
                      onClick={() => handleRemoveMetric(metric.id)}
                      className="ml-0.5 hover:bg-primary/20 rounded-full p-0.5"
                    >
                      <LuX className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
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
                  <p className="text-xs text-muted-foreground">
                    {effectiveAggregatedPreview.rowCount} groups
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="relative overflow-hidden rounded-xl border bg-muted/20">
                <div className="overflow-auto" style={{ maxHeight: 200 }}>
                  <table className="w-full text-sm border-separate border-spacing-0">
                    <thead className="sticky top-0 z-10 bg-card">
                      <tr>
                        {/* Use columns from the aggregated result for correct names */}
                        {effectiveAggregatedPreview.dataFrame.columns
                          ?.filter((col) => !visibleMetrics.some((m) => m.name === col.name))
                          .map((col) => (
                            <th
                              key={col.name}
                              className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground"
                            >
                              {col.name}
                            </th>
                          ))}
                        {visibleMetrics.map((metric) => (
                          <th
                            key={metric.id}
                            className="px-3 py-2 text-left text-xs font-semibold text-primary"
                          >
                            {metric.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {effectiveAggregatedPreview.dataFrame.rows.slice(0, 10).map((row, idx) => (
                        <tr key={idx} className="border-b last:border-0">
                          {effectiveAggregatedPreview.dataFrame.columns
                            ?.filter((col) => !visibleMetrics.some((m) => m.name === col.name))
                            .map((col) => (
                              <td
                                key={col.name}
                                className="px-3 py-2 text-xs whitespace-nowrap"
                              >
                                {formatCellValue(
                                  (row as Record<string, unknown>)[col.name]
                                )}
                              </td>
                            ))}
                          {visibleMetrics.map((metric) => (
                            <td
                              key={metric.id}
                              className="px-3 py-2 text-xs font-medium text-primary whitespace-nowrap"
                            >
                              {formatCellValue(
                                (row as Record<string, unknown>)[metric.name]
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
            <p className="text-xs text-muted-foreground">
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
      <div className="sticky bottom-0 border-t bg-card/90 backdrop-blur-sm px-6 py-4">
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
