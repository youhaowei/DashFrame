/**
 * Per-field override row rendered inside the OverridePopover.
 *
 * One row = one overrideable field in the 4-state machine:
 *   inherit → pinned → cleared → bound
 *
 * The component is intentionally PURE — it receives a derived `state` object
 * and emits callbacks for each transition.  No data fetching, no mutations.
 * All override payload assembly lives in override-field-row-utils.ts and is
 * tested there without rendering.
 */

import {
  buildFilterValue,
  inputTypeForField,
  isFilterDraftValid,
  type FilterDraft,
} from "@/app/insights/[insightId]/_components/config-panel/filter-value";
import type { CombinedField } from "@/lib/insights/compute-combined-fields";
import type {
  DashboardControl,
  InsightFilter,
  InsightFilterOverride,
} from "@dashframe/types";
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from "@wystack/ui";
import { CheckIcon, CloseIcon } from "@wystack/ui-icons";
import { useState } from "react";
import {
  formatFilterValue,
  formatOperator,
  type FieldOverrideState,
} from "./override-field-row-utils";

// ---------------------------------------------------------------------------
// Operator options
// ---------------------------------------------------------------------------

type Operator = InsightFilter["operator"];

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

// ---------------------------------------------------------------------------
// Draft helpers
// ---------------------------------------------------------------------------

function makeDraft(field: string, combinedField?: CombinedField): FilterDraft {
  return {
    field,
    operator: "eq",
    inputType: inputTypeForField(combinedField),
    scalarValue: "",
    betweenLow: "",
    betweenHigh: "",
  };
}

