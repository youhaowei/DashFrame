import type { CombinedField } from "@/lib/insights/compute-combined-fields";
import type {
  InsightFilter,
  InsightFilterBetweenValue,
  InsightRuntimeDeclaration,
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
  Checkbox,
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
  cn,
} from "@wystack/ui-react";
import { Eye, ListFilter } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { NEW_FILTER_ID, prepareFilterForSave } from "./filter-id";
import {
  buildFilterValue,
  inputTypeForField,
  isFilterDraftValid,
  type FilterDraft,
} from "./filter-value";
import { useSaveDismissGuard, useSavingFlag } from "./use-save-dismiss-guard";

export interface FilterWithId extends InsightFilter {
  _id: string;
  _saveIntent?: "create" | "update";
  _legacyFallback?: boolean;
  _legacyDuplicate?: boolean;
}

export type RuntimeFilterControl = NonNullable<
  InsightRuntimeDeclaration["filters"]
>[number];

interface FilterSortableItem extends SortableListItem {
  filter: FilterWithId;
}

const OPERATOR_OPTIONS: Array<{
  value: InsightFilter["operator"];
  label: string;
}> = [
  { value: "eq", label: "equals" },
  { value: "ne", label: "is not" },
  { value: "gt", label: "is greater than" },
  { value: "gte", label: "is at least" },
  { value: "lt", label: "is less than" },
  { value: "lte", label: "is at most" },
  { value: "contains", label: "contains" },
  { value: "between", label: "is between" },
  { value: "in", label: "is one of" },
];

function initialScalarValue(filter: FilterWithId): string {
  if (filter.operator === "between") return "";
  if (filter.operator === "in" && Array.isArray(filter.value)) {
    return filter.value.map(String).join(", ");
  }
  if (Array.isArray(filter.value)) return "";
  return String(filter.value ?? "");
}

function initialBetweenValue(filter: FilterWithId) {
  if (
    filter.operator !== "between" ||
    !filter.value ||
    typeof filter.value !== "object" ||
    Array.isArray(filter.value)
  ) {
    return { low: "", high: "" };
  }
  const value = filter.value as InsightFilterBetweenValue;
  return { low: String(value.low ?? ""), high: String(value.high ?? "") };
}

function fieldValue(field: CombinedField): string {
  return field.columnName ?? field.name;
}

function findField(fields: CombinedField[], value: string) {
  return fields.find((field) => fieldValue(field) === value);
}

export function filterFieldDisplayName(
  fields: CombinedField[],
  value: string,
): string {
  return findField(fields, value)?.displayName ?? value;
}

export function formatFilterValue(filter: InsightFilter): string {
  if (filter.operator === "between") {
    const value = filter.value as InsightFilterBetweenValue | undefined;
    return value && typeof value === "object"
      ? `${String(value.low ?? "")} and ${String(value.high ?? "")}`
      : "…";
  }
  if (Array.isArray(filter.value)) return filter.value.join(", ");
  return String(filter.value ?? "");
}

