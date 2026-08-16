import type { DashboardItem, DashboardItemOverrides } from "@dashframe/types";

/**
 * Filter raw `updates` to the recognized DashboardItem fields with the correct
 * primitive types, dropping anything malformed. This is the canonical command
 * boundary that prevents `{ x: "left", width: null }` from entering layout
 * coordinates consumers assume are numeric. Shared with the preview-diff
 * renderer so the consent surface never claims a change publication would drop.
 */
export function sanitizeDashboardItemUpdates(
  updates: Record<string, unknown>,
): Partial<Omit<DashboardItem, "id" | "type">> {
  const next: Partial<Omit<DashboardItem, "id" | "type">> = {};
  if (typeof updates.visualizationId === "string") {
    next.visualizationId = updates.visualizationId;
  }
  if (typeof updates.content === "string") next.content = updates.content;
  if (typeof updates.x === "number") next.x = updates.x;
  if (typeof updates.y === "number") next.y = updates.y;
  if (typeof updates.width === "number") next.width = updates.width;
  if (typeof updates.height === "number") next.height = updates.height;
  // Callers use `overrides` to update or clear a panel's filter/sort/limit bag.
  // The merged item is validated by the shared dashboard-state schema before
  // the command writes it; this helper only preserves the requested patch.
  // An explicit `undefined` means "not updating overrides" (the key was absent
  // in the updates object); `null` is not in the type so omit check mirrors
  // the other field guards.
  if ("overrides" in updates) {
    next.overrides = updates.overrides as DashboardItemOverrides | undefined;
  }
  return next;
}
