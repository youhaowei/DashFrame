import {
  ApiAccessCredentials,
  CREDENTIAL_CLASS,
  openProject,
  schema,
  type ProjectHandle,
} from "@dashframe/server-core";
import {
  InMemoryMappingStore,
  isSecretRef,
  SecretRegistry,
  SecretVault,
  TestBackend,
  type SecretRef,
} from "@wystack/secret-vault";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

function makeCredentialVault(): SecretVault {
  const registry = new SecretRegistry();
  registry.register("test", new TestBackend(), { fallback: true });
  registry.setClassDefault(CREDENTIAL_CLASS.ConnectorKey, "test");
  return new SecretVault(registry, new InMemoryMappingStore());
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

  it("rolls back a credential rotation without releasing the live ref or leaking the replacement", async () => {
    const vault = makeCredentialVault();
    server = await createDashframeServer({
      db: project!.db,
      accessCredentials,
      authToken: USER_TOKEN,
      vault,
      flushSnapshot: async () => {},
    });
    const sourceId = crypto.randomUUID();
    expect(
      (
        await post(
          server,
          "commitBatch",
          {
            commands: [
              cmd("CreateDataSource", {
                id: sourceId,
                type: "postgres",
                name: "Credentialed source",
                apiKey: "old-secret",
              }),
            ],
          },
          USER_TOKEN,
        )
      ).status,
    ).toBe(200);
    const [sourceBefore] = await project!.db.select().from(schema.dataSources);
    const oldRef = (sourceBefore?.config as { apiKey?: unknown }).apiKey;
    expect(isSecretRef(oldRef)).toBe(true);

    const storeSpy = vi.spyOn(vault, "store");
    const failed = await post(
      server,
      "commitBatch",
      {
        commands: [
          cmd("SetDataSourceConfig", {
            id: sourceId,
            apiKey: "new-secret",
          }),
          cmd("DeleteNode", { id: crypto.randomUUID() }),
        ],
      },
      USER_TOKEN,
    );
    expect(failed.status).toBe(500);
    expect(storeSpy).toHaveBeenCalledTimes(1);
    const replacementRef = await storeSpy.mock.results[0]!.value;
    expect(isSecretRef(replacementRef)).toBe(true);

    const [sourceAfter] = await project!.db.select().from(schema.dataSources);
    expect((sourceAfter?.config as { apiKey?: unknown }).apiKey).toBe(oldRef);
    expect(await vault.has(oldRef as SecretRef)).toBe(true);
    expect(await vault.has(replacementRef)).toBe(false);
  });

  it("rolls back a credentialed delete without releasing the restored row's ref", async () => {
    const vault = makeCredentialVault();
    server = await createDashframeServer({
      db: project!.db,
      accessCredentials,
      authToken: USER_TOKEN,
      vault,
      flushSnapshot: async () => {},
    });
    const sourceId = crypto.randomUUID();
    expect(
      (
        await post(
          server,
          "commitBatch",
          {
            commands: [
              cmd("CreateDataSource", {
                id: sourceId,
                type: "postgres",
                name: "Credentialed source",
                apiKey: "still-live",
              }),
            ],
          },
          USER_TOKEN,
        )
      ).status,
    ).toBe(200);
    const [sourceBefore] = await project!.db.select().from(schema.dataSources);
    const oldRef = (sourceBefore?.config as { apiKey?: unknown }).apiKey;
    expect(isSecretRef(oldRef)).toBe(true);

    const failed = await post(
      server,
      "commitBatch",
      {
        commands: [
          cmd("DeleteNode", { id: sourceId }),
          cmd("DeleteNode", { id: crypto.randomUUID() }),
        ],
      },
      USER_TOKEN,
    );
    expect(failed.status).toBe(500);
    expect(
      (await project!.db.select().from(schema.dataSources)).some(
        (row) => row.id === sourceId,
      ),
    ).toBe(true);
    expect(await vault.has(oldRef as SecretRef)).toBe(true);
  });

  it("releases a newly minted credential when a later command rolls the batch back", async () => {
    const vault = makeCredentialVault();
    server = await createDashframeServer({
      db: project!.db,
      accessCredentials,
      authToken: USER_TOKEN,
      vault,
      flushSnapshot: async () => {},
    });
    const sourceId = crypto.randomUUID();
    const storeSpy = vi.spyOn(vault, "store");

    const failed = await post(
      server,
      "commitBatch",
      {
        commands: [
          cmd("CreateDataSource", {
            id: sourceId,
            type: "postgres",
            name: "Must roll back",
            apiKey: "must-not-leak",
          }),
          cmd("DeleteNode", { id: crypto.randomUUID() }),
        ],
      },
      USER_TOKEN,
    );
    expect(failed.status).toBe(500);
    expect(storeSpy).toHaveBeenCalledTimes(1);
    const mintedRef = await storeSpy.mock.results[0]!.value;
    expect(isSecretRef(mintedRef)).toBe(true);
    expect(
      (await project!.db.select().from(schema.dataSources)).some(
        (row) => row.id === sourceId,
      ),
    ).toBe(false);
    expect(await vault.has(mintedRef)).toBe(false);
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

  it("rejects a nested lifecycle command inside a previewDiff/commitBatch batch (preview-nested-publish escape)", async () => {
    // Regression for the merge-gate finding: previewDiff carries no
    // vocabulary allowlist of its own, and its dispatch merges `mode:
    // "preview"` into the handler context. `publishDraft`'s
    // `.authorize(commands.commit)` check treats `ctx.mode === "preview"` as
    // "this is a nested preview step" and passes — but `publishDraft`'s
    // handler opens its OWN transaction that the preview's rollback can
    // never reach. Nesting it inside a batch let a service principal (who
    // can only ever preview or draft-append) publish a draft for real. The
    // fix rejects any non-vocabulary path before a single command in the
    // batch dispatches — see `assertKnownCommandPaths` in
    // `functions/commands.ts`.
    const seedApp = await buildDashframeApp({ db: project!.db });
    const controller = createDraftController(seedApp, project!.db);
    const targetSourceId = crypto.randomUUID();
    const draftId = await controller.openDraft();
    // `commands.commit`'s `.authorize` short-circuits to deny on an absent
    // principal REGARDLESS of the draftId marker (`evaluate` requires a
    // well-formed `Principal` before it will even call the permission's
    // `check`) — a real append always carries the caller's identity, so
    // attribute this seed append to a principal like every other caller
    // does.
    await controller.appendToDraft(
      draftId,
      [
        cmd("CreateDataSource", {
          id: targetSourceId,
          type: "csv",
          name: "Must stay a draft",
        }),
      ],
      { principal: { kind: "user", userId: "seed-user" } },
    );

    server = await createDashframeServer({
      db: project!.db,
      accessCredentials,
      authToken: USER_TOKEN,
    });

    const nestedPublish = { path: "publishDraft", args: { draftId } };

    const previewArgs = encodeURIComponent(
      JSON.stringify({ commands: [nestedPublish] }),
    );
    const previewResponse = await fetch(
      `${server.url}/api/previewDiff?args=${previewArgs}`,
      { headers: bearer(serviceToken) },
    );
    // `assertKnownCommandPaths` throws a plain Error (not a permission
    // denial — the batch is rejected before dispatch ever gets a chance to
    // authorize anything), which the router's generic catch-all answers 500.
    expect(previewResponse.status).toBe(500);
    const previewBody = (await previewResponse.json()) as { error: string };
    expect(previewBody.error).toContain("publishDraft");
    expect(previewBody.error).toContain("is not a DashFrame command");

    const commitResponse = await post(
      server,
      "commitBatch",
      { commands: [nestedPublish] },
      USER_TOKEN,
    );
    expect(commitResponse.status).toBe(500);
    const commitBody = (await commitResponse.json()) as { error: string };
    expect(commitBody.error).toContain("publishDraft");
    expect(commitBody.error).toContain("is not a DashFrame command");

    // The draft never published — no canonical write from either attempt.
    expect(
      (await project!.db.select().from(schema.dataSources)).some(
        (row) => row.id === targetSourceId,
      ),
    ).toBe(false);
    expect(await controller.getDraftLog(draftId)).toHaveLength(1);
  });

  it("allows service draft append, denies its publish/discard, and lets a user finish", async () => {
    const seedApp = await buildDashframeApp({ db: project!.db });
    const controller = createDraftController(seedApp, project!.db);
    const serviceCredentialId =
      await accessCredentials.authenticate(serviceToken);
    expect(serviceCredentialId).not.toBeNull();
    const servicePrincipal = {
      kind: "service" as const,
      credentialId: serviceCredentialId!,
    };

    const publishDraftId = await controller.openDraft(
      undefined,
      `service:${servicePrincipal.credentialId}`,
    );
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

    const discardDraftId = await controller.openDraft(
      undefined,
      `service:${servicePrincipal.credentialId}`,
    );
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
