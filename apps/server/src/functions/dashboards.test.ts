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
import type { WyStackApp } from "@wystack/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { functions } from "../functions";
import { wy } from "../wystack";

describe("addDashboardItem — markdown widget persistence", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;
  let app: WyStackApp;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-dash-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    app = await wy.build({ db, functions });
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

describe("patchDashboardItemOverride contracts", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;
  let app: WyStackApp;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-ov-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    app = await wy.build({ db, functions });
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

    await call("patchDashboardItemOverride", {
      dashboardId,
      itemId,
      patch: { kind: "limit", value: 50 },
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
    await call("patchDashboardItemOverride", {
      dashboardId,
      itemId,
      patch: { kind: "limit", value: 25 },
    });
    expect(
      ((await getItem(dashboardId, itemId)).overrides as { limit?: number })
        ?.limit,
    ).toBe(25);

    // Now clear via null sentinel.
    await call("patchDashboardItemOverride", {
      dashboardId,
      itemId,
      patch: { kind: "limit", value: null },
    });

    const item = await getItem(dashboardId, itemId);
    // overrides must be absent — NOT {} — after a null clear.
    expect(item.overrides).toBeUndefined();
  });

  it("rejects whole override-bag replacement through updateDashboardItem", async () => {
    const { id: dashboardId } = (await call("createDashboard", {
      name: "Authoritative Override Test",
    })) as { id: string };
    const itemId = await addVisualizationItem(dashboardId);

    await expect(
      call("updateDashboardItem", {
        dashboardId,
        itemId,
        updates: { overrides: { limit: 5 } },
      }),
    ).rejects.toThrow(
      "Dashboard item overrides require patchDashboardItemOverride",
    );
  });

  it("normalizes an empty sorts intent to no override bag", async () => {
    const { id: dashboardId } = (await call("createDashboard", {
      name: "Empty-Array Test",
    })) as { id: string };
    const itemId = await addVisualizationItem(dashboardId);

    await call("patchDashboardItemOverride", {
      dashboardId,
      itemId,
      patch: { kind: "sorts", value: [] },
    });

    const item = await getItem(dashboardId, itemId);
    expect(item.overrides).toBeUndefined();
  });
});

describe("server-authoritative dashboard item mutations", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;
  let app: WyStackApp;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-authoritative-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    app = await wy.build({ db, functions });
  });

  afterEach(async () => {
    await db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function call(path: string, args: unknown): Promise<unknown> {
    const { result } = await app.call(path, args);
    return result;
  }

  async function createDashboardWithItems(): Promise<{
    dashboardId: string;
    firstId: string;
    secondId: string;
  }> {
    const { id: dashboardId } = (await call("createDashboard", {
      name: "Authoritative Dashboard",
    })) as { id: string };
    const { itemId: firstId } = (await call("addDashboardItem", {
      dashboardId,
      type: "visualization",
      visualizationId: crypto.randomUUID(),
      position: { x: 0, y: 0, width: 4, height: 4 },
    })) as { itemId: string };
    const { itemId: secondId } = (await call("addDashboardItem", {
      dashboardId,
      type: "visualization",
      visualizationId: crypto.randomUUID(),
      position: { x: 4, y: 0, width: 4, height: 4 },
    })) as { itemId: string };
    return { dashboardId, firstId, secondId };
  }

  async function getItems(dashboardId: string) {
    const dashboards = (await call("listDashboards", {})) as Array<{
      id: string;
      items: Array<{
        id: string;
        x: number;
        y: number;
        overrides?: {
          filters?: Array<{ field: string }>;
          sorts?: unknown[];
          limit?: number;
        };
      }>;
    }>;
    return dashboards.find((dashboard) => dashboard.id === dashboardId)!.items;
  }

  it("applies a compacted layout as one atomic server mutation", async () => {
    const { dashboardId, firstId, secondId } = await createDashboardWithItems();

    await call("updateDashboardItems", {
      dashboardId,
      patches: [
        { itemId: firstId, updates: { x: 1, y: 2 } },
        { itemId: secondId, updates: { x: 7, y: 3 } },
      ],
    });

    const items = await getItems(dashboardId);
    expect(items.find((item) => item.id === firstId)).toMatchObject({
      x: 1,
      y: 2,
    });
    expect(items.find((item) => item.id === secondId)).toMatchObject({
      x: 7,
      y: 3,
    });
  });

  it("serializes concurrent override intents without dropping sibling fields", async () => {
    const { dashboardId, firstId } = await createDashboardWithItems();

    await Promise.all([
      call("patchDashboardItemOverride", {
        dashboardId,
        itemId: firstId,
        patch: {
          kind: "sorts",
          value: [{ field: "revenue", direction: "desc" }],
        },
      }),
      call("patchDashboardItemOverride", {
        dashboardId,
        itemId: firstId,
        patch: { kind: "limit", value: 25 },
      }),
      call("patchDashboardItemOverride", {
        dashboardId,
        itemId: firstId,
        patch: {
          kind: "filter",
          field: "region",
          value: { field: "region", operator: "eq", value: "West" },
        },
      }),
    ]);

    const item = (await getItems(dashboardId)).find(
      (candidate) => candidate.id === firstId,
    );
    expect(item?.overrides).toMatchObject({
      limit: 25,
      sorts: [{ field: "revenue", direction: "desc" }],
      filters: [{ field: "region", operator: "eq", value: "West" }],
    });
  });
});
