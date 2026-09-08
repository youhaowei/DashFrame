import { generateKeyPairSync } from "node:crypto";
import { convexTest } from "convex-test";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { cmd } from "@dashframe/types";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { record } from "../convex/values";

const modules = import.meta.glob("../convex/**/*.ts");
const makeTest = () => convexTest(schema, modules);
let t: ReturnType<typeof makeTest>;
function jwks() {
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return `data:application/json;base64,${Buffer.from(JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "test", alg: "RS256", use: "sig" }] })).toString("base64")}`;
}
const environment = {
  DASHFRAME_DEPLOYMENT_MODE: "hosted",
  DASHFRAME_AUTH_ISSUER: "https://runtime.test",
  DASHFRAME_AUTH_JWKS: jwks(),
  DASHFRAME_OPERATOR_AUTH_ISSUER: "https://operator.test",
  DASHFRAME_OPERATOR_AUTH_JWKS: jwks(),
};
beforeEach(() => {
  for (const [name, value] of Object.entries(environment))
    vi.stubEnv(name, value);
  t = makeTest();
});
afterEach(() => vi.unstubAllEnvs());
function host(workspaceId: string, subject = "a", service = false) {
  return t.withIdentity({
    issuer: environment.DASHFRAME_AUTH_ISSUER,
    subject: `${service ? "service" : "user"}:${subject}`,
    userId: subject,
    credentialId: subject,
    principalKind: service ? "service" : "user",
    workspaceId,
    authority: "host",
    purpose: "host-metadata",
  });
}
const operator = () =>
  t.withIdentity({
    issuer: environment.DASHFRAME_OPERATOR_AUTH_ISSUER,
    subject: "operator:test",
    authority: "operator",
  });
async function admit(subject = "a") {
  await operator().mutation(api.admission.grant, { subject });
  const result = await host("", subject).mutation(api.admission.resolve, {});
  if (!result.workspaceId) throw new Error("Expected workspace");
  return result.workspaceId;
}
const page = { paginationOpts: { cursor: null, numItems: 100 } };
const batch = { operationId: "batch", requestHash: "a".repeat(64) };
const ref = "secret:10000000-0000-4000-8000-000000000001";
const prepare = {
  ...batch,
  commands: [],
  mode: "draft" as const,
  stagedRefs: [ref],
};
async function credential(workspaceId: string) {
  await t.run((ctx) =>
    ctx.db.insert("credentialOwners", {
      workspaceId,
      subject: "a",
      credentialId: "service-a",
    }),
  );
  return host(workspaceId, "service-a", true);
}

it("binds ordinary batches to the verified principal and preserves service draft-only permissions", async () => {
  const workspaceId = await admit(),
    service = await credential(workspaceId),
    user = host(workspaceId);
  await expect(
    service.mutation(api.hostedLifecycle.prepareHostBatch, {
      ...prepare,
      mode: "commit",
    }),
  ).rejects.toThrow("User permission required");
  await service.mutation(api.hostedLifecycle.prepareHostBatch, prepare);
  await expect(
    user.query(api.hostedLifecycle.getHostBatch, batch),
  ).rejects.toThrow("identity mismatch");
  await expect(
    user.mutation(api.hostedLifecycle.executeHostBatch, batch),
  ).rejects.toThrow("identity mismatch");
  expect(
    await service.mutation(api.hostedLifecycle.executeHostBatch, batch),
  ).toMatchObject({
    status: "completed",
    result: { draftId: expect.any(String) },
  });
  expect(
    await service.mutation(api.hostedLifecycle.executeHostBatch, batch),
  ).toEqual(await service.query(api.hostedLifecycle.getHostBatch, batch));
  await expect(
    service.mutation(api.hostedLifecycle.prepareHostBatch, {
      ...prepare,
      principal: { kind: "user", userId: "a" },
    } as never),
  ).rejects.toThrow();
  await t.mutation(internal.host.revokeCredential, {
    workspaceId,
    credentialId: "service-a",
  });
  for (const invoke of [
    () => service.query(api.hostedLifecycle.getHostBatch, batch),
    () => service.mutation(api.hostedLifecycle.prepareHostBatch, prepare),
    () => service.mutation(api.hostedLifecycle.executeHostBatch, batch),
    () =>
      service.mutation(api.hostedLifecycle.settleHostBatch, {
        ...batch,
        stagedRefs: [],
      }),
  ])
    await expect(invoke()).rejects.toThrow("Credential revoked");
});

