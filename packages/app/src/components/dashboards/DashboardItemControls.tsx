/**
 * The runtime controls a reader sees on one report tile.
 *
 * Drawn from the list `resolveItemControls` produces, so this component never
 * decides *what* is disclosed — only how. Sort and limit sit first as their own
 * group, then the filters; a pinned control is on the face, everything else
 * the author exposed collapses behind one "+N" chip. A changeable control is a
 * well with a caret (a knob); a fixed one is a flat chip (a fact). Both say
 * the same words, the author's label and the current value.
 *
 * A reader's change is handed up through `onChange` as a partial override and
 * is never written to the item or the Insight.
 */

import {
  filterLiteral,
  type ExposedItemControl,
} from "@/lib/dashboards/item-controls";
import type { DashboardItemOverrides, InsightSort } from "@dashframe/types";
import {
  Input,
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
import { ChevronDownIcon } from "@wystack/ui-react/icons";
import { useState, type ChangeEvent, type KeyboardEvent } from "react";

export type ControlInputType = "text" | "number" | "date";

/**
 * One field the sort knob may pick. `value` is the field or metric id the
 * Insight declared; `aliases` are the other names the same column goes by in
 * a saved or overridden sort (column name, metric alias), so the knob can
 * recognise the current sort whichever spelling it arrived in.
 */
export interface SortOption {
  value: string;
  label: string;
  aliases?: readonly string[];
}

export interface DashboardItemControlsProps {
  controls: readonly ExposedItemControl[];
  /** Input type for a filter knob, from the field's column type. */
  inputTypeFor: (control: ExposedItemControl) => ControlInputType;
  /** Fields the sort knob may pick from, in the Insight's declared order. */
  sortOptions: readonly SortOption[];
  limitBounds?: { min: number; max: number };
  /** Absent = every control is a fact, whatever it declares. */
  onChange?: (patch: DashboardItemOverrides) => void;
  className?: string;
}

export function DashboardItemControls({
  controls,
  inputTypeFor,
  sortOptions,
  limitBounds,
  onChange,
  className,
}: DashboardItemControlsProps) {
  if (controls.length === 0) return null;
  const pinned = controls.filter((control) => control.pinned);
  const collapsed = controls.filter((control) => !control.pinned);
  const shape = pinned.filter((control) => control.kind !== "filter");
  const filters = pinned.filter((control) => control.kind === "filter");

  const editorFor = (control: ExposedItemControl) => (
    <ControlEditor
      control={control}
      inputType={inputTypeFor(control)}
      sortOptions={sortOptions}
      limitBounds={limitBounds}
      onChange={onChange!}
    />
  );
  const face = (control: ExposedItemControl) =>
    onChange && control.changeable ? (
      <Knob key={control.key} control={control}>
        {editorFor(control)}
      </Knob>
    ) : (
      <Fact key={control.key} control={control} />
    );

  return (
    <div
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5", className)}
      aria-label="Chart settings"
    >
      {shape.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {shape.map(face)}
        </div>
      )}
      {(filters.length > 0 || collapsed.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {filters.map(face)}
          {collapsed.length > 0 && (
            <Popover>
              <PopoverTrigger
                className={cn(
                  chipClass,
                  "cursor-pointer hover:bg-neutral-bg-emphasis focus-visible:ring-2 focus-visible:ring-neutral-ring focus-visible:outline-none",
                )}
                aria-label={`${collapsed.length} more setting${collapsed.length === 1 ? "" : "s"}`}
              >
                <span className="font-medium text-neutral-fg">
                  +{collapsed.length}
                </span>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-64 p-2">
                <ul className="flex flex-col gap-1">
                  {collapsed.map((control) => (
                    <li
                      key={control.key}
                      className="flex flex-col gap-1 rounded-md px-2 py-1.5"
                    >
                      <Words control={control} />
                      {onChange && control.changeable
                        ? editorFor(control)
                        : null}
                    </li>
                  ))}
                </ul>
              </PopoverContent>
            </Popover>
          )}
        </div>
      )}
    </div>
  );
}

const chipClass =
  "inline-flex max-w-full items-center gap-1 rounded-full bg-neutral-bg-muted px-2 py-0.5 text-xs leading-5";

function Words({ control }: { control: ExposedItemControl }) {
  return (
    <>
      {control.label ? (
        <span className="truncate text-neutral-fg-subtle">{control.label}</span>
      ) : null}
      <span className="truncate font-medium text-neutral-fg">
        {control.valueText}
      </span>
    </>
  );
}

function Fact({ control }: { control: ExposedItemControl }) {
  return (
    <span className={chipClass} data-control-kind={control.kind}>
      <Words control={control} />
    </span>
  );
}

