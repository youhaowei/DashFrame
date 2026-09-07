import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import type { UserIdentity } from "convex/server";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { admissionAuthConfig } from "../convex/admissionConfig";

const modules = import.meta.glob("../convex/**/*.ts");
const makeTest = () => convexTest(schema, modules);
let t: ReturnType<typeof makeTest>;
function publicKeySet() {
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return `data:application/json;base64,${Buffer.from(JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "test", alg: "RS256", use: "sig" }] })).toString("base64")}`;
}
const environment = {
  DASHFRAME_DEPLOYMENT_MODE: "hosted",
  DASHFRAME_AUTH_ISSUER: "https://runtime.test",
  DASHFRAME_AUTH_JWKS: publicKeySet(),
  DASHFRAME_OPERATOR_AUTH_ISSUER: "https://operator.test",
  DASHFRAME_OPERATOR_AUTH_JWKS: publicKeySet(),
};
beforeEach(() => {
  for (const [name, value] of Object.entries(environment))
    vi.stubEnv(name, value);
  t = makeTest();
});
afterEach(() => vi.unstubAllEnvs());

// convex-test supplies already-verified identities; these are authorization
// fixtures, not tests of JWT signature verification or deployed trust.
function host(subject = "user_a", override: Partial<UserIdentity> = {}) {
  return t.withIdentity({
    issuer: environment.DASHFRAME_AUTH_ISSUER,
    subject: `user:${subject}`,
    userId: subject,
    authority: "host",
    ...override,
  });
}
function operator(override: Partial<UserIdentity> = {}) {
  return t.withIdentity({
    issuer: environment.DASHFRAME_OPERATOR_AUTH_ISSUER,
    subject: "operator:test",
    authority: "operator",
    ...override,
  });
}
function browser(
  workspaceId: string,
  subject = "user_a",
  override: Partial<UserIdentity> = {},
) {
  return t.withIdentity({
    issuer: environment.DASHFRAME_AUTH_ISSUER,
    subject: `user:${subject}`,
    userId: subject,
    principalKind: "user",
    authority: "browser",
    workspaceId,
    ...override,
  });
}
function service(
  workspaceId: string,
  credentialId = "credential_a",
  override: Partial<UserIdentity> = {},
) {
  return t.withIdentity({
    issuer: environment.DASHFRAME_AUTH_ISSUER,
    subject: `service:${credentialId}`,
    credentialId,
    principalKind: "service",
    authority: "service",
    workspaceId,
    ...override,
  });
}
async function admit(subject = "user_a") {
  await operator().mutation(api.admission.grant, { subject });
  const result = await host(subject).mutation(api.admission.resolve, {});
  if (!result.workspaceId) throw new Error("Expected admitted workspace");
  return result.workspaceId;
}
function admissions() {
  return t.run((ctx) => ctx.db.query("admissions").take(10));
}

it("does not write for absent or revoked resolution and grant alone allocates no workspace", async () => {
  expect(await host().mutation(api.admission.resolve, {})).toEqual({
    status: "pending",
    workspaceId: null,
  });
  expect(await admissions()).toEqual([]);
  await operator().mutation(api.admission.grant, { subject: "user_a" });
  expect((await admissions())[0]?.workspaceId).toBeUndefined();
  expect(await host().query(api.admission.status, {})).toEqual({
    status: "admitted",
    workspaceId: null,
  });
  await operator().mutation(api.admission.revoke, { subject: "user_a" });
  const before = await admissions();
  expect(await host().mutation(api.admission.resolve, {})).toEqual({
    status: "revoked",
    workspaceId: null,
  });
  expect(await admissions()).toEqual(before);
  expect(await t.run((ctx) => ctx.db.query("workspaces").take(10))).toEqual([]);
});

