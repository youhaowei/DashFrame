/**
 * Integration smoke for the DashFrame loopback server (YW-69).
 *
 * Proves the full path the renderer relies on — open a real project, start the
 * server on loopback, and round-trip `projectInfo` over HTTP — without Electron.
 * This is the automated proxy for the ticket's "verify by running the app".
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openProject, type ProjectHandle } from "@dashframe/server-core";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createDashframeServer, type DashframeServer } from "./app";
import type { ProjectInfoResult } from "./functions";

function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

function waitForWsAuth(
  url: string,
  token: string | null,
): Promise<"authenticated" | number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      ws.close();
      reject(new Error("Timed out waiting for WebSocket auth result"));
    }, 5_000);

    function finish(result: "authenticated" | number) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    }

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "auth", token }));
    };
    ws.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as { type?: string };
      if (message.type === "authenticated") {
        finish("authenticated");
        ws.close();
      }
    };
    ws.onclose = (event) => {
      finish(event.code);
    };
    ws.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error("WebSocket failed"));
    };
  });
}

describe("createDashframeServer", () => {
  let root: string;
  let project: ProjectHandle | null;
  let server: DashframeServer | null;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "dashframe-server-"));
    project = null;
    server = null;
  });

  afterEach(async () => {
    server?.stop();
    await project?.close();
    rmSync(root, { recursive: true, force: true });
  });

  test("serves projectInfo over loopback HTTP from the project DB", async () => {
    project = await openProject({ dir: join(root, "proj"), name: "Smoke Co" });
    server = await createDashframeServer({ db: project.db });

    // Bound to an ephemeral loopback port.
    expect(server.port).toBeGreaterThan(0);
    expect(server.url).toBe(`http://127.0.0.1:${server.port}`);

    // Same request the WyStack client issues for a query: GET /api/:fn?args=.
    const res = await fetch(
      `${server.url}/api/projectInfo?args=${encodeURIComponent("{}")}`,
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as { data: ProjectInfoResult };
    expect(body.data.name).toBe("Smoke Co");
    expect(body.data.projectId).toBe(project.meta.projectId);
    expect(body.data.version).toBe(project.meta.version);
    // 30s timeout: PGLite cold-start (WASM instantiate + schema sync) takes
    // ~20s+ on a cold CI runner vs <1s warm locally. Matches server-core's
    // vitest testTimeout for the same reason — the default 5s flakes in CI.
  }, 30_000);

  test("requires the loopback token for HTTP and allows packaged Origin null", async () => {
    project = await openProject({ dir: join(root, "proj"), name: "Auth Co" });
    server = await createDashframeServer({
      db: project.db,
      authToken: "launch-token",
      corsOrigin: "null",
    });

    const url = `${server.url}/api/projectInfo?args=${encodeURIComponent("{}")}`;

    const noAuth = await fetch(url);
    expect(noAuth.status).toBe(401);

    const wrongAuth = await fetch(url, {
      headers: bearer("wrong-token"),
    });
    expect(wrongAuth.status).toBe(401);

    const preflight = await fetch(`${server.url}/api/projectInfo`, {
      method: "OPTIONS",
      headers: {
        Origin: "null",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
      },
    });
    expect(preflight.headers.get("access-control-allow-origin")).toBe("null");
    expect(preflight.headers.get("access-control-allow-headers")).toContain(
      "Authorization",
    );

    const ok = await fetch(url, {
      headers: {
        ...bearer("launch-token"),
        Origin: "null",
      },
    });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("access-control-allow-origin")).toBe("null");

    const body = (await ok.json()) as { data: ProjectInfoResult };
    expect(body.data.name).toBe("Auth Co");
  }, 30_000);

  test("requires the loopback token for WebSocket auth", async () => {
    project = await openProject({ dir: join(root, "proj"), name: "Ws Co" });
    server = await createDashframeServer({
      db: project.db,
      authToken: "launch-token",
    });

    await expect(
      waitForWsAuth(`${server.url.replace(/^http/, "ws")}/api/ws`, "wrong"),
    ).resolves.toBe(4001);

    await expect(
      waitForWsAuth(
        `${server.url.replace(/^http/, "ws")}/api/ws`,
        "launch-token",
      ),
    ).resolves.toBe("authenticated");
  }, 30_000);
});
