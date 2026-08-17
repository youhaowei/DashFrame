import type { DashboardItem } from "@dashframe/types";

type DashboardItemUpdates = Partial<
  Omit<DashboardItem, "id" | "type" | "overrides">
>;

function copyTypedUpdate(
  next: DashboardItemUpdates,
  updates: Record<string, unknown>,
  key: keyof DashboardItemUpdates,
  expected: "string" | "number",
): void {
  if (!(key in updates)) return;
  const value = updates[key];
  if (typeof value !== expected) {
    throw new Error(`Dashboard item update ${key} must be a ${expected}`);
  }
  Object.assign(next, { [key]: value });
}

/**
 * Validate raw `updates` against the recognized DashboardItem fields. This is
 * the canonical command
 * boundary that prevents `{ x: "left", width: null }` from entering layout
 * coordinates consumers assume are numeric. Shared with the preview-diff
 * renderer so the consent surface never claims a change publication would drop.
 */
export function sanitizeDashboardItemUpdates(
  updates: Record<string, unknown>,
): DashboardItemUpdates {
  const next: DashboardItemUpdates = {};
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
  copyTypedUpdate(next, updates, "visualizationId", "string");
  copyTypedUpdate(next, updates, "content", "string");
  copyTypedUpdate(next, updates, "x", "number");
  copyTypedUpdate(next, updates, "y", "number");
  copyTypedUpdate(next, updates, "width", "number");
  copyTypedUpdate(next, updates, "height", "number");
  return next;
}
