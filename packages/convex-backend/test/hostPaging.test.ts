import { beforeEach, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { cmd } from "@dashframe/types";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { DataFramePage } from "../convex/model";
import { DRAFT_COMMAND_LIMIT, draftChanges, log } from "../convex/store";

const modules = import.meta.glob("../convex/**/*.ts");
const makeTest = () => convexTest(schema, modules);
let t: ReturnType<typeof makeTest>;
beforeEach(() => {
  t = makeTest();
});
const user = () =>
  t.withIdentity({
    subject: "u",
    workspaceId: "w",
    principalKind: "user",
    userId: "u",
  });
async function insertFrame(
  ctx: Parameters<Parameters<typeof t.run>[0]>[0],
  extra: Record<string, unknown> = {},
) {
  const id = crypto.randomUUID();
  await ctx.db.insert("dataFrames", {
    workspaceId: "w",
    id,
    revision: 1,
    name: "Frame",
    createdAt: Date.now(),
    storage: { type: "file", key: id },
    fieldIds: [],
    ...extra,
  });
  return id;
}

it("pages every frame and an insight's frames past 1,000 rows", async () => {
  const insightId = crypto.randomUUID();
  await t.run(async (ctx) => {
    for (let index = 0; index < 1001; index++) {
      await insertFrame(ctx, { insightId });
      await insertFrame(ctx);
    }
    await insertFrame(ctx, { workspaceId: "other", insightId });
  });
  const ids = new Set<string>();
  let cursor: string | null = null,
    pages = 0;
  for (;;) {
    const result: DataFramePage = await t.query(internal.host.listDataFrames, {
      workspaceId: "w",
      paginationOpts: { cursor, numItems: 500 },
    });
    pages += 1;
    for (const row of result.page) ids.add(row.id);
    if (result.isDone) break;
    cursor = result.continueCursor;
  }
  expect(pages).toBeGreaterThan(1);
  expect(ids.size).toBe(2002);
  const byInsight = new Set<string>();
  cursor = null;
  for (;;) {
    const result: DataFramePage = await t.query(
      internal.host.listDataFramesByInsight,
      {
        workspaceId: "w",
        insightId,
        paginationOpts: { cursor, numItems: 500 },
      },
    );
    for (const row of result.page) {
      expect(row.insightId).toBe(insightId);
      byInsight.add(row.id);
    }
    if (result.isDone) break;
    cursor = result.continueCursor;
  }
  expect(byInsight.size).toBe(1001);
}, 60_000);

it("caps a requested frame page at 500 rows", async () => {
  await t.run(async (ctx) => {
    for (let index = 0; index < 501; index++) await insertFrame(ctx);
  });
  const result = await t.query(internal.host.listDataFrames, {
    workspaceId: "w",
    paginationOpts: { cursor: null, numItems: 5000 },
  });
  expect(result.page).toHaveLength(500);
  expect(result.isDone).toBe(false);
}, 30_000);

it("removes a frame through the table index with more than 1,000 tables present", async () => {
  const sourceId = crypto.randomUUID(),
    frameId = crypto.randomUUID(),
    ownerId = crypto.randomUUID();
  await t.run(async (ctx) => {
    await ctx.db.insert("dataSources", {
      workspaceId: "w",
      id: sourceId,
      revision: 1,
      name: "Source",
      createdAt: 1,
      kind: "csv",
      config: {},
    });
    await ctx.db.insert("dataFrames", {
      workspaceId: "w",
      id: frameId,
      revision: 1,
      name: "Owned frame",
      createdAt: 1,
      storage: { type: "file", key: frameId },
      fieldIds: [],
      definitionId: ownerId,
      sourceId,
    });
    for (let index = 0; index < 1001; index++)
      await ctx.db.insert("dataTables", {
        workspaceId: "w",
        id: index === 0 ? ownerId : crypto.randomUUID(),
        revision: 1,
        name: `Table ${index}`,
        createdAt: index,
        dataSourceId: sourceId,
        table: `t${index}`,
        fields: [],
        metrics: [],
        dataFrameId: index === 0 ? frameId : crypto.randomUUID(),
        lastFetchedAt: 1,
      });
  });
  await t.mutation(internal.host.removeDataFrame, {
    workspaceId: "w",
    id: frameId,
  });
  expect(
    await t.query(internal.host.getDataFrame, {
      workspaceId: "w",
      id: frameId,
    }),
  ).toBeNull();
  const tables = await t.run((ctx) =>
    ctx.db
      .query("dataTables")
      .withIndex("by_workspaceId_and_id", (q) => q.eq("workspaceId", "w"))
      .collect(),
  );
  expect(tables).toHaveLength(1001);
  const owner = tables.find((row) => row.id === ownerId);
  expect(owner).toMatchObject({
    dataFrameId: null,
    lastFetchedAt: null,
    revision: 2,
  });
  expect(
    tables
      .filter((row) => row.id !== ownerId)
      .every((row) => row.revision === 1),
  ).toBe(true);
  expect(
    (
      await t.query(internal.host.listCleanup, {
        workspaceId: "w",
        paginationOpts: { cursor: null, numItems: 10 },
      })
    ).page.map((job) => job.resourceId),
  ).toEqual([frameId]);
}, 60_000);

it("reads a draft's changes whole past 1,000 rows and refuses a log past the command limit", async () => {
  const draftId = crypto.randomUUID();
  await t.run(async (ctx) => {
    await ctx.db.insert("drafts", {
      workspaceId: "w",
      draftId,
      owner: "user:u",
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
      commandCount: 1,
    });
    for (let index = 0; index < 1001; index++) {
      const id = crypto.randomUUID();
      await ctx.db.insert("draftChanges", {
        workspaceId: "w",
        draftId,
        table: "dataSources",
        id,
        base: null,
        value: {
          workspaceId: "w",
          id,
          revision: 1,
          name: `Draft source ${index}`,
          createdAt: 1,
          kind: "csv",
          config: {},
        },
      });
    }
    for (let sequence = 0; sequence <= DRAFT_COMMAND_LIMIT; sequence++)
      await ctx.db.insert("draftLog", {
        workspaceId: "w",
        draftId,
        sequence,
        command: { path: "createDataSource", args: {} },
      });
  });
  expect(await t.run((ctx) => draftChanges(ctx, "w", draftId))).toHaveLength(
    1001,
  );
  await expect(t.run((ctx) => log(ctx, "w", draftId))).rejects.toThrow(
    "Draft log exceeds the draft command limit",
  );
  // The limit the guard asserts is the one `replaceDraft` enforces: two
  // appends that each fit a batch still cannot push a draft past it.
  expect(DRAFT_COMMAND_LIMIT).toBe(200);
  const half = () =>
    Array.from({ length: DRAFT_COMMAND_LIMIT / 2 + 1 }, () =>
      cmd("CreateDataSource", {
        id: crypto.randomUUID(),
        name: "Source",
        type: "csv",
      }),
    );
  const opened = await user().mutation(api.app.draftBatch, {
    commands: half(),
  });
  await expect(
    user().mutation(api.app.draftBatch, {
      draftId: opened.draftId,
      commands: half(),
    }),
  ).rejects.toThrow(`Draft is limited to ${DRAFT_COMMAND_LIMIT} commands`);
}, 60_000);
