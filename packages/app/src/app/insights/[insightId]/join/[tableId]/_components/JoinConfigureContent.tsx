import { useDataFramePagination } from "@/hooks/useDataFramePagination";
import { useInsightPagination } from "@/hooks/useInsightPagination";
import { api } from "@/wystack/api";
import { fieldIdToColumnAlias } from "@dashframe/engine";
import type {
  DataFrameRow,
  DataTable,
  Field,
  Insight,
  InsightJoinConfig,
} from "@dashframe/types";
import { cmd } from "@dashframe/types";
import {
  VirtualTable,
  type VirtualTableColumn,
  type VirtualTableColumnConfig,
} from "@dashframe/ui";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@wystack/client";
import {
  Alert,
  AlertDescription,
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Surface,
} from "@wystack/ui-react";
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  MergeIcon,
} from "@wystack/ui-react/icons";
import { useCallback, useMemo, useState } from "react";
import {
  findExistingJoinsToTable,
  isExactDuplicateJoin,
} from "./join-duplicate-guard";
import { runJoinSubmit } from "./join-preview-run";

interface JoinConfigureContentProps {
  insightId: string;
  tableId: string;
}

/** Local type for join preview result (static data for VirtualTable) */
interface JoinPreviewData {
  columns: VirtualTableColumn[];
  rows: DataFrameRow[];
}

const PREVIEW_ROW_LIMIT = 50;
type JoinType = "inner" | "left" | "right" | "outer";

export function buildJoinPreviewInsight(
  insight: Insight,
  joinTable: DataTable,
  leftField: Field,
  rightField: Field,
  joinType: JoinType,
): Insight {
  return {
    ...insight,
    selectedFields: [],
    metrics: [],
    joins: [
      ...(insight.joins ?? []),
      {
        type: joinType === "outer" ? "full" : joinType,
        rightTableId: joinTable.id,
        leftKey: leftField.columnName ?? leftField.name,
        rightKey: rightField.columnName ?? rightField.name,
      },
    ],
  };
}

/**
 * Join Configuration Page
 *
 * Provides a full-page experience for configuring joins between two tables:
 * - Side-by-side table previews (responsive: stacked on narrow screens)
 * - Column selection for join keys
 * - Join type selection
 * - Live preview of join result
 */