it("recovers only pending batches in the admitted workspace and retains staged resources for cleanup", async () => {
  const a = await admit(),
    b = await admit("b"),
    user = host(a),
    other = host(b, "b"),
    service = await credential(a);
  await service.mutation(api.hostedLifecycle.prepareHostBatch, prepare);
  await expect(
    user.mutation(api.hostedLifecycle.recoverHostBatch, {
      operationId: batch.operationId,
      principal: { kind: "user", userId: "b" },
      stagedRefs: [],
    } as never),
  ).rejects.toThrow();
  expect(
    await user.query(api.hostedLifecycle.listRecoverableHostBatches, page),
  ).toMatchObject({ page: [{ operationId: batch.operationId }], isDone: true });
  expect(
    await other.query(api.hostedLifecycle.listRecoverableHostBatches, page),
  ).toMatchObject({ page: [] });
  expect(
    await other.mutation(api.hostedLifecycle.recoverHostBatch, {
      operationId: batch.operationId,
    }),
  ).toBe("missing");
  expect(
    await user.mutation(api.hostedLifecycle.recoverHostBatch, {
      operationId: "missing",
    }),
  ).toBe("missing");
  expect(
    await t.run((ctx) => ctx.db.query("hostBatches").collect()),
  ).toHaveLength(1);
  expect(await t.run((ctx) => ctx.db.query("cleanupJobs").collect())).toEqual(
    [],
  );
  expect(
    await user.mutation(api.hostedLifecycle.recoverHostBatch, {
      operationId: batch.operationId,
    }),
  ).toBe("cancelled");
  expect(
    await user.mutation(api.hostedLifecycle.recoverHostBatch, {
      operationId: batch.operationId,
    }),
  ).toBe("cancelled");
  const jobs = await user.query(api.hostedLifecycle.listCleanup, page);
  expect(jobs.page).toEqual([
    { cleanupId: expect.any(String), kind: "secret", resourceId: ref },
  ]);
  const cleanupId = jobs.page[0]!.cleanupId;
  expect(
    await other.mutation(api.hostedLifecycle.claimCleanup, { cleanupId }),
  ).toBeNull();
  const claim = await user.mutation(api.hostedLifecycle.claimCleanup, {
    cleanupId,
  });
  expect(claim).toMatchObject({
    resourceId: ref,
    claimToken: expect.any(String),
  });
  expect(
    await user.mutation(api.hostedLifecycle.claimCleanup, { cleanupId }),
  ).toEqual(claim);
  await expect(
    user.mutation(api.hostedLifecycle.ackCleanup, {
      cleanupId,
      claimToken: "wrong",
    }),
  ).rejects.toThrow("claim mismatch");
  await user.mutation(api.hostedLifecycle.ackCleanup, {
    cleanupId,
    claimToken: claim!.claimToken,
  });
  expect(
    (await user.query(api.hostedLifecycle.listCleanup, page)).page,
  ).toEqual([]);
  expect(
    await t.run((ctx) => ctx.db.query("resourceTombstones").collect()),
  ).toHaveLength(1);
});

it("preserves completed outcomes when completion wins the recovery race", async () => {
  const a = await admit(),
    user = host(a);
  await user.mutation(api.hostedLifecycle.prepareHostBatch, {
    ...prepare,
    mode: "commit",
  });
  const completed = await user.mutation(
    api.hostedLifecycle.executeHostBatch,
    batch,
  );
  const before = await t.run((ctx) => ctx.db.query("hostBatches").collect());
  expect(
    await user.mutation(api.hostedLifecycle.recoverHostBatch, {
      operationId: batch.operationId,
    }),
  ).toBe("completed");
  expect(await t.run((ctx) => ctx.db.query("hostBatches").collect())).toEqual(
    before,
  );
  expect(await user.query(api.hostedLifecycle.getHostBatch, batch)).toEqual(
    completed,
  );
  expect(
    (await user.query(api.hostedLifecycle.listCleanup, page)).page,
  ).toHaveLength(1);
});

