import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tableFromIPC } from "apache-arrow";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { makeGa4Connector } from "@dashframe/connector-ga4";
import { NativeDuckDBEngine } from "@dashframe/engine-server";
import { NativeTableLifecycle } from "../native-tables";
import { FileDataFrameStorage } from "@dashframe/engine-server/file-dataframe-storage";
import type { PublicationMetadata } from "@dashframe/convex-backend/model";
import type { Field } from "@dashframe/types";
import type { HostContext } from "../context";

const factories = vi.hoisted(() => ({ ga4ConnectorFor: vi.fn() }));
vi.mock("../connectors", () => ({
  ...factories,
  notionConnectorFor: vi.fn(),
  postgresConnectorFor: vi.fn(),
}));
import { createProductionFetchExecutor } from "./production";
import { STREAM_BATCH_ROWS, supportsStreaming } from "./streaming";

const directories: string[] = [];
const engines: NativeDuckDBEngine[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const engine of engines.splice(0)) await engine.dispose();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function fixture(total = 25_007) {
  const directory = await mkdtemp(join(tmpdir(), "dashframe-streaming-"));
  directories.push(directory);
  const storage = new FileDataFrameStorage(directory);
  const engine = new NativeDuckDBEngine();
  engines.push(engine);
  await engine.initialize();
  const tableId = crypto.randomUUID();
  const sourceId = crypto.randomUUID();
  const fields: Field[] = [
    {
      id: crypto.randomUUID(),
      tableId,
      name: "key",
      columnName: "key",
      type: "string",
    },
    {
      id: crypto.randomUUID(),
      tableId,
      name: "value",
      columnName: "value",
      type: "number",
    },
  ];
  const table = {
    id: tableId,
    dataSourceId: sourceId,
    table: "properties/123",
    name: "Report",
    fields,
    metrics: [],
    createdAt: 0,
  };
  const publications: PublicationMetadata[] = [];
  const progress: Array<{ phase: string; rows: number; bytes: number }> = [];
  const controller = new AbortController();
  let pages = 0;
  let failAt = Infinity;
  let driftAt = Infinity;
  let cancelAt = Infinity;
  const fetchImpl = vi.fn(
    async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        offset: string;
        limit: string;
      };
      const offset = Number(request.offset);
      expect(Number(request.limit)).toBe(STREAM_BATCH_ROWS);
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      // The host must have consumed the previous page before another is fetched.
      if (pages > 0)
        expect(progress.at(-1)?.rows).toBeGreaterThanOrEqual(offset);
      pages++;
      if (offset >= cancelAt) controller.abort();
      init?.signal?.throwIfAborted();
      if (offset >= failAt) throw new Error("PRIVATE_PROVIDER_DETAIL");
      const rows = Array.from(
        { length: Math.min(STREAM_BATCH_ROWS, total - offset) },
        (_, i) => ({
          dimensionValues: [{ value: `key-${offset + i}` }],
          metricValues: [{ value: String(offset + i) }],
        }),
      );
      return new Response(
        JSON.stringify({
          dimensionHeaders: [{ name: offset >= driftAt ? "changed" : "key" }],
          metricHeaders: [{ name: "value" }],
          rows,
        }),
      );
    },
  );
  factories.ga4ConnectorFor.mockImplementation(async () =>
    makeGa4Connector(
      async (use) =>
        use(
          JSON.stringify({
            version: 1,
            accessToken: "fixture-token",
            refreshToken: "fixture-refresh",
            expiresAt: Date.now() + 3_600_000,
            clientId: "fixture",
            scopes: [],
          }),
        ),
      { fetch: fetchImpl as unknown as typeof fetch },
    ),
  );
  const ctx = {
    principal: { kind: "user", userId: "local-user" },
    requestSignal: controller.signal,
    dataFrameStorage: storage,
    dataPlaneRuntime: new NativeTableLifecycle(engine).engine,
    getServerEndpoint: () => undefined,
    onMaterializationProgress: (value: (typeof progress)[number]) =>
      progress.push(value),
    metadata: {
      getDataTable: async () => table,
      getDataSource: async () => ({
        id: sourceId,
        kind: "googleAnalytics",
        config: {},
      }),
      publishMaterialization: async (value: PublicationMetadata) => {
        publications.push(value);
      },
      getOperation: async () => null,
    },
  } as unknown as HostContext;
  const run = () =>
    createProductionFetchExecutor()({
      context: ctx,
      insight: { baseTableId: tableId, selectedFields: [], metrics: [] },
      target: { kind: "ephemeral" },
    });
  return {
    directory,
    storage,
    engine,
    ctx,
    fields,
    publications,
    progress,
    run,
    fail: (offset: number) => {
      failAt = offset;
    },
    drift: (offset: number) => {
      driftAt = offset;
    },
    cancel: (offset: number) => {
      cancelAt = offset;
    },
    pageCount: () => pages,
  };
}