function FilterEditor({
  filter,
  fields,
  displayFields,
  control,
  dragHandle,
  onSave,
  onRemove,
  onDraftChange,
}: {
  filter?: FilterWithId;
  fields: CombinedField[];
  displayFields: CombinedField[];
  control?: RuntimeFilterControl;
  dragHandle?: ReactNode;
  onSave: (
    filter: FilterWithId,
    control: RuntimeFilterControl | undefined,
  ) => Promise<void> | void;
  onRemove?: () => void;
  onDraftChange?: (filter: FilterWithId | null) => void;
}) {
  const defaultField = fields[0] ? fieldValue(fields[0]) : "";
  const initial = useMemo<FilterWithId>(
    () =>
      filter ?? {
        _id: NEW_FILTER_ID,
        field: defaultField,
        operator: "eq",
        value: "",
      },
    [defaultField, filter],
  );
  const initialBetween = initialBetweenValue(initial);
  const [open, setOpen] = useState(false);
  const [field, setField] = useState(initial.field);
  const [operator, setOperator] = useState(initial.operator);
  const [scalarValue, setScalarValue] = useState(initialScalarValue(initial));
  const [betweenLow, setBetweenLow] = useState(initialBetween.low);
  const [betweenHigh, setBetweenHigh] = useState(initialBetween.high);
  const [viewerEditable, setViewerEditable] = useState(Boolean(control));
  const [label, setLabel] = useState(
    control?.label ?? filterFieldDisplayName(displayFields, initial.field),
  );
  const [labelEdited, setLabelEdited] = useState(
    Boolean(
      control &&
      control.label !== filterFieldDisplayName(displayFields, initial.field),
    ),
  );
  const [key, setKey] = useState(
    control?.key ?? (initial.id ? `filter-${initial.id}` : ""),
  );
  const [required, setRequired] = useState(control?.required ?? false);
  const [allowClear, setAllowClear] = useState(control?.allowClear ?? false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { setPending, isPending } = useSaveDismissGuard();
  const [isSaving, setIsSaving] = useSavingFlag(setPending);
  const selectedField =
    findField(displayFields, field) ?? findField(fields, field);
  const fieldOptions = useMemo(() => {
    if (!field || findField(fields, field)) return fields;
    const current = findField(displayFields, field);
    return current ? [...fields, current] : fields;
  }, [displayFields, field, fields]);
  const inputType = inputTypeForField(selectedField);
  const draft = useMemo<FilterDraft>(
    () => ({
      field,
      operator,
      inputType,
      scalarValue,
      betweenLow,
      betweenHigh,
    }),
    [betweenHigh, betweenLow, field, inputType, operator, scalarValue],
  );
  const isValid = isFilterDraftValid(draft);
  const operatorLabel =
    OPERATOR_OPTIONS.find((item) => item.value === filter?.operator)?.label ??
    filter?.operator;

  useEffect(() => {
    if (!open || !dirty) return;
    onDraftChange?.({
      ...initial,
      field,
      operator,
      value: buildFilterValue(draft),
    });
  }, [dirty, draft, field, initial, onDraftChange, open, operator]);

  const reset = () => {
    const between = initialBetweenValue(initial);
    setField(initial.field);
    setOperator(initial.operator);
    setScalarValue(initialScalarValue(initial));
    setBetweenLow(between.low);
    setBetweenHigh(between.high);
    setViewerEditable(Boolean(control));
    setLabel(
      control?.label ?? filterFieldDisplayName(displayFields, initial.field),
    );
    setLabelEdited(
      Boolean(
        control &&
        control.label !== filterFieldDisplayName(displayFields, initial.field),
      ),
    );
    setKey(control?.key ?? (initial.id ? `filter-${initial.id}` : ""));
    setRequired(control?.required ?? false);
    setAllowClear(control?.allowClear ?? false);
    setDirty(false);
    setError(null);
  };
  const close = () => {
    if (isPending()) return;
    onDraftChange?.(null);
    setOpen(false);
    reset();
  };
  const save = async () => {
    if (!isValid) return;
    setIsSaving(true);
    setError(null);
    try {
      const saved = prepareFilterForSave({
        ...initial,
        field,
        operator,
        value: buildFilterValue(draft),
      });
      const savedControl = viewerEditable
        ? {
            filterId: saved.id!,
            key: key.trim() || `filter-${saved.id}`,
            label: label || selectedField?.displayName || field,
            required: required || undefined,
            allowClear: allowClear || undefined,
          }
        : undefined;
      await onSave(saved, savedControl);
      onDraftChange?.(null);
      setOpen(false);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unknown error";
      setError(`Failed to save filter: ${message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const setChanged = <T,>(setter: (value: T) => void, value: T) => {
    setDirty(true);
    setter(value);
  };

  const displayName = filter
    ? filterFieldDisplayName(displayFields, filter.field)
    : "";
  const invalidField = Boolean(
    filter && !findField(displayFields, filter.field),
  );
  const trigger = filter ? (
    <WorkbenchChip
      dragHandle={dragHandle}
      icon={<ListFilter className="h-3.5 w-3.5" />}
      open={open}
      content={
        <PopoverTrigger
          render={
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left focus-visible:outline-none"
              aria-label={`Edit filter ${displayName}`}
            >
              <span
                className={cn(
                  "font-medium",
                  invalidField &&
                    "text-neutral-fg-subtle line-through decoration-neutral-fg-subtle",
                )}
              >
                {displayName}
              </span>{" "}
              <span className="text-neutral-fg-subtle">{operatorLabel}</span>{" "}
              <span className="font-medium">{formatFilterValue(filter)}</span>
            </button>
          }
        />
      }
      trailing={
        control ? (
          <Eye
            aria-label="Viewers can change"
            className="h-3.5 w-3.5 text-neutral-fg-subtle"
          />
        ) : undefined
      }
      removeLabel={`Remove filter ${displayName}`}
      onRemove={onRemove}
    />
  ) : (
    <PopoverTrigger
      render={
        <WorkbenchAddRow disabled={fields.length === 0}>
          Add filter
        </WorkbenchAddRow>
      }
    />
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
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Select
            value={field}
            onValueChange={(value) => {
              if (!value) return;
              setChanged(setField, value);
              if (!labelEdited) {
                setLabel(filterFieldDisplayName(displayFields, value));
              }
              setScalarValue("");
              setBetweenLow("");
              setBetweenHigh("");
            }}
          >
            <SelectTrigger aria-label="Field">
              <SelectValue placeholder="Field" />
            </SelectTrigger>
            <SelectContent>
              {field && !findField(fieldOptions, field) && (
                <SelectItem value={field}>{field}</SelectItem>
              )}
              {fieldOptions.map((item) => (
                <SelectItem key={item.id} value={fieldValue(item)}>
                  {item.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={operator}
            onValueChange={(value) => {
              if (!value) return;
              setChanged(setOperator, value as InsightFilter["operator"]);
              setScalarValue("");
              setBetweenLow("");
              setBetweenHigh("");
            }}
          >
            <SelectTrigger aria-label="Operator" className="w-32">
              <SelectValue>
                {OPERATOR_OPTIONS.find((item) => item.value === operator)
                  ?.label ?? operator}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {OPERATOR_OPTIONS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {operator === "between" ? (
          <div className="flex items-center gap-2">
            <Input
              aria-label="Range low bound"
              type={inputType}
              value={betweenLow}
              onChange={(event) =>
                setChanged(setBetweenLow, event.target.value)
              }
            />
            <span className="text-xs text-neutral-fg-subtle">to</span>
            <Input
              aria-label="Range high bound"
              type={inputType}
              value={betweenHigh}
              onChange={(event) =>
                setChanged(setBetweenHigh, event.target.value)
              }
            />
          </div>
        ) : (
          <Input
            aria-label="Value"
            type={operator === "in" ? "text" : inputType}
            value={scalarValue}
            onChange={(event) => setChanged(setScalarValue, event.target.value)}
            placeholder={operator === "in" ? "Comma-separated values" : "Value"}
          />
        )}
        <label className="flex items-center gap-2 text-xs">
          <Checkbox
            checked={viewerEditable}
            onCheckedChange={(checked) => {
              const next = checked === true;
              setViewerEditable(next);
              if (next && !labelEdited) {
                setLabel(selectedField?.displayName ?? field);
              }
            }}
          />
          Viewers can change
        </label>
        {viewerEditable && (
          <div className="space-y-3 border-t border-neutral-border/60 pt-3">
            <div className="space-y-1.5">
              <Label htmlFor={`runtime-label-${initial._id}`}>
                Shown to viewers as
              </Label>
              <Input
                id={`runtime-label-${initial._id}`}
                value={label}
                onChange={(event) => {
                  setLabelEdited(true);
                  setLabel(event.target.value);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`runtime-key-${initial._id}`}>Control key</Label>
              <Input
                id={`runtime-key-${initial._id}`}
                value={key}
                onChange={(event) => setKey(event.target.value)}
                placeholder="Generated on save"
              />
              {!key && (
                <p className="text-[11px] text-neutral-fg-subtle">
                  Generated on save
                </p>
              )}
            </div>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-xs">
                <Checkbox
                  checked={required}
                  onCheckedChange={(checked) => setRequired(checked === true)}
                />
                Required
              </label>
              <label className="flex items-center gap-2 text-xs">
                <Checkbox
                  checked={allowClear}
                  onCheckedChange={(checked) => setAllowClear(checked === true)}
                />
                Allow clear
              </label>
            </div>
          </div>
        )}
        <div className="flex justify-end">
          <Button
            label="Done"
            size="sm"
            loading={isSaving}
            disabled={!isValid || (viewerEditable && !label.trim())}
            onClick={() => void save()}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function FiltersSection({
  filters,
  combinedFields,
  displayFields = combinedFields,
  runtimeControls,
  onReorder,
  onRemove,
  onSave,
  onDraftChange,
}: {
  filters: FilterWithId[];
  combinedFields: CombinedField[];
  displayFields?: CombinedField[];
  runtimeControls?: InsightRuntimeDeclaration;
  onReorder: (filters: FilterWithId[]) => void;
  onRemove: (filterId: string) => void;
  onSave: (
    filter: FilterWithId,
    control: RuntimeFilterControl | undefined,
  ) => Promise<void> | void;
  onDraftChange?: (filter: FilterWithId | null) => void;
}) {
  const items: FilterSortableItem[] = filters.map((filter) => ({
    id: filter._id,
    filter,
  }));
  const handleReorder = useCallback(
    (next: FilterSortableItem[]) => onReorder(next.map((item) => item.filter)),
    [onReorder],
  );
  const controlsByFilter = useMemo(
    () =>
      new Map(
        (runtimeControls?.filters ?? []).map((control) => [
          control.filterId,
          control,
        ]),
      ),
    [runtimeControls?.filters],
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
            <FilterEditor
              filter={item.filter}
              fields={combinedFields}
              displayFields={displayFields}
              control={
                item.filter.id
                  ? controlsByFilter.get(item.filter.id)
                  : undefined
              }
              dragHandle={dragHandle}
              onSave={onSave}
              onRemove={() => onRemove(item.id)}
              onDraftChange={onDraftChange}
            />
          )}
        />
      )}
      <FilterEditor
        fields={combinedFields}
        displayFields={displayFields}
        onSave={onSave}
        onDraftChange={onDraftChange}
      />
    </div>
  );
}
