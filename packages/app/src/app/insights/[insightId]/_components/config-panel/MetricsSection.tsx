import type {
  AggregationType,
  DataTable,
  InsightMetric,
  UUID,
} from "@dashframe/types";
import {
  SortableList,
  WorkbenchAddRow,
  WorkbenchChip,
  type SortableListItem,
} from "@dashframe/ui";
import {
  Alert,
  AlertDescription,
  Button,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@wystack/ui-react";
import { Sigma } from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { metricColumnNameForSave } from "./metric-formula";
import { useSaveDismissGuard, useSavingFlag } from "./use-save-dismiss-guard";

interface MetricSortableItem extends SortableListItem {
  metric: InsightMetric;
}

const AGGREGATIONS: Array<{ value: AggregationType; label: string }> = [
  { value: "count", label: "Count" },
  { value: "sum", label: "Sum" },
  { value: "avg", label: "Average" },
  { value: "min", label: "Minimum" },
  { value: "max", label: "Maximum" },
  { value: "count_distinct", label: "Count distinct" },
];

function metricDescription(metric: InsightMetric): string {
  return metric.aggregation === "count" && !metric.columnName
    ? "count"
    : `${metric.aggregation} · ${metric.columnName ?? ""}`;
}

function autoMetricName(
  aggregation: AggregationType,
  columnName: string,
  dataTable: DataTable,
): string {
  if (aggregation === "count" && !columnName) return "Count";
  const field = dataTable.fields?.find(
    (candidate) => candidate.columnName === columnName,
  );
  if (!field) return "";
  const prefix: Record<AggregationType, string> = {
    sum: "Total",
    avg: "Average",
    count: "Count",
    min: "Minimum",
    max: "Maximum",
    count_distinct: "Unique",
  };
  return `${prefix[aggregation]} ${field.name}`;
}

function MetricEditor({
  metric,
  dataTable,
  dragHandle,
  onSave,
  onRemove,
}: {
  metric?: InsightMetric;
  dataTable: DataTable;
  dragHandle?: ReactNode;
  onSave: (metric: InsightMetric) => Promise<void> | void;
  onRemove?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [aggregation, setAggregation] = useState<AggregationType>(
    metric?.aggregation ?? "count",
  );
  const [columnName, setColumnName] = useState(metric?.columnName ?? "");
  const [nameDraft, setNameDraft] = useState(metric?.name ?? "");
  const [nameEdited, setNameEdited] = useState(Boolean(metric));
  const [error, setError] = useState<string | null>(null);
  const { setPending, isPending } = useSaveDismissGuard();
  const [isSaving, setIsSaving] = useSavingFlag(setPending);
  const fields = useMemo(
    () =>
      (dataTable.fields ?? []).filter(
        (field) => !field.name.startsWith("_") && field.columnName,
      ),
    [dataTable.fields],
  );
  const filteredFields =
    aggregation === "sum" || aggregation === "avg"
      ? fields.filter((field) =>
          ["number", "integer", "float", "decimal"].includes(
            field.type.toLowerCase(),
          ),
        )
      : fields;
  const name = nameEdited
    ? nameDraft
    : autoMetricName(aggregation, columnName, dataTable);
  const needsField = aggregation !== "count";

  const reset = () => {
    setAggregation(metric?.aggregation ?? "count");
    setColumnName(metric?.columnName ?? "");
    setNameDraft(metric?.name ?? "");
    setNameEdited(Boolean(metric));
    setError(null);
  };
  const close = () => {
    if (isPending()) return;
    setOpen(false);
    reset();
  };
  const save = async () => {
    if (!name.trim() || (needsField && !columnName)) return;
    setIsSaving(true);
    setError(null);
    try {
      await onSave({
        id: metric?.id ?? (crypto.randomUUID() as UUID),
        name: name.trim(),
        sourceTable: metric?.sourceTable ?? dataTable.id,
        columnName: metricColumnNameForSave(aggregation, columnName),
        aggregation,
      });
      setOpen(false);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unknown error";
      setError(`Failed to save metric: ${message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const trigger = metric ? (
    <WorkbenchChip
      dragHandle={dragHandle}
      icon={<Sigma className="h-3.5 w-3.5" />}
      open={open}
      content={
        <PopoverTrigger
          render={
            <button
              type="button"
              className="min-w-0 flex-1 text-left focus-visible:outline-none"
              aria-label={`Edit ${metric.name}`}
            >
              <span className="block truncate font-medium">{metric.name}</span>
              <span className="block truncate text-[11px] leading-4 text-neutral-fg-subtle">
                {metricDescription(metric)}
              </span>
            </button>
          }
        />
      }
      removeLabel={`Remove ${metric.name}`}
      onRemove={onRemove}
    />
  ) : (
    <PopoverTrigger render={<WorkbenchAddRow>Add metric</WorkbenchAddRow>} />
  );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
        else {
          reset();
          setOpen(true);
        }
      }}
    >
      {trigger}
      <PopoverContent align="start" className="w-80 space-y-3">
        {error && (
          <Alert color="danger">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="flex gap-2">
          <Select
            value={aggregation}
            onValueChange={(value) => {
              const next = value as AggregationType;
              setAggregation(next);
              if (next === "count") setColumnName("");
            }}
          >
            <SelectTrigger aria-label="Aggregation" className="w-32">
              <SelectValue>
                {AGGREGATIONS.find((item) => item.value === aggregation)
                  ?.label ?? aggregation}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {AGGREGATIONS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={columnName}
            onValueChange={(value) => {
              setColumnName(value ?? "");
            }}
            disabled={!needsField}
          >
            <SelectTrigger aria-label="Column" className="min-w-0 flex-1">
              <SelectValue placeholder={needsField ? "Column" : "All rows"}>
                {columnName
                  ? (fields.find((field) => field.columnName === columnName)
                      ?.name ?? columnName)
                  : undefined}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {filteredFields.map((field) => (
                <SelectItem key={field.id} value={field.columnName!}>
                  {field.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`metric-name-${metric?.id ?? "new"}`}>Name</Label>
          <Input
            id={`metric-name-${metric?.id ?? "new"}`}
            value={name}
            onChange={(event) => {
              setNameEdited(true);
              setNameDraft(event.target.value);
            }}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button
            label="Cancel"
            variant="ghost"
            size="sm"
            disabled={isSaving}
            onClick={close}
          />
          <Button
            label={metric ? "Save" : "Add metric"}
            size="sm"
            loading={isSaving}
            disabled={
              !name.trim() ||
              (needsField && !columnName) ||
              (metric !== undefined &&
                name.trim() === metric.name &&
                aggregation === metric.aggregation &&
                metricColumnNameForSave(aggregation, columnName) ===
                  (metric.columnName || undefined))
            }
            onClick={() => void save()}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function MetricsSection({
  metrics,
  dataTable,
  onReorder,
  onRemove,
  onAdd,
  onEdit,
}: {
  metrics: InsightMetric[];
  dataTable: DataTable;
  onReorder: (metrics: InsightMetric[]) => void;
  onRemove: (metricId: string) => void;
  onAdd: (metric: InsightMetric) => Promise<void> | void;
  onEdit: (metric: InsightMetric) => Promise<void> | void;
}) {
  const items: MetricSortableItem[] = metrics.map((metric) => ({
    id: metric.id,
    metric,
  }));
  const handleReorder = useCallback(
    (next: MetricSortableItem[]) => onReorder(next.map((item) => item.metric)),
    [onReorder],
  );
  return (
    <div className="space-y-1">
      {items.length > 0 && (
        <SortableList
          items={items}
          onReorder={handleReorder}
          gap={3}
          unstyledItems
          renderItem={(item, _index, { dragHandle }) => (
            <MetricEditor
              metric={item.metric}
              dataTable={dataTable}
              dragHandle={dragHandle}
              onSave={onEdit}
              onRemove={() => onRemove(item.id)}
            />
          )}
        />
      )}
      <MetricEditor dataTable={dataTable} onSave={onAdd} />
    </div>
  );
}