describe("streaming production materialization", () => {
  it("keeps hosted contexts on their bounded worker protocol even with native capabilities", async () => {
    const f = await fixture(1);
    expect(supportsStreaming(f.ctx)).toBe(true);
    // Keep only the batch reader: the production selector must not require
    // the optional raw-stream reader as well.
    f.ctx.dataFrameStorage = {
      save: f.storage.save.bind(f.storage),
      load: f.storage.load.bind(f.storage),
      delete: f.storage.delete.bind(f.storage),
      exists: f.storage.exists.bind(f.storage),
      list: f.storage.list.bind(f.storage),
      getUsage: f.storage.getUsage.bind(f.storage),
      saveBatches: f.storage.saveBatches.bind(f.storage),
      loadBatches: f.storage.loadBatches.bind(f.storage),
    };
    expect(supportsStreaming(f.ctx)).toBe(true);
    expect(supportsStreaming({ ...f.ctx, workspaceOwnerId: "owner" })).toBe(
      false,
    );
    if (!f.ctx.dataPlaneRuntime) throw new Error("runtime missing");
    f.ctx.dataPlaneRuntime.nativeTransfer = false;
    expect(supportsStreaming(f.ctx)).toBe(false);
    f.ctx.dataPlaneRuntime.nativeTransfer = true;
  });
  it("retains complete files when publication acknowledgement is unknown", async () => {
    const f = await fixture(1);
    vi.spyOn(f.ctx.metadata, "publishMaterialization").mockRejectedValue(
      new Error("lost acknowledgement"),
    );
    await expect(f.run()).rejects.toThrow("FRAME_PUBLICATION_UNCONFIRMED");
    expect(await f.storage.list()).toHaveLength(2);
    expect(f.engine.getTableNames()).toHaveLength(2);
  });

  it("cleans source and result files if native result registration fails", async () => {
    const f = await fixture(1);
    const original = f.engine.registerArrowStream.bind(f.engine);
    let calls = 0;
    vi.spyOn(f.engine, "registerArrowStream").mockImplementation(
      async (...args) => {
        calls++;
        if (calls === 2) throw new Error("registration failed");
        await original(...args);
      },
    );
    await expect(f.run()).rejects.toThrow("registration failed");
    expect(await f.storage.list()).toEqual([]);
    expect(f.engine.getTableNames()).toEqual([]);
    expect(f.publications).toEqual([]);
  });

  it("publishes more than 10000 rows and rehydrates without whole-result APIs", async () => {
    const f = await fixture();
    vi.spyOn(f.storage, "save").mockRejectedValue(
      new Error("whole save forbidden"),
    );
    vi.spyOn(f.storage, "load").mockRejectedValue(
      new Error("whole load forbidden"),
    );
    vi.spyOn(f.engine, "queryArrow").mockRejectedValue(
      new Error("whole query forbidden"),
    );
    vi.spyOn(f.engine, "registerArrowTable").mockRejectedValue(
      new Error("whole register forbidden"),
    );
    const result = await f.run();
    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("not ready");
    expect(result.rowCount).toBe(25_007);
    expect(f.pageCount()).toBe(3);
    expect(f.publications).toHaveLength(1);
    expect(f.publications[0]?.sources[0]?.frame.rowCount).toBe(25_007);
    expect(JSON.stringify(f.publications)).not.toContain("fixture-token");
    expect(JSON.stringify(f.publications)).not.toContain("key-25006");
    expect(await f.storage.list()).toHaveLength(2);
    let rows = 0,
      largestBatch = 0;
    for await (const arrow of f.storage.loadBatches(result.dataFrameId)) {
      const batchRows = tableFromIPC(arrow).numRows;
      rows += batchRows;
      largestBatch = Math.max(largestBatch, batchRows);
    }
    expect(rows).toBe(25_007);
    expect(largestBatch).toBeLessThanOrEqual(2048);
    const fresh = new NativeDuckDBEngine();
    engines.push(fresh);
    await fresh.registerArrowBatches(
      "restored",
      f.storage.loadBatches(result.dataFrameId),
    );
    const summary = tableFromIPC(
      await fresh.queryArrow("SELECT count(*) AS n FROM restored"),
    );
    expect(Number(summary.getChild("n")?.get(0))).toBe(25_007);
  });

  it.each(["failure", "drift", "cancellation"] as const)(
    "does not publish a prefix on late %s",
    async (kind) => {
      const f = await fixture();
      if (kind === "failure") f.fail(12_000);
      if (kind === "drift") f.drift(12_000);
      if (kind === "cancellation") f.cancel(12_000);
      const message = {
        failure: "FETCH_EXECUTION_FAILED",
        drift: "SOURCE_SCHEMA_CHANGED",
        cancellation: undefined,
      }[kind];
      await expect(f.run()).rejects.toThrow(message);
      expect(f.publications).toHaveLength(0);
      expect(await readdir(f.directory)).toEqual([]);
      expect(f.engine.getTableNames()).toEqual([]);
    },
  );

  it.each([0, 12_000])(
    "preserves schema for %i rows including an empty terminal page",
    async (rows) => {
      const f = await fixture(rows);
      const result = await f.run();
      expect(result).toMatchObject({ status: "ready", rowCount: rows });
      expect(f.publications[0]?.result.schema).toHaveLength(2);
    },
  );
});
