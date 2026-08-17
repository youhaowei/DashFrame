import type { DashboardItem } from "@dashframe/types";

/**
 * Validate raw `updates` against the recognized DashboardItem fields. This is
 * the canonical command
 * boundary that prevents `{ x: "left", width: null }` from entering layout
 * coordinates consumers assume are numeric. Shared with the preview-diff
 * renderer so the consent surface never claims a change publication would drop.
 */
export function sanitizeDashboardItemUpdates(
  updates: Record<string, unknown>,
): Partial<Omit<DashboardItem, "id" | "type" | "overrides">> {
  const next: Partial<Omit<DashboardItem, "id" | "type" | "overrides">> = {};
  if ("overrides" in updates) {
    throw new Error(
      "Dashboard item overrides require PatchDashboardItemOverride",
    );
  }
  const allowed = new Set([
    "visualizationId",
    "content",
    "x",
    "y",
    "width",
    "height",
    // Accepted for compatibility with untyped clients, but never applied: the
    // command target owns identity and item kind.
    "id",
    "type",
  ]);
  for (const key of Object.keys(updates)) {
    if (!allowed.has(key)) {
      throw new Error(`Unsupported dashboard item update field: ${key}`);
    }
  }
  for (const key of ["visualizationId", "content"] as const) {
    if (key in updates) {
      if (typeof updates[key] !== "string") {
        throw new Error(`Dashboard item update ${key} must be a string`);
      }
      next[key] = updates[key];
    }
  }
  for (const key of ["x", "y", "width", "height"] as const) {
    if (key in updates) {
      if (typeof updates[key] !== "number") {
        throw new Error(`Dashboard item update ${key} must be a number`);
      }
      next[key] = updates[key];
    }
  }
  return next;
}
