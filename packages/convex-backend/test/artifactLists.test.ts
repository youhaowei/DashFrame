import { beforeEach, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { COMMAND_PATHS } from "@dashframe/types";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { listAll } from "./listAll";

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

const page = (numItems: number, cursor: string | null = null) => ({
  paginationOpts: { cursor, numItems },
});

async function seedTables(count: number, dataSourceId = "source") {
  const ids = Array.from({ length: count }, () => crypto.randomUUID());
  await t.run(async (ctx) => {
    for (const [index, id] of ids.entries())
      await ctx.db.insert("dataTables", {
        workspaceId: "w",
        id,
        revision: 1,
        name: `Table ${index}`,
        createdAt: index,
        dataSourceId,
        table: `t${index}`,
        fields: [],
        metrics: [],
      });
  });
  return ids;
}

it("lists more than 1000 data tables across pages instead of refusing", async () => {
  const ids = await seedTables(1001);

  const first = await user().query(api.app.listDataTables, page(1001));
  // A request past the page cap is clamped rather than refused.
  expect(first.page).toHaveLength(500);
  expect(first.isDone).toBe(false);

  // A request for no rows still advances by one, so a reader never spins.
  const one = await user().query(api.app.listDataTables, page(0));
  expect(one.page).toHaveLength(1);
  expect(one.isDone).toBe(false);

  const all = await listAll(user(), api.app.listDataTables, {}, 500);
  expect(all).toHaveLength(1001);
  expect(new Set(all.map((row) => row.id))).toEqual(new Set(ids));
}, 20_000);

it("keeps the index and secondary filters across pages", async () => {
  await t.run(async (ctx) => {
    for (let index = 0; index < 9; index++)
      await ctx.db.insert("dataSources", {
        workspaceId: "w",
        id: `source-${index}`,
        revision: 1,
        name: `Source ${index}`,
        createdAt: index,
        kind: "csv",
        dataSourceId: index < 5 ? "a" : "b",
        insightId: index % 2 === 0 ? "even" : "odd",
      });
  });
  const ids = (rows: { id: string }[]) => rows.map((row) => row.id).sort();

  expect(
    ids(
      await listAll(user(), api.app.listDataSources, { dataSourceId: "a" }, 2),
    ),
  ).toEqual(["source-0", "source-1", "source-2", "source-3", "source-4"]);
  expect(
    ids(
      await listAll(
        user(),
        api.app.listDataSources,
        { dataSourceId: "a", insightId: "odd" },
        2,
      ),
    ),
  ).toEqual(["source-1", "source-3"]);
  expect(
    ids(
      await listAll(user(), api.app.listDataSources, { insightId: "odd" }, 2),
    ),
  ).toEqual(["source-1", "source-3", "source-5", "source-7"]);
  expect(
    ids(
      await listAll(
        user(),
        api.app.listDataSources,
        { excludeIds: ["source-0", "source-1", "source-6"] },
        2,
      ),
    ),
  ).toEqual([
    "source-2",
    "source-3",
    "source-4",
    "source-5",
    "source-7",
    "source-8",
  ]);
  // A page whose rows are all excluded comes back empty but not done, so the
  // client keeps following the cursor instead of stopping short.
  const emptied = await user().query(api.app.listDataSources, {
    excludeIds: ["source-0", "source-1"],
    ...page(2),
  });
  expect(emptied.page).toEqual([]);
  expect(emptied.isDone).toBe(false);
});

it("serves a draft's view of the list as one finished page", async () => {
  await t.run(async (ctx) => {
    for (let index = 0; index < 3; index++)
      await ctx.db.insert("dataSources", {
        workspaceId: "w",
        id: `source-${index}`,
        revision: 1,
        name: `Source ${index}`,
        createdAt: index,
        kind: "csv",
        config: {},
      });
  });
  const draftedId = crypto.randomUUID();
  const { draftId } = await user().mutation(api.app.draftBatch, {
    commands: [
      {
        path: COMMAND_PATHS.CreateDataSource,
        args: { id: draftedId, name: "Drafted", type: "csv" },
      },
    ],
  });

  const drafted = await user().query(api.app.listDataSources, {
    draftId,
    ...page(1),
  });
  expect(drafted.isDone).toBe(true);
  expect(drafted.page.map((row) => row.id).sort()).toEqual(
    [draftedId, "source-0", "source-1", "source-2"].sort(),
  );
  expect(
    await listAll(user(), api.app.listDataSources, { draftId }, 1),
  ).toHaveLength(4);
  expect(await listAll(user(), api.app.listDataSources, {}, 1)).toHaveLength(3);
});

it("answers a cursor past a draft's one page with nothing more, after checking the draft", async () => {
  await t.run(async (ctx) => {
    await ctx.db.insert("dataSources", {
      workspaceId: "w",
      id: "source-0",
      revision: 1,
      name: "Source 0",
      createdAt: 0,
      kind: "csv",
      config: {},
    });
  });
  const { draftId } = await user().mutation(api.app.draftBatch, {
    commands: [
      {
        path: COMMAND_PATHS.CreateDataSource,
        args: { id: crypto.randomUUID(), name: "Drafted", type: "csv" },
      },
    ],
  });
  const past = await user().query(api.app.listDataSources, {
    draftId,
    ...page(1, "past"),
  });
  expect(past).toEqual({ page: [], isDone: true, continueCursor: "" });
  // The draft is still checked before a cursor past its page is answered.
  await expect(
    user().query(api.app.listDataSources, {
      draftId: crypto.randomUUID(),
      ...page(1, "past"),
    }),
  ).rejects.toThrow();
});

it("serves a draft's frames whole, or through their index when filtered", async () => {
  const insightId = crypto.randomUUID();
  await t.run(async (ctx) => {
    for (let index = 0; index < 3; index++) {
      const id = crypto.randomUUID();
      await ctx.db.insert("dataFrames", {
        workspaceId: "w",
        id,
        revision: 1,
        name: `Frame ${index}`,
        createdAt: index,
        storage: { type: "file", key: id },
        fieldIds: [],
        ...(index === 0 ? { insightId } : {}),
      });
    }
  });
  const { draftId } = await user().mutation(api.app.draftBatch, {
    commands: [
      {
        path: COMMAND_PATHS.CreateDataSource,
        args: { id: crypto.randomUUID(), name: "Drafted", type: "csv" },
      },
    ],
  });

  const whole = await user().query(api.app.listDataFrames, {
    draftId,
    ...page(1),
  });
  expect(whole.isDone).toBe(true);
  expect(whole.page).toHaveLength(3);
  const filtered = await listAll(
    user(),
    api.app.listDataFrames,
    { draftId, insightId },
    1,
  );
  expect(filtered.map((row) => row.insightId)).toEqual([insightId]);
});
