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
  WorkbenchChipLabel,
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
import {
  fieldIdToColumnAlias,
  isGeneratedColumnLabel,
} from "@dashframe/engine";
import { Sigma } from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  MeasureCalculationFields,
  type MeasureOptions,
} from "./MeasureCalculationFields";
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

type MetricField = { id: string; columnName?: string; name: string };
type ColumnDisplayNames = Readonly<Record<string, string>>;

function isNumericMetricField(field: { type: string }): boolean {
  return ["number", "integer", "float", "decimal"].includes(
    field.type.toLowerCase(),
  );
}

// A metric's columnName is either the field's own column or, for metrics
// pinned from a chart suggestion, the internal field_<uuid>[_jN] alias — which
// must never reach the screen. Base fields match by either form, as
// VisualizationConfigPanel does. Anything else (a joined field, or one joined
// more than once) is named by the suggestion model's column display names,
// which resolve join instances the same way the SQL that assigned them does.
export function metricFieldLabel(
  columnName: string | undefined,
  fields: readonly MetricField[],
  columnDisplayNames: ColumnDisplayNames,
): string | undefined {
  if (!columnName) return undefined;
  const field = fields.find(
    (candidate) =>
      candidate.columnName === columnName ||
      fieldIdToColumnAlias(candidate.id) === columnName,
  );
  if (field) return field.name;
  const label = columnDisplayNames[columnName];
  return label && !isGeneratedColumnLabel(label) ? label : undefined;
}

export function metricDescription(
  metric: InsightMetric,
  fields: readonly MetricField[],
  columnDisplayNames: ColumnDisplayNames,
): string {
  if (metric.expression) {
    return metric.expression.kind === "binary" &&
      metric.expression.operator === "divide"
      ? "ratio"
      : "formula";
  }
  if (metric.aggregation === "count" && !metric.columnName) return "count";
  const resolved = metricFieldLabel(
    metric.columnName,
    fields,
    columnDisplayNames,
  );
  const fieldName =
    resolved ??
    (isGeneratedColumnLabel(metric.columnName)
      ? ""
      : (metric.columnName ?? ""));
  return fieldName
    ? `${metric.aggregation} · ${fieldName}`
    : metric.aggregation;
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
  metrics,
  metric,
  dataTable,
  columnDisplayNames = {},
  dragHandle,
  onSave,
  onRemove,
}: {
  metrics: InsightMetric[];
  metric?: InsightMetric;
  dataTable: DataTable;
  /** Result column labels, used only to name a metric's column. */
  columnDisplayNames?: ColumnDisplayNames;
  dragHandle?: ReactNode;
  onSave: (metric: InsightMetric) => Promise<void> | void;
  onRemove?: () => void;
}) {
  const [options, setOptions] = useState<MeasureOptions>({
    expression: metric?.expression,
    filters: metric?.filters,
    format: metric?.format,
  });
  const [open, setOpen] = useState(false);
  const [aggregation, setAggregation] = useState<AggregationType>(
    metric?.aggregation ?? "count",
  );
  const [columnName, setColumnName] = useState(metric?.columnName ?? "");
  const [nameDraft, setNameDraft] = useState(metric?.name ?? "");
  const [nameEdited, setNameEdited] = useState(Boolean(metric));
  const [error, setError] = useState<string | null>(null);
  const [measureValidationError, setMeasureValidationError] = useState<
    string | null
  >(null);
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
      ? fields.filter(isNumericMetricField)
      : fields;
  const name = nameEdited
    ? nameDraft
    : autoMetricName(aggregation, columnName, dataTable);
  const needsField = !options.expression && aggregation !== "count";

  const reset = () => {
    setOptions({
      expression: metric?.expression,
      filters: metric?.filters,
      format: metric?.format,
    });
    setAggregation(metric?.aggregation ?? "count");
    setColumnName(metric?.columnName ?? "");
    setNameDraft(metric?.name ?? "");
    setNameEdited(Boolean(metric));
    setError(null);
    setMeasureValidationError(null);
  };
  const close = () => {
    if (isPending()) return;
    setOpen(false);
    reset();
  };
  const save = async () => {
    if (!name.trim() || (needsField && !columnName)) return;
    if (measureValidationError) {
      setError(measureValidationError);
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await onSave({
        id: metric?.id ?? (crypto.randomUUID() as UUID),
        name: name.trim(),
        sourceTable: metric?.sourceTable ?? dataTable.id,
        columnName: metricColumnNameForSave(aggregation, columnName),
        aggregation,
        ...options,
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
              className="flex min-w-0 flex-1 focus-visible:outline-none"
              aria-label={`Edit ${metric.name}`}
            >
              <WorkbenchChipLabel
                title={metric.name}
                description={metricDescription(
                  metric,
                  fields,
                  columnDisplayNames,
                )}
              />
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
      <PopoverContent
        aria-label={metric ? "Edit metric" : "Add metric"}
        align="start"
        className="w-80 space-y-3"
      >
        {error && (
          <Alert color="danger">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <MeasureCalculationFields
          value={options}
          onChange={setOptions}
          metrics={metrics.filter((candidate) => candidate.id !== metric?.id)}
          dataTable={dataTable}
          onValidationErrorChange={setMeasureValidationError}
        />
        {!options.expression && (
          <div className="flex gap-2">
            <Select
              value={aggregation}
              onValueChange={(value) => {
                const next = value as AggregationType;
                setAggregation(next);
                const nextFields =
                  next === "sum" || next === "avg"
                    ? fields.filter(isNumericMetricField)
                    : fields;
                if (
                  next === "count" ||
                  !nextFields.some((field) => field.columnName === columnName)
                ) {
                  setColumnName("");
                }
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
                    ? (metricFieldLabel(
                        columnName,
                        fields,
                        columnDisplayNames,
                      ) ?? columnName)
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
        )}
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
            label={metric ? "Save" : "Add"}
            size="sm"
            loading={isSaving}
            disabled={
              !name.trim() ||
              (needsField && !columnName) ||
              (metric !== undefined &&
                JSON.stringify(options) ===
                  JSON.stringify({
                    expression: metric.expression,
                    filters: metric.filters,
                    format: metric.format,
                  }) &&
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
  columnDisplayNames = {},
  onReorder,
  onRemove,
  onAdd,
  onEdit,
}: {
  metrics: InsightMetric[];
  dataTable: DataTable;
  columnDisplayNames?: ColumnDisplayNames;
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
              metrics={metrics}
              metric={item.metric}
              dataTable={dataTable}
              columnDisplayNames={columnDisplayNames}
              dragHandle={dragHandle}
              onSave={onEdit}
              onRemove={() => onRemove(item.id)}
            />
          )}
        />
      )}
      <MetricEditor
        metrics={metrics}
        dataTable={dataTable}
        columnDisplayNames={columnDisplayNames}
        onSave={onAdd}
      />
    </div>
  );
}
