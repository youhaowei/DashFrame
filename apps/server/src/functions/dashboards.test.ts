/**
 * Tests for the addDashboardItem server mutation.
 *
 * Regression: the client previously passed position.y = Infinity which JSON
 * serialized to null, causing parsePosition to throw and the dialog to stay
 * open with no widget added. The fix moves position calculation to the client
 * (compute bottomY from existing items). This suite covers the
 * server contract that a markdown item with a finite position is persisted
 * and readable via listDashboards.
 *
 * Pattern matches commands.test.ts / app-artifacts.test.ts: real PGLite,
 * 'should ...' names.
 */
import { openArtifactDb } from "@dashframe/server-core";
import { createWyStack, type WyStackApp } from "@wystack/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { functions } from "../functions";

describe("addDashboardItem — markdown widget persistence", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;
  let app: WyStackApp;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-dash-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    app = await createWyStack({ db, functions });
  });

  afterEach(async () => {
    await db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function call(path: string, args: unknown): Promise<unknown> {
    const { result } = await app.call(path, args);
    return result;
  }

  it("should persist a markdown item and return it in listDashboards", async () => {
    // Create a dashboard first.
    const { id: dashboardId } = (await call("createDashboard", {
      name: "Test Dashboard",
    })) as { id: string };

    // Add a markdown widget using a finite y position (the pattern the fix
    // enforces — no Infinity that would become null via JSON serialization).
    const position = { x: 0, y: 0, width: 4, height: 4 };
    const { itemId } = (await call("addDashboardItem", {
      dashboardId,
      type: "markdown",
      content: "## New Text Widget\n\nEdit this text...",
      position,
    })) as { itemId: string };

    // itemId is minted with crypto.randomUUID() server-side.
    expect(itemId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    // The item should appear in the dashboard's items list.
    const dashboardList = (await call("listDashboards", {})) as Array<{
      id: string;
      items: Array<{
        id: string;
        type: string;
        content?: string;
        x: number;
        y: number;
        width: number;
        height: number;
      }>;
    }>;

    const dashboard = dashboardList.find((d) => d.id === dashboardId);
    expect(dashboard).toBeDefined();
    expect(dashboard!.items).toHaveLength(1);

    const item = dashboard!.items[0]!;
    expect(item.id).toBe(itemId);
    expect(item.type).toBe("markdown");
    expect(item.content).toBe("## New Text Widget\n\nEdit this text...");
    expect(item.x).toBe(0);
    expect(item.y).toBe(0);
    expect(item.width).toBe(4);
    expect(item.height).toBe(4);
  });

  it("should place a second markdown item below the first when y is computed from layout", async () => {
    // This mirrors the bottomY computation in DashboardDetailContent:
    //   bottomY = items.reduce((max, item) => Math.max(max, item.y + item.height), 0)
    // Confirms the server accepts the resulting finite position.
    const { id: dashboardId } = (await call("createDashboard", {
      name: "Multi-item Dashboard",
    })) as { id: string };

    // First widget at y=0, height=4 → bottomY for second = 4.
    await call("addDashboardItem", {
      dashboardId,
      type: "markdown",
      content: "# Header",
      position: { x: 0, y: 0, width: 4, height: 4 },
    });

    const { itemId: secondId } = (await call("addDashboardItem", {
      dashboardId,
      type: "markdown",
      content: "Some notes",
      position: { x: 0, y: 4, width: 4, height: 4 },
    })) as { itemId: string };

    const dashboardList = (await call("listDashboards", {})) as Array<{
      id: string;
      items: Array<{ id: string; y: number }>;
    }>;

    const dashboard = dashboardList.find((d) => d.id === dashboardId);
    expect(dashboard).toBeDefined();
    expect(dashboard!.items).toHaveLength(2);

    const second = dashboard!.items.find((i) => i.id === secondId);
    expect(second).toBeDefined();
    expect(second!.y).toBe(4);
  });
});

describe("updateDashboardItem — sanitizeItemOverrides contracts", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;
  let app: WyStackApp;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-ov-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    app = await createWyStack({ db, functions });
  });

  afterEach(async () => {
    await db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function call(path: string, args: unknown): Promise<unknown> {
    const { result } = await app.call(path, args);
    return result;
  }

  async function addVisualizationItem(dashboardId: string): Promise<string> {
    const { itemId } = (await call("addDashboardItem", {
      dashboardId,
      type: "visualization",
      visualizationId: crypto.randomUUID(),
      position: { x: 0, y: 0, width: 4, height: 4 },
    })) as { itemId: string };
    return itemId;
  }

  async function getItem(
    dashboardId: string,
    itemId: string,
  ): Promise<{ overrides?: unknown }> {
    const list = (await call("listDashboards", {})) as Array<{
      id: string;
      items: Array<{ id: string; overrides?: unknown }>;
    }>;
    const dash = list.find((d) => d.id === dashboardId);
    return dash!.items.find((i) => i.id === itemId) as { overrides?: unknown };
  }

  it("should persist a valid limit override", async () => {
    const { id: dashboardId } = (await call("createDashboard", {
      name: "Override Test",
    })) as { id: string };
    const itemId = await addVisualizationItem(dashboardId);

    await call("updateDashboardItem", {
      dashboardId,
      itemId,
      updates: { overrides: { limit: 50 } },
    });

    const item = await getItem(dashboardId, itemId);
    expect((item.overrides as { limit?: number })?.limit).toBe(50);
  });

  it("should clear overrides when null is sent (clear sentinel)", async () => {
    // This is the JSON.stringify hazard: { overrides: undefined } → {} → key
    // absent → server gate never fires. The client sends null to preserve the
    // key. The server must treat null as "remove overrides".
    const { id: dashboardId } = (await call("createDashboard", {
      name: "Clear Sentinel Test",
    })) as { id: string };
    const itemId = await addVisualizationItem(dashboardId);

    // First pin a limit.
    await call("updateDashboardItem", {
      dashboardId,
      itemId,
      updates: { overrides: { limit: 25 } },
    });
    expect(
      ((await getItem(dashboardId, itemId)).overrides as { limit?: number })
        ?.limit,
    ).toBe(25);

    // Now clear via null sentinel.
    await call("updateDashboardItem", {
      dashboardId,
      itemId,
      updates: { overrides: null },
    });

    const item = await getItem(dashboardId, itemId);
    // overrides must be absent — NOT {} — after a null clear.
    expect(item.overrides).toBeUndefined();
  });

  it("should treat all-invalid-fields payload as a clear (not {} in JSONB)", async () => {
    // Regression for the Greptile P1: sanitizeItemOverrides can produce a
    // truthy empty object {filters:undefined,sorts:undefined,limit:undefined}
    // when all three fields fail validation. JSON.stringify drops undefined
    // values → stored as {} → engine reads non-null overrides field.
    // The fix adds an all-undefined emptiness check that returns undefined.
    const { id: dashboardId } = (await call("createDashboard", {
      name: "All-Invalid Test",
    })) as { id: string };
    const itemId = await addVisualizationItem(dashboardId);

    await call("updateDashboardItem", {
      dashboardId,
      itemId,
      // All fields fail validation: filters wrong type, sorts wrong type,
      // limit is negative (rejected by the > 0 guard).
      updates: { overrides: { filters: "invalid", sorts: null, limit: -5 } },
    });

    const item = await getItem(dashboardId, itemId);
    // Must not be persisted as {} — that would mean the engine reads a non-null
    // overrides field and may create a per-cell DuckDB view for no reason.
    // With the emptiness check, sanitizeItemOverrides returns undefined, the
    // key is dropped from JSONB, and the read-back item has no overrides field.
    expect(item.overrides).toBeUndefined();
  });

  it("should treat empty filters array as a clear ([] is truthy but ![] is false)", async () => {
    // Guards the empty-array bypass: ![] is false, so a naive !filters check
    // passes through {filters: []} as a non-empty bag. The fix uses .length.
    const { id: dashboardId } = (await call("createDashboard", {
      name: "Empty-Array Test",
    })) as { id: string };
    const itemId = await addVisualizationItem(dashboardId);

    await call("updateDashboardItem", {
      dashboardId,
      itemId,
      updates: { overrides: { filters: [], sorts: null, limit: -5 } },
    });

    const item = await getItem(dashboardId, itemId);
    // filters: [] with no valid sorts/limit must also be cleared.
    expect(item.overrides).toBeUndefined();
  });
});
