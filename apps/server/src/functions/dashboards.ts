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

import { wy } from "../wystack";
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

type DashboardOverridePatch =
  | { kind: "filter"; field: string; value: unknown | null }
  | { kind: "sorts"; value: unknown[] | null }
  | { kind: "limit"; value: number | null };

// DashFrame has one local server process per project. Serialize item writes by
// dashboard so every mutation reads the latest committed layout before it
// applies user intent. This is the server-authoritative seam; callers do not
// coordinate through stale subscription snapshots.
const dashboardWriteTails = new Map<string, Promise<void>>();

async function withDashboardWrite<T>(
  dashboardId: string,
  write: () => Promise<T>,
): Promise<T> {
  const previous = dashboardWriteTails.get(dashboardId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  dashboardWriteTails.set(dashboardId, tail);

  await previous;
  try {
    return await write();
  } finally {
    release();
    if (dashboardWriteTails.get(dashboardId) === tail) {
      dashboardWriteTails.delete(dashboardId);
    }
  }
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
): Partial<Omit<DashboardItem, "id" | "type" | "overrides">> {
  if (!isRecord(updates)) {
    throw new Error("Dashboard item updates must be an object");
  }
  const input = updates;
  if ("overrides" in updates) {
    throw new Error(
      "Dashboard item overrides require patchDashboardItemOverride",
    );
  }
  const next: Partial<Omit<DashboardItem, "id" | "type" | "overrides">> = {};
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

/**
 * Sanitize the per-cell override bag received from the client.
 *
 * Shape contract: the object must conform to `DashboardItemOverrides`
 * (@dashframe/types).  The engine reads it back as JSONB so we only gate on
 * structural plausibility — `null` / undefined → remove overrides, non-object
 * shapes are silently dropped (unexpected client payload).
 */
function sanitizeItemOverrides(
  ov: unknown,
): DashboardItem["overrides"] | undefined {
  if (ov == null) return undefined; // null or undefined → clear
  if (!isRecord(ov)) return undefined; // unexpected shape — ignore silently
  const filters = Array.isArray(ov.filters) ? ov.filters : undefined;
  const sorts = Array.isArray(ov.sorts) ? ov.sorts : undefined;
  const limit =
    typeof ov.limit === "number" && ov.limit > 0 ? ov.limit : undefined;
  // Normalise empty/all-undefined bags to undefined so they are never persisted
  // as {} or {filters:[]} in JSONB, which the engine would treat as "has overrides".
  // Note: ![] is false (arrays are truthy), so we must use .length to check empties.
  if (
    (filters == null || filters.length === 0) &&
    sorts === undefined &&
    limit === undefined
  )
    return undefined;
  return { filters, sorts, limit };
}

function parseItemPatches(
  value: unknown,
): Array<{ itemId: string; updates: unknown }> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Dashboard item patches must be a non-empty array");
  }
  const seen = new Set<string>();
  return value.map((entry) => {
    if (!isRecord(entry) || typeof entry.itemId !== "string") {
      throw new Error("Each dashboard item patch requires an itemId");
    }
    if (seen.has(entry.itemId)) {
      throw new Error(`Duplicate dashboard item patch ${entry.itemId}`);
    }
    seen.add(entry.itemId);
    return { itemId: entry.itemId, updates: entry.updates };
  });
}

function parseOverridePatch(value: unknown): DashboardOverridePatch {
  if (!isRecord(value)) {
    throw new Error("Dashboard override patch must be an object");
  }
  if (value.kind === "filter") {
    if (typeof value.field !== "string" || value.field.length === 0) {
      throw new Error("Filter override patch requires a field");
    }
    if (value.value !== null && !isRecord(value.value)) {
      throw new Error("Filter override patch value must be an object or null");
    }
    return { kind: "filter", field: value.field, value: value.value ?? null };
  }
  if (value.kind === "sorts") {
    if (value.value !== null && !Array.isArray(value.value)) {
      throw new Error("Sort override patch value must be an array or null");
    }
    return { kind: "sorts", value: value.value as unknown[] | null };
  }
  if (value.kind === "limit") {
    if (
      value.value !== null &&
      (typeof value.value !== "number" || value.value <= 0)
    ) {
      throw new Error("Limit override patch value must be positive or null");
    }
    return { kind: "limit", value: value.value as number | null };
  }
  throw new Error("Unsupported dashboard override patch kind");
}

