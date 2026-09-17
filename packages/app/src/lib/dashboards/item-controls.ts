/**
 * What a reader is shown of one report item's runtime controls.
 *
 * An Insight declares its runtime controls (`Insight.runtimeControls`); the
 * report item decides, per control, whether the reader is told about it and
 * whether the reader may change it (`DashboardItem.controls`). This module
 * turns the two into the ordered list of controls a tile draws. It is pure so
 * the disclosure rules can be tested without React.
 *
 * Rules:
 * - No item entry for a key means hidden: the reader is not told it exists.
 * - A key whose field is bound by a report-level `DashboardControl` for this
 *   item is not drawn on the tile; its knob lives on the report bar.
 * - `changeable` is the Insight's ceiling AND the item's tightening; the item
 *   can only ever remove the knob.
 * - Filters come first in declaration order, then sort, then limit: the
 *   order the chart is built in (which rows, how ordered, how many kept).
 * - Only a filter can be pinned to the tile face. A sort or limit has no
 *   value to put in a pill, so it is only ever behind the tile's control
 *   button, whatever the stored visibility says.
 */

import type {
  DashboardControl,
  DashboardItem,
  DashboardItemControl,
  DashboardItemOverrides,
  Insight,
  InsightFilter,
  InsightFilterOverride,
  InsightRuntimeDeclaration,
  InsightSort,
} from "@dashframe/types";
import { formatFilterValue } from "@/components/dashboards/override-field-row-utils";

export type ItemControlKind = "filter" | "sort" | "limit";

export const SORT_CONTROL_KEY = "sort";
export const LIMIT_CONTROL_KEY = "limit";

export interface ExposedItemControl {
  key: string;
  kind: ItemControlKind;
  /** The author's words. Empty when the author wrote none. */
  label: string;
  /** What the reader sees as the current value. */
  valueText: string;
  /** On the tile face (true) or behind the tile's control button (false). */
  pinned: boolean;
  /** Whether the reader gets a knob. */
  changeable: boolean;
  /** Filters only: the saved predicate this control varies. */
  filter?: InsightFilter;
  /** Filters only: the effective override for this predicate, if any. */
  override?: InsightFilterOverride;
  /** Sort only: the current effective sort, if any. */
  sort?: InsightSort;
  /** Limit only: the current effective limit, if any. */
  limit?: number;
}

export interface ResolveItemControlsInput {
  insight: Pick<Insight, "filters" | "sorts" | "runtimeControls">;
  item: Pick<DashboardItem, "id" | "controls">;
  dashboardControls: readonly DashboardControl[];
  /** The overrides the tile actually renders with (saved ⊕ report ⊕ reader). */
  effectiveOverrides: DashboardItemOverrides | undefined;
  /** Reader-facing name for a sort field, given the override/insight field name. */
  sortFieldLabel?: (field: string) => string;
}

function describeSort(sort: InsightSort, fieldLabel: (f: string) => string) {
  return `${fieldLabel(sort.field)}, ${sort.direction === "desc" ? "high to low" : "low to high"}`;
}

/**
 * The literal behind an operand. Agent-authored filters carry an explicitly
 * tagged `{ kind: "value", v }`; UI-authored ones carry the bare literal.
 * Readers see the literal either way.
 */
export function filterLiteral(value: unknown): unknown {
  if (
    value !== null &&
    typeof value === "object" &&
    "kind" in value &&
    (value as { kind?: unknown }).kind === "value" &&
    "v" in value
  )
    return (value as { v: unknown }).v;
  return value;
}

function describeFilter(
  saved: InsightFilter,
  override: InsightFilterOverride | undefined,
): string {
  if (override?.cleared) return "All";
  const filter = override ?? saved;
  return formatFilterValue({ ...filter, value: filterLiteral(filter.value) });
}

type Exposure = { pinned: boolean; changeable: boolean };

/** How the item discloses `key`, or null when the reader is not told. */
function exposureFor(
  disclosure: NonNullable<DashboardItem["controls"]>,
  key: string,
  ceiling: boolean | undefined,
): Exposure | null {
  const entry = disclosure[key];
  if (!entry || entry.visibility === "hidden") return null;
  return {
    pinned:
      entry.visibility === "pinned" &&
      key !== SORT_CONTROL_KEY &&
      key !== LIMIT_CONTROL_KEY,
    changeable: ceiling !== false && entry.changeable !== false,
  };
}

function sortControl(
  {
    insight,
    item,
    effectiveOverrides,
    sortFieldLabel,
  }: Required<Omit<ResolveItemControlsInput, "dashboardControls">>,
  declaration: NonNullable<InsightRuntimeDeclaration["sort"]>,
): ExposedItemControl | null {
  const shown = exposureFor(
    item.controls ?? {},
    SORT_CONTROL_KEY,
    declaration.changeable,
  );
  if (!shown) return null;
  const sort = effectiveOverrides?.sorts?.[0] ?? insight.sorts?.[0];
  return {
    key: SORT_CONTROL_KEY,
    kind: "sort",
    label: declaration.label ?? "",
    valueText: sort ? describeSort(sort, sortFieldLabel) : "Unsorted",
    sort,
    ...shown,
  };
}

