"use client";

import { useState, useEffect, useMemo } from "react";
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
import type { DataTable, InsightMetric, UUID } from "@dashframe/types";

type AggregationType =
  | "sum"
  | "avg"
  | "count"
  | "min"
  | "max"
  | "count_distinct";

interface InsightMetricEditorModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  dataTable: DataTable;
  onSave: (metric: InsightMetric) => void;
}

/**
 * InsightMetricEditorModal - Dialog for creating insight metrics
 *
 * Allows user to:
 * - Select an aggregation type (sum, avg, count, etc.)
 * - Select a column to aggregate (except for count)
 * - Customize the metric name
 */
export function InsightMetricEditorModal({
  isOpen,
  onOpenChange,
  dataTable,
  onSave,
}: InsightMetricEditorModalProps) {
  const [name, setName] = useState("");
  const [aggregation, setAggregation] = useState<AggregationType>("count");
  const [columnName, setColumnName] = useState<string>("");

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

  // Auto-generate name based on aggregation and field
  const autoGenerateName = () => {
    if (aggregation === "count" && !columnName) {
      return "Count";
    }

    if (!columnName) {
      return "";
    }

    const field = availableFields.find((f) => f.columnName === columnName);
    if (!field) return "";

    const aggregationNames: Record<AggregationType, string> = {
      sum: "Total",
      avg: "Average",
      count: "Count",
      min: "Minimum",
      max: "Maximum",
      count_distinct: "Unique",
    };

    return `${aggregationNames[aggregation]} ${field.name}`;
  };

  // Update name when aggregation or field changes
  useEffect(() => {
    const suggestedName = autoGenerateName();
    if (suggestedName && (!name || name === autoGenerateName())) {
      setName(suggestedName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aggregation, columnName]);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setName("");
      setAggregation("count");
      setColumnName("");
    }
  }, [isOpen]);

  const handleSave = () => {
    if (!name.trim()) return;

    // Generate unique ID
    const id = crypto.randomUUID() as UUID;

    const metric: InsightMetric = {
      id,
      name: name.trim(),
      sourceTable: dataTable.id,
      columnName: aggregation === "count" ? undefined : columnName || undefined,
      aggregation,
    };

    onSave(metric);
    onOpenChange(false);
  };

  const handleClose = () => {
    onOpenChange(false);
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

  // Check if field selection is required
  const needsField = aggregation !== "count";

  // Determine which fields to show based on aggregation
  const fieldsForSelect =
    aggregation === "sum" || aggregation === "avg"
      ? numericFields
      : availableFields;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add metric</DialogTitle>
          <DialogDescription>
            Create an aggregation metric to calculate values across your data.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Aggregation Type */}
          <div className="space-y-2">
            <Label htmlFor="aggregation">Aggregation type</Label>
            <Select
              value={aggregation}
              onValueChange={(v) => setAggregation(v as AggregationType)}
            >
              <SelectTrigger id="aggregation">
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
              <Label htmlFor="field">Field</Label>
              <Select value={columnName} onValueChange={setColumnName}>
                <SelectTrigger id="field">
                  <SelectValue placeholder="Select a field" />
                </SelectTrigger>
                <SelectContent>
                  {fieldsForSelect.length === 0 ? (
                    <div className="p-2 text-center text-sm text-muted-foreground">
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
            <Label htmlFor="metric-name">Metric name</Label>
            <Input
              id="metric-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter metric name"
            />
          </div>

          {/* Formula Preview */}
          <div className="rounded-lg bg-muted p-3">
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Formula preview
            </p>
            <code className="font-mono text-sm text-foreground">
              {getFormulaPreview()}
            </code>
          </div>
        </div>

        <DialogFooter>
          <Button label="Cancel" variant="outlined" onClick={handleClose} />
          <Button
            label="Add metric"
            onClick={handleSave}
            disabled={!name.trim() || (needsField && !columnName)}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
