/**
 * DashboardControlBar — dashboard-level control strip.
 *
 * Renders each `DashboardControl` as a typed value input (categorical → text,
 * date → date, numeric → number) reusing the same field-type detection as the
 * FiltersSection editor.  A viewer turning a control writes into a VIEW-LOCAL
 * transient map that does NOT mutate the saved dashboard.
 *
 * Design constraints (from DESIGN.md):
 * - Surface system: no borders — uses shadow-lifted `bg-neutral-bg` strip.
 * - Off-token color forbidden — only `@wystack/ui` tokens.
 * - A signal earns its surface: the bar is only rendered when controls exist.
 */

import {
  resolveControlValue,
  setTransientValue,
} from "@/lib/dashboards/controls";
import type { CombinedField } from "@/lib/insights/compute-combined-fields";
import type { DashboardControl, InsightFilter } from "@dashframe/types";
import { Input, Label, cn } from "@wystack/ui";
import { SettingsIcon } from "@wystack/ui-icons";
import type { ChangeEvent } from "react";

// ---------------------------------------------------------------------------
// Helpers — reuse field-type detection from filter-value
// ---------------------------------------------------------------------------

type FilterInputType = "text" | "number" | "date";

function inputTypeForColumnType(type: CombinedField["type"]): FilterInputType {
  if (type === "number") return "number";
  if (type === "date") return "date";
  return "text";
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DashboardControlBarProps {
  controls: DashboardControl[];
  /**
   * Map of field → CombinedField so we can detect input type.
   * When a field isn't found, input defaults to "text".
   */
  fieldsByName: Map<string, CombinedField>;
  /** Current view-local transient values (viewer turns). */
  transientValues: Map<string, InsightFilter["value"]>;
  /** Called when the viewer changes a control value. */
  onTransientChange: (next: Map<string, InsightFilter["value"]>) => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// DashboardControlBar
// ---------------------------------------------------------------------------

/**
 * Renders a horizontal strip of typed control inputs.  Each control shows its
 * label (or field name) and a typed value input.
 *
 * The bar is only rendered when `controls` is non-empty.  Caller is responsible
 * for gating on that.
 */
export function DashboardControlBar({
  controls,
  fieldsByName,
  transientValues,
  onTransientChange,
  className,
}: DashboardControlBarProps) {
  if (controls.length === 0) return null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-4 border-b border-neutral-border/60 bg-neutral-bg px-6 py-3",
        className,
      )}
      aria-label="Dashboard controls"
    >
      {/* Icon label */}
      <div className="flex items-center gap-1.5 text-neutral-fg-subtle">
        <SettingsIcon className="h-3.5 w-3.5 shrink-0" />
        <span className="text-xs font-medium uppercase tracking-wide">
          Controls
        </span>
      </div>

      {/* Separator */}
      <div
        className="h-5 w-px shrink-0 bg-neutral-border/60"
        aria-hidden="true"
      />

      {/* Control inputs */}
      {controls.map((control) => (
        <ControlInput
          key={control.id}
          control={control}
          fieldsByName={fieldsByName}
          transientValues={transientValues}
          onTransientChange={onTransientChange}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ControlInput
// ---------------------------------------------------------------------------

interface ControlInputProps {
  control: DashboardControl;
  fieldsByName: Map<string, CombinedField>;
  transientValues: Map<string, InsightFilter["value"]>;
  onTransientChange: (next: Map<string, InsightFilter["value"]>) => void;
}

function ControlInput({
  control,
  fieldsByName,
  transientValues,
  onTransientChange,
}: ControlInputProps) {
  const field = fieldsByName.get(control.field);
  const inputType: FilterInputType = field
    ? inputTypeForColumnType(field.type)
    : "text";

  const currentValue = resolveControlValue(control, transientValues);
  const displayValue =
    currentValue !== undefined && currentValue !== null
      ? String(currentValue)
      : "";
  const label = control.label ?? control.field;

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    // Coerce to number for numeric controls so downstream filters get the
    // right type (buildInsightSQL compares typefully for numeric columns).
    let coerced: InsightFilter["value"] = raw;
    if (inputType === "number" && raw !== "") {
      const n = Number(raw);
      if (isFinite(n)) coerced = n;
    }
    onTransientChange(setTransientValue(transientValues, control.id, coerced));
  };

  return (
    <div className="flex items-center gap-2">
      <Label
        htmlFor={`control-${control.id}`}
        className="shrink-0 text-xs text-neutral-fg-subtle"
      >
        {label}
      </Label>
      <Input
        id={`control-${control.id}`}
        type={inputType}
        value={displayValue}
        onChange={handleChange}
        placeholder={`Filter ${label}…`}
        className="h-7 w-36 text-sm"
        aria-label={`Control: ${label}`}
      />
    </div>
  );
}
