import {
  draftCommandLog,
  openArtifactDb,
  schema,
} from "@dashframe/server-core";
import { createWyStack } from "@wystack/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildDashframeApp,
  createDashframeServer,
  createDraftController,
  type DashframeServer,
} from "../app";
import { functions } from "../functions";
import { cmd } from "./commands";
import type { DraftPublishReview } from "./drafts";

const { dataSources } = schema;

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  expect(response.status).toBe(200);
  return (await response.json()) as T;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as T;
}

describe("draft publish functions", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;
  let server: DashframeServer | null;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-draft-fns-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    server = null;
  });

  afterEach(async () => {
    server?.stop();
    await db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function controller() {
    const app = await buildDashframeApp({ db });
    return createDraftController(app, db);
  }

  it("reviews and atomically publishes a draft from the public server function", async () => {
    const onWriteCalls: number[] = [];
    const draftController = await controller();
    const draftId = await draftController.openDraft();
    const sourceId = crypto.randomUUID();
    await draftController.appendToDraft(draftId, [
      cmd("CreateDataSource", {
        id: sourceId,
        type: "csv",
        name: "Draft source",
      }),
    ]);

    server = await createDashframeServer({
      db,
      onWrite: () => onWriteCalls.push(Date.now()),
    });

    const review = await getJson<{
      data: {
        publishBlocked: boolean;
        lateBound: unknown[];
        commands: Array<{ path: string }>;
        diff: { directNodes: Array<{ nodeId: string }> };
      };
    }>(
      `${server.url}/api/draftPublishReview?args=${encodeURIComponent(
        JSON.stringify({ draftId }),
      )}`,
    );

    expect(review.data.publishBlocked).toBe(false);
    expect(review.data.lateBound).toHaveLength(0);
    expect(review.data.commands.map((command) => command.path)).toEqual([
      "createDataSource",
    ]);
    expect(review.data.diff.directNodes[0]?.nodeId).toBe(sourceId);

    await postJson(`${server.url}/api/publishDraft`, { draftId });
    expect(onWriteCalls).toHaveLength(1);
    const rows = await db.select().from(dataSources);
    expect(rows.find((row) => row.id === sourceId)?.name).toBe("Draft source");
    expect(await draftController.getDraftLog(draftId)).toHaveLength(0);
  });

  it("blocks publish when the durable log contains late-bound operands", async () => {
    const app = await createWyStack({ db, functions });
    const draftId = crypto.randomUUID();
    await db.insert(draftCommandLog).values({
      draftId,
      seq: 0,
      path: "createDataSource",
      args: {
        id: crypto.randomUUID(),
        type: "csv",
        name: {
          kind: "lateBound",
          label: "data source name",
        },
      },
    });

    const { result } = await app.call(
      "draftPublishReview",
      { draftId },
      { wyStackApp: app, artifactDb: db },
    );
    const review = result as DraftPublishReview;

    expect(review.publishBlocked).toBe(true);
    expect(review.lateBound).toEqual([
      {
        commandIndex: 0,
        path: "createDataSource",
        jsonPath: "args.name",
        kind: "lateBound",
        label: "data source name",
      },
    ]);

    await expect(
      app.call(
        "publishDraft",
        { draftId },
        {
          wyStackApp: app,
          artifactDb: db,
          draftController: createDraftController(app, db),
        },
      ),
    ).rejects.toThrow(/late-bound operands/);
  });

  it("discards a draft without touching canonical artifacts", async () => {
    const draftController = await controller();
    const draftId = await draftController.openDraft();
    const sourceId = crypto.randomUUID();
    await draftController.appendToDraft(draftId, [
      cmd("CreateDataSource", {
        id: sourceId,
        type: "csv",
        name: "Throwaway",
      }),
    ]);
    server = await createDashframeServer({ db });

    await postJson(`${server.url}/api/discardDraft`, { draftId });

    expect(await draftController.getDraftLog(draftId)).toHaveLength(0);
    const rows = await db.select().from(dataSources);
    expect(rows.find((row) => row.id === sourceId)).toBeUndefined();
  });
});
