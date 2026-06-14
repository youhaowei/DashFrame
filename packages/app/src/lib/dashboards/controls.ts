/**
 * Dashboard controls — broadcast logic, source-schema eligibility, and
 * transient-overlay state.
 *
 * ## Architecture
 *
 * A `DashboardControl` is an INPUT to the per-cell override slot (the
 * compile-time coalesce engine).  When a control has a current value, it
 * writes the cell's `DashboardItemOverrides.filters` for its field via
 * `resolveEffectiveParams`.
 *
 * Binding is EXPLICIT OPT-IN.  A control reaches ONLY cells explicitly listed
 * in `control.boundInstances`.  Source-schema eligibility (`isControlEligible`)
 * limits which cells may be bound: a control on field F can only target cells
 * whose insight source table has F — even if F is dropped by GROUP BY.
 *
 * Viewer turns are VIEW-LOCAL by default.  `applyControlTransient` accepts a
 * transient value map that layers on top of the saved `defaultValue` without
 * mutating the saved dashboard.  The full viewer-transient UX (promote-to-saved,
 * sharing) is deferred to a later ticket.
 */

import type {
  DashboardControl,
  DashboardItem,
  DashboardItemOverrides,
  DataTable,
  InsightFilter,
  InsightFilterOverride,
} from "@dashframe/types";

// ---------------------------------------------------------------------------
// Source-schema eligibility
// ---------------------------------------------------------------------------

/**
 * Whether a control on `fieldName` may be bound to a cell whose visualization
 * is backed by `sourceTable`.
 *
 * Eligibility = the field name appears in the table's `fields` array
 * (user-defined fields, which always trace back to a source column).
 *
 * A control on field F is eligible even when F is dropped from the GROUP BY
 * result — the filter applies pre-aggregation (WHERE), so the column must
 * exist in the SOURCE table, not necessarily the result set.
 *
 * Returns `false` when `sourceTable` is undefined (e.g. insight not yet
 * loaded) so callers can guard safely.
 */
export function isControlEligible(
  fieldName: string,
  sourceTable: DataTable | undefined,
): boolean {
  if (!sourceTable) return false;
  return (sourceTable.fields ?? []).some(
    (f) => (f.columnName ?? f.name) === fieldName,
  );
}

// ---------------------------------------------------------------------------
// Override computation
// ---------------------------------------------------------------------------

/**
 * Compute the effective `DashboardItemOverrides` for a single cell by applying
 * all controls that target it.
 *
 * The cell's own saved `overrides` (from `item.overrides`) form the base; each
 * bound control's current value REPLACES the cell's filter for that field.
 * Binding = delegation: a bound field's control value WINS over the cell's
 * pinned value (per the per-cell override coalesce spec §6).
 *
 * A transient map (`transientValues`) layers view-local viewer turns on top of
 * the saved `defaultValue` without writing back to the dashboard.  If the
 * viewer has turned control `c.id`, the transient value is used instead.
 *
 * @param item            - The dashboard cell.
 * @param controls        - The dashboard's controls array.
 * @param transientValues - Optional map of controlId → current viewer-local value.
 * @returns               Merged `DashboardItemOverrides` to pass to `VisualizationDisplay`.
 */
export function computeItemOverrides(
  item: DashboardItem,
  controls: DashboardControl[],
  transientValues?: Map<string, InsightFilter["value"]>,
): DashboardItemOverrides | undefined {
  // Find controls that target this item.
  const boundControls = controls.filter((c) =>
    c.boundInstances.includes(item.id),
  );

  if (boundControls.length === 0) {
    // No controls target this item — return saved overrides as-is.
    return item.overrides;
  }

  // Drop any existing pinned filter for fields owned by a bound control: a
  // bound control OWNS its field (binding = delegation, §6), so the cell's own
  // pinned predicate is shadowed regardless of whether the control is active.
  const baseFilters: InsightFilterOverride[] = (item.overrides?.filters ?? [])
    .filter((f) => !boundControls.some((c) => c.field === f.field))
    .map((f) => ({ ...f }));

  // Apply each bound control to its field.
  const effectiveFilters: InsightFilterOverride[] = [...baseFilters];

  for (const control of boundControls) {
    // Use transient viewer value if present; else fall back to saved default.
    const value = transientValues?.has(control.id)
      ? transientValues.get(control.id)
      : control.defaultValue;

    const isBlank = value === undefined || value === null || value === "";
    if (isBlank) {
      // A bound-but-blank control is NOT the same as "no override": it must
      // WIDEN the cell to all values for its field, otherwise the insight's
      // own filter on that field would leak through (absence = inherit). Emit
      // an explicit `cleared` override so `resolveEffectiveParams` removes the
      // insight predicate for the field. `operator`/`value` are ignored when
      // `cleared` is set (engine contract) but the type still requires them.
      effectiveFilters.push({
        field: control.field,
        operator: "eq",
        value: null,
        cleared: true,
      });
      continue;
    }

    effectiveFilters.push({
      field: control.field,
      operator: "eq",
      value,
    });
  }

  // When nothing actionable was produced — no filters at all (concrete OR
  // cleared) and no saved sorts/limit — return the item's own overrides
  // (possibly `undefined`).  This keeps the `effectiveOverrides ?? item.overrides`
  // guard in DashboardItem from seeing a truthy-but-empty bag, which would
  // trigger a needless per-cell DuckDB view.  A `cleared` override DOES count
  // as actionable: it must reach `resolveEffectiveParams` to widen the field,
  // even when this layer can't see whether the INSIGHT (not the cell) has a
  // predicate on it — dropping it here would silently fail to widen.
  const hasSortsOrLimit =
    item.overrides?.sorts !== undefined || item.overrides?.limit !== undefined;

  if (effectiveFilters.length === 0 && !hasSortsOrLimit) {
    return item.overrides;
  }

  return {
    filters: effectiveFilters.length > 0 ? effectiveFilters : undefined,
    sorts: item.overrides?.sorts,
    limit: item.overrides?.limit,
  };
}

// ---------------------------------------------------------------------------
// Transient state helpers (viewer-local transient overlay)
// ---------------------------------------------------------------------------

/**
 * Return a new transient map with `controlId` set to `value`.  Never mutates
 * the input.  The caller (usually a React state setter) holds the map.
 *
 * A transient value SHADOWS the saved `defaultValue` for the duration of the
 * session; it is NEVER written back to the dashboard.  The promote-to-saved
 * UI (viewer → author) is the scope of a later ticket — this function is the
 * foundation that makes that possible without rework.
 */
export function setTransientValue(
  current: Map<string, InsightFilter["value"]>,
  controlId: string,
  value: InsightFilter["value"],
): Map<string, InsightFilter["value"]> {
  const next = new Map(current);
  next.set(controlId, value);
  return next;
}

/**
 * Resolve the displayed value for a control — viewer-local transient first,
 * saved default as fallback.
 */
export function resolveControlValue(
  control: DashboardControl,
  transientValues: Map<string, InsightFilter["value"]>,
): InsightFilter["value"] {
  return transientValues.has(control.id)
    ? transientValues.get(control.id)
    : control.defaultValue;
}