function draftFromFilter(
  filter: InsightFilterOverride,
  combinedField?: CombinedField,
): FilterDraft {
  const inputType = inputTypeForField(combinedField);
  let scalarValue = "";
  let betweenLow = "";
  let betweenHigh = "";

  if (
    filter.operator === "between" &&
    filter.value != null &&
    typeof filter.value === "object"
  ) {
    const bv = filter.value as { low: unknown; high: unknown };
    betweenLow = String(bv.low ?? "");
    betweenHigh = String(bv.high ?? "");
  } else if (filter.operator === "in" && Array.isArray(filter.value)) {
    scalarValue = (filter.value as unknown[]).join(", ");
  } else {
    scalarValue = String(filter.value ?? "");
  }

  return {
    field: filter.field,
    operator: filter.operator,
    inputType,
    scalarValue,
    betweenLow,
    betweenHigh,
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OverrideFieldRowProps {
  /** Source column name for this field. */
  fieldName: string;
  /** Human-readable label (defaults to fieldName). */
  displayName?: string;
  /** Derived 4-state override state for this field. */
  state: FieldOverrideState;
  /** Combined field info for type-aware value editors. */
  combinedField?: CombinedField;
  /**
   * Controls eligible for binding to this field.  Shown in a dropdown when
   * the state is `inherit` or `pinned`.  Hidden when empty.
   */
  eligibleControls?: DashboardControl[];

  // Transition callbacks — the parent assembles the full overrides payload.
  /** Called with the new InsightFilterOverride when the user saves a pin. */
  onPin: (filter: InsightFilterOverride) => void;
  /** Called when the user clears this field (widen — remove insight filter). */
  onClear: () => void;
  /** Called when the user resets to inherit (remove override entry). */
  onInherit: () => void;
  /** Called when the user binds to a control. */
  onBind?: (controlId: string) => void;
  /** Called when the user unbinds from a control. */
  onUnbind?: () => void;
}

// ---------------------------------------------------------------------------
// Inline filter editor
// ---------------------------------------------------------------------------

function InlineFilterEditor({
  fieldName,
  initialDraft,
  onSave,
  onCancel,
}: {
  fieldName: string;
  initialDraft: FilterDraft;
  onSave: (filter: InsightFilterOverride) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<FilterDraft>(initialDraft);
  const valid = isFilterDraftValid(draft);

  function handleSave() {
    if (!valid) return;
    const value = buildFilterValue(draft);
    const filter: InsightFilterOverride = {
      field: fieldName,
      operator: draft.operator,
      value,
    };
    onSave(filter);
  }

  return (
    <div className="mt-1.5 space-y-1.5 rounded-md bg-neutral-bg p-2">
      {/* Operator select */}
      <div className="flex items-center gap-1.5">
        <Label className="w-16 shrink-0 text-xs text-neutral-fg-subtle">
          operator
        </Label>
        <Select
          value={draft.operator}
          onValueChange={(val) =>
            setDraft((d) => ({ ...d, operator: val as Operator }))
          }
        >
          <SelectTrigger className="h-7 flex-1 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OPERATOR_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} className="text-xs">
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Value input(s) */}
      {draft.operator === "between" ? (
        <div className="flex items-center gap-1.5">
          <Label className="w-16 shrink-0 text-xs text-neutral-fg-subtle">
            range
          </Label>
          <Input
            type={draft.inputType}
            placeholder="low"
            value={draft.betweenLow}
            onChange={(e) =>
              setDraft((d) => ({ ...d, betweenLow: e.target.value }))
            }
            className="h-7 flex-1 text-xs"
          />
          <span className="text-xs text-neutral-fg-subtle">–</span>
          <Input
            type={draft.inputType}
            placeholder="high"
            value={draft.betweenHigh}
            onChange={(e) =>
              setDraft((d) => ({ ...d, betweenHigh: e.target.value }))
            }
            className="h-7 flex-1 text-xs"
          />
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <Label className="w-16 shrink-0 text-xs text-neutral-fg-subtle">
            {draft.operator === "in" ? "values" : "value"}
          </Label>
          <Input
            type={draft.operator === "in" ? "text" : draft.inputType}
            placeholder={draft.operator === "in" ? "a, b, c" : ""}
            value={draft.scalarValue}
            onChange={(e) =>
              setDraft((d) => ({ ...d, scalarValue: e.target.value }))
            }
            className="h-7 flex-1 text-xs"
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-1">
        <Button
          label="Cancel"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          label="Pin value"
          variant="solid"
          size="sm"
          disabled={!valid}
          className="h-6 px-2 text-xs"
          onClick={handleSave}
        >
          <CheckIcon className="mr-1 h-3 w-3" />
          Pin
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function OverrideFieldRow({
  fieldName,
  displayName,
  state,
  combinedField,
  eligibleControls = [],
  onPin,
  onClear,
  onInherit,
  onBind,
  onUnbind,
}: OverrideFieldRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const label = displayName ?? fieldName;

  function startEditing() {
    setIsEditing(true);
  }
  function stopEditing() {
    setIsEditing(false);
  }

  function handlePinSave(filter: InsightFilterOverride) {
    stopEditing();
    onPin(filter);
  }

  // Derive the initial draft for the inline editor.
  const initialDraft =
    state.type === "pinned"
      ? draftFromFilter(state.filter, combinedField)
      : makeDraft(fieldName, combinedField);

  return (
    <div className="py-1.5">
      {/* Row header */}
      <div className="flex items-start gap-2">
        {/* Field label + state indicator */}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            className={cn(
              "text-xs font-medium",
              state.type === "bound"
                ? "text-neutral-fg-subtle"
                : "text-neutral-fg",
            )}
          >
            {label}
          </span>

          {/* State-specific value/info line */}
          {state.type === "inherit" && state.insightFilter && (
            <span className="truncate text-xs text-neutral-fg-disabled">
              default: {formatOperator(state.insightFilter.operator)}{" "}
              {formatFilterValue(state.insightFilter)}
            </span>
          )}
          {state.type === "pinned" && !isEditing && (
            <button
              type="button"
              onClick={startEditing}
              className="truncate text-left text-xs text-neutral-fg-subtle underline-offset-2 hover:underline"
            >
              {formatOperator(state.filter.operator)}{" "}
              {formatFilterValue(state.filter)}
            </button>
          )}
          {state.type === "cleared" && (
            <span className="text-xs text-neutral-fg-disabled">
              showing all (cleared)
            </span>
          )}
          {state.type === "bound" && (
            <span className="text-xs text-neutral-fg-disabled">
              ← {state.control.label ?? state.control.field}
              {state.dormantFilter && (
                <span className="ml-1 opacity-60">
                  (dormant: {formatOperator(state.dormantFilter.operator)}{" "}
                  {formatFilterValue(state.dormantFilter)})
                </span>
              )}
            </span>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex shrink-0 items-center gap-0.5">
          {state.type === "bound" ? (
            // Bound state: only unbind
            <Button
              label="Unbind from control"
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-xs"
              onClick={onUnbind}
            >
              Unbind
            </Button>
          ) : (
            <>
              {/* Inherit/Cleared: offer Pin */}
              {(state.type === "inherit" || state.type === "cleared") &&
                !isEditing && (
                  <Button
                    label="Pin a value"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 text-xs"
                    onClick={startEditing}
                  >
                    Pin
                  </Button>
                )}
              {/* Pinned: offer edit (inline, clicking the value line also works) */}
              {state.type === "pinned" && !isEditing && (
                <Button
                  label="Edit pinned value"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-xs"
                  onClick={startEditing}
                >
                  Edit
                </Button>
              )}

              {/* Clear button (available from inherit and pinned states) */}
              {(state.type === "inherit" || state.type === "pinned") &&
                !isEditing && (
                  <Button
                    label="Clear — remove insight filter for this field"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 text-xs text-neutral-fg-subtle"
                    onClick={onClear}
                  >
                    Clear
                  </Button>
                )}

              {/* Reset to inherit (from pinned or cleared) */}
              {(state.type === "pinned" || state.type === "cleared") &&
                !isEditing && (
                  <Button
                    label="Reset to inherit"
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-neutral-fg-subtle"
                    onClick={onInherit}
                  >
                    <CloseIcon className="h-3 w-3" />
                  </Button>
                )}

              {/* Bind to control dropdown (inherit/pinned + eligible controls exist) */}
              {(state.type === "inherit" || state.type === "pinned") &&
                !isEditing &&
                eligibleControls.length > 0 &&
                onBind && (
                  <Select
                    onValueChange={(val) => {
                      if (typeof val === "string") onBind(val);
                    }}
                  >
                    <SelectTrigger
                      className="h-6 w-auto gap-1 border-0 bg-transparent px-1.5 text-xs text-neutral-fg-subtle shadow-none hover:bg-neutral-bg"
                      aria-label="Bind to dashboard control"
                    >
                      Bind ▾
                    </SelectTrigger>
                    <SelectContent>
                      {eligibleControls.map((c) => (
                        <SelectItem key={c.id} value={c.id} className="text-xs">
                          {c.label ?? c.field}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
            </>
          )}
        </div>
      </div>

      {/* Inline editor (expanded when isEditing) */}
      {isEditing && (
        <InlineFilterEditor
          fieldName={fieldName}
          initialDraft={initialDraft}
          onSave={handlePinSave}
          onCancel={stopEditing}
        />
      )}
    </div>
  );
}
