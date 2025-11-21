# Visualization Workbench v2 (Post-Creation)

## Purpose
Refine the visualization-side workbench after a visualization exists. Keep top bar and main preview largely unchanged; invest in the left panel to surface insight provenance, safer mappings, and refresh affordances without introducing a right rail.

## Principles
- Insight-first: Always show which insight + table powers the viz.
- Minimal mode switching: Stay in viz controls; link out to insight editor when deeper edits are needed.
- Safety + clarity: Warn when mappings are weak (ids on Y, high-cardinality colors) and block chart types when data can’t support them.
- Fast refresh: Prominent refresh for non-local sources with clear freshness state.

## Layout (Left Panel)
Order top-to-bottom:
1) **Insight Summary (always visible)**
   - Insight name (link to edit page), source/table badge, DataFrame stats (rows/cols), last refreshed timestamp (or “not yet”).
   - Refresh button if source is refreshable (Notion, remote); disabled for local CSV. Inline status text for stale/failed.
2) **Encodings**
   - X / Y / Color / Size pickers, grouped by role.
   - Axis-type toggle only when meaningful; swap X/Y button stays.
   - Warnings inline using column analysis (identifier on Y, high cardinality on color, same column on both axes).
   - Chart type selector demoted to a small control (e.g., “Chart options” collapsible) since switching is rare.
3) **Metrics Strip**
   - List available metrics from the insight (agg + field). If none, CTA: “Add metrics in Insight editor”.
   - Optional per-viz aggregation override (if trivial to support); otherwise read-only display.
4) **Preview Filters (optional, collapsed)**
   - Quick toggles: exclude nulls; top N by metric (preview-only hint, doesn’t persist to insight).
5) **Actions Footer**
   - Refresh (if applicable), Duplicate, Delete (confirm).

## Behavior
- **Chart type**: Default from creation; switching recalculates encodings with heuristics (Y prefers metrics; X prefers temporal/categorical fields). If no numeric columns, lock to table and explain why.
- **Refresh**: Calls insight→DataFrame refresh; updates freshness in Insight Summary and shows toast on success/fail.
- **Provenance**: Always render the summary; if DataFrame missing/stale, show alert + “Recreate/refresh”.
- **Encodings**: Accept field- or metric-backed mappings; warnings surface immediately. Swap updates both field and inferred types.

## Edge States
- Missing DataFrame: Error card in summary with “Refresh insight” + “Select another visualization”.
- No metrics: Metrics strip shows CTA only; Y picker still allows fields but warns.
- No numeric columns: Charts disabled, table-only card explains why.

## Implementation Notes
- File to touch: `apps/web/components/visualizations/VisualizationControls.tsx` (left panel).
- Add small provenance block (link to `insights/[id]/create-visualization`).
- Demote chart type control into a lighter section/collapsible.
- Integrate metrics strip; reuse column analysis for warnings.
- Preserve main preview/top bar; only add small mapping chips in chart header if desired (non-interactive).
