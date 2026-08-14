/**
 * Happy-path tests for the Notion data-plane routes.
 *
 * Proves the route-level contract that the fail-closed tests don't reach:
 *   - listNotionDatabases maps the connector's RemoteDatabase {id,name} to the
 *     renderer DTO {id,title} (the consumer renders/adds by `title`).
 *   - queryNotionDatabase persists Arrow server-side and returns an opaque
 *     DataFrame ID plus schema metadata — no row bytes cross by default.
 *   - Both resolve the credential through the bound resolver (vault.withSecret)
 *     server-side, with no plaintext returned to the caller.
 *
 * The Notion connector is mocked so no network call is made: the mock connector
 * invokes its bound resolver (proving the auth-blind path runs) and returns
 * fixed data. TestBackend is used ONLY in test setup — never in production code.
 */
import {
  duckdbColumnsToArrowIpc,
  FileDataFrameStorage,
} from "@dashframe/engine-server";
import {
  CREDENTIAL_CLASS,
  openArtifactDb,
  schema,
} from "@dashframe/server-core";
import type { DataTable } from "@dashframe/types";
import {
  InMemoryMappingStore,
  SecretRegistry,
  SecretVault,
  TestBackend,
} from "@wystack/secret-vault";
import { applyCommands, type WyStackApp } from "@wystack/server";
import { eq as drizzleEq } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vite-plus/test";

// Mock the connector so the routes resolve the credential via the bound
// resolver but never hit the Notion network. The mock connect()/query() call
// `auth` once (proving the route wires the resolver through) and return fixed
// data shaped exactly like the real connector.
// Captures the options the route forwards to connector.query (e.g. the preview
// row limit) so a test can assert the wiring.
const queryCalls: Array<{ databaseId: string; options?: unknown }> = [];
const postgresQueryCalls: Array<{ databaseId: string; options?: unknown }> = [];
const approvedFields = [
  { id: "f1", name: "Name", type: "string", sensitivity: "cleared" },
  { id: "f2", name: "Status", type: "string", sensitivity: "cleared" },
];
let returnedFields: Array<Record<string, unknown>> = [];
let returnedArrowBuffer = "";
let pauseQuery: (() => Promise<void>) | undefined;

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
      await pauseQuery?.();
      return auth(async () => ({
        arrowBuffer: returnedArrowBuffer,
        fieldIds: ["f1", "f2"],
        fields: returnedFields,
        rowCount: 2,
      }));
    },
  }),
}));

vi.mock("@dashframe/connector-postgres", () => ({
  makePostgresConnector: (
    auth: <T>(use: (plaintext: string) => Promise<T>) => Promise<T>,
  ) => ({
    id: "postgres",
    name: "Postgres",
    description: "Postgres",
    icon: "<svg></svg>",
    sourceType: "database" as const,
    getFormFields: () => [],
    connect: async () =>
      auth(async () => [{ id: "public.tasks", name: "Tasks" }]),
    query: async (databaseId: string, _tableId: string, options?: unknown) => {
      postgresQueryCalls.push({ databaseId, options });
      return auth(async () => ({
        arrowBuffer: returnedArrowBuffer,
        fieldIds: ["f1", "f2"],
        fields: returnedFields,
        rowCount: 2,
      }));
    },
  }),
}));

