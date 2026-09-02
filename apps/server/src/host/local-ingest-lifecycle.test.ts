/// <reference types="vite/client" />
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it } from "vite-plus/test";
import schema from "@dashframe/convex-backend/schema";
import type { LocalConvex } from "@dashframe/convex-local";
import { csvToDataFrame, parseCSV } from "@dashframe/csv";
import type { DataFrameStorage } from "@dashframe/engine";
import { FileDataFrameStorage } from "@dashframe/engine-server/file-dataframe-storage";
import { cmd } from "@dashframe/types";

import type { HostContext } from "./context";
import { createHostMetadata } from "./convex-metadata";
import { ingestLocalDataFrame } from "./local-ingest";
import { HostResourceCleanup } from "./resource-cleanup";

const modules = import.meta.glob(
  "../../../../packages/convex-backend/convex/**/*.ts",
);

let directory: string;
let native: ReturnType<typeof convexTest>;
let storage: FileDataFrameStorage;
let cleanup: HostResourceCleanup;
let context: HostContext;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "local-import-race-"));
  native = convexTest(schema, modules);
  storage = new FileDataFrameStorage(directory);
  context = {
    principal: { kind: "user", userId: "u" },
    metadata: createHostMetadata(
      {
        query: native.query,
        mutation: native.mutation,
      } as unknown as LocalConvex["internalClient"],
      "w",
    ),
    dataFrameStorage: storage,
    getServerEndpoint: () => undefined,
  };
  cleanup = new HostResourceCleanup(context);
  context.cleanupResources = () => cleanup.run();
});

afterEach(async () => {
  await cleanup.close();
  await rm(directory, { recursive: true, force: true });
});

it("cancels and reclaims the losing reservation after a frame publication race", async () => {
  const sourceId = crypto.randomUUID();
  const tableId = crypto.randomUUID();
  const converted = await csvToDataFrame(
    parseCSV("name,value\nalpha,1\nbeta,2\n"),
    tableId,
  );
  await context.metadata.commitBatch(context.principal, [
    cmd("CreateDataSource", {
      id: sourceId,
      name: "Local",
      type: "local",
    }),
    cmd("CreateDataTable", {
      id: tableId,
      dataSourceId: sourceId,
      name: "Values",
      table: "values.csv",
      fields: converted.fields,
      sourceSchema: converted.sourceSchema,
      metrics: [],
    }),
  ]);
  const request = {
    dataTableId: tableId,
    arrowBase64: Buffer.from(converted.arrowBuffer).toString("base64"),
  };
  context.dataFrameStorage = synchronizeSaves(storage, 2);

  const outcomes = await Promise.allSettled([
    ingestLocalDataFrame(context, {
      ...request,
      operationId: crypto.randomUUID(),
    }),
    ingestLocalDataFrame(context, {
      ...request,
      operationId: crypto.randomUUID(),
    }),
  ]);

  const fulfilled = outcomes.filter(
    (outcome) => outcome.status === "fulfilled",
  );
  const rejected = outcomes.filter(
    (outcome): outcome is PromiseRejectedResult =>
      outcome.status === "rejected",
  );
  expect(fulfilled).toHaveLength(1);
  expect(rejected).toHaveLength(1);
  expect(rejected[0]!.reason).toMatchObject({
    message: "SOURCE_BINDING_CHANGED",
  });
  const winner = fulfilled[0];
  if (!winner) throw new Error("Expected one completed import");

  const imports = await native.run(async (ctx) =>
    ctx.db.query("localImports").collect(),
  );
  expect(imports).toHaveLength(1);
  expect(imports[0]).toMatchObject({
    status: "complete",
    frameId: winner.value.dataFrameId,
  });
  expect(await storage.list()).toEqual([winner.value.dataFrameId]);
});

it("cancels a stale replacement claim before any frame bytes are saved", async () => {
  const sourceId = crypto.randomUUID();
  const tableId = crypto.randomUUID();
  const converted = await csvToDataFrame(
    parseCSV("name,value\nalpha,1\nbeta,2\n"),
    tableId,
  );
  await context.metadata.commitBatch(context.principal, [
    cmd("CreateDataSource", {
      id: sourceId,
      name: "Local",
      type: "local",
    }),
    cmd("CreateDataTable", {
      id: tableId,
      dataSourceId: sourceId,
      name: "Values",
      table: "values.csv",
      fields: converted.fields,
      sourceSchema: converted.sourceSchema,
      metrics: [],
    }),
  ]);
  const request = {
    dataTableId: tableId,
    arrowBase64: Buffer.from(converted.arrowBuffer).toString("base64"),
  };
  const beginLocalImport = context.metadata.beginLocalImport.bind(
    context.metadata,
  );
  let firstClaim = true;
  let releaseLoser = () => {};
  const winnerCommitted = new Promise<void>((resolve) => {
    releaseLoser = resolve;
  });
  let announceLoserClaim = () => {};
  const loserClaimed = new Promise<void>((resolve) => {
    announceLoserClaim = resolve;
  });
  context.metadata.beginLocalImport = async (input) => {
    const claim = await beginLocalImport(input);
    if (firstClaim) {
      firstClaim = false;
      announceLoserClaim();
      await winnerCommitted;
    }
    return claim;
  };

  const loser = ingestLocalDataFrame(context, {
    ...request,
    replacement: {
      expectedDataFrameId: null,
      name: "Values",
      table: "values.csv",
      sourceSchema: converted.sourceSchema,
      fields: converted.fields,
      metrics: [],
    },
    operationId: crypto.randomUUID(),
  });
  await loserClaimed;
  const winner = await ingestLocalDataFrame(context, {
    ...request,
    operationId: crypto.randomUUID(),
  });
  const loserRejected = expect(loser).rejects.toThrow(
    "STALE_LOCAL_REPLACEMENT",
  );
  releaseLoser();
  await loserRejected;

  const imports = await native.run(async (ctx) =>
    ctx.db.query("localImports").collect(),
  );
  expect(imports).toHaveLength(1);
  expect(imports[0]).toMatchObject({
    status: "complete",
    frameId: winner.dataFrameId,
  });
  expect(await storage.list()).toEqual([winner.dataFrameId]);
});

function synchronizeSaves(
  underlying: FileDataFrameStorage,
  expectedSaves: number,
): DataFrameStorage {
  let saved = 0;
  let release = () => {};
  const bothSaved = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    async save(id, data) {
      await underlying.save(id, data);
      saved += 1;
      if (saved === expectedSaves) release();
      await bothSaved;
    },
    load: (id) => underlying.load(id),
    delete: (id) => underlying.delete(id),
    exists: (id) => underlying.exists(id),
    list: () => underlying.list(),
    getUsage: () => underlying.getUsage(),
  };
}
