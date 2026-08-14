/**
 * Dashboard WyStack read functions.
 *
 * Persistence vs domain: the v0.2 `dashboards` row is richer than the app's
 * domain `Dashboard` (it carries `createdBy` provenance + `parentArtifactId`
 * lineage the UI never sees). Handlers map row→domain on read. The domain
 * `items: DashboardItem[]` is persisted in the `layout` jsonb column; the
 * domain epoch-ms `createdAt`/`updatedAt` map to/from the row's `Date` columns.
 *
 * Writes use the typed command vocabulary in `commands.ts`.
 */
import { schema } from "@dashframe/server-core";
import type { Dashboard } from "@dashframe/types";
import { eq, uuid } from "@wystack/db";

import { wy } from "../wystack";
import { tsToMillis } from "./timestamps";

const { dashboards } = schema;

type DashboardRow = typeof dashboards.$inferSelect;

/**
 * The domain `Dashboard` shape returned to the client. Handlers annotate their
 * returns with this so the WyStack `api` registry infers the domain type and
 * consumers read `useQuery(api.listDashboards).data` as `Dashboard[]` with no
 * cast. The single unchecked JSONB→domain assertion lives at the
 * `rowToDashboard` boundary below, not in every client.
 */
export type DashboardResult = Dashboard;

/** Row → domain. Single source of the mapping (read paths share it). */
function rowToDashboard(row: DashboardRow): DashboardResult {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    items: (row.layout as Dashboard["items"]) ?? [],
    controls: (row.controls as Dashboard["controls"]) ?? undefined,
    // Null-safe via the shared `tsToMillis` (timestamps.ts): the draft overlay
    // returns NULL created_at for a dashboard created inside a draft (the sparse
    // `<table>__draft` row has no canonical base; publish stamps the real value),
    // so coalesce null → 0 rather than crash on `.getTime()`.
    createdAt: tsToMillis(row.createdAt),
    updatedAt: row.updatedAt?.getTime(),
  };
}

const listDashboards = wy.procedure
  .input({})
  .query(async (ctx): Promise<DashboardResult[]> => {
    const rows = (await ctx.db.from(dashboards).all()) as DashboardRow[];
    return rows.map(rowToDashboard);
  });

const getDashboard = wy.procedure
  .input({ id: uuid })
  .query(async (ctx, { id }): Promise<DashboardResult | null> => {
    const row = (await ctx.db.from(dashboards).where(eq("id", id)).first()) as
      | DashboardRow
      | undefined;
    return row ? rowToDashboard(row) : null;
  });

/** Dashboard slice of the registry. Spread into the root `functions` object. */
export const dashboardFunctions = {
  listDashboards,
  getDashboard,
};
