import { evaluate } from "@wystack/permissions";
import { describe, expect, it } from "vitest";

import type { AppContext } from "./app-context";
import {
  expectedPermissionIds,
  LOCAL_USER_ID,
  permissions,
} from "./permissions";

function context(principal: AppContext["principal"]): AppContext {
  return { principal, getServerEndpoint: () => undefined };
}

describe("permissions", () => {
  it("keeps the boot-time permission id snapshot stable", () => {
    expect(permissions.accessCredentials.manage.id).toBe(
      "accessCredentials.manage",
    );
    expect(permissions.commands.commit.id).toBe("commands.commit");
    expect(permissions.commands.draft.id).toBe("commands.draft");
    expect(permissions.commands.preview.id).toBe("commands.preview");
    expect(permissions.connectors.setup.id).toBe("connectors.setup");
    expect(expectedPermissionIds).toEqual([
      "accessCredentials.manage",
      "commands.commit",
      "commands.draft",
      "commands.preview",
      "connectors.setup",
    ]);
  });

  it("grants access credential management to the local user principal", async () => {
    const ctx = context({ kind: "user", userId: LOCAL_USER_ID });
    await expect(
      evaluate(ctx.principal, permissions.accessCredentials.manage, ctx),
    ).resolves.toBe(true);
  });

  it("denies access credential management to service principals", async () => {
    const ctx = context({ kind: "service", credentialId: "credential-1" });
    await expect(
      evaluate(ctx.principal, permissions.accessCredentials.manage, ctx),
    ).resolves.toBe(false);
  });

  it("allows connector setup for user and service principals", async () => {
    for (const principal of [
      { kind: "user" as const, userId: LOCAL_USER_ID },
      { kind: "service" as const, credentialId: "credential-1" },
    ]) {
      const ctx = context(principal);
      await expect(
        evaluate(ctx.principal, permissions.connectors.setup, ctx),
      ).resolves.toBe(true);
    }
  });

  it("denies connector setup without a valid principal", async () => {
    const ctx = context(undefined);
    await expect(
      evaluate(ctx.principal, permissions.connectors.setup, ctx),
    ).resolves.toBe(false);
  });

  it("denies a well-formed user principal whose userId is not the local operator", async () => {
    const ctx = context({ kind: "user", userId: "someone-else" });
    await expect(
      evaluate(ctx.principal, permissions.accessCredentials.manage, ctx),
    ).resolves.toBe(false);
  });

  it("denies an absent or malformed principal", async () => {
    for (const malformed of [
      undefined,
      {},
      { kind: "user" },
      { kind: "bogus", userId: LOCAL_USER_ID },
    ]) {
      const ctx = context(malformed as AppContext["principal"]);
      await expect(
        evaluate(ctx.principal, permissions.accessCredentials.manage, ctx),
      ).resolves.toBe(false);
    }
  });

  it("allows command execution for previews, drafts, publish replay, and users", async () => {
    const service = context({
      kind: "service",
      credentialId: "credential-1",
    });
    const user = context({ kind: "user", userId: LOCAL_USER_ID });

    await expect(
      evaluate(service.principal, permissions.commands.commit, {
        ...service,
        mode: "preview",
      }),
    ).resolves.toBe(true);
    await expect(
      evaluate(service.principal, permissions.commands.commit, {
        ...service,
        draftId: "draft-1",
      }),
    ).resolves.toBe(true);
    await expect(
      evaluate(user.principal, permissions.commands.commit, {
        ...user,
        __publishReplay: true,
      }),
    ).resolves.toBe(true);
    await expect(
      evaluate(user.principal, permissions.commands.commit, user),
    ).resolves.toBe(true);
  });

  it("denies direct canonical command execution to service principals", async () => {
    const service = context({
      kind: "service",
      credentialId: "credential-1",
    });
    await expect(
      evaluate(service.principal, permissions.commands.commit, service),
    ).resolves.toBe(false);
  });

  it("allows preview for any well-formed principal, service or user", async () => {
    const service = context({
      kind: "service",
      credentialId: "credential-1",
    });
    const user = context({ kind: "user", userId: LOCAL_USER_ID });

    for (const ctx of [service, user]) {
      await expect(
        evaluate(ctx.principal, permissions.commands.preview, ctx),
      ).resolves.toBe(true);
    }
  });

  it("allows drafting for any well-formed principal, service or user", async () => {
    const service = context({
      kind: "service",
      credentialId: "credential-1",
    });
    const user = context({ kind: "user", userId: LOCAL_USER_ID });

    for (const ctx of [service, user]) {
      await expect(
        evaluate(ctx.principal, permissions.commands.draft, ctx),
      ).resolves.toBe(true);
    }
  });

  it("still denies preview with no principal at all — `evaluate` requires a well-formed Principal before it calls any permission's `check`, so 'preview is open' cannot mean 'no identity required'", async () => {
    const anonymous = context(undefined);
    await expect(
      evaluate(anonymous.principal, permissions.commands.preview, anonymous),
    ).resolves.toBe(false);
  });

  it("still denies draft with no principal at all", async () => {
    const anonymous = context(undefined);
    await expect(
      evaluate(anonymous.principal, permissions.commands.draft, anonymous),
    ).resolves.toBe(false);
  });
});
