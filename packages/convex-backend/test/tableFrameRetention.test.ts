import { beforeEach, expect, it } from "vitest";
import { convexTest } from "convex-test";
import type { FunctionArgs } from "convex/server";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
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
const user = () => t.withIdentity(identity);

async function seed() {
  const sourceId = crypto.randomUUID(),
    tableId = crypto.randomUUID();
  await user().mutation(api.app.commitBatch, {
    commands: [
      cmd("CreateDataSource", { id: sourceId, name: "S", type: "notion" }),
      cmd("CreateDataTable", {
        id: tableId,
        dataSourceId: sourceId,
        name: "T",
        table: "db",
      }),
    ],
  });
  return { sourceId, tableId };
}
/** One live-connector refresh as the host commits it: a fresh frame, table repointed. */
async function refresh(
  sourceId: string,
  tableId: string,
  expectedDataFrameId: string | null,
  fetchedAt: number,
) {
  const frameId = crypto.randomUUID();
  await t.mutation(internal.host.commitImportedFrame, {
    workspaceId: "w",
    dataSourceId: sourceId,
    dataTableId: tableId,
    expectedDataFrameId,
    frameRow: {
      id: frameId,
      name: "T",
      storage: { type: "file", key: frameId },
      fieldIds: [],
      rowCount: 1,
      columnCount: 0,
      lastRefreshedAt: fetchedAt,
    },
    tableUpdate: { dataFrameId: frameId, lastFetchedAt: fetchedAt },
  });
  return frameId;
}
async function tableFrames(tableId: string) {
  return t.run((ctx) =>
    ctx.db
      .query("dataFrames")
      .withIndex("by_workspaceId_and_definitionId", (q) =>
        q.eq("workspaceId", "w").eq("definitionId", tableId),
      )
      .take(5000),
  );
}
async function claim(resourceId: string) {
  const job = await t.run((ctx) =>
    ctx.db
      .query("cleanupJobs")
      .withIndex("by_workspaceId_and_kind_and_resourceId", (q) =>
        q
          .eq("workspaceId", "w")
          .eq("kind", "frame")
          .eq("resourceId", resourceId),
      )
      .unique(),
  );
  if (!job) return "not queued" as const;
  return (await t.mutation(internal.host.claimCleanup, {
    workspaceId: "w",
    cleanupId: job.cleanupId,
  }))
    ? ("claimable" as const)
    : ("protected" as const);
}

// Reachability first, as #374 asks: refresh a non-local table past the old
// 1000-row cap and count. Before retention the count was the refresh count.
it("keeps a live-connector table at current plus previous frames across 1001 refreshes", async () => {
  const { sourceId, tableId } = await seed();
  let previous: string | null = null;
  const ids: string[] = [];
  for (let index = 0; index < 1001; index++) {
    previous = await refresh(sourceId, tableId, previous, index + 1);
    ids.push(previous);
  }
  const frames = await tableFrames(tableId);
  expect(frames.map((f) => f.id).sort()).toEqual(ids.slice(-2).sort());
  expect(
    (await user().query(api.app.getDataTable, { id: tableId }))?.dataFrameId,
  ).toBe(ids.at(-1));
  // The workspace never crossed the cap, so ordinary reads and writes work.
  expect(await user().query(api.app.listDataFrames, {})).toHaveLength(2);
  await user().mutation(api.app.commitBatch, {
    commands: [cmd("RenameNode", { id: tableId, name: "Renamed" })],
  });
  // Superseded blobs were handed to the cleanup outbox and are reclaimable.
  expect(await claim(ids[0]!)).toBe("claimable");
  expect(await claim(ids[998]!)).toBe("claimable");
}, 180_000);

// #367 acceptance case 1: retargeting a table must not lose the frame it
// pointed at before. The previous frame's row still resolves, and the cleanup
// outbox refuses to claim its blob while that row exists.
it("retains the previous frame as the superseded blob's protector after a retarget", async () => {
  const { sourceId, tableId } = await seed();
  const first = await refresh(sourceId, tableId, null, 1),
    second = await refresh(sourceId, tableId, first, 2),
    third = await refresh(sourceId, tableId, second, 3);
  expect((await tableFrames(tableId)).map((f) => f.id).sort()).toEqual(
    [second, third].sort(),
  );
  expect(
    await t.query(internal.host.getDataFrame, { workspaceId: "w", id: second }),
  ).not.toBeNull();
  // Roll back through the command path, which queues the old pointer for
  // cleanup. The row for `third` still names the blob, so the claim is refused.
  await user().mutation(api.app.commitBatch, {
    commands: [cmd("RefreshDataTable", { id: tableId, dataFrameId: second })],
  });
  expect(await claim(third)).toBe("protected");
  expect(
    await t.query(internal.host.getDataFrame, { workspaceId: "w", id: third }),
  ).not.toBeNull();
  expect(await claim(first)).toBe("claimable");
});

