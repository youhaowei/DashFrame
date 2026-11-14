/**
 * Pure state-derivation and override-mutation helpers for the per-cell
 * OverrideFieldRow UI.
 *
 * All functions here are free of React/UI imports so they can be unit-tested
 * directly.  The state machine and payload shape are the load-bearing contracts
 * tested in override-field-row-utils.test.ts.
 */

import { fieldIdToColumnAlias, metricIdToColumnAlias } from "@dashframe/engine";
import type {
  DashboardControl,
  DashboardItemOverrides,
  Insight,
  InsightFilter,
  InsightFilterOverride,
  InsightRuntimeDeclaration,
  InsightSort,
} from "@dashframe/types";

import {
  type NamedField,
  filterOverrideRuns,
  resolveOverrideRuntimeFilter,
  type RuntimeFilterDeclaration,
  savedFilterIsOn,
} from "@/lib/insights/dashboard-runtime";

/** The declared runtime filter a row edits, with the saved filter it varies. */
export interface DeclaredFilterRow {
  declaration: RuntimeFilterDeclaration;
  /** The Insight's saved filter: the authority for field and operator. */
  filter: InsightFilter;
}

/**
 * What a filter row is declared as, or undefined when the Insight declares
 * nothing the row can edit.
 *
 * `held` is the override the tile already runs for the field: its pinned or
 * cleared entry, or the one a bound control writes (`computeItemOverrides`
 * gives either).  It is resolved exactly
 * as the tile runtime resolves it (`resolveOverrideRuntimeFilter`), so the row
 * and the tile agree on whether it runs.  That includes a field with two
 * declared filters, where the override's id or operator picks one, and a
 * held value the declared filter has changed under (`filterOverrideRuns`),
 * which the tile ignores and the row offers only to remove.
 *
 * With nothing held, the row stands for the field's one declared filter.  A
 * field with more than one gets no row to pin from: a tile stores one filter
 * override per field, and the row does not guess which predicate it means.
 *
 * A saved filter names its field by column name or by result-column alias
 * (`field_<id>`), and a row is keyed by column name, so `fields` lets a row
 * find a filter stored under the alias.
 */
export function resolveFilterRow(
  fieldName: string,
  held: InsightFilterOverride | undefined,
  insight: Pick<Insight, "filters" | "runtimeControls">,
  fields: readonly NamedField[] = [],
): DeclaredFilterRow | undefined {
  const onField = (insight.runtimeControls?.filters ?? []).flatMap(
    (declaration) => {
      const filter = (insight.filters ?? []).find(
        (saved) => saved.id === declaration.filterId,
      );
      return filter && savedFilterIsOn(filter.field, fieldName, fields)
        ? [{ declaration, filter }]
        : [];
    },
  );
  if (!held) return onField.length === 1 ? onField[0] : undefined;
  // An id may name a declared filter on another field; that is not this row's.
  const running = resolveOverrideRuntimeFilter(insight, fields, held);
  if (running && !filterOverrideRuns(insight, running, held)) return undefined;
  return onField.find((candidate) => candidate.declaration === running);
}

/**
 * Why a filter row offers only the removal of what the tile holds: the
 * Insight no longer declares the filter, or it changed the filter so that the
 * held value no longer fits it.
 */
export function ignoredFilterReason(
  held: InsightFilterOverride | undefined,
  insight: Pick<Insight, "filters" | "runtimeControls">,
  fields: readonly NamedField[] = [],
): string {
  return held && resolveOverrideRuntimeFilter(insight, fields, held)
    ? "The chart changed this filter, so the tile ignores the value saved here."
    : "The chart no longer offers this filter to viewers.";
}

/**
 * Whether a dashboard control can drive a row's declared filter.
 *
 * A bound control replaces the tile's own override for the field with one of
 * two, neither carrying a saved-filter id: an equality when it has a value,
 * and a clear when it is blank.  Both have to run through this declaration.
 * So the saved filter is an equality the declaration lets a viewer clear, and
 * no other declared filter on the field could take either override.
 */
export function controlCanDrive(
  fieldName: string,
  { declaration }: DeclaredFilterRow,
  insight: Pick<Insight, "filters" | "runtimeControls">,
  fields: readonly NamedField[] = [],
): boolean {
  if (declaration.allowClear !== true || declaration.required === true)
    return false;
  const sent = { field: fieldName, operator: "eq" as const, value: null };
  return [sent, { ...sent, cleared: true }].every(
    (override) =>
      resolveOverrideRuntimeFilter(insight, fields, override) === declaration,
  );
}

