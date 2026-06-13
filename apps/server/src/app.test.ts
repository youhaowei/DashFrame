/**
 * Integration smoke for the DashFrame loopback server.
 *
 * Proves the full path the renderer relies on — open a real project, start the
 * server on loopback, and round-trip `projectInfo` over HTTP — without Electron.
 * This is the automated proxy for the ticket's "verify by running the app".
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openProject, type ProjectHandle } from "@dashframe/server-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

  describe("HTTP API", () => {
    it("should serve projectInfo over loopback HTTP from the project DB", async () => {
      project = await openProject({
        dir: join(root, "proj"),
        name: "Smoke Co",
      });
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
    });

    it("should require the loopback token and allow packaged Origin null", async () => {
      project = await openProject({
        dir: join(root, "proj"),
        name: "Auth Co",
      });
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
    });
  });

  describe("WebSocket API", () => {
    it("should require the loopback token for WebSocket auth", async () => {
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
    });
  });
});

describe("onWrite hook", () => {
  /**
   * Tests for the `onWrite` durability hook (see GitHub issue #88 / #90).
   *
   * Contracts:
   *   - A successful artifact-DB mutation fires onWrite exactly once.
   *   - N rapid successful mutations fire onWrite exactly N times (the
   *     debounce lives in SnapshotScheduler.touch(), not in the server).
   *   - A failed/invalid mutation does NOT fire onWrite.
   *   - A read-only query does NOT fire onWrite.
   *
   * Testing strategy: inject a mock onWrite callback and route real HTTP
   * mutations through the server (same path the renderer uses) — no
   * dependency on wall-clock or real PGlite snapshots.
   */
  let root: string;
  let project: ProjectHandle | null;
  let server: DashframeServer | null;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "dashframe-onwrite-"));
    project = null;
    server = null;
  });

  afterEach(async () => {
    server?.stop();
    await project?.close();
    rmSync(root, { recursive: true, force: true });
  });

  function postMutation(
    url: string,
    path: string,
    body: unknown,
  ): Promise<Response> {
    return fetch(`${url}/api/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("should fire onWrite once after a successful mutation", async () => {
    const onWriteCalls: number[] = [];
    project = await openProject({ dir: join(root, "proj") });
    server = await createDashframeServer({
      db: project.db,
      onWrite: () => {
        onWriteCalls.push(Date.now());
      },
    });

    const res = await postMutation(server.url, "getOrCreateDataSource", {
      id: crypto.randomUUID(),
      type: "csv",
      name: "My Source",
    });
    expect(res.status).toBe(200);
    expect(onWriteCalls).toHaveLength(1);
  });

  it("should fire onWrite once per successful mutation (N writes → N calls, no server-level debounce)", async () => {
    let callCount = 0;
    project = await openProject({ dir: join(root, "proj") });
    server = await createDashframeServer({
      db: project.db,
      onWrite: () => {
        callCount++;
      },
    });

    // Three rapid creates — each is a separate committed transaction.
    for (let i = 0; i < 3; i++) {
      const res = await postMutation(server.url, "getOrCreateDataSource", {
        id: crypto.randomUUID(),
        type: "csv",
        name: `Source ${i}`,
      });
      expect(res.status).toBe(200);
    }
    // The server fires onWrite once per committed write — debounce is the
    // scheduler's job, not the server's. The host (SnapshotScheduler.touch)
    // collapses rapid bursts; the server must not under-count them.
    expect(callCount).toBe(3);
  });

  it("should NOT fire onWrite when the mutation fails (invalid args)", async () => {
    let callCount = 0;
    project = await openProject({ dir: join(root, "proj") });
    server = await createDashframeServer({
      db: project.db,
      onWrite: () => {
        callCount++;
      },
    });

    // Send a mutation with a missing required field — Zod validation rejects it
    // before any DB write occurs, so no transaction commits.
    const res = await postMutation(server.url, "getOrCreateDataSource", {
      // Missing required `id` and `name` fields → validation error, no write.
      type: "csv",
    });
    expect(res.status).toBe(400);
    expect(callCount).toBe(0);
  });

  it("should NOT fire onWrite for a read-only query", async () => {
    let callCount = 0;
    project = await openProject({ dir: join(root, "proj") });
    server = await createDashframeServer({
      db: project.db,
      onWrite: () => {
        callCount++;
      },
    });

    const res = await fetch(
      `${server.url}/api/projectInfo?args=${encodeURIComponent("{}")}`,
    );
    expect(res.status).toBe(200);
    expect(callCount).toBe(0);
  });

  it("should work without onWrite (backward-compatible — omitting it changes nothing)", async () => {
    // No onWrite configured — server should start and mutations should succeed.
    project = await openProject({ dir: join(root, "proj") });
    server = await createDashframeServer({ db: project.db });

    const res = await postMutation(server.url, "getOrCreateDataSource", {
      id: crypto.randomUUID(),
      type: "csv",
      name: "Compat Test",
    });
    expect(res.status).toBe(200);
  });

  it("should isolate an onWrite that throws — the committed mutation still succeeds", async () => {
    // onWrite runs AFTER the DB write commits. If it throws, the client must
    // still see success — otherwise it would retry a durable write and
    // duplicate artifacts. The hook's failure is swallowed (logged), never
    // propagated.
    project = await openProject({ dir: join(root, "proj") });
    const sourceId = crypto.randomUUID();
    server = await createDashframeServer({
      db: project.db,
      onWrite: () => {
        throw new Error("snapshot scheduler exploded");
      },
    });

    const res = await postMutation(server.url, "getOrCreateDataSource", {
      id: sourceId,
      type: "csv",
      name: "Resilient",
    });
    // The mutation committed despite the hook throwing.
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string } };
    expect(body.data.id).toBe(sourceId);

    // The write is durable — a follow-up get-or-create returns the same row.
    const verify = await postMutation(server.url, "getOrCreateDataSource", {
      id: sourceId,
      type: "csv",
      name: "Resilient",
    });
    expect(verify.status).toBe(200);
    const verifyBody = (await verify.json()) as { data: { id: string } };
    expect(verifyBody.data.id).toBe(sourceId);
  });
});
