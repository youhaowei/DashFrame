/**
 * Compile-time coalesce for dashboard per-cell overrides.
 *
 * Resolves effective query params per cell = `insight default ⊕ cellOverride`.
 * The result feeds directly into `buildInsightSQL`'s WHERE/HAVING clause path.
 *
 * ## Design constraints
 *
 * - **Read-only invariant**: the input `insight` is NEVER mutated.  The coalesce
 *   always produces a FRESH effective-params object (deep clone + merge).
 * - **Two-layer coalesce**: `insight ⊕ effectiveCellOverride`.  How the cell
 *   override is populated (direct pin vs a future dashboard-control binding) is
 *   upstream; this function takes the effective value and merges it.
 * - **Per-field filter merge** (the subtle part):
 *     - Override on field F → REPLACES insight's filter(s) on F.
 *     - Override on field not in insight → ADDS to effective filters.
 *     - Absent override for field F → insight default for F falls through.
 *     - Explicit clear (override entry with `cleared: true`) → REMOVES the
 *       insight's filter(s) on F so the cell widens (shows all values for F).
 * - **Sort/limit**: scalar replace — cell override replaces insight value when
 *   present; absent override falls through to insight default.
 *
 * ## Clear semantics (v0.3)
 *
 * A cleared override is a DISTINCT signal from absence.  Absence → inherit.
 * `cleared: true` → widen (remove insight's predicate on that field).
 * v0.3: clear widens freely — NO permission gate (single-user data).
 * Multi-tenant widening-permission logic is deferred to v0.4+.
 */

import type {
  DashboardItemOverrides,
  InsightFilter,
  InsightFilterOverride,
  InsightSort,
} from "@dashframe/types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The resolved effective params for a single cell, produced at compile time
 * by `resolveEffectiveParams`.  These feed directly into `buildInsightSQL`.
 *
 * Intentionally a minimal subset of `Insight` fields — only the params that
 * can be overridden.  The caller merges these back onto the insight when calling
 * `buildInsightSQL`.
 */
export interface EffectiveParams {
  filters: InsightFilter[];
  sorts: InsightSort[];
  limit: number | undefined;
}

// ---------------------------------------------------------------------------
// Core resolution
// ---------------------------------------------------------------------------

/** Deep-clone an array of filters (shallow-object clone per element). */
function cloneFilters(filters: InsightFilter[]): InsightFilter[] {
  return filters.map((f) => ({ ...f }));
}

/** Deep-clone an array of sorts (shallow-object clone per element). */
function cloneSorts(sorts: InsightSort[]): InsightSort[] {
  return sorts.map((s) => ({ ...s }));
}

/**
 * Resolve the effective sorts: cell override replaces insight sorts when
 * present; otherwise fall through to insight defaults.
 */
function resolveSorts(
  insightSorts: InsightSort[] | undefined,
  overrideSorts: InsightSort[] | undefined,
): InsightSort[] {
  if (overrideSorts !== undefined) return cloneSorts(overrideSorts);
  if (insightSorts) return cloneSorts(insightSorts);
  return [];
}

/**
 * Coalesce insight defaults with cell-level overrides to produce the effective
 * params for a single dashboard cell.
 *
 * **NEVER mutates `insightFilters`, `insightSorts`, or `overrides`.**
 *
 * @param insightFilters - The insight's own filter array (may be undefined).
 * @param insightSorts   - The insight's own sort array (may be undefined).
 * @param insightLimit   - The insight's own row limit (may be undefined).
 * @param overrides      - The cell's override bag (may be undefined = no overrides).
 * @returns A fresh `EffectiveParams` object ready to feed into SQL generation.
 */
export function resolveEffectiveParams(
  insightFilters: InsightFilter[] | undefined,
  insightSorts: InsightSort[] | undefined,
  insightLimit: number | undefined,
  overrides: DashboardItemOverrides | undefined,
): EffectiveParams {
  // Fast path: no overrides → deep-clone the insight defaults (read-only
  // invariant: the caller must not be able to mutate insight data by writing
  // into the returned object's elements).
  if (!overrides) {
    return {
      filters: insightFilters ? cloneFilters(insightFilters) : [],
      sorts: insightSorts ? cloneSorts(insightSorts) : [],
      limit: insightLimit,
    };
  }

  return {
    filters: mergeFilters(insightFilters, overrides.filters),
    sorts: resolveSorts(insightSorts, overrides.sorts),
    limit: overrides.limit !== undefined ? overrides.limit : insightLimit,
  };
}

// ---------------------------------------------------------------------------
// Per-field filter merge — helpers extracted to stay within complexity budget
// ---------------------------------------------------------------------------