// ---------------------------------------------------------------------------
// What a tile is offered
// ---------------------------------------------------------------------------

/**
 * What the popover shows for one control of a tile.
 *
 * - `editable`: the Insight declares the control for viewers, and the tile
 *   runs what it holds of it, or holds nothing.
 * - `resetOnly`: the tile holds an override it does not run, because the
 *   Insight no longer declares the control or changed it so that the override
 *   no longer fits (`runs`).  The tile ignores it and runs the Insight's own
 *   setting, so the row stays, offering only the removal.
 * - `hidden`: the Insight does not declare it and the tile holds nothing.  An
 *   override saved here could not run, so the row is not shown.
 *
 * `runs` is the tile runtime's own answer for the held override
 * (`resolveTileSort`, `tileLimitRuns`), so the row and the tile agree.
 */
export type OverrideOffer = "editable" | "resetOnly" | "hidden";

export function overrideOffer(
  declared: boolean,
  held: boolean,
  runs = true,
): OverrideOffer {
  if (declared && (!held || runs)) return "editable";
  return held ? "resetOnly" : "hidden";
}

/**
 * A row limit moved inside the range the Insight offers viewers.  The host
 * refuses a limit outside it, so the limit row never saves one.
 */
export function clampLimit(
  limit: number,
  bounds: NonNullable<InsightRuntimeDeclaration["limit"]> | undefined,
): number {
  if (!bounds) return limit;
  return Math.min(Math.max(limit, bounds.min), bounds.max);
}

// ---------------------------------------------------------------------------
// Field override state machine
// ---------------------------------------------------------------------------

/**
 * The 4-state machine for a single overrideable field in a dashboard cell.
 *
 * - `inherit`: no entry for this field; the insight's own filter (if any) falls
 *   through unchanged.
 * - `pinned`: the cell has an explicit, non-cleared filter override for this field.
 * - `cleared`: `cleared: true` in the override — removes the insight's filter
 *   so the cell shows all values for this field (widen).
 * - `bound`: a dashboard control owns this field for this cell; the cell's own
 *   pinned filter is shadowed while bound and resumes automatically on unbind.
 *
 * IMPORTANT: `inherit` and `cleared` are DISTINCT signals — do not collapse
 * them into a single "off" state.  `absent` = inherit, `cleared: true` = widen.
 * See `InsightFilterOverride` comment in @dashframe/types.
 */
export type FieldOverrideState =
  | { type: "inherit"; insightFilter?: InsightFilter }
  | { type: "pinned"; filter: InsightFilterOverride }
  | { type: "cleared" }
  | {
      type: "bound";
      control: DashboardControl;
      dormantFilter?: InsightFilterOverride;
    };

/**
 * Derive the FieldOverrideState for `fieldName` in cell `itemId`.
 *
 * Precedence (per override spec §6):
 * 1. **Bound**: a control with `control.field === fieldName` lists `itemId` in
 *    `boundInstances` → state is `bound`. The cell's own pinned filter (if any)
 *    is exposed as `dormantFilter` (shadowed while bound, resumes on unbind).
 * 2. **Cleared**: `item.overrides.filters` has an entry for `fieldName` with
 *    `cleared: true` → state is `cleared`.
 * 3. **Pinned**: `item.overrides.filters` has an entry for `fieldName` without
 *    `cleared` → state is `pinned`.
 * 4. **Inherit**: no entry at all → state is `inherit`. `insightFilter` is the
 *    insight's own filter for this field (for greyed display in the UI).
 *
 * @param fieldName     - Source column name to look up.
 * @param itemId        - Cell id (checked in `boundInstances`).
 * @param itemOverrides - The cell's own saved `item.overrides` (NOT effectiveOverrides).
 * @param controls      - Dashboard-level controls array.
 * @param insightFilter - Insight's own filter for this field (used in inherit state
 *                        for display only — greyed label "insight default: ...").
 */
