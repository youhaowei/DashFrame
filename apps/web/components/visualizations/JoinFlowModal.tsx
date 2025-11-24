"use client";

import { useCallback, useMemo, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Papa, { type ParseError, type ParseResult } from "papaparse";
import { csvToDataFrameWithFields } from "@dashframe/csv";
import { join as joinDataFrames } from "@dashframe/dataframe";
import { Dialog, DialogContent, DialogHeader, DialogTitle, Button, Label, Select, SelectTrigger, SelectValue, SelectContent, SelectItem, Alert, AlertDescription } from "@dashframe/ui";
import { AddConnectionPanel } from "@/components/data-sources/AddConnectionPanel";
import { useDataSourcesStore } from "@/lib/stores/data-sources-store";
import { useDataFramesStore } from "@/lib/stores/dataframes-store";
import { useInsightsStore } from "@/lib/stores/insights-store";
import { convertColumnsToFields } from "@/lib/utils";
import type { Insight, DataTable } from "@/lib/stores/types";

interface JoinFlowModalProps {
  insight: Insight;
  dataTable: DataTable;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

export function JoinFlowModal({
  insight,
  dataTable,
  isOpen,
  onOpenChange,
}: JoinFlowModalProps) {
  const getAllDataSources = useDataSourcesStore((state) => state.getAll);
  const addLocal = useDataSourcesStore((state) => state.addLocal);
  const getLocal = useDataSourcesStore((state) => state.getLocal);
  const addDataTable = useDataSourcesStore((state) => state.addDataTable);
  const createDataFrameFromCSV = useDataFramesStore((state) => state.createFromCSV);

  const [selectedSecondaryId, setSelectedSecondaryId] = useState<string | null>(null);
  const [leftFieldId, setLeftFieldId] = useState<string | null>(null);
  const [rightFieldId, setRightFieldId] = useState<string | null>(null);
  const [joinType, setJoinType] = useState<"inner" | "left" | "right" | "outer">("inner");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const dataSources = useMemo(() => getAllDataSources(), [getAllDataSources]);

  const allTables = useMemo(
    () =>
      dataSources.flatMap((source) =>
        Array.from(source.dataTables.values()).map((table) => ({
          table,
          source,
        }))
      ),
    [dataSources]
  );

  const secondaryEntry = useMemo(() => {
    if (!selectedSecondaryId) return null;
    return allTables.find(({ table }) => table.id === selectedSecondaryId) ?? null;
  }, [selectedSecondaryId, allTables]);

  useEffect(() => {
    if (!isOpen) {
      setSelectedSecondaryId(null);
      setLeftFieldId(null);
      setRightFieldId(null);
      setError(null);
      setIsSubmitting(false);
    }
  }, [isOpen]);

  const handleCSVSelect = useCallback(
    (file: File) => {
      setError(null);

      Papa.parse(file, {
        dynamicTyping: false,
        skipEmptyLines: true,
        complete: (result: ParseResult<string>) => {
          if (result.errors.length) {
            setError(
              result.errors.map((err: ParseError) => err.message).join("\n")
            );
            return;
          }

          let localSource = getLocal();
          if (!localSource) {
            addLocal("Local Storage");
            localSource = getLocal();
          }

          if (!localSource) {
            setError("Failed to create local data source");
            return;
          }

          const tableName = file.name.replace(/\.csv$/i, "");
          const tableId = crypto.randomUUID();
          const { dataFrame, fields, sourceSchema } = csvToDataFrameWithFields(
            result.data,
            tableId
          );

          if (!fields.length) {
            setError("CSV did not contain any columns.");
            return;
          }

          const dataFrameId = createDataFrameFromCSV(
            localSource.id,
            `${tableName} Data`,
            dataFrame
          );

          addDataTable(localSource.id, tableName, file.name, {
            id: tableId,
            fields,
            sourceSchema,
            dataFrameId,
          });

          setSelectedSecondaryId(tableId);
        },
      });
    },
    [addDataTable, addLocal, createDataFrameFromCSV, getLocal]
  );

  const createDraftInsight = useInsightsStore((state) => state.createDraft);
  const updateInsight = useInsightsStore((state) => state.updateInsight);
  const setInsightDataFrame = useInsightsStore((state) => state.setInsightDataFrame);
  const updateDataTable = useDataSourcesStore((state) => state.updateDataTable);
  const getDataFrame = useDataFramesStore((state) => state.get);
  const createDataFrameFromInsight = useDataFramesStore((state) => state.createFromInsight);
  const router = useRouter();

  const handleCombine = useCallback(async () => {
    if (!selectedSecondaryId || !leftFieldId || !rightFieldId) {
      setError("Select both join columns and a secondary table.");
      return;
    }

    const secondaryTable = secondaryEntry?.table;
    if (!secondaryTable) {
      setError("Select a secondary table.");
      return;
    }

    const baseFrameId = dataTable.dataFrameId;
    const secondaryFrameId = secondaryTable.dataFrameId;

    if (!baseFrameId || !secondaryFrameId) {
      setError("Unable to load data for one of the tables.");
      return;
    }

    const baseEnhanced = getDataFrame(baseFrameId);
    const secondaryEnhanced = getDataFrame(secondaryFrameId);

    if (!baseEnhanced || !secondaryEnhanced) {
      setError("Unable to access cached data. Please refresh the tables.");
      return;
    }

    const leftField = dataTable.fields.find((field) => field.id === leftFieldId);
    const rightField = secondaryTable.fields.find((field) => field.id === rightFieldId);

    if (!leftField || !rightField) {
      setError("Selected columns are no longer available.");
      return;
    }

    const leftColumnName = leftField.columnName ?? leftField.name;
    const rightColumnName = rightField.columnName ?? rightField.name;

    setError(null);
    setIsSubmitting(true);

    let joinedDataFrame;
    try {
      joinedDataFrame = joinDataFrames(baseEnhanced.data, secondaryEnhanced.data, {
        on: { left: leftColumnName, right: rightColumnName },
        how: joinType,
        suffixes: { left: "_left", right: "_right" },
      });
    } catch (err) {
      console.error("Join failed", err);
      setError("Failed to join tables. Try different columns or types.");
      setIsSubmitting(false);
      return;
    }

    const localSource = getLocal() ?? (() => {
      addLocal("Local Storage");
      return getLocal();
    })();

    if (!localSource) {
      setError("Unable to create local storage for the joined dataset.");
      setIsSubmitting(false);
      return;
    }

    const joinedTableId = crypto.randomUUID();
    const joinedTableName = `${dataTable.name} + ${secondaryTable.name}`;

    const joinedFields = convertColumnsToFields(
      joinedDataFrame.columns ?? [],
      joinedTableId
    );

    addDataTable(localSource.id, joinedTableName, joinedTableName, {
      id: joinedTableId,
      fields: joinedFields,
    });

    const joinedInsightName = `${insight.name} + ${secondaryTable.name}`;
    const joinedInsightId = createDraftInsight(
      joinedTableId,
      joinedInsightName,
      joinedFields.map((field) => field.id)
    );

    const joinMeta = {
      id: crypto.randomUUID(),
      tableId: secondaryTable.id,
      selectedFields: [rightField.id],
      joinOn: { baseField: leftField.id, joinedField: rightField.id },
      joinType,
    };

    updateInsight(joinedInsightId, {
      joins: [joinMeta],
    });

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
    onOpenChange(false);
    router.push(`/insights/${joinedInsightId}/create-visualization`);
  }, [
    selectedSecondaryId,
    leftFieldId,
    rightFieldId,
    joinType,
    secondaryEntry,
    dataTable,
    insight,
    getDataFrame,
    convertColumnsToFields,
    addLocal,
    getLocal,
    addDataTable,
    createDraftInsight,
    updateInsight,
    createDataFrameFromInsight,
    setInsightDataFrame,
    updateDataTable,
    router,
    onOpenChange,
  ]);

  const joinableFields = dataTable.fields.filter((field) => !field.name.startsWith("_"));
  const secondaryFields = secondaryEntry?.table.fields.filter(
    (field) => !field.name.startsWith("_")
  );

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Join with another dataset</DialogTitle>
        </DialogHeader>
        <div className="space-y-6">
          <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-foreground">Select secondary table</h4>
              <p className="text-xs text-muted-foreground">
                {secondaryEntry ? "Selected" : "Pick a table to join"}
              </p>
            </div>
            <div className="grid max-h-60 gap-3 overflow-auto">
              {allTables.map(({ table, source }) => (
                <Button
                  key={table.id}
                  variant={selectedSecondaryId === table.id ? "secondary" : "ghost"}
                  className="justify-between"
                  onClick={() => setSelectedSecondaryId(table.id)}
                >
                  <span>
                    {table.name}
                    <p className="text-xs text-muted-foreground">
                      {source.name} • {table.fields.length} columns
                    </p>
                  </span>
                </Button>
              ))}
            </div>
            <AddConnectionPanel
              csvTitle="Upload CSV for join"
              csvDescription="Upload another table to join with your insight."
              csvHelperText="Supports .csv files up to 5MB"
              onCsvSelect={handleCSVSelect}
              notion={{
                apiKey: "",
                showApiKey: false,
                onApiKeyChange: () => {},
                onToggleShowApiKey: () => {},
                onConnectNotion: () => {},
                connectDisabled: true,
                connectButtonLabel: "Not supported here",
                title: "Notion (coming soon)",
                description: "Use existing Notion tables listed above.",
                hint: "Connecting Notion inside the join flow is not available yet.",
              }}
            />
          </section>

          <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-foreground">Configure join</h4>
              <p className="text-xs text-muted-foreground">Choose columns and type</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="join-left">Base table column</Label>
                <Select
                  value={leftFieldId ?? ""}
                  onValueChange={(value) => setLeftFieldId(value || null)}
                >
                  <SelectTrigger id="join-left">
                    <SelectValue placeholder="Choose a column..." />
                  </SelectTrigger>
                  <SelectContent>
                    {joinableFields.map((field) => (
                      <SelectItem key={field.id} value={field.id}>
                        {field.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="join-right">Secondary table column</Label>
                <Select
                  value={rightFieldId ?? ""}
                  onValueChange={(value) => setRightFieldId(value || null)}
                  disabled={!secondaryFields?.length}
                >
                  <SelectTrigger id="join-right">
                    <SelectValue placeholder="Choose a column..." />
                  </SelectTrigger>
                  <SelectContent>
                    {secondaryFields?.map((field) => (
                      <SelectItem key={field.id} value={field.id}>
                        {field.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="join-type">Join type</Label>
              <Select
                value={joinType}
                onValueChange={(value) => setJoinType(value as "inner" | "left" | "right" | "outer")}
              >
                <SelectTrigger id="join-type">
                  <SelectValue placeholder="Pick join type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inner">Inner</SelectItem>
                  <SelectItem value="left">Left</SelectItem>
                  <SelectItem value="right">Right</SelectItem>
                  <SelectItem value="outer">Outer</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </section>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleCombine} disabled={isSubmitting}>
              Combine data
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