function limitControl(
  {
    item,
    effectiveOverrides,
  }: Pick<ResolveItemControlsInput, "item" | "effectiveOverrides">,
  declaration: NonNullable<InsightRuntimeDeclaration["limit"]>,
): ExposedItemControl | null {
  const shown = exposureFor(
    item.controls ?? {},
    LIMIT_CONTROL_KEY,
    declaration.changeable,
  );
  if (!shown) return null;
  const limit = effectiveOverrides?.limit;
  return {
    key: LIMIT_CONTROL_KEY,
    kind: "limit",
    label: declaration.label ?? "",
    valueText: limit === undefined ? "All rows" : `Top ${limit}`,
    limit,
    ...shown,
  };
}

function filterControls(
  {
    insight,
    item,
    dashboardControls,
    effectiveOverrides,
  }: ResolveItemControlsInput,
  declarations: NonNullable<InsightRuntimeDeclaration["filters"]>,
): ExposedItemControl[] {
  const boundFields = new Set(
    dashboardControls
      .filter((control) => control.boundInstances.includes(item.id))
      .map((control) => control.field),
  );
  const out: ExposedItemControl[] = [];
  for (const control of declarations) {
    const saved = insight.filters?.find((f) => f.id === control.filterId);
    if (!saved || boundFields.has(saved.field)) continue;
    const shown = exposureFor(
      item.controls ?? {},
      control.key,
      control.changeable,
    );
    if (!shown) continue;
    const override = overrideFor(effectiveOverrides?.filters, saved);
    out.push({
      key: control.key,
      kind: "filter",
      label: control.label,
      valueText: describeFilter(saved, override),
      filter: saved,
      override,
      ...shown,
    });
  }
  return out;
}

/**
 * The override that varies `saved`. An override carrying an id belongs to
 * that predicate alone, so two declared filters on one field stay apart; only
 * an id-less override (a report control, a saved cell pin) speaks for the
 * whole field.
 */
function overrideFor(
  overrides: readonly InsightFilterOverride[] | undefined,
  saved: InsightFilter,
): InsightFilterOverride | undefined {
  return (
    overrides?.find((f) => f.id !== undefined && f.id === saved.id) ??
    overrides?.find((f) => f.id === undefined && f.field === saved.field)
  );
}

/**
 * A reader's filter patch, completed to its whole field. The engine replaces
 * every saved predicate on a field once any override names that field, so a
 * patch for one of two filters on `quantity` must carry the other as it
 * currently stands, or turning one knob would silently drop its sibling.
 */
export function completeFieldGroups(
  patch: DashboardItemOverrides,
  insightFilters: readonly InsightFilter[] | undefined,
  effectiveOverrides: DashboardItemOverrides | undefined,
): DashboardItemOverrides {
  if (!patch.filters?.length) return patch;
  const patchedIds = new Set(patch.filters.map((f) => f.id));
  const fields = new Set(patch.filters.map((f) => f.field));
  const siblings = (insightFilters ?? [])
    .filter((saved) => fields.has(saved.field) && !patchedIds.has(saved.id))
    .map((saved) => overrideFor(effectiveOverrides?.filters, saved) ?? saved);
  return siblings.length === 0
    ? patch
    : { ...patch, filters: [...siblings, ...patch.filters] };
}

/**
 * The ordered list of controls the tile draws for this item. Hidden controls
 * and report-bound controls are absent from the result, not flagged.
 */
export function resolveItemControls(
  input: ResolveItemControlsInput,
): ExposedItemControl[] {
  const declaration: InsightRuntimeDeclaration =
    input.insight.runtimeControls ?? {};
  const full = {
    ...input,
    sortFieldLabel: input.sortFieldLabel ?? ((f: string) => f),
  };
  const out = filterControls(full, declaration.filters ?? []);
  if (declaration.sort) {
    const sort = sortControl(full, declaration.sort);
    if (sort) out.push(sort);
  }
  if (declaration.limit) {
    const limit = limitControl(full, declaration.limit);
    if (limit) out.push(limit);
  }
  return out;
}

/**
 * The author's next disclosure map after one edit. A `hidden` entry with no
 * tightening is the default and is stored as absence, so the map only ever
 * names what differs from "the reader is not told".
 */
export function withItemControl(
  controls: DashboardItem["controls"],
  key: string,
  patch: Partial<DashboardItemControl>,
): Record<string, DashboardItemControl> {
  const next: Record<string, DashboardItemControl> = { ...controls };
  const merged: DashboardItemControl = {
    visibility: patch.visibility ?? next[key]?.visibility ?? "hidden",
  };
  const changeable =
    "changeable" in patch ? patch.changeable : next[key]?.changeable;
  if (changeable === false) merged.changeable = false;
  if (merged.visibility === "hidden" && merged.changeable === undefined) {
    delete next[key];
  } else {
    next[key] = merged;
  }
  return next;
}

/** Whether the reader has anything at all to see for this item. */
export function hasExposedControls(controls: readonly ExposedItemControl[]) {
  return controls.length > 0;
}