export function deriveFieldState(
  fieldName: string,
  itemId: string,
  itemOverrides: DashboardItemOverrides | undefined,
  controls: DashboardControl[],
  insightFilter?: InsightFilter,
): FieldOverrideState {
  // 1. Bound check — a control that targets this field AND this cell wins.
  const boundControl = controls.find(
    (c) => c.field === fieldName && c.boundInstances.includes(itemId),
  );
  if (boundControl) {
    // Expose the dormant pinned filter so the UI can show "will resume on unbind".
    const dormantFilter = itemOverrides?.filters?.find(
      (f) => f.field === fieldName && !f.cleared,
    );
    return { type: "bound", control: boundControl, dormantFilter };
  }

  // 2. Override entry for this field (cleared or pinned).
  const overrideEntry = itemOverrides?.filters?.find(
    (f) => f.field === fieldName,
  );
  if (overrideEntry) {
    if (overrideEntry.cleared) return { type: "cleared" };
    return { type: "pinned", filter: overrideEntry };
  }

  // 3. Inherit — no cell-level override for this field.
  return { type: "inherit", insightFilter };
}

// ---------------------------------------------------------------------------
// Overrides mutation helper
// ---------------------------------------------------------------------------
// Produces a NEW DashboardItemOverrides bag.  It spreads the existing
// overrides so other fields' filters, sorts, and limit are preserved.

/**
 * Set `cleared: true` for `fieldName` (widen — removes the insight's filter).
 * Replaces any existing pinned or cleared entry for this field.
 */
export function computeNewOverridesOnClear(
  fieldName: string,
  itemOverrides: DashboardItemOverrides | undefined,
  declaredFilterId?: string,
): DashboardItemOverrides {
  const otherFilters = (itemOverrides?.filters ?? []).filter(
    (f) => f.field !== fieldName,
  );
  const clearedEntry: InsightFilterOverride = {
    ...(declaredFilterId ? { id: declaredFilterId } : {}),
    field: fieldName,
    operator: "eq",
    value: null,
    cleared: true,
  };
  return {
    ...itemOverrides,
    filters: [...otherFilters, clearedEntry],
  };
}

// ---------------------------------------------------------------------------
// Badge helper
// ---------------------------------------------------------------------------

/**
 * True when `overrides` contains any non-trivial content — at least one filter,
 * a sort override, or a limit override.
 *
 * IMPORTANT: Pass `item.overrides` (NOT `effectiveOverrides`) so that a
 * control-driven-only cell (no saved overrides) does NOT light the badge.
 */
