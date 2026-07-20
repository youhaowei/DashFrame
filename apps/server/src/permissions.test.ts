import { describe, expect, it } from "vitest";

import { checkPermission, LOCAL_USER_ID, permission } from "./permissions";

describe("checkPermission", () => {
  it("grants access credential management to the local user principal", async () => {
    await expect(
      checkPermission(
        { kind: "user", userId: LOCAL_USER_ID },
        permission.manageAccessCredentials,
      ),
    ).resolves.toBe(true);
  });

  it("denies access credential management to service principals", async () => {
    await expect(
      checkPermission(
        { kind: "service", credentialId: "credential-1" },
        permission.manageAccessCredentials,
      ),
    ).resolves.toBe(false);
  });
});
