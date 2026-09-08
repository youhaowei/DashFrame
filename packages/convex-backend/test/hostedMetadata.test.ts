import { generateKeyPairSync } from "node:crypto";
import type { UserIdentity } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cmd } from "@dashframe/types";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { record } from "../convex/values";

const modules = import.meta.glob("../convex/**/*.ts");
const makeTest = () => convexTest(schema, modules);
let t: ReturnType<typeof makeTest>;
function keySet() {
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return `data:application/json;base64,${Buffer.from(JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "test", alg: "RS256", use: "sig" }] })).toString("base64")}`;
}
const environment = {
  DASHFRAME_DEPLOYMENT_MODE: "hosted",
  DASHFRAME_AUTH_ISSUER: "https://runtime.test",
  DASHFRAME_AUTH_JWKS: keySet(),
  DASHFRAME_OPERATOR_AUTH_ISSUER: "https://operator.test",
  DASHFRAME_OPERATOR_AUTH_JWKS: keySet(),
};
beforeEach(() => {
  for (const [name, value] of Object.entries(environment))
    vi.stubEnv(name, value);
  t = makeTest();
});
afterEach(() => vi.unstubAllEnvs());
// Authorization fixtures represent identities already verified by Convex.
const operator = () =>
  t.withIdentity({
    issuer: environment.DASHFRAME_OPERATOR_AUTH_ISSUER,
    subject: "operator:test",
    authority: "operator",
  });
function host(workspaceId: string, overrides: Partial<UserIdentity> = {}) {
  return t.withIdentity({
    issuer: environment.DASHFRAME_AUTH_ISSUER,
    subject: "user:a",
    userId: "a",
    principalKind: "user",
    authority: "host",
    purpose: "host-metadata",
    workspaceId,
    ...overrides,
  });
}
const service = (workspaceId: string, credentialId = "credential-a") =>
  host(workspaceId, {
    principalKind: "service",
    subject: `service:${credentialId}`,
    credentialId,
  });
async function admit(subject = "a") {
  await operator().mutation(api.admission.grant, { subject });
  const resolved = await host("", {
    userId: subject,
    subject: `user:${subject}`,
  }).mutation(api.admission.resolve, {});
  if (!resolved.workspaceId) throw new Error("Expected admitted workspace");
  return resolved.workspaceId;
}
async function seed(workspaceId: string, subject = "a") {
  const sourceId = crypto.randomUUID(),
    tableId = crypto.randomUUID(),
    insightId = crypto.randomUUID();
  await host(workspaceId, {
    userId: subject,
    subject: `user:${subject}`,
  }).mutation(api.hostedMetadata.commitBatch, {
    commands: [
      cmd("CreateDataSource", { id: sourceId, name: "Synthetic", type: "csv" }),
      cmd("CreateDataTable", {
        id: tableId,
        dataSourceId: sourceId,
        name: "Synthetic",
        table: "synthetic.csv",
      }),
      cmd("CreateInsight", {
        id: insightId,
        name: "Synthetic",
        source: { sourceType: "dataTable", sourceId: tableId },
      }),
    ].map((command) => ({ ...command, args: record(command.args) })),
  });
  const frameId = crypto.randomUUID(),
    resultId = crypto.randomUUID();
  const provenance = { connectorKind: "local", bindingVersion: "v1" };
  const publication = {
    target: { kind: "saved" as const, insightId },
    sources: [
      {
        source: {
          table: {
            id: tableId,
            dataSourceId: sourceId,
            table: "synthetic.csv",
            name: "Synthetic",
          },
          provenance,
        },
        frame: { id: frameId, fieldIds: [], rowCount: 0, schema: [] },
      },
    ],
    result: { id: resultId, fieldIds: [], rowCount: 0, schema: [] },
    provenance,
    fetchedAt: 123,
    definitionFingerprint: "synthetic",
  };
  await host(workspaceId, {
    userId: subject,
    subject: `user:${subject}`,
  }).mutation(api.hostedMetadata.publishMaterialization, {
    value: publication,
  });
  return { sourceId, tableId, insightId, frameId, resultId, publication };
}
async function ownCredential(workspaceId: string) {
  await t.run((ctx) =>
    ctx.db.insert("credentialOwners", {
      credentialId: "credential-a",
      subject: "a",
      workspaceId,
    }),
  );
}

