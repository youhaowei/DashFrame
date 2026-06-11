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

    expect(typeof itemId).toBe("string");

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
    expect(dashboard!.items).toHaveLength(2);

    const second = dashboard!.items.find((i) => i.id === secondId);
    expect(second!.y).toBe(4);
  });
});