it("completes a durable import idempotently and isolates cancellation and cleanup across tenants", async () => {
  const a = await admit(),
    b = await admit("b"),
    user = host(a),
    other = host(b, "b");
  const sourceId = crypto.randomUUID(),
    tableId = crypto.randomUUID();
  await user.mutation(api.hostedMetadata.commitBatch, {
    commands: [
      cmd("CreateDataSource", { id: sourceId, name: "S", type: "csv" }),
      cmd("CreateDataTable", {
        id: tableId,
        dataSourceId: sourceId,
        name: "T",
        table: "t.csv",
      }),
    ].map((command) => ({ ...command, args: record(command.args) })),
  });
  const claim = await user.mutation(
    api.hostedLifecycle.beginLocalImport,
    batch,
  );
  expect(
    await user.mutation(api.hostedLifecycle.beginLocalImport, batch),
  ).toEqual(claim);
  expect(
    await other.query(api.hostedLifecycle.getLocalImport, batch),
  ).toBeNull();
  expect(
    await other.mutation(api.hostedLifecycle.cancelLocalImport, batch),
  ).toBe(false);
  const input = {
    ...batch,
    expectedDataSourceRevision: 1,
    dataTableId: tableId,
    dataSourceId: sourceId,
    expectedDataFrameId: null,
    frameRow: {
      id: claim.frameId,
      name: "F",
      storage: { type: "file", key: claim.frameId },
      fieldIds: [],
      rowCount: 3,
      columnCount: 0,
      lastRefreshedAt: claim.fetchedAt,
    },
    tableUpdate: { dataFrameId: claim.frameId, lastFetchedAt: claim.fetchedAt },
  };
  await user.mutation(api.hostedLifecycle.commitImportedFrame, input);
  await user.mutation(api.hostedLifecycle.commitImportedFrame, input);
  expect(
    await user.query(api.hostedLifecycle.getLocalImport, batch),
  ).toMatchObject({
    status: "complete",
    result: { dataFrameId: claim.frameId, rowCount: 3 },
  });
  expect(
    await user.mutation(api.hostedLifecycle.cancelLocalImport, batch),
  ).toBe(false);
  const pending = { ...batch, operationId: "pending-import" };
  const second = await user.mutation(
    api.hostedLifecycle.beginLocalImport,
    pending,
  );
  expect(
    await user.mutation(api.hostedLifecycle.cancelLocalImport, pending),
  ).toBe(true);
  const cancelledInput = {
    ...input,
    ...pending,
    frameRow: { ...input.frameRow, id: second.frameId },
    tableUpdate: {
      dataFrameId: second.frameId,
      lastFetchedAt: second.fetchedAt,
    },
  };
  await expect(
    user.mutation(api.hostedLifecycle.commitImportedFrame, {
      ...cancelledInput,
      operationId: undefined,
      requestHash: undefined,
    } as never),
  ).rejects.toThrow();
  await expect(
    user.mutation(api.hostedLifecycle.commitImportedFrame, {
      ...cancelledInput,
      operationId: undefined,
    } as never),
  ).rejects.toThrow();
  await expect(
    user.mutation(api.hostedLifecycle.commitImportedFrame, {
      ...cancelledInput,
      requestHash: undefined,
    } as never),
  ).rejects.toThrow();
  await expect(
    user.mutation(api.hostedLifecycle.commitImportedFrame, cancelledInput),
  ).rejects.toThrow("claim missing");
  expect(
    (await user.query(api.hostedLifecycle.listCleanup, page)).page,
  ).toContainEqual({
    cleanupId: expect.any(String),
    kind: "frame",
    resourceId: second.frameId,
  });
});

