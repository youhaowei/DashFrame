/**
 * The runtime controls a reader sees on one report tile.
 *
 * Drawn from the list `resolveItemControls` produces, so nothing here decides
 * *what* is disclosed, only how. There are two places a control can be:
 *
 * - The control line, under the title, carries facts: the filters the author
 *   pinned. A changeable one is a well with a caret (a knob); a fixed one is a
 *   flat chip (a fact). Both say the author's label and the current value. A
 *   tile with nothing pinned has no control line.
 * - One button on the title line opens everything else the author exposed,
 *   grouped as filters, then sort, then rows. Nothing mechanical is pinnable:
 *   a sort or limit has no value to put in a pill.
 *
 * The popover opens beside the tile, never over the chart the reader is
 * changing, and flips to the other side when there is no room.
 *
 * A reader's change is handed up through `onChange` as a partial override and
 * is never written to the item or the Insight.
 */

import {
  filterLiteral,
  type ExposedItemControl,
  type ItemControlKind,
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
import {
  ArrowUpDownIcon,
  ChevronDownIcon,
  ControlsIcon,
  FilterIcon,
  ListIcon,
} from "@wystack/ui-react/icons";
import {
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

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

interface EditorContext {
  /** Input type for a filter knob, from the field's column type. */
  inputTypeFor: (control: ExposedItemControl) => ControlInputType;
  /** Fields the sort knob may pick from, in the Insight's declared order. */
  sortOptions: readonly SortOption[];
  limitBounds?: { min: number; max: number };
  /** Absent = every control is a fact, whatever it declares. */
  onChange?: (patch: DashboardItemOverrides) => void;
}

export interface TileControlsProps extends EditorContext {
  controls: readonly ExposedItemControl[];
}

/** The tile element, which marks itself for the grid and for this popover. */
export const TILE_SELECTOR = "[data-dashframe-widget-id]";

/**
 * While a tile's control popover is open, the rest of the report recedes and
 * that tile stays fully lit, so the reader watches their own chart change.
 * The page root is the `group/report`; the open door marks itself with
 * `data-tile-door` and Base UI's `data-popup-open`.
 */
export const recedeWhileTileControlsOpen =
  "transition-opacity duration-200 motion-reduce:transition-none group-has-[[data-tile-door][data-popup-open]]/report:opacity-[0.32]";
export const stayLitWhileOwnControlsOpen =
  "has-[[data-tile-door][data-popup-open]]:opacity-100!";

function editorFor(control: ExposedItemControl, context: EditorContext) {
  return (
    <ControlEditor
      control={control}
      inputType={context.inputTypeFor(control)}
      sortOptions={context.sortOptions}
      limitBounds={context.limitBounds}
      onChange={context.onChange!}
    />
  );
}

/**
 * The control line: pinned filters only. Every pill on it is something the
 * chart is claiming; nothing on it is a way in.
 */
export function TileControlLine({
  controls,
  className,
  ...context
}: TileControlsProps & { className?: string }) {
  const pinned = controls.filter((control) => control.pinned);
  if (pinned.length === 0) return null;
  return (
    <div
      className={cn("flex flex-wrap items-center gap-1.5", className)}
      aria-label="Chart filters"
    >
      {pinned.map((control) =>
        context.onChange && control.changeable ? (
          <Knob key={control.key} control={control}>
            {editorFor(control, context)}
          </Knob>
        ) : (
          <Fact key={control.key} control={control} />
        ),
      )}
    </div>
  );
}

type DoorPlacement = {
  side: "right" | "left" | "bottom";
  align: "start" | "end";
};
const BESIDE_RIGHT: DoorPlacement = { side: "right", align: "start" };
/** The popover's width (`w-80`) plus its offset and a little air. */
const DOOR_ROOM = 344;

/**
 * Beside the tile, so the chart stays in view while it changes: right when
 * there is room, otherwise left, and under the button when the tile spans
 * the page.
 */
function doorPlacement(tile: Element): DoorPlacement {
  const { left, right } = tile.getBoundingClientRect();
  if (window.innerWidth - right >= DOOR_ROOM) return BESIDE_RIGHT;
  if (left >= DOOR_ROOM) return { side: "left", align: "start" };
  return { side: "bottom", align: "end" };
}

const KIND_ORDER: readonly ItemControlKind[] = ["filter", "sort", "limit"];
const KIND_HEADING: Record<
  ItemControlKind,
  { name: string; Icon: typeof FilterIcon }
> = {
  filter: { name: "Filter", Icon: FilterIcon },
  sort: { name: "Sort", Icon: ArrowUpDownIcon },
  limit: { name: "Rows", Icon: ListIcon },
};

/**
 * The one door: everything the author exposed but did not pin. `isSet` tints
 * the button once the reader has turned something, so the state survives
 * when the popover closes.
 */
export function TileControlsDoor({
  controls,
  isSet = false,
  ...context
}: TileControlsProps & { isSet?: boolean }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [placement, setPlacement] = useState<DoorPlacement>(BESIDE_RIGHT);
  const behind = controls.filter((control) => !control.pinned);
  if (behind.length === 0) return null;
  const canChange =
    context.onChange !== undefined && behind.some((c) => c.changeable);

  return (
    <Popover
      onOpenChange={(open) => {
        const tile = trigger.current?.closest(TILE_SELECTOR);
        if (open && tile) setPlacement(doorPlacement(tile));
      }}
    >
      <PopoverTrigger
        ref={trigger}
        data-tile-door=""
        aria-label="Chart controls"
        className={cn(
          "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full p-1 text-neutral-fg-subtle transition-colors duration-150 hover:bg-neutral-bg-muted hover:text-neutral-fg focus-visible:ring-2 focus-visible:ring-neutral-ring focus-visible:outline-none data-[popup-open]:bg-neutral-bg-muted data-[popup-open]:text-neutral-fg motion-reduce:transition-none",
          isSet && "bg-palette-primary/10 text-palette-primary",
        )}
      >
        <ControlsIcon className="h-3.5 w-3.5" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent
        side={placement.side}
        align={placement.align}
        sideOffset={8}
        anchor={() => trigger.current?.closest(TILE_SELECTOR) ?? null}
        className="flex w-80 flex-col gap-2.5 p-3"
      >
        {KIND_ORDER.map((kind) => (
          <ControlGroup
            key={kind}
            kind={kind}
            controls={behind.filter((control) => control.kind === kind)}
            context={context}
          />
        ))}
        {canChange && (
          <p className="text-xs text-neutral-fg-subtle">
            Changes last for this visit only.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * One category inside the door. Filters sit under their heading, one row per
 * field. Sort and rows hold exactly one control each, so the heading is the
 * row: a second label under it would only repeat the word.
 */
function ControlGroup({
  kind,
  controls,
  context,
}: {
  kind: ItemControlKind;
  controls: readonly ExposedItemControl[];
  context: EditorContext;
}) {
  const [first] = controls;
  if (!first) return null;
  const { name, Icon } = KIND_HEADING[kind];
  const value = (control: ExposedItemControl) =>
    context.onChange && control.changeable ? (
      editorFor(control, context)
    ) : (
      <span className={chipClass}>
        <span className="truncate font-medium text-neutral-fg">
          {control.valueText}
        </span>
      </span>
    );
  const heading = (text: string) => (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-semibold text-neutral-fg">
      <Icon
        className="h-3.5 w-3.5 shrink-0 text-neutral-fg-subtle"
        aria-hidden="true"
      />
      <span className="truncate">{text}</span>
    </span>
  );

  if (kind !== "filter") {
    return (
      <div className="flex items-center justify-between gap-2">
        {heading(first.label || name)}
        {value(first)}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      {heading(name)}
      {controls.map((control) => (
        <div
          key={control.key}
          className="flex items-center justify-between gap-2"
        >
          <span className="truncate text-xs text-neutral-fg-subtle">
            {control.label}
          </span>
          <span className="max-w-[60%] min-w-0">{value(control)}</span>
        </div>
      ))}
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
  children: ReactNode;
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
        <SelectTrigger
          size="sm"
          aria-label="Sort by"
          className="min-w-0 text-xs"
        >
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
        <SelectTrigger
          size="sm"
          aria-label="Direction"
          className="w-28 shrink-0 text-xs"
        >
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

  return (
    <FilterEditor control={control} inputType={inputType} onChange={onChange} />
  );
}

function coerce(raw: string, inputType: ControlInputType): unknown {
  if (inputType !== "number") return raw;
  const n = Number(raw);
  return Number.isFinite(n) ? n : raw;
}

/**
 * A filter knob. It always emits the predicate it varies, by id, so a second
 * filter on the same field is left alone. Emptied, it widens the chart when
 * the Insight allows clearing and otherwise changes nothing: an empty string
 * or empty list is a predicate that matches no rows, never what a reader
 * clearing a box means.
 */
function FilterEditor({
  control,
  inputType,
  onChange,
}: {
  control: ExposedItemControl;
  inputType: ControlInputType;
  onChange: (patch: DashboardItemOverrides) => void;
}) {
  const filter = control.filter!;
  const emit = (value: unknown) =>
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
  const clear = () => {
    if (control.allowClear)
      onChange({ filters: [{ ...filter, cleared: true }] });
  };
  const current = control.override?.cleared
    ? ""
    : filterLiteral(control.override?.value ?? filter.value);

  if (filter.operator === "between") {
    return (
      <RangeEditor
        // Remount when the range changes from outside the boxes so the
        // drafts never disagree with the tile.
        key={JSON.stringify(current)}
        label={control.label || filter.field}
        range={current}
        inputType={inputType}
        onCommit={emit}
        onClear={clear}
      />
    );
  }

  return (
    <Input
      type={inputType}
      value={displayValue(current)}
      aria-label={control.label || control.valueText}
      className="h-7 w-full text-xs"
      onChange={(event: ChangeEvent<HTMLInputElement>) => {
        const raw = event.target.value;
        if (raw.trim() === "") return clear();
        if (filter.operator !== "in") return emit(coerce(raw, inputType));
        const values = raw
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean);
        return values.length > 0 ? emit(values) : clear();
      }}
    />
  );
}

/**
 * A `between` knob: a low and a high box. Committed on blur or Enter, and
 * only as a whole range, because half a range is not a value the engine
 * accepts.
 */
function RangeEditor({
  label,
  range,
  inputType,
  onCommit,
  onClear,
}: {
  label: string;
  range: unknown;
  inputType: ControlInputType;
  onCommit: (value: { low: unknown; high: unknown }) => void;
  onClear: () => void;
}) {
  const saved =
    range !== null && typeof range === "object"
      ? (range as { low?: unknown; high?: unknown })
      : {};
  const [low, setLow] = useState(displayValue(filterLiteral(saved.low)));
  const [high, setHigh] = useState(displayValue(filterLiteral(saved.high)));
  const commit = () => {
    if (low.trim() === "" && high.trim() === "") return onClear();
    if (low.trim() === "" || high.trim() === "") return;
    onCommit({ low: coerce(low, inputType), high: coerce(high, inputType) });
  };
  const box = (
    value: string,
    set: (next: string) => void,
    bound: "from" | "to",
  ) => (
    <Input
      type={inputType}
      value={value}
      aria-label={`${label} ${bound}`}
      className="h-7 w-full min-w-0 text-xs"
      onChange={(event: ChangeEvent<HTMLInputElement>) =>
        set(event.target.value)
      }
      onBlur={commit}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") commit();
      }}
    />
  );
  return (
    <div className="flex items-center gap-1.5">
      {box(low, setLow, "from")}
      <span className="text-xs text-neutral-fg-subtle">to</span>
      {box(high, setHigh, "to")}
    </div>
  );
}
