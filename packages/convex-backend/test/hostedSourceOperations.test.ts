import { generateKeyPairSync } from "node:crypto";
import { convexTest } from "convex-test";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";

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

const secret = () => `secret:${crypto.randomUUID()}`;
async function seed(workspaceId: string, subject = "a") {
  const user = host(workspaceId, subject),
    sourceId = crypto.randomUUID(),
    tableId = crypto.randomUUID(),
    frameId = crypto.randomUUID(),
    ref = secret();
  await user.mutation(api.hostedMetadata.commitBatch, {
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
  await user.mutation(api.hostedLifecycle.commitImportedFrame, {
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
    },
    tableUpdate: { dataFrameId: frameId },
  });
  return { user, sourceId, tableId, frameId, ref };
}

it("replaces only opaque credential references and leaves the CAS winner's live secret out of cleanup", async () => {
  const a = await admit(),
    { user, sourceId, ref } = await seed(a),
    next = secret(),
    loser = secret();
  await expect(
    user.mutation(api.hostedSourceOperations.replaceDataSourceConfig, {
      id: sourceId,
      expectedConfig: { apiKey: ref },
      config: { apiKey: "raw-synthetic-value" },
    }),
  ).rejects.toThrow("staged SecretRef");
  expect(
    (await user.query(api.hostedLifecycle.listCleanup, page)).page,
  ).toEqual([]);
  await user.mutation(api.hostedSourceOperations.replaceDataSourceConfig, {
    id: sourceId,
    expectedConfig: { apiKey: ref },
    config: { apiKey: next },
  });
  await expect(
    user.mutation(api.hostedSourceOperations.replaceDataSourceConfig, {
      id: sourceId,
      expectedConfig: { apiKey: ref },
      config: { apiKey: loser },
    }),
  ).rejects.toThrow("config changed");
  expect(
    (await user.query(api.hostedMetadata.getDataSource, { id: sourceId }))
      ?.config,
  ).toEqual({ apiKey: next });
  const jobs = (await user.query(api.hostedLifecycle.listCleanup, page)).page;
  expect(jobs).toEqual([
    { cleanupId: expect.any(String), kind: "secret", resourceId: ref },
  ]);
  await user.mutation(api.hostedLifecycle.claimCleanup, {
    cleanupId: jobs[0]!.cleanupId,
  });
  await expect(
    user.mutation(api.hostedSourceOperations.replaceDataSourceConfig, {
      id: sourceId,
      expectedConfig: { apiKey: next },
      config: { apiKey: ref },
    }),
  ).rejects.toThrow("retired");
});

it("preserves source binding and field identities when preparing remote table metadata", async () => {
  const a = await admit(),
    b = await admit("b"),
    { user, sourceId, tableId } = await seed(a),
    other = host(b, "b");
  const fields = [
    {
      id: crypto.randomUUID(),
      tableId,
      name: "Value",
      columnName: "value",
      type: "number",
    },
  ];
  const input = { id: tableId, dataSourceId: sourceId, table: "t.csv", fields };
  await expect(
    other.mutation(api.hostedSourceOperations.prepareRemoteDataTable, input),
  ).rejects.toThrow("SOURCE_BINDING_CHANGED");
  expect(
    await user.mutation(
      api.hostedSourceOperations.prepareRemoteDataTable,
      input,
    ),
  ).toEqual(fields);
  expect(
    await user.mutation(api.hostedSourceOperations.prepareRemoteDataTable, {
      ...input,
      fields: [{ ...fields[0]!, id: crypto.randomUUID() }],
    }),
  ).toEqual(fields);
  await expect(
    user.mutation(api.hostedSourceOperations.prepareRemoteDataTable, {
      ...input,
      table: "other.csv",
    }),
  ).rejects.toThrow("SOURCE_BINDING_CHANGED");
  await expect(
    user.mutation(api.hostedSourceOperations.prepareRemoteDataTable, {
      ...input,
      fields: [{ ...fields[0]!, type: "string" }],
    }),
  ).rejects.toThrow("SOURCE_SCHEMA_CHANGED");
});

it("removes and clears only the signed workspace while preserving atomic cleanup records", async () => {
  const a = await admit(),
    b = await admit("b"),
    first = await seed(a),
    other = await seed(b, "b");
  await expect(
    other.user.mutation(api.hostedSourceOperations.replaceDataSourceConfig, {
      id: first.sourceId,
      expectedConfig: { apiKey: first.ref },
      config: {},
    }),
  ).rejects.toThrow("config changed");
  await other.user.mutation(api.hostedSourceOperations.removeDataFrame, {
    id: first.frameId,
  });
  expect(
    await first.user.query(api.hostedMetadata.getDataFrame, {
      id: first.frameId,
    }),
  ).not.toBeNull();
  await expect(
    first.user.mutation(api.hostedSourceOperations.clearAllData, {
      workspaceId: b,
    } as never),
  ).rejects.toThrow();
  await first.user.mutation(api.hostedSourceOperations.removeDataFrame, {
    id: first.frameId,
  });
  expect(
    await first.user.query(api.hostedMetadata.getDataFrame, {
      id: first.frameId,
    }),
  ).toBeNull();
  expect(
    await first.user.query(api.hostedMetadata.getDataTable, {
      id: first.tableId,
    }),
  ).toMatchObject({ dataFrameId: null, lastFetchedAt: null });
  expect(
    (await first.user.query(api.hostedLifecycle.listCleanup, page)).page,
  ).toEqual([
    { cleanupId: expect.any(String), kind: "frame", resourceId: first.frameId },
  ]);
  await first.user.mutation(api.hostedSourceOperations.clearAllData, {});
  expect(
    await first.user.query(api.hostedMetadata.getDataSource, {
      id: first.sourceId,
    }),
  ).toBeNull();
  expect(
    (await first.user.query(api.hostedLifecycle.listCleanup, page)).page,
  ).toContainEqual({
    cleanupId: expect.any(String),
    kind: "secret",
    resourceId: first.ref,
  });
  expect(
    await other.user.query(api.hostedMetadata.getDataFrame, {
      id: other.frameId,
    }),
  ).not.toBeNull();
  expect(
    (await other.user.query(api.hostedLifecycle.listCleanup, page)).page,
  ).toEqual([]);
});

it.each(["service", "revoked"] as const)(
  "denies every source operation to a %s caller without modifying metadata or cleanup",
  async (kind) => {
    const a = await admit(),
      { user, sourceId, tableId, frameId, ref } = await seed(a);
    await t.run((ctx) =>
      ctx.db.insert("credentialOwners", {
        workspaceId: a,
        subject: "a",
        credentialId: "service-a",
      }),
    );
    const client = kind === "service" ? host(a, "service-a", true) : user;
    if (kind === "revoked")
      await operator().mutation(api.admission.revoke, { subject: "a" });
    const sourceBefore = await t.run((ctx) =>
      ctx.db.query("dataSources").collect(),
    );
    for (const invoke of [
      () =>
        client.mutation(api.hostedSourceOperations.replaceDataSourceConfig, {
          id: sourceId,
          expectedConfig: { apiKey: ref },
          config: {},
        }),
      () =>
        client.mutation(api.hostedSourceOperations.prepareRemoteDataTable, {
          id: tableId,
          dataSourceId: sourceId,
          table: "t.csv",
          fields: [],
        }),
      () =>
        client.mutation(api.hostedSourceOperations.removeDataFrame, {
          id: frameId,
        }),
      () => client.mutation(api.hostedSourceOperations.clearAllData, {}),
    ])
      await expect(invoke()).rejects.toThrow(
        kind === "service"
          ? "User permission required"
          : "Workspace admission required",
      );
    expect(await t.run((ctx) => ctx.db.query("dataSources").collect())).toEqual(
      sourceBefore,
    );
    expect(
      await t.run((ctx) => ctx.db.query("dataFrames").collect()),
    ).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("cleanupJobs").collect())).toEqual(
      [],
    );
  },
);

