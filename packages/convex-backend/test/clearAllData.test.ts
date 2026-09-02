import { beforeEach, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { cmd } from "@dashframe/types";
const modules = import.meta.glob("../convex/**/*.ts");
const makeTest = () => convexTest(schema, modules);
let t: ReturnType<typeof makeTest>;
beforeEach(() => {
  t = makeTest();
});
const user = (workspaceId = "w", userId = "u") =>
  t.withIdentity({
    subject: userId,
    workspaceId,
    principalKind: "user",
    userId,
  });
async function seed(
  workspaceId = "w",
  sourceId = crypto.randomUUID(),
  tableId = crypto.randomUUID(),
) {
  await user(workspaceId).mutation(api.app.commitBatch, {
    commands: [
      cmd("CreateDataSource", { id: sourceId, name: "Source", type: "csv" }),
      cmd("CreateDataTable", {
        id: tableId,
        dataSourceId: sourceId,
        name: "Table",
        table: "t.csv",
      }),
    ],
  });
  return { sourceId, tableId };
}
it("clears all workspace drafts with canonical data without touching another workspace", async () => {
  await seed();
  await seed("other");
  const { draftId } = await user().mutation(api.app.draftBatch, {
    commands: [
      cmd("CreateDataSource", {
        id: crypto.randomUUID(),
        name: "Draft source",
        type: "csv",
      }),
    ],
  });
  const review = await user().query(api.app.draftPublishReview, { draftId });
  await user("w", "another-user").mutation(api.app.draftBatch, {
    commands: [
      cmd("CreateDataSource", {
        id: crypto.randomUUID(),
        name: "Another draft",
        type: "csv",
      }),
    ],
  });
  const foreign = await user("other").mutation(api.app.draftBatch, {
    commands: [
      cmd("CreateDataSource", {
        id: crypto.randomUUID(),
        name: "Foreign draft",
        type: "csv",
      }),
    ],
  });
  await t.mutation(internal.host.clearAllData, { workspaceId: "w" });
  expect(await user().query(api.app.listDataSources, {})).toEqual([]);
  expect(await user().query(api.app.listDrafts, {})).toEqual([]);
  expect(await user("w", "another-user").query(api.app.listDrafts, {})).toEqual(
    [],
  );
  await expect(
    user().mutation(api.app.publishDraft, {
      draftId,
      expectedRevision: review.revision,
      expectedCommandCount: review.commandCount,
      expectedLogSignature: review.logSignature,
    }),
  ).rejects.toThrow("Draft unavailable");
  await t.run(async (ctx) => {
    for (const table of ["drafts", "draftLog", "draftChanges"] as const) {
      const rows = await ctx.db.query(table).collect();
      expect(rows.filter((row) => row.workspaceId === "w")).toEqual([]);
      expect(
        rows.filter((row) => row.workspaceId === "other"),
      ).not.toHaveLength(0);
    }
  });
  expect(await user("other").query(api.app.listDataSources, {})).toHaveLength(
    1,
  );
  await user("other").mutation(api.app.publishDraft, {
    draftId: foreign.draftId,
  });
});
it("rolls back a clear that exceeds its bounded draft scan", async () => {
  await seed();
  await t.run(async (ctx) => {
    for (let i = 0; i < 1001; i++)
      await ctx.db.insert("draftLog", {
        workspaceId: "w",
        draftId: "oversized",
        sequence: i,
        command: { path: "createDataSource", args: {} },
      });
  });
  await expect(
    t.mutation(internal.host.clearAllData, { workspaceId: "w" }),
  ).rejects.toThrow("Workspace limit exceeded");
  expect(await user().query(api.app.listDataSources, {})).toHaveLength(1);
});
it.each([false, true])(
  "invalidates a local import claim across a clear (completed=%s)",
  async (completed) => {
    const { sourceId, tableId } = await seed();
    const request = {
      workspaceId: "w",
      operationId: "import-one",
      requestHash: "a".repeat(64),
    };
    const claim = await t.mutation(internal.host.beginLocalImport, request);
    const commit = {
      ...request,
      dataSourceId: sourceId,
      dataTableId: tableId,
      expectedDataFrameId: null,
      frameRow: {
        id: claim.frameId,
        name: "Imported",
        storage: { type: "file", key: claim.frameId },
        fieldIds: [],
        rowCount: 0,
        columnCount: 0,
        lastRefreshedAt: claim.fetchedAt,
      },
      tableUpdate: {
        dataFrameId: claim.frameId,
        lastFetchedAt: claim.fetchedAt,
      },
    };
    if (completed) await t.mutation(internal.host.commitImportedFrame, commit);
    const foreign = await t.mutation(internal.host.beginLocalImport, {
      ...request,
      workspaceId: "other",
    });
    await t.mutation(internal.host.clearAllData, { workspaceId: "w" });
    await seed("w", sourceId, tableId);
    await expect(
      t.mutation(internal.host.commitImportedFrame, commit),
    ).rejects.toThrow("invalidated");
    await expect(
      t.mutation(internal.host.beginLocalImport, request),
    ).rejects.toThrow("invalidated");
    await expect(
      t.query(internal.host.getLocalImport, request),
    ).rejects.toThrow("invalidated");
    expect(await user().query(api.app.listDataFrames, {})).toEqual([]);
    expect(
      await t.query(internal.host.getLocalImport, {
        ...request,
        workspaceId: "other",
      }),
    ).toEqual(foreign);
  },
);
