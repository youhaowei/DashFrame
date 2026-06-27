/**
 * Dashboard WyStack functions — list/get queries + CRUD and item mutations.
 *
 * Persistence vs domain: the v0.2 `dashboards` row is richer than the app's
 * domain `Dashboard` (it carries `createdBy` provenance + `parentArtifactId`
 * lineage the UI never sees). Handlers map row→domain on read and synthesize
 * the extra columns on write — the same pattern `projectInfo` uses. The domain
 * `items: DashboardItem[]` is persisted in the `layout` jsonb column; the
 * domain epoch-ms `createdAt`/`updatedAt` map to/from the row's `Date` columns.
 *
 * Item-level mutations (addItem/updateItem/removeItem) are server-side
 * read-modify-write on the `layout` jsonb — mirroring the Dexie repository so
 * the hook surface is byte-for-byte identical.
 *
 * Every handler reads/writes through `ctx.db` (WyStack's DrizzleTracker) so the
 * subscription manager records the `dashboards` table in each query's
 * read-set and each mutation's write-set — that table-overlap is what drives
 * WS invalidation back to live `useDashboards` subscribers.
 */
import { schema } from "@dashframe/server-core";
import { eq, jsonb, text, uuid } from "@wystack/db";
import { mutation, query } from "@wystack/server";

import { tsToMillis } from "./app-artifacts";

const { dashboards } = schema;

type DashboardRow = typeof dashboards.$inferSelect;

/** Grid item — mirrors the domain `DashboardItem` (persisted inside `layout`). */
interface DashboardItem {
  id: string;
  type: "visualization" | "markdown";
  visualizationId?: string;
  content?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Per-cell override bag (filters/sorts/limit) */
  overrides?: {
    filters?: unknown[];
    sorts?: unknown[];
    limit?: number;
  };
}

/** Dashboard-level control — mirrors the domain `DashboardControl`. */
interface DashboardControl {
  id: string;
  field: string;
  label?: string;
  defaultValue?: unknown;
  boundInstances: string[];
}

/** Domain `Dashboard` shape returned to the client (matches @dashframe/types). */
export interface DashboardResult {
  id: string;
  name: string;
  description?: string;
  items: DashboardItem[];
  controls?: DashboardControl[];
  createdAt: number;
  updatedAt?: number;
}

/** Row → domain. Single source of the mapping (read paths share it). */
function rowToDashboard(row: DashboardRow): DashboardResult {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    items: (row.layout as DashboardItem[]) ?? [],
    controls: (row.controls as DashboardControl[] | null) ?? undefined,
    // Null-safe via the shared `tsToMillis` (app-artifacts.ts): the draft overlay
    // returns NULL created_at for a dashboard created inside a draft (the sparse
    // `<table>__draft` row has no canonical base; publish stamps the real value),
    // so coalesce null → 0 rather than crash on `.getTime()`.
    createdAt: tsToMillis(row.createdAt),
    updatedAt: row.updatedAt?.getTime(),
  };
}