it("rejects unknown credential keys and plaintext expected state without persistence or cleanup", async () => {
  const a = await admit(),
    { user, sourceId, ref } = await seed(a);
  const before = await t.run((ctx) => ctx.db.query("dataSources").collect());
  for (const key of ["password", "token"])
    for (const slot of ["config", "expectedConfig"] as const) {
      await expect(
        user.mutation(api.hostedSourceOperations.replaceDataSourceConfig, {
          id: sourceId,
          config: { apiKey: ref },
          expectedConfig: { apiKey: ref },
          [slot]: { apiKey: ref, [key]: "synthetic-plaintext" },
        } as never),
      ).rejects.toThrow();
    }
  for (const expectedConfig of [
    { apiKey: "synthetic-plaintext" },
    { connectionString: "synthetic-plaintext" },
    { sourceBindingVersion: "v3" },
    null,
  ]) {
    await expect(
      user.mutation(api.hostedSourceOperations.replaceDataSourceConfig, {
        id: sourceId,
        config: {},
        expectedConfig,
      } as never),
    ).rejects.toThrow();
  }
  expect(await t.run((ctx) => ctx.db.query("dataSources").collect())).toEqual(
    before,
  );
  expect(
    (await user.query(api.hostedLifecycle.listCleanup, page)).page,
  ).toEqual([]);
});
