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
const uuid = () => crypto.randomUUID();
const secret = () => `secret:${uuid()}`;
const user = (workspaceId = "w") =>
  t.withIdentity({
    subject: "u",
    workspaceId,
    principalKind: "user",
    userId: "u",
  });
const principal = { kind: "user" as const, userId: "u" };
const list = () =>
  t.query(internal.host.listCleanup, {
    workspaceId: "w",
    paginationOpts: { cursor: null, numItems: 100 },
  });
async function claim(kind: "secret" | "frame", resourceId: string) {
  const job = (await list()).page.find(
    (job) => job.kind === kind && job.resourceId === resourceId,
  );
  expect(job).toBeDefined();
  return t.mutation(internal.host.claimCleanup, {
    workspaceId: "w",
    cleanupId: job!.cleanupId,
  });
}
async function seed() {
  const sourceId = uuid(),
    tableId = uuid(),
    frameId = uuid(),
    ref = secret();
  await t.mutation(internal.host.commitBatch, {
    workspaceId: "w",
    principal,
    commands: [
      {
        path: "createDataSource",
        args: { id: sourceId, name: "Source", type: "csv", apiKey: ref },
      },
      {
        path: "createDataTable",
        args: {
          id: tableId,
          name: "Table",
          dataSourceId: sourceId,
          table: "t.csv",
        },
      },
    ],
  });
  await t.mutation(internal.host.commitImportedFrame, {
    workspaceId: "w",
    dataSourceId: sourceId,
    dataTableId: tableId,
    expectedDataFrameId: null,
    frameRow: {
      id: frameId,
      name: "Frame",
      storage: { type: "file", key: frameId },
      fieldIds: [],
      rowCount: 0,
      columnCount: 0,
      sourceId,
      definitionId: tableId,
    },
    tableUpdate: { dataFrameId: frameId },
  });
  return { sourceId, tableId, frameId, ref };
}
it.each(["commit", "publish"])(
  "queues physical cleanup through a direct public %s",
  async (mode) => {
    const { sourceId, frameId, ref } = await seed();
    const commands = [cmd("DeleteNode", { id: sourceId })];
    if (mode === "commit")
      await user().mutation(api.app.commitBatch, { commands });
    else {
      const { draftId } = await user().mutation(api.app.draftBatch, {
        commands,
      });
      await user().mutation(api.app.publishDraft, { draftId });
    }
    expect(
      (await list()).page.map(({ kind, resourceId }) => ({ kind, resourceId })),
    ).toEqual(
      expect.arrayContaining([
        { kind: "frame", resourceId: frameId },
        { kind: "secret", resourceId: ref },
      ]),
    );
    expect(await claim("frame", frameId)).not.toBeNull();
    expect(await claim("secret", ref)).not.toBeNull();
  },
);
it("protects resources retained by a draft until discard", async () => {
  const { sourceId, tableId, frameId, ref } = await seed();
  const { draftId } = await user().mutation(api.app.draftBatch, {
    commands: [
      cmd("RenameNode", { id: sourceId, name: "Draft source" }),
      cmd("RenameNode", { id: tableId, name: "Draft table" }),
    ],
  });
  await user().mutation(api.app.commitBatch, {
    commands: [cmd("SetDataSourceConfig", { id: sourceId, apiKey: "" })],
  });
  await t.mutation(internal.host.removeDataFrame, {
    workspaceId: "w",
    id: frameId,
  });
  expect(await claim("secret", ref)).toBeNull();
  expect(await claim("frame", frameId)).toBeNull();
  await user().mutation(api.app.discardDraft, { draftId });
  expect(await claim("secret", ref)).not.toBeNull();
  expect(await claim("frame", frameId)).not.toBeNull();
});
it("rechecks references before claiming and permanently blocks resource reuse", async () => {
  const { sourceId, frameId, ref } = await seed();
  await t.mutation(internal.host.clearAllData, { workspaceId: "w" });
  const claimed = await claim("secret", ref);
  expect(claimed).not.toBeNull();
  await expect(
    t.mutation(internal.host.ackCleanup, {
      workspaceId: "w",
      cleanupId: claimed!.cleanupId,
      claimToken: "wrong",
    }),
  ).rejects.toThrow("mismatch");
  expect(
    await t.mutation(internal.host.claimCleanup, {
      workspaceId: "w",
      cleanupId: claimed!.cleanupId,
    }),
  ).toEqual(claimed);
  await t.mutation(internal.host.ackCleanup, {
    workspaceId: "w",
    cleanupId: claimed!.cleanupId,
    claimToken: claimed!.claimToken,
  });
  await t.mutation(internal.host.ackCleanup, {
    workspaceId: "w",
    cleanupId: claimed!.cleanupId,
    claimToken: claimed!.claimToken,
  });
  await expect(
    t.mutation(internal.host.commitBatch, {
      workspaceId: "w",
      principal,
      commands: [
        {
          path: "createDataSource",
          args: { id: sourceId, name: "Reuse", type: "csv", apiKey: ref },
        },
      ],
    }),
  ).rejects.toThrow("retired");
  const frame = await claim("frame", frameId);
  expect(frame).not.toBeNull();
  const fresh = await seed();
  await expect(
    t.mutation(internal.host.commitImportedFrame, {
      workspaceId: "w",
      operationId: uuid(),
      dataSourceId: fresh.sourceId,
      dataTableId: fresh.tableId,
      expectedDataFrameId: fresh.frameId,
      frameRow: {
        id: frameId,
        name: "Reuse",
        storage: { type: "file", key: frameId },
        fieldIds: [],
      },
      tableUpdate: { dataFrameId: frameId },
    }),
  ).rejects.toThrow("retired");
});
it("rolls back cleanup jobs with a failed canonical batch and isolates workspace claims", async () => {
  const { sourceId } = await seed();
  await expect(
    user().mutation(api.app.commitBatch, {
      commands: [
        cmd("DeleteNode", { id: sourceId }),
        cmd("RenameNode", { id: uuid(), name: "Missing" }),
      ],
    }),
  ).rejects.toThrow();
  expect((await list()).page).toEqual([]);
  await user().mutation(api.app.commitBatch, {
    commands: [cmd("DeleteNode", { id: sourceId })],
  });
  const job = (await list()).page[0]!;
  expect(
    await t.mutation(internal.host.claimCleanup, {
      workspaceId: "other",
      cleanupId: job.cleanupId,
    }),
  ).toBeNull();
  expect(
    (
      await t.query(internal.host.listCleanup, {
        workspaceId: "other",
        paginationOpts: { cursor: null, numItems: 100 },
      })
    ).page,
  ).toEqual([]);
});
it("queues replaced OAuth refs but preserves the newly installed credential", async () => {
  const { sourceId, ref } = await seed(),
    next = secret();
  await t.mutation(internal.host.replaceDataSourceConfig, {
    workspaceId: "w",
    id: sourceId,
    expectedConfig: { apiKey: ref },
    config: { apiKey: next },
  });
  expect(await claim("secret", ref)).not.toBeNull();
  expect((await list()).page.some((job) => job.resourceId === next)).toBe(
    false,
  );
  await expect(
    t.mutation(internal.host.replaceDataSourceConfig, {
      workspaceId: "w",
      id: sourceId,
      expectedConfig: { apiKey: next },
      config: { apiKey: ref },
    }),
  ).rejects.toThrow("retired");
  expect(
    (
      await t.query(internal.host.getDataSource, {
        workspaceId: "w",
        id: sourceId,
      })
    )?.config.apiKey,
  ).toBe(next);
});
type Prepare = FunctionArgs<typeof internal.host.prepareHostBatch>;
function batch(overrides: Partial<Prepare> = {}): Prepare {
  const ref = secret();
  return {
    workspaceId: "w",
    operationId: uuid(),
    principal,
    requestHash: "a".repeat(64),
    mode: "commit",
    stagedRefs: [ref],
    commands: [
      {
        path: "createDataSource",
        args: { id: uuid(), name: "Staged", type: "csv", apiKey: ref },
      },
    ],
    ...overrides,
  };
}
function identity(value: Prepare) {
  return {
    workspaceId: value.workspaceId,
    operationId: value.operationId,
    principal: value.principal,
    requestHash: value.requestHash,
  };
}
it("journals only staged commands and keeps pending refs protected", async () => {
  const args = batch();
  await expect(
    t.mutation(internal.host.prepareHostBatch, {
      ...args,
      commands: [
        {
          path: "createDataSource",
          args: { id: uuid(), name: "Bad", type: "csv", apiKey: "plaintext" },
        },
      ],
    }),
  ).rejects.toThrow("staged");
  expect(await t.query(internal.host.getHostBatch, identity(args))).toBeNull();
  expect(await t.mutation(internal.host.prepareHostBatch, args)).toEqual({
    status: "pending",
    result: null,
  });
  const duplicateRef = secret();
  await t.mutation(internal.host.prepareHostBatch, {
    ...args,
    stagedRefs: [...args.stagedRefs, duplicateRef],
  });
  expect(await claim("secret", duplicateRef)).not.toBeNull();
  const pending = (
    await t.query(internal.host.listPendingHostBatches, {
      workspaceId: "w",
      paginationOpts: { cursor: null, numItems: 100 },
    })
  ).page;
  expect(pending).toEqual([
    {
      operationId: args.operationId,
      principal,
      requestHash: args.requestHash,
      stagedRefs: args.stagedRefs,
    },
  ]);
});
it("returns the committed result after a lost acknowledgement and cleans only losing staged refs", async () => {
  const first = batch(),
    other = secret();
  await t.mutation(internal.host.prepareHostBatch, first);
  await t.mutation(internal.host.prepareHostBatch, {
    ...first,
    stagedRefs: [other],
    commands: [
      {
        ...first.commands[0]!,
        args: { ...first.commands[0]!.args, apiKey: other },
      },
    ],
  });
  const completed = await t.mutation(
    internal.host.executeHostBatch,
    identity(first),
  );
  expect(completed.status).toBe("completed");
  expect(
    await t.mutation(internal.host.executeHostBatch, identity(first)),
  ).toEqual(completed);
  expect(
    await t.mutation(internal.host.settleHostBatch, {
      ...identity(first),
      stagedRefs: [other],
    }),
  ).toEqual(completed);
  expect(await claim("secret", first.stagedRefs[0]!)).toBeNull();
  expect(await claim("secret", other)).not.toBeNull();
  expect(await user().query(api.app.listDataSources, {})).toHaveLength(1);
  expect(JSON.stringify(completed)).not.toContain("secret:");
});
it("cancels rejected batches and prevents their delayed commit", async () => {
  const args = batch();
  args.commands.push({
    path: "renameNode",
    args: { id: uuid(), name: "Missing" },
  });
  await t.mutation(internal.host.prepareHostBatch, args);
  await expect(
    t.mutation(internal.host.executeHostBatch, identity(args)),
  ).rejects.toThrow();
  expect(
    (await t.query(internal.host.getHostBatch, identity(args)))?.status,
  ).toBe("pending");
  expect(
    await t.mutation(internal.host.settleHostBatch, {
      ...identity(args),
      stagedRefs: args.stagedRefs,
    }),
  ).toEqual({ status: "cancelled", result: null });
  expect(
    await t.mutation(internal.host.executeHostBatch, identity(args)),
  ).toEqual({ status: "cancelled", result: null });
  expect(await user().query(api.app.listDataSources, {})).toEqual([]);
  expect(await claim("secret", args.stagedRefs[0]!)).not.toBeNull();
});
it("serializes missing settlement before a delayed prepare and binds identity and hash", async () => {
  const args = batch();
  await t.mutation(internal.host.settleHostBatch, {
    ...identity(args),
    stagedRefs: args.stagedRefs,
  });
  expect((await t.mutation(internal.host.prepareHostBatch, args)).status).toBe(
    "cancelled",
  );
  await expect(
    t.mutation(internal.host.prepareHostBatch, {
      ...args,
      principal: { kind: "user", userId: "other" },
    }),
  ).rejects.toThrow("identity mismatch");
  await expect(
    t.query(internal.host.getHostBatch, {
      ...identity(args),
      requestHash: "b".repeat(64),
    }),
  ).rejects.toThrow("identity mismatch");
  expect(
    (
      await t.mutation(internal.host.prepareHostBatch, {
        ...args,
        workspaceId: "other",
      })
    ).status,
  ).toBe("pending");
});
it("keeps completed host-draft refs protected until publication and later canonical deletion", async () => {
  const args = batch({ mode: "draft" });
  await t.mutation(internal.host.prepareHostBatch, args);
  const completed = await t.mutation(
    internal.host.executeHostBatch,
    identity(args),
  );
  if (!completed.result || !("draftId" in completed.result))
    throw new Error("Expected draft result");
  expect(await claim("secret", args.stagedRefs[0]!)).toBeNull();
  await user().mutation(api.app.publishDraft, {
    draftId: completed.result.draftId,
  });
  expect(await claim("secret", args.stagedRefs[0]!)).toBeNull();
  await user().mutation(api.app.commitBatch, {
    commands: [cmd("DeleteNode", { id: String(args.commands[0]!.args.id) })],
  });
  expect(await claim("secret", args.stagedRefs[0]!)).not.toBeNull();
});
it("serializes settlement against execution without losing referenced secrets", async () => {
  const args = batch();
  await t.mutation(internal.host.prepareHostBatch, args);
  await Promise.all([
    t.mutation(internal.host.executeHostBatch, identity(args)),
    t.mutation(internal.host.settleHostBatch, {
      ...identity(args),
      stagedRefs: args.stagedRefs,
    }),
  ]);
  const final = await t.query(internal.host.getHostBatch, identity(args));
  const sources = await user().query(api.app.listDataSources, {});
  if (final?.status === "completed") {
    expect(sources).toHaveLength(1);
    expect(await claim("secret", args.stagedRefs[0]!)).toBeNull();
  } else {
    expect(final?.status).toBe("cancelled");
    expect(sources).toEqual([]);
    expect(await claim("secret", args.stagedRefs[0]!)).not.toBeNull();
  }
});
it("cancels pending host writes during clear and refuses service canonical batches", async () => {
  const args = batch();
  await t.mutation(internal.host.prepareHostBatch, args);
  await t.mutation(internal.host.clearAllData, { workspaceId: "w" });
  expect(
    (await t.mutation(internal.host.executeHostBatch, identity(args))).status,
  ).toBe("cancelled");
  expect(await claim("secret", args.stagedRefs[0]!)).not.toBeNull();
  await expect(
    t.mutation(
      internal.host.prepareHostBatch,
      batch({ principal: { kind: "service", credentialId: "bot" } }),
    ),
  ).rejects.toThrow("User permission");
});
it("settles losing preparations with a different hash without altering the winning operation", async () => {
  const winner = batch(),
    loserRef = secret();
  await t.mutation(internal.host.prepareHostBatch, winner);
  const loser = {
    ...winner,
    requestHash: "b".repeat(64),
    stagedRefs: [loserRef],
  };
  await expect(
    t.mutation(internal.host.prepareHostBatch, loser),
  ).rejects.toThrow("identity mismatch");
  expect(
    await t.mutation(internal.host.settleHostBatch, {
      ...identity(loser),
      stagedRefs: [loserRef, ...winner.stagedRefs],
    }),
  ).toEqual({ status: "cancelled", result: null });
  expect(await t.query(internal.host.getHostBatch, identity(winner))).toEqual({
    status: "pending",
    result: null,
  });
  expect(await claim("secret", loserRef)).not.toBeNull();
  expect(await claim("secret", winner.stagedRefs[0]!)).toBeNull();
  expect(
    (await t.mutation(internal.host.executeHostBatch, identity(winner))).status,
  ).toBe("completed");
  await expect(
    t.query(internal.host.getHostBatch, identity(loser)),
  ).rejects.toThrow("identity mismatch");
});
it("queues staged refs removed by draft revision and protects refs shared by canonical rows", async () => {
  const args = batch({ mode: "draft" });
  await t.mutation(internal.host.prepareHostBatch, args);
  const completed = await t.mutation(
    internal.host.executeHostBatch,
    identity(args),
  );
  if (!completed.result || !("draftId" in completed.result))
    throw new Error("Expected draft result");
  const draftId = completed.result.draftId;
  const review = await user().query(api.app.draftPublishReview, { draftId });
  await user().mutation(api.app.reviseDraft, {
    draftId,
    expectedLogSignature: review.logSignature,
    ops: [{ type: "removeCommand", commandIndex: 0 }],
  });
  expect(await claim("secret", args.stagedRefs[0]!)).not.toBeNull();
  const { sourceId, ref } = await seed(),
    secondId = uuid();
  await t.mutation(internal.host.commitBatch, {
    workspaceId: "w",
    principal,
    commands: [
      {
        path: "createDataSource",
        args: { id: secondId, name: "Shared", type: "csv", apiKey: ref },
      },
    ],
  });
  await user().mutation(api.app.commitBatch, {
    commands: [cmd("DeleteNode", { id: sourceId })],
  });
  expect(await claim("secret", ref)).toBeNull();
  await user().mutation(api.app.commitBatch, {
    commands: [cmd("DeleteNode", { id: secondId })],
  });
  expect(await claim("secret", ref)).not.toBeNull();
});
it("queues provider rotation and removal while keeping the replacement credential live", async () => {
  const ref = secret(),
    next = secret(),
    row = {
      id: uuid(),
      providerId: "openai",
      displayLabel: "Test",
      authKind: "api-key" as const,
      baseUrl: null,
      credentialRef: ref,
      defaultModel: "model",
      isDefault: true,
      createdAt: 1,
      updatedAt: 1,
    };
  await t.mutation(internal.host.saveAssistantProviderConfig, {
    workspaceId: "w",
    row,
    expected: null,
  });
  const updated = { ...row, credentialRef: next, updatedAt: 2 };
  await t.mutation(internal.host.saveAssistantProviderConfig, {
    workspaceId: "w",
    row: updated,
    expected: row,
  });
  expect(await claim("secret", ref)).not.toBeNull();
  expect((await list()).page.some((job) => job.resourceId === next)).toBe(
    false,
  );
  await t.mutation(internal.host.removeAssistantProviderConfig, {
    workspaceId: "w",
    id: row.id,
    expected: updated,
  });
  expect(await claim("secret", next)).not.toBeNull();
});
it("does not let a revoked service execute a prepared draft while allowing cancellation", async () => {
  const args = batch({
    mode: "draft",
    principal: { kind: "service", credentialId: "bot" },
    commands: [],
    stagedRefs: [],
  });
  await t.mutation(internal.host.prepareHostBatch, args);
  await t.mutation(internal.host.revokeCredential, {
    workspaceId: "w",
    credentialId: "bot",
  });
  await expect(
    t.mutation(internal.host.executeHostBatch, identity(args)),
  ).rejects.toThrow("revoked");
  expect(
    (
      await t.mutation(internal.host.settleHostBatch, {
        ...identity(args),
        stagedRefs: [],
      })
    ).status,
  ).toBe("cancelled");
  expect(await user().query(api.app.listDrafts, {})).toEqual([]);
});
