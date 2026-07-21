import { isPrincipal } from "@wystack/identity";
import { definePermissions } from "@wystack/permissions";

import type { AppContext } from "./app-context";

export const LOCAL_USER_ID = "local-user";

export const permissions = definePermissions<AppContext>()({
  accessCredentials: {
    manage: {
      description: "Manage API access credentials",
      check: (ctx) =>
        isPrincipal(ctx.principal) &&
        ctx.principal.kind === "user" &&
        ctx.principal.userId === LOCAL_USER_ID,
    },
  },
});

/** Boot-time snapshot guarding the public permission identifiers. */
export const expectedPermissionIds = ["accessCredentials.manage"] as const;
