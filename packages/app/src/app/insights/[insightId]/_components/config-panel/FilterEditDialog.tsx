import type { CombinedField } from "@/lib/insights/compute-combined-fields";
import type {
  InsightFilter,
  InsightFilterBetweenValue,
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
import { type ChangeEvent, useState } from "react";
import { NEW_FILTER_ID, prepareFilterForSave } from "./filter-id";
import {
  buildFilterValue,
  type FilterDraft,
  inputTypeForField,
  isFilterDraftValid,
} from "./filter-value";
import type { FilterWithId } from "./FiltersSection";
import { useSaveDismissGuard, useSavingFlag } from "./use-save-dismiss-guard";

// ============================================================================
// Types
// ============================================================================

type Operator = InsightFilter["operator"];

interface FilterEditDialogProps {
  /** null = closed; FilterWithId = edit mode; "new" = add mode */
  filter: FilterWithId | "new" | null;
  combinedFields: CombinedField[];
  onOpenChange: (open: boolean) => void;
  onSave: (filter: FilterWithId) => Promise<void> | void;
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

function initialScalarValue(filter: FilterWithId): string {
  if (filter.operator === "between") return "";
  if (filter.operator === "in" && Array.isArray(filter.value)) {
    return (filter.value as unknown[]).map(String).join(", ");
  }
  if (Array.isArray(filter.value)) return "";
  return String(filter.value ?? "");
}

function initialBetweenValue(filter: FilterWithId): {
  low: string;
  high: string;
} {
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

function saveButtonLabel(isSaving: boolean, isNew: boolean): string {
  if (!isSaving) return isNew ? "Add" : "Save";
  return isNew ? "Adding..." : "Saving...";
}

// ============================================================================
// FilterEditForm (inner; key-reset pattern from MetricEditDialog)
// ============================================================================

interface FilterEditFormProps {
  filter: FilterWithId;
  combinedFields: CombinedField[];
  onSave: (filter: FilterWithId) => Promise<void> | void;
  onClose: () => void;
  onPendingChange: (pending: boolean) => void;
  isNew: boolean;
}

function FilterEditForm({
  filter,
  combinedFields,
  onSave,
  onClose,
  onPendingChange,
  isNew,
}: FilterEditFormProps) {
  const [field, setField] = useState<string>(filter.field);
  const [operator, setOperator] = useState<Operator>(filter.operator);

  // Scalar value state (also used for the `in` operator as comma-separated string)
  const [scalarValue, setScalarValue] = useState(() =>
    initialScalarValue(filter),
  );

  // Between value state
  const initialBetween = initialBetweenValue(filter);
  const [betweenLow, setBetweenLow] = useState(initialBetween.low);
  const [betweenHigh, setBetweenHigh] = useState(initialBetween.high);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useSavingFlag(onPendingChange);

  const selectedField = combinedFields.find(
    (f) => (f.columnName ?? f.name) === field,
  );
  const inputType = inputTypeForField(selectedField);

  // The picker normally offers only filterable fields. An existing filter may
  // reference a field outside that set (e.g. an API-created filter on a column
  // the picker excludes); keep the current value selectable so the Select
  // doesn't render blank and the user can still edit operator/value.
  const fieldOptions =
    field && !selectedField
      ? [
          ...combinedFields,
          {
            id: `__current__${field}`,
            name: field,
            columnName: field,
            displayName: field,
          } as CombinedField,
        ]
      : combinedFields;

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

  const handleSave = async () => {
    if (!isValid) return;
    // prepareFilterForSave stamps a fresh persisted id on a new filter (and
    // sources its client `_id` from it). Generated per save, not per dialog
    // mount — FilterEditDialog is permanently mounted, so a mount-scoped id
    // would hand every Add the same value and make the second filter overwrite
    // the first. An existing filter keeps its id/_id so edits route correctly.
    setError(null);
    setIsSaving(true);
    try {
      await onSave(
        prepareFilterForSave({
          ...filter,
          field,
          operator,
          value: buildFilterValue(draft),
        }),
      );
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setError(`Failed to save filter: ${message}`);
    } finally {
      setIsSaving(false);
    }
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
        {error && (
          <Alert color="danger">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

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
              {fieldOptions.length === 0 ? (
                <div className="p-2 text-center text-sm text-neutral-fg-subtle">
                  No fields available
                </div>
              ) : (
                fieldOptions.map((f) => (
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
        <Button
          label="Cancel"
          variant="outline"
          onClick={onClose}
          disabled={isSaving}
        />
        <Button
          label={saveButtonLabel(isSaving, isNew)}
          onClick={handleSave}
          disabled={isSaving || !isValid}
          loading={isSaving}
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

  const effectiveFilter: FilterWithId | null = (() => {
    if (filter === null) return null;
    if (filter === "new") {
      // A new-filter draft carries NO persisted `id` — the id is assigned at
      // save time (FilterEditForm.handleSave), so each Add yields a distinct
      // filter. `_id` here is only the client key for the form below; it is a
      // fixed sentinel because the form fully unmounts when the dialog closes
      // (filter → null), which already resets its state between Add sessions.
      return {
        _id: NEW_FILTER_ID,
        field: combinedFields[0]
          ? (combinedFields[0].columnName ?? combinedFields[0].name)
          : "",
        operator: "eq",
        value: "",
      };
    }
    return filter;
  })();

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

  return (
    <Dialog open={isOpen} onOpenChange={handleDismiss}>
      <DialogContent className="sm:max-w-md">
        {effectiveFilter && (
          <FilterEditForm
            key={effectiveFilter._id + (isNew ? "-new" : "-edit")}
            filter={effectiveFilter}
            combinedFields={combinedFields}
            onSave={onSave}
            onClose={handleClose}
            onPendingChange={setPending}
            isNew={isNew}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
