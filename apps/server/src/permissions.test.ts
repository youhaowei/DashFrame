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
    expect(expectedPermissionIds).toEqual(["accessCredentials.manage"]);
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
});
