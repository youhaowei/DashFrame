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
  const second = await refresh(sourceId, tableId, first, 2),
    third = await refresh(sourceId, tableId, second, 3),
    { draftId } = await user().mutation(api.app.draftBatch, {
      commands: [cmd("RenameNode", { id: tableId, name: "Drafted" })],
    });
  await refresh(sourceId, tableId, third, 4);
  const kept = (await tableFrames(tableId)).map((f) => f.id);
  expect(kept).toContain(first);
  expect(kept).not.toContain(second);
  expect(kept).toHaveLength(3);
  expect(await claim(second)).toBe("claimable");
  await user().mutation(api.app.discardDraft, { draftId });
});

type Publication = FunctionArgs<
  typeof internal.host.publishMaterialization
>["value"];
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
  const provenance = { connectorKind: "notion", bindingVersion: "v1" };
  const publish = (fetchedAt: number): Publication => ({
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
  });
  for (let index = 1; index <= 5; index++)
    await t.mutation(internal.host.publishMaterialization, {
      workspaceId: "w",
      value: publish(index),
    });
  expect(await tableFrames(tableId)).toHaveLength(2);
  expect(
    await user().query(api.app.listDataFrames, { insightId }),
  ).toHaveLength(2);
});
