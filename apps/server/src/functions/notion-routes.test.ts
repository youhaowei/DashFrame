/**
 * Happy-path tests for the Notion data-plane routes.
 *
 * Proves the route-level contract that the fail-closed tests don't reach:
 *   - listNotionDatabases maps the connector's RemoteDatabase {id,name} to the
 *     renderer DTO {id,title} (the consumer renders/adds by `title`).
 *   - queryNotionDatabase persists Arrow server-side and returns an opaque
 *     frame handle plus schema metadata — no row bytes cross by default.
 *   - Both resolve the credential through the bound resolver (vault.withSecret)
 *     server-side, with no plaintext returned to the caller.
 *
 * The Notion connector is mocked so no network call is made: the mock connector
 * invokes its bound resolver (proving the auth-blind path runs) and returns
 * fixed data. TestBackend is used ONLY in test setup — never in production code.
 */
import { FileDataFrameStorage } from "@dashframe/engine-server";
import { CREDENTIAL_CLASS, openArtifactDb } from "@dashframe/server-core";
import type { DataTable } from "@dashframe/types";
import {
  InMemoryMappingStore,
  SecretRegistry,
  SecretVault,
  TestBackend,
} from "@wystack/secret-vault";
import { applyCommands, type WyStackApp } from "@wystack/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the connector so the routes resolve the credential via the bound
// resolver but never hit the Notion network. The mock connect()/query() call
// `auth` once (proving the route wires the resolver through) and return fixed
// data shaped exactly like the real connector.
// Captures the options the route forwards to connector.query (e.g. the preview
// row limit) so a test can assert the wiring.
const queryCalls: Array<{ databaseId: string; options?: unknown }> = [];
const approvedFields = [
  { id: "f1", name: "Name", type: "string", sensitivity: "cleared" },
  { id: "f2", name: "Status", type: "string", sensitivity: "cleared" },
];

vi.mock("@dashframe/connector-notion", () => ({
  makeNotionConnector: (
    auth: <T>(use: (plaintext: string) => Promise<T>) => Promise<T>,
  ) => ({
    id: "notion",
    name: "Notion",
    description: "Connect to your Notion workspace.",
    icon: "<svg></svg>",
    sourceType: "remote-api" as const,
    // Called eagerly by the server's connector catalog (connector-catalog.ts)
    // to build ConnectorCatalogEntry.formFields at module load — must be
    // present even though this test never asserts on it.
    getFormFields: () => [
      {
        name: "apiKey",
        label: "API Key",
        type: "password" as const,
        required: true,
      },
    ],
    connect: async () => auth(async () => [{ id: "db-1", name: "Roadmap" }]),
    query: async (databaseId: string, _tableId: string, options?: unknown) => {
      queryCalls.push({ databaseId, options });
      return auth(async () => ({
        arrowBuffer: "QVJST1cx", // base64 placeholder
        fieldIds: ["f1", "f2"],
        fields: [
          { id: "f1", name: "Name", type: "string" },
          { id: "f2", name: "Status", type: "string" },
        ],
        rowCount: 2,
      }));
    },
  }),
}));

import { buildDashframeApp } from "../app";
import { LOCAL_USER_ID } from "../permissions";
import { cmd } from "./commands";

function makeTestVault(): { vault: SecretVault; backend: TestBackend } {
  const backend = new TestBackend();
  const registry = new SecretRegistry();
  registry.register("test", backend, { fallback: true });
  registry.setClassDefault(CREDENTIAL_CLASS.ConnectorKey, "test");
  const vault = new SecretVault(registry, new InMemoryMappingStore());
  return { vault, backend };
}

