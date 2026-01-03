"use client";

import { useState, useEffect } from "react";
import type { Field, Metric } from "@dashframe/types";
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

type AggregationType =
  | "sum"
  | "avg"
  | "count"
  | "min"
  | "max"
  | "count_distinct";

interface MetricEditorModalProps {
  isOpen: boolean;
  tableId: string;
  availableFields: Field[];
  onSave: (metric: Omit<Metric, "id">) => void;
  onClose: () => void;
}

export function MetricEditorModal({
  isOpen,
  tableId,
  availableFields,
  onSave,
  onClose,
}: MetricEditorModalProps) {
  const [name, setName] = useState("");
  const [aggregation, setAggregation] = useState<AggregationType>("count");
  const [fieldColumnName, setFieldColumnName] = useState<string>("");

  // Auto-generate name based on aggregation and field
  const autoGenerateName = () => {
    if (aggregation === "count" && !fieldColumnName) {
      return "Count";
    }

    if (!fieldColumnName) {
      return "";
    }

    const field = availableFields.find((f) => f.columnName === fieldColumnName);
    if (!field) return "";

    const aggregationNames = {
      sum: "Total",
      avg: "Average",
      count: "Count",
      min: "Minimum",
      max: "Maximum",
      count_distinct: "Unique",
    };

    return `${aggregationNames[aggregation]} ${field.name}`;
  };

  // Update name when aggregation or field changes (if name is empty or auto-generated)
  useEffect(() => {
    const suggestedName = autoGenerateName();
    if (suggestedName && (!name || name === autoGenerateName())) {
      setName(suggestedName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aggregation, fieldColumnName]);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setName("");
      setAggregation("count");
      setFieldColumnName("");
    }
  }, [isOpen]);

  const handleSave = () => {
    if (!name.trim()) return;

    // Count aggregation doesn't need a field
    const columnName =
      aggregation === "count" ? undefined : fieldColumnName || undefined;

    onSave({
      name: name.trim(),
      tableId,
      columnName,
      aggregation,
    });

    onClose();
  };

  const handleCancel = () => {
    onClose();
  };

  // Generate formula preview
  const getFormulaPreview = () => {
    if (aggregation === "count" && !fieldColumnName) {
      return "count()";
    }

    if (!fieldColumnName) {
      return `${aggregation}(?)`;
    }

    return `${aggregation}(${fieldColumnName})`;
  };

  // Check if field selection is required
  const needsField = aggregation !== "count";

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Metric</DialogTitle>
          <DialogDescription>
            Create a new aggregation metric to calculate values across your
            data.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Aggregation Type */}
          <div className="space-y-2">
            <Label htmlFor="aggregation">Aggregation Type</Label>
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
                <SelectItem value="count_distinct">Count Distinct</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Field Selection (if needed) */}
          {needsField && (
            <div className="space-y-2">
              <Label htmlFor="field">Field</Label>
              <Select
                value={fieldColumnName}
                onValueChange={setFieldColumnName}
              >
                <SelectTrigger id="field">
                  <SelectValue placeholder="Select a field" />
                </SelectTrigger>
                <SelectContent>
                  {availableFields
                    .filter((f) => f.columnName) // Only show fields with columnName
                    .map((field) => (
                      <SelectItem key={field.id} value={field.columnName!}>
                        {field.name} ({field.type})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Metric Name */}
          <div className="space-y-2">
            <Label htmlFor="metric-name">Metric Name</Label>
            <Input
              id="metric-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter metric name"
              autoFocus
            />
          </div>

          {/* Formula Preview */}
          <div className="rounded-lg bg-muted p-3">
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Formula Preview
            </p>
            <code className="font-mono text-sm text-foreground">
              {getFormulaPreview()}
            </code>
          </div>
        </div>

        <DialogFooter>
          <Button label="Cancel" variant="outlined" onClick={handleCancel} />
          <Button
            label="Add Metric"
            onClick={handleSave}
            disabled={!name.trim() || (needsField && !fieldColumnName)}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
