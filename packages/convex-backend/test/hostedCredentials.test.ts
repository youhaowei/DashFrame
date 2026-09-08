import { generateKeyPairSync, randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import type { UserIdentity } from "convex/server";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.ts");
const makeTest = () => convexTest(schema, modules);
let t: ReturnType<typeof makeTest>;
const runtimeIssuer = "https://runtime.credentials.test";
const operatorIssuer = "https://operator.credentials.test";
function jwks() {
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return `data:application/json;base64,${Buffer.from(JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "test", alg: "RS256", use: "sig" }] })).toString("base64")}`;
}
const environment = {
  DASHFRAME_DEPLOYMENT_MODE: "hosted",
  DASHFRAME_AUTH_ISSUER: runtimeIssuer,
  DASHFRAME_AUTH_JWKS: jwks(),
  DASHFRAME_OPERATOR_AUTH_ISSUER: operatorIssuer,
  DASHFRAME_OPERATOR_AUTH_JWKS: jwks(),
};
beforeEach(() => {
  for (const [name, value] of Object.entries(environment))
    vi.stubEnv(name, value);
  t = makeTest();
});
afterEach(() => vi.unstubAllEnvs());

function operator() {
  return t.withIdentity({
    issuer: operatorIssuer,
    subject: "operator:test",
    authority: "operator",
  });
}
function host(
  subject: string,
  workspaceId = "unallocated",
  override: Partial<UserIdentity> = {},
) {
  return t.withIdentity({
    issuer: runtimeIssuer,
    subject: `user:${subject}`,
    userId: subject,
    authority: "host",
    purpose: "host-credentials",
    principalKind: "user",
    workspaceId,
    ...override,
  });
}
async function admit(subject: string) {
  await operator().mutation(api.admission.grant, { subject });
  const result = await host(subject).mutation(api.admission.resolve, {});
  if (!result.workspaceId) throw new Error("Expected workspace");
  return result.workspaceId;
}
function service(workspaceId: string, credentialId: string) {
  return t.withIdentity({
    issuer: runtimeIssuer,
    subject: `service:${credentialId}`,
    principalKind: "service",
    credentialId,
    authority: "service",
    workspaceId,
  });
}

it("binds globally, retries only the identical active owner, and revokes without releasing ownership", async () => {
  const a = await admit("a");
  const b = await admit("b");
  const credentialId = randomUUID();
  const args = { credentialId };
  const client = host("a", a);
  const expected = { credentialId, subject: "a", workspaceId: a };
  expect(await client.mutation(api.hostedCredentials.register, args)).toEqual(
    expected,
  );
  expect(await client.mutation(api.hostedCredentials.register, args)).toEqual(
    expected,
  );
  await expect(
    host("b", b).mutation(api.hostedCredentials.register, args),
  ).rejects.toThrow("conflict");
  await expect(
    host("b", b).mutation(api.hostedCredentials.revoke, args),
  ).rejects.toThrow("ownership");
  const bearer = service(a, credentialId);
  expect(await bearer.query(api.app.listDataSources, {})).toEqual([]);
  await client.mutation(api.hostedCredentials.revoke, args);
  await client.mutation(api.hostedCredentials.revoke, args);
  await expect(bearer.query(api.app.listDataSources, {})).rejects.toThrow(
    "revoked",
  );
  await expect(
    client.mutation(api.hostedCredentials.register, args),
  ).rejects.toThrow("revoked");
  await operator().mutation(api.admission.revoke, { subject: "a" });
  await expect(
    host("b", b).mutation(api.hostedCredentials.register, args),
  ).rejects.toThrow("conflict");
  await operator().mutation(api.admission.grant, { subject: "a" });
  await expect(
    client.mutation(api.hostedCredentials.register, args),
  ).rejects.toThrow("revoked");
  const rows = await t.run(async (ctx) => ({
    owners: await ctx.db.query("credentialOwners").take(10),
    revoked: await ctx.db.query("revokedCredentials").take(10),
  }));
  expect(rows.owners).toHaveLength(1);
  expect(rows.owners[0]).toMatchObject(expected);
  expect(rows.revoked).toHaveLength(1);
});

it("denies authority, principal, purpose, admission, and caller-selected ownership substitution", async () => {
  const a = await admit("a");
  const b = await admit("b");
  const args = { credentialId: randomUUID() };
  await host("a", a).mutation(api.hostedCredentials.register, args);
  for (const caller of [
    t,
    operator(),
    service(a, args.credentialId),
    host("a", a, { authority: "browser" }),
    host("a", a, { purpose: undefined }),
    host("a", a, { purpose: "host-metadata" }),
    host("a", a, { principalKind: "service" }),
    host("a", a, { principalKind: undefined }),
    host("a", a, { subject: "user:b" }),
    host("a", a, { issuer: operatorIssuer }),
    host("a", b),
    host("pending", a),
  ]) {
    await expect(
      caller.mutation(api.hostedCredentials.register, args),
    ).rejects.toThrow();
    await expect(
      caller.mutation(api.hostedCredentials.revoke, args),
    ).rejects.toThrow();
  }
  await operator().mutation(api.admission.grant, { subject: "unallocated" });
  await expect(
    host("unallocated", a).mutation(api.hostedCredentials.register, args),
  ).rejects.toThrow("admission");
  for (const override of [
    { subject: "b" },
    { workspaceId: b },
    { token: "must-not-be-stored" },
  ]) {
    const input = { ...args, ...override };
    await expect(
      host("a", a).mutation(api.hostedCredentials.register, input),
    ).rejects.toThrow();
    await expect(
      host("a", a).mutation(api.hostedCredentials.revoke, input),
    ).rejects.toThrow();
  }
  await operator().mutation(api.admission.revoke, { subject: "a" });
  await expect(
    host("a", a).mutation(api.hostedCredentials.register, args),
  ).rejects.toThrow("admission");
  await expect(
    host("a", a).mutation(api.hostedCredentials.revoke, args),
  ).rejects.toThrow("admission");
});

it("rejects malformed IDs and never registers historical revocations, even without an ownership row", async () => {
  const a = await admit("a");
  const b = await admit("b");
  for (const credentialId of [
    "",
    " credential ",
    "not-a-uuid",
    "x".repeat(257),
  ])
    await expect(
      host("a", a).mutation(api.hostedCredentials.register, { credentialId }),
    ).rejects.toThrow("ID");
  const credentialId = randomUUID();
  await t.mutation(internal.host.revokeCredential, {
    workspaceId: a,
    credentialId,
  });
  for (const [subject, workspaceId] of [
    ["a", a],
    ["b", b],
  ] as const)
    await expect(
      host(subject, workspaceId).mutation(api.hostedCredentials.register, {
        credentialId,
      }),
    ).rejects.toThrow("revoked");
  await expect(
    host("a", a).mutation(api.hostedCredentials.revoke, {
      credentialId: randomUUID(),
    }),
  ).rejects.toThrow("ownership");
  expect(
    await t.run((ctx) => ctx.db.query("credentialOwners").take(10)),
  ).toEqual([]);
});
