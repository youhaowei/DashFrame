import { describe, expect, it } from "vite-plus/test";
import { listAgentGrants, revokeAgentGrant } from "./access-credentials";
import type { HostContext } from "./context";

const id = "6f1c2d4e-8a9b-4c3d-9e1f-2a3b4c5d6e7f";

function context(overrides: Partial<HostContext> = {}) {
  const revoked: string[] = [];
  const ctx = {
    principal: { kind: "user", userId: "owner" },
    workspaceOwnerId: "owner",
    agentGrants: {
      listAgentGrants: async () => [
        {
          grantId: id,
          clientKey: "oauth:claude",
          permissions: ["read", "draft"],
          createdAt: 1,
          revokedAt: null,
        },
      ],
      revokeAgentGrant: async (grantId: string) => {
        revoked.push(grantId);
      },
    },
    ...overrides,
  } as unknown as HostContext;
  return { ctx, revoked };
}

describe("agent grant host operations", () => {
  it("lets the workspace owner list and revoke grants", async () => {
    const { ctx, revoked } = context();
    expect(await listAgentGrants(ctx)).toHaveLength(1);
    expect(await revokeAgentGrant(ctx, { id })).toEqual({ ok: true });
    expect(revoked).toEqual([id]);
  });

  it("refuses services, other users, malformed ids, and hosts without grants", async () => {
    const service = context({
      principal: { kind: "service", credentialId: id },
    } as Partial<HostContext>).ctx;
    const stranger = context({
      principal: { kind: "user", userId: "someone-else" },
    } as Partial<HostContext>).ctx;
    for (const ctx of [service, stranger]) {
      await expect(listAgentGrants(ctx)).rejects.toThrow();
      await expect(revokeAgentGrant(ctx, { id })).rejects.toThrow();
    }
    await expect(
      revokeAgentGrant(context().ctx, { id: "not-a-uuid" }),
    ).rejects.toThrow();
    await expect(
      listAgentGrants(context({ agentGrants: undefined }).ctx),
    ).rejects.toThrow("only on the hosted app");
  });
});