/** Group an array of filter overrides by their `field` name. */
function groupByField(
  filters: InsightFilterOverride[],
): Map<string, InsightFilterOverride[]> {
  const map = new Map<string, InsightFilterOverride[]>();
  for (const f of filters) {
    const existing = map.get(f.field);
    if (existing) {
      existing.push(f);
    } else {
      map.set(f.field, [f]);
    }
  }
  return map;
}

/**
 * Return a plain `InsightFilter` from an `InsightFilterOverride`, stripping
 * the `cleared` extension flag.  The returned object is a shallow clone, so
 * the original override entry is never mutated.
 */
function stripClearedFlag(ov: InsightFilterOverride): InsightFilter {
  const base: InsightFilter = {
    field: ov.field,
    operator: ov.operator,
    value: ov.value,
  };
  if (ov.id !== undefined) base.id = ov.id;
  return base;
}

/**
 * Apply override entries for a single field onto the effective-filters array.
 *
 * - cleared entry → drop insight filters for this field (widen).
 * - non-cleared entries → replace insight filters for this field.
 *
 * Returns the override entries if they replace (so the caller skips inherited
 * insight entries), or `null` if the field is cleared (same outcome — no entries
 * added for that field).
 */
function applyFieldOverride(
  fieldOverrides: InsightFilterOverride[],
  effectiveFilters: InsightFilter[],
): void {
  const hasClear = fieldOverrides.some((ov) => ov.cleared);
  if (hasClear) {
    // Explicit clear → widen: drop insight filters for this field entirely.
    return;
  }
  // Replace: add override filters for this field.
  for (const ov of fieldOverrides) {
    effectiveFilters.push(stripClearedFlag(ov));
  }
}

/**
 * Collect all insight filters for a single field into the effective array
 * (inherit path).
 */
function inheritInsightFilters(
  field: string,
  insightFilters: InsightFilter[],
  effectiveFilters: InsightFilter[],
): void {
  for (const f of insightFilters) {
    if (f.field === field) effectiveFilters.push({ ...f });
  }
}

/**
 * Apply additive-only override entries — fields in `overridesByField` that were
 * not present in the insight at all.  These are pure additions (not replacements).
 * Cleared entries for additive fields are dropped (nothing to widen against).
 */
function appendAdditiveOverrides(
  overridesByField: Map<string, InsightFilterOverride[]>,
  handledFields: Set<string>,
  effectiveFilters: InsightFilter[],
): void {
  for (const [field, fieldOverrides] of overridesByField) {
    if (handledFields.has(field)) continue;
    for (const ov of fieldOverrides) {
      if (!ov.cleared) effectiveFilters.push(stripClearedFlag(ov));
    }
  }
}

/**
 * Merge insight filters with cell override filters using per-field,
 * most-specific-wins semantics.
 *
 * Rules (applied per field name):
 * 1. Override on field F with `cleared: true` → REMOVE insight's filter(s) on F.
 * 2. Override on field F (not cleared) → REPLACE insight's filter(s) on F.
 * 3. Field F present in insight but NOT in override → carry through (inherit).
 * 4. Field G present in override but NOT in insight → ADD to effective filters.
 *
 * The function never mutates its inputs; always returns a new array.
 */
function mergeFilters(
  insightFilters: InsightFilter[] | undefined,
  overrideFilters: InsightFilterOverride[] | undefined,
): InsightFilter[] {
  // Neither side: empty result.
  if (!insightFilters?.length && !overrideFilters?.length) return [];

  // No overrides: copy insight filters as-is.
  if (!overrideFilters?.length) {
    return insightFilters ? cloneFilters(insightFilters) : [];
  }

  // No insight filters: keep only non-cleared override entries.
  if (!insightFilters?.length) {
    return overrideFilters.filter((ov) => !ov.cleared).map(stripClearedFlag);
  }

  // General case: both sides present.
  const overridesByField = groupByField(overrideFilters);
  const effectiveFilters: InsightFilter[] = [];
  const handledFields = new Set<string>();

  // Process insight filters field-by-field, applying overrides where present.
  for (const insightFilter of insightFilters) {
    const field = insightFilter.field;
    if (handledFields.has(field)) continue; // already handled this field group

    const fieldOverrides = overridesByField.get(field);
    if (fieldOverrides) {
      applyFieldOverride(fieldOverrides, effectiveFilters);
    } else {
      inheritInsightFilters(field, insightFilters, effectiveFilters);
    }
    handledFields.add(field);
  }

  // Add override entries for fields not present in the insight (additive).
  appendAdditiveOverrides(overridesByField, handledFields, effectiveFilters);

  return effectiveFilters;
}