function applyOverridePatch(
  current: DashboardItem["overrides"],
  patch: DashboardOverridePatch,
): DashboardItem["overrides"] {
  const next = { ...(current ?? {}) };
  if (patch.kind === "filter") {
    const filters = (next.filters ?? []).filter((candidate) => {
      return !isRecord(candidate) || candidate.field !== patch.field;
    });
    if (patch.value !== null) filters.push(patch.value);
    next.filters = filters.length > 0 ? filters : undefined;
  } else if (patch.kind === "sorts") {
    next.sorts =
      patch.value && patch.value.length > 0 ? patch.value : undefined;
  } else {
    next.limit = patch.value ?? undefined;
  }
  return sanitizeItemOverrides(next);
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

const createDashboard = wy.procedure
  .input({ name: text, description: text.optional() })
  .mutation(async (ctx, { name, description }): Promise<{ id: string }> => {
    const [row] = (await ctx.db.into(dashboards).insert({
      name,
      description: description ?? null,
      layout: [],
      createdBy: { kind: "user" },
    })) as DashboardRow[];
    if (!row) throw new Error("insert returned no row");
    return { id: row.id };
  });

const updateDashboard = wy.procedure
  .input({
    id: uuid,
    name: text.optional(),
    description: text.optional(),
  })
  .mutation(async (ctx, { id, name, description }): Promise<{ ok: true }> => {
    const patch: Partial<DashboardRow> = {};
    if (name !== undefined) patch.name = name;
    if (description !== undefined) patch.description = description;
    await ctx.db.from(dashboards).where(eq("id", id)).update(patch);
    return { ok: true };
  });

const removeDashboard = wy.procedure
  .input({ id: uuid })
  .mutation(async (ctx, { id }): Promise<{ ok: true }> => {
    await ctx.db.from(dashboards).where(eq("id", id)).delete();
    return { ok: true };
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

const addDashboardItem = wy.procedure
  .input({
    dashboardId: uuid,
    type: text,
    visualizationId: uuid.optional(),
    content: text.optional(),
    position: jsonb,
  })
  .mutation(async (ctx, args): Promise<{ itemId: string }> => {
    const itemId = crypto.randomUUID();
    await withDashboardWrite(args.dashboardId, async () => {
      await ctx.db.transaction(async (tx) => {
        const items = await loadItems({ db: tx }, args.dashboardId);
        items.push({
          id: itemId,
          type: parseDashboardType(args.type),
          visualizationId: args.visualizationId,
          content: args.content,
          ...parsePosition(args.position),
        });
        await tx
          .from(dashboards)
          .where(eq("id", args.dashboardId))
          .update({ layout: items });
      });
    });
    return { itemId };
  });

const updateDashboardItem = wy.procedure
  .input({ dashboardId: uuid, itemId: uuid, updates: jsonb })
  .mutation(
    async (ctx, { dashboardId, itemId, updates }): Promise<{ ok: true }> => {
      await withDashboardWrite(dashboardId, async () => {
        await ctx.db.transaction(async (tx) => {
          const items = await loadItems({ db: tx }, dashboardId);
          const patch = sanitizeDashboardUpdates(updates);
          if (!items.some((it) => it.id === itemId)) {
            throw new Error(`Dashboard item ${itemId} not found`);
          }
          const next = items.map((it) =>
            it.id === itemId ? { ...it, ...patch } : it,
          );
          await tx
            .from(dashboards)
            .where(eq("id", dashboardId))
            .update({ layout: next });
        });
      });
      return { ok: true };
    },
  );

const updateDashboardItems = wy.procedure
  .input({ dashboardId: uuid, patches: jsonb })
  .mutation(async (ctx, { dashboardId, patches }): Promise<{ ok: true }> => {
    const parsed = parseItemPatches(patches);
    await withDashboardWrite(dashboardId, async () => {
      await ctx.db.transaction(async (tx) => {
        const items = await loadItems({ db: tx }, dashboardId);
        const byId = new Map(parsed.map((patch) => [patch.itemId, patch]));
        for (const { itemId } of parsed) {
          if (!items.some((item) => item.id === itemId)) {
            throw new Error(`Dashboard item ${itemId} not found`);
          }
        }
        const next = items.map((item) => {
          const patch = byId.get(item.id);
          return patch
            ? { ...item, ...sanitizeDashboardUpdates(patch.updates) }
            : item;
        });
        await tx
          .from(dashboards)
          .where(eq("id", dashboardId))
          .update({ layout: next });
      });
    });
    return { ok: true };
  });

const patchDashboardItemOverride = wy.procedure
  .input({ dashboardId: uuid, itemId: uuid, patch: jsonb })
  .mutation(
    async (ctx, { dashboardId, itemId, patch }): Promise<{ ok: true }> => {
      const parsed = parseOverridePatch(patch);
      await withDashboardWrite(dashboardId, async () => {
        await ctx.db.transaction(async (tx) => {
          const items = await loadItems({ db: tx }, dashboardId);
          if (!items.some((item) => item.id === itemId)) {
            throw new Error(`Dashboard item ${itemId} not found`);
          }
          const next = items.map((item) =>
            item.id === itemId
              ? {
                  ...item,
                  overrides: applyOverridePatch(item.overrides, parsed),
                }
              : item,
          );
          await tx
            .from(dashboards)
            .where(eq("id", dashboardId))
            .update({ layout: next });
        });
      });
      return { ok: true };
    },
  );

const removeDashboardItem = wy.procedure
  .input({ dashboardId: uuid, itemId: uuid })
  .mutation(async (ctx, { dashboardId, itemId }): Promise<{ ok: true }> => {
    await withDashboardWrite(dashboardId, async () => {
      await ctx.db.transaction(async (tx) => {
        const items = await loadItems({ db: tx }, dashboardId);
        await tx
          .from(dashboards)
          .where(eq("id", dashboardId))
          .update({ layout: items.filter((it) => it.id !== itemId) });
      });
    });
    return { ok: true };
  });

const updateDashboardControls = wy.procedure
  .input({ dashboardId: uuid, controls: jsonb })
  .mutation(async (ctx, { dashboardId, controls }): Promise<{ ok: true }> => {
    await ctx.db
      .from(dashboards)
      .where(eq("id", dashboardId))
      .update({ controls: controls as DashboardControl[] });
    return { ok: true };
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
  updateDashboardItems,
  patchDashboardItemOverride,
  removeDashboardItem,
  updateDashboardControls,
};
