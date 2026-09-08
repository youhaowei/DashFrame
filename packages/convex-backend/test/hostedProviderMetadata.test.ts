import { generateKeyPairSync } from "node:crypto";
import type { UserIdentity } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");
const makeTest = () => convexTest(schema, modules);
let t: ReturnType<typeof makeTest>;
function keySet() {
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return `data:application/json;base64,${Buffer.from(JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "test", alg: "RS256", use: "sig" }] })).toString("base64")}`;
}
const environment = {
  DASHFRAME_DEPLOYMENT_MODE: "hosted",
  DASHFRAME_AUTH_ISSUER: "https://runtime.provider.test",
  DASHFRAME_AUTH_JWKS: keySet(),
  DASHFRAME_OPERATOR_AUTH_ISSUER: "https://operator.provider.test",
  DASHFRAME_OPERATOR_AUTH_JWKS: keySet(),
};
beforeEach(() => {
  for (const [name, value] of Object.entries(environment))
    vi.stubEnv(name, value);
  t = makeTest();
});
afterEach(() => vi.unstubAllEnvs());

const operator = () =>
  t.withIdentity({
    issuer: environment.DASHFRAME_OPERATOR_AUTH_ISSUER,
    subject: "operator:test",
    authority: "operator",
  });
function host(
  workspaceId: string,
  subject = "a",
  overrides: Partial<UserIdentity> = {},
) {
  return t.withIdentity({
    issuer: environment.DASHFRAME_AUTH_ISSUER,
    subject: `user:${subject}`,
    userId: subject,
    principalKind: "user",
    authority: "host",
    purpose: "host-metadata",
    workspaceId,
    ...overrides,
  });
}
async function admit(subject = "a") {
  await operator().mutation(api.admission.grant, { subject });
  const result = await host("", subject).mutation(api.admission.resolve, {});
  if (!result.workspaceId) throw new Error("Expected admitted workspace");
  return result.workspaceId;
}
function row(id: string, credentialRef: string | null, label = "OpenAI") {
  return {
    id,
    providerId: "openai",
    displayLabel: label,
    authKind: "api-key" as const,
    baseUrl: "https://api.openai.com/v1",
    credentialRef,
    defaultModel: "gpt-5",
    isDefault: true,
    createdAt: 1,
    updatedAt: label === "OpenAI" ? 1 : 2,
  };
}

it("isolates provider rows by admitted user and preserves CAS, defaults, and cleanup", async () => {
  const a = await admit(),
    b = await admit("b"),
    id = crypto.randomUUID(),
    ref = `secret:${crypto.randomUUID()}`;
  const original = row(id, ref);
  expect(
    await host(a).mutation(api.hostedProviderMetadata.save, {
      row: original,
      expected: null,
    }),
  ).toEqual(original);
  expect(await host(a).query(api.hostedProviderMetadata.list, {})).toEqual([
    original,
  ]);
  expect(await host(a).query(api.hostedProviderMetadata.get, { id })).toEqual(
    original,
  );
  expect(await host(b, "b").query(api.hostedProviderMetadata.get, { id })).toBe(
    null,
  );
  await host(b, "b").mutation(api.hostedProviderMetadata.save, {
    row: row(id, null, "Other workspace"),
    expected: null,
  });
  await expect(
    host(a).mutation(api.hostedProviderMetadata.save, {
      row: row(id, null, "Stale"),
      expected: null,
    }),
  ).rejects.toThrow("changed");
  const updated = row(id, null, "Renamed");
  await host(a).mutation(api.hostedProviderMetadata.save, {
    row: updated,
    expected: original,
  });
  expect(await t.run((ctx) => ctx.db.query("cleanupJobs").take(10))).toEqual([
    expect.objectContaining({
      workspaceId: a,
      kind: "secret",
      resourceId: ref,
    }),
  ]);
  await host(a).mutation(api.hostedProviderMetadata.remove, {
    id,
    expected: updated,
  });
  expect(await host(a).query(api.hostedProviderMetadata.list, {})).toEqual([]);
  expect(
    await host(b, "b").query(api.hostedProviderMetadata.list, {}),
  ).toHaveLength(1);
});

it("demotes only the prior default in the same workspace", async () => {
  const a = await admit(),
    b = await admit("b"),
    firstId = crypto.randomUUID(),
    secondId = crypto.randomUUID(),
    first = row(firstId, null),
    second = row(secondId, null, "Anthropic");
  await host(a).mutation(api.hostedProviderMetadata.save, {
    row: first,
    expected: null,
  });
  await host(b, "b").mutation(api.hostedProviderMetadata.save, {
    row: first,
    expected: null,
  });
  await host(a).mutation(api.hostedProviderMetadata.save, {
    row: second,
    expected: null,
  });

  const providersA = await host(a).query(api.hostedProviderMetadata.list, {});
  expect(providersA).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: firstId,
        isDefault: false,
        updatedAt: expect.any(Number),
      }),
      second,
    ]),
  );
  expect(
    providersA.find((provider) => provider.id === firstId)?.updatedAt,
  ).toBeGreaterThan(first.updatedAt);
  expect(await host(b, "b").query(api.hostedProviderMetadata.list, {})).toEqual(
    [first],
  );
});

it("admits only current user host-metadata authority and rejects body scope", async () => {
  const a = await admit(),
    id = crypto.randomUUID(),
    value = row(id, null);
  for (const caller of [
    host(a, "a", {
      principalKind: "service",
      subject: "service:credential",
      credentialId: "credential",
    }),
    host(a, "a", { authority: "browser" }),
    host(a, "a", { purpose: "host-control" }),
    host(a, "a", { issuer: "https://untrusted.test" }),
    host(a, "other"),
  ]) {
    await expect(
      caller.query(api.hostedProviderMetadata.list, {}),
    ).rejects.toThrow();
    await expect(
      caller.mutation(api.hostedProviderMetadata.save, {
        row: value,
        expected: null,
      }),
    ).rejects.toThrow();
  }
  await expect(
    host(a).mutation(api.hostedProviderMetadata.save, {
      row: value,
      expected: null,
      workspaceId: "chosen",
    } as never),
  ).rejects.toThrow();
  await operator().mutation(api.admission.revoke, { subject: "a" });
  await expect(
    host(a).query(api.hostedProviderMetadata.list, {}),
  ).rejects.toThrow("admission");
});

it("rejects malformed rows and retired references before writes", async () => {
  const a = await admit(),
    id = crypto.randomUUID(),
    ref = `secret:${crypto.randomUUID()}`;
  await t.run((ctx) =>
    ctx.db.insert("resourceTombstones", {
      workspaceId: a,
      kind: "secret",
      resourceId: ref,
    }),
  );
  await expect(
    host(a).mutation(api.hostedProviderMetadata.save, {
      row: row(id, ref),
      expected: null,
    }),
  ).rejects.toThrow("retired");
  for (const invalid of [
    { ...row(id, null), credentialRef: "plaintext" },
    { ...row(id, null), baseUrl: "https://user:secret@example.com/v1" },
    { ...row(id, null), defaultModel: " model " },
    { ...row(id, null), updatedAt: 0 },
  ])
    await expect(
      host(a).mutation(api.hostedProviderMetadata.save, {
        row: invalid as never,
        expected: null,
      }),
    ).rejects.toThrow();
  expect(await host(a).query(api.hostedProviderMetadata.list, {})).toEqual([]);
});
