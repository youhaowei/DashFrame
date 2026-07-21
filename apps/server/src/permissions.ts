import { definePermissions } from "@wystack/permissions";

import type { AppContext } from "./app-context";

export const LOCAL_USER_ID = "local-user";

export const permissions = definePermissions<AppContext>()({
  accessCredentials: {
    manage: {
      description: "Manage API access credentials",
      check: (ctx) =>
        typeof ctx.principal === "object" &&
        ctx.principal !== null &&
        "kind" in ctx.principal &&
        ctx.principal.kind === "user" &&
        "userId" in ctx.principal &&
        ctx.principal.userId === LOCAL_USER_ID,
    },
  },
});

/** Boot-time snapshot guarding the public permission identifiers. */
export const expectedPermissionIds = ["accessCredentials.manage"] as const;
