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
import { z } from "zod";

import { wy } from "../wystack";
import { tsToMillis } from "./timestamps";

const { dashboards } = schema;

type DashboardRow = typeof dashboards.$inferSelect;

/**
 * The domain `Dashboard` shape returned to the client. Handlers annotate their
 * returns with this so the WyStack `api` registry infers the domain type and
 * consumers read `useQuery(api.listDashboards).data` as `Dashboard[]` with no
 * cast. JSONB is validated by `parseStoredDashboardState` before the result is
 * assembled, keeping the read and canonical-write contract shared.
 */
export type DashboardResult = Dashboard;

const storedDashboardItemSchema = z
  .object({
    id: z.string(),
    type: z.enum(["visualization", "markdown"]),
    visualizationId: z.string().optional(),
    content: z.string().optional(),
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
    overrides: z.unknown().optional(),
  })
  .passthrough();

const storedDashboardControlSchema = z
  .object({
    id: z.string(),
    field: z.string(),
    label: z.string().optional(),
    defaultValue: z.unknown().optional(),
    boundInstances: z.array(z.string()),
  })
  .passthrough();

/** Shared structural contract for dashboard JSONB reads and writes. */
export const storedDashboardStateSchema = z.object({
  layout: z
    .array(storedDashboardItemSchema)
    .nullish()
    .transform((value) => value ?? []),
  controls: z
    .array(storedDashboardControlSchema)
    .nullish()
    .transform((value) => value ?? undefined),
});

export function parseStoredDashboardState(
  value: unknown,
  subject: string,
): Pick<Dashboard, "items" | "controls"> {
  const parsed = storedDashboardStateSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".") || "state";
    throw new Error(`${subject} is invalid: ${path} ${issue?.message}`);
  }
  return {
    items: parsed.data.layout as Dashboard["items"],
    controls: parsed.data.controls as Dashboard["controls"],
  };
}

/** Row → domain. Single source of the mapping (read paths share it). */
function rowToDashboard(row: DashboardRow): DashboardResult {
  const state = parseStoredDashboardState(row, `Dashboard ${row.id}`);
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    items: state.items,
    controls: state.controls,
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