export function hasOverrides(
  overrides: DashboardItemOverrides | undefined,
): boolean {
  if (!overrides) return false;
  if ((overrides.filters?.length ?? 0) > 0) return true;
  if (overrides.sorts !== undefined) return true;
  if (overrides.limit !== undefined) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Sort row
// ---------------------------------------------------------------------------

/** One choice in the sort row's field select. */
export interface SortFieldOption {
  /** The reference a tile sort override stores for this choice. */
  value: string;
  /** The name a person reads. */
  label: string;
}

export interface SortFieldOptions {
  /** What the field select offers: fields, then metrics. */
  options: SortFieldOption[];
  /**
   * Every reference a sort key may store, mapped to the option it names.
   * Covers fields and metrics that are not offered too, so a key naming one
   * can still be shown by name.
   */
  byReference: ReadonlyMap<string, SortFieldOption>;
}

/**
 * The fields and metrics the sort row offers.
 *
 * A sort key names its field by id, by result-column alias (`field_<id>`,
 * `metric_<id>`), by column name, or by metric name, and for an insight built
 * on another insight the column name is itself an alias.  None of those is fit
 * to show, so each maps to an option labelled with the field's display name or
 * the metric's name.
 *
 * An option's value is the id.  It is the one reference the tile runtime
 * resolves without a lookup, and the only one that stays unique when joined
 * tables share a column name.
 *
 * `allowedIds` is the Insight's declared viewer sort, and `runs` says which of
 * those ids a tile can sort by (`tileSortRuns`).  When given, only fields and
 * metrics both allow are offered, because the tile ignores any other.  An
 * Insight that declares no viewer sort gets a disabled sort row, so the
 * unrestricted list is used only to name stored keys.
 *
 * A stored column name or metric name can name more than one option.  The tile
 * runtime takes the first allowed id, in declaration order, that it names, so
 * allowed ids claim those references first and a pinned key shows the field
 * the tile sorts by.
 */
export function buildSortFieldOptions(
  fields: readonly {
    id: string;
    name: string;
    columnName?: string;
    displayName?: string;
  }[],
  metrics: readonly { id: string; name: string; columnName?: string }[],
  allowedIds?: readonly string[],
  runs: (id: string) => boolean = () => true,
): SortFieldOptions {
  const entries = sortFieldEntries(fields, metrics);
  const options = entries
    .map(({ option }) => option)
    .filter(
      ({ value }) => (!allowedIds || allowedIds.includes(value)) && runs(value),
    );
  const rank = (id: string) => {
    const index = allowedIds?.indexOf(id) ?? -1;
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  };
  const byReference = new Map<string, SortFieldOption>();
  for (const { option } of entries) byReference.set(option.value, option);
  // Unallowed entries keep their field-then-metric order: the first (base
  // table, then fields) names a reference they share.
  for (const { option, references } of [...entries].sort(
    (a, b) => rank(a.option.value) - rank(b.option.value),
  ))
    for (const reference of references)
      if (!byReference.has(reference)) byReference.set(reference, option);
  return { options, byReference };
}

/** Each field, then each metric, once, with every reference that names it. */
function sortFieldEntries(
  fields: Parameters<typeof buildSortFieldOptions>[0],
  metrics: Parameters<typeof buildSortFieldOptions>[1],
): { option: SortFieldOption; references: string[] }[] {
  const entries = new Map<
    string,
    { option: SortFieldOption; references: string[] }
  >();
  for (const field of fields)
    if (!entries.has(field.id))
      entries.set(field.id, {
        option: { value: field.id, label: field.displayName ?? field.name },
        references: [
          fieldIdToColumnAlias(field.id),
          field.columnName ?? field.name,
        ],
      });
  for (const metric of metrics)
    if (!entries.has(metric.id))
      entries.set(metric.id, {
        option: { value: metric.id, label: metric.name },
        references: [
          metricIdToColumnAlias(metric.id),
          metric.name,
          ...(metric.columnName ? [metric.columnName] : []),
        ],
      });
  return [...entries.values()];
}

/**
 * The single key Pin saves: the Insight's first sort key, stored by the
 * reference its option in the field select uses, so the pinned row shows that
 * field and the tile runtime resolves it.  Later keys of the Insight's sort
 * are not carried over, because a tile sort takes one key.  Nor are
 * `pivotValues`: the host takes a metric's pivot cell from the Insight's own
 * saved sort, never from the override.
 *
 * Falls back to the first option when the Insight has no sort, or one that
 * names nothing the select offers.  Undefined when there is nothing to offer.
 */
export function sortKeyToPin(
  insightSorts: readonly InsightSort[] | undefined,
  { options, byReference }: SortFieldOptions,
): InsightSort | undefined {
  const inherited = insightSorts?.[0];
  const named = inherited && byReference.get(inherited.field);
  const option = named && options.includes(named) ? named : options[0];
  return option
    ? { field: option.value, direction: inherited?.direction ?? "asc" }
    : undefined;
}

/**
 * One-line summary of sort keys in priority order, e.g.
 * "region asc, Revenue · Web desc".  A pivot key names its cell, so two keys on
 * the same metric stay distinguishable.
 *
 * `byReference` names each stored reference (see `buildSortFieldOptions`); a
 * reference it does not know is shown as stored.
 */
export function formatSortKeys(
  sorts: readonly InsightSort[],
  byReference?: SortFieldOptions["byReference"],
): string {
  return sorts
    .map((sort) => {
      const label = [
        byReference?.get(sort.field)?.label ?? sort.field,
        ...(sort.pivotValues ?? []).map(({ value }) =>
          value === null ? "(empty)" : String(value),
        ),
      ].join(" · ");
      return `${label} ${sort.direction}`;
    })
    .join(", ");
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** Human-readable label for a filter operator. */
export function formatOperator(operator: InsightFilter["operator"]): string {
  switch (operator) {
    case "eq":
      return "=";
    case "ne":
      return "≠";
    case "gt":
      return ">";
    case "gte":
      return "≥";
    case "lt":
      return "<";
    case "lte":
      return "≤";
    case "contains":
      return "contains";
    case "in":
      return "in";
    case "between":
      return "between";
  }
}

/** Human-readable summary of a filter value (single-line, for display in rows). */
export function formatFilterValue(filter: InsightFilter): string {
  const v = filter.value;
  if (filter.operator === "between" && v != null && typeof v === "object") {
    const bv = v as { low: unknown; high: unknown };
    return `${bv.low} … ${bv.high}`;
  }
  if (filter.operator === "in" && Array.isArray(v)) {
    return v.slice(0, 3).join(", ") + (v.length > 3 ? ` +${v.length - 3}` : "");
  }
  return String(v ?? "");
}