function parseDashboardType(value: string): DashboardItem["type"] {
  if (value === "visualization" || value === "markdown") return value;
  throw new Error(`Unsupported dashboard item type ${value}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePosition(
  value: unknown,
): Pick<DashboardItem, "x" | "y" | "width" | "height"> {
  if (!isRecord(value)) {
    throw new Error("Dashboard item position must be an object");
  }
  const input = value;
  const keys = ["x", "y", "width", "height"] as const;
  for (const key of keys) {
    if (typeof input[key] !== "number") {
      throw new Error(`Dashboard item position.${key} must be a number`);
    }
  }
  const { x, y, width, height } = input;
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof width !== "number" ||
    typeof height !== "number"
  ) {
    throw new Error("Dashboard item position must include numeric bounds");
  }
  return {
    x,
    y,
    width,
    height,
  };
}

function sanitizeDashboardUpdates(
  updates: unknown,
): Partial<Omit<DashboardItem, "id" | "type">> {
  if (!isRecord(updates)) {
    throw new Error("Dashboard item updates must be an object");
  }
  const input = updates;
  const next: Partial<Omit<DashboardItem, "id" | "type">> = {};
  if (typeof input.visualizationId === "string") {
    next.visualizationId = input.visualizationId;
  }
  if (typeof input.content === "string") next.content = input.content;
  if (typeof input.x === "number") next.x = input.x;
  if (typeof input.y === "number") next.y = input.y;
  if (typeof input.width === "number") next.width = input.width;
  if (typeof input.height === "number") next.height = input.height;
  return next;
}

const listDashboards = query({
  args: {},
  handler: async (ctx): Promise<DashboardResult[]> => {
    const rows = (await ctx.db.from(dashboards).all()) as DashboardRow[];
    return rows.map(rowToDashboard);
  },
});

const getDashboard = query({
  args: { id: uuid },
  handler: async (ctx, { id }): Promise<DashboardResult | null> => {
    const row = (await ctx.db.from(dashboards).where(eq("id", id)).first()) as
      | DashboardRow
      | undefined;
    return row ? rowToDashboard(row) : null;
  },
});

const createDashboard = mutation({
  args: { name: text, description: text.optional() },
  handler: async (ctx, { name, description }): Promise<{ id: string }> => {
    const [row] = (await ctx.db.into(dashboards).insert({
      name,
      description: description ?? null,
      layout: [],
      createdBy: { kind: "user" },
    })) as DashboardRow[];
    if (!row) throw new Error("insert returned no row");
    return { id: row.id };
  },
});

const updateDashboard = mutation({
  args: {
    id: uuid,
    name: text.optional(),
    description: text.optional(),
    items: jsonb.optional(),
  },
  handler: async (
    ctx,
    { id, name, description, items },
  ): Promise<{ ok: true }> => {
    const patch: Partial<DashboardRow> = {};
    if (name !== undefined) patch.name = name;
    if (description !== undefined) patch.description = description;
    if (items !== undefined) patch.layout = items as DashboardItem[];
    await ctx.db.from(dashboards).where(eq("id", id)).update(patch);
    return { ok: true };
  },
});

const removeDashboard = mutation({
  args: { id: uuid },
  handler: async (ctx, { id }): Promise<{ ok: true }> => {
    await ctx.db.from(dashboards).where(eq("id", id)).delete();
    return { ok: true };
  },
});

/** Load a dashboard's items for read-modify-write, or throw if missing. */
async function loadItems(
  ctx: { db: import("@wystack/db").DrizzleTracker },
  id: string,
): Promise<DashboardItem[]> {
  const row = (await ctx.db.from(dashboards).where(eq("id", id)).first()) as
    | DashboardRow
    | undefined;
  if (!row) throw new Error(`Dashboard ${id} not found`);
  return ((row.layout as DashboardItem[]) ?? []).slice();
}

const addDashboardItem = mutation({
  args: {
    dashboardId: uuid,
    type: text,
    visualizationId: uuid.optional(),
    content: text.optional(),
    position: jsonb,
  },
  handler: async (ctx, args): Promise<{ itemId: string }> => {
    const items = await loadItems(ctx, args.dashboardId);
    const itemId = crypto.randomUUID();
    items.push({
      id: itemId,
      type: parseDashboardType(args.type),
      visualizationId: args.visualizationId,
      content: args.content,
      ...parsePosition(args.position),
    });
    await ctx.db
      .from(dashboards)
      .where(eq("id", args.dashboardId))
      .update({ layout: items });
    return { itemId };
  },
});

const updateDashboardItem = mutation({
  args: { dashboardId: uuid, itemId: uuid, updates: jsonb },
  handler: async (
    ctx,
    { dashboardId, itemId, updates },
  ): Promise<{ ok: true }> => {
    const items = await loadItems(ctx, dashboardId);
    const patch = sanitizeDashboardUpdates(updates);
    if (!items.some((it) => it.id === itemId)) {
      throw new Error(`Dashboard item ${itemId} not found`);
    }
    const next = items.map((it) =>
      it.id === itemId ? { ...it, ...patch } : it,
    );
    await ctx.db
      .from(dashboards)
      .where(eq("id", dashboardId))
      .update({ layout: next });
    return { ok: true };
  },
});

const removeDashboardItem = mutation({
  args: { dashboardId: uuid, itemId: uuid },
  handler: async (ctx, { dashboardId, itemId }): Promise<{ ok: true }> => {
    const items = await loadItems(ctx, dashboardId);
    await ctx.db
      .from(dashboards)
      .where(eq("id", dashboardId))
      .update({ layout: items.filter((it) => it.id !== itemId) });
    return { ok: true };
  },
});

const updateDashboardControls = mutation({
  args: { dashboardId: uuid, controls: jsonb },
  handler: async (ctx, { dashboardId, controls }): Promise<{ ok: true }> => {
    await ctx.db
      .from(dashboards)
      .where(eq("id", dashboardId))
      .update({ controls: controls as DashboardControl[] });
    return { ok: true };
  },
});

/** Dashboard slice of the registry. Spread into the root `functions` object. */
export const dashboardFunctions = {
  listDashboards,
  getDashboard,
  createDashboard,
  updateDashboard,
  removeDashboard,
  addDashboardItem,
  updateDashboardItem,
  removeDashboardItem,
  updateDashboardControls,
};
