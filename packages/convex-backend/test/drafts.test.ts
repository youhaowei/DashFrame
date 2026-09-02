import { beforeEach, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { cmd, type Command } from "@dashframe/types";
const modules = import.meta.glob("../convex/**/*.ts");
const makeTest = () => convexTest(schema, modules);
let t: ReturnType<typeof makeTest>;
const user = (workspaceId = "w", userId = "u") =>
  t.withIdentity({
    subject: userId,
    workspaceId,
    principalKind: "user",
    userId,
  });
const service = (credentialId = "bot") =>
  t.withIdentity({
    subject: credentialId,
    workspaceId: "w",
    principalKind: "service",
    credentialId,
  });
const uuid = () => crypto.randomUUID();
beforeEach(() => {
  t = makeTest();
});
async function seed() {
  const sourceId = uuid(),
    tableId = uuid();
  await user().mutation(api.app.commitBatch, {
    commands: [
      cmd("CreateDataSource", { id: sourceId, type: "csv", name: "Source" }),
      cmd("CreateDataTable", {
        id: tableId,
        dataSourceId: sourceId,
        name: "Table",
        table: "test.csv",
      }),
    ],
  });
  return { sourceId, tableId };
}
const rename = (id: string, name: string) => cmd("RenameNode", { id, name });
async function publication(draftId: string) {
  const review = await user().query(api.app.draftPublishReview, { draftId });
  return {
    draftId,
    expectedCommandCount: review.commandCount,
    expectedLogSignature: review.logSignature,
    expectedRevision: review.revision,
  };
}
it("requires verified workspace principals and observes credential revocation", async () => {
  await expect(t.query(api.app.listDataSources, {})).rejects.toThrow();
  await seed();
  expect(await user("other").query(api.app.listDataSources, {})).toEqual([]);
  expect(await service().query(api.app.listDataSources, {})).toHaveLength(1);
  await t.mutation(internal.host.revokeCredential, {
    workspaceId: "w",
    credentialId: "bot",
  });
  await expect(service().query(api.app.listDataSources, {})).rejects.toThrow(
    "revoked",
  );
});
it("rolls back all metadata in a failed native mutation", async () => {
  const id = uuid();
  await expect(
    user().mutation(api.app.commitBatch, {
      commands: [
        cmd("CreateDataSource", { id, type: "csv", name: "New" }),
        rename(uuid(), "Missing"),
      ],
    }),
  ).rejects.toThrow();
  expect(await user().query(api.app.getDataSource, { id })).toBeNull();
});
it("services draft but cannot canonically commit or publish through either entry point", async () => {
  const { tableId } = await seed();
  await expect(
    service().mutation(api.app.commitBatch, {
      commands: [rename(tableId, "Bad")],
    }),
  ).rejects.toThrow();
  await expect(
    t.mutation(internal.host.commitBatch, {
      workspaceId: "w",
      principal: { kind: "service", credentialId: "bot" },
      commands: [{ path: "renameNode", args: { id: tableId, name: "Bad" } }],
    }),
  ).rejects.toThrow();
  const { draftId } = await service().mutation(api.app.draftBatch, {
    commands: [rename(tableId, "Proposal")],
  });
  await expect(
    service().mutation(api.app.publishDraft, { draftId }),
  ).rejects.toThrow();
  await user().mutation(api.app.publishDraft, await publication(draftId));
  expect(
    (await user().query(api.app.getDataTable, { id: tableId }))?.name,
  ).toBe("Proposal");
});
it("isolates draft owners, permits operator review of service drafts, and rejects foreign-user drafts", async () => {
  const { tableId } = await seed();
  const { draftId } = await service().mutation(api.app.draftBatch, {
    commands: [rename(tableId, "Bot")],
  });
  await expect(
    service("other").query(api.app.getDataTable, { id: tableId, draftId }),
  ).rejects.toThrow("Draft unavailable");
  await expect(
    user().mutation(api.app.draftBatch, { draftId, commands: [] }),
  ).rejects.toThrow("Draft unavailable");
  expect(
    (await user().query(api.app.getDataTable, { id: tableId, draftId }))?.name,
  ).toBe("Bot");
  expect(await user().query(api.app.listDrafts, {})).toContainEqual(
    expect.objectContaining({
      draftId,
      commandCount: 1,
      kinds: { renameNode: 1 },
      paths: ["renameNode"],
    }),
  );
  const foreign = await user("w", "other").mutation(api.app.draftBatch, {
    commands: [],
  });
  await expect(
    user().query(api.app.draftPublishReview, { draftId: foreign.draftId }),
  ).rejects.toThrow("Draft unavailable");
});

it("lists only visible drafts when foreign owners exceed the workspace cap", async () => {
  const ownDraftId = uuid();
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("drafts", {
      workspaceId: "w",
      draftId: ownDraftId,
      owner: "user:u",
      revision: 0,
      createdAt: now,
      updatedAt: now,
      commandCount: 0,
    });
    for (let index = 0; index < 1001; index++)
      await ctx.db.insert("drafts", {
        workspaceId: "w",
        draftId: uuid(),
        owner: `user:foreign-${index}`,
        revision: 0,
        createdAt: now,
        updatedAt: now,
        commandCount: 0,
      });
  });

  expect(await user().query(api.app.listDrafts, {})).toEqual([
    expect.objectContaining({ draftId: ownDraftId }),
  ]);
}, 15_000);
it("summarizes two visible drafts with 600 commands each", async () => {
  const draftIds = [uuid(), uuid()];
  await t.run(async (ctx) => {
    const now = Date.now();
    for (const draftId of draftIds) {
      await ctx.db.insert("drafts", {
        workspaceId: "w",
        draftId,
        owner: "user:u",
        revision: 600,
        createdAt: now,
        updatedAt: now,
        commandCount: 600,
      });
      for (let sequence = 0; sequence < 600; sequence++)
        await ctx.db.insert("draftLog", {
          workspaceId: "w",
          draftId,
          sequence,
          command: {
            path: "renameNode",
            args: { id: uuid(), name: `Name ${sequence}` },
          },
        });
    }
  });

  const drafts = await user().query(api.app.listDrafts, {});
  expect(drafts).toHaveLength(2);
  expect(drafts).toEqual(
    expect.arrayContaining(
      draftIds.map((draftId) =>
        expect.objectContaining({
          draftId,
          commandCount: 600,
          kinds: { renameNode: 600 },
          paths: ["renameNode"],
        }),
      ),
    ),
  );
}, 15_000);
it("creates empty drafts for assistant sessions and rejects closed draft reads", async () => {
  const { draftId } = await service().mutation(api.app.draftBatch, {
    commands: [],
  });
  expect(
    (await user().query(api.app.draftPublishReview, { draftId }))
      .publishBlocked,
  ).toBe(true);
  await service().mutation(api.app.discardDraft, { draftId });
  await expect(
    service().query(api.app.getDraftLog, { draftId }),
  ).rejects.toThrow("Draft unavailable");
});
it.each(["publish", "discard"] as const)(
  "deletes draftLog and draftChanges rows on %s",
  async (mode) => {
    const { tableId } = await seed();
    const { draftId } = await user().mutation(api.app.draftBatch, {
      commands: [rename(tableId, "Draft name")],
    });
    const counts = () =>
      t.run(async (ctx) => ({
        log: (
          await ctx.db
            .query("draftLog")
            .withIndex("by_workspaceId_and_draftId_and_sequence", (q) =>
              q.eq("workspaceId", "w").eq("draftId", draftId),
            )
            .collect()
        ).length,
        changes: (
          await ctx.db
            .query("draftChanges")
            .withIndex("by_workspaceId_and_draftId", (q) =>
              q.eq("workspaceId", "w").eq("draftId", draftId),
            )
            .collect()
        ).length,
      }));
    expect(await counts()).toEqual({ log: 1, changes: 1 });

    if (mode === "publish")
      await user().mutation(api.app.publishDraft, { draftId });
    else await user().mutation(api.app.discardDraft, { draftId });

    expect(await counts()).toEqual({ log: 0, changes: 0 });
  },
);
it("rejects stale review after append even when a caller omits the count", async () => {
  const { tableId } = await seed(),
    owner = user();
  const { draftId } = await owner.mutation(api.app.draftBatch, {
    commands: [rename(tableId, "First")],
  });
  const expected = await publication(draftId);
  await owner.mutation(api.app.draftBatch, {
    draftId,
    commands: [rename(tableId, "Second")],
  });
  await expect(
    owner.mutation(api.app.publishDraft, {
      draftId,
      expectedLogSignature: expected.expectedLogSignature,
    }),
  ).rejects.toThrow("changed since review");
  expect((await owner.query(api.app.getDataTable, { id: tableId }))?.name).toBe(
    "Table",
  );
});
it("blocks same-cell conflicts but merges disjoint canonical edits", async () => {
  const { tableId } = await seed();
  const { draftId } = await user().mutation(api.app.draftBatch, {
    commands: [rename(tableId, "Draft")],
  });
  await user().mutation(api.app.commitBatch, {
    commands: [
      cmd("SetDataTableSchema", {
        id: tableId,
        sourceSchema: { columns: [], version: 1, lastSyncedAt: 0 },
      }),
    ],
  });
  await user().mutation(api.app.publishDraft, await publication(draftId));
  const table = await user().query(api.app.getDataTable, { id: tableId });
  expect(table?.name).toBe("Draft");
  expect(table?.sourceSchema?.version).toBe(1);
  const next = await user().mutation(api.app.draftBatch, {
    commands: [rename(tableId, "Conflict")],
  });
  await user().mutation(api.app.commitBatch, {
    commands: [rename(tableId, "Canonical")],
  });
  await expect(
    user().mutation(api.app.publishDraft, await publication(next.draftId)),
  ).rejects.toThrow("conflicts");
  expect(
    (await user().query(api.app.getDataTable, { id: tableId }))?.name,
  ).toBe("Canonical");
});
it("rejects deletion conflicts and does not mutate durable state during preview", async () => {
  const { tableId } = await seed();
  const diff = await user().query(api.app.previewDiff, {
    commands: [rename(tableId, "Preview"), rename(uuid(), "Missing")],
  });
  expect(diff.error?.commandIndex).toBe(1);
  expect(
    (await user().query(api.app.getDataTable, { id: tableId }))?.name,
  ).toBe("Table");
  const { draftId } = await user().mutation(api.app.draftBatch, {
    commands: [rename(tableId, "Draft")],
  });
  await user().mutation(api.app.commitBatch, {
    commands: [cmd("DeleteNode", { id: tableId })],
  });
  await expect(
    user().mutation(api.app.publishDraft, { draftId }),
  ).rejects.toThrow("deletion");
});
it("binds placeholder operands under review CAS and blocks arbitrary path edits", async () => {
  const { tableId } = await seed(),
    insightId = uuid();
  await user().mutation(api.app.commitBatch, {
    commands: [
      cmd("CreateInsight", {
        id: insightId,
        name: "I",
        source: { sourceType: "dataTable", sourceId: tableId },
      }),
    ],
  });
  const { draftId } = await service().mutation(api.app.draftBatch, {
    commands: [
      {
        path: "setInsightFilter",
        args: {
          id: insightId,
          filters: [
            {
              field: "region",
              operator: "eq",
              value: {
                kind: "lateBound",
                ref: { type: "placeholder", prompt: "Region" },
              },
            },
          ],
        },
      },
    ],
  });
  const before = await user().query(api.app.draftPublishReview, { draftId });
  expect(before.publishBlocked).toBe(true);
  await expect(
    user().mutation(api.app.reviseDraft, {
      draftId,
      expectedLogSignature: before.logSignature,
      ops: [
        {
          type: "bindOperand",
          commandIndex: 0,
          jsonPath: "args.__proto__.polluted",
          value: true,
        },
      ],
    }),
  ).rejects.toThrow();
  const revised = await user().mutation(api.app.reviseDraft, {
    draftId,
    expectedLogSignature: before.logSignature,
    ops: [
      {
        type: "bindOperand",
        commandIndex: 0,
        jsonPath: "args.filters[0].value",
        value: "EMEA",
      },
    ],
  });
  expect(revised.logSignature).not.toBe(before.logSignature);
  await expect(
    user().mutation(api.app.publishDraft, {
      draftId,
      expectedLogSignature: before.logSignature,
    }),
  ).rejects.toThrow("changed since review");
  await user().mutation(api.app.publishDraft, await publication(draftId));
  expect(
    (await user().query(api.app.getInsight, { id: insightId }))?.filters?.[0]
      ?.value,
  ).toEqual({ kind: "value", v: "EMEA" });
});
it("rejects plaintext and borrowed refs at public writes and redacts staged refs on every public read", async () => {
  const { sourceId } = await seed();
  for (const apiKey of ["plaintext", `secret:${uuid()}`])
    await expect(
      user().mutation(api.app.commitBatch, {
        commands: [cmd("SetDataSourceConfig", { id: sourceId, apiKey })],
      }),
    ).rejects.toThrow("host");
  const ref = `secret:${uuid()}`;
  const { draftId } = await t.mutation(internal.host.draftBatch, {
    workspaceId: "w",
    principal: { kind: "user", userId: "u" },
    commands: [
      { path: "setDataSourceConfig", args: { id: sourceId, apiKey: ref } },
    ],
  });
  const dto = await user().query(api.app.getDataSource, {
    id: sourceId,
    draftId,
  });
  expect(dto?.config.hasApiKey).toBe(true);
  expect(JSON.stringify(dto)).not.toContain(ref);
  expect(
    JSON.stringify(await user().query(api.app.getDraftLog, { draftId })),
  ).not.toContain(ref);
  expect(
    JSON.stringify(await user().query(api.app.draftPublishReview, { draftId })),
  ).not.toContain(ref);
});
it("retries operation IDs exactly and refuses reuse for a different payload", async () => {
  const { tableId } = await seed(),
    commands = [rename(tableId, "Once")];
  const first = await user().mutation(api.app.commitBatch, {
    commands,
    operationId: "same",
  });
  expect(
    await user().mutation(api.app.commitBatch, {
      commands,
      operationId: "same",
    }),
  ).toEqual(first);
  await expect(
    user().mutation(api.app.commitBatch, {
      commands: [rename(tableId, "Different")],
      operationId: "same",
    }),
  ).rejects.toThrow("reused");
});
it("publishes imported frames and pointer CAS atomically, strips samples, and retries without another write", async () => {
  const { sourceId, tableId } = await seed(),
    frameId = uuid();
  const args = {
    workspaceId: "w",
    dataSourceId: sourceId,
    dataTableId: tableId,
    expectedDataFrameId: null,
    frameRow: {
      id: frameId,
      name: "F",
      storage: { type: "file", key: frameId },
      fieldIds: [],
      analysis: { columns: [{ sampleValues: ["private"] }] },
    },
    tableUpdate: { dataFrameId: frameId, lastFetchedAt: 1 },
  };
  await t.mutation(internal.host.commitImportedFrame, args);
  await t.mutation(internal.host.commitImportedFrame, args);
  const frame = await t.query(internal.host.getDataFrame, {
    workspaceId: "w",
    id: frameId,
  });
  expect(JSON.stringify(frame)).not.toContain("private");
  expect(
    JSON.stringify(
      await t.run((ctx) =>
        ctx.db
          .query("operations")
          .withIndex("by_workspaceId_and_operationId", (q) =>
            q.eq("workspaceId", "w"),
          )
          .take(100),
      ),
    ),
  ).not.toContain("private");
  expect(
    (await user().query(api.app.getDataTable, { id: tableId }))?.dataFrameId,
  ).toBe(frameId);
  const second = uuid();
  await expect(
    t.mutation(internal.host.commitImportedFrame, {
      ...args,
      frameRow: {
        ...args.frameRow,
        id: second,
        storage: { type: "file", key: second },
      },
      tableUpdate: { ...args.tableUpdate, dataFrameId: second },
    }),
  ).rejects.toThrow("SOURCE_BINDING_CHANGED");
  expect(
    await t.query(internal.host.getDataFrame, { workspaceId: "w", id: second }),
  ).toBeNull();
});
it("previews shared UUID artifact kinds separately and reports reused insights as no-ops", async () => {
  const same = uuid();
  const diff = await user().query(api.app.previewDiff, {
    commands: [
      cmd("CreateDataSource", { id: same, name: "Source", type: "csv" }),
      cmd("CreateDataTable", {
        id: same,
        name: "Table",
        table: "t.csv",
        dataSourceId: same,
      }),
    ],
  });
  expect(diff.directNodes.map((n) => n.kind)).toEqual([
    "dataSource",
    "dataTable",
  ]);
  expect(diff.tablesWritten).toEqual(["dataSources", "dataTables"]);
  const { tableId } = await seed(),
    first = uuid();
  await user().mutation(api.app.commitBatch, {
    commands: [
      cmd("GetOrCreateInsightDraft", {
        id: first,
        name: "Existing",
        source: { sourceType: "dataTable", sourceId: tableId },
      }),
    ],
  });
  const reused = await user().query(api.app.previewDiff, {
    commands: [
      cmd("GetOrCreateInsightDraft", {
        id: uuid(),
        name: "Would create",
        source: { sourceType: "dataTable", sourceId: tableId },
      }),
    ],
  });
  expect(reused.directNodes).toHaveLength(1);
  expect(reused.directNodes[0]).toMatchObject({
    nodeId: first,
    kind: "insight",
    change: "noop",
    proposedDefinition: {},
  });
  expect(reused.tablesWritten).toEqual([]);
});
it("rejects runtime sort declarations outside saved result fields", async () => {
  const { tableId } = await seed(),
    insightId = uuid();
  await user().mutation(api.app.commitBatch, {
    commands: [
      cmd("CreateInsight", {
        id: insightId,
        name: "I",
        source: { sourceType: "dataTable", sourceId: tableId },
      }),
    ],
  });
  await expect(
    user().mutation(api.app.commitBatch, {
      commands: [
        cmd("SetInsightRuntimeControls", {
          id: insightId,
          runtimeControls: { sort: { allowedFieldIds: [uuid()], maxKeys: 1 } },
        }),
      ],
    }),
  ).rejects.toThrow("sort field");
});
it("rejects an oversized append before it creates an unpublishable draft", async () => {
  const { tableId } = await seed();
  const { draftId } = await user().mutation(api.app.draftBatch, {
    commands: Array.from({ length: 200 }, (_, i) =>
      rename(tableId, `Name ${i}`),
    ),
  });
  await expect(
    user().mutation(api.app.draftBatch, {
      draftId,
      commands: [rename(tableId, "Too many")],
    }),
  ).rejects.toThrow("200 commands");
  expect(
    (await user().query(api.app.draftPublishReview, { draftId })).commandCount,
  ).toBe(200);
  await user().mutation(api.app.publishDraft, await publication(draftId));
  expect(
    (await user().query(api.app.getDataTable, { id: tableId }))?.name,
  ).toBe("Name 199");
});
it("reports initialized project identity only inside the authenticated workspace", async () => {
  await expect(user().query(api.app.projectInfo, {})).rejects.toThrow(
    "not initialized",
  );
  const projectId = uuid();
  await t.mutation(internal.host.initializeProject, {
    workspaceId: "w",
    projectId,
    name: "Workspace",
    version: "0.3.0",
    schemaVersion: 1,
    createdBy: "u",
  });
  const info = await user().query(api.app.projectInfo, {});
  expect(info).toMatchObject({
    projectId,
    name: "Workspace",
    version: "0.3.0",
    schemaVersion: 1,
    createdBy: "u",
  });
  expect(new Date(info.createdAt).toISOString()).toBe(info.createdAt);
  await expect(user("other").query(api.app.projectInfo, {})).rejects.toThrow(
    "not initialized",
  );
});