it("rejects identity-free and stale claimed imports after workspace clear", async () => {
  const workspaceId = await admit(),
    user = host(workspaceId),
    sourceId = crypto.randomUUID(),
    tableId = crypto.randomUUID();
  const createArtifacts = () =>
    user.mutation(api.hostedMetadata.commitBatch, {
      commands: [
        cmd("CreateDataSource", { id: sourceId, name: "S", type: "csv" }),
        cmd("CreateDataTable", {
          id: tableId,
          dataSourceId: sourceId,
          name: "T",
          table: "t.csv",
        }),
      ].map((command) => ({ ...command, args: record(command.args) })),
    });
  await createArtifacts();
  const identity = {
      operationId: "cleared-import",
      requestHash: "c".repeat(64),
    },
    claim = await user.mutation(api.hostedLifecycle.beginLocalImport, identity),
    input = {
      ...identity,
      expectedDataSourceRevision: 1,
      dataTableId: tableId,
      dataSourceId: sourceId,
      expectedDataFrameId: null,
      frameRow: {
        id: claim.frameId,
        name: "F",
        storage: { type: "file", key: claim.frameId },
        fieldIds: [],
        rowCount: 3,
        columnCount: 0,
        lastRefreshedAt: claim.fetchedAt,
      },
      tableUpdate: {
        dataFrameId: claim.frameId,
        lastFetchedAt: claim.fetchedAt,
      },
    };
  await t.mutation(internal.host.clearAllData, { workspaceId });
  await createArtifacts();
  await expect(
    user.mutation(api.hostedLifecycle.commitImportedFrame, {
      ...input,
      operationId: undefined,
      requestHash: undefined,
    } as never),
  ).rejects.toThrow();
  await expect(
    user.mutation(api.hostedLifecycle.commitImportedFrame, input),
  ).rejects.toThrow("invalidated");
  expect(await user.query(api.hostedMetadata.listDataFrames, {})).toEqual([]);
});

it.each(["service", "revoked"] as const)(
  "denies %s callers owner-only import and cleanup capabilities",
  async (kind) => {
    const a = await admit(),
      service = await credential(a),
      user = host(a);
    const client = kind === "service" ? service : user;
    if (kind === "revoked")
      await operator().mutation(api.admission.revoke, { subject: "a" });
    const denied = [
      () => client.mutation(api.hostedLifecycle.beginLocalImport, batch),
      () => client.query(api.hostedLifecycle.getLocalImport, batch),
      () => client.mutation(api.hostedLifecycle.cancelLocalImport, batch),
      () =>
        client.mutation(api.hostedLifecycle.commitImportedFrame, {
          ...batch,
          expectedDataSourceRevision: 1,
          dataTableId: "table",
          dataSourceId: "source",
          expectedDataFrameId: null,
          frameRow: {},
          tableUpdate: {},
        }),
      () => client.query(api.hostedLifecycle.listCleanup, page),
      () =>
        client.mutation(api.hostedLifecycle.claimCleanup, { cleanupId: "x" }),
      () =>
        client.mutation(api.hostedLifecycle.ackCleanup, {
          cleanupId: "x",
          claimToken: "x",
        }),
      () => client.query(api.hostedLifecycle.listRecoverableHostBatches, page),
      () =>
        client.mutation(api.hostedLifecycle.recoverHostBatch, {
          operationId: batch.operationId,
        }),
    ];
    for (const invoke of denied)
      await expect(invoke()).rejects.toThrow(
        kind === "service"
          ? "User permission required"
          : "Workspace admission required",
      );
    expect(
      await t.run((ctx) => ctx.db.query("localImports").collect()),
    ).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("hostBatches").collect())).toEqual(
      [],
    );
  },
);

it("permits owner-authorized startup recovery", async () => {
  const workspaceId = await admit();
  const service = await credential(workspaceId);
  const user = host(workspaceId);
  await service.mutation(api.hostedLifecycle.prepareHostBatch, prepare);
  expect(
    (await user.query(api.hostedLifecycle.listRecoverableHostBatches, page))
      .page,
  ).toEqual([{ operationId: batch.operationId }]);
  expect(
    await user.mutation(api.hostedLifecycle.recoverHostBatch, {
      operationId: batch.operationId,
    }),
  ).toBe("cancelled");
});
