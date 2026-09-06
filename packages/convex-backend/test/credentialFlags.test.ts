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
it.each([
  ["apiKey", "hasApiKey"],
  ["connectionString", "hasConnectionString"],
] as const)(
  "reserves derived credential flag %s/%s and ignores forged stored flags",
  async (credential, flag) => {
    const { sourceId } = await seed();
    const ref = `secret:${crypto.randomUUID()}`;
    await t.mutation(internal.host.commitBatch, {
      workspaceId: "w",
      principal: { kind: "user", userId: "u" },
      commands: [
        {
          path: "setDataSourceConfig",
          args: { id: sourceId, [credential]: ref },
        },
      ],
    });
    await expect(
      t.mutation(internal.host.commitBatch, {
        workspaceId: "w",
        principal: { kind: "user", userId: "u" },
        commands: [
          {
            path: "setDataSourceConfig",
            args: { id: sourceId, [credential]: ref, extra: { [flag]: false } },
          },
        ],
      }),
    ).rejects.toThrow("extra");
    await expect(
      user().mutation(api.app.commitBatch, {
        commands: [
          cmd("SetDataSourceConfig", {
            id: sourceId,
            extra: { [flag]: false },
          }),
        ],
      }),
    ).rejects.toThrow("extra");
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("dataSources")
        .withIndex("by_workspaceId_and_id", (q) =>
          q.eq("workspaceId", "w").eq("id", sourceId),
        )
        .unique();
      if (!row) throw new Error("Missing test source");
      await ctx.db.patch(row._id, { config: { ...row.config, [flag]: false } });
    });
    const dto = await user().query(api.app.getDataSource, { id: sourceId });
    expect(dto?.config).toHaveProperty(flag, true);
    expect(JSON.stringify(dto)).not.toContain(ref);
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("dataSources")
        .withIndex("by_workspaceId_and_id", (q) =>
          q.eq("workspaceId", "w").eq("id", sourceId),
        )
        .unique();
      if (!row) throw new Error("Missing test source");
      await ctx.db.patch(row._id, { config: { [flag]: true } });
    });
    expect(
      (await user().query(api.app.getDataSource, { id: sourceId }))?.config,
    ).toHaveProperty(flag, false);
  },
);
