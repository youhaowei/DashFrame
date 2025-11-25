"use client";

import { useCallback, useMemo, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Papa, { type ParseError, type ParseResult } from "papaparse";
import { csvToDataFrameWithFields } from "@dashframe/csv";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Button,
  Alert,
  AlertDescription,
  Database,
  Check,
} from "@dashframe/ui";
import { AddConnectionPanel } from "@/components/data-sources/AddConnectionPanel";
import { useDataSourcesStore } from "@/lib/stores/data-sources-store";
import { useDataFramesStore } from "@/lib/stores/dataframes-store";
import type { Insight, DataTable } from "@/lib/stores/types";

interface JoinFlowModalProps {
  insight: Insight;
  dataTable: DataTable;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

/**
 * JoinFlowModal - Table Selection Modal
 *
 * This modal allows users to select a table to join with their insight.
 * After selection, navigates to the dedicated join configuration page
 * where users can configure join columns, type, and preview results.
 */
export function JoinFlowModal({
  insight,
  dataTable,
  isOpen,
  onOpenChange,
}: JoinFlowModalProps) {
  const router = useRouter();
  const getAllDataSources = useDataSourcesStore((state) => state.getAll);
  const addLocal = useDataSourcesStore((state) => state.addLocal);
  const getLocal = useDataSourcesStore((state) => state.getLocal);
  const addDataTable = useDataSourcesStore((state) => state.addDataTable);
  const createDataFrameFromCSV = useDataFramesStore(
    (state) => state.createFromCSV
  );

  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dataSources = useMemo(() => getAllDataSources(), [getAllDataSources]);

  // Get all tables except the current insight's base table
  const availableTables = useMemo(
    () =>
      dataSources.flatMap((source) =>
        Array.from(source.dataTables.values())
          .filter((table) => table.id !== dataTable.id) // Exclude current table
          .map((table) => ({
            table,
            source,
          }))
      ),
    [dataSources, dataTable.id]
  );

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setSelectedTableId(null);
      setError(null);
    }
  }, [isOpen]);

  // Handle CSV upload - creates a new table and selects it
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

          // Select the newly created table
          setSelectedTableId(tableId);
        },
      });
    },
    [addDataTable, addLocal, createDataFrameFromCSV, getLocal]
  );

  // Navigate to join configuration page
  const handleContinue = useCallback(() => {
    if (!selectedTableId) {
      setError("Please select a table to join with.");
      return;
    }

    onOpenChange(false);
    router.push(`/insights/${insight.id}/join/${selectedTableId}`);
  }, [selectedTableId, insight.id, router, onOpenChange]);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Join with another dataset</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Table Selection */}
          <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-foreground">
                Select a table to join
              </h4>
              <p className="text-xs text-muted-foreground">
                {selectedTableId ? "Table selected" : "Choose a table"}
              </p>
            </div>

            {availableTables.length > 0 ? (
              <div className="grid max-h-60 gap-2 overflow-auto">
                {availableTables.map(({ table, source }) => (
                  <Button
                    key={table.id}
                    variant={selectedTableId === table.id ? "secondary" : "ghost"}
                    className="h-auto justify-between px-4 py-3"
                    onClick={() => setSelectedTableId(table.id)}
                  >
                    <div className="flex items-center gap-3">
                      <Database className="h-4 w-4 text-muted-foreground" />
                      <div className="text-left">
                        <p className="font-medium">{table.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {source.name} · {table.fields.length} columns
                        </p>
                      </div>
                    </div>
                    {selectedTableId === table.id && (
                      <Check className="h-4 w-4 text-primary" />
                    )}
                  </Button>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border py-8 text-center">
                <Database className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">
                  No other tables available
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Upload a CSV file below to create a new table
                </p>
              </div>
            )}

            <div className="pt-2">
              <AddConnectionPanel
                csvTitle="Upload CSV for join"
                csvDescription="Upload a new table to join with your insight."
                csvHelperText="Supports .csv files up to 5MB"
                onCsvSelect={handleCSVSelect}
                notion={{
                  apiKey: "",
                  showApiKey: false,
                  onApiKeyChange: () => {},
                  onToggleShowApiKey: () => {},
                  onConnectNotion: () => {},
                  connectDisabled: true,
                  connectButtonLabel: "Not available",
                  title: "Notion (coming soon)",
                  description: "Use existing Notion tables listed above.",
                  hint: "Connecting Notion inside the join flow is not yet supported.",
                }}
              />
            </div>
          </section>

          {/* Error Display */}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleContinue} disabled={!selectedTableId}>
              Continue to join configuration
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