describe("Notion data-plane routes — happy path (mocked connector)", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;
  let app: WyStackApp;
  let vault: SecretVault;
  let backend: TestBackend;
  let frameStorage: FileDataFrameStorage;

  beforeEach(async () => {
    queryCalls.length = 0;
    dir = mkdtempSync(join(tmpdir(), "dashframe-notion-routes-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    ({ vault, backend } = makeTestVault());
    frameStorage = new FileDataFrameStorage(join(dir, "dataframes"));
    app = await buildDashframeApp({
      db,
      vault,
      dataFrameStorage: frameStorage,
    });
  });

  afterEach(async () => {
    await db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  /** Create a notion source with a stored credential ref, return its id. */
  async function seedNotionSource(): Promise<string> {
    const id = crypto.randomUUID();
    await applyCommands(
      app,
      [
        cmd("CreateDataSource", {
          id,
          type: "notion",
          name: "My Notion",
          apiKey: "secret_plaintext",
        }),
      ],
      {
        mode: "commit",
        context: {
          vault,
          principal: { kind: "user", userId: LOCAL_USER_ID },
        },
      },
    );
    return id;
  }

  async function seedNotionTable(dataSourceId: string): Promise<string> {
    const added = await app.call("addDataTable", {
      dataSourceId,
      name: "Roadmap",
      table: "db-1",
    });
    return (added.result as { id: string }).id;
  }

  it("listNotionDatabases maps {id,name} → {id,title} and resolves via the vault", async () => {
    const id = await seedNotionSource();
    expect(backend.resolveCallCount).toBe(0);

    const { result } = await app.call("listNotionDatabases", {
      dataSourceId: id,
    });

    // DTO the renderer consumes: title, not name.
    expect(result).toEqual([{ id: "db-1", title: "Roadmap" }]);
    // The credential was materialized exactly once, server-side.
    expect(backend.resolveCallCount).toBe(1);
  });

  it("queryNotionDatabase returns the serializable result and resolves via the vault", async () => {
    const id = await seedNotionSource();
    const tableId = await seedNotionTable(id);
    expect(backend.resolveCallCount).toBe(0);

    const { result } = await app.call("queryNotionDatabase", {
      dataSourceId: id,
      databaseId: "db-1",
      tableId,
      materialize: true,
      approvedFields,
    });

    // Serializable shape — opaque server frame handle + ids + fields + rowCount.
    const r = result as {
      frameHandle: string;
      fieldIds: string[];
      fields: unknown[];
      rowCount: number;
    };
    expect(r.frameHandle).toMatch(/^[0-9a-f-]{36}$/);
    expect(r).not.toHaveProperty("arrowBuffer");
    expect(r.fieldIds).toEqual(["f1", "f2"]);
    expect(r.fields).toHaveLength(2);
    expect(r.rowCount).toBe(2);
    expect(r).not.toHaveProperty("dataFrame");
    // Credential resolved once, server-side; no plaintext in the payload.
    expect(backend.resolveCallCount).toBe(1);
    expect(JSON.stringify(result)).not.toContain("secret_plaintext");

    expect(await frameStorage.load(r.frameHandle)).toEqual(
      new Uint8Array(Buffer.from("QVJST1cx", "base64")),
    );
    const frame = await app.call("getDataFrameEntry", { id: r.frameHandle });
    expect(frame.result).toMatchObject({
      id: r.frameHandle,
      storage: { type: "file", key: r.frameHandle },
      definitionId: tableId,
      rowCount: 2,
      columnCount: 2,
    });
  });

  it("inspection returns schema without persisting unreviewed row bytes", async () => {
    const id = await seedNotionSource();
    const tableId = await seedNotionTable(id);

    const { result } = await app.call("queryNotionDatabase", {
      dataSourceId: id,
      databaseId: "db-1",
      tableId,
    });

    expect(result).not.toHaveProperty("frameHandle");
    expect(await frameStorage.list()).toEqual([]);
    expect((await app.call("listDataFrames", {})).result).toEqual([]);
    expect(
      ((await app.call("getDataTable", { id: tableId })).result as DataTable)
        .dataFrameId,
    ).toBeUndefined();
  });

  it("forwards the preview row limit to connector.query as pagination", async () => {
    const id = await seedNotionSource();
    const tableId = await seedNotionTable(id);

    await app.call("queryNotionDatabase", {
      dataSourceId: id,
      databaseId: "db-1",
      tableId,
      limit: 250,
    });

    expect(queryCalls).toHaveLength(1);
    expect(queryCalls[0]?.options).toEqual({
      pagination: { offset: 0, limit: 250 },
    });
  });

  it("replaces and removes the server frame with its owning table", async () => {
    const id = await seedNotionSource();
    const tableId = await seedNotionTable(id);
    const first = await app.call("queryNotionDatabase", {
      dataSourceId: id,
      databaseId: "db-1",
      tableId,
      materialize: true,
      approvedFields,
    });
    const firstHandle = (first.result as { frameHandle: string }).frameHandle;
    const second = await app.call("queryNotionDatabase", {
      dataSourceId: id,
      databaseId: "db-1",
      tableId,
      materialize: true,
      approvedFields,
    });
    const secondHandle = (second.result as { frameHandle: string }).frameHandle;

    expect(await frameStorage.exists(firstHandle)).toBe(false);
    expect(await frameStorage.exists(secondHandle)).toBe(true);
    expect(await frameStorage.list()).toEqual([secondHandle]);
    expect((await app.call("listDataFrames", {})).result).toHaveLength(1);

    await app.call("removeDataTable", { id: tableId });
    expect(await frameStorage.exists(secondHandle)).toBe(false);
    expect((await app.call("listDataFrames", {})).result).toEqual([]);
  });

  it("removes a server frame after DeleteNode commits", async () => {
    const id = await seedNotionSource();
    const tableId = await seedNotionTable(id);
    const queried = await app.call("queryNotionDatabase", {
      dataSourceId: id,
      databaseId: "db-1",
      tableId,
      materialize: true,
      approvedFields,
    });
    const handle = (queried.result as { frameHandle: string }).frameHandle;

    await app.call(
      "commitBatch",
      {
        commands: [cmd("DeleteNode", { id: tableId })],
      },
      {
        wyStackApp: app,
        artifactDb: db,
        principal: { kind: "user", userId: LOCAL_USER_ID },
      },
    );

    expect(await frameStorage.exists(handle)).toBe(false);
    expect((await app.call("listDataFrames", {})).result).toEqual([]);
  });

  it("reports a committed DeleteNode and schedules its snapshot when file cleanup must retry", async () => {
    const id = await seedNotionSource();
    const tableId = await seedNotionTable(id);
    const queried = await app.call("queryNotionDatabase", {
      dataSourceId: id,
      databaseId: "db-1",
      tableId,
      materialize: true,
      approvedFields,
    });
    const handle = (queried.result as { frameHandle: string }).frameHandle;
    const onWrite = vi.fn();
    app = await buildDashframeApp({
      db,
      vault,
      dataFrameStorage: frameStorage,
      onWrite,
    });
    const cleanup = vi
      .spyOn(frameStorage, "delete")
      .mockRejectedValueOnce(new Error("injected cleanup failure"));
    onWrite.mockClear();

    await expect(
      app.call(
        "commitBatch",
        { commands: [cmd("DeleteNode", { id: tableId })] },
        {
          wyStackApp: app,
          artifactDb: db,
          onWrite,
          principal: { kind: "user", userId: LOCAL_USER_ID },
        },
      ),
    ).resolves.toBeDefined();

    expect(onWrite).toHaveBeenCalled();
    expect(await frameStorage.exists(handle)).toBe(true);
    expect((await app.call("listDataFrames", {})).result).toEqual([]);
    cleanup.mockRestore();

    app = await buildDashframeApp({
      db,
      vault,
      dataFrameStorage: frameStorage,
    });
    expect(await frameStorage.exists(handle)).toBe(false);
  });

  it("restores a staged frame when the metadata transaction fails", async () => {
    const id = await seedNotionSource();
    const tableId = await seedNotionTable(id);
    const queried = await app.call("queryNotionDatabase", {
      dataSourceId: id,
      databaseId: "db-1",
      tableId,
      materialize: true,
      approvedFields,
    });
    const handle = (queried.result as { frameHandle: string }).frameHandle;
    const transaction = vi
      .spyOn(db, "transaction")
      .mockRejectedValueOnce(new Error("injected transaction failure"));

    await expect(app.call("removeDataTable", { id: tableId })).rejects.toThrow(
      "injected transaction failure",
    );
    transaction.mockRestore();

    expect(await frameStorage.exists(handle)).toBe(true);
    expect(
      (await app.call("getDataFrameEntry", { id: handle })).result,
    ).toMatchObject({
      id: handle,
      definitionId: tableId,
    });
  });

  it("keeps the prior frame and removes the new file when replacement fails", async () => {
    const id = await seedNotionSource();
    const tableId = await seedNotionTable(id);
    const queried = await app.call("queryNotionDatabase", {
      dataSourceId: id,
      databaseId: "db-1",
      tableId,
      materialize: true,
      approvedFields,
    });
    const handle = (queried.result as { frameHandle: string }).frameHandle;
    const transaction = vi
      .spyOn(db, "transaction")
      .mockRejectedValueOnce(new Error("injected replacement failure"));

    await expect(
      app.call("queryNotionDatabase", {
        dataSourceId: id,
        databaseId: "db-1",
        tableId,
        materialize: true,
        approvedFields,
      }),
    ).rejects.toThrow("injected replacement failure");
    transaction.mockRestore();

    expect(await frameStorage.list()).toEqual([handle]);
    expect(
      (await app.call("getDataTable", { id: tableId })).result,
    ).toMatchObject({ dataFrameId: handle });
    expect((await app.call("listDataFrames", {})).result).toHaveLength(1);
  });

  it("omits pagination when no limit is given (unbounded fetch)", async () => {
    const id = await seedNotionSource();
    const tableId = await seedNotionTable(id);

    await app.call("queryNotionDatabase", {
      dataSourceId: id,
      databaseId: "db-1",
      tableId,
    });

    expect(queryCalls).toHaveLength(1);
    expect(queryCalls[0]?.options).toBeUndefined();
  });

  it("rejects a non-positive limit (limit: 0 must not become an unbounded scan)", async () => {
    const id = await seedNotionSource();
    const tableId = await seedNotionTable(id);

    await app.call("queryNotionDatabase", {
      dataSourceId: id,
      databaseId: "db-1",
      tableId,
      limit: 0,
    });

    // limit: 0 is dropped (not forwarded as pagination), so the connector's
    // page loop does not see `0 || Infinity` → full scan.
    expect(queryCalls).toHaveLength(1);
    expect(queryCalls[0]?.options).toBeUndefined();
  });
});
