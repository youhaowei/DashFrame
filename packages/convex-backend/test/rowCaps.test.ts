import { beforeEach, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { COMMAND_PATHS } from "@dashframe/types";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import {
  scanWorkspaceReferenceRows,
  WORKSPACE_REFERENCE_TABLES,
} from "../convex/cleanup";
import { externallyReferencedFrameIds } from "../convex/frameRetention";

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

it("returns a bounded recovery batch when a workspace has 1001 frames", async () => {
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
  expect(
    await user().query(api.app.listDataFrames, { recovery: true }),
  ).toHaveLength(1000);
  await t.mutation(internal.host.removeDataFrame, {
    workspaceId: "w",
    id: frameIds[0]!,
  });
  expect(await user().query(api.app.listDataFrames, {})).toHaveLength(1000);
  expect(
    await user().query(api.app.listDataFrames, { recovery: true }),
  ).toHaveLength(1000);
}, 15_000);

it("returns one indexed data source when more than 1000 share its type", async () => {
  await t.run(async (ctx) => {
    for (let index = 0; index < 1001; index++)
      await ctx.db.insert("dataSources", {
        workspaceId: "w",
        id: crypto.randomUUID(),
        revision: 1,
        name: `Source ${index}`,
        createdAt: index,
        kind: "csv",
      });
  });

  expect(
    await user().query(api.app.getDataSourceByType, { type: "csv" }),
  ).not.toBeNull();
}, 15_000);

it("serves draft-less indexed reads without loading unrelated artifact tables", async () => {
  const sourceId = crypto.randomUUID();
  const insightId = crypto.randomUUID();
  const insightFrameId = crypto.randomUUID();
  await t.run(async (ctx) => {
    await ctx.db.insert("dataSources", {
      workspaceId: "w",
      id: sourceId,
      revision: 1,
      name: "Source",
      createdAt: Date.now(),
      kind: "csv",
    });
    await ctx.db.insert("dataFrames", {
      workspaceId: "w",
      id: insightFrameId,
      revision: 1,
      name: "Current insight frame",
      createdAt: Date.now(),
      insightId,
      storage: { type: "file", key: insightFrameId },
      fieldIds: [],
      analysis: { currentInsightResult: true },
    });
    for (let index = 0; index < 1000; index++) {
      const id = crypto.randomUUID();
      await ctx.db.insert("dataFrames", {
        workspaceId: "w",
        id,
        revision: 1,
        name: "Unrelated frame",
        createdAt: index,
        storage: { type: "file", key: id },
        fieldIds: [],
      });
    }
  });

  expect(await user().query(api.app.listDataSources, {})).toHaveLength(1);
  expect(
    (await user().query(api.app.getDataSourceByType, { type: "csv" }))?.id,
  ).toBe(sourceId);
  expect(
    (await user().query(api.app.getDataFrameByInsight, { insightId }))?.id,
  ).toBe(insightFrameId);
}, 15_000);

it("applies secondary filters after selecting a draft-less index", async () => {
  await t.run(async (ctx) => {
    for (const insightId of ["matching", "other"])
      await ctx.db.insert("dataSources", {
        workspaceId: "w",
        id: crypto.randomUUID(),
        revision: 1,
        name: "Source",
        createdAt: Date.now(),
        dataSourceId: "shared-source",
        insightId,
      });
  });

  const rows = await user().query(api.app.listDataSources, {
    dataSourceId: "shared-source",
    insightId: "matching",
  });
  expect(rows).toHaveLength(1);
});

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
  await expect(
    t.run((ctx) => externallyReferencedFrameIds(ctx, "w", [])),
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

it("keeps both reference consumers on the shared eleven-table scan", async () => {
  const scannedTables = await t.run(async (ctx) =>
    (await scanWorkspaceReferenceRows(ctx, "w")).map(({ table }) => table),
  );

  expect(scannedTables).toEqual(WORKSPACE_REFERENCE_TABLES);
  expect(scannedTables).toHaveLength(11);
});
