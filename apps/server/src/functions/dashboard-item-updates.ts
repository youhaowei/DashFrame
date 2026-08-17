import type { DashboardItem } from "@dashframe/types";

/**
 * Filter raw `updates` to the recognized DashboardItem fields with the correct
 * primitive types, dropping anything malformed. This is the canonical command
 * boundary that prevents `{ x: "left", width: null }` from entering layout
 * coordinates consumers assume are numeric. Shared with the preview-diff
 * renderer so the consent surface never claims a change publication would drop.
 */
export function sanitizeDashboardItemUpdates(
  updates: Record<string, unknown>,
): Partial<Omit<DashboardItem, "id" | "type" | "overrides">> {
  const next: Partial<Omit<DashboardItem, "id" | "type" | "overrides">> = {};
  if (typeof updates.visualizationId === "string") {
    next.visualizationId = updates.visualizationId;
  }
  if (typeof updates.content === "string") next.content = updates.content;
  if (typeof updates.x === "number") next.x = updates.x;
  if (typeof updates.y === "number") next.y = updates.y;
  if (typeof updates.width === "number") next.width = updates.width;
  if (typeof updates.height === "number") next.height = updates.height;
  if ("overrides" in updates) {
    throw new Error(
      "Dashboard item overrides require PatchDashboardItemOverride",
    );
  }
  return next;
}
