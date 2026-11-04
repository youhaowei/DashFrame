import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
afterEach(() => {
  vi.useRealTimers();
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
  expect(await listAll(user(), api.app.listDataSources, {})).toEqual([]);
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
  expect(
    await listAll(user("other"), api.app.listDataSources, {}),
  ).toHaveLength(1);
  await user("other").mutation(api.app.publishDraft, {
    draftId: foreign.draftId,
  });
});
const count = (table: "dataFrames" | "draftLog") =>
  t.run(async (ctx) =>
    (await ctx.db.query(table).collect()).filter(
      (row) => row.workspaceId === "w",
    ),
  );
const cleanupJobs = () =>
  t.run(async (ctx) =>
    (await ctx.db.query("cleanupJobs").collect()).filter(
      (row) => row.workspaceId === "w",
    ),
  );
it("clears frame history and a draft log past one batch through scheduled continuation", async () => {
  vi.useFakeTimers();
  await seed();
  await seed("other");
  await t.run(async (ctx) => {
    for (let index = 0; index < 1001; index++) {
      const id = crypto.randomUUID();
      await ctx.db.insert("dataFrames", {
        workspaceId: "w",
        id,
        revision: 1,
        name: "Historical frame",
        createdAt: index,
        storage: { type: "file", key: id },
        fieldIds: [],
      });
      await ctx.db.insert("draftLog", {
        workspaceId: "w",
        draftId: "oversized",
        sequence: index,
        command: { path: "createDataSource", args: {} },
      });
    }
  });
  expect(
    await t.mutation(internal.host.clearAllData, { workspaceId: "w" }),
  ).toEqual({ complete: false });
  // The first batch has already gone, and the rest is scheduled, not awaited.
  expect((await count("dataFrames")).length).toBeLessThan(1001);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await count("dataFrames")).toEqual([]);
  expect(await count("draftLog")).toEqual([]);
  expect(await listAll(user(), api.app.listDataSources, {})).toEqual([]);
  expect(
    (await cleanupJobs()).filter((job) => job.kind === "frame"),
  ).toHaveLength(1001);
  expect(
    await listAll(user("other"), api.app.listDataSources, {}),
  ).toHaveLength(1);
  expect(
    await t.mutation(internal.host.clearAllData, { workspaceId: "w" }),
  ).toEqual({ complete: true });
}, 60_000);
it("cancels pending host batches and tombstones import claims before the rows go", async () => {
  vi.useFakeTimers();
  const { sourceId, tableId } = await seed();
  const refs = Array.from({ length: 5 }, () => `secret:${crypto.randomUUID()}`);
  for (const [index, ref] of refs.entries())
    await t.mutation(internal.host.prepareHostBatch, {
      workspaceId: "w",
      operationId: `batch-${index}`,
      principal: { kind: "user", userId: "u" },
      requestHash: "b".repeat(64),
      commands: [],
      mode: "commit",
      stagedRefs: [ref],
    });
  const claims = Array.from({ length: 5 }, (_, index) => ({
    workspaceId: "w",
    operationId: `import-${index}`,
    requestHash: "a".repeat(64),
  }));
  for (const claim of claims)
    await t.mutation(internal.host.beginLocalImport, claim);
  // Two rows per transaction: five calls tombstone the five claims and cancel
  // the five batches, and not one artifact row has gone by then.
  for (let call = 0; call < 5; call++)
    expect(
      await t.mutation(internal.host.clearAllData, {
        workspaceId: "w",
        batchSize: 2,
      }),
    ).toEqual({ complete: false });
  expect(await listAll(user(), api.app.listDataSources, {})).toHaveLength(1);
  const pendingWrites = await t.run(async (ctx) => ({
    claims: (await ctx.db.query("localImports").collect()).filter(
      (row) => !row.cancelled,
    ).length,
    batches: (await ctx.db.query("hostBatches").collect()).filter(
      (row) => row.status === "pending",
    ).length,
  }));
  expect(pendingWrites).toEqual({ claims: 0, batches: 0 });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await listAll(user(), api.app.listDataSources, {})).toEqual([]);
  for (const claim of claims)
    await expect(
      t.mutation(internal.host.beginLocalImport, claim),
    ).rejects.toThrow("invalidated");
  for (const [index, ref] of refs.entries()) {
    expect(
      (
        await t.mutation(internal.host.executeHostBatch, {
          workspaceId: "w",
          operationId: `batch-${index}`,
          principal: { kind: "user", userId: "u" },
          requestHash: "b".repeat(64),
        })
      ).status,
    ).toBe("cancelled");
    expect((await cleanupJobs()).some((job) => job.resourceId === ref)).toBe(
      true,
    );
  }
  await seed("w", sourceId, tableId);
  expect(await listAll(user(), api.app.listDataSources, {})).toHaveLength(1);
});
it("lets a caller drive the clear to completion by calling until complete", async () => {
  // Fake timers never advance, so the scheduled continuation never runs and
  // only the caller's own calls make progress.
  vi.useFakeTimers();
  await seed();
  await t.run(async (ctx) => {
    for (let index = 0; index < 7; index++)
      await ctx.db.insert("dataFrames", {
        workspaceId: "w",
        id: crypto.randomUUID(),
        revision: 1,
        name: "Frame",
        createdAt: index,
        storage: { type: "file", key: crypto.randomUUID() },
        fieldIds: [],
      });
  });
  let calls = 0;
  for (;;) {
    calls += 1;
    const { complete } = await t.mutation(internal.host.clearAllData, {
      workspaceId: "w",
      batchSize: 3,
    });
    if (complete) break;
  }
  expect(calls).toBeGreaterThan(1);
  expect(await count("dataFrames")).toEqual([]);
  expect(await listAll(user(), api.app.listDataSources, {})).toEqual([]);
  // The continuations those calls queued are retired: what the user creates
  // after the clear completed survives them running.
  const { sourceId } = await seed();
  const claim = {
    workspaceId: "w",
    operationId: "import-after-clear",
    requestHash: "c".repeat(64),
  };
  await t.mutation(internal.host.beginLocalImport, claim);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    (await listAll(user(), api.app.listDataSources, {})).map((row) => row.id),
  ).toEqual([sourceId]);
  expect((await t.query(internal.host.getLocalImport, claim))?.status).toBe(
    "pending",
  );
  expect(await t.run((ctx) => ctx.db.query("hostSettings").collect())).toEqual(
    [],
  );
});
it("empties the workspace when the caller's loop and the scheduled continuation run together", async () => {
  // Real timers: every batch the caller runs queues a continuation that fires
  // while the caller is still looping, and the two must not double apply.
  await seed();
  await t.run(async (ctx) => {
    for (let index = 0; index < 1001; index++) {
      const id = crypto.randomUUID();
      await ctx.db.insert("dataFrames", {
        workspaceId: "w",
        id,
        revision: 1,
        name: "Frame",
        createdAt: index,
        storage: { type: "file", key: id },
        fieldIds: [],
      });
    }
  });
  const settled = async () => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const jobs = await t.run((ctx) =>
        ctx.db.system.query("_scheduled_functions").collect(),
      );
      if (
        jobs.every(
          (job) =>
            job.state.kind !== "pending" && job.state.kind !== "inProgress",
        )
      )
        return;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 10);
      });
    }
    throw new Error("scheduled continuations did not settle");
  };
  for (;;) {
    const { complete } = await t.mutation(internal.host.clearAllData, {
      workspaceId: "w",
      batchSize: 100,
    });
    if (complete) break;
  }
  const { sourceId } = await seed();
  await settled();
  expect(await count("dataFrames")).toEqual([]);
  expect(
    (await listAll(user(), api.app.listDataSources, {})).map((row) => row.id),
  ).toEqual([sourceId]);
  expect(await t.run((ctx) => ctx.db.query("hostSettings").collect())).toEqual(
    [],
  );
}, 60_000);
it("clears after more than 1000 completed connector receipts", async () => {
  await seed();
  await t.run(async (ctx) => {
    for (let index = 0; index < 1001; index++)
      await ctx.db.insert("operations", {
        workspaceId: "w",
        operationId: `local-import:connector-${index}`,
        request: { index },
        result: null,
      });
  });

  await expect(
    t.mutation(internal.host.clearAllData, { workspaceId: "w" }),
  ).resolves.toEqual({ complete: true });
  expect(await listAll(user(), api.app.listDataSources, {})).toEqual([]);
  expect(
    await t.run((ctx) => ctx.db.query("operations").collect()),
  ).toHaveLength(1001);
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
    expect(await t.mutation(internal.host.cancelLocalImport, request)).toBe(
      false,
    );
    expect(await listAll(user(), api.app.listDataFrames, {})).toEqual([]);
    expect(
      await t.query(internal.host.getLocalImport, {
        ...request,
        workspaceId: "other",
      }),
    ).toEqual(foreign);
  },
);
