import type {
  AggregationType,
  DataTable,
  InsightMetric,
} from "@dashframe/types";
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@wystack/ui-react";
import { useMemo, useState } from "react";
import {
  metricColumnNameForSave,
  metricFormulaPreview,
} from "./metric-formula";
import { useSaveDismissGuard, useSavingFlag } from "./use-save-dismiss-guard";

interface MetricEditDialogProps {
  metric: InsightMetric | null;
  dataTable: DataTable;
  onOpenChange: (open: boolean) => void;
  onSave: (metric: InsightMetric) => Promise<void> | void;
}

/**
 * Inner form component that resets when key changes.
 * Using key-based reset pattern instead of useEffect setState.
 */
function MetricEditForm({
  metric,
  dataTable,
  onSave,
  onClose,
  onPendingChange,
}: {
  metric: InsightMetric;
  dataTable: DataTable;
  onSave: (metric: InsightMetric) => Promise<void> | void;
  onClose: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const [name, setName] = useState(metric.name);
  const [aggregation, setAggregation] = useState<AggregationType>(
    metric.aggregation,
  );
  const [columnName, setColumnName] = useState<string>(metric.columnName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useSavingFlag(onPendingChange);

  // Get available fields (exclude internal _ prefixed)
  const availableFields = useMemo(
    () =>
      (dataTable.fields ?? []).filter(
        (f) => !f.name.startsWith("_") && f.columnName,
      ),
    [dataTable.fields],
  );

  // Get numeric fields for sum/avg
  const numericFields = useMemo(
    () =>
      availableFields.filter((f) =>
        ["number", "integer", "float", "decimal"].includes(
          f.type.toLowerCase(),
        ),
      ),
    [availableFields],
  );

  const handleSave = async () => {
    if (!name.trim()) return;

    const updatedMetric: InsightMetric = {
      ...metric,
      name: name.trim(),
      columnName: metricColumnNameForSave(aggregation, columnName),
      aggregation,
    };

    setError(null);
    setIsSaving(true);
    try {
      await onSave(updatedMetric);
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setError(`Failed to save metric: ${message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Check if field selection is required (not required for basic count)
  const needsField = aggregation !== "count";

  // Determine which fields to show based on aggregation
  const fieldsForSelect =
    aggregation === "sum" || aggregation === "avg"
      ? numericFields
      : availableFields;

  // Compare against what a save would actually write, not the raw field. A
  // metric stored as `count` with a column predates the column being dropped
  // for "Count (rows)"; saving repairs it, so the dialog must read as dirty on
  // open and let the user commit the repair without inventing another edit.
  const hasChanges =
    name.trim() !== metric.name ||
    aggregation !== metric.aggregation ||
    metricColumnNameForSave(aggregation, columnName) !==
      (metric.columnName || undefined);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit metric</DialogTitle>
        <DialogDescription>
          Modify the aggregation settings and display name for this metric.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-4">
        {error && (
          <Alert color="danger">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Aggregation Type */}
        <div className="space-y-2">
          <Label htmlFor="edit-aggregation">Aggregation type</Label>
          <Select
            value={aggregation}
            onValueChange={(v) => {
              setAggregation(v as AggregationType);
              // Clear column if switching to count (but allow keeping it for count_distinct)
              if (v === "count") {
                setColumnName("");
              }
            }}
          >
            <SelectTrigger id="edit-aggregation">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="count">Count (rows)</SelectItem>
              <SelectItem value="sum">Sum</SelectItem>
              <SelectItem value="avg">Average</SelectItem>
              <SelectItem value="min">Minimum</SelectItem>
              <SelectItem value="max">Maximum</SelectItem>
              <SelectItem value="count_distinct">Count distinct</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Field Selection (if needed) */}
        {needsField && (
          <div className="space-y-2">
            <Label htmlFor="edit-field">Field</Label>
            <Select
              value={columnName}
              onValueChange={(v) => setColumnName(v ?? "")}
            >
              <SelectTrigger id="edit-field">
                <SelectValue placeholder="Select a field" />
              </SelectTrigger>
              <SelectContent>
                {fieldsForSelect.length === 0 ? (
                  <div className="p-2 text-center text-sm text-neutral-fg-subtle">
                    {aggregation === "sum" || aggregation === "avg"
                      ? "No numeric fields available"
                      : "No fields available"}
                  </div>
                ) : (
                  fieldsForSelect.map((field) => (
                    <SelectItem key={field.id} value={field.columnName!}>
                      {field.name} ({field.type})
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Metric Name */}
        <div className="space-y-2">
          <Label htmlFor="edit-metric-name">Display name</Label>
          <Input
            id="edit-metric-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter metric name"
          />
        </div>

        {/* Formula Preview */}
        <div className="rounded-lg bg-neutral-bg-muted p-3">
          <p className="mb-1 text-xs font-medium text-neutral-fg-subtle">
            Formula preview
          </p>
          <code className="font-mono text-sm text-neutral-fg">
            {metricFormulaPreview(aggregation, columnName)}
          </code>
        </div>
      </div>

      <DialogFooter>
        <Button
          label="Cancel"
          variant="outline"
          onClick={onClose}
          disabled={isSaving}
        />
        <Button
          label={isSaving ? "Saving..." : "Save"}
          onClick={handleSave}
          disabled={
            isSaving ||
            !name.trim() ||
            (needsField && !columnName) ||
            !hasChanges
          }
          loading={isSaving}
        />
      </DialogFooter>
    </>
  );
}

/**
 * MetricEditDialog - Dialog for editing an existing metric
 *
 * Allows user to modify:
 * - Aggregation type (sum, avg, count, etc.)
 * - Column to aggregate
 * - Display name
 *
 * Uses key-based reset pattern: when metric changes, the inner form
 * component remounts with fresh state.
 */
export function MetricEditDialog({
  metric,
  dataTable,
  onOpenChange,
  onSave,
}: MetricEditDialogProps) {
  const { setPending, isPending } = useSaveDismissGuard();

  // Escape and outside-click reach the shell directly, bypassing the disabled
  // Cancel button. Dismissing a pending save lets a second editor open, and the
  // first save's completion would then close it and discard that edit.
  const handleDismiss = () => {
    if (isPending()) return;
    handleClose();
  };

  const handleClose = () => {
    onOpenChange(false);
  };

  const isOpen = metric !== null;

  return (
    <Dialog open={isOpen} onOpenChange={handleDismiss}>
      <DialogContent className="sm:max-w-md">
        {metric && (
          <MetricEditForm
            key={metric.id}
            metric={metric}
            dataTable={dataTable}
            onSave={onSave}
            onClose={handleClose}
            onPendingChange={setPending}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
