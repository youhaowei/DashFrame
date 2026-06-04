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
}

/** Domain `Dashboard` shape returned to the client (matches @dashframe/types). */
export interface DashboardResult {
  id: string;
  name: string;
  description?: string;
  items: DashboardItem[];
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
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt?.getTime(),
  };
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
  ctx: { db: import("@wystack/db").TrackedDb },
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
    const position = args.position as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    items.push({
      id: itemId,
      type: args.type as DashboardItem["type"],
      visualizationId: args.visualizationId,
      content: args.content,
      ...position,
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
    const patch = updates as Partial<Omit<DashboardItem, "id" | "type">>;
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
};
