import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import type { UserIdentity } from "convex/server";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { listAll } from "./listAll";

const modules = import.meta.glob("../convex/**/*.ts");
const makeTest = () => convexTest(schema, modules);
let t: ReturnType<typeof makeTest>;
const runtimeIssuer = "https://runtime.grants.test";
const operatorIssuer = "https://operator.grants.test";
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
    purpose: "host-agent-grants",
    principalKind: "user",
    workspaceId,
    ...override,
  });
}
const owner = (subject: string, workspaceId: string) =>
  host(subject, workspaceId, { purpose: "host-credentials" });
async function admit(subject: string) {
  await operator().mutation(api.admission.grant, { subject });
  const result = await host(subject).mutation(api.admission.resolve, {});
  if (!result.workspaceId) throw new Error("Expected workspace");
  return result.workspaceId;
}
/** The MCP route serves an OAuth agent as a service principal named by its grantId. */
function agent(workspaceId: string, grantId: string) {
  return t.withIdentity({
    issuer: runtimeIssuer,
    subject: `service:${grantId}`,
    principalKind: "service",
    credentialId: grantId,
    authority: "service",
    workspaceId,
  });
}
const now = () => Math.floor(Date.now() / 1000);

it("creates one review-only grant per subject and client and serves it as a service principal", async () => {
  const a = await admit("a");
  const args = { clientKey: "oauth:https://claude.ai/client", issuedAt: now() };
  const first = await host("a", a).mutation(
    api.agentGrants.ensureOAuthGrant,
    args,
  );
  expect(first.permissions).toEqual(["read", "draft"]);
  expect(
    await host("a", a).mutation(api.agentGrants.ensureOAuthGrant, args),
  ).toEqual(first);
  const other = await host("a", a).mutation(api.agentGrants.ensureOAuthGrant, {
    ...args,
    clientKey: "oauth:other",
  });
  expect(other.grantId).not.toBe(first.grantId);

  expect(
    await listAll(agent(a, first.grantId), api.app.listDataSources, {}),
  ).toEqual([]);
  const resolved = await t
    .withIdentity({
      issuer: runtimeIssuer,
      subject: `service:${first.grantId}`,
      principalKind: "service",
      credentialId: first.grantId,
      authority: "host",
      purpose: "host-metadata",
      workspaceId: a,
    })
    .query(api.hostedCredentials.resolveService, {});
  expect(resolved).toEqual({
    credentialId: first.grantId,
    subject: "a",
    workspaceId: a,
  });
  // A grant never lets the agent commit; only a user principal may.
  await expect(
    agent(a, first.grantId).mutation(api.app.publishDraft, {
      draftId: "00000000-0000-4000-8000-000000000000",
    }),
  ).rejects.toThrow("User permission required");
});

it("denies the wrong authority, purpose, principal, workspace, or an unadmitted subject", async () => {
  const a = await admit("a");
  const b = await admit("b");
  const args = { clientKey: "oauth:client", issuedAt: now() };
  for (const caller of [
    t,
    operator(),
    host("a", a, { authority: "browser" }),
    host("a", a, { purpose: undefined }),
    host("a", a, { purpose: "host-metadata" }),
    host("a", a, { principalKind: "service" }),
    host("a", a, { subject: "user:b" }),
    host("a", a, { issuer: operatorIssuer }),
    host("a", b),
    host("pending", a),
  ])
    await expect(
      caller.mutation(api.agentGrants.ensureOAuthGrant, args),
    ).rejects.toThrow();
  for (const clientKey of ["", " oauth", "oauth:a b", "x".repeat(513)])
    await expect(
      host("a", a).mutation(api.agentGrants.ensureOAuthGrant, {
        ...args,
        clientKey,
      }),
    ).rejects.toThrow("Invalid agent client");
  await operator().mutation(api.admission.revoke, { subject: "a" });
  await expect(
    host("a", a).mutation(api.agentGrants.ensureOAuthGrant, args),
  ).rejects.toThrow("admission");
});

it("revokes immediately, keeps pre-revocation tokens denied, and reissues for a newer token", async () => {
  const a = await admit("a");
  const b = await admit("b");
  const clientKey = "oauth:client";
  const issuedAt = now() - 10;
  const { grantId } = await host("a", a).mutation(
    api.agentGrants.ensureOAuthGrant,
    { clientKey, issuedAt },
  );
  await expect(
    owner("b", b).mutation(api.agentGrants.revokeGrant, { grantId }),
  ).rejects.toThrow("ownership");
  await owner("a", a).mutation(api.agentGrants.revokeGrant, { grantId });
  await owner("a", a).mutation(api.agentGrants.revokeGrant, { grantId });
  await expect(
    listAll(agent(a, grantId), api.app.listDataSources, {}),
  ).rejects.toThrow("revoked");
  await expect(
    host("a", a).mutation(api.agentGrants.ensureOAuthGrant, {
      clientKey,
      issuedAt,
    }),
  ).rejects.toThrow("Agent grant revoked");

  const reissued = await host("a", a).mutation(
    api.agentGrants.ensureOAuthGrant,
    { clientKey, issuedAt: now() + 5 },
  );
  expect(reissued.grantId).not.toBe(grantId);
  expect(
    await listAll(agent(a, reissued.grantId), api.app.listDataSources, {}),
  ).toEqual([]);
  await expect(
    listAll(agent(a, grantId), api.app.listDataSources, {}),
  ).rejects.toThrow("revoked");
  // Reissue must not resurrect a token minted before the revocation.
  await expect(
    host("a", a).mutation(api.agentGrants.ensureOAuthGrant, {
      clientKey,
      issuedAt,
    }),
  ).rejects.toThrow("Agent grant revoked");

  const listed = await owner("a", a).query(api.agentGrants.listGrants, {});
  expect(listed).toEqual([
    expect.objectContaining({
      grantId: reissued.grantId,
      clientKey,
      revokedAt: null,
    }),
  ]);
  expect(await owner("b", b).query(api.agentGrants.listGrants, {})).toEqual([]);
});
