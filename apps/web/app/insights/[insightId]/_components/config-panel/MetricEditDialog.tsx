"use client";

import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@dashframe/ui";
import type {
  DataTable,
  InsightMetric,
  AggregationType,
} from "@dashframe/types";

interface MetricEditDialogProps {
  metric: InsightMetric | null;
  dataTable: DataTable;
  onOpenChange: (open: boolean) => void;
  onSave: (metric: InsightMetric) => void;
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
}: {
  metric: InsightMetric;
  dataTable: DataTable;
  onSave: (metric: InsightMetric) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(metric.name);
  const [aggregation, setAggregation] = useState<AggregationType>(
    metric.aggregation,
  );
  const [columnName, setColumnName] = useState<string>(metric.columnName ?? "");

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

  const handleSave = () => {
    if (!name.trim()) return;

    const updatedMetric: InsightMetric = {
      ...metric,
      name: name.trim(),
      columnName:
        aggregation === "count" && !columnName
          ? undefined
          : columnName || undefined,
      aggregation,
    };

    onSave(updatedMetric);
    onClose();
  };

  // Generate formula preview
  const getFormulaPreview = () => {
    if (aggregation === "count" && !columnName) {
      return "count(*)";
    }

    if (!columnName) {
      return `${aggregation}(?)`;
    }

    return `${aggregation}(${columnName})`;
  };

  // Check if field selection is required (not required for basic count)
  const needsField = aggregation !== "count";

  // Determine which fields to show based on aggregation
  const fieldsForSelect =
    aggregation === "sum" || aggregation === "avg"
      ? numericFields
      : availableFields;

  // Check if anything changed
  const hasChanges =
    name.trim() !== metric.name ||
    aggregation !== metric.aggregation ||
    (columnName || undefined) !== (metric.columnName || undefined);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit metric</DialogTitle>
        <DialogDescription>
          Modify the aggregation settings and display name for this metric.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-4">
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
            <Select value={columnName} onValueChange={setColumnName}>
              <SelectTrigger id="edit-field">
                <SelectValue placeholder="Select a field" />
              </SelectTrigger>
              <SelectContent>
                {fieldsForSelect.length === 0 ? (
                  <div className="text-muted-foreground p-2 text-center text-sm">
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
        <div className="bg-muted rounded-lg p-3">
          <p className="text-muted-foreground mb-1 text-xs font-medium">
            Formula preview
          </p>
          <code className="text-foreground font-mono text-sm">
            {getFormulaPreview()}
          </code>
        </div>
      </div>

      <DialogFooter>
        <Button label="Cancel" variant="outlined" onClick={onClose} />
        <Button
          label="Save"
          onClick={handleSave}
          disabled={!name.trim() || (needsField && !columnName) || !hasChanges}
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
  const handleClose = () => {
    onOpenChange(false);
  };

  const isOpen = metric !== null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        {metric && (
          <MetricEditForm
            key={metric.id}
            metric={metric}
            dataTable={dataTable}
            onSave={onSave}
            onClose={handleClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