it("reads and publishes only the signed workspace, including operation receipts and draft ownership", async () => {
  const a = await admit(),
    b = await admit("b");
  const first = await seed(a),
    other = await seed(b, "b");
  const client = host(a);
  expect(
    (
      await client.query(api.hostedMetadata.getDataSource, {
        id: first.sourceId,
      })
    )?.id,
  ).toBe(first.sourceId);
  expect(
    (await client.query(api.hostedMetadata.getDataTable, { id: first.tableId }))
      ?.dataFrameId,
  ).toBe(first.frameId);
  expect(
    (
      await client.query(api.hostedMetadata.getDataFrame, {
        id: first.resultId,
      })
    )?.id,
  ).toBe(first.resultId);
  expect(
    (await client.query(api.hostedMetadata.getInsight, { id: first.insightId }))
      ?.id,
  ).toBe(first.insightId);
  expect(
    await client.query(api.hostedMetadata.listDataFramesByInsight, {
      insightId: first.insightId,
    }),
  ).toHaveLength(1);
  expect(
    await client.query(api.hostedMetadata.listDataFrames, {}),
  ).toHaveLength(2);
  expect(
    await client.query(api.hostedMetadata.getOperation, {
      operationId: `materialize:${first.resultId}`,
    }),
  ).not.toBeNull();
  for (const read of [
    () =>
      client.query(api.hostedMetadata.getDataSource, { id: other.sourceId }),
    () => client.query(api.hostedMetadata.getDataTable, { id: other.tableId }),
    () => client.query(api.hostedMetadata.getDataFrame, { id: other.resultId }),
    () => client.query(api.hostedMetadata.getInsight, { id: other.insightId }),
    () =>
      client.query(api.hostedMetadata.getOperation, {
        operationId: `materialize:${other.resultId}`,
      }),
  ])
    expect(await read()).toBeNull();
  expect(
    await client.query(api.hostedMetadata.listDataFramesByInsight, {
      insightId: other.insightId,
    }),
  ).toEqual([]);
  await expect(
    client.mutation(api.hostedMetadata.publishMaterialization, {
      value: other.publication,
    }),
  ).rejects.toThrow("SOURCE_BINDING_CHANGED");
  const draft = await client.mutation(api.hostedMetadata.draftBatch, {
    commands: [],
  });
  await expect(
    host(b, { userId: "b", subject: "user:b" }).mutation(
      api.hostedMetadata.draftBatch,
      { commands: [], draftId: draft.draftId },
    ),
  ).rejects.toThrow();
});

it.each(["browser", "service", "operator"])(
  "rejects %s authority even with a metadata purpose",
  async (authority) => {
    const workspaceId = await admit();
    await expect(
      host(workspaceId, { authority }).query(
        api.hostedMetadata.listDataFrames,
        {},
      ),
    ).rejects.toThrow("Invalid hosted authority");
    await expect(
      host(workspaceId, { authority }).mutation(api.hostedMetadata.draftBatch, {
        commands: [],
      }),
    ).rejects.toThrow("Invalid hosted authority");
  },
);
it.each([undefined, "host-control", "admission", ""])(
  "rejects control or missing purpose %s",
  async (purpose) => {
    const workspaceId = await admit();
    await expect(
      host(workspaceId, { purpose }).query(
        api.hostedMetadata.listDataFrames,
        {},
      ),
    ).rejects.toThrow("Host metadata purpose required");
  },
);
it("rejects caller-selected scope and identity in endpoint arguments", async () => {
  const a = await admit(),
    b = await admit("b");
  await expect(
    host(a).query(api.hostedMetadata.listDataFrames, {
      workspaceId: b,
    } as never),
  ).rejects.toThrow();
  await expect(
    host(a).mutation(api.hostedMetadata.commitBatch, {
      commands: [],
      principal: { kind: "user", userId: "b" },
    } as never),
  ).rejects.toThrow();
  await expect(
    host(a, { subject: "user:b" }).query(api.hostedMetadata.listDataFrames, {}),
  ).rejects.toThrow();
  await expect(
    host(b).query(api.hostedMetadata.listDataFrames, {}),
  ).rejects.toThrow("Workspace admission required");
  await expect(
    host(a, { issuer: "https://untrusted.test" }).query(
      api.hostedMetadata.listDataFrames,
      {},
    ),
  ).rejects.toThrow();
  await expect(host(a).query(api.app.listDataSources, {})).rejects.toThrow(
    "Invalid hosted authority",
  );
  await expect(
    host(a).mutation(api.admission.grant, { subject: "b" }),
  ).rejects.toThrow();
});