it("allocates distinct stable mappings and preserves them through revoke and re-admission", async () => {
  const workspaceId = await admit();
  expect(workspaceId).toMatch(
    /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/,
  );
  expect(await admit("user_b")).not.toBe(workspaceId);
  const snapshot = await admissions();
  // Fresh clients read persisted state, not a process-local mapping cache.
  expect((await host().mutation(api.admission.resolve, {})).workspaceId).toBe(
    workspaceId,
  );
  expect(await admissions()).toEqual(snapshot);
  await operator().mutation(api.admission.revoke, { subject: "user_a" });
  await operator().mutation(api.admission.grant, { subject: "user_a" });
  expect((await host().mutation(api.admission.resolve, {})).workspaceId).toBe(
    workspaceId,
  );
});

it("concurrent first resolutions converge on the persisted workspace", async () => {
  await operator().mutation(api.admission.grant, { subject: "user_a" });
  const results = await Promise.all(
    Array.from({ length: 5 }, () => host().mutation(api.admission.resolve, {})),
  );
  expect(new Set(results.map((result) => result.workspaceId)).size).toBe(1);
  expect((await admissions())[0]?.workspaceId).toBe(results[0]?.workspaceId);
});

it("rejects browser/control/issuer substitution and caller-selected subject or workspace", async () => {
  const workspaceId = await admit();
  for (const caller of [
    host(),
    browser(workspaceId),
    service(workspaceId),
    operator({ issuer: environment.DASHFRAME_AUTH_ISSUER }),
  ]) {
    await expect(
      caller.mutation(api.admission.grant, { subject: "other" }),
    ).rejects.toThrow("authority");
    await expect(
      caller.mutation(api.admission.revoke, { subject: "user_a" }),
    ).rejects.toThrow("authority");
  }
  for (const caller of [
    operator(),
    browser(workspaceId),
    service(workspaceId),
    host("user_a", { issuer: environment.DASHFRAME_OPERATOR_AUTH_ISSUER }),
    host("user_a", { authority: "unknown" }),
  ]) {
    await expect(caller.mutation(api.admission.resolve, {})).rejects.toThrow(
      "authority",
    );
    await expect(caller.query(api.admission.status, {})).rejects.toThrow(
      "authority",
    );
  }
  for (const caller of [
    browser(workspaceId, "user_a", { authority: "host" }),
    browser(workspaceId, "user_a", {
      authority: "operator",
      issuer: environment.DASHFRAME_OPERATOR_AUTH_ISSUER,
    }),
    browser(workspaceId, "user_a", { authority: undefined }),
    browser(workspaceId, "user_a", {
      issuer: environment.DASHFRAME_OPERATOR_AUTH_ISSUER,
    }),
  ])
    await expect(caller.query(api.app.listDataSources, {})).rejects.toThrow(
      "authority",
    );
  await expect(
    host("user_a", { subject: "user:user_b" }).mutation(
      api.admission.resolve,
      {},
    ),
  ).rejects.toThrow("identity");
  const override = { subject: "user_b", workspaceId: "chosen" };
  await expect(
    // @ts-expect-error Deliberately malformed wire input must fail runtime validation.
    host().mutation(api.admission.resolve, override),
  ).rejects.toThrow();
  // @ts-expect-error Deliberately malformed wire input must fail runtime validation.
  await expect(host().query(api.admission.status, override)).rejects.toThrow();
});

it("checks current user admission and workspace ownership for existing browser identities", async () => {
  const a = await admit();
  const b = await admit("user_b");
  const client = browser(a);
  expect(await client.query(api.app.listDataSources, {})).toEqual([]);
  await expect(browser(b).query(api.app.listDataSources, {})).rejects.toThrow(
    "admission",
  );
  await expect(
    browser(a, "unadmitted").query(api.app.listDataSources, {}),
  ).rejects.toThrow("admission");
  await operator().mutation(api.admission.revoke, { subject: "user_a" });
  await expect(client.query(api.app.listDataSources, {})).rejects.toThrow(
    "admission",
  );
  await expect(
    client.mutation(api.app.draftBatch, { commands: [] }),
  ).rejects.toThrow("admission");
  expect(await host().query(api.admission.status, {})).toEqual({
    status: "revoked",
    workspaceId: null,
  });
});

