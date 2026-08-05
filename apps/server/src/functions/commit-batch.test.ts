import {
  ApiAccessCredentials,
  openProject,
  schema,
  type ProjectHandle,
} from "@dashframe/server-core";
import {
  InMemoryMappingStore,
  SecretRegistry,
  SecretVault,
  TestBackend,
} from "@wystack/secret-vault";
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
import { cmd } from "./commands";

const USER_TOKEN = "renderer-token";

function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

function makeAccessCredentials(rootDir: string): ApiAccessCredentials {
  const registry = new SecretRegistry();
  registry.register("test", new TestBackend(), { fallback: true });
  registry.setClassDefault("serve-token", "test");
  return new ApiAccessCredentials(
    new SecretVault(registry, new InMemoryMappingStore()),
    rootDir,
  );
}

async function post(
  server: DashframeServer,
  path: string,
  body: unknown,
  token: string,
): Promise<Response> {
  return fetch(`${server.url}/api/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...bearer(token),
    },
    body: JSON.stringify(body),
  });
}

describe("commitBatch and draft-only API credentials", () => {
  let root: string;
  let project: ProjectHandle | null;
  let server: DashframeServer | null;
  let serviceToken: string;
  let accessCredentials: ApiAccessCredentials;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "dashframe-commit-batch-"));
    project = await openProject({ dir: join(root, "project") });
    accessCredentials = makeAccessCredentials(join(root, "credentials"));
    ({ token: serviceToken } = await accessCredentials.issue("Test service"));
    server = null;
  });

  afterEach(async () => {
    server?.stop();
    await project?.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("denies service commits, commits a user batch atomically, and reports writes", async () => {
    const onWriteCalls: number[] = [];
    server = await createDashframeServer({
      db: project!.db,
      accessCredentials,
      authToken: USER_TOKEN,
      onWrite: () => onWriteCalls.push(Date.now()),
    });

    const sourceId = crypto.randomUUID();
    const tableId = crypto.randomUUID();
    const commands = [
      cmd("CreateDataSource", {
        id: sourceId,
        type: "csv",
        name: "Committed source",
      }),
      cmd("CreateDataTable", {
        id: tableId,
        dataSourceId: sourceId,
        name: "Committed table",
        table: "committed.csv",
      }),
    ];

    const denied = await post(
      server,
      "commitBatch",
      { commands },
      serviceToken,
    );
    expect(denied.status).toBe(403);
    expect(await project!.db.select().from(schema.dataSources)).toHaveLength(0);

    const committed = await post(
      server,
      "commitBatch",
      { commands },
      USER_TOKEN,
    );
    expect(committed.status).toBe(200);
    const payload = (await committed.json()) as {
      data: {
        mode: string;
        commands: unknown[];
        results: unknown[];
        tablesWritten: string[];
        __extraTablesWritten?: unknown;
      };
    };
    expect(payload.data).toMatchObject({
      mode: "commit",
      commands,
    });
    expect(payload.data.results).toHaveLength(2);
    expect(payload.data.tablesWritten).toEqual(
      expect.arrayContaining(["data_sources", "data_tables"]),
    );
    expect(payload.data.__extraTablesWritten).toBeUndefined();
    expect(onWriteCalls).toHaveLength(1);

    expect(await project!.db.select().from(schema.dataSources)).toHaveLength(1);
    expect(await project!.db.select().from(schema.dataTables)).toHaveLength(1);

    const rollbackSourceId = crypto.randomUUID();
    const failed = await post(
      server,
      "commitBatch",
      {
        commands: [
          cmd("CreateDataSource", {
            id: rollbackSourceId,
            type: "csv",
            name: "Must roll back",
          }),
          cmd("DeleteNode", { id: crypto.randomUUID() }),
        ],
      },
      USER_TOKEN,
    );
    expect(failed.status).toBe(500);
    expect(
      (await project!.db.select().from(schema.dataSources)).some(
        (row) => row.id === rollbackSourceId,
      ),
    ).toBe(false);
  });

  it("allows a service principal to preview the same command surface", async () => {
    server = await createDashframeServer({
      db: project!.db,
      accessCredentials,
      authToken: USER_TOKEN,
    });
    const sourceId = crypto.randomUUID();
    const args = encodeURIComponent(
      JSON.stringify({
        commands: [
          cmd("CreateDataSource", {
            id: sourceId,
            type: "csv",
            name: "Preview only",
          }),
        ],
      }),
    );

    const response = await fetch(`${server.url}/api/previewDiff?args=${args}`, {
      headers: bearer(serviceToken),
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      data: { mode: string; directNodes: Array<{ nodeId: string }> };
    };
    expect(payload.data.mode).toBe("preview");
    expect(payload.data.directNodes).toEqual([
      expect.objectContaining({ nodeId: sourceId }),
    ]);
    expect(await project!.db.select().from(schema.dataSources)).toHaveLength(0);
  });

  it("allows service draft append, denies its publish/discard, and lets a user finish", async () => {
    const seedApp = await buildDashframeApp({ db: project!.db });
    const controller = createDraftController(seedApp, project!.db);
    const servicePrincipal = {
      kind: "service" as const,
      credentialId: "seed-service",
    };

    const publishDraftId = await controller.openDraft();
    const publishedSourceId = crypto.randomUUID();
    await controller.appendToDraft(
      publishDraftId,
      [
        cmd("CreateDataSource", {
          id: publishedSourceId,
          type: "csv",
          name: "Draft source",
        }),
      ],
      { principal: servicePrincipal },
    );

    server = await createDashframeServer({
      db: project!.db,
      accessCredentials,
      authToken: USER_TOKEN,
    });

    const reviewArgs = encodeURIComponent(
      JSON.stringify({ draftId: publishDraftId }),
    );
    const review = await fetch(
      `${server.url}/api/draftPublishReview?args=${reviewArgs}`,
      { headers: bearer(serviceToken) },
    );
    expect(review.status).toBe(200);

    expect(
      (
        await post(
          server,
          "publishDraft",
          { draftId: publishDraftId },
          serviceToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await post(
          server,
          "publishDraft",
          { draftId: publishDraftId },
          USER_TOKEN,
        )
      ).status,
    ).toBe(200);
    expect(
      (await project!.db.select().from(schema.dataSources)).some(
        (row) => row.id === publishedSourceId,
      ),
    ).toBe(true);

    const discardDraftId = await controller.openDraft();
    await controller.appendToDraft(discardDraftId, [], {
      principal: servicePrincipal,
    });
    expect(
      (
        await post(
          server,
          "discardDraft",
          { draftId: discardDraftId },
          serviceToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await post(
          server,
          "discardDraft",
          { draftId: discardDraftId },
          USER_TOKEN,
        )
      ).status,
    ).toBe(200);
  });
});
