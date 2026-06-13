import type { CombinedField } from "@/lib/insights/compute-combined-fields";
import type {
  InsightFilter,
  InsightFilterBetweenValue,
} from "@dashframe/types";
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
import { type ChangeEvent, useMemo, useState } from "react";
import {
  buildFilterValue,
  type FilterDraft,
  inputTypeForField,
  isFilterDraftValid,
} from "./filter-value";
import type { FilterWithId } from "./FiltersSection";

// ============================================================================
// Types
// ============================================================================

type Operator = InsightFilter["operator"];

interface FilterEditDialogProps {
  /** null = closed; FilterWithId = edit mode; "new" = add mode */
  filter: FilterWithId | "new" | null;
  combinedFields: CombinedField[];
  onOpenChange: (open: boolean) => void;
  onSave: (filter: FilterWithId) => void;
}

// ============================================================================
// Helpers
// ============================================================================

const OPERATOR_OPTIONS: { value: Operator; label: string }[] = [
  { value: "eq", label: "equals (=)" },
  { value: "ne", label: "not equals (≠)" },
  { value: "gt", label: "greater than (>)" },
  { value: "gte", label: "greater than or equal (≥)" },
  { value: "lt", label: "less than (<)" },
  { value: "lte", label: "less than or equal (≤)" },
  { value: "contains", label: "contains" },
  { value: "between", label: "between" },
  { value: "in", label: "in (list)" },
];

// ============================================================================
// FilterEditForm (inner; key-reset pattern from MetricEditDialog)
// ============================================================================

interface FilterEditFormProps {
  filter: FilterWithId;
  combinedFields: CombinedField[];
  onSave: (filter: FilterWithId) => void;
  onClose: () => void;
  isNew: boolean;
}

function FilterEditForm({
  filter,
  combinedFields,
  onSave,
  onClose,
  isNew,
}: FilterEditFormProps) {
  const [field, setField] = useState<string>(filter.field);
  const [operator, setOperator] = useState<Operator>(filter.operator);

  // Scalar value state (also used for the `in` operator as comma-separated string)
  const initialScalar = (() => {
    if (filter.operator === "between") return "";
    if (filter.operator === "in" && Array.isArray(filter.value)) {
      return (filter.value as unknown[]).map(String).join(", ");
    }
    if (Array.isArray(filter.value)) return "";
    return String(filter.value ?? "");
  })();
  const [scalarValue, setScalarValue] = useState(initialScalar);

  // Between value state
  const initialBetween = (() => {
    if (
      filter.operator === "between" &&
      filter.value &&
      typeof filter.value === "object" &&
      !Array.isArray(filter.value)
    ) {
      const v = filter.value as InsightFilterBetweenValue;
      return { low: String(v.low ?? ""), high: String(v.high ?? "") };
    }
    return { low: "", high: "" };
  })();
  const [betweenLow, setBetweenLow] = useState(initialBetween.low);
  const [betweenHigh, setBetweenHigh] = useState(initialBetween.high);

  const selectedField = combinedFields.find(
    (f) => (f.columnName ?? f.name) === field,
  );
  const inputType = inputTypeForField(selectedField);

  const isBetween = operator === "between";
  const isIn = operator === "in";

  const draft: FilterDraft = {
    field,
    operator,
    inputType,
    scalarValue,
    betweenLow,
    betweenHigh,
  };
  const isValid = isFilterDraftValid(draft);

  let valuePlaceholder = "Enter a value";
  if (isIn) valuePlaceholder = "e.g. a, b, c";
  else if (inputType === "number") valuePlaceholder = "Enter a number";

  const handleSave = () => {
    if (!isValid) return;
    onSave({
      ...filter,
      field,
      operator,
      value: buildFilterValue(draft),
    });
    onClose();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isNew ? "Add filter" : "Edit filter"}</DialogTitle>
        <DialogDescription>
          {isNew
            ? "Configure a filter predicate for this insight."
            : "Modify the filter predicate."}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-4">
        {/* Field picker */}
        <div className="space-y-2">
          <Label htmlFor="filter-field">Field</Label>
          <Select
            value={field}
            onValueChange={(v: string | null) => {
              if (v) setField(v);
              // Reset values when field changes
              setScalarValue("");
              setBetweenLow("");
              setBetweenHigh("");
            }}
          >
            <SelectTrigger id="filter-field">
              <SelectValue placeholder="Select a field" />
            </SelectTrigger>
            <SelectContent>
              {combinedFields.length === 0 ? (
                <div className="p-2 text-center text-sm text-neutral-fg-subtle">
                  No fields available
                </div>
              ) : (
                combinedFields.map((f) => (
                  <SelectItem key={f.id} value={f.columnName ?? f.name}>
                    {f.displayName}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>

        {/* Operator picker */}
        <div className="space-y-2">
          <Label htmlFor="filter-operator">Operator</Label>
          <Select
            value={operator}
            onValueChange={(v: string | null) => {
              if (v) setOperator(v as Operator);
              // Reset values on operator change
              setScalarValue("");
              setBetweenLow("");
              setBetweenHigh("");
            }}
          >
            <SelectTrigger id="filter-operator">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OPERATOR_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Value input */}
        {isBetween ? (
          <div className="space-y-2">
            <Label>Range</Label>
            <div className="flex items-center gap-2">
              <Input
                type={inputType}
                placeholder="Low"
                value={betweenLow}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setBetweenLow(e.target.value)
                }
                className="flex-1"
                aria-label="Range low bound"
              />
              <span className="shrink-0 text-sm text-neutral-fg-subtle">
                to
              </span>
              <Input
                type={inputType}
                placeholder="High"
                value={betweenHigh}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setBetweenHigh(e.target.value)
                }
                className="flex-1"
                aria-label="Range high bound"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="filter-value">
              {isIn ? "Values (comma-separated)" : "Value"}
            </Label>
            <Input
              id="filter-value"
              type={isIn ? "text" : inputType}
              placeholder={valuePlaceholder}
              value={scalarValue}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setScalarValue(e.target.value)
              }
            />
          </div>
        )}
      </div>

      <DialogFooter>
        <Button label="Cancel" variant="outline" onClick={onClose} />
        <Button
          label={isNew ? "Add" : "Save"}
          onClick={handleSave}
          disabled={!isValid}
        />
      </DialogFooter>
    </>
  );
}

