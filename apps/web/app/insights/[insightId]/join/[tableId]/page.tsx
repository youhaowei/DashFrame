"use client";

import { use, useState, useMemo, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { join as joinDataFrames } from "@dashframe/dataframe";
import type { DataFrame, Field } from "@dashframe/dataframe";
import {
  Button,
  Label,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Alert,
  AlertDescription,
  Surface,
  DataFrameTable,
  type ColumnConfig,
  ArrowLeft,
  Merge,
  Loader2,
  AlertCircle,
} from "@dashframe/ui";
import { useInsightsStore } from "@/lib/stores/insights-store";
import { useDataSourcesStore } from "@/lib/stores/data-sources-store";
import { useDataFramesStore } from "@/lib/stores/dataframes-store";
import { convertColumnsToFields } from "@/lib/utils";
import type { DataTable, Insight } from "@/lib/stores/types";

interface PageProps {
  params: Promise<{ insightId: string; tableId: string }>;
}

const PREVIEW_ROW_LIMIT = 50;

/**
 * Join Configuration Page
 *
 * Provides a full-page experience for configuring joins between two tables:
 * - Side-by-side table previews (responsive: stacked on narrow screens)
 * - Column selection for join keys
 * - Join type selection
 * - Live preview of join result
 */
export default function JoinConfigurePage({ params }: PageProps) {
  const { insightId, tableId: joinTableId } = use(params);
  const router = useRouter();

  // Store hooks
  const insight = useInsightsStore((state) => state.getInsight(insightId));
  const createDraftInsight = useInsightsStore((state) => state.createDraft);
  const updateInsight = useInsightsStore((state) => state.updateInsight);
  const setInsightDataFrame = useInsightsStore(
    (state) => state.setInsightDataFrame
  );

  const getAllDataSources = useDataSourcesStore((state) => state.getAll);
  const getLocal = useDataSourcesStore((state) => state.getLocal);
  const addLocal = useDataSourcesStore((state) => state.addLocal);
  const addDataTable = useDataSourcesStore((state) => state.addDataTable);
  const updateDataTable = useDataSourcesStore((state) => state.updateDataTable);

  const getDataFrame = useDataFramesStore((state) => state.get);
  const createDataFrameFromInsight = useDataFramesStore(
    (state) => state.createFromInsight
  );

  // Join configuration state
  const [leftFieldId, setLeftFieldId] = useState<string | null>(null);
  const [rightFieldId, setRightFieldId] = useState<string | null>(null);
  const [joinType, setJoinType] = useState<
    "inner" | "left" | "right" | "outer"
  >("inner");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [previewResult, setPreviewResult] = useState<DataFrame | null>(null);
  const [isComputingPreview, setIsComputingPreview] = useState(false);

  // Resolve base table (from insight)
  const dataSources = useMemo(() => getAllDataSources(), [getAllDataSources]);

  const baseTableInfo = useMemo(() => {
    if (!insight) return null;

    for (const source of dataSources) {
      const table = source.dataTables.get(insight.baseTable.tableId);
      if (table) {
        const dataFrame = table.dataFrameId
          ? getDataFrame(table.dataFrameId)
          : null;
        return { table, dataFrame, source };
      }
    }
    return null;
  }, [insight, dataSources, getDataFrame]);

  // Resolve join table (from tableId param)
  const joinTableInfo = useMemo(() => {
    for (const source of dataSources) {
      const table = source.dataTables.get(joinTableId);
      if (table) {
        const dataFrame = table.dataFrameId
          ? getDataFrame(table.dataFrameId)
          : null;
        return { table, dataFrame, source };
      }
    }
    return null;
  }, [dataSources, joinTableId, getDataFrame]);

  // Filter out internal fields (those starting with _)
  const baseFields = useMemo(
    () => baseTableInfo?.table.fields.filter((f) => !f.name.startsWith("_")) ?? [],
    [baseTableInfo]
  );

  const joinFields = useMemo(
    () => joinTableInfo?.table.fields.filter((f) => !f.name.startsWith("_")) ?? [],
    [joinTableInfo]
  );

  // Column configs for highlighting selected columns
  const baseColumnConfigs = useMemo((): ColumnConfig[] => {
    const leftField = baseFields.find((f) => f.id === leftFieldId);
    if (!leftField) return [];
    return [{ id: leftField.columnName ?? leftField.name, highlight: true }];
  }, [baseFields, leftFieldId]);

  const joinColumnConfigs = useMemo((): ColumnConfig[] => {
    const rightField = joinFields.find((f) => f.id === rightFieldId);
    if (!rightField) return [];
    return [{ id: rightField.columnName ?? rightField.name, highlight: true }];
  }, [joinFields, rightFieldId]);

  // Compute preview when join config changes
  useEffect(() => {
    if (!leftFieldId || !rightFieldId) {
      setPreviewResult(null);
      return;
    }

    if (!baseTableInfo?.dataFrame || !joinTableInfo?.dataFrame) {
      setPreviewResult(null);
      return;
    }

    const leftField = baseFields.find((f) => f.id === leftFieldId);
    const rightField = joinFields.find((f) => f.id === rightFieldId);

    if (!leftField || !rightField) {
      setPreviewResult(null);
      return;
    }

    const leftColumnName = leftField.columnName ?? leftField.name;
    const rightColumnName = rightField.columnName ?? rightField.name;

    setIsComputingPreview(true);
    setError(null);

    // Use setTimeout to allow UI to update before heavy computation
    const timeoutId = setTimeout(() => {
      try {
        // Slice data for preview to avoid expensive full joins
        const previewBaseData: DataFrame = {
          ...baseTableInfo.dataFrame!.data,
          rows: baseTableInfo.dataFrame!.data.rows.slice(0, PREVIEW_ROW_LIMIT),
        };
        const previewJoinData: DataFrame = {
          ...joinTableInfo.dataFrame!.data,
          rows: joinTableInfo.dataFrame!.data.rows.slice(0, PREVIEW_ROW_LIMIT),
        };

        const result = joinDataFrames(previewBaseData, previewJoinData, {
          on: { left: leftColumnName, right: rightColumnName },
          how: joinType,
          suffixes: { left: "_base", right: "_join" },
        });

        setPreviewResult(result);
      } catch (err) {
        console.error("Preview join failed:", err);
        setPreviewResult(null);
        setError("Unable to preview join. Check that the selected columns have matching types.");
      } finally {
        setIsComputingPreview(false);
      }
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [
    leftFieldId,
    rightFieldId,
    joinType,
    baseTableInfo?.dataFrame,
    joinTableInfo?.dataFrame,
    baseFields,
    joinFields,
  ]);

  // Execute full join and create new insight
  const handleExecuteJoin = useCallback(async () => {
    if (!leftFieldId || !rightFieldId) {
      setError("Select both join columns.");
      return;
    }

    if (!baseTableInfo || !joinTableInfo) {
      setError("Unable to load table data.");
      return;
    }

    const leftField = baseFields.find((f) => f.id === leftFieldId);
    const rightField = joinFields.find((f) => f.id === rightFieldId);

    if (!leftField || !rightField) {
      setError("Selected columns are no longer available.");
      return;
    }

    if (!baseTableInfo.dataFrame || !joinTableInfo.dataFrame) {
      setError("Unable to access data. Please refresh and try again.");
      return;
    }

    const leftColumnName = leftField.columnName ?? leftField.name;
    const rightColumnName = rightField.columnName ?? rightField.name;

    setError(null);
    setIsSubmitting(true);

    let joinedDataFrame: DataFrame;
    try {
      joinedDataFrame = joinDataFrames(
        baseTableInfo.dataFrame.data,
        joinTableInfo.dataFrame.data,
        {
          on: { left: leftColumnName, right: rightColumnName },
          how: joinType,
          suffixes: { left: "_left", right: "_right" },
        }
      );
    } catch (err) {
      console.error("Join failed:", err);
      setError("Failed to join tables. Try different columns or join types.");
      setIsSubmitting(false);
      return;
    }

    // Ensure local source exists
    let localSource = getLocal();
    if (!localSource) {
      addLocal("Local Storage");
      localSource = getLocal();
    }

    if (!localSource) {
      setError("Unable to create storage for joined dataset.");
      setIsSubmitting(false);
      return;
    }

    // Create new DataTable for joined data
    const joinedTableId = crypto.randomUUID();
    const joinedTableName = `${baseTableInfo.table.name} + ${joinTableInfo.table.name}`;

    const joinedFields = convertColumnsToFields(
      joinedDataFrame.columns ?? [],
      joinedTableId
    );

    addDataTable(localSource.id, joinedTableName, joinedTableName, {
      id: joinedTableId,
      fields: joinedFields,
    });

    // Create new Insight for joined data
    const joinedInsightName = `${insight?.name ?? "Insight"} + ${joinTableInfo.table.name}`;
    const joinedInsightId = createDraftInsight(
      joinedTableId,
      joinedInsightName,
      joinedFields.map((field) => field.id)
    );

    // Store join metadata
    const joinMeta = {
      id: crypto.randomUUID(),
      tableId: joinTableInfo.table.id,
      selectedFields: [rightField.id],
      joinOn: { baseField: leftField.id, joinedField: rightField.id },
      joinType,
    };

    updateInsight(joinedInsightId, {
      joins: [joinMeta],
    });

    // Store the joined DataFrame
    const joinedDataFrameId = createDataFrameFromInsight(
      joinedInsightId,
      joinedInsightName,
      joinedDataFrame
    );

    setInsightDataFrame(joinedInsightId, joinedDataFrameId);
    updateDataTable(localSource.id, joinedTableId, {
      dataFrameId: joinedDataFrameId,
      lastFetchedAt: Date.now(),
    });

    setIsSubmitting(false);
    router.push(`/insights/${joinedInsightId}`);
  }, [
    leftFieldId,
    rightFieldId,
    joinType,
    baseTableInfo,
    joinTableInfo,
    baseFields,
    joinFields,
    insight,
    getLocal,
    addLocal,
    addDataTable,
    createDraftInsight,
    updateInsight,
    createDataFrameFromInsight,
    setInsightDataFrame,
    updateDataTable,
    router,
  ]);

  // Error states
  if (!insight) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Surface elevation="raised" className="p-8 text-center">
          <AlertCircle className="mx-auto h-10 w-10 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold">Insight not found</h2>
          <p className="text-sm text-muted-foreground mt-2">
            The insight you&apos;re looking for doesn&apos;t exist.
          </p>
          <Button onClick={() => router.push("/insights")} className="mt-4">
            Go to Insights
          </Button>
        </Surface>
      </div>
    );
  }

  if (!baseTableInfo) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Surface elevation="raised" className="p-8 text-center">
          <AlertCircle className="mx-auto h-10 w-10 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold">Base table not found</h2>
          <p className="text-sm text-muted-foreground mt-2">
            The data table for this insight no longer exists.
          </p>
          <Button onClick={() => router.push("/insights")} className="mt-4">
            Go to Insights
          </Button>
        </Surface>
      </div>
    );
  }

  if (!joinTableInfo) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Surface elevation="raised" className="p-8 text-center">
          <AlertCircle className="mx-auto h-10 w-10 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold">Join table not found</h2>
          <p className="text-sm text-muted-foreground mt-2">
            The table you&apos;re trying to join with doesn&apos;t exist.
          </p>
          <Button
            onClick={() => router.push(`/insights/${insightId}`)}
            className="mt-4"
          >
            Back to Insight
          </Button>
        </Surface>
      </div>
    );
  }

  const canJoin = leftFieldId && rightFieldId;

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b bg-card/90 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push(`/insights/${insightId}`)}
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Cancel
              </Button>
              <div>
                <h1 className="text-xl font-semibold">
                  Join: {baseTableInfo.table.name} + {joinTableInfo.table.name}
                </h1>
                <p className="text-sm text-muted-foreground">
                  Configure how to combine these datasets
                </p>
              </div>
            </div>
            <Button
              onClick={handleExecuteJoin}
              disabled={!canJoin || isSubmitting}
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Merge className="h-4 w-4 mr-2" />
              )}
              {isSubmitting ? "Joining..." : "Join Tables"}
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <div className="container mx-auto px-6 py-6 space-y-6">
          {/* Dual Table Previews */}
          <div className="grid gap-6 md:grid-cols-2">
            {/* Base Table Preview */}
            <TablePreviewSection
              title="Base Table"
              table={baseTableInfo.table}
              dataFrame={baseTableInfo.dataFrame?.data ?? null}
              fields={baseTableInfo.table.fields}
              columnConfigs={baseColumnConfigs}
              onHeaderClick={(colName) => {
                const field = baseFields.find(
                  (f) => (f.columnName ?? f.name) === colName
                );
                if (field) setLeftFieldId(field.id);
              }}
            />

            {/* Join Table Preview */}
            <TablePreviewSection
              title="Join Table"
              table={joinTableInfo.table}
              dataFrame={joinTableInfo.dataFrame?.data ?? null}
              fields={joinTableInfo.table.fields}
              columnConfigs={joinColumnConfigs}
              onHeaderClick={(colName) => {
                const field = joinFields.find(
                  (f) => (f.columnName ?? f.name) === colName
                );
                if (field) setRightFieldId(field.id);
              }}
            />
          </div>

          {/* Join Configuration */}
          <Surface elevation="raised" className="p-6 rounded-2xl">
            <h2 className="text-lg font-semibold mb-4">Join Configuration</h2>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="left-column">Base table column</Label>
                <Select
                  value={leftFieldId ?? ""}
                  onValueChange={(value) => setLeftFieldId(value || null)}
                >
                  <SelectTrigger id="left-column">
                    <SelectValue placeholder="Select column..." />
                  </SelectTrigger>
                  <SelectContent>
                    {baseFields.map((field) => (
                      <SelectItem key={field.id} value={field.id}>
                        {field.name}
                        <span className="ml-2 text-xs text-muted-foreground">
                          ({field.type})
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="right-column">Join table column</Label>
                <Select
                  value={rightFieldId ?? ""}
                  onValueChange={(value) => setRightFieldId(value || null)}
                >
                  <SelectTrigger id="right-column">
                    <SelectValue placeholder="Select column..." />
                  </SelectTrigger>
                  <SelectContent>
                    {joinFields.map((field) => (
                      <SelectItem key={field.id} value={field.id}>
                        {field.name}
                        <span className="ml-2 text-xs text-muted-foreground">
                          ({field.type})
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="join-type">Join type</Label>
                <Select
                  value={joinType}
                  onValueChange={(value) =>
                    setJoinType(
                      value as "inner" | "left" | "right" | "outer"
                    )
                  }
                >
                  <SelectTrigger id="join-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inner">
                      Inner
                      <span className="ml-2 text-xs text-muted-foreground">
                        (only matching rows)
                      </span>
                    </SelectItem>
                    <SelectItem value="left">
                      Left
                      <span className="ml-2 text-xs text-muted-foreground">
                        (all base + matching)
                      </span>
                    </SelectItem>
                    <SelectItem value="right">
                      Right
                      <span className="ml-2 text-xs text-muted-foreground">
                        (matching + all join)
                      </span>
                    </SelectItem>
                    <SelectItem value="outer">
                      Outer
                      <span className="ml-2 text-xs text-muted-foreground">
                        (all rows from both)
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </Surface>

          {/* Error Display */}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Preview Result */}
          {canJoin && (
            <Surface elevation="raised" className="p-6 rounded-2xl">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Preview Result</h2>
                {isComputingPreview && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Computing preview...
                  </div>
                )}
                {!isComputingPreview && previewResult && (
                  <p className="text-sm text-muted-foreground">
                    {previewResult.rows.length} rows
                    {previewResult.rows.length >= PREVIEW_ROW_LIMIT &&
                      ` (showing first ${PREVIEW_ROW_LIMIT})`}
                    {" · "}
                    {previewResult.columns?.length ?? 0} columns
                  </p>
                )}
              </div>

              {!isComputingPreview && previewResult ? (
                <div
                  className="border border-border/60 rounded-xl overflow-hidden"
                  style={{ maxHeight: 300 }}
                >
                  <DataFrameTable dataFrame={previewResult} compact />
                </div>
              ) : !isComputingPreview && !previewResult ? (
                <div className="flex items-center justify-center h-40 text-muted-foreground">
                  {error
                    ? "Unable to generate preview"
                    : "Select join columns to see preview"}
                </div>
              ) : null}

              {!isComputingPreview &&
                previewResult &&
                previewResult.rows.length === 0 && (
                  <Alert className="mt-4">
                    <AlertDescription>
                      This join produces 0 rows. Consider using a different join
                      type or checking that the columns have matching values.
                    </AlertDescription>
                  </Alert>
                )}
            </Surface>
          )}
        </div>
      </main>
    </div>
  );
}

// ============================================================================
// Table Preview Section Component
// ============================================================================

interface TablePreviewSectionProps {
  title: string;
  table: DataTable;
  dataFrame: DataFrame | null;
  fields: Field[];
  columnConfigs?: ColumnConfig[];
  onHeaderClick?: (columnName: string) => void;
}

function TablePreviewSection({
  title,
  table,
  dataFrame,
  fields,
  columnConfigs,
  onHeaderClick,
}: TablePreviewSectionProps) {
  const rowCount = dataFrame?.rows.length ?? 0;
  const colCount = dataFrame?.columns?.length ?? fields.length;

  // Slice data for preview
  const previewData = useMemo(() => {
    if (!dataFrame) return null;
    if (dataFrame.rows.length <= PREVIEW_ROW_LIMIT) return dataFrame;
    return {
      ...dataFrame,
      rows: dataFrame.rows.slice(0, PREVIEW_ROW_LIMIT),
    };
  }, [dataFrame]);

  return (
    <Surface elevation="raised" className="rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border/60">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              {title}
            </p>
            <p className="font-semibold">{table.name}</p>
          </div>
          <p className="text-xs text-muted-foreground">
            {rowCount.toLocaleString()} rows · {colCount} columns
          </p>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Click a column header to select it for joining
        </p>
      </div>
      <div style={{ maxHeight: 260 }} className="overflow-hidden">
        {previewData ? (
          <DataFrameTable
            dataFrame={previewData}
            fields={fields}
            columns={columnConfigs}
            onHeaderClick={onHeaderClick}
            compact
          />
        ) : (
          <div className="flex items-center justify-center h-40 text-muted-foreground">
            No data available
          </div>
        )}
      </div>
    </Surface>
  );
}
