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
import {
  RESOURCE_REFERENCE_SCAN_CAP_CODE,
  resourceReferenceScanCapPayload,
} from "../convex/model";

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
  expect(await user().query(api.app.workspaceArtifactPresence, {})).toBe(true);
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
  // Assert the structured payload, not the message: consumers match on `code`.
  const capPayload = {
    code: RESOURCE_REFERENCE_SCAN_CAP_CODE,
    table: "draftLog",
    message:
      "resource reference scan cap exceeded for draftLog; cleanup outbox halted",
  };
  const thrown = async (run: Promise<unknown>) => {
    try {
      await run;
    } catch (error) {
      return error;
    }
    throw new Error("expected the scan cap to be exceeded");
  };
  // Through a function boundary Convex hands back `data` as a JSON string;
  // called in-process it stays an object. The predicate normalizes both.
  expect(
    resourceReferenceScanCapPayload(
      await thrown(
        t.mutation(internal.host.claimCleanup, { workspaceId: "w", cleanupId }),
      ),
    ),
  ).toEqual(capPayload);
  expect(
    resourceReferenceScanCapPayload(
      await thrown(t.run((ctx) => externallyReferencedFrameIds(ctx, "w", []))),
    ),
  ).toEqual(capPayload);
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

// The command engine loads rows on demand, so frame history the workspace has
// accumulated never enters a commit, draft, preview, or publish transaction.
it("runs commits, drafts, review, and publish with more than 1000 frames present", async () => {
  const sourceId = crypto.randomUUID();
  await t.run(async (ctx) => {
    await ctx.db.insert("dataSources", {
      workspaceId: "w",
      id: sourceId,
      revision: 1,
      name: "Source",
      createdAt: Date.now(),
      kind: "csv",
      config: {},
    });
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
    }
  });
  await user().mutation(api.app.commitBatch, {
    commands: [
      {
        path: COMMAND_PATHS.RenameNode,
        args: { id: sourceId, name: "Renamed" },
      },
    ],
  });
  expect(
    (await user().query(api.app.getDataSource, { id: sourceId }))?.name,
  ).toBe("Renamed");
  const { draftId } = await user().mutation(api.app.draftBatch, {
    commands: [
      {
        path: COMMAND_PATHS.RenameNode,
        args: { id: sourceId, name: "Drafted" },
      },
    ],
  });
  expect(
    (await user().query(api.app.getDataSource, { id: sourceId, draftId }))
      ?.name,
  ).toBe("Drafted");
  expect(await user().query(api.app.listDataSources, { draftId })).toHaveLength(
    1,
  );
  const review = await user().query(api.app.draftPublishReview, { draftId });
  expect(review.diff.directNodes).toHaveLength(1);
  expect(review.publishBlocked).toBe(false);
  await user().mutation(api.app.publishDraft, { draftId });
  expect(
    (await user().query(api.app.getDataSource, { id: sourceId }))?.name,
  ).toBe("Drafted");
  // The list surface still refuses an unbounded frame read and names the exit.
  await expect(user().query(api.app.listDataFrames, {})).rejects.toThrow(
    "use the Data Frames recovery list",
  );
}, 30_000);

it("deletes a data source's own frames through their index without touching the rest", async () => {
  const sourceId = crypto.randomUUID(),
    tableId = crypto.randomUUID(),
    ownFrameId = crypto.randomUUID();
  await t.run(async (ctx) => {
    await ctx.db.insert("dataSources", {
      workspaceId: "w",
      id: sourceId,
      revision: 1,
      name: "Source",
      createdAt: Date.now(),
      kind: "csv",
      config: {},
    });
    await ctx.db.insert("dataTables", {
      workspaceId: "w",
      id: tableId,
      revision: 1,
      name: "Table",
      createdAt: Date.now(),
      dataSourceId: sourceId,
      table: "t",
      fields: [],
      metrics: [],
      dataFrameId: ownFrameId,
    });
    await ctx.db.insert("dataFrames", {
      workspaceId: "w",
      id: ownFrameId,
      revision: 1,
      name: "Own frame",
      createdAt: Date.now(),
      sourceId,
      definitionId: tableId,
      storage: { type: "file", key: ownFrameId },
      fieldIds: [],
    });
    for (let index = 0; index < 1001; index++) {
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
  await user().mutation(api.app.commitBatch, {
    commands: [{ path: COMMAND_PATHS.DeleteNode, args: { id: sourceId } }],
  });
  const remaining = await t.run((ctx) =>
    ctx.db
      .query("dataFrames")
      .withIndex("by_workspaceId_and_id", (q) => q.eq("workspaceId", "w"))
      .take(5000),
  );
  expect(remaining).toHaveLength(1001);
  expect(remaining.some((row) => row.id === ownFrameId)).toBe(false);
  expect(await user().query(api.app.getDataTable, { id: tableId })).toBeNull();
}, 30_000);

// A workspace-size refusal raised while a preview runs a command is the same
// refusal the whole-graph load used to raise up front: it must surface as the
// query's error, not be recorded against the command as if the draft were wrong.
it("lets a scan cap refusal through preview instead of blaming the command", async () => {
  const sourceId = crypto.randomUUID(),
    tableId = crypto.randomUUID(),
    vizId = crypto.randomUUID();
  await user().mutation(api.app.commitBatch, {
    commands: [
      {
        path: COMMAND_PATHS.CreateDataSource,
        args: { id: sourceId, name: "S", type: "csv" },
      },
      {
        path: COMMAND_PATHS.CreateDataTable,
        args: { id: tableId, dataSourceId: sourceId, name: "T", table: "t" },
      },
    ],
  });
  await t.run(async (ctx) => {
    for (let index = 0; index < 1001; index++)
      await ctx.db.insert("insights", {
        workspaceId: "w",
        id: crypto.randomUUID(),
        revision: 1,
        name: `Insight ${index}`,
        createdAt: index,
        definition: {
          source: { sourceType: "dataTable", sourceId: tableId },
          selectedFields: [],
          metrics: [],
          filters: [],
          sorts: [],
          joins: [],
        },
        createdBy: { kind: "user" },
      });
    await ctx.db.insert("visualizations", {
      workspaceId: "w",
      id: vizId,
      revision: 1,
      name: "Viz",
      createdAt: 0,
      insightId: crypto.randomUUID(),
      chartType: "barY",
      encoding: {},
      options: {},
      createdBy: { kind: "user" },
    });
  });
  await expect(
    user().query(api.app.previewDiff, {
      commands: [{ path: COMMAND_PATHS.DeleteNode, args: { id: vizId } }],
    }),
  ).rejects.toThrow("Workspace exceeds 1000 insights");
}, 30_000);
