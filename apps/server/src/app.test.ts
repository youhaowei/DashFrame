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
});