import { buildDashframeApp, createDraftController } from "../app";
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
  let flushSnapshot: Mock<() => Promise<void>>;
  let unregisterServerFrames: Mock<(ids: readonly string[]) => Promise<void>>;
  let onWrite: Mock<() => void>;

  beforeEach(async () => {
    queryCalls.length = 0;
    postgresQueryCalls.length = 0;
    pauseQuery = undefined;
    returnedFields = [
      { id: "f1", name: "Name", type: "string" },
      { id: "f2", name: "Status", type: "string" },
    ];
    returnedArrowBuffer = Buffer.from(
      duckdbColumnsToArrowIpc([
        { name: "Name", typeId: 17, values: ["One", "Two"] },
        { name: "Status", typeId: 17, values: ["Open", "Done"] },
      ]),
    ).toString("base64");
    dir = mkdtempSync(join(tmpdir(), "dashframe-notion-routes-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    ({ vault, backend } = makeTestVault());
    frameStorage = new FileDataFrameStorage(join(dir, "dataframes"));
    flushSnapshot = vi.fn(async () => {});
    unregisterServerFrames = vi.fn(async () => {});
    onWrite = vi.fn();
    const builtApp = await buildDashframeApp({
      db,
      vault,
      dataFrameStorage: frameStorage,
      flushSnapshot,
      flushSnapshotRetentionWindow: flushSnapshot,
      unregisterServerFrames,
      onWrite,
    });
    app = {
      ...builtApp,
      call: (path, args, context = {}) =>
        builtApp.call(path, args, {
          principal: { kind: "user", userId: LOCAL_USER_ID },
          ...context,
        }),
    };
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

  async function seedPostgresSourceAndTable(): Promise<{
    sourceId: string;
    tableId: string;
  }> {
    const sourceId = crypto.randomUUID();
    await applyCommands(
      app,
      [
        cmd("CreateDataSource", {
          id: sourceId,
          type: "postgres",
          name: "Warehouse",
          connectionString: "postgresql://user:pass@host/db",
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
    const added = await app.call("addDataTable", {
      dataSourceId: sourceId,
      name: "Tasks",
      table: "public.tasks",
    });
    return { sourceId, tableId: (added.result as { id: string }).id };
  }

  it("listNotionDatabases maps {id,name} → {id,title} and resolves via the vault", async () => {
    const id = await seedNotionSource();
    expect(backend.resolveCallCount).toBe(0);

    const { result } = await app.call("listNotionDatabases", {
      dataSourceId: id,
    });

    // DTO the renderer consumes: title, not name.
    expect(result).toEqual([{ id: "db-1", title: "Roadmap" }]);
    // The credential was imported exactly once, server-side.
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
      snapshot: true,
      approvedFields,
    });

    // Serializable shape — DataFrame ID + field ids + fields + rowCount.
    const r = result as {
      dataFrameId: string;
      fieldIds: string[];
      fields: unknown[];
      rowCount: number;
    };
    expect(r.dataFrameId).toMatch(/^[0-9a-f-]{36}$/);
    expect(r).not.toHaveProperty("arrowBuffer");
    expect(r.fieldIds).toEqual(["f1", "f2"]);
    expect(r.fields).toHaveLength(2);
    expect(r.rowCount).toBe(2);
    expect(r).not.toHaveProperty("dataFrame");
    // Credential resolved once, server-side; no plaintext in the payload.
    expect(backend.resolveCallCount).toBe(1);
    expect(JSON.stringify(result)).not.toContain("secret_plaintext");
    expect(queryCalls[0]?.options).toBeUndefined();

    expect(await frameStorage.load(r.dataFrameId)).toEqual(
      new Uint8Array(Buffer.from(returnedArrowBuffer, "base64")),
    );
    const frame = await app.call("getDataFrameEntry", { id: r.dataFrameId });
    expect(frame.result).toMatchObject({
      id: r.dataFrameId,
      storage: { type: "file", key: r.dataFrameId },
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

    expect(result).not.toHaveProperty("dataFrameId");
    expect(await frameStorage.list()).toEqual([]);
    expect((await app.call("listDataFrames", {})).result).toEqual([]);
    expect(
      ((await app.call("getDataTable", { id: tableId })).result as DataTable)
        .dataFrameId,
    ).toBeUndefined();
  });

  it("prepares a newly bound table from connector-authored structural fields", async () => {
    const sourceId = await seedNotionSource();
    const tableId = await seedNotionTable(sourceId);

    const prepared = await app.call("prepareRemoteDataTable", { id: tableId });

    expect(prepared.result).toEqual({ fields: returnedFields });
    expect(
      ((await app.call("getDataTable", { id: tableId })).result as DataTable)
        .fields,
    ).toEqual(returnedFields);
    expect(queryCalls.at(-1)?.options).toEqual({
      pagination: { offset: 0, limit: 1 },
    });
    expect(await frameStorage.list()).toEqual([]);
  });

  it("fails closed when preparation discovers drift after schema persistence", async () => {
    const sourceId = await seedNotionSource();
    const tableId = await seedNotionTable(sourceId);
    await app.call("prepareRemoteDataTable", { id: tableId });
    returnedFields = [
      ...returnedFields,
      { id: "f3", name: "Owner", type: "string", sensitivity: "cleared" },
    ];

    await expect(
      app.call("prepareRemoteDataTable", { id: tableId }),
    ).rejects.toThrow("SOURCE_SCHEMA_CHANGED");
  });

  it("reuses persisted field identities when discovery regenerates ids", async () => {
    const sourceId = await seedNotionSource();
    const tableId = await seedNotionTable(sourceId);
    const first = await app.call("prepareRemoteDataTable", { id: tableId });
    const firstFields = (first.result as { fields: typeof returnedFields })
      .fields;
    returnedFields = returnedFields.map((field) => ({
      ...field,
      id: `regenerated-${field.id}`,
    }));

    const second = await app.call("prepareRemoteDataTable", { id: tableId });

    expect(second.result).toEqual(first.result);
    expect(
      ((await app.call("getDataTable", { id: tableId })).result as DataTable)
        .fields,
    ).toEqual(firstFields);
  });

  it("does not attach a discovered schema after the remote binding changes", async () => {
    const sourceId = await seedNotionSource();
    const tableId = await seedNotionTable(sourceId);
    let releaseQuery!: () => void;
    pauseQuery = () =>
      new Promise<void>((resolve) => {
        releaseQuery = resolve;
      });

    const preparing = app.call("prepareRemoteDataTable", { id: tableId });
    await vi.waitFor(() => expect(releaseQuery).toBeTypeOf("function"));
    await app.call("updateDataTable", {
      id: tableId,
      updates: { table: "db-2" },
    });
    releaseQuery();

    await expect(preparing).rejects.toThrow(
      "Remote table binding changed during schema discovery",
    );
    expect(
      ((await app.call("getDataTable", { id: tableId })).result as DataTable)
        .fields,
    ).toEqual([]);
  });

  it("rejects every unreviewed import shape before persistence", async () => {
    const id = await seedNotionSource();
    const tableId = await seedNotionTable(id);
    const base = {
      dataSourceId: id,
      databaseId: "db-1",
      tableId,
      snapshot: true,
    };
    const expectNoPersistence = async () => {
      expect(await frameStorage.list()).toEqual([]);
      expect((await app.call("listDataFrames", {})).result).toEqual([]);
      expect(
        ((await app.call("getDataTable", { id: tableId })).result as DataTable)
          .dataFrameId,
      ).toBeUndefined();
    };

    await expect(app.call("queryNotionDatabase", base)).rejects.toThrow(
      "Reviewed fields are required before import",
    );
    await expectNoPersistence();

    await expect(
      app.call("queryNotionDatabase", {
        ...base,
        approvedFields: approvedFields.map(
          ({ sensitivity: _, ...field }) => field,
        ),
      }),
    ).rejects.toThrow("Every remote column must be reviewed before import");
    await expectNoPersistence();

    await expect(
      app.call("queryNotionDatabase", {
        ...base,
        approvedFields: approvedFields.slice(0, 1),
      }),
    ).rejects.toThrow("Reviewed fields do not match the remote result");
    await expectNoPersistence();

    returnedFields = [
      { id: "f1", name: "Name", type: "string", sensitivity: "sensitive" },
      { id: "f2", name: "Status", type: "string" },
    ];
    await expect(
      app.call("queryNotionDatabase", { ...base, approvedFields }),
    ).rejects.toThrow("Sensitive remote columns cannot be imported");
    await expectNoPersistence();
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
      snapshot: true,
      approvedFields,
    });
    const firstDataFrameId = (first.result as { dataFrameId: string })
      .dataFrameId;
    const second = await app.call("queryNotionDatabase", {
      dataSourceId: id,
      databaseId: "db-1",
      tableId,
      snapshot: true,
      approvedFields,
    });
    const secondDataFrameId = (second.result as { dataFrameId: string })
      .dataFrameId;

    expect(await frameStorage.exists(firstDataFrameId)).toBe(false);
    expect(await frameStorage.exists(secondDataFrameId)).toBe(true);
    expect(await frameStorage.list()).toEqual([secondDataFrameId]);
    expect((await app.call("listDataFrames", {})).result).toHaveLength(1);

    await app.call("removeDataTable", { id: tableId });
    expect(await frameStorage.exists(secondDataFrameId)).toBe(false);
    expect((await app.call("listDataFrames", {})).result).toEqual([]);
  });

  it("clearing a table link removes its old owned frame but preserves a shared frame", async () => {
    const id = await seedNotionSource();
    const ownerTableId = await seedNotionTable(id);
    const sharedTableId = await seedNotionTable(id);
    const queried = await app.call("queryNotionDatabase", {
      dataSourceId: id,
      databaseId: "db-1",
      tableId: ownerTableId,
      snapshot: true,
      approvedFields,
    });
    const frameId = (queried.result as { dataFrameId: string }).dataFrameId;
    await app.call("updateDataTable", {
      id: sharedTableId,
      updates: { dataFrameId: frameId },
    });

    await app.call("updateDataTable", {
      id: ownerTableId,
      updates: { dataFrameId: null },
    });
    expect(await frameStorage.exists(frameId)).toBe(true);
    expect(
      (await app.call("getDataFrameEntry", { id: frameId })).result,
    ).not.toBeNull();

    flushSnapshot.mockClear();
    await app.call("updateDataTable", {
      id: sharedTableId,
      updates: { dataFrameId: null },
    });
    expect(await frameStorage.exists(frameId)).toBe(false);
    expect(
      (await app.call("getDataFrameEntry", { id: frameId })).result,
    ).toBeNull();
    expect(flushSnapshot).toHaveBeenCalledTimes(1);
  });

  it("source deletion discovers an old source-owned frame after its table link was already cleared", async () => {
    const id = await seedNotionSource();
    const tableId = await seedNotionTable(id);
    const queried = await app.call("queryNotionDatabase", {
      dataSourceId: id,
      databaseId: "db-1",
      tableId,
      snapshot: true,
      approvedFields,
    });
    const frameId = (queried.result as { dataFrameId: string }).dataFrameId;
    // Recreate the pre-fix stranded state: metadata still owns the frame, but
    // the table's current link no longer reveals it.
    await db
      .update(schema.dataTables)
      .set({ dataFrameId: null })
      .where(drizzleEq(schema.dataTables.id, tableId));

    await app.call("removeDataSource", { id });
    expect(await frameStorage.exists(frameId)).toBe(false);
    expect((await app.call("listDataFrames", {})).result).toEqual([]);
    await expect(
      buildDashframeApp({
        db,
        vault,
        dataFrameStorage: frameStorage,
        flushSnapshotRetentionWindow: async () => {},
      }),
    ).resolves.toBeDefined();
    expect(await frameStorage.list()).toEqual([]);
  });

  it("canonical RefreshDataTable does not strand the replaced server frame", async () => {
    const id = await seedNotionSource();
    const tableId = await seedNotionTable(id);
    const queried = await app.call("queryNotionDatabase", {
      dataSourceId: id,
      databaseId: "db-1",
      tableId,
      snapshot: true,
      approvedFields,
    });
    const oldFrameId = (queried.result as { dataFrameId: string }).dataFrameId;
    const replacementId = crypto.randomUUID();

    await app.call(
      "commitBatch",
      {
        commands: [
          cmd("RefreshDataTable", { id: tableId, dataFrameId: replacementId }),
        ],
      },
      { wyStackApp: app, artifactDb: db },
    );

    expect(await frameStorage.exists(oldFrameId)).toBe(false);
    expect(
      (await app.call("getDataFrameEntry", { id: oldFrameId })).result,
    ).toBeNull();
    expect(
      (await app.call("getDataTable", { id: tableId })).result,
    ).toMatchObject({ dataFrameId: replacementId });
  });

  it("rejects malformed or schema-mismatched IPC before replacing a healthy frame", async () => {
    const id = await seedNotionSource();
    const tableId = await seedNotionTable(id);
    const healthy = await app.call("queryNotionDatabase", {
      dataSourceId: id,
      databaseId: "db-1",
      tableId,
      snapshot: true,
      approvedFields,
    });
    const healthyId = (healthy.result as { dataFrameId: string }).dataFrameId;

    const healthyIpc = Buffer.from(returnedArrowBuffer, "base64");
    returnedArrowBuffer = healthyIpc
      .subarray(0, Math.floor(healthyIpc.length / 2))
      .toString("base64");
    await expect(
      app.call("queryNotionDatabase", {
        dataSourceId: id,
        databaseId: "db-1",
        tableId,
        snapshot: true,
        approvedFields,
      }),
    ).rejects.toThrow("malformed Arrow IPC");
    expect(await frameStorage.list()).toEqual([healthyId]);

    returnedArrowBuffer = Buffer.from(
      duckdbColumnsToArrowIpc([
        { name: "Wrong", typeId: 17, values: ["One", "Two"] },
        { name: "Status", typeId: 17, values: ["Open", "Done"] },
      ]),
    ).toString("base64");
    await expect(
      app.call("queryNotionDatabase", {
        dataSourceId: id,
        databaseId: "db-1",
        tableId,
        snapshot: true,
        approvedFields,
      }),
    ).rejects.toThrow("schema does not match reviewed fields");
    expect(await frameStorage.list()).toEqual([healthyId]);
    expect(
      (await app.call("getDataTable", { id: tableId })).result,
    ).toMatchObject({ dataFrameId: healthyId });
  });

  it("validates the persisted remote binding before resolving credentials or querying", async () => {
    const id = await seedNotionSource();
    const tableId = await seedNotionTable(id);
    await expect(
      app.call("queryNotionDatabase", {
        dataSourceId: id,
        databaseId: "attacker-selected-db",
        tableId,
      }),
    ).rejects.toThrow("is bound to remote resource db-1");
    expect(queryCalls).toEqual([]);
    expect(backend.resolveCallCount).toBe(0);
  });

  it("enforces the persisted Postgres resource binding before credentials or query", async () => {
    const { sourceId, tableId } = await seedPostgresSourceAndTable();
    expect(backend.resolveCallCount).toBe(0);
    await expect(
      app.call("queryPostgresTable", {
        dataSourceId: sourceId,
        databaseId: "public.secrets",
        tableId,
      }),
    ).rejects.toThrow("is bound to remote resource public.tasks");
    expect(postgresQueryCalls).toEqual([]);
    expect(backend.resolveCallCount).toBe(0);

    await app.call("queryPostgresTable", {
      dataSourceId: sourceId,
      databaseId: "public.tasks",
      tableId,
    });
    expect(postgresQueryCalls).toEqual([
      {
        databaseId: "public.tasks",
        options: { pagination: { offset: 0, limit: 100 } },
      },
    ]);
    expect(backend.resolveCallCount).toBe(1);
  });

  it("allows service inspection but requires commit permission before materialization", async () => {
    const id = await seedNotionSource();
    const tableId = await seedNotionTable(id);
    const service = {
      principal: { kind: "service", credentialId: "reader" },
    };

    await expect(
      app.call(
        "queryNotionDatabase",
        { dataSourceId: id, databaseId: "db-1", tableId },
        service,
      ),
    ).resolves.toBeDefined();
    queryCalls.length = 0;
    await expect(
      app.call(
        "queryNotionDatabase",
        {
          dataSourceId: id,
          databaseId: "db-1",
          tableId,
          snapshot: true,
          approvedFields,
        },
        service,
      ),
    ).rejects.toThrow("Permission denied: commands.commit");
    expect(queryCalls).toEqual([]);
    expect(await frameStorage.list()).toEqual([]);
  });

  it("cannot attach a materialized frame after table deletion commits", async () => {
    const id = await seedNotionSource();
    const tableId = await seedNotionTable(id);
    let release!: () => void;
    let started!: () => void;
    const queryStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    pauseQuery = async () => {
      started();
      await released;
    };
    const materialize = app.call("queryNotionDatabase", {
      dataSourceId: id,
      databaseId: "db-1",
      tableId,
      snapshot: true,
      approvedFields,
    });
    await queryStarted;
    await app.call("removeDataTable", { id: tableId });
    release();

    await expect(materialize).rejects.toThrow(`DataTable ${tableId} not found`);
    expect((await app.call("listDataFrames", {})).result).toEqual([]);
    expect(await frameStorage.list()).toEqual([]);
  });

  it("executes frame-touching preview and draft batches without canonical side effects", async () => {
    const id = await seedNotionSource();
    const tableId = await seedNotionTable(id);
    const queried = await app.call("queryNotionDatabase", {
      dataSourceId: id,
      databaseId: "db-1",
      tableId,
      snapshot: true,
      approvedFields,
    });
    const frameId = (queried.result as { dataFrameId: string }).dataFrameId;
    const command = cmd("DeleteNode", { id: tableId });

    await expect(
      app.call(
        "previewDiff",
        { commands: [command] },
        {
          wyStackApp: app,
          artifactDb: db,
          principal: { kind: "service", credentialId: "previewer" },
        },
      ),
    ).resolves.toBeDefined();
    const controller = createDraftController(app, db);
    const draftId = await controller.openDraft();
    await expect(
      controller.appendToDraft(draftId, [command], {
        principal: { kind: "service", credentialId: "drafter" },
      }),
    ).resolves.toBeDefined();

    expect(
      (await app.call("getDataTable", { id: tableId })).result,
    ).not.toBeNull();
    expect(await frameStorage.exists(frameId)).toBe(true);
    expect(
      (await app.call("getDataFrameEntry", { id: frameId })).result,
    ).not.toBeNull();
  });

  it("does not retain an orphan when import races table deletion", async () => {
    const id = await seedNotionSource();
    const tableId = await seedNotionTable(id);
    const [, removed] = await Promise.allSettled([
      app.call("queryNotionDatabase", {
        dataSourceId: id,
        databaseId: "db-1",
        tableId,
        snapshot: true,
        approvedFields,
      }),
      app.call("removeDataTable", { id: tableId }),
    ]);

    expect(removed.status).toBe("fulfilled");
    expect((await app.call("getDataTable", { id: tableId })).result).toBeNull();
    expect((await app.call("listDataFrames", {})).result).toEqual([]);
    expect(await frameStorage.list()).toEqual([]);
  });

  it("removes a server frame after DeleteNode commits", async () => {
    const id = await seedNotionSource();
    const tableId = await seedNotionTable(id);
    const queried = await app.call("queryNotionDatabase", {
      dataSourceId: id,
      databaseId: "db-1",
      tableId,
      snapshot: true,
      approvedFields,
    });
    const dataFrameId = (queried.result as { dataFrameId: string }).dataFrameId;

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

    expect(await frameStorage.exists(dataFrameId)).toBe(false);
    expect(flushSnapshot).toHaveBeenCalled();
    expect(unregisterServerFrames).toHaveBeenCalledWith([dataFrameId]);
    expect((await app.call("listDataFrames", {})).result).toEqual([]);
  });

  it("preserves a shared frame when one referencing DataTable is deleted", async () => {
    const id = await seedNotionSource();
    const ownerTableId = await seedNotionTable(id);
    const otherTableId = await seedNotionTable(id);
    const queried = await app.call("queryNotionDatabase", {
      dataSourceId: id,
      databaseId: "db-1",
      tableId: ownerTableId,
      snapshot: true,
      approvedFields,
    });
    const dataFrameId = (queried.result as { dataFrameId: string }).dataFrameId;
    await app.call("updateDataTable", {
      id: otherTableId,
      updates: { dataFrameId: dataFrameId },
    });

    await app.call(
      "commitBatch",
      { commands: [cmd("DeleteNode", { id: otherTableId })] },
      {
        wyStackApp: app,
        artifactDb: db,
        principal: { kind: "user", userId: LOCAL_USER_ID },
      },
    );

    expect(await frameStorage.exists(dataFrameId)).toBe(true);
    expect(
      (await app.call("getDataFrameEntry", { id: dataFrameId })).result,
    ).not.toBeNull();
    expect(
      (await app.call("getDataTable", { id: ownerTableId })).result,
    ).toMatchObject({ dataFrameId: dataFrameId });
  });

  it("removes a shared frame when its final referencing DataTable is deleted", async () => {
    const id = await seedNotionSource();
    const ownerTableId = await seedNotionTable(id);
    const otherTableId = await seedNotionTable(id);
    const queried = await app.call("queryNotionDatabase", {
      dataSourceId: id,
      databaseId: "db-1",
      tableId: ownerTableId,
      snapshot: true,
      approvedFields,
    });
    const dataFrameId = (queried.result as { dataFrameId: string }).dataFrameId;
    await app.call("updateDataTable", {
      id: otherTableId,
      updates: { dataFrameId: dataFrameId },
    });

    const context = {
      wyStackApp: app,
      artifactDb: db,
      principal: { kind: "user" as const, userId: LOCAL_USER_ID },
    };
    await app.call(
      "commitBatch",
      { commands: [cmd("DeleteNode", { id: ownerTableId })] },
      context,
    );

    expect(await frameStorage.exists(dataFrameId)).toBe(true);
    expect(
      (await app.call("getDataFrameEntry", { id: dataFrameId })).result,
    ).not.toBeNull();
    expect(
      (await app.call("getDataTable", { id: otherTableId })).result,
    ).toMatchObject({ dataFrameId: dataFrameId });

    await app.call(
      "commitBatch",
      { commands: [cmd("DeleteNode", { id: otherTableId })] },
      context,
    );

    expect(await frameStorage.exists(dataFrameId)).toBe(false);
    expect(
      (await app.call("getDataFrameEntry", { id: dataFrameId })).result,
    ).toBeNull();
    expect(unregisterServerFrames).toHaveBeenCalledWith([dataFrameId]);
  });

  it("retains staged bytes when the durable snapshot flush fails", async () => {
    const id = await seedNotionSource();
    const tableId = await seedNotionTable(id);
    const queried = await app.call("queryNotionDatabase", {
      dataSourceId: id,
      databaseId: "db-1",
      tableId,
      snapshot: true,
      approvedFields,
    });
    const dataFrameId = (queried.result as { dataFrameId: string }).dataFrameId;
    flushSnapshot.mockRejectedValue(new Error("injected snapshot failure"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await app.call(
      "removeDataFrameEntry",
      { id: dataFrameId },
      { flushSnapshot, flushSnapshotRetentionWindow: flushSnapshot },
    );

    expect(
      (await app.call("getDataFrameEntry", { id: dataFrameId })).result,
    ).toBeNull();
    expect(await frameStorage.exists(dataFrameId)).toBe(true);
    expect(
      (await app.call("getDataTable", { id: tableId })).result,
    ).toMatchObject({ dataFrameId: undefined });
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("leaving staged server frame deletes"),
      expect.any(Error),
    );
    const trash = await readdir(join(dir, "dataframes", ".trash"));
    expect(trash).toHaveLength(1);
    log.mockRestore();
  });

  it("reports a committed DeleteNode and schedules its snapshot when file cleanup must retry", async () => {
    const id = await seedNotionSource();
    const tableId = await seedNotionTable(id);
    const queried = await app.call("queryNotionDatabase", {
      dataSourceId: id,
      databaseId: "db-1",
      tableId,
      snapshot: true,
      approvedFields,
    });
    const dataFrameId = (queried.result as { dataFrameId: string }).dataFrameId;
    const onWrite = vi.fn();
    app = await buildDashframeApp({
      db,
      vault,
      dataFrameStorage: frameStorage,
      onWrite,
      flushSnapshot: async () => {},
      flushSnapshotRetentionWindow: async () => {},
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
    expect(await frameStorage.exists(dataFrameId)).toBe(true);
    expect((await app.call("listDataFrames", {})).result).toEqual([]);
    cleanup.mockRestore();

    app = await buildDashframeApp({
      db,
      vault,
      dataFrameStorage: frameStorage,
      flushSnapshotRetentionWindow: async () => {},
    });
    expect(await frameStorage.exists(dataFrameId)).toBe(false);
  });

  it("publishDraft reports success and continues snapshot scheduling when post-commit cleanup fails", async () => {
    const id = await seedNotionSource();
    const tableId = await seedNotionTable(id);
    const queried = await app.call("queryNotionDatabase", {
      dataSourceId: id,
      databaseId: "db-1",
      tableId,
      snapshot: true,
      approvedFields,
    });
    const frameId = (queried.result as { dataFrameId: string }).dataFrameId;
    const controller = createDraftController(app, db);
    const draftId = await controller.openDraft();
    await controller.appendToDraft(
      draftId,
      [cmd("DeleteNode", { id: tableId })],
      { principal: { kind: "user", userId: LOCAL_USER_ID } },
    );
    const cleanup = vi
      .spyOn(frameStorage, "delete")
      .mockRejectedValueOnce(new Error("injected publish cleanup failure"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    onWrite.mockClear();
    flushSnapshot.mockClear();

    await expect(
      app.call(
        "publishDraft",
        { draftId },
        { draftController: controller, onWrite },
      ),
    ).resolves.toBeDefined();
    expect((await app.call("getDataTable", { id: tableId })).result).toBeNull();
    expect((await app.call("listDataFrames", {})).result).toEqual([]);
    expect(await frameStorage.exists(frameId)).toBe(true);
    expect(onWrite).toHaveBeenCalled();
    expect(flushSnapshot).toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining(
        "dereferenced server frame(s) could not be removed",
      ),
      expect.any(Array),
    );
    cleanup.mockRestore();
    log.mockRestore();
  });

  it("reports a committed DeleteNode when the post-commit ownership query must retry", async () => {
    const id = await seedNotionSource();
    const tableId = await seedNotionTable(id);
    await app.call("queryNotionDatabase", {
      dataSourceId: id,
      databaseId: "db-1",
      tableId,
      snapshot: true,
      approvedFields,
    });
    const onWrite = vi.fn();
    const flushSnapshotRetentionWindow = vi.fn(async () => {});
    app = await buildDashframeApp({
      db,
      vault,
      dataFrameStorage: frameStorage,
      onWrite,
      flushSnapshot: async () => {},
      flushSnapshotRetentionWindow,
    });
    flushSnapshotRetentionWindow.mockRejectedValueOnce(
      new Error("injected post-commit snapshot failure"),
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

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
    expect((await app.call("getDataTable", { id: tableId })).result).toBeNull();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("snapshot flush failed"),
      expect.any(Error),
    );
    log.mockRestore();
  });

  it("starts with an unremovable orphan and retries it on the next startup", async () => {
    const orphan = "11111111-1111-4111-8111-111111111111";
    await frameStorage.save(orphan, new Uint8Array([1]));
    const cleanup = vi
      .spyOn(frameStorage, "delete")
      .mockRejectedValueOnce(new Error("injected startup cleanup failure"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      buildDashframeApp({
        db,
        vault,
        dataFrameStorage: frameStorage,
        flushSnapshotRetentionWindow: async () => {},
      }),
    ).resolves.toBeDefined();
    expect(await frameStorage.exists(orphan)).toBe(true);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("the next start will retry"),
      expect.any(Array),
    );

    cleanup.mockRestore();
    log.mockRestore();
    await buildDashframeApp({
      db,
      vault,
      dataFrameStorage: frameStorage,
      flushSnapshotRetentionWindow: async () => {},
    });
    expect(await frameStorage.exists(orphan)).toBe(false);
  });

  it("restores a staged frame when the metadata transaction fails", async () => {
    const id = await seedNotionSource();
    const tableId = await seedNotionTable(id);
    const queried = await app.call("queryNotionDatabase", {
      dataSourceId: id,
      databaseId: "db-1",
      tableId,
      snapshot: true,
      approvedFields,
    });
    const dataFrameId = (queried.result as { dataFrameId: string }).dataFrameId;
    await db.$client.exec(`
      CREATE FUNCTION fail_frame_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected transaction failure'; END $$;
      CREATE TRIGGER fail_frame_delete
      BEFORE DELETE ON data_frames
      FOR EACH ROW EXECUTE FUNCTION fail_frame_delete();
    `);

    await expect(app.call("removeDataTable", { id: tableId })).rejects.toThrow(
      'delete from "data_frames"',
    );
    await db.$client.exec(`DROP TRIGGER fail_frame_delete ON data_frames`);

    expect(await frameStorage.exists(dataFrameId)).toBe(true);
    expect(
      (await app.call("getDataFrameEntry", { id: dataFrameId })).result,
    ).toMatchObject({
      id: dataFrameId,
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
      snapshot: true,
      approvedFields,
    });
    const dataFrameId = (queried.result as { dataFrameId: string }).dataFrameId;
    await db.$client.exec(`
      CREATE FUNCTION fail_frame_insert() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected replacement failure'; END $$;
      CREATE TRIGGER fail_frame_insert
      BEFORE INSERT ON data_frames
      FOR EACH ROW EXECUTE FUNCTION fail_frame_insert();
    `);

    await expect(
      app.call("queryNotionDatabase", {
        dataSourceId: id,
        databaseId: "db-1",
        tableId,
        snapshot: true,
        approvedFields,
      }),
    ).rejects.toThrow('insert into "data_frames"');
    await db.$client.exec(`DROP TRIGGER fail_frame_insert ON data_frames`);

    expect(await frameStorage.list()).toEqual([dataFrameId]);
    expect(
      (await app.call("getDataTable", { id: tableId })).result,
    ).toMatchObject({ dataFrameId: dataFrameId });
    expect((await app.call("listDataFrames", {})).result).toHaveLength(1);
  });

  it("applies a fail-safe inspection bound when no preview limit is given", async () => {
    const id = await seedNotionSource();
    const tableId = await seedNotionTable(id);

    await app.call("queryNotionDatabase", {
      dataSourceId: id,
      databaseId: "db-1",
      tableId,
    });

    expect(queryCalls).toHaveLength(1);
    expect(queryCalls[0]?.options).toEqual({
      pagination: { offset: 0, limit: 100 },
    });
  });

  it("falls back to the inspection bound for a non-positive limit", async () => {
    const id = await seedNotionSource();
    const tableId = await seedNotionTable(id);

    await app.call("queryNotionDatabase", {
      dataSourceId: id,
      databaseId: "db-1",
      tableId,
      limit: 0,
    });

    expect(queryCalls).toHaveLength(1);
    expect(queryCalls[0]?.options).toEqual({
      pagination: { offset: 0, limit: 100 },
    });
  });
});