it("denies unmapped and foreign services and checks owner admission plus credential revocation", async () => {
  const a = await admit();
  const b = await admit("user_b");
  const client = service(a);
  await expect(client.query(api.app.listDataSources, {})).rejects.toThrow(
    "ownership",
  );
  await t.run((ctx) =>
    ctx.db.insert("credentialOwners", {
      credentialId: "credential_a",
      subject: "user_a",
      workspaceId: a,
    }),
  );
  expect(await client.query(api.app.listDataSources, {})).toEqual([]);
  await expect(service(b).query(api.app.listDataSources, {})).rejects.toThrow(
    "ownership",
  );
  await expect(
    service(a, "credential_a", { subject: "service:other" }).query(
      api.app.listDataSources,
      {},
    ),
  ).rejects.toThrow("identity");
  await operator().mutation(api.admission.revoke, { subject: "user_a" });
  await expect(client.query(api.app.listDataSources, {})).rejects.toThrow(
    "admission",
  );
  await operator().mutation(api.admission.grant, { subject: "user_a" });
  await t.mutation(internal.host.revokeCredential, {
    workspaceId: a,
    credentialId: "credential_a",
  });
  await expect(client.query(api.app.listDataSources, {})).rejects.toThrow(
    "revoked",
  );
});

it("fails closed for missing or unknown mode and preserves explicit local principals", async () => {
  const local = t.withIdentity({
    subject: "local-user",
    userId: "local-user",
    principalKind: "user",
    workspaceId: "local",
  });
  for (const mode of [undefined, "unknown"]) {
    vi.stubEnv("DASHFRAME_DEPLOYMENT_MODE", mode);
    await expect(local.query(api.app.listDataSources, {})).rejects.toThrow(
      "DASHFRAME_DEPLOYMENT_MODE",
    );
  }
  vi.stubEnv("DASHFRAME_DEPLOYMENT_MODE", "local");
  expect(await local.query(api.app.listDataSources, {})).toEqual([]);
  await expect(host().query(api.admission.status, {})).rejects.toThrow(
    "local mode",
  );
  await expect(
    browser("local").query(api.app.listDataSources, {}),
  ).rejects.toThrow("local mode");
});

it("pins separate operator issuer, audience and RSA keys and rejects unsafe trust configurations", () => {
  const config = admissionAuthConfig(environment);
  expect(config.providers).toMatchObject([
    { issuer: environment.DASHFRAME_AUTH_ISSUER, applicationID: "dashframe" },
    {
      issuer: environment.DASHFRAME_OPERATOR_AUTH_ISSUER,
      applicationID: "dashframe-operator",
    },
  ]);
  expect(() =>
    admissionAuthConfig({
      ...environment,
      DASHFRAME_OPERATOR_AUTH_ISSUER: environment.DASHFRAME_AUTH_ISSUER,
    }),
  ).toThrow("issuers must differ");
  const runtime = JSON.parse(
    Buffer.from(
      environment.DASHFRAME_AUTH_JWKS.split(",")[1]!,
      "base64",
    ).toString(),
  ) as { keys: Array<{ n: string; kid: string }> };
  runtime.keys[0]!.kid = "different-kid-same-key";
  const sameKey = `data:application/json;base64,${Buffer.from(JSON.stringify(runtime)).toString("base64")}`;
  expect(() =>
    admissionAuthConfig({
      ...environment,
      DASHFRAME_OPERATOR_AUTH_JWKS: sameKey,
    }),
  ).toThrow("RSA keys must differ");
  for (const change of [
    { DASHFRAME_DEPLOYMENT_MODE: undefined },
    { DASHFRAME_OPERATOR_AUTH_JWKS: undefined },
    { DASHFRAME_OPERATOR_AUTH_JWKS: "https://mutable.test/jwks" },
    { DASHFRAME_OPERATOR_AUTH_ISSUER: "http://operator.test" },
  ])
    expect(() => admissionAuthConfig({ ...environment, ...change })).toThrow();
});