// ============================================================================
// FilterEditDialog (shell; key-reset pattern from MetricEditDialog)
// ============================================================================

/**
 * FilterEditDialog — dialog for adding or editing an insight filter predicate.
 *
 * Supports all operators defined in InsightFilter: eq, ne, gt, gte, lt, lte,
 * contains, in, between. The `between` operator shows two inputs coalesced to
 * { low, high }. Value input type is auto-detected from the field's ColumnType.
 *
 * Uses the key-based reset pattern from MetricEditDialog so inner state is
 * always fresh when the dialog is opened for a different filter.
 */
export function FilterEditDialog({
  filter,
  combinedFields,
  onOpenChange,
  onSave,
}: FilterEditDialogProps) {
  const isOpen = filter !== null;
  const isNew = filter === "new";

  /**
   * Stable UUID for the "new" session. Memoized so a parent re-render while
   * the dialog is open (e.g. an insight subscription firing) does not generate
   * a new UUID and silently remount FilterEditForm mid-fill, discarding the
   * user's in-progress input.
   *
   * This UUID becomes the filter's persisted `id`, so it survives subscription
   * round-trips and InsightConfigPanel can match the saved filter by a stable
   * identity rather than a fragile array index.
   */
  const newFilterId = useMemo(
    () => crypto.randomUUID(),
    // Intentionally empty: we want one UUID per mount of FilterEditDialog,
    // not per render. A new session (filter null→"new") unmounts+remounts this
    // component because the parent sets filterToEdit=null on close first.
    [],
  );

  const effectiveFilter: FilterWithId | null = (() => {
    if (filter === null) return null;
    if (filter === "new") {
      return {
        id: newFilterId,
        _id: newFilterId,
        field: combinedFields[0]
          ? (combinedFields[0].columnName ?? combinedFields[0].name)
          : "",
        operator: "eq",
        value: "",
      };
    }
    return filter;
  })();

  const handleClose = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        {effectiveFilter && (
          <FilterEditForm
            key={effectiveFilter._id + (isNew ? "-new" : "-edit")}
            filter={effectiveFilter}
            combinedFields={combinedFields}
            onSave={onSave}
            onClose={handleClose}
            isNew={isNew}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
