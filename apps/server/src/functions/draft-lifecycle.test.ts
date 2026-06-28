/**
 * Draft lifecycle RPCs — publishDraft, discardDraft, getDraftLog
 *
 * Pins the two contracts the QA review identified as untested but load-bearing:
 *
 *   1. `publishDraft` fires `onWrite` after a successful publish. The outer
 *      `buildDashframeApp` tracker sees zero writes (sub-tracker asymmetry from
 *      the `applyCommands(mode:'commit')` inside the controller), so the handler
 *      must fire `ctx.onWrite` explicitly. If this regresses, snapshots stop
 *      persisting after publish → data loss on crash.
 *
 *   2. `discardDraft` fires `onWrite` after a successful discard. The handler
 *      deletes rows the outer tracker never sees; missing this leaves a
 *      resurrection window across server restarts → phantom draft rows.
 *
 *   3. The `__extraTablesWritten` relay in `app.ts` strips the sentinel field
 *      from the HTTP response while broadcasting the WS invalidation set.
 *      If the strip is lost, clients see an internal implementation detail;
 *      if the merge is lost, WS subscriptions don't refresh after publish.
 *
 * Setup: open a real PGlite project, seed a draft via an external controller
 * backed by the same DB (the same design `draft-controller.test.ts` uses), then
 * exercise publishDraft/discardDraft/getDraftLog via the HTTP server.
 *
 * WHY external controller for seeding: `openDraft` and `appendToDraft` are
 * internal DraftController methods, not RPC endpoints. The seam these tests own
 * is the HTTP RPC path from the renderer to the server (contracts 1–3 above).
 * Controller unit contracts live in draft-controller.test.ts.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  openProject,
  type ArtifactDb,
  type ProjectHandle,
} from "@dashframe/server-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildDashframeApp,
  createDashframeServer,
  createDraftController,
  type DashframeServer,
} from "../app";
import { cmd } from "./commands";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function post(url: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${url}/api/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function postOk<T>(url: string, path: string, body: unknown): Promise<T> {
  const res = await post(url, path, body);
  expect(res.status, `POST ${path} returned ${res.status}`).toBe(200);
  const json = (await res.json()) as { data: T };
  return json.data;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

describe("draft lifecycle RPCs (publishDraft, discardDraft, getDraftLog)", () => {
  let root: string;
  let project: ProjectHandle | null;
  let server: DashframeServer | null;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "dashframe-draft-rpc-"));
    project = null;
    server = null;
  });

  afterEach(async () => {
    server?.stop();
    await project?.close();
    rmSync(root, { recursive: true, force: true });
  });

  /**
   * Seed a draft via an external controller backed by the same DB that
   * `createDashframeServer` will use. Since the draft log lives in the DB,
   * the server's internal controller can read and replay it.
   *
   * Returns the draftId to pass to the HTTP RPCs.
   */
  async function seedDraft(db: ArtifactDb): Promise<string> {
    const seedApp = await buildDashframeApp({ db });
    const seedController = createDraftController(seedApp, db);

    // Seed a DataSource into canonical first (publishDraft writes to the
    // canonical data_sources table — we need it to exist for the next draft
    // to reference the right foreign-key chain).
    const sourceId = crypto.randomUUID();
    const baseDraft = await seedController.openDraft();
    await seedController.appendToDraft(baseDraft, [
      cmd("CreateDataSource", { id: sourceId, type: "csv", name: "Base" }),
    ]);
    await seedController.publishDraft(baseDraft);

    // Now open the draft that the RPC tests will publish or discard.
    const draftId = await seedController.openDraft();
    await seedController.appendToDraft(draftId, [
      cmd("CreateDataSource", {
        id: crypto.randomUUID(),
        type: "csv",
        name: "Draft source",
      }),
    ]);

    return draftId;
  }

  // -------------------------------------------------------------------------
  // Contract 1: publishDraft fires onWrite
  // -------------------------------------------------------------------------

  it("publishDraft fires onWrite when tables are written", async () => {
    const onWriteCalls: number[] = [];

    project = await openProject({ dir: join(root, "proj") });
    const draftId = await seedDraft(project.db as ArtifactDb);

    server = await createDashframeServer({
      db: project.db,
      onWrite: () => onWriteCalls.push(Date.now()),
    });

    const result = await postOk<{ tablesWritten: string[] }>(
      server.url,
      "publishDraft",
      { draftId },
    );

    // Contract: onWrite fires once after the publish commits.
    // If it fires zero times, snapshot persistence regresses on publish.
    expect(onWriteCalls).toHaveLength(1);

    // tablesWritten is non-empty — the log had one CreateDataSource command.
    expect(result.tablesWritten.length).toBeGreaterThan(0);
  });

  it("publishDraft does NOT fire onWrite when the draft log is empty", async () => {
    const onWriteCalls: number[] = [];

    project = await openProject({ dir: join(root, "empty") });

    // Open a draft with no commands — no writes means no onWrite.
    const seedApp = await buildDashframeApp({ db: project.db as ArtifactDb });
    const seedController = createDraftController(
      seedApp,
      project.db as ArtifactDb,
    );
    const emptyDraftId = await seedController.openDraft();

    server = await createDashframeServer({
      db: project.db,
      onWrite: () => onWriteCalls.push(Date.now()),
    });

    const result = await postOk<{ tablesWritten: string[] }>(
      server.url,
      "publishDraft",
      { draftId: emptyDraftId },
    );

    // Empty log → no tables written → onWrite must NOT fire.
    expect(onWriteCalls).toHaveLength(0);
    expect(result.tablesWritten).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Contract 2: discardDraft fires onWrite
  // -------------------------------------------------------------------------

  it("discardDraft fires onWrite after successfully discarding", async () => {
    const onWriteCalls: number[] = [];

    project = await openProject({ dir: join(root, "proj") });
    const draftId = await seedDraft(project.db as ArtifactDb);

    server = await createDashframeServer({
      db: project.db,
      onWrite: () => onWriteCalls.push(Date.now()),
    });

    await postOk<void>(server.url, "discardDraft", { draftId });

    // Contract: discard deletes shadow rows + log; onWrite must fire so the
    // snapshot is flushed, closing the resurrection-on-restart window.
    expect(onWriteCalls).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Contract 3: __extraTablesWritten relay — strip from response
  // -------------------------------------------------------------------------

  it("publishDraft response does NOT expose __extraTablesWritten", async () => {
    project = await openProject({ dir: join(root, "proj") });
    const draftId = await seedDraft(project.db as ArtifactDb);

    server = await createDashframeServer({ db: project.db });

    const res = await post(server.url, "publishDraft", { draftId });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { data: Record<string, unknown> };

    // The `__extraTablesWritten` sentinel is an internal relay field.
    // If the `app.ts` relay strip breaks, this assertion catches it so clients
    // don't see implementation detail leaking into the API response.
    expect(body.data).not.toHaveProperty("__extraTablesWritten");
    // The public field is still present.
    expect(body.data).toHaveProperty("tablesWritten");
  });

  // -------------------------------------------------------------------------
  // getDraftLog: compacted command log
  // -------------------------------------------------------------------------

  it("getDraftLog returns the compacted command log in replay order", async () => {
    project = await openProject({ dir: join(root, "proj") });
    const draftId = await seedDraft(project.db as ArtifactDb);

    server = await createDashframeServer({ db: project.db });

    const commands = await postOk<{ path: string; args: unknown }[]>(
      server.url,
      "getDraftLog",
      { draftId },
    );

    // One CreateDataSource command was appended in seedDraft.
    expect(commands.length).toBeGreaterThan(0);
    expect(commands[0]).toHaveProperty("path");
    expect(commands[0]).toHaveProperty("args");
  });
});
