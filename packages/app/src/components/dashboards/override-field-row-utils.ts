/**
 * Pure state-derivation and override-mutation helpers for the per-cell
 * OverrideFieldRow UI.
 *
 * All functions here are free of React/UI imports so they can be unit-tested
 * directly.  The state machine and payload shape are the load-bearing contracts
 * tested in override-field-row-utils.test.ts.
 */

import type {
  DashboardControl,
  DashboardItemOverrides,
  InsightFilter,
  InsightFilterOverride,
  InsightSort,
} from "@dashframe/types";

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
// Overrides mutation helpers
// ---------------------------------------------------------------------------
// Each function produces a NEW DashboardItemOverrides bag.  They spread the
// existing overrides so other fields' filters, sorts, and limit are preserved.

/**
 * Replace (or add) the filter override for `fieldName`.
 * Any previous entry for this field (pinned or cleared) is removed and `filter`
 * is appended.  Other fields' entries are untouched.
 */
export function computeNewOverridesOnPin(
  fieldName: string,
  filter: InsightFilterOverride,
  itemOverrides: DashboardItemOverrides | undefined,
): DashboardItemOverrides {
  const otherFilters = (itemOverrides?.filters ?? []).filter(
    (f) => f.field !== fieldName,
  );
  return {
    ...itemOverrides,
    filters: [...otherFilters, filter],
  };
}

/**
 * Set `cleared: true` for `fieldName` (widen — removes the insight's filter).
 * Replaces any existing pinned or cleared entry for this field.
 */
export function computeNewOverridesOnClear(
  fieldName: string,
  itemOverrides: DashboardItemOverrides | undefined,
): DashboardItemOverrides {
  const otherFilters = (itemOverrides?.filters ?? []).filter(
    (f) => f.field !== fieldName,
  );
  const clearedEntry: InsightFilterOverride = {
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

/**
 * Remove any override entry for `fieldName` (drop pinned or cleared, restore inherit).
 * When `filters` becomes empty as a result, sets `filters: undefined` so the bag
 * stays clean (avoids `{filters: []}` which is technically non-trivial).
 */
export function computeNewOverridesOnInherit(
  fieldName: string,
  itemOverrides: DashboardItemOverrides | undefined,
): DashboardItemOverrides {
  const remaining = (itemOverrides?.filters ?? []).filter(
    (f) => f.field !== fieldName,
  );
  return {
    ...itemOverrides,
    filters: remaining.length > 0 ? remaining : undefined,
  };
}

/**
 * Replace the sorts override.  Pass `undefined` to remove the cell's sort
 * override (revert to inherit = insight default).
 */
export function computeNewOverridesOnSortChange(
  sorts: InsightSort[] | undefined,
  itemOverrides: DashboardItemOverrides | undefined,
): DashboardItemOverrides {
  const next: DashboardItemOverrides = { ...itemOverrides };
  if (sorts === undefined) {
    delete next.sorts;
  } else {
    next.sorts = sorts;
  }
  return next;
}

/**
 * Replace the limit override.  Pass `undefined` to remove the cell's limit
 * override (revert to inherit = insight default).
 */
export function computeNewOverridesOnLimitChange(
  limit: number | undefined,
  itemOverrides: DashboardItemOverrides | undefined,
): DashboardItemOverrides {
  const next: DashboardItemOverrides = { ...itemOverrides };
  if (limit === undefined) {
    delete next.limit;
  } else {
    next.limit = limit;
  }
  return next;
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
