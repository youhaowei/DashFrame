import { beforeEach, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { listAll } from "./listAll";
import { cmd } from "@dashframe/types";
const modules = import.meta.glob("../convex/**/*.ts");
const makeTest = () => convexTest(schema, modules);
let t: ReturnType<typeof makeTest>;
beforeEach(() => {
  t = makeTest();
});
const identity = {
  subject: "u",
  workspaceId: "w",
  principalKind: "user",
  userId: "u",
};
const request = {
  workspaceId: "w",
  operationId: "import-1",
  requestHash: "a".repeat(64),
};
async function seed() {
  const sourceId = crypto.randomUUID(),
    tableId = crypto.randomUUID();
  await t.withIdentity(identity).mutation(api.app.commitBatch, {
    commands: [
      cmd("CreateDataSource", { id: sourceId, name: "S", type: "csv" }),
      cmd("CreateDataTable", {
        id: tableId,
        dataSourceId: sourceId,
        name: "T",
        table: "t.csv",
      }),
    ],
  });
  return { sourceId, tableId };
}
function frameCommit(
  sourceId: string,
  tableId: string,
  claim: { frameId: string; fetchedAt: number },
  expectedDataFrameId: string | null = null,
) {
  return {
    ...request,
    dataSourceId: sourceId,
    dataTableId: tableId,
    expectedDataFrameId,
    frameRow: {
      id: claim.frameId,
      name: "F",
      storage: { type: "file", key: claim.frameId },
      fieldIds: [],
      rowCount: 3,
      columnCount: 0,
      lastRefreshedAt: claim.fetchedAt,
    },
    tableUpdate: { dataFrameId: claim.frameId, lastFetchedAt: claim.fetchedAt },
  };
}
it("completes with metadata atomically and returns the original result after a newer import advances the pointer", async () => {
  const { sourceId, tableId } = await seed(),
    first = await t.mutation(internal.host.beginLocalImport, request);
  const firstCommit = frameCommit(sourceId, tableId, first);
  await t.mutation(internal.host.commitImportedFrame, firstCommit);
  const complete = await t.query(internal.host.getLocalImport, request);
  expect(complete).toEqual({
    ...first,
    status: "complete",
    result: {
      dataFrameId: first.frameId,
      rowCount: 3,
      columnCount: 0,
      fetchedAt: first.fetchedAt,
    },
  });
  expect(await t.mutation(internal.host.cancelLocalImport, request)).toBe(
    false,
  );
  const nextRequest = {
      ...request,
      operationId: "import-2",
      requestHash: "b".repeat(64),
    },
    second = await t.mutation(internal.host.beginLocalImport, nextRequest);
  await t.mutation(internal.host.commitImportedFrame, {
    ...frameCommit(sourceId, tableId, second, first.frameId),
    ...nextRequest,
  });
  await t.mutation(internal.host.commitImportedFrame, firstCommit);
  expect(await t.mutation(internal.host.beginLocalImport, request)).toEqual(
    complete,
  );
  expect(
    (
      await t
        .withIdentity(identity)
        .query(api.app.getDataTable, { id: tableId })
    )?.dataFrameId,
  ).toBe(second.frameId);
  expect(
    await listAll(t.withIdentity(identity), api.app.listDataFrames, {}),
  ).toHaveLength(2);
});
it("rejects an unclaimed import, mismatched frame, timestamp, hash, and invalid row counts", async () => {
  const { sourceId, tableId } = await seed(),
    claim = await t.mutation(internal.host.beginLocalImport, request),
    base = frameCommit(sourceId, tableId, claim);
  await expect(
    t.mutation(internal.host.commitImportedFrame, {
      ...base,
      operationId: "missing",
    }),
  ).rejects.toThrow("claim missing");
  await expect(
    t.mutation(internal.host.commitImportedFrame, {
      ...base,
      requestHash: "b".repeat(64),
    }),
  ).rejects.toThrow("different request");
  await expect(
    t.mutation(internal.host.commitImportedFrame, {
      ...base,
      frameRow: { ...base.frameRow, id: crypto.randomUUID() },
    }),
  ).rejects.toThrow("frame differs");
  await expect(
    t.mutation(internal.host.commitImportedFrame, {
      ...base,
      tableUpdate: { ...base.tableUpdate, lastFetchedAt: claim.fetchedAt + 1 },
    }),
  ).rejects.toThrow("timestamp differs");
  await expect(
    t.mutation(internal.host.commitImportedFrame, {
      ...base,
      frameRow: { ...base.frameRow, rowCount: -1 },
    }),
  ).rejects.toThrow("Invalid imported rowCount");
  expect((await t.query(internal.host.getLocalImport, request))?.status).toBe(
    "pending",
  );
});
