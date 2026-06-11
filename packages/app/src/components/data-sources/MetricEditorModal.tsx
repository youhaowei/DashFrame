import type { Field, Metric } from "@dashframe/types";
import {
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
} from "@wystack/ui";
import { useState } from "react";

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
  // Track whether the user has typed a name explicitly. While the name has
  // not been customized, we compute it from aggregation + field instead of
  // synchronizing via an effect.
  const [customName, setCustomName] = useState<string | null>(null);
  const [aggregation, setAggregation] = useState<AggregationType>("count");
  const [fieldColumnName, setFieldColumnName] = useState<string>("");

  // Reset form whenever the modal transitions from closed to open by using
  // `isOpen` as a "session" key compared during render.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setCustomName(null);
      setAggregation("count");
      setFieldColumnName("");
    }
  }

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

  const name = customName ?? autoGenerateName();
  const setName = (next: string) => setCustomName(next);

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
                onValueChange={(v) => setFieldColumnName(v ?? "")}
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
          <div className="rounded-lg bg-neutral-bg-muted p-3">
            <p className="mb-1 text-xs font-medium text-neutral-fg-subtle">
              Formula Preview
            </p>
            <code className="font-mono text-sm text-neutral-fg">
              {getFormulaPreview()}
            </code>
          </div>
        </div>

        <DialogFooter>
          <Button label="Cancel" variant="outline" onClick={handleCancel} />
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
