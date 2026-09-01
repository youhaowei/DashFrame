import { beforeEach, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { COMMAND_PATHS } from "@dashframe/types";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";

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

it("keeps a workspace with 1001 data frames listable and repairable", async () => {
  const frameIds = Array.from({ length: 1001 }, () => crypto.randomUUID());
  await t.run(async (ctx) => {
    for (const id of frameIds)
      await ctx.db.insert("dataFrames", {
        workspaceId: "w",
        id,
        revision: 1,
        name: "Historical frame",
        createdAt: Date.now(),
        storage: { type: "file", key: id },
        fieldIds: [],
      });
  });

  await expect(user().query(api.app.listDataFrames, {})).rejects.toThrow(
    "use the Data Frames recovery list",
  );
  const recoveryBatch = await user().query(api.app.listDataFrames, {
    recovery: true,
  });
  expect(recoveryBatch).toHaveLength(1000);
  for (const frame of recoveryBatch)
    await t.mutation(internal.host.removeDataFrame, {
      workspaceId: "w",
      id: frame.id,
    });

  const finalBatch = await user().query(api.app.listDataFrames, {
    recovery: true,
  });
  expect(finalBatch).toHaveLength(1);
  await t.mutation(internal.host.removeDataFrame, {
    workspaceId: "w",
    id: finalBatch[0]!.id,
  });
  expect(
    await user().query(api.app.listDataFrames, { recovery: true }),
  ).toEqual([]);
}, 15_000);

it("reports a cap exceedance for draftLog and retains the claim", async () => {
  const cleanupId = crypto.randomUUID();
  const secretRef = `secret:${crypto.randomUUID()}`;
  await t.run(async (ctx) => {
    for (let sequence = 0; sequence < 1001; sequence++)
      await ctx.db.insert("draftLog", {
        workspaceId: "w",
        draftId: `draft-${sequence}`,
        sequence,
        command: {
          path: COMMAND_PATHS.CreateDataSource,
          args: {
            id: crypto.randomUUID(),
            name: "Draft source",
            type: "csv",
          },
        },
      });
    await ctx.db.insert("cleanupJobs", {
      workspaceId: "w",
      cleanupId,
      kind: "secret",
      resourceId: secretRef,
      state: "pending",
      claimToken: null,
      createdAt: Date.now(),
    });
    await ctx.db.insert("draftChanges", {
      workspaceId: "w",
      draftId: "active-draft",
      table: "dataSources",
      id: crypto.randomUUID(),
      base: null,
      value: {
        workspaceId: "w",
        id: crypto.randomUUID(),
        revision: 1,
        name: "Active draft source",
        createdAt: Date.now(),
        config: { apiKey: secretRef },
      },
    });
  });

  // Issue #368 defers draining beyond the scan cap; fail loudly and retain it.
  await expect(
    t.mutation(internal.host.claimCleanup, {
      workspaceId: "w",
      cleanupId,
    }),
  ).rejects.toThrow(
    "resource reference scan cap exceeded for draftLog; cleanup outbox halted",
  );
  const retained = await t.run(async (ctx) => {
    const claim = await ctx.db
      .query("cleanupJobs")
      .withIndex("by_workspaceId_and_cleanupId", (q) =>
        q.eq("workspaceId", "w").eq("cleanupId", cleanupId),
      )
      .unique();
    const reference = await ctx.db
      .query("draftChanges")
      .withIndex("by_workspaceId_and_draftId", (q) =>
        q.eq("workspaceId", "w").eq("draftId", "active-draft"),
      )
      .unique();
    const tombstone = await ctx.db
      .query("resourceTombstones")
      .withIndex("by_workspaceId_and_kind_and_resourceId", (q) =>
        q
          .eq("workspaceId", "w")
          .eq("kind", "secret")
          .eq("resourceId", secretRef),
      )
      .unique();
    return { claim, reference, tombstone };
  });
  expect(retained.claim).toMatchObject({
    cleanupId,
    state: "pending",
    claimToken: null,
  });
  expect(retained.reference).not.toBeNull();
  expect(retained.tombstone).toBeNull();
});