it.each(["user", "service"] as const)(
  "revocation denies every already-issued %s host capability",
  async (kind) => {
    const workspaceId = await admit(),
      data = await seed(workspaceId);
    await ownCredential(workspaceId);
    const client = kind === "user" ? host(workspaceId) : service(workspaceId);
    expect(
      await client.query(api.hostedMetadata.listDataFrames, {}),
    ).toHaveLength(2);
    await operator().mutation(api.admission.revoke, { subject: "a" });
    const denied = [
      () =>
        client.query(api.hostedMetadata.getDataSource, { id: data.sourceId }),
      () => client.query(api.hostedMetadata.getDataTable, { id: data.tableId }),
      () => client.query(api.hostedMetadata.getDataFrame, { id: data.frameId }),
      () => client.query(api.hostedMetadata.getInsight, { id: data.insightId }),
      () =>
        client.query(api.hostedMetadata.listDataFramesByInsight, {
          insightId: data.insightId,
        }),
      () => client.query(api.hostedMetadata.listDataFrames, {}),
      () =>
        client.query(api.hostedMetadata.getOperation, {
          operationId: `materialize:${data.resultId}`,
        }),
      () =>
        client.mutation(api.hostedMetadata.publishMaterialization, {
          value: data.publication,
        }),
      () => client.mutation(api.hostedMetadata.commitBatch, { commands: [] }),
      () => client.mutation(api.hostedMetadata.draftBatch, { commands: [] }),
    ];
    for (const operation of denied)
      await expect(operation()).rejects.toThrow("Workspace admission required");
    expect(await t.run((ctx) => ctx.db.query("drafts").take(10))).toEqual([]);
  },
);

it("enforces service ownership, individual revocation, and no direct commit privilege", async () => {
  const a = await admit(),
    b = await admit("b");
  await expect(
    service(a).query(api.hostedMetadata.listDataFrames, {}),
  ).rejects.toThrow("Credential ownership required");
  await ownCredential(a);
  const client = service(a);
  await expect(
    client.mutation(api.hostedMetadata.commitBatch, { commands: [] }),
  ).rejects.toThrow("User permission required");
  const draft = await client.mutation(api.hostedMetadata.draftBatch, {
    commands: [],
  });
  expect(
    (await t.run((ctx) => ctx.db.query("drafts").take(10)))[0]?.owner,
  ).toBe("service:credential-a");
  await expect(
    service(b).query(api.hostedMetadata.listDataFrames, {}),
  ).rejects.toThrow("Credential ownership required");
  await t.mutation(internal.host.revokeCredential, {
    workspaceId: a,
    credentialId: "credential-a",
  });
  await expect(
    client.query(api.hostedMetadata.listDataFrames, {}),
  ).rejects.toThrow("Credential revoked");
  await expect(
    client.mutation(api.hostedMetadata.draftBatch, {
      commands: [],
      draftId: draft.draftId,
    }),
  ).rejects.toThrow("Credential revoked");
});

it("keeps unadmitted callers and local-mode identities outside the hosted boundary without writes", async () => {
  await expect(
    host("guessed").mutation(api.hostedMetadata.draftBatch, { commands: [] }),
  ).rejects.toThrow("Workspace admission required");
  expect(await t.run((ctx) => ctx.db.query("admissions").take(10))).toEqual([]);
  expect(await t.run((ctx) => ctx.db.query("drafts").take(10))).toEqual([]);
  vi.stubEnv("DASHFRAME_DEPLOYMENT_MODE", "local");
  await expect(
    host("local").query(api.hostedMetadata.listDataFrames, {}),
  ).rejects.toThrow("unavailable in local mode");
});
