import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { ConvexClient, ConvexHttpClient } from "convex/browser";
import { api } from "@dashframe/convex-backend/api";
import { NativeDuckDBEngine } from "@dashframe/engine-server";
import { FileDataFrameStorage } from "@dashframe/engine-server/file-dataframe-storage";
import {
  ApiAccessCredentials,
  CREDENTIAL_CLASS,
  FileMappingStore,
  openLocalProject,
} from "@dashframe/server-core";
import {
  SecretRegistry,
  SecretVault,
  TestBackend,
} from "@wystack/secret-vault";
import { cmd } from "@dashframe/types";
import { mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { createDashframeServer, type DashframeServer } from "./app";
import { createHostAuthenticator } from "./host/auth";

it("fails closed for non-loopback hosts and does not grant tokenless credential management", async () => {
  expect(() => createHostAuthenticator({ hostname: "0.0.0.0" })).toThrow(
    "requires authentication",
  );
  expect(
    await createHostAuthenticator({ hostname: "127.0.0.1" })(
      new Request("http://127.0.0.1"),
    ),
  ).toEqual({ kind: "user", userId: "loopback-anonymous" });
  await expect(
    createHostAuthenticator({ hostname: "127.0.0.1", authToken: "primary" })(
      new Request("http://127.0.0.1"),
    ),
  ).rejects.toThrow("Unauthorized");
});

const live = process.env.DASHFRAME_CONVEX_INTEGRATION === "1";
describe.runIf(live)("native host and local Convex integration", () => {
  let dir: string;
  let engine: NativeDuckDBEngine;
  let server: DashframeServer;
  let project: Awaited<ReturnType<typeof openLocalProject>>;
  let vault: SecretVault;
  let credentials: ApiAccessCredentials;
  const token = randomUUID();
  let user: ConvexHttpClient;
  const sourceId = randomUUID(),
    tableId = randomUUID(),
    fieldId = randomUUID();
  let importedId: string;
  const host = async (
    name: string,
    args: unknown = {},
    bearer: string = token,
  ) => {
    const response = await fetch(`${server.url}/api/host/${name}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify(args),
    });
    const result: unknown = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(result));
    return result;
  };
  const jwt = async (bearer: string = token) => {
    const response = await fetch(`${server.url}/api/convex-token`, {
      method: "POST",
      headers: { authorization: `Bearer ${bearer}` },
    });
    expect(response.status).toBe(200);
    return ((await response.json()) as { token: string }).token;
  };
  async function start() {
    server = await createDashframeServer({
      project,
      authToken: token,
      corsOrigin: ["https://native-qa.localhost"],
      vault,
      accessCredentials: credentials,
      arrowEngine: engine,
      dataFrameStorage: new FileDataFrameStorage(path.join(dir, "frames")),
    });
    user = new ConvexHttpClient(`${server.url}/api/convex`);
    user.setAuth(await jwt());
  }
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "dashframe-convex-host-"));
    project = await openLocalProject({ dir, name: "Native integration" });
    const registry = new SecretRegistry();
    registry.register("test", new TestBackend());
    for (const credentialClass of Object.values(CREDENTIAL_CLASS))
      registry.setClassDefault(credentialClass, "test");
    vault = new SecretVault(
      registry,
      new FileMappingStore(path.join(dir, "vault-mappings.json")),
    );
    credentials = new ApiAccessCredentials(
      vault,
      path.join(dir, "credentials"),
    );
    engine = new NativeDuckDBEngine();
    await engine.initialize();
    await start();
  }, 120_000);
  afterAll(async () => {
    await server?.stop();
    await engine?.dispose();
    if (dir) await rm(dir, { recursive: true, force: true });
  }, 30_000);

  it("requires host identity and native JWT, and never proxies admin endpoints", async () => {
    expect((await fetch(`${server.url}/api/runtime`)).status).toBe(401);
    expect(
      (await fetch(`${server.url}/api/convex/api/run`, { method: "POST" }))
        .status,
    ).toBe(404);
    const anonymous = new ConvexHttpClient(`${server.url}/api/convex`);
    await expect(
      anonymous.query(api.app.listDataSources, {}),
    ).rejects.toThrow();
    expect(await host("getAccessCapabilities")).toEqual({
      canManageCredentials: true,
    });
    expect(await user.query(api.app.projectInfo, {})).toMatchObject({
      name: "Native integration",
    });
    const allowed = await fetch(`${server.url}/api/convex-token`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        origin: "https://native-qa.localhost",
      },
    });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(
      "https://native-qa.localhost",
    );
    const denied = await fetch(`${server.url}/api/convex-token`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        origin: "https://untrusted.example",
      },
    });
    expect(denied.status).toBe(403);
  });

  it("allows stateful MCP reconnect headers on cross-origin preflights", async () => {
    const response = await fetch(`${server.url}/mcp`, {
      method: "OPTIONS",
      headers: {
        origin: "https://native-qa.localhost",
        "access-control-request-method": "GET",
        "access-control-request-headers":
          "authorization,mcp-session-id,last-event-id",
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://native-qa.localhost",
    );
    expect(
      response.headers
        .get("access-control-allow-headers")
        ?.toLowerCase()
        .split(",")
        .map((header) => header.trim()),
    ).toContain("last-event-id");
  });

  it("stores metadata natively and rehydrates host-owned Arrow after restart", async () => {
    await user.mutation(api.app.commitBatch, {
      commands: [
        cmd("GetOrCreateDataSource", {
          id: sourceId,
          type: "local",
          name: "Local",
        }),
        cmd("CreateDataTable", {
          id: tableId,
          dataSourceId: sourceId,
          name: "Numbers",
          table: "numbers",
          fields: [
            {
              id: fieldId,
              tableId,
              name: "value",
              columnName: "value",
              type: "number",
              sensitivity: "cleared",
            },
          ],
        }),
      ],
    });
    const arrow = await engine.queryArrow(
      "SELECT 1::double AS value UNION ALL SELECT 2::double",
    );
    const importRequest = {
      dataTableId: tableId,
      arrowBase64: Buffer.from(arrow).toString("base64"),
      operationId: randomUUID(),
    };
    const [imported, retry] = (await Promise.all([
      host("ingestLocalDataFrame", importRequest),
      host("ingestLocalDataFrame", importRequest),
    ])) as Array<{ dataFrameId: string }>;
    expect(retry).toEqual(imported);
    importedId = imported!.dataFrameId;
    expect(
      await host("queryDataFrame", { dataFrameId: importedId }),
    ).toMatchObject({
      status: "ready",
      rows: [{ value: 1 }, { value: 2 }],
      totalCount: 2,
    });
    await server.stop();
    await engine.dispose();
    engine = new NativeDuckDBEngine();
    await engine.initialize();
    await start();
    expect(
      await host("queryDataFrame", { dataFrameId: importedId }),
    ).toMatchObject({ status: "ready", rows: [{ value: 1 }, { value: 2 }] });
    expect(await host("ingestLocalDataFrame", importRequest)).toEqual(imported);
    await expect(
      host("ingestLocalDataFrame", { ...importRequest, primaryKey: "value" }),
    ).rejects.toThrow();
    expect(
      await user.query(api.app.getDataTable, { id: tableId }),
    ).toMatchObject({ dataFrameId: importedId });
  }, 120_000);

  it("delivers metadata updates through two native WebSocket subscriptions", async () => {
    const left = new ConvexClient(`${server.url}/api/convex`),
      right = new ConvexClient(`${server.url}/api/convex`);
    left.setAuth(() => jwt());
    right.setAuth(() => jwt());
    const renamed = "Numbers updated";
    const changed = (client: ConvexClient) =>
      new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Native subscription timed out")),
          15_000,
        );
        const unsubscribe = client.onUpdate(
          api.app.getDataTable,
          { id: tableId },
          (value) => {
            if (value?.name === renamed) {
              clearTimeout(timeout);
              unsubscribe();
              resolve();
            }
          },
          reject,
        );
      });
    try {
      const both = Promise.all([changed(left), changed(right)]);
      await user.mutation(api.app.commitBatch, {
        commands: [cmd("RenameNode", { id: tableId, name: renamed })],
      });
      await expect(both).resolves.toEqual([undefined, undefined]);
    } finally {
      await left.close();
      await right.close();
    }
  }, 30_000);

  it("lets a service draft but denies publication and immediately revokes its JWT", async () => {
    const issued = (await host("issueAccessCredential", { name: "agent" })) as {
      credential: { id: string };
      accessCredential: string;
    };
    const service = new ConvexHttpClient(`${server.url}/api/convex`);
    service.setAuth(await jwt(issued.accessCredential));
    const draft = await service.mutation(api.app.draftBatch, {
      commands: [cmd("RenameNode", { id: tableId, name: "Draft name" })],
    });
    await expect(
      service.mutation(api.app.publishDraft, { draftId: draft.draftId }),
    ).rejects.toThrow();
    await host("revokeAccessCredential", { id: issued.credential.id });
    await expect(service.query(api.app.listDataSources, {})).rejects.toThrow();
    const review = await user.query(api.app.draftPublishReview, {
      draftId: draft.draftId,
    });
    await user.mutation(api.app.publishDraft, {
      draftId: draft.draftId,
      expectedLogSignature: review.logSignature,
      expectedCommandCount: review.commandCount,
    });
    expect(
      await user.query(api.app.getDataTable, { id: tableId }),
    ).toMatchObject({ name: "Draft name" });
  });

  it("allows the OAuth callback capability route without bypassing ordinary host auth", async () => {
    const callback = await fetch(
      `${server.url}/api/connectors/oauth/callback?state=invalid&code=invalid`,
    );
    expect(callback.status).toBe(400);
    expect(
      (await callback.text()).includes("Connection could not be completed"),
    ).toBe(true);
    const ordinary = await fetch(
      `${server.url}/api/host/listAccessCredentials`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(ordinary.status).toBe(401);
  });
  it("cleans Arrow, DuckDB and vault resources after a direct native DeleteNode", async () => {
    const deletedSourceId = randomUUID(),
      deletedTableId = randomUUID();
    const stored = vi.spyOn(vault, "store");
    try {
      await host("commitBatch", {
        commands: [
          cmd("CreateDataSource", {
            id: deletedSourceId,
            name: "Disposable",
            type: "local",
            apiKey: "synthetic-disposable-key",
          }),
          cmd("CreateDataTable", {
            id: deletedTableId,
            dataSourceId: deletedSourceId,
            name: "Disposable table",
            table: "disposable",
            fields: [
              {
                id: randomUUID(),
                tableId: deletedTableId,
                name: "value",
                columnName: "value",
                type: "number",
                sensitivity: "cleared",
              },
            ],
          }),
        ],
      });
      const ref = await stored.mock.results[0]!.value;
      expect(await vault.has(ref)).toBe(true);
      const arrow = await engine.queryArrow("SELECT 42::double AS value");
      const imported = (await host("ingestLocalDataFrame", {
        dataTableId: deletedTableId,
        arrowBase64: Buffer.from(arrow).toString("base64"),
        operationId: randomUUID(),
      })) as { dataFrameId: string };
      await host("queryDataFrame", { dataFrameId: imported.dataFrameId });
      const storage = new FileDataFrameStorage(path.join(dir, "frames"));
      expect(await storage.exists(imported.dataFrameId)).toBe(true);
      await user.mutation(api.app.commitBatch, {
        commands: [cmd("DeleteNode", { id: deletedSourceId })],
      });
      await expect
        .poll(() => storage.exists(imported.dataFrameId), { timeout: 10_000 })
        .toBe(false);
      await expect.poll(() => vault.has(ref), { timeout: 10_000 }).toBe(false);
      await expect(
        engine.queryArrow(
          `SELECT * FROM df_${imported.dataFrameId.replaceAll("-", "_")}`,
        ),
      ).rejects.toThrow();
      expect(
        await user.query(api.app.getDataFrameEntry, {
          id: imported.dataFrameId,
        }),
      ).toBeNull();
    } finally {
      stored.mockRestore();
    }
  }, 30_000);
});