export default function JoinConfigureContent({
  insightId,
  tableId: joinTableId,
}: JoinConfigureContentProps) {
  const navigate = useNavigate();

  const { data: allInsights, isLoading: isInsightsLoading } = useQuery(
    api.listInsights,
    { args: {} },
  );
  const { data: allDataTables, isLoading: isTablesLoading } = useQuery(
    api.listDataTables,
    { args: {} },
  );
  const { mutateAsync: commitBatch } = useMutation(api.commitBatch);

  const isLoading = isInsightsLoading || isTablesLoading;

  // Find the current insight
  const insight = useMemo(
    () => allInsights?.find((i) => i.id === insightId),
    [allInsights, insightId],
  );

  // Join configuration state
  const [leftFieldId, setLeftFieldId] = useState<string | null>(null);
  const [rightFieldId, setRightFieldId] = useState<string | null>(null);
  const [joinType, setJoinType] = useState<JoinType>("inner");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Resolve base table (from insight's baseTableId)
  const baseTable = useMemo(() => {
    if (!insight || !allDataTables) return null;
    return allDataTables.find((t) => t.id === insight.baseTableId) ?? null;
  }, [insight, allDataTables]);

  // Resolve join table (from tableId param)
  const joinTable = useMemo(() => {
    if (!allDataTables) return null;
    return allDataTables.find((t) => t.id === joinTableId) ?? null;
  }, [allDataTables, joinTableId]);

  // Pagination hooks for async VirtualTable (full dataset browsing)
  const {
    fetchData: fetchBaseData,
    totalCount: baseTotalCount,
    isReady: isBaseReady,
  } = useDataFramePagination(baseTable?.dataFrameId);

  const {
    fetchData: fetchJoinData,
    totalCount: joinTotalCount,
    isReady: isJoinReady,
  } = useDataFramePagination(joinTable?.dataFrameId);

  // Filter out internal fields (those starting with _)
  const baseFields = useMemo(
    () => baseTable?.fields?.filter((f) => !f.name.startsWith("_")) ?? [],
    [baseTable],
  );

  const joinFields = useMemo(
    () => joinTable?.fields?.filter((f) => !f.name.startsWith("_")) ?? [],
    [joinTable],
  );

  const previewInsight = useMemo<Insight | null>(() => {
    if (!insight || !joinTable || !leftFieldId || !rightFieldId) return null;
    const leftField = baseFields.find((field) => field.id === leftFieldId);
    const rightField = joinFields.find((field) => field.id === rightFieldId);
    if (!leftField || !rightField) return null;
    return buildJoinPreviewInsight(
      insight as Insight,
      joinTable,
      leftField,
      rightField,
      joinType,
    );
  }, [
    baseFields,
    insight,
    joinFields,
    joinTable,
    joinType,
    leftFieldId,
    rightFieldId,
  ]);
  const preview = useInsightPagination({
    insight: previewInsight ?? ({} as Insight),
    showModelPreview: true,
    enabled: previewInsight !== null,
  });
  const previewResult = useMemo<JoinPreviewData | null>(
    () =>
      preview.isReady
        ? {
            columns: preview.columns,
            rows: preview.sampleRows.slice(
              0,
              PREVIEW_ROW_LIMIT,
            ) as DataFrameRow[],
          }
        : null,
    [preview.columns, preview.isReady, preview.sampleRows],
  );
  const previewTotalCount = preview.totalCount;
  const isComputingPreview = previewInsight !== null && !preview.isReady;

  // Detect existing joins to this right table so the UI can label instances.
  // A non-empty list means the user is adding a second (or further) join to the
  // same table — legitimate (e.g. orders→users on created_by AND approved_by),
  // but the UI must disambiguate the instances clearly.
  const existingJoinsToThisTable = useMemo(
    () => findExistingJoinsToTable(insight?.joins, joinTableId),
    [insight?.joins, joinTableId],
  );

  // Normalise the UI join type ("outer") to the stored config type ("full").
  // Used in both duplicate detection and persist — single source of truth.
  const toConfigType = useCallback(
    (t: typeof joinType): InsightJoinConfig["type"] =>
      t === "outer" ? "full" : t,
    [],
  );

  // Exact-duplicate detection: same table + same keys + same type.
  // Not a hard block — just surfaces a non-blocking warning so the user knows
  // they are adding a redundant join rather than a different-key one.
  const isExactDuplicate = useMemo(() => {
    if (!leftFieldId || !rightFieldId || existingJoinsToThisTable.length === 0)
      return false;
    const leftField = baseFields.find((f) => f.id === leftFieldId);
    const rightField = joinFields.find((f) => f.id === rightFieldId);
    if (!leftField || !rightField) return false;
    const leftKey = leftField.columnName ?? leftField.name;
    const rightKey = rightField.columnName ?? rightField.name;
    return isExactDuplicateJoin(existingJoinsToThisTable, {
      leftKey,
      rightKey,
      type: toConfigType(joinType),
    });
  }, [
    leftFieldId,
    rightFieldId,
    existingJoinsToThisTable,
    baseFields,
    joinFields,
    joinType,
    toConfigType,
  ]);

  // Column configs for highlighting selected columns in source tables
  const baseColumnConfigs = useMemo((): VirtualTableColumnConfig[] => {
    const leftField = baseFields.find((f) => f.id === leftFieldId);
    if (!leftField) return [];
    return [{ id: leftField.columnName ?? leftField.name, highlight: true }];
  }, [baseFields, leftFieldId]);

  const joinColumnConfigs = useMemo((): VirtualTableColumnConfig[] => {
    const rightField = joinFields.find((f) => f.id === rightFieldId);
    if (!rightField) return [];
    return [{ id: rightField.columnName ?? rightField.name, highlight: true }];
  }, [joinFields, rightFieldId]);

  // Column configs for the preview result - highlight base vs join columns
  const previewColumnConfigs = useMemo((): VirtualTableColumnConfig[] => {
    if (!previewResult?.columns) return [];
    const baseAliases = new Set(
      baseFields.map((field) => fieldIdToColumnAlias(field.id)),
    );
    const joinAliases = joinFields.map((field) =>
      fieldIdToColumnAlias(field.id),
    );
    const configs: VirtualTableColumnConfig[] = [];
    for (const column of previewResult.columns) {
      if (baseAliases.has(column.name)) {
        configs.push({ id: column.name, highlight: "base" });
        continue;
      }
      if (
        joinAliases.some(
          (alias) =>
            column.name === alias || column.name.startsWith(`${alias}_j`),
        )
      ) {
        configs.push({ id: column.name, highlight: "join" });
      }
    }
    return configs;
  }, [baseFields, joinFields, previewResult]);

  type SuggestionRow = {
    leftField: (typeof baseFields)[0];
    rightField: (typeof joinFields)[0];
    columnName: string;
    matchingValues: number;
  };
  const columnSuggestions = useMemo<SuggestionRow[]>(() => {
    const baseColMap = new Map<
      string,
      { field: (typeof baseFields)[0]; name: string }
    >();
    for (const field of baseFields) {
      const colName = field.columnName ?? field.name;
      baseColMap.set(colName.toLowerCase(), { field, name: colName });
    }

    const pairs: SuggestionRow[] = [];
    for (const joinField of joinFields) {
      const joinColName = joinField.columnName ?? joinField.name;
      const baseMatch = baseColMap.get(joinColName.toLowerCase());
      if (baseMatch) {
        pairs.push({
          leftField: baseMatch.field,
          rightField: joinField,
          columnName: joinColName,
          matchingValues: 0,
        });
      }
    }
    return pairs;
  }, [baseFields, joinFields]);

  // Apply a suggestion
  const applySuggestion = useCallback((pair: (typeof columnSuggestions)[0]) => {
    setLeftFieldId(pair.leftField.id);
    setRightFieldId(pair.rightField.id);
  }, []);

  // Execute full join and add to existing insight
  // Note: We only store the join configuration here. The actual join is computed
  // on-demand when displaying the preview in InsightConfigureTab.
  const handleExecuteJoin = useCallback(async () => {
    if (!leftFieldId || !rightFieldId) {
      setError("Select both join columns.");
      return;
    }

    if (!baseTable || !joinTable || !insight) {
      setError("Unable to load table data.");
      return;
    }

    const leftField = baseFields.find((f) => f.id === leftFieldId);
    const rightField = joinFields.find((f) => f.id === rightFieldId);

    if (!leftField || !rightField) {
      setError("Selected columns are no longer available.");
      return;
    }

    setError(null);

    // Validate the join works by testing it (using preview result)
    // The preview is already computed, so we just check if it succeeded
    if (!previewResult || previewResult.rows.length === 0) {
      // Still allow the join even with 0 rows - user may want to keep the config
      // Just warn them in the UI (handled by the existing Alert component)
    }

    // runJoinSubmit owns the try/catch/finally: it always restores the button,
    // surfaces an error on rejection, and only navigates on success.
    await runJoinSubmit({
      persist: async () => {
        // Create join config using the Core schema
        // Uses column names (strings) as join keys, not field UUIDs
        const joinConfig: InsightJoinConfig = {
          type: toConfigType(joinType),
          rightTableId: joinTable.id,
          leftKey: leftField.columnName ?? leftField.name,
          rightKey: rightField.columnName ?? rightField.name,
        };

        // Add join to existing insight (append via AddJoin)
        await commitBatch({
          commands: [cmd("AddJoin", { id: insightId, join: joinConfig })],
        });

        // Note: We intentionally do NOT store a pre-computed joined DataFrame here.
        // The join preview in InsightConfigureTab computes the join on-demand,
        // which ensures we always show raw joined data (not aggregated data).
      },
      // Navigate back to the same insight only on success.
      onSuccess: () => navigate({ to: `/insights/${insightId}` } as never),
      setError,
      setSubmitting: setIsSubmitting,
    });
  }, [
    leftFieldId,
    rightFieldId,
    joinType,
    baseTable,
    joinTable,
    baseFields,
    joinFields,
    insight,
    insightId,
    commitBatch,
    previewResult,
    navigate,
    toConfigType,
  ]);

  // Loading state - wait for all stores to hydrate before rendering
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-neutral-bg">
        <div className="flex flex-col items-center gap-4">
          <Spinner size="lg" className="text-neutral-fg-subtle" />
          <p className="text-sm text-neutral-fg-subtle">
            Loading join configuration...
          </p>
        </div>
      </div>
    );
  }

  // Error states
  if (!insight) {
    return (
      <div className="flex h-full items-center justify-center bg-neutral-bg">
        <Surface elevation="raised" className="p-8 text-center">
          <AlertCircleIcon className="mx-auto mb-4 h-10 w-10 text-neutral-fg-subtle" />
          <h2 className="text-xl font-semibold">Insight not found</h2>
          <p className="mt-2 text-sm text-neutral-fg-subtle">
            The insight you&apos;re looking for doesn&apos;t exist.
          </p>
          <Button
            label="Go to Insights"
            onClick={() => navigate({ to: "/insights" })}
            className="mt-4"
          />
        </Surface>
      </div>
    );
  }

  if (!baseTable) {
    return (
      <div className="flex h-full items-center justify-center bg-neutral-bg">
        <Surface elevation="raised" className="p-8 text-center">
          <AlertCircleIcon className="mx-auto mb-4 h-10 w-10 text-neutral-fg-subtle" />
          <h2 className="text-xl font-semibold">Base table not found</h2>
          <p className="mt-2 text-sm text-neutral-fg-subtle">
            The data table for this insight no longer exists.
          </p>
          <Button
            label="Go to Insights"
            onClick={() => navigate({ to: "/insights" })}
            className="mt-4"
          />
        </Surface>
      </div>
    );
  }

  if (!joinTable) {
    return (
      <div className="flex h-full items-center justify-center bg-neutral-bg">
        <Surface elevation="raised" className="p-8 text-center">
          <AlertCircleIcon className="mx-auto mb-4 h-10 w-10 text-neutral-fg-subtle" />
          <h2 className="text-xl font-semibold">Join table not found</h2>
          <p className="mt-2 text-sm text-neutral-fg-subtle">
            The table you&apos;re trying to join with doesn&apos;t exist.
          </p>
          <Button
            label="Back to Insight"
            onClick={() => navigate({ to: `/insights/${insightId}` } as never)}
            className="mt-4"
          />
        </Surface>
      </div>
    );
  }

  const canJoin = leftFieldId && rightFieldId;

  return (
    <div className="flex h-full flex-col bg-neutral-bg">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b bg-neutral-bg/90 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                icon={ArrowLeftIcon}
                label="Cancel"
                size="sm"
                onClick={() =>
                  navigate({ to: `/insights/${insightId}` } as never)
                }
              />
              <div>
                <h1 className="text-xl font-semibold">
                  {existingJoinsToThisTable.length > 0
                    ? `Join ${existingJoinsToThisTable.length + 1}: ${baseTable.name} + ${joinTable.name}`
                    : `Join: ${baseTable.name} + ${joinTable.name}`}
                </h1>
                <p className="text-sm text-neutral-fg-subtle">
                  Configure how to combine these datasets
                </p>
              </div>
            </div>
            <Button
              icon={MergeIcon}
              loading={isSubmitting}
              label={isSubmitting ? "Joining..." : "Join Tables"}
              onClick={handleExecuteJoin}
              disabled={!canJoin || isSubmitting}
            />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <div className="container mx-auto space-y-6 px-6 py-6">
          {/* Dual Table Previews */}
          <div className="grid gap-6 md:grid-cols-2">
            {/* Base Table Preview */}
            <TablePreviewSection
              title="Base Table"
              table={baseTable}
              totalCount={baseTotalCount}
              isReady={isBaseReady}
              onFetchData={fetchBaseData}
              fields={baseTable.fields}
              columnConfigs={baseColumnConfigs}
              onHeaderClick={(colName) => {
                const field = baseFields.find(
                  (f) => (f.columnName ?? f.name) === colName,
                );
                if (field) setLeftFieldId(field.id);
              }}
            />

            {/* Join Table Preview */}
            <TablePreviewSection
              title="Join Table"
              table={joinTable}
              totalCount={joinTotalCount}
              isReady={isJoinReady}
              onFetchData={fetchJoinData}
              fields={joinTable.fields}
              columnConfigs={joinColumnConfigs}
              onHeaderClick={(colName) => {
                const field = joinFields.find(
                  (f) => (f.columnName ?? f.name) === colName,
                );
                if (field) setRightFieldId(field.id);
              }}
            />
          </div>

          {/* Join Configuration */}
          <Surface elevation="raised" className="rounded-2xl p-6">
            <h2 className="mb-4 text-lg font-semibold">Join Configuration</h2>

            {/* Existing-join disambiguation banner — only shown when this table
                is already joined to the insight at least once. Informs the user
                which keys the prior join(s) use so they can pick different ones
                for a legitimate double-join (e.g. created_by + approved_by). */}
            {existingJoinsToThisTable.length > 0 && (
              <div className="mb-4 rounded-xl border border-neutral-border/60 bg-neutral-bg-muted/50 p-4">
                <p className="mb-2 text-sm font-medium">
                  {joinTable.name} is already joined to this insight
                  {existingJoinsToThisTable.length > 1
                    ? ` (${existingJoinsToThisTable.length} times)`
                    : ""}
                </p>
                <ul className="space-y-1">
                  {existingJoinsToThisTable.map((j, i) => (
                    <li
                      key={`${j.leftKey}|${j.rightKey}|${j.type}|${i}`}
                      className="text-xs text-neutral-fg-subtle"
                    >
                      Join {i + 1}:{" "}
                      <span className="font-mono">{j.leftKey}</span>
                      {" = "}
                      <span className="font-mono">{j.rightKey}</span>
                      {" ("}
                      {j.type === "full" ? "outer" : j.type}
                      {")"}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-neutral-fg-subtle">
                  Joining the same table on different keys is valid — for
                  example, <span className="font-mono">created_by</span> and{" "}
                  <span className="font-mono">approved_by</span> can both join
                  the same users table.
                </p>
              </div>
            )}

            {/* Matching column suggestions */}
            {columnSuggestions.length > 0 && (
              <div className="mb-6 rounded-xl border border-neutral-border/60 bg-neutral-bg-muted/50 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-sm font-medium">
                    Matching columns found
                  </span>
                  <span className="text-xs text-neutral-fg-subtle">
                    – click to select
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {columnSuggestions.map((pair) => (
                    <button
                      key={pair.columnName}
                      type="button"
                      onClick={() => applySuggestion(pair)}
                      className="group flex cursor-pointer items-center gap-2 rounded-lg border border-neutral-border bg-neutral-bg px-3 py-2 text-sm transition-colors hover:border-palette-primary/50 hover:bg-palette-primary/10"
                    >
                      <span className="font-medium text-neutral-fg group-hover:text-palette-primary">
                        {pair.leftField.columnName ?? pair.leftField.name}
                      </span>
                      <span className="text-neutral-fg-subtle">↔</span>
                      <span className="font-medium text-neutral-fg group-hover:text-palette-primary">
                        {pair.rightField.columnName ?? pair.rightField.name}
                      </span>
                      {pair.matchingValues > 0 && (
                        <span className="ml-1 text-xs text-neutral-fg-subtle">
                          ({pair.matchingValues.toLocaleString()} matching)
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid gap-6 lg:grid-cols-2">
              {/* Column Selection */}
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
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
                            <span className="ml-2 text-xs text-neutral-fg-subtle">
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
                            <span className="ml-2 text-xs text-neutral-fg-subtle">
                              ({field.type})
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="join-type">Join type</Label>
                  <Select
                    value={joinType}
                    onValueChange={(value) =>
                      setJoinType(value as "inner" | "left" | "right" | "outer")
                    }
                  >
                    <SelectTrigger id="join-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="inner">
                        Inner
                        <span className="ml-2 text-xs text-neutral-fg-subtle">
                          (only matching rows)
                        </span>
                      </SelectItem>
                      <SelectItem value="left">
                        Left
                        <span className="ml-2 text-xs text-neutral-fg-subtle">
                          (all base + matching)
                        </span>
                      </SelectItem>
                      <SelectItem value="right">
                        Right
                        <span className="ml-2 text-xs text-neutral-fg-subtle">
                          (matching + all join)
                        </span>
                      </SelectItem>
                      <SelectItem value="outer">
                        Outer
                        <span className="ml-2 text-xs text-neutral-fg-subtle">
                          (all rows from both)
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </Surface>

          {/* Exact-duplicate warning — non-blocking; user can still submit */}
          {isExactDuplicate && (
            <Alert color="warning">
              <AlertDescription>
                These keys and join type are identical to an existing join on{" "}
                {joinTable.name}. The result will include duplicate columns.
                Choose different keys to join on a different relationship.
              </AlertDescription>
            </Alert>
          )}

          {/* Error Display */}
          {(error || preview.error) && (
            <Alert color="danger">
              <AlertDescription>{error || preview.error}</AlertDescription>
            </Alert>
          )}

          {/* Preview Result */}
          {canJoin && (
            <Surface elevation="raised" className="rounded-2xl p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Preview Result</h2>
                {isComputingPreview && (
                  <div className="flex items-center gap-2 text-sm text-neutral-fg-subtle">
                    <Spinner size="sm" />
                    Computing preview...
                  </div>
                )}
                {!isComputingPreview && previewResult && (
                  <p className="text-sm text-neutral-fg-subtle">
                    {previewTotalCount.toLocaleString()} total rows
                    {previewTotalCount > PREVIEW_ROW_LIMIT &&
                      ` (showing first ${PREVIEW_ROW_LIMIT})`}
                    {" · "}
                    {previewResult.columns?.length ?? 0} columns
                  </p>
                )}
              </div>

              {/* Preview result or placeholder */}
              {!isComputingPreview && previewResult && (
                <>
                  {/* Legend for column colors */}
                  <div className="mb-3 flex flex-wrap items-center gap-4 text-xs">
                    <div className="flex items-center gap-1.5">
                      <div className="h-3 w-3 rounded bg-palette-info" />
                      <span className="text-neutral-fg-subtle">
                        From {baseTable.name ?? "base table"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="h-3 w-3 rounded bg-palette-success" />
                      <span className="text-neutral-fg-subtle">
                        From {joinTable.name ?? "join table"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="h-3 w-3 rounded bg-palette-warning" />
                      <span className="text-neutral-fg-subtle">
                        In both tables
                      </span>
                    </div>
                  </div>
                  <div
                    className="overflow-hidden rounded-xl border border-neutral-border/60"
                    style={{ maxHeight: 300 }}
                  >
                    <VirtualTable
                      rows={previewResult.rows}
                      columns={previewResult.columns}
                      columnConfigs={previewColumnConfigs}
                      height={300}
                      compact
                    />
                  </div>
                </>
              )}
              {!isComputingPreview && !previewResult && (
                <div className="flex h-40 items-center justify-center text-neutral-fg-subtle">
                  {error || preview.error
                    ? "Unable to generate preview"
                    : "Select join columns to see preview"}
                </div>
              )}

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
  totalCount: number;
  isReady: boolean;
  onFetchData: (
    params: import("@dashframe/ui").FetchDataParams,
  ) => Promise<import("@dashframe/ui").FetchDataResult>;
  fields: Field[];
  columnConfigs?: VirtualTableColumnConfig[];
  onHeaderClick?: (columnName: string) => void;
}

function TablePreviewSection({
  title,
  table,
  totalCount,
  isReady,
  onFetchData,
  fields,
  columnConfigs,
  onHeaderClick,
}: TablePreviewSectionProps) {
  const colCount = fields.filter((f) => !f.name.startsWith("_")).length;

  return (
    <Surface elevation="raised" className="overflow-hidden rounded-2xl">
      <div className="border-b border-neutral-border/60 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs tracking-wide text-neutral-fg-subtle uppercase">
              {title}
            </p>
            <p className="font-semibold">{table.name}</p>
          </div>
          <p className="text-xs text-neutral-fg-subtle">
            {totalCount.toLocaleString()} rows · {colCount} columns
          </p>
        </div>
        <p className="mt-1 text-xs text-neutral-fg-subtle">
          Click a column header to select it for joining
        </p>
      </div>
      <div style={{ height: 260 }} className="overflow-hidden">
        {!isReady ? (
          <div className="flex h-40 items-center justify-center text-neutral-fg-subtle">
            <div className="flex flex-col items-center gap-2">
              <Spinner size="lg" />
              <span className="text-sm">Loading data...</span>
            </div>
          </div>
        ) : (
          <VirtualTable
            onFetchData={onFetchData}
            columnConfigs={columnConfigs}
            height={260}
            onHeaderClick={onHeaderClick}
            compact
          />
        )}
      </div>
    </Surface>
  );
}