function Knob({
  control,
  children,
}: {
  control: ExposedItemControl;
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger
        data-control-kind={control.kind}
        className="inline-flex max-w-full cursor-pointer items-center gap-1 rounded-md border border-neutral-border bg-neutral-bg px-2 py-0.5 text-xs leading-5 transition-colors hover:bg-neutral-bg-subtle focus-visible:ring-2 focus-visible:ring-neutral-ring focus-visible:outline-none"
        aria-label={`Change ${control.label || control.valueText}`}
      >
        <Words control={control} />
        <ChevronDownIcon
          className="h-3 w-3 shrink-0 text-neutral-fg-subtle"
          aria-hidden="true"
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-3">
        {children}
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Editors — one per kind. Each emits a partial override for its own key only.
// ---------------------------------------------------------------------------

const DIRECTION_ITEMS = [
  { value: "desc", label: "High to low" },
  { value: "asc", label: "Low to high" },
];

/** The declared option the current sort names, under any of its spellings. */
export function resolveSortOption(
  options: readonly SortOption[],
  field: string | undefined,
): SortOption | undefined {
  if (!field) return undefined;
  return options.find(
    (option) => option.value === field || option.aliases?.includes(field),
  );
}

function SortEditor({
  control,
  sortOptions,
  onChange,
}: {
  control: ExposedItemControl;
  sortOptions: readonly SortOption[];
  onChange: (patch: DashboardItemOverrides) => void;
}) {
  const current: InsightSort | undefined = control.sort;
  // No silent substitution: a sort the Insight does not allow the reader to
  // pick shows as unselected, and flipping the direction alone changes
  // nothing until a field is chosen.
  const field = resolveSortOption(sortOptions, current?.field)?.value ?? "";
  const direction = current?.direction ?? "desc";
  return (
    <div className="flex items-center gap-1.5">
      <Select
        value={field}
        items={sortOptions.map((option) => ({
          value: option.value,
          label: option.label,
        }))}
        onValueChange={(next) => {
          if (next) onChange({ sorts: [{ field: next, direction }] });
        }}
      >
        <SelectTrigger size="sm" aria-label="Sort by" className="text-xs">
          <SelectValue placeholder="Field" />
        </SelectTrigger>
        <SelectContent>
          {sortOptions.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              className="text-xs"
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={direction}
        items={DIRECTION_ITEMS}
        disabled={field === ""}
        onValueChange={(next) => {
          if (field && (next === "asc" || next === "desc"))
            onChange({ sorts: [{ field, direction: next }] });
        }}
      >
        <SelectTrigger size="sm" aria-label="Direction" className="text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="desc" className="text-xs">
            High to low
          </SelectItem>
          <SelectItem value="asc" className="text-xs">
            Low to high
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Committed on blur or Enter, never per keystroke, so typing "50" does not
 * get clamped at "5". An emptied box clears the reader's limit and the tile
 * goes back to all rows.
 */
function LimitEditor({
  control,
  bounds,
  onChange,
}: {
  control: ExposedItemControl;
  bounds?: { min: number; max: number };
  onChange: (patch: DashboardItemOverrides) => void;
}) {
  const [draft, setDraft] = useState(
    control.limit === undefined ? "" : String(control.limit),
  );
  const commit = () => {
    if (draft.trim() === "") {
      if (control.limit !== undefined) onChange({ limit: undefined });
      return;
    }
    const next = Number(draft);
    if (!Number.isFinite(next)) {
      setDraft(control.limit === undefined ? "" : String(control.limit));
      return;
    }
    const min = bounds?.min ?? 1;
    const max = bounds?.max ?? Number.POSITIVE_INFINITY;
    const clamped = Math.min(max, Math.max(min, Math.trunc(next)));
    setDraft(String(clamped));
    if (clamped !== control.limit) onChange({ limit: clamped });
  };
  return (
    <Input
      type="number"
      min={bounds?.min}
      max={bounds?.max}
      value={draft}
      placeholder="All"
      aria-label={control.label || "Limit"}
      className="h-7 w-24 text-xs"
      onChange={(event: ChangeEvent<HTMLInputElement>) =>
        setDraft(event.target.value)
      }
      onBlur={commit}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") commit();
      }}
    />
  );
}

function displayValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value === null || value === undefined) return "";
  return String(value);
}

function ControlEditor({
  control,
  inputType,
  sortOptions,
  limitBounds,
  onChange,
}: {
  control: ExposedItemControl;
  inputType: ControlInputType;
  sortOptions: readonly SortOption[];
  limitBounds?: { min: number; max: number };
  onChange: (patch: DashboardItemOverrides) => void;
}) {
  if (control.kind === "sort") {
    return (
      <SortEditor
        control={control}
        sortOptions={sortOptions}
        onChange={onChange}
      />
    );
  }

  if (control.kind === "limit") {
    return (
      <LimitEditor
        // Remount when the effective limit changes from outside the box (a
        // report control, a cleared override) so the draft never disagrees
        // with the tile.
        key={String(control.limit)}
        control={control}
        bounds={limitBounds}
        onChange={onChange}
      />
    );
  }

  const filter = control.filter!;
  const currentValue = control.override?.cleared
    ? ""
    : filterLiteral(control.override?.value ?? filter.value);
  const display = displayValue(currentValue);
  return (
    <Input
      type={inputType}
      value={display}
      aria-label={control.label || control.valueText}
      className="h-7 w-full text-xs"
      onChange={(event: ChangeEvent<HTMLInputElement>) => {
        const raw = event.target.value;
        let value: unknown = raw;
        if (filter.operator === "in") {
          value = raw
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean);
        } else if (inputType === "number" && raw !== "") {
          const n = Number(raw);
          if (Number.isFinite(n)) value = n;
        }
        onChange({
          filters: [
            {
              id: filter.id,
              field: filter.field,
              operator: filter.operator,
              value,
            },
          ],
        });
      }}
    />
  );
}