it("keeps a superseded frame that another table or an open draft still references", async () => {
  const { sourceId, tableId } = await seed();
  const first = await refresh(sourceId, tableId, null, 1);
  const otherTableId = crypto.randomUUID();
  await user().mutation(api.app.commitBatch, {
    commands: [
      cmd("CreateDataTable", {
        id: otherTableId,
        dataSourceId: sourceId,
        name: "Other",
        table: "other",
        dataFrameId: first,
      }),
    ],
  });
  const second = await refresh(sourceId, tableId, first, 2);
  // The draft's staged rows carry the table as it points at `second`, which
  // is what keeps `second` alive once two more refreshes have passed it.
  const { draftId } = await user().mutation(api.app.draftBatch, {
    commands: [cmd("RenameNode", { id: tableId, name: "Drafted" })],
  });
  const third = await refresh(sourceId, tableId, second, 3),
    fourth = await refresh(sourceId, tableId, third, 4);
  let kept = (await tableFrames(tableId)).map((f) => f.id).sort();
  expect(kept).toEqual([first, second, third, fourth].sort());
  expect(await claim(second)).toBe("not queued");
  // Once the draft is gone the next refresh prunes it, along with `third`,
  // while the other table's reference still protects `first`.
  await user().mutation(api.app.discardDraft, { draftId });
  const fifth = await refresh(sourceId, tableId, fourth, 5);
  kept = (await tableFrames(tableId)).map((f) => f.id).sort();
  expect(kept).toEqual([first, fourth, fifth].sort());
  expect(await claim(second)).toBe("claimable");
  expect(await claim(third)).toBe("claimable");
});

// A table that accumulated history before retention existed must keep
// refreshing: an over-cap history scan skips pruning rather than rejecting
// the refresh, on both host write paths.
it("still commits a refresh when a table already holds more than 1000 frames", async () => {
  const { sourceId, tableId } = await seed();
  const first = await refresh(sourceId, tableId, null, 1);
  await t.run(async (ctx) => {
    for (let index = 0; index < 1000; index++) {
      const id = crypto.randomUUID();
      await ctx.db.insert("dataFrames", {
        workspaceId: "w",
        id,
        revision: 1,
        name: "Legacy frame",
        createdAt: index,
        sourceId,
        definitionId: tableId,
        storage: { type: "file", key: id },
        fieldIds: [],
      });
    }
  });
  const second = await refresh(sourceId, tableId, first, 2);
  expect(
    (await user().query(api.app.getDataTable, { id: tableId }))?.dataFrameId,
  ).toBe(second);
  expect(await tableFrames(tableId)).toHaveLength(1002);
  expect(await claim(first)).toBe("not queued");
  const insightId = crypto.randomUUID();
  await user().mutation(api.app.commitBatch, {
    commands: [
      cmd("CreateInsight", {
        id: insightId,
        name: "Insight",
        source: { sourceType: "dataTable", sourceId: tableId },
      }),
    ],
  });
  await t.mutation(internal.host.publishMaterialization, {
    workspaceId: "w",
    value: publication(sourceId, tableId, insightId, 3),
  });
  expect(await tableFrames(tableId)).toHaveLength(1003);
}, 60_000);

type Publication = FunctionArgs<
  typeof internal.host.publishMaterialization
>["value"];
/** One saved-result publication whose single source is the given table. */
function publication(
  sourceId: string,
  tableId: string,
  insightId: string,
  fetchedAt: number,
): Publication {
  const provenance = { connectorKind: "notion", bindingVersion: "v1" };
  return {
    sources: [
      {
        source: {
          table: {
            id: tableId,
            dataSourceId: sourceId,
            table: "db",
            name: "T",
          },
          provenance,
        },
        frame: {
          id: crypto.randomUUID(),
          fieldIds: [],
          rowCount: 1,
          schema: [],
        },
      },
    ],
    result: { id: crypto.randomUUID(), fieldIds: [], rowCount: 1, schema: [] },
    target: { kind: "saved", insightId },
    definitionFingerprint: "fp",
    provenance,
    fetchedAt,
  };
}
it("bounds source frames written by saved-result publication the same way", async () => {
  const { sourceId, tableId } = await seed();
  const insightId = crypto.randomUUID();
  await user().mutation(api.app.commitBatch, {
    commands: [
      cmd("CreateInsight", {
        id: insightId,
        name: "Insight",
        source: { sourceType: "dataTable", sourceId: tableId },
      }),
    ],
  });
  for (let index = 1; index <= 5; index++)
    await t.mutation(internal.host.publishMaterialization, {
      workspaceId: "w",
      value: publication(sourceId, tableId, insightId, index),
    });
  expect(await tableFrames(tableId)).toHaveLength(2);
  expect(
    await user().query(api.app.listDataFrames, { insightId }),
  ).toHaveLength(2);
});

it("still publishes a saved result when the insight already holds more than 1000 frames", async () => {
  const { sourceId, tableId } = await seed();
  const insightId = crypto.randomUUID();
  await user().mutation(api.app.commitBatch, {
    commands: [
      cmd("CreateInsight", {
        id: insightId,
        name: "Insight",
        source: { sourceType: "dataTable", sourceId: tableId },
      }),
    ],
  });
  const current = crypto.randomUUID();
  await t.run(async (ctx) => {
    for (let index = 0; index < 1001; index++) {
      const id = index === 1000 ? current : crypto.randomUUID();
      await ctx.db.insert("dataFrames", {
        workspaceId: "w",
        id,
        revision: 1,
        name: "Legacy result",
        createdAt: index,
        insightId,
        storage: { type: "file", key: id },
        fieldIds: [],
        analysis: { currentInsightResult: index === 1000 },
      });
    }
  });
  const value = publication(sourceId, tableId, insightId, 1);
  await t.mutation(internal.host.publishMaterialization, {
    workspaceId: "w",
    value,
  });
  const results = await t.run((ctx) =>
    ctx.db
      .query("dataFrames")
      .withIndex("by_workspaceId_and_insightId", (q) =>
        q.eq("workspaceId", "w").eq("insightId", insightId),
      )
      .take(5000),
  );
  expect(results).toHaveLength(1002);
  // The new result is the only current one; the legacy flag was cleared.
  expect(
    results
      .filter(
        (f) =>
          (f.analysis as { currentInsightResult?: boolean })
            ?.currentInsightResult === true,
      )
      .map((f) => f.id),
  ).toEqual([value.result.id]);
}, 60_000);
